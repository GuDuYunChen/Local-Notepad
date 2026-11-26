// Native Electron regression for shared controls only. No backend or user data.
// Build first: node scripts/build-ui-control-render-fixture.mjs
// Run: npx --no-install electron scripts/check-ui-control-render.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { fileURLToPath } = require('node:url')
const HEIGHTS = Object.freeze({ ordinary: 40, compact: 28, large: 44 })
const KINDS = Object.freeze(['button', 'input', 'password', 'select'])
const VIEWPORTS = Object.freeze([[704, 455], [1280, 800], [1920, 1080]])
const BUDGET_MS = 90000
const TOLERANCE = 0.6
const STABILITY_TOLERANCE = 0.01
const POINTER_CASES = Object.freeze([
  ...['normal', 'error', 'warning'].flatMap(status => ['input', 'password', 'textarea', 'textarea-clear', 'select']
    .map(kind => ({ id: `pointer-${status}-${kind}`, kind, status, disabled: false, readOnly: false }))),
  ...['input', 'textarea'].map(kind => ({ id: `pointer-readonly-${kind}`, kind, status: 'normal', disabled: false, readOnly: true })),
  ...['input', 'password', 'textarea', 'select'].map(kind => ({ id: `pointer-disabled-${kind}`, kind, status: 'normal', disabled: true, readOnly: false })),
  { id: 'name-dialog-rename', kind: 'input', status: 'normal', disabled: false, readOnly: false }
])
const HOVER_CASES = Object.freeze([
  { id: 'nav-selected', selector: '.workspace-sidebar-nav-item[aria-label="笔记"]', text: true, pressed: 'true' },
  { id: 'nav-unselected', selector: '.workspace-sidebar-nav-item[aria-label="项目"]', text: true, pressed: 'false' },
  { id: 'nav-more', selector: '.workspace-sidebar-more', text: true },
  { id: 'note-long', selector: '#file-tree-item-hover-long', next: '#file-tree-item-hover-selected', note: true, text: true, selected: 'false' },
  { id: 'note-selected', selector: '#file-tree-item-hover-selected', next: '#file-tree-item-hover-short', note: true, text: true, selected: 'true' },
  { id: 'note-short', selector: '#file-tree-item-hover-short', next: '#file-tree-item-hover-last', note: true, text: true, selected: 'false' },
  { id: 'note-folder', selector: '#file-tree-item-hover-folder', next: '#file-tree-item-hover-nested', note: true, text: true },
  { id: 'note-nested', selector: '#file-tree-item-hover-nested', next: '#file-tree-item-hover-nested-next', note: true, text: true },
  { id: 'note-rename-action', selector: '#file-tree-item-hover-long', target: '.actions .action-btn:not(.danger)', next: '#file-tree-item-hover-selected', note: true, text: true, baseHover: true },
  { id: 'note-delete-action', selector: '#file-tree-item-hover-long', target: '.actions .action-btn.danger', next: '#file-tree-item-hover-selected', note: true, text: true, baseHover: true },
  { id: 'collapsed-selected', selector: '.workspace-sidebar-nav-item[aria-label="笔记"]', collapsed: true, pressed: 'true' },
  { id: 'collapsed-unselected', selector: '.workspace-sidebar-nav-item[aria-label="项目"]', collapsed: true, pressed: 'false' },
  { id: 'collapsed-more', selector: '.workspace-sidebar-more', collapsed: true }
])
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

// Runs in the actual fixture page. Preserve the original toolbar geometry and
// additionally observe the precise painted targets at the PNG boundary.
function toolbarSnapshot() {
  const roots = document.querySelectorAll('#long-toolbar')
  if (roots.length !== 1) throw Error('Actual toolbar root missing or ambiguous')
  const root = roots[0], bounds = node => {
    const r = node.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
  }
  const html = document.documentElement, body = document.body, htmlCSS = getComputedStyle(html)
  const htmlNamespace = 'http://www.w3.org/1999/xhtml'
  const firstBody = [...html.children].find(node => node.namespaceURI === htmlNamespace && node.localName === 'body')
  const bodyCSS = body ? getComputedStyle(body) : null
  // CSS Overflow 3 §3.3: propagated root/body overflow clips at the viewport,
  // not a second time at that element's scrolled box. Containment disables the
  // body special case; unknown or implicit containment stays conservative.
  const bodyPropagated = html.namespaceURI === htmlNamespace && html.localName === 'html' && htmlCSS.display !== 'none' &&
    htmlCSS.overflowX === 'visible' && htmlCSS.overflowY === 'visible' && firstBody === body && body?.parentElement === html &&
    bodyCSS?.display !== 'none' && htmlCSS.contain === 'none' && bodyCSS?.contain === 'none' &&
    htmlCSS.contentVisibility === 'visible' && bodyCSS?.contentVisibility === 'visible'
  const viewportOwner = bodyPropagated ? body : htmlCSS.display !== 'none' ? html : null
  const viewportClip = { left: 0, top: 0, right: Math.min(innerWidth, html.clientWidth), bottom: Math.min(innerHeight, html.clientHeight) }
  const identity = node => node ? { tag: node.localName, id: node.id || null } : null
  const observe = node => {
    const box = bounds(node)
    let visible = box.width > 0 && box.height > 0
    let inViewport = box.left >= -1 && box.top >= -1 && box.right <= viewportClip.right + 1 && box.bottom <= viewportClip.bottom + 1
    const ancestors = []
    for (let owner = node; owner; owner = owner.parentElement) {
      const css = getComputedStyle(owner), rect = bounds(owner)
      const clip = { left: rect.left + owner.clientLeft, top: rect.top + owner.clientTop,
        right: rect.left + owner.clientLeft + owner.clientWidth, bottom: rect.top + owner.clientTop + owner.clientHeight }
      const propagated = owner === html && htmlCSS.display !== 'none' || owner === viewportOwner
      const clipY = owner !== node && !propagated && /hidden|auto|scroll|clip/.test(css.overflowY)
      const clipX = owner !== node && !propagated && /hidden|auto|scroll|clip/.test(css.overflowX)
      visible &&= css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0
      if (clipY) inViewport &&= box.top >= clip.top - 1 && box.bottom <= clip.bottom + 1
      if (clipX) inViewport &&= box.left >= clip.left - 1 && box.right <= clip.right + 1
      ancestors.push({ ...identity(owner), rect, clientClip: clip, viewportOverflow: propagated,
        appliedClipX: clipX, appliedClipY: clipY, computed: { display: css.display, visibility: css.visibility, opacity: css.opacity,
          overflowX: css.overflowX, overflowY: css.overflowY, contain: css.contain, contentVisibility: css.contentVisibility } })
    }
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { ...box, owned: root.contains(node), visible, inViewport, hit: hit === node || node.contains(hit), ancestors }
  }
  const r = bounds(root)
  return { viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.theme,
    left: r.left, right: r.right, rootBounds: r,
    viewportOverflow: { owner: identity(viewportOwner), bodyPropagated, clip: viewportClip },
    fields: ['long-input', 'long-select', 'long-clear'].map(id => {
      const field = document.getElementById(id)
      if (!field) throw Error('Actual toolbar control missing: ' + id)
      const control = field.closest('.ant-select') || field
      return { id, ...observe(control) }
    }),
    labels: [...root.querySelectorAll('label')].map((node, index) => ({ index, ...observe(node) })),
    overflow: document.documentElement.scrollWidth - innerWidth,
    longLabelLength: root.querySelector('label').textContent.trim().length }
}

function verifyToolbarSnapshot(sample, expected) {
  assert.deepEqual(sample?.viewport, expected.viewport, 'Toolbar capture viewport changed')
  assert.equal(sample.theme, expected.theme, 'Toolbar capture theme changed')
  assert.ok(sample.overflow <= 1 && sample.longLabelLength > 20)
  assert.deepEqual(sample.fields.map(field => field.id), ['long-input', 'long-select', 'long-clear'])
  assert.equal(sample.labels.length, 2, 'Both original long toolbar labels are required')
  for (const item of [...sample.fields, ...sample.labels]) {
    for (const key of ['owned', 'visible', 'inViewport', 'hit']) assert.equal(item[key], true, 'Toolbar PNG target must remain visible and unobscured: ' + key)
    assert.ok(item.width > 20 && item.height > 0)
    assert.ok(item.left >= -1 && item.top >= -1 && item.right <= expected.viewport.width + 1 && item.bottom <= expected.viewport.height + 1, 'Toolbar PNG target is outside viewport')
  }
  for (const field of sample.fields) assert.ok(Math.abs(field.height - 40) <= TOLERANCE, 'Toolbar PNG control height changed')
  return sample
}

function verifyToolbarContinuity(before, after, expected) {
  verifyToolbarSnapshot(before, expected); verifyToolbarSnapshot(after, expected)
  const previous = [before.rootBounds, ...before.fields, ...before.labels]
  const current = [after.rootBounds, ...after.fields, ...after.labels]
  for (let i = 0; i < previous.length; i++) for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
    assert.ok(Number.isFinite(current[i][key]) && Math.abs(current[i][key] - previous[i][key]) <= TOLERANCE, 'Toolbar target moved across PNG capture')
  }
}

async function captureToolbarEvidence({ record, read, capture, persist, expected }) {
  const proof = record.capture = { complete: false }; persist()
  proof.image = await capture(async () => {
    proof.before = await read(); persist()
    verifyToolbarContinuity(record, proof.before, expected)
  })
  assert.ok(proof.before, 'Toolbar PNG omitted its fresh pre-capture target guard')
  proof.after = await read(); persist()
  verifyToolbarContinuity(proof.before, proof.after, expected)
  proof.complete = true; persist(); return proof.image
}

function verifyGeometry(sample) {
  assert.equal(sample.controls.length, 12, 'All four controls in all three densities are required')
  assert.ok(sample.overflow <= 1, 'Fixture must not overflow horizontally')
  const seen = new Set()
  for (const control of sample.controls) {
    const key = `${control.density}-${control.kind}`
    assert.ok(!seen.has(key) && HEIGHTS[control.density] && KINDS.includes(control.kind), 'Exact control matrix')
    seen.add(key)
    assert.ok(Number.isFinite(control.height) && Math.abs(control.height - HEIGHTS[control.density]) <= TOLERANCE,
      `${key}: expected ${HEIGHTS[control.density]}px, observed ${control.height}px`)
    assert.equal(control.context, control.density === 'compact' ? 'product-editor-toolbar' : 'standalone',
      `${key}: production editor toolbar context is required for compact controls`)
    assert.ok(control.width > 10 && control.left >= -1 && control.right <= sample.viewport.width + 1, `${key}: horizontal bounds`)
    if (control.kind === 'password') {
      assert.deepEqual(control.innerPadding, [0, 0, 0, 0], `${key}: affix child must not be padded twice`)
      assert.ok(control.innerHeight > 0 && control.innerHeight < control.height, `${key}: inner line is bounded by wrapper`)
    }
  }
  for (const density of Object.keys(HEIGHTS)) {
    const row = sample.controls.filter(control => control.density === density)
    assert.equal(row.length, 4)
    assert.ok(Math.max(...row.map(control => control.top)) - Math.min(...row.map(control => control.top)) <= TOLERANCE,
      `${density}: control tops must align`)
  }
}

function verifyFocus(sample) {
  assert.equal(sample.focused, true, `${sample.id}: native focus owner`)
  assert.equal(sample.focusVisible, true, `${sample.id}: keyboard focus must be visible`)
  assert.equal(sample.outlines.length, 1, `${sample.id}: exactly one focus outline`)
  assert.equal(sample.outlines[0].owner, 'root', `${sample.id}: outer control owns the outline`)
  assert.ok(sample.outlines[0].width >= 1.5, `${sample.id}: visible outline width`)
  assert.equal(sample.shadows.length, 0, `${sample.id}: duplicate focus glow refused`)
  assert.equal(sample.hit, true, `${sample.id}: focused control must be hit-testable`)
  assert.equal(sample.inViewport, true, `${sample.id}: focused control must be visible`)
}

function feedbackAssert(condition, category, message, actual, expected) {
  if (condition) return
  const error = new assert.AssertionError({ message, actual, expected, operator: 'native-feedback' })
  error.regressionCategory = category
  throw error
}

function finiteRect(rect, label) {
  feedbackAssert(!!rect && ['left', 'top', 'right', 'bottom', 'width', 'height'].every(key => Number.isFinite(rect[key])),
    'native-evidence', label + ': real finite rectangle is required', rect, 'finite DOM rectangle')
}

function stableRect(before, after, category, label) {
  finiteRect(before, label); finiteRect(after, label)
  for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
    feedbackAssert(Math.abs(before[key] - after[key]) <= STABILITY_TOLERANCE, category,
      `${label}: ${key} moved`, after[key], before[key])
  }
}

function verifyPointerFeedback(record, expected) {
  feedbackAssert(record?.executionComplete === true && !!record.before && !!record.after, 'native-evidence',
    expected.id + ': complete native pointer observations required', record?.executionComplete, true)
  const { before, after } = record
  feedbackAssert(before.focused === false, 'native-evidence', expected.id + ': pointer entry must start outside the input', before.focused, false)
  for (const sample of [before, after]) {
    feedbackAssert(sample.id === record.domId, 'native-evidence', expected.id + ': actual input identity changed', sample.id, record.domId)
    for (const key of ['disabled', 'readOnly', 'status']) feedbackAssert(sample[key] === expected[key], 'focus-state',
      `${expected.id}: ${key} semantics changed`, sample[key], expected[key])
  }
  stableRect(before.rect, after.rect, 'pointer-geometry', expected.id)
  feedbackAssert(JSON.stringify(before.value) === JSON.stringify(after.value), 'focus-state', expected.id + ': pointer focus changed value', after.value, before.value)
  feedbackAssert(after.hit && after.inViewport && record.trustedPointer === true, 'native-evidence',
    expected.id + ': pointer target and trusted native input required', { hit: after.hit, inViewport: after.inViewport, trustedPointer: record.trustedPointer }, true)
  if (expected.disabled) {
    feedbackAssert(!after.focused && after.outlines.length === 0 && after.shadows.length === 0, 'focus-state',
      expected.id + ': disabled input acquired focus decoration', { focused: after.focused, outlines: after.outlines, shadows: after.shadows }, 'disabled without focus')
    return
  }
  for (const [stage, sample] of [['pointer', after], ['keyboard', record.keyboard]]) {
    feedbackAssert(!!sample && sample.focused && sample.hit && sample.inViewport, 'native-evidence',
      `${expected.id}: ${stage} actual focus required`, sample && { focused: sample.focused, hit: sample.hit, inViewport: sample.inViewport }, true)
    for (const key of ['disabled', 'readOnly', 'status']) feedbackAssert(sample[key] === expected[key], 'focus-state',
      `${expected.id}: ${stage} ${key} semantics changed`, sample[key], expected[key])
    feedbackAssert(sample.outlines.length === 1 && sample.outlines[0].owner === 'root' && sample.outlines[0].width >= 1.5,
      'focus-decoration', `${expected.id}: ${stage} must retain one visible root focus cue`, sample.outlines, 'one visible root outline')
    const outline = sample.outlines[0]
    feedbackAssert(Number.isFinite(outline.width) && Number.isFinite(outline.offset), 'native-evidence',
      expected.id + ': real outline offset required', outline, 'finite width and offset')
    feedbackAssert(outline.width + outline.offset <= STABILITY_TOLERANCE && sample.shadows.length === 0,
      'focus-outline-outside', `${expected.id}: ${stage} paints an additional outside focus border`,
      { width: outline.width, offset: outline.offset, shadows: sample.shadows }, 'focus paint remains inside the control border')
    const root = sample.diagnostics?.nodes?.find(node => node.owner === 'root')
    feedbackAssert(!!root && root.computed['border-top-color'] === outline.color, 'focus-state-color',
      `${expected.id}: ${stage} focus cue must preserve its actual status border color`, outline.color, root?.computed['border-top-color'])
  }
  // Preserve the original keyboard contract, including its minimum visible cue.
  verifyFocus(record.keyboard)
  stableRect(before.rect, record.keyboard.rect, 'pointer-geometry', expected.id + ' keyboard')
  feedbackAssert(JSON.stringify(before.value) === JSON.stringify(record.keyboard.value), 'focus-state', expected.id + ': keyboard focus changed value', record.keyboard.value, before.value)
}

// Executed in the real renderer. Text ranges and descendants are measured as
// well as row bounds: a stable outer row can still hide moving text or icons.
function hoverSnapshot(spec) {
  const workspace = document.getElementById('hover-workspace')
  const matches = workspace.querySelectorAll(spec.selector)
  if (matches.length !== 1) throw Error('Actual hover target missing or ambiguous: ' + spec.id)
  const root = matches[0], target = spec.target ? root.querySelector(spec.target) : root
  if (!target) throw Error('Actual action target missing: ' + spec.id)
  const bounds = node => {
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }
  const isHit = node => {
    if (!node) return false
    const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return r.width > 0 && r.height > 0 && (hit === node || node.contains(hit))
  }
  const text = spec.note ? root.querySelector('.title') : [...root.querySelectorAll('span')].find(node => node.textContent.trim())
  const textRanges = []
  if (text) {
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
    for (let node; (node = walker.nextNode());) {
      if (!node.textContent.trim()) continue
      const range = document.createRange(); range.selectNodeContents(node)
      for (const r of range.getClientRects()) textRanges.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
    }
  }
  const actions = root.querySelector('.actions'), css = getComputedStyle(root), targetRect = bounds(target)
  const actionStates = actions ? [...actions.querySelectorAll('button')].map(node => {
    const style = getComputedStyle(node)
    return { rect: bounds(node), visibility: style.visibility, pointerEvents: style.pointerEvents, hit: isHit(node) }
  }) : []
  const actionCSS = actions ? getComputedStyle(actions) : null
  return { id: spec.id, root: bounds(root), target: targetRect, text: bounds(text), textRanges,
    textContent: text?.textContent || '', icon: bounds(root.querySelector(spec.note ? '.icon' : 'svg')),
    actions: bounds(actions), next: bounds(spec.next ? workspace.querySelector(spec.next) : null), actionStates,
    actionsVisible: !!actionCSS && actionCSS.display !== 'none' && actionCSS.visibility === 'visible' && Number(actionCSS.opacity) > 0,
    borderWidths: ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(css['border' + side + 'Width'])),
    rootHovered: root.matches(':hover'), targetHovered: target.matches(':hover'),
    visible: css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0,
    targetHit: isHit(target), targetInViewport: targetRect.left >= -1 && targetRect.top >= -1 && targetRect.right <= innerWidth + 1 && targetRect.bottom <= innerHeight + 1,
    state: { selected: root.getAttribute('aria-selected'), pressed: root.getAttribute('aria-pressed'), expanded: root.getAttribute('aria-expanded'),
      keyboardFocus: root.classList.contains('keyboard-focus'), focusWithin: root.matches(':focus-within'), activeElement: document.activeElement?.id || document.activeElement?.tagName },
    collapsed: workspace.querySelector('.workspace-sidebar').classList.contains('collapsed') }
}

function verifyHoverFeedback(record, spec) {
  feedbackAssert(record?.executionComplete === true, 'native-evidence', spec.id + ': complete native hover observations required', record?.executionComplete, true)
  const samples = [record.before, record.hover, record.out]
  for (const [index, sample] of samples.entries()) {
    feedbackAssert(!!sample && sample.id === spec.id && sample.visible && sample.collapsed === !!spec.collapsed,
      'native-evidence', spec.id + ': real component and requested mode required', sample && { id: sample.id, visible: sample.visible, collapsed: sample.collapsed }, { id: spec.id, visible: true, collapsed: !!spec.collapsed })
    feedbackAssert(sample.rootHovered === (index === 1 || !!spec.baseHover) && sample.targetHovered === (index === 1 || !!spec.baseHover && !spec.target),
      'native-evidence', spec.id + ': native hover transition required', { rootHovered: sample.rootHovered, targetHovered: sample.targetHovered }, { rootHovered: index === 1 || !!spec.baseHover, targetHovered: index === 1 })
    finiteRect(sample.root, spec.id + ' root'); finiteRect(sample.icon, spec.id + ' icon')
    for (const key of ['selected', 'pressed']) if (spec[key] !== undefined) feedbackAssert(sample.state[key] === spec[key], 'hover-state',
      `${spec.id}: expected ${key} state missing`, sample.state[key], spec[key])
    feedbackAssert(sample.root.width > 0 && sample.root.height > 0 && sample.icon.width > 0 && sample.icon.height > 0,
      'native-evidence', spec.id + ': painted root and icon required', sample.icon, 'positive painted geometry')
    if (spec.text) feedbackAssert(!!sample.text && sample.textContent.length > 0 && sample.textRanges.length > 0,
      'native-evidence', spec.id + ': actual text ranges required', sample.textRanges, 'painted text ranges')
  }
  feedbackAssert(record.trustedPointer === true && record.hover.targetHit && record.hover.targetInViewport,
    'native-evidence', spec.id + ': trusted pointer and hit-tested hover target required', record.trustedPointer, true)
  for (const sample of samples.slice(1)) {
    for (const key of ['root', 'target', 'icon', 'text', 'actions', 'next']) {
      if (record.before[key] || sample[key]) stableRect(record.before[key], sample[key], 'hover-geometry', spec.id + ' ' + key)
    }
    feedbackAssert(sample.textContent === record.before.textContent && sample.textRanges.length === record.before.textRanges.length,
      'hover-geometry', spec.id + ': text flow changed', { text: sample.textContent, ranges: sample.textRanges.length }, { text: record.before.textContent, ranges: record.before.textRanges.length })
    for (let i = 0; i < record.before.textRanges.length; i++) stableRect(record.before.textRanges[i], sample.textRanges[i], 'hover-geometry', spec.id + ' text range ' + i)
    feedbackAssert(sample.borderWidths.length === 4 && sample.borderWidths.every((width, index) => Number.isFinite(width) && Math.abs(width - record.before.borderWidths[index]) <= STABILITY_TOLERANCE),
      'hover-geometry', spec.id + ': border widths changed on hover', sample.borderWidths, record.before.borderWidths)
    feedbackAssert(JSON.stringify(sample.state) === JSON.stringify(record.before.state), 'hover-state', spec.id + ': hovering changed semantic state', sample.state, record.before.state)
  }
  if (spec.note) for (const sample of samples) {
    feedbackAssert(sample.actions?.width > 0 && sample.actions?.height > 0 && sample.actionStates.length === 2,
      'hover-geometry', spec.id + ': action space must exist before hovering', sample.actions, 'two reserved action slots')
    const shown = sample.rootHovered || sample.state.selected === 'true' || sample.state.keyboardFocus || sample.state.focusWithin
    feedbackAssert(sample.actionsVisible === shown, 'hover-state', spec.id + ': action visibility changed incorrectly', sample.actionsVisible, shown)
    for (const [index, action] of sample.actionStates.entries()) {
      stableRect(record.before.actionStates[index].rect, action.rect, 'hover-geometry', spec.id + ' action ' + index)
      feedbackAssert(shown ? action.visibility === 'visible' && action.pointerEvents !== 'none' && action.hit : action.visibility === 'hidden' && action.pointerEvents === 'none' && !action.hit,
        'hover-state', spec.id + ': hidden actions must not intercept input, visible actions must be clickable', action, shown ? 'visible and hit-testable' : 'hidden and not hit-testable')
    }
  }
}

function canonicalFeedbackFailure(scene, category, probeId, stage, error) {
  const details = { name: String(error?.name || 'Error'), message: String(error?.message || error) }
  for (const key of ['actual', 'expected', 'operator']) if (error && key in error) details[key] = error[key]
  return { scene, category, probeId, stage, error: details }
}

function treeStateSnapshot() {
  const workspace = document.getElementById('hover-workspace'), tree = workspace.querySelector('.tree-list')
  if (!tree || tree.getAttribute('role') !== 'tree') throw Error('Actual FileList tree is required')
  const output = JSON.parse(document.getElementById('hover-fixture-output').textContent)
  return { treeFocused: document.activeElement === tree, activeElement: { tag: document.activeElement?.tagName, id: document.activeElement?.id || null },
    activeDescendant: tree.getAttribute('aria-activedescendant'), selectedId: output.selectedId,
    selectedIds: [...tree.querySelectorAll('[role="treeitem"][aria-selected="true"]')].map(node => node.dataset.fileId),
    visibleIds: [...tree.querySelectorAll('[role="treeitem"]')].map(node => node.dataset.fileId), loadedIds: output.loadedIds }
}

function verifyTreeCancel(record, id) {
  feedbackAssert(record?.executionComplete === true && record.closed === true && record.trustedOpen === true && record.trustedCancel === true && record.dialog?.role === 'dialog',
    'native-evidence', id + ': actual dialog opening and trusted cancellation required', record, 'complete native cancellation')
  feedbackAssert(record.dialog.title === (id === 'tree-rename-cancel' ? '重命名笔记' : '移到回收站？'),
    'tree-state', id + ': actual dialog title changed', record.dialog.title, id === 'tree-rename-cancel' ? '重命名笔记' : '移到回收站？')
  feedbackAssert(record.before?.treeFocused === true && record.before.activeDescendant === 'file-tree-item-hover-selected',
    'native-evidence', id + ': dialog must start from the real selected tree item', record.before, 'focused selected tree item')
  feedbackAssert(record.before.selectedId === 'hover-selected' && JSON.stringify(record.before.selectedIds) === JSON.stringify(['hover-selected']) &&
    Array.isArray(record.before.loadedIds) && record.before.loadedIds.length === 7 && new Set(record.before.loadedIds).size === 7 &&
    Array.isArray(record.before.visibleIds) &&
    JSON.stringify([...record.before.visibleIds].sort()) === JSON.stringify([...record.before.loadedIds].sort()),
  'native-evidence', id + ': isolated expanded file data required', record.before, 'seven visible isolated records and one selected note')
  if (id === 'tree-delete-cancel') feedbackAssert(JSON.stringify(record.dialog.buttons) === JSON.stringify(['取消', '移到回收站']) &&
    record.dialog.focusedButton === '移到回收站' && record.dialog.message === '“已选中的笔记.md”会移到回收站，30 天内可以恢复。',
  'tree-state', id + ': actual delete confirmation changed', record.dialog, 'selected note delete confirmation with cancel')
  for (const key of ['selectedId', 'selectedIds', 'visibleIds', 'loadedIds']) feedbackAssert(JSON.stringify(record.after?.[key]) === JSON.stringify(record.before[key]),
    'tree-state', id + ': cancellation changed ' + key, record.after?.[key], record.before[key])
  feedbackAssert(record.after?.treeFocused === true && record.after.activeDescendant === record.before.activeDescendant,
    'tree-focus-return', id + ': cancellation did not return focus to its tree item', record.after, record.before)
}

function verifyTreeNavigation(record) {
  feedbackAssert(record?.executionComplete === true && record.downTrusted === true && record.upTrusted === true,
    'native-evidence', 'tree-navigation: real ArrowDown and ArrowUp required', record, 'complete trusted key traversal')
  for (const [stage, expected] of [['before', 'file-tree-item-hover-selected'], ['down', 'file-tree-item-hover-short'], ['up', 'file-tree-item-hover-selected']]) {
    const sample = record[stage]
    feedbackAssert(sample?.treeFocused === true && sample.activeDescendant === expected,
      'tree-navigation', 'tree-navigation: ' + stage + ' keyboard position changed', sample, expected)
    for (const key of ['selectedId', 'selectedIds', 'visibleIds', 'loadedIds']) feedbackAssert(JSON.stringify(sample[key]) === JSON.stringify(record.before[key]),
      'tree-state', 'tree-navigation: arrows changed ' + key, sample[key], record.before[key])
  }
}

function collectFeedbackFailures(scenes) {
  const failures = []
  for (const scene of scenes) {
    const feedback = scene.feedback
    assert.equal(feedback?.executionComplete, true, scene.name + ': new native collection must complete')
    assert.equal(feedback.backendExercised, false)
    assert.equal(feedback.scope, 'production-components-with-readonly-synthetic-files')
    assert.deepEqual(feedback.pointer.map(record => record.id), POINTER_CASES.map(spec => spec.id), 'Exact pointer / status matrix required')
    assert.deepEqual(feedback.hover.map(record => record.id), HOVER_CASES.map(spec => spec.id), 'Exact expanded / collapsed hover matrix required')
    assert.ok(feedback.libraryRequests.length > 0 && feedback.libraryRequests.every(request => request.accepted && request.method === 'GET' && request.path === '/api/files'), 'Only actual read-only synthetic file reads are allowed')
    assert.equal(feedback.nameDialog.cancelled, true)
    assert.equal(feedback.nameDialog.suffixBefore, '.md'); assert.equal(feedback.nameDialog.suffixAfter, '.md')
    assert.equal(feedback.nameDialog.valueBefore, '已选中的笔记')
    assert.equal(feedback.nameDialog.valueAfter, feedback.nameDialog.valueBefore)
    assert.equal(feedback.images.length, 11, 'All five native pointer and three paired hover PNGs are required')
    assert.equal(new Set(feedback.images.map(image => image.name)).size, feedback.images.length)
    for (const image of feedback.images) assert.ok(image.bytes > 100 && /^[a-f\d]{64}$/.test(image.sha256) && image.width > 0 && image.height > 0)
    const picture = (receipt, suffix) => {
      assert.equal(receipt?.name, `${scene.name}-feedback-${suffix}.png`, 'Fresh PNG must belong to its actual probe')
      assert.deepEqual(receipt, feedback.images.find(image => image.name === receipt.name), 'PNG receipt must be present in the native image manifest')
    }
    for (const id of ['pointer-normal-input', 'pointer-error-password', 'pointer-warning-textarea-clear', 'pointer-normal-select', 'name-dialog-rename']) {
      picture(feedback.pointer.find(record => record.id === id).pointerImage, id + '-pointer')
    }
    for (const id of ['nav-unselected', 'note-long', 'collapsed-unselected']) {
      const record = feedback.hover.find(record => record.id === id)
      picture(record.beforeImage, id + '-before'); picture(record.hoverImage, id + '-hover')
    }
    const rename = feedback.pointer.find(record => record.id === 'name-dialog-rename')
    assert.equal(rename.before.value, feedback.nameDialog.valueBefore)
    assert.equal(rename.after.value, feedback.nameDialog.valueAfter)
    for (const [kind, specs, verify] of [['pointer', POINTER_CASES, verifyPointerFeedback], ['hover', HOVER_CASES, verifyHoverFeedback]]) {
      for (let index = 0; index < specs.length; index++) {
        try { verify(feedback[kind][index], specs[index]) }
        catch (error) { failures.push(canonicalFeedbackFailure(scene.name, error.regressionCategory || 'native-evidence', specs[index].id, kind === 'pointer' ? 'focus' : 'hover', error)) }
      }
    }
    assert.equal(feedback.treeFlow?.executionComplete, true, 'Both cancellation and keyboard traversal observations are required')
    for (const [id, record] of [['tree-rename-cancel', feedback.treeFlow.rename], ['tree-delete-cancel', feedback.treeFlow.delete]]) {
      try { verifyTreeCancel(record, id) }
      catch (error) { failures.push(canonicalFeedbackFailure(scene.name, error.regressionCategory || 'native-evidence', id, 'tree', error)) }
    }
    try { verifyTreeNavigation(feedback.treeFlow.navigation) }
    catch (error) { failures.push(canonicalFeedbackFailure(scene.name, error.regressionCategory || 'native-evidence', 'tree-navigation', 'tree', error)) }
  }
  return failures
}

function verifyFeedbackScenes(scenes) {
  assert.equal(scenes.length, 6, 'All original theme and viewport combinations must collect feedback')
  assert.deepEqual(scenes.map(scene => scene.name).sort(), ['light', 'dark'].flatMap(theme => VIEWPORTS.map(([width, height]) => `${theme}-${width}x${height}`)).sort(), 'Feedback must cover the original exact native matrix')
  const failures = collectFeedbackFailures(scenes)
  if (failures.length) {
    const error = Error(`Native focus/hover regressions: ${failures.length}; ${failures[0].error.message}`)
    error.code = 'UI_FEEDBACK_REGRESSIONS'; error.failures = failures
    throw error
  }
  return { passed: true, failures }
}

function failureDetails(error) {
  const details = { name: String(error?.name || 'Error'), message: String(error?.message || error), stack: error?.stack || null }
  for (const key of ['actual', 'expected', 'operator', 'code', 'regressionCategory']) if (error != null && key in Object(error)) {
    try { details[key] = JSON.parse(JSON.stringify(error[key])) }
    catch { details[key] = String(error[key]) }
  }
  return details
}

async function recordFocusEvidence(scene, sample, persist, captureFailure) {
  scene.focus.push(sample); persist()
  try { verifyFocus(sample) }
  catch (error) {
    scene.focusFailure = { id: sample.id, error: failureDetails(error) }; persist()
    try { scene.focusFailure.image = await captureFailure() }
    catch (captureError) { scene.focusFailure.captureError = failureDetails(captureError) }
    persist()
    throw error
  }
}

async function captureMatchedFocusStyles(debuggerSession, id, writeArtifact) {
  const result = { id, selector: '[id=' + JSON.stringify(id) + ']', nodeId: null, artifacts: {}, errors: [] }
  let command = 'DOM.enable'
  try {
    await debuggerSession.sendCommand(command)
    command = 'CSS.enable'; await debuggerSession.sendCommand(command)
    command = 'DOM.getDocument'; const { root } = await debuggerSession.sendCommand(command, { depth: 0 })
    command = 'DOM.querySelector'
    const { nodeId } = await debuggerSession.sendCommand(command, { nodeId: root.nodeId, selector: result.selector })
    if (!nodeId) throw Error('Original failing focus node is no longer present')
    result.nodeId = nodeId
  } catch (error) { result.errors.push({ command, ...failureDetails(error) }); return result }
  // One failing node only. Preserve the complete responses, including parsedOk,
  // shorthand, priority and inherited rules, without fetching whole stylesheets.
  for (const [kind, method] of [['matched', 'CSS.getMatchedStylesForNode'], ['computed', 'CSS.getComputedStyleForNode']]) {
    let stage = 'read'
    try {
      const response = await debuggerSession.sendCommand(method, { nodeId: result.nodeId })
      stage = 'write'
      result.artifacts[kind] = writeArtifact(kind, { id, nodeId: result.nodeId, method, response })
    } catch (error) { result.errors.push({ command: method, stage, ...failureDetails(error) }) }
  }
  return result
}

function focusAnimationSnapshot(id) {
  const element = document.getElementById(id)
  if (!element) throw Error('Original failing focus node is no longer present')
  const css = getComputedStyle(element)
  return { id, activeElement: document.activeElement?.id, sampledAt: performance.now(),
    computed: Object.fromEntries(['outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
      'transition-property', 'transition-duration', 'transition-delay', 'transition-timing-function',
      'animation-name', 'animation-duration', 'animation-delay', 'animation-fill-mode', 'animation-play-state'].map(name => [name, css.getPropertyValue(name)])),
    animations: element.getAnimations().map(animation => ({ type: animation.constructor.name, id: animation.id,
      playState: animation.playState, pending: animation.pending, currentTime: animation.currentTime, startTime: animation.startTime,
      playbackRate: animation.playbackRate, transitionProperty: animation.transitionProperty, animationName: animation.animationName,
      timing: animation.effect?.getComputedTiming(), keyframes: animation.effect?.getKeyframes() })) }
}

// Computed CSS can retain a colored zero-size shadow when an official token
// disables its outline. Ignore only definitely unpainted layers; unknown or
// nonzero geometry remains evidence, so a real second cue cannot pass silently.
// Keep this function self-contained: the same source runs in Electron's page.
function hasVisibleBoxShadow(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text || text === 'none') return false
  const layers = []
  let depth = 0, start = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '(') depth++
    else if (text[index] === ')') depth--
    else if (text[index] === ',' && depth === 0) { layers.push(text.slice(start, index)); start = index + 1 }
  }
  layers.push(text.slice(start))
  return layers.some(layer => {
    if (/\btransparent\b/.test(layer)) return false
    const color = layer.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)/)
    if (color) {
      const channels = color[1]
      const alpha = channels.includes('/') ? channels.split('/').at(-1).trim()
        : /^rgba?\(|^hsla?\(/.test(color[0]) && channels.split(',').length === 4 ? channels.split(',').at(-1).trim() : null
      if (alpha !== null && /^[-+]?(?:\d*\.)?\d+%?$/.test(alpha) && parseFloat(alpha) <= 0) return false
      layer = layer.replace(color[0], '')
    } else {
      const hex = layer.match(/#[\da-f]+\b/)?.[0]
      if ((hex?.length === 5 && hex.endsWith('0')) || (hex?.length === 9 && hex.endsWith('00'))) return false
    }
    const lengths = layer.trim().split(/\s+/)
      .filter(token => /^[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?(?:px)?$/.test(token)).map(parseFloat)
    if (lengths.length < 2 || lengths.length > 4) return true
    return lengths.some(length => length !== 0)
  })
}

function verifyScenes(scenes) {
  assert.equal(scenes.length, 6, 'Both themes and every viewport must complete')
  const names = new Set()
  for (const scene of scenes) {
    assert.ok(!names.has(scene.name)); names.add(scene.name)
    assert.ok(['light', 'dark'].includes(scene.theme))
    assert.ok(VIEWPORTS.some(size => size[0] === scene.requested[0] && size[1] === scene.requested[1]))
    assert.deepEqual(scene.viewport, { width: scene.requested[0], height: scene.requested[1] }, 'Actual viewport must match requested size')
    verifyGeometry(scene.geometry)
    assert.equal(scene.focus.length, 12)
    assert.equal(new Set(scene.focus.map(sample => sample.id)).size, 12)
    scene.focus.forEach(verifyFocus)
    assert.equal(scene.interaction.complete, true)
    assert.equal(scene.form.complete, true)
    assert.equal(scene.modal.complete, true)
    assert.equal(scene.toolbar.complete, true)
    assert.equal(scene.toolbar.capture?.complete, true, 'Toolbar PNG requires fresh target proof')
    verifyToolbarContinuity(scene.toolbar, scene.toolbar.capture.before, scene)
    verifyToolbarContinuity(scene.toolbar.capture.before, scene.toolbar.capture.after, scene)
    assert.deepEqual(scene.toolbar.capture.image, scene.images.find(image => image.name === scene.name + '-toolbar.png'))
    assert.equal(scene.images.length, 7)
    for (const image of scene.images) {
      assert.ok(image.bytes > 100 && /^[a-f0-9]{64}$/.test(image.sha256))
      assert.ok(image.width > 0 && image.height > 0)
    }
    assert.equal(scene.errors.length, 0)
    assert.ok(scene.events.some(event => event.type === 'click' && event.trusted), 'Trusted pointer activation required')
    for (const key of ['Tab', 'ArrowDown', 'Enter', 'Escape']) {
      assert.ok(scene.events.some(event => event.type === 'keydown' && event.key === key && event.trusted), 'Trusted native key required: ' + key)
    }
    assert.equal(scene.complete, true)
  }
  for (const theme of ['light', 'dark']) for (const [width, height] of VIEWPORTS) {
    assert.ok(names.has(`${theme}-${width}x${height}`), 'Missing scene')
  }
}

function geometrySnapshot() {
  const controls = []
  for (const row of document.querySelectorAll('[data-density]')) for (const holder of row.querySelectorAll('[data-probe]')) {
    const kind = holder.dataset.kind
    const control = holder.querySelector(kind === 'select' ? '.ant-select' : kind === 'password' ? '.ant-input-affix-wrapper' : kind === 'button' ? 'button' : 'input')
    if (!control) throw new Error('Missing real control ' + holder.dataset.probe)
    const rect = control.getBoundingClientRect()
    const item = { density: row.dataset.density, kind, left: rect.left, right: rect.right,
      top: rect.top, width: rect.width, height: rect.height,
      context: control.closest('.product-editor-toolbar') ? 'product-editor-toolbar' : 'standalone' }
    if (kind === 'password') {
      const inner = control.querySelector('input'), css = getComputedStyle(inner)
      item.innerPadding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(key => parseFloat(css[key]))
      item.innerHeight = inner.getBoundingClientRect().height
    }
    controls.push(item)
  }
  return { controls, viewport: { width: innerWidth, height: innerHeight },
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth }
}

function focusSnapshot(id, shadowIsVisible) {
  const element = document.getElementById(id)
  if (!element) throw new Error('Missing focus control ' + id)
  const root = element.closest('.ant-input-affix-wrapper, .ant-select') || element
  const rect = root.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  const outlines = [], shadows = [], shadowStyles = [], nodes = []
  const identity = node => node ? { tag: node.tagName.toLowerCase(), id: node.id,
    class: node.getAttribute('class'), style: node.getAttribute('style'),
    control: node.getAttribute('data-ui-control'), layout: node.getAttribute('data-ui-layout') } : null
  for (const [index, node] of [root, ...root.querySelectorAll('*')].entries()) {
    const bounds = node.getBoundingClientRect(), css = getComputedStyle(node)
    nodes.push({ owner: index === 0 ? 'root' : node.tagName.toLowerCase() + ':' + index, ...identity(node),
      focused: document.activeElement === node, focusVisible: node.matches(':focus-visible'), focusWithin: node.matches(':focus-within'),
      rect: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height },
      clientRects: [...node.getClientRects()].map(box => ({ left: box.left, top: box.top, width: box.width, height: box.height })),
      excluded: [bounds.width <= 0 && 'nonpositive-width', bounds.height <= 0 && 'nonpositive-height',
        css.visibility === 'hidden' && 'hidden', css.opacity === '0' && 'zero-opacity'].filter(Boolean),
      computed: Object.fromEntries(['outline', 'outline-style', 'outline-width', 'outline-color', 'outline-offset',
        'box-shadow', 'display', 'visibility', 'opacity', 'appearance', 'color', 'background-color',
        'border-top-width', 'border-top-color', '--clay', '--ant-line-width-focus', '--ant-color-primary-border',
        '--ant-color-primary', '--ant-control-outline', '--ant-control-outline-width'].map(name => [name, css.getPropertyValue(name)])) })
    if (bounds.width <= 0 || bounds.height <= 0 || css.visibility === 'hidden' || css.opacity === '0') continue
    const owner = index === 0 ? 'root' : node.tagName.toLowerCase() + ':' + index
    if (css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0) outlines.push({ owner, width: parseFloat(css.outlineWidth), color: css.outlineColor, offset: parseFloat(css.outlineOffset) })
    if (css.boxShadow !== 'none') {
      const sample = { owner, value: css.boxShadow, visible: shadowIsVisible(css.boxShadow) }
      shadowStyles.push(sample)
      if (sample.visible) shadows.push(sample)
    }
  }
  const select = root.closest('[data-ui-control="select"]')
  const status = /ant-(?:input|select)-status-(error|warning)/.exec(root.className)?.[1] || 'normal'
  return { id, focused: document.activeElement === element, focusVisible: element.matches(':focus-visible'), outlines, shadows, shadowStyles,
    rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
    disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true' || root.classList.contains('ant-select-disabled'),
    // A non-searchable Select's internal search input is readOnly by design;
    // that is not a public read-only field state. Its value belongs to the host.
    readOnly: select ? false : !!element.readOnly,
    status, value: select ? JSON.parse(select.dataset.uiValue) : element.value,
    diagnostics: { activeElement: identity(document.activeElement), documentHasFocus: document.hasFocus(),
      visibilityState: document.visibilityState, nodes },
    hit: hit === root || root.contains(hit),
    inViewport: rect.top >= -1 && rect.left >= -1 && rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1 }
}

function selectStateSnapshot(id) {
  const node = document.getElementById(id), owner = node.closest('[data-ui-control="select"]')
  const listId = node.getAttribute('aria-controls') || node.getAttribute('aria-owns'), list = listId && document.getElementById(listId)
  const state = { expanded: node.getAttribute('aria-expanded') === 'true', optionsAvailable: !!list?.querySelector('[data-ui-option-value]'),
    value: JSON.parse(owner.dataset.uiValue), focused: document.activeElement === node, popup: null }
  // virtual=false binds aria-controls to the actual option list, including in dialogs.
  const popup = list?.getAttribute('role') === 'listbox' && list.closest('.ant-select-dropdown')
  const option = popup && [...list.querySelectorAll('[role="option"]')].find(item =>
    item.getAttribute('aria-disabled') !== 'true' && item.querySelector('[data-ui-option-value]'))
  if (!popup || !option) return state
  const bounds = element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
  }
  const root = bounds(popup), content = bounds(list), item = bounds(option), ancestors = []
  for (let element = option; element; element = element.parentElement) {
    const css = getComputedStyle(element)
    ancestors.push({ tag: element.tagName.toLowerCase(), id: element.id, class: element.getAttribute('class'),
      display: css.display, visibility: css.visibility, opacity: css.opacity, pointerEvents: css.pointerEvents })
  }
  const positive = rect => Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0 &&
    rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight
  const visible = option.isConnected && [root, content, item].every(positive) &&
    ancestors.every(css => css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0)
  const inViewport = item.left >= 0 && item.top >= 0 && item.right <= innerWidth + 1 && item.bottom <= innerHeight + 1
  const point = { x: item.left + item.width / 2, y: item.top + item.height / 2 }
  const hit = visible && inViewport ? document.elementFromPoint(point.x, point.y) : null
  const ownedHit = !!hit && (hit === option || option.contains(hit))
  state.popup = { listId, class: popup.getAttribute('class'), optionId: option.id,
    optionValue: option.querySelector('[data-ui-option-value]').getAttribute('data-ui-option-value'),
    root, content, item, ancestors, visible, inViewport, point, ownedHit,
    hit: hit ? { tag: hit.tagName.toLowerCase(), id: hit.id, class: hit.getAttribute('class') } : null,
    ready: state.expanded && state.optionsAvailable && visible && inViewport && ownedHit }
  return state
}

function paintedPopupReader(read, paint) {
  let pending = null
  return async () => {
    const previous = pending, paintedBeforeRead = previous?.complete === true
    const sample = await read()
    if (!sample.expanded || !sample.optionsAvailable || !sample.popup?.ready) { pending = null; return sample }
    if (!pending) {
      const cycle = { complete: false }; pending = cycle
      // Do not await a renderer frame here: the original until deadline must keep advancing.
      Promise.resolve().then(paint).then(() => { cycle.complete = true }, error => { cycle.error = error })
    }
    if ('error' in pending) throw pending.error
    return { ...sample, popup: { ...sample.popup, paintFrames: pending === previous && paintedBeforeRead ? 2 : 0 } }
  }
}

async function main() {
  const { app, BrowserWindow, nativeImage } = require('electron')
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-results/ui-controls-render')
  const fixture = path.join(output, 'fixture'), reportFile = path.join(output, 'checks.json')
  fs.mkdirSync(output, { recursive: true })
  if (fs.existsSync(reportFile)) throw new Error('Refusing to overwrite previous native control evidence')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-ui-controls-'))
  app.setPath('userData', profile); app.setPath('sessionData', profile)
  const started = Date.now()
  const report = { schema: 1, scope: 'shared-controls-only', complete: false, status: 'starting',
    platform: process.platform, electron: process.versions.electron, chromium: process.versions.chrome,
    nativeInput: 'Electron sendInputEvent and Input.dispatchKeyEvent', backendExercised: false,
    syntheticRecords: true, isolatedProfile: true, cleanQuit: false, budgetMs: BUDGET_MS,
    runId: process.env.GITHUB_RUN_ID || null, attempt: process.env.GITHUB_RUN_ATTEMPT || null, scenes: [] }
  let win, quitting = false, verified = false
  const persist = () => fs.writeFileSync(reportFile, JSON.stringify({ ...report, elapsedMs: Date.now() - started }))
  const fail = error => {
    if (quitting) return
    quitting = true; report.status = 'failed'; report.error = String(error.message || error)
    report.errorDetails = failureDetails(error); persist()
    // Failure is never reported as a clean successful lifecycle.
    app.exit(1)
  }
  const watchdog = setTimeout(() => {
    report.status = 'timeout'; report.complete = false; report.cleanQuit = false; persist()
    app.exit(1)
  }, BUDGET_MS)
  app.on('window-all-closed', () => {})
  app.once('quit', (_event, exitCode) => {
    clearTimeout(watchdog)
    report.cleanQuit = verified && quitting && exitCode === 0
    report.complete = verified && exitCode === 0
    report.status = report.complete ? 'passed' : report.status === 'starting' ? 'incomplete' : report.status
    persist()
    if (!report.complete) process.exitCode = 1
  })
  persist()
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8'))
    assert.equal(manifest.schema, 1); assert.equal(manifest.scope, report.scope)
    const verifyFiles = (base, files) => {
      for (const [name, digest] of Object.entries(files)) {
        const filename = path.resolve(base, name)
        assert.ok(filename.startsWith(base + path.sep), 'Manifest path must remain inside its source root')
        assert.equal(hash(fs.readFileSync(filename)), digest, 'Stale fixture source or bundle: ' + name)
      }
    }
    verifyFiles(root, manifest.sources); verifyFiles(fixture, manifest.artifacts)
    report.version = manifest.version; report.identity = manifest
    report.manifestSha256 = hash(fs.readFileSync(path.join(fixture, 'manifest.json')))
    report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    assert.equal(report.commit, manifest.commit, 'Build and native execution must use the same commit')
    assert.equal(process.versions.electron, manifest.dependencies.electron, 'Use the committed Electron runtime')
    persist()
    await app.whenReady()
    win = new BrowserWindow({ width: 704, height: 455, useContentSize: true, show: false,
      autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false, partition: 'ui-controls-' + process.pid } })
    win.setMenu(null)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      let allowed = details.url.startsWith('data:')
      try { allowed ||= details.url.startsWith('file:') && path.resolve(fileURLToPath(details.url)).startsWith(fixture + path.sep) } catch {}
      callback({ cancel: !allowed })
    })
    win.webContents.on('render-process-gone', () => fail(Error('Renderer process ended before evidence completed')))
    win.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame) fail(Error('Fixture main-frame load failed: ' + code))
    })
    win.webContents.debugger.attach('1.3')
    const evaluate = (fn, value) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value) ?? ''})`)
    const readFocus = id => win.webContents.executeJavaScript(`(${focusSnapshot.toString()})(${JSON.stringify(id)}, ${hasVisibleBoxShadow.toString()})`)
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (read, accept, label) => {
      const deadline = Date.now() + 2500
      do { if (quitting) throw Error('Native run already failed'); const value = await read(); if (accept(value)) return value; await pause(25) } while (Date.now() < deadline)
      throw Error('Timed out waiting for ' + label)
    }
    const events = () => evaluate(() => window.__uiControlEvents || [])
    const inputKey = async (key, modifiers = 0) => {
      const definitions = { Tab: ['Tab', 9], Enter: ['Enter', 13], Escape: ['Escape', 27], F2: ['F2', 113],
        ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], Delete: ['Delete', 46], a: ['KeyA', 65] }
      const [code, virtual] = definitions[key], before = (await events()).length
      const event = { key, code, modifiers, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual }
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...event,
        ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) })
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
      const observed = await until(events, list => list.slice(before).some(item => item.type === 'keydown' && item.key === key && item.trusted), 'trusted ' + key)
      return { trusted: observed.slice(before).some(item => item.type === 'keydown' && item.key === key && item.trusted) }
    }
    const click = async (selector, disabled = false) => {
      await evaluate(selector => {
        let node = document.querySelector(selector); if (!node) throw Error('Missing ' + selector)
        if (node.matches('[role="combobox"]')) node = node.closest('.ant-select').querySelector('.ant-select-content') || node.closest('.ant-select')
        node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      }, selector)
      const point = await evaluate(selector => {
        let node = document.querySelector(selector)
        if (node.matches('[role="combobox"]')) node = node.closest('.ant-select').querySelector('.ant-select-content') || node.closest('.ant-select')
        const rect = node.getBoundingClientRect()
        const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2), hit = document.elementFromPoint(x, y)
        return { x, y, visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1,
          hit: hit === node || node.contains(hit) }
      }, selector)
      assert.ok(point.visible && point.hit, 'Pointer target must be visible and unobscured: ' + selector)
      const before = (await events()).length
      win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
      win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      if (!disabled) await until(events, list => list.slice(before).some(item => item.type === 'click' && item.trusted), 'trusted pointer click')
      else await pause(40)
      return { trusted: (await events()).slice(before).some(item => ['mousemove', 'mousedown', 'click'].includes(item.type) && item.trusted), point }
    }
    const settle = async selector => {
      await until(() => evaluate(selector => {
        const node = document.querySelector(selector)
        if (!node) throw Error('Missing painted target: ' + selector)
        const root = node.closest('.ant-input-affix-wrapper, .ant-select') || node
        return root.getAnimations({ subtree: true }).filter(animation => animation.pending || animation.playState === 'running').length
      }, selector), count => count === 0, 'settled actual target ' + selector)
      await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
    }
    const scrollTarget = selector => evaluate(selector => {
      const node = document.querySelector(selector)
      if (!node) throw Error('Missing actual scroll target: ' + selector)
      node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    }, selector)
    const movePointer = async selector => {
      const point = await evaluate(selector => {
        const node = document.querySelector(selector)
        if (!node) throw Error('Missing actual hover target: ' + selector)
        const rect = node.getBoundingClientRect(), x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2)
        const hit = document.elementFromPoint(x, y)
        return { x, y, hit: hit === node || node.contains(hit), width: rect.width, height: rect.height,
          inViewport: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight }
      }, selector)
      assert.ok(point.width > 0 && point.height > 0 && point.hit && point.inViewport, 'Actual hover target must be hit-testable: ' + selector)
      const before = (await events()).length
      win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
      await until(events, list => list.slice(before).some(event => event.type === 'mousemove' && event.trusted), 'trusted native hover ' + selector)
      await settle(selector)
      return { point, trusted: (await events()).slice(before).some(event => event.type === 'mousemove' && event.trusted) }
    }
    const selectState = id => evaluate(selectStateSnapshot, id)
    const opened = async id => {
      const receipt = { id, complete: false }; report.scenes.at(-1).popups.push(receipt)
      const read = paintedPopupReader(() => selectState(id), () => evaluate(() =>
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))))
      const state = await until(async () => { receipt.sample = await read(); return receipt.sample },
        sample => sample.expanded && sample.optionsAvailable && sample.popup?.ready && sample.popup.paintFrames === 2, id + ' rendered popup')
      receipt.complete = true; persist(); return state
    }
    const closed = id => until(() => selectState(id), state => !state.expanded, id + ' collapsed')
    const choose = async (id, value) => {
      await click('#' + id + ''); await opened(id)
      const selector = await evaluate(({ id, value }) => {
        const node = document.getElementById(id), listId = node.getAttribute('aria-controls') || node.getAttribute('aria-owns')
        if (!listId || !document.getElementById(listId)) throw Error('Select must own its real listbox')
        return '#' + CSS.escape(listId) + ' [data-ui-option-value="' + value + '"]'
      }, { id, value })
      await click(selector)
      await until(() => selectState(id), state => !state.expanded && state.value === value, id + ' selected value')
    }
    const capture = async (scene, suffix, diagnostic = false, beforeCapture) => {
      await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
      if (beforeCapture) await beforeCapture()
      const image = await win.capturePage(), bytes = image.toPNG(), decoded = nativeImage.createFromBuffer(bytes)
      assert.ok(!decoded.isEmpty() && bytes.length > 100, 'Native PNG required')
      const name = scene.name + '-' + suffix + '.png'
      fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' })
      const receipt = { name, bytes: bytes.length, sha256: hash(bytes), ...decoded.getSize() }
      if (!diagnostic) scene.images.push(receipt)
      persist(); return receipt
    }
    const parkPointer = async () => {
      if (!await evaluate(() => document.getElementById('native-pointer-neutral').matches(':hover'))) await movePointer('#native-pointer-neutral')
    }
    const feedbackCapture = async (scene, suffix) => {
      const receipt = await capture(scene, 'feedback-' + suffix, true)
      scene.feedback.images.push(receipt); persist(); return receipt
    }
    const collectPointer = async (scene, spec, domId = spec.id) => {
      const selector = '[id=' + JSON.stringify(domId) + ']', record = { id: spec.id, domId, executionComplete: false }
      scene.feedback.pointer.push(record); persist()
      await scrollTarget(selector); await click('#native-pointer-neutral'); await settle(selector)
      record.before = await readFocus(domId); persist()
      const receipt = await click(selector, spec.disabled)
      await settle(selector)
      if (!spec.disabled) await until(() => readFocus(domId), sample => sample.focused, spec.id + ' pointer focus')
      record.after = await readFocus(domId); record.trustedPointer = receipt.trusted; persist()
      if (['pointer-normal-input', 'pointer-error-password', 'pointer-warning-textarea-clear', 'pointer-normal-select', 'name-dialog-rename'].includes(spec.id)) {
        record.pointerImage = await feedbackCapture(scene, spec.id + '-pointer')
      }
      if (!spec.disabled) {
        if (spec.kind === 'select') { await inputKey('Escape'); await closed(domId) }
        // Leave and return by native Tab traversal. Never programmatically focus
        // a field or change its tabIndex to manufacture keyboard evidence.
        await inputKey('Tab', 8); await inputKey('Tab')
        await until(() => readFocus(domId), sample => sample.focused && sample.focusVisible, spec.id + ' native keyboard return')
        await settle(selector); record.keyboard = await readFocus(domId)
      }
      record.executionComplete = true; persist()
      return record
    }
    const collectHover = async (scene, spec) => {
      const selector = '#hover-workspace ' + spec.selector
      const targetSelector = selector + (spec.target ? ' ' + spec.target : '')
      const record = { id: spec.id, executionComplete: false }; scene.feedback.hover.push(record); persist()
      await parkPointer(); await scrollTarget(selector); await parkPointer()
      if (spec.baseHover) await movePointer(selector + ' .icon')
      await settle(selector); record.before = await evaluate(hoverSnapshot, spec); persist()
      if (['nav-unselected', 'note-long', 'collapsed-unselected'].includes(spec.id)) record.beforeImage = await feedbackCapture(scene, spec.id + '-before')
      const receipt = await movePointer(targetSelector)
      record.hover = await evaluate(hoverSnapshot, spec); record.trustedPointer = receipt.trusted; persist()
      if (record.beforeImage) record.hoverImage = await feedbackCapture(scene, spec.id + '-hover')
      if (spec.baseHover) await movePointer(selector + ' .icon')
      else await parkPointer()
      await settle(selector); record.out = await evaluate(hoverSnapshot, spec)
      record.executionComplete = true; persist()
    }
    const collectFeedback = async scene => {
      scene.feedback = { scope: 'production-components-with-readonly-synthetic-files', backendExercised: false,
        pointer: [], hover: [], images: [], libraryRequests: [], nameDialog: {}, treeFlow: { executionComplete: false }, failures: [], executionComplete: false, passed: false }
      persist()
      for (const spec of POINTER_CASES.filter(spec => spec.id !== 'name-dialog-rename')) await collectPointer(scene, spec)
      await until(() => evaluate(() => JSON.parse(document.getElementById('hover-fixture-output').textContent).loadedIds),
        ids => ids.length === 7 && new Set(ids).size === 7, 'actual FileList read-only synthetic records')
      await click('#file-tree-item-hover-folder .icon')
      await until(() => evaluate(() => document.getElementById('file-tree-item-hover-folder').getAttribute('aria-expanded')), value => value === 'true', 'actual folder expansion')
      for (const spec of HOVER_CASES.filter(spec => !spec.collapsed)) await collectHover(scene, spec)

      // Exercise the production rename entry and cancel path without saving.
      await click('#file-tree-item-hover-selected .icon'); await settle('#hover-workspace .tree-list')
      const renameFlow = scene.feedback.treeFlow.rename = { before: await evaluate(treeStateSnapshot), executionComplete: false }
      renameFlow.trustedOpen = (await inputKey('F2')).trusted
      const nameBefore = await until(() => evaluate(() => {
        const input = document.querySelector('.name-dialog input.name-dialog-input')
        return input && { id: input.id, value: input.value, suffix: document.querySelector('.name-dialog .static-ext')?.textContent,
          dialog: { role: document.querySelector('.name-dialog').getAttribute('role'), title: document.getElementById('name-dialog-title').textContent } }
      }), value => value && value.value === '已选中的笔记', 'actual FileList rename dialog')
      renameFlow.dialog = nameBefore.dialog
      scene.feedback.nameDialog = { valueBefore: nameBefore.value, suffixBefore: nameBefore.suffix, cancelled: false }; persist()
      // The modal overlay intentionally covers the neutral corner; blur through
      // its actual heading rather than clicking outside and cancelling it.
      const renameSpec = POINTER_CASES.find(spec => spec.id === 'name-dialog-rename')
      await click('#name-dialog-title')
      const selector = '[id=' + JSON.stringify(nameBefore.id) + ']'
      const rename = { id: renameSpec.id, domId: nameBefore.id, executionComplete: false }
      scene.feedback.pointer.push(rename); await settle(selector); rename.before = await readFocus(nameBefore.id); persist()
      const receipt = await click(selector); await settle(selector)
      rename.after = await readFocus(nameBefore.id); rename.trustedPointer = receipt.trusted
      rename.pointerImage = await feedbackCapture(scene, 'name-dialog-rename-pointer')
      await inputKey('Tab', 8); await inputKey('Tab')
      await until(() => readFocus(nameBefore.id), sample => sample.focused && sample.focusVisible, 'actual rename keyboard return')
      await settle(selector); rename.keyboard = await readFocus(nameBefore.id); rename.executionComplete = true
      const nameAfter = await evaluate(() => ({ value: document.querySelector('.name-dialog input.name-dialog-input').value,
        suffix: document.querySelector('.name-dialog .static-ext')?.textContent }))
      Object.assign(scene.feedback.nameDialog, { valueAfter: nameAfter.value, suffixAfter: nameAfter.suffix }); persist()
      const renameCancel = await click('.name-dialog .modal-actions button[type="button"]')
      renameFlow.closed = await until(() => evaluate(() => !document.querySelector('.name-dialog')), Boolean, 'actual rename cancellation')
      await settle('#hover-workspace .tree-list'); renameFlow.after = await evaluate(treeStateSnapshot)
      renameFlow.trustedCancel = renameCancel.trusted; renameFlow.executionComplete = true
      scene.feedback.nameDialog.cancelled = renameFlow.closed; persist()
      // Preserve the original cancellation observation. A failing old build may
      // be clicked again to continue independent key traversal, never silently
      // focused by script or certified by the later successful observation.
      const recovery = scene.feedback.treeFlow.renameRecovery = { needed: !renameFlow.after.treeFocused, usedNativeClick: false }
      if (recovery.needed) {
        const actualClick = await click('#file-tree-item-hover-selected .icon')
        recovery.usedNativeClick = true; recovery.trustedPointer = actualClick.trusted
        await settle('#hover-workspace .tree-list')
      }
      recovery.after = await evaluate(treeStateSnapshot); persist()
      const navigation = scene.feedback.treeFlow.navigation = { before: await evaluate(treeStateSnapshot), executionComplete: false }
      navigation.downTrusted = (await inputKey('ArrowDown')).trusted
      await settle('#hover-workspace .tree-list'); navigation.down = await evaluate(treeStateSnapshot)
      navigation.upTrusted = (await inputKey('ArrowUp')).trusted
      await settle('#hover-workspace .tree-list'); navigation.up = await evaluate(treeStateSnapshot)
      navigation.executionComplete = true; persist()
      const deleteFlow = scene.feedback.treeFlow.delete = { before: await evaluate(treeStateSnapshot), executionComplete: false }
      deleteFlow.trustedOpen = (await inputKey('Delete')).trusted
      deleteFlow.dialog = await until(() => evaluate(() => {
        const dialog = document.querySelector('.consumer-confirm-modal')
        if (!dialog) return null
        return { role: dialog.getAttribute('role'), title: document.getElementById('consumer-confirm-title').textContent,
          message: document.getElementById('consumer-confirm-description').textContent,
          buttons: [...dialog.querySelectorAll('button')].map(button => button.textContent.trim()),
          focusedButton: dialog.contains(document.activeElement) ? document.activeElement.textContent.trim() : null }
      }), value => value?.focusedButton === '移到回收站', 'actual keyboard delete confirmation')
      persist()
      const deleteCancel = await click('.consumer-confirm-modal .modal-actions button:first-child')
      deleteFlow.closed = await until(() => evaluate(() => !document.querySelector('.consumer-confirm-modal')), Boolean, 'actual delete cancellation')
      await settle('#hover-workspace .tree-list'); deleteFlow.after = await evaluate(treeStateSnapshot)
      deleteFlow.trustedCancel = deleteCancel.trusted; deleteFlow.executionComplete = true
      scene.feedback.treeFlow.executionComplete = true; persist()
      await click('#hover-workspace .workspace-sidebar-collapse')
      await until(() => evaluate(() => JSON.parse(document.getElementById('hover-fixture-output').textContent).collapsed), Boolean, 'actual collapsed sidebar')
      for (const spec of HOVER_CASES.filter(spec => spec.collapsed)) await collectHover(scene, spec)
      scene.feedback.libraryRequests = await evaluate(() => window.__uiLibraryRequests)
      scene.feedback.executionComplete = true; persist()
    }
    for (const theme of ['light', 'dark']) for (const [width, height] of VIEWPORTS) {
      const scene = { name: `${theme}-${width}x${height}`, theme, requested: [width, height], complete: false,
        focus: [], images: [], popups: [], interaction: {}, form: {}, modal: {}, toolbar: {}, errors: [] }
      report.scenes.push(scene); report.status = 'running'; persist()
      win.setContentSize(width, height)
      await win.loadFile(path.join(fixture, 'fixture.html'), { query: { theme } })
      win.show(); win.focus(); win.webContents.focus()
      await until(() => evaluate(() => document.documentElement.dataset.uiControlReady), value => value === 'true', 'real components mounted')
      await evaluate(() => document.fonts.ready.then(() => true))
      await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
      scene.geometry = await evaluate(geometrySnapshot); scene.viewport = scene.geometry.viewport
      assert.deepEqual(scene.viewport, { width, height }, 'Requested native viewport was clamped')
      verifyGeometry(scene.geometry); persist()
      await click('#focus-start')
      for (const density of Object.keys(HEIGHTS)) {
        for (const kind of KINDS) {
          await inputKey('Tab')
          // The real Password includes its own keyboard-accessible eye button.
          // Traverse it normally instead of changing the component's tab order.
          const passwordIcon = await evaluate(() => document.activeElement?.matches('.ant-input-password-icon'))
          if (passwordIcon) { assert.equal(kind, 'select'); await inputKey('Tab') }
          const id = `${density}-${kind}`
          const focused = await until(() => readFocus(id), sample => sample.focused && sample.focusVisible, id + ' keyboard focus')
          await recordFocusEvidence(scene, focused, persist, async () => {
            scene.focusFailure.styles = await captureMatchedFocusStyles(win.webContents.debugger, id, (kind, response) => {
              const name = `${scene.name}-${id}-focus-${kind}.json`, bytes = Buffer.from(JSON.stringify(response))
              fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' })
              return { name, bytes: bytes.length, sha256: hash(bytes) }
            }); persist()
            try { scene.focusFailure.animations = await evaluate(focusAnimationSnapshot, id) }
            catch (error) { scene.focusFailure.animationError = failureDetails(error) }
            persist()
            const image = await capture(scene, id + '-focus-failure', true)
            // A later paint observation is diagnostic only. The first sample
            // and its failed assertion remain authoritative and still throw.
            try { scene.focusFailure.afterCapture = await readFocus(id) }
            catch (error) { scene.focusFailure.afterCaptureError = failureDetails(error) }
            return image
          })
        }
        await capture(scene, density + '-focus')
      }

      await choose('ordinary-select', 'beta')
      const selected = await evaluate(() => JSON.parse(document.getElementById('selection-output').textContent))
      assert.equal(selected.values.ordinary, 'beta'); assert.equal(selected.changes.ordinary, 1)
      await click('#ordinary-select'); await opened('ordinary-select'); await capture(scene, 'popup')
      await click('#ordinary-select'); await closed('ordinary-select')
      await inputKey('ArrowDown'); await opened('ordinary-select')
      await inputKey('Escape'); const escaped = await closed('ordinary-select')
      assert.equal(escaped.value, 'beta'); assert.equal(escaped.focused, true)
      await inputKey('ArrowDown'); await opened('ordinary-select'); await inputKey('ArrowDown'); await inputKey('Enter')
      const keyboardChoice = await closed('ordinary-select')
      assert.equal(keyboardChoice.value, 'gamma'); assert.equal(keyboardChoice.focused, true)
      const committed = await evaluate(() => JSON.parse(document.getElementById('selection-output').textContent))
      assert.equal(committed.changes.ordinary, 2, 'One change per real selection')
      scene.interaction = { complete: true, pointerValue: 'beta', keyboardValue: keyboardChoice.value,
        repeatedPointerClosed: true, escapePreservedValueAndFocus: true, changes: committed.changes.ordinary }

      await click('#long-clear')
      await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
      scene.toolbar = await evaluate(toolbarSnapshot)
      assert.ok(scene.toolbar.overflow <= 1 && scene.toolbar.longLabelLength > 20)
      for (const field of scene.toolbar.fields) assert.ok(Math.abs(field.height - 40) <= TOLERANCE && field.left >= 0 && field.right <= width + 1, 'Toolbar height and bounds')
      const tops = scene.toolbar.fields.map(field => field.top)
      if (width === 704) assert.ok(Math.max(...tops) - Math.min(...tops) > 40, 'Narrow toolbar must wrap complete controls')
      else assert.ok(Math.max(...scene.toolbar.fields.map(field => field.bottom)) - Math.min(...scene.toolbar.fields.map(field => field.bottom)) <= TOLERANCE, 'Wide toolbar must align bottoms')
      scene.toolbar.complete = true
      await captureToolbarEvidence({ record: scene.toolbar, read: () => evaluate(toolbarSnapshot),
        capture: guard => capture(scene, 'toolbar', false, guard), persist, expected: scene })

      await click('#native-title'); await inputKey('a', 2)
      await win.webContents.debugger.sendCommand('Input.insertText', { text: 'edited' })
      await choose('native-mode', 'beta'); await choose('legend-mode', 'gamma')
      const disabled = await evaluate(() => ({ input: document.getElementById('blocked-title').matches(':disabled'),
        select: document.getElementById('blocked-mode').disabled, button: document.getElementById('blocked-submit').matches(':disabled'),
        legend: document.getElementById('legend-mode').disabled }))
      assert.deepEqual(disabled, { input: true, select: true, button: true, legend: false })
      await click('#blocked-submit', true)
      assert.equal(await evaluate(() => JSON.parse(document.getElementById('form-output').textContent).submissions.length), 0)
      await click('#native-submit')
      const form = await until(() => evaluate(() => JSON.parse(document.getElementById('form-output').textContent)), value => value.submissions.length === 1, 'real form submit')
      assert.deepEqual(form.submissions[0], { title: 'edited', mode: 'beta', legendMode: 'gamma' })
      await click('#native-reset')
      await until(() => selectState('native-mode'), value => value.value === 'alpha', 'native form reset')
      assert.equal(await evaluate(() => document.getElementById('native-title').value), 'original')
      await click('#native-submit')
      const reset = await until(() => evaluate(() => JSON.parse(document.getElementById('form-output').textContent)), value => value.submissions.length === 2, 'submit after reset')
      assert.deepEqual(reset.submissions[1], { title: 'original', mode: 'alpha', legendMode: 'alpha' }); assert.equal(reset.resets, 1)
      const colors = await evaluate(() => ({ normal: getComputedStyle(document.getElementById('native-title')).borderTopColor,
        input: getComputedStyle(document.getElementById('error-input')).borderTopColor,
        select: getComputedStyle(document.getElementById('error-select').closest('.ant-select')).borderTopColor }))
      assert.notEqual(colors.input, colors.normal); assert.equal(colors.input, colors.select)
      scene.form = { complete: true, disabled, colors, ...reset }; await capture(scene, 'form')

      await click('#open-modal')
      await until(() => evaluate(() => !!document.getElementById('probe-modal')), Boolean, 'real focus hook dialog')
      await click('#modal-select'); await opened('modal-select'); await capture(scene, 'modal-popup')
      await inputKey('Escape'); await closed('modal-select')
      assert.equal(await evaluate(() => !!document.getElementById('probe-modal')), true, 'First Escape belongs to expanded Select')
      await inputKey('Escape')
      await until(() => evaluate(() => !document.getElementById('probe-modal')), Boolean, 'second Escape closes dialog')
      assert.equal(await evaluate(() => document.activeElement?.id), 'open-modal', 'Native modal cleanup returns trigger focus')
      assert.equal(await evaluate(() => Number(document.getElementById('modal-output').textContent)), 1)
      scene.modal = { complete: true, firstEscapeKeptDialog: true, secondEscapeClosed: true, focusReturned: true, closeCount: 1 }
      await collectFeedback(scene)
      scene.events = await events(); scene.errors = await evaluate(() => window.__uiControlErrors)
      assert.equal(scene.errors.length, 0)
      scene.complete = true; persist()
    }
    verifyScenes(report.scenes)
    // Capture every matrix first. The accepted baseline must retain both the
    // outside focus border and hover-shift observations before rejection.
    report.feedbackFailures = collectFeedbackFailures(report.scenes)
    for (const scene of report.scenes) {
      scene.feedback.failures = report.feedbackFailures.filter(failure => failure.scene === scene.name)
      scene.feedback.passed = scene.feedback.failures.length === 0
    }
    persist()
    verifyFeedbackScenes(report.scenes)
    verified = true; quitting = true; report.status = 'quitting'; persist()
    win.webContents.debugger.detach()
    app.quit()
  } catch (error) { fail(error) }
}

module.exports = { verifyGeometry, verifyFocus, verifyScenes, hasVisibleBoxShadow, HEIGHTS, VIEWPORTS, BUDGET_MS,
  failureDetails, recordFocusEvidence, captureMatchedFocusStyles, selectStateSnapshot, paintedPopupReader,
  toolbarSnapshot, verifyToolbarSnapshot, verifyToolbarContinuity, captureToolbarEvidence,
  POINTER_CASES, HOVER_CASES, STABILITY_TOLERANCE, focusSnapshot, hoverSnapshot,
  verifyPointerFeedback, verifyHoverFeedback, treeStateSnapshot, verifyTreeCancel, verifyTreeNavigation, collectFeedbackFailures, verifyFeedbackScenes }
// Electron 31's ESM default_app imports the CLI file, so require.main does not
// identify it. Only the actual browser-process CLI entry may start this runner;
// importing the exported evidence helpers must remain side-effect free.
const electronEntry = process.versions.electron && process.type === 'browser' && process.defaultApp === true &&
  process.argv[1] && path.resolve(process.argv[1]) === __filename
if (require.main === module || electronEntry) main().catch(error => {
  console.error(error)
  if (process.versions.electron) require('electron').app.exit(1)
  else process.exitCode = 1
})
