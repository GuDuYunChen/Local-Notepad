// Refusal contracts for the baseline wrapper, not real native UI evidence.
// The CLI always reimports the copied current checker and revalidates its raw
// samples. Injected validators below isolate the wrapper's envelope decisions.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { BASELINE_PRODUCT_COMMIT, BASELINE_PRODUCT_TREE, BASELINE_PRODUCT_VERSION,
  VERIFIER_RUNTIME_FILES, NATIVE_BUDGET_MS, parseGitStatus, assertAllowedVerifierChanges,
  assertSourceIdentity, safeEvidenceFile, verifyPngReceipt, assessNativeRejection } from './ui-feedback-baseline.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const rect = () => ({ left: 10, top: 20, right: 210, bottom: 60, width: 200, height: 40 })
function statusSample(id, status, focused) {
  return { id, status, focused, focusVisible: focused, hit: true, inViewport: true,
    disabled: false, readOnly: false, value: 'synthetic', rect: rect(), outlines: [], shadows: [],
    diagnostics: { documentHasFocus: true, visibilityState: 'visible', nodes: [{ owner: 'root',
      class: 'ant-input ant-input-status-' + status, rect: rect(), focusWithin: focused, excluded: [],
      computed: { 'outline-style': 'none', 'outline-width': '0px', 'outline-offset': '2px',
        'box-shadow': 'none', 'border-top-width': '1px', 'border-top-color': 'rgb(255, 0, 0)' } }] } }
}
function fixture() {
  const identity = { platform: 'win32', baselineCommit: BASELINE_PRODUCT_COMMIT,
    baselineTree: BASELINE_PRODUCT_TREE, baselineVersion: BASELINE_PRODUCT_VERSION,
    verifierCommit: 'a'.repeat(40), candidateCommit: 'a'.repeat(40), baselineShallow: false,
    candidateShallow: false, runId: '123456', attempt: '1' }
  const scenes = ['light', 'dark'].flatMap(theme => [[704, 455], [1280, 800], [1920, 1080]].map(([width, height]) => ({
    name: `${theme}-${width}x${height}`, theme, requested: [width, height], viewport: { width, height }, complete: true,
    feedback: { scope: 'production-components-with-readonly-synthetic-files', backendExercised: false,
      executionComplete: true, pointer: [{}], hover: [{}], images: [{}] },
  })))
  const feedbackFailures = ['focus-outline-outside', 'hover-geometry'].map((category, index) => ({
    scene: scenes[0].name, category, probeId: index ? 'note-long' : 'pointer-normal-input',
    stage: index ? 'hover' : 'focus', error: { name: 'AssertionError', message: 'Synthetic wrapper contract ' + category },
  }))
  return { identity, nativeProcess: { code: 1, signal: null, error: null, elapsedMs: 2000 }, manifestSha256: 'b'.repeat(64),
    report: { schema: 1, scope: 'shared-controls-only', platform: 'win32', status: 'failed', complete: false,
      cleanQuit: false, backendExercised: false, syntheticRecords: true, isolatedProfile: true,
      budgetMs: NATIVE_BUDGET_MS, elapsedMs: 1000, commit: BASELINE_PRODUCT_COMMIT, version: BASELINE_PRODUCT_VERSION,
      identity: { commit: BASELINE_PRODUCT_COMMIT, tree: BASELINE_PRODUCT_TREE, version: BASELINE_PRODUCT_VERSION },
      runId: identity.runId, attempt: identity.attempt, manifestSha256: 'b'.repeat(64),
      errorDetails: { code: 'UI_FEEDBACK_REGRESSIONS' }, scenes, feedbackFailures } }
}
function assess(input, overrides = {}) {
  const failures = structuredClone(input.report.feedbackFailures)
  return assessNativeRejection(input, {
    verifyScenes: scenes => assert.equal(scenes.length, 6),
    verifyFeedbackScenes() { const error = Error('Synthetic wrapper contract'); error.code = 'UI_FEEDBACK_REGRESSIONS'; error.failures = failures; throw error },
    ...overrides,
  })
}
function addStatusFailure(input, status = 'error', kind = 'input') {
  const probeId = `pointer-${status}-${kind}`, domId = 'actual-' + probeId
  input.report.scenes[0].feedback.pointer.push({ id: probeId, domId, executionComplete: true, trustedPointer: true,
    before: statusSample(domId, status, false), after: statusSample(domId, status, true), keyboard: statusSample(domId, status, true) })
  input.report.feedbackFailures.push({ scene: input.report.scenes[0].name, category: 'focus-decoration', probeId, stage: 'focus',
    error: { name: 'AssertionError', message: probeId + ': pointer must retain one visible root focus cue', actual: [],
      expected: 'one visible root outline', operator: 'native-feedback' } })
  return input.report.scenes[0].feedback.pointer.at(-1)
}
function addTextareaClearFailure(input) {
  const record = addStatusFailure(input, 'normal', 'textarea-clear')
  for (const sample of [record.before, record.after, record.keyboard]) {
    const root = sample.diagnostics.nodes[0]
    root.tag = 'span'; root.class = 'app-ui-input ant-input-affix-wrapper ant-input-textarea-affix-wrapper ant-input-textarea-allow-clear'
    const child = (owner, tag, id, className, box) => ({ owner, tag, id, class: className, rect: box, excluded: [],
      focused: tag === 'textarea' && sample.focused,
      computed: { ...root.computed, visibility: 'visible', opacity: '1', display: 'inline-block' } })
    sample.diagnostics.nodes.push(child('textarea:1', 'textarea', record.domId, 'ant-input',
      { left: 20, top: 27, right: 190, bottom: 53, width: 170, height: 26 }))
    sample.diagnostics.nodes.push(child('button:3', 'button', '', 'ant-input-clear-icon',
      { left: 192, top: 32, right: 208, bottom: 48, width: 16, height: 16 }))
  }
  return record
}
function addTreeFocusFailures(input) {
  const state = (focused, descendant = 'file-tree-item-hover-selected') => ({ treeFocused: focused,
    activeElement: { tag: focused ? 'DIV' : 'BODY', id: null }, activeDescendant: descendant,
    selectedId: 'hover-selected', selectedIds: ['hover-selected'],
    visibleIds: ['hover-folder', 'hover-nested', 'hover-nested-next', 'hover-long', 'hover-selected', 'hover-short', 'hover-last'],
    loadedIds: ['hover-folder', 'hover-nested', 'hover-nested-next', 'hover-long', 'hover-selected', 'hover-short', 'hover-last'] })
  const dialog = title => ({ before: state(true), after: state(false), dialog: { role: 'dialog', title },
    trustedOpen: true, trustedCancel: true, closed: true, executionComplete: true })
  const feedback = input.report.scenes[0].feedback
  const flow = feedback.treeFlow = { executionComplete: true, rename: dialog('重命名笔记'), delete: dialog('移到回收站？'),
    renameRecovery: { needed: true, usedNativeClick: true, trustedPointer: true, after: state(true) },
    navigation: { before: state(true), downTrusted: true, down: state(true, 'file-tree-item-hover-short'),
      upTrusted: true, up: state(true), executionComplete: true } }
  Object.assign(flow.delete.dialog, { message: '“已选中的笔记.md”会移到回收站，30 天内可以恢复。',
    buttons: ['取消', '移到回收站'], focusedButton: '移到回收站' })
  feedback.libraryRequests = [{ accepted: true, method: 'GET', path: '/api/files' }]
  feedback.nameDialog = { cancelled: true, valueBefore: '已选中的笔记', valueAfter: '已选中的笔记', suffixBefore: '.md', suffixAfter: '.md' }
  for (const kind of ['rename', 'delete']) {
    const probeId = `tree-${kind}-cancel`
    input.report.feedbackFailures.push({ scene: input.report.scenes[0].name, category: 'tree-focus-return', probeId, stage: 'tree',
      error: { name: 'AssertionError', message: probeId + ': cancellation did not return focus to its tree item',
        actual: structuredClone(flow[kind].after), expected: structuredClone(flow[kind].before), operator: 'native-feedback' } })
  }
  return flow
}

test('complete expected rejection is negative evidence and never product acceptance', () => {
  const input = fixture(), before = structuredClone(input), result = assess(input)
  assert.equal(result.productAcceptance, false); assert.equal(result.baselineProductPassed, false)
  assert.equal(result.originalScenesRevalidated, 6); assert.equal(result.failureCount, 2)
  assert.deepEqual(result.expectedCategories, ['focus-outline-outside', 'hover-geometry'])
  assert.deepEqual(input, before, 'Assessing evidence must not rewrite the raw failure')
})

for (const [name, mutate] of [
  ['different baseline commit', input => { input.identity.baselineCommit = 'c'.repeat(40) }],
  ['different baseline tree', input => { input.identity.baselineTree = 'c'.repeat(40) }],
  ['relabeled baseline version', input => { input.identity.baselineVersion = '4.249.1' }],
  ['non-Windows run', input => { input.identity.platform = 'linux' }],
  ['wrong verifier commit', input => { input.identity.candidateCommit = 'c'.repeat(40) }],
  ['absent verifier commit', input => { delete input.identity.verifierCommit }],
  ['shallow baseline', input => { input.identity.baselineShallow = true }],
  ['shallow verifier', input => { input.identity.candidateShallow = true }],
  ['absent run identity', input => { delete input.identity.runId }],
  ['invalid run attempt', input => { input.identity.attempt = '0' }],
]) test('refuses ' + name, () => { const input = fixture(); mutate(input); assert.throws(() => assertSourceIdentity(input.identity)) })

for (const [name, mutate] of [
  ['native success', input => { input.nativeProcess.code = 0 }],
  ['other native exit', input => { input.nativeProcess.code = 2 }],
  ['killed process', input => { input.nativeProcess.signal = 'SIGTERM' }],
  ['native timeout', input => { input.nativeProcess.error = { code: 'ETIMEDOUT' } }],
  ['missing executable', input => { input.nativeProcess.error = { code: 'ENOENT' } }],
  ['over-budget process', input => { input.nativeProcess.elapsedMs = NATIVE_BUDGET_MS + 1 }],
  ['unmeasured process', input => { input.nativeProcess.elapsedMs = 0 }],
  ['invalid elapsed time', input => { input.nativeProcess.elapsedMs = NaN }],
  ['report claiming success', input => { input.report.status = 'passed' }],
  ['timeout report', input => { input.report.status = 'timeout' }],
  ['complete baseline report', input => { input.report.complete = true }],
  ['invented clean lifecycle', input => { input.report.cleanQuit = true }],
  ['report platform mismatch', input => { input.report.platform = 'linux' }],
  ['changed native budget', input => { input.report.budgetMs++ }],
  ['over-budget report', input => { input.report.elapsedMs = NATIVE_BUDGET_MS + 1 }],
  ['other report commit', input => { input.report.commit = 'c'.repeat(40) }],
  ['other manifest tree', input => { input.report.identity.tree = 'c'.repeat(40) }],
  ['other report version', input => { input.report.version = '4.249.1' }],
  ['other run', input => { input.report.runId += '1' }],
  ['other run attempt', input => { input.report.attempt = '2' }],
  ['other manifest', input => { input.report.manifestSha256 = 'c'.repeat(64) }],
  ['backend use in fixture', input => { input.report.backendExercised = true }],
  ['real records', input => { input.report.syntheticRecords = false }],
  ['nonisolated profile', input => { input.report.isolatedProfile = false }],
  ['unrelated assertion', input => { input.report.errorDetails.code = 'ERR_ASSERTION' }],
  ['missing rejection code', input => { delete input.report.errorDetails.code }],
  ['incomplete matrix', input => { input.report.scenes.pop() }],
  ['unfinished old scene', input => { input.report.scenes[0].complete = false }],
  ['unfinished new scene', input => { input.report.scenes[0].feedback.executionComplete = false }],
  ['wrong feedback scope', input => { input.report.scenes[0].feedback.scope = 'full-app' }],
  ['missing pointer samples', input => { input.report.scenes[0].feedback.pointer = [] }],
  ['missing hover samples', input => { input.report.scenes[0].feedback.hover = [] }],
  ['missing screenshots', input => { input.report.scenes[0].feedback.images = [] }],
  ['only one regression class', input => { input.report.feedbackFailures[1].category = 'focus-outline-outside' }],
  ['environment failure class', input => { input.report.feedbackFailures[1].category = 'native-evidence' }],
  ['unknown failure scene', input => { input.report.feedbackFailures[1].scene = 'invented' }],
  ['nonassertion UI failure', input => { input.report.feedbackFailures[1].error.name = 'TypeError' }],
  ['absent failure probe', input => { input.report.feedbackFailures[1].probeId = '' }],
  ['absent failure stage', input => { input.report.feedbackFailures[1].stage = '' }],
]) test('refuses ' + name + ' as a reproduced defect', () => { const input = fixture(); mutate(input); assert.throws(() => assess(input)) })

test('propagates every original gate failure without running new classification', () => {
  const original = new assert.AssertionError({ message: 'Original popup assertion failed' }); let newValidatorCalled = false
  assert.throws(() => assess(fixture(), { verifyScenes() { throw original }, verifyFeedbackScenes() { newValidatorCalled = true } }), error => error === original)
  assert.equal(newValidatorCalled, false)
})
test('refuses raw samples that pass or fail for an unrelated reason', () => {
  assert.throws(() => assess(fixture(), { verifyFeedbackScenes() { return { passed: true } } }), /Raw samples/)
  assert.throws(() => assess(fixture(), { verifyFeedbackScenes() { throw Error('Missing selector') } }), /Raw samples/)
})
test('refuses a report whose stored failures differ from independent raw recomputation', () => {
  const input = fixture(), failures = structuredClone(input.report.feedbackFailures)
  failures[0].error.message = 'Different raw observation'
  assert.throws(() => assess(input, { verifyFeedbackScenes() { const error = Error('recomputed'); error.code = 'UI_FEEDBACK_REGRESSIONS'; error.failures = failures; throw error } }), /disagree/)
})

test('permits the documented status outline-zero only alongside both reported defects', () => {
  for (const status of ['error', 'warning']) {
    const input = fixture(); addStatusFailure(input, status)
    assert.equal(assess(input).knownFocusDecorationFailures[0].reason, 'accepted-antd-status-outline-zero')
    input.report.feedbackFailures.splice(1, 1)
    assert.throws(() => assess(input), /Both reported defect classes/)
  }
})
for (const [name, mutate] of [
  ['normal textarea', (input, record) => { input.report.feedbackFailures.at(-1).probeId = record.id = 'pointer-normal-textarea-clear' }],
  ['unrelated probe', (input, record) => { input.report.feedbackFailures.at(-1).probeId = record.id = 'name-dialog-rename' }],
  ['changed status', (_input, record) => { record.after.status = 'normal' }],
  ['disabled field', (_input, record) => { record.after.disabled = true }],
  ['read-only field', (_input, record) => { record.after.readOnly = true }],
  ['missing native pointer', (_input, record) => { record.trustedPointer = false }],
  ['unfinished observation', (_input, record) => { record.executionComplete = false }],
  ['blurred field', (_input, record) => { record.after.focused = false }],
  ['obscured field', (_input, record) => { record.after.hit = false }],
  ['offscreen field', (_input, record) => { record.after.inViewport = false }],
  ['changed value', (_input, record) => { record.keyboard.value = 'different' }],
  ['moving field', (_input, record) => { record.after.rect.left++ }],
  ['missing node styles', (_input, record) => { delete record.after.diagnostics.nodes[0].computed }],
  ['missing node measurements', (_input, record) => { delete record.after.diagnostics.nodes[0].rect }],
  ['wrong root status', (_input, record) => { record.after.diagnostics.nodes[0].class = 'ant-input' }],
  ['nonzero outline', (_input, record) => { record.after.diagnostics.nodes[0].computed['outline-width'] = '2px' }],
  ['painted outline', (_input, record) => { record.after.outlines = [{ owner: 'root', width: 2 }] }],
  ['painted shadow', (_input, record) => { record.after.shadows = [{ owner: 'root', value: '0 0 0 2px red' }] }],
  ['keyboard failure', (_input, record) => { record.keyboard.focusVisible = false }],
  ['missing window focus', (_input, record) => { record.after.diagnostics.documentHasFocus = false }],
  ['missing original assertion', input => { input.report.feedbackFailures.at(-1).error.message = 'unrelated' }],
]) test('refuses status-focus exception for ' + name, () => { const input = fixture(), record = addStatusFailure(input); mutate(input, record); assert.throws(() => assess(input)) })

test('refuses status Select because it has no corresponding approved outline-reset cause', () => {
  for (const status of ['error', 'warning']) { const input = fixture(); addStatusFailure(input, status, 'select'); assert.throws(() => assess(input), /Unapproved focus-decoration/) }
})
test('permits only the measured original allowClear TextArea selector gap alongside both user defects', () => {
  const input = fixture(); addTextareaClearFailure(input)
  assert.equal(assess(input).knownFocusDecorationFailures[0].reason, 'accepted-affix-selector-omits-textarea')
  input.report.feedbackFailures.splice(0, 1)
  assert.throws(() => assess(input), /Both reported defect classes/)
})
for (const [name, mutate] of [
  ['ordinary normal input', (input, record) => { input.report.feedbackFailures.at(-1).probeId = record.id = 'pointer-normal-input' }],
  ['ordinary textarea', (input, record) => { input.report.feedbackFailures.at(-1).probeId = record.id = 'pointer-normal-textarea' }],
  ['missing official wrapper', (_input, record) => { record.after.diagnostics.nodes[0].class = 'app-ui-input' }],
  ['non-TextArea wrapper', (_input, record) => { record.after.diagnostics.nodes[0].class = 'app-ui-input ant-input-affix-wrapper' }],
  ['invented status class', (_input, record) => { record.after.diagnostics.nodes[0].class += ' ant-input-status-error' }],
  ['missing textarea', (_input, record) => { record.after.diagnostics.nodes[1].tag = 'input' }],
  ['different textarea owner', (_input, record) => { record.after.diagnostics.nodes[1].id = 'another-input' }],
  ['absent clear button', (_input, record) => { record.after.diagnostics.nodes.pop() }],
  ['imitated clear span', (_input, record) => { record.after.diagnostics.nodes[2].tag = 'span' }],
  ['hidden clear button', (_input, record) => { record.after.diagnostics.nodes[2].computed.visibility = 'hidden' }],
  ['zero clear button', (_input, record) => { record.after.diagnostics.nodes[2].rect.width = 0 }],
  ['moving textarea', (_input, record) => { record.after.diagnostics.nodes[1].rect.left++ }],
  ['moving clear button', (_input, record) => { record.keyboard.diagnostics.nodes[2].rect.left++ }],
  ['blurred inner textarea', (_input, record) => { record.after.diagnostics.nodes[1].focused = false }],
  ['inner visible outline', (_input, record) => { record.keyboard.diagnostics.nodes[1].computed['outline-width'] = '2px' }],
  ['outer visible outline', (_input, record) => { record.keyboard.diagnostics.nodes[0].computed['outline-width'] = '2px' }],
  ['painted shadow', (_input, record) => { record.after.shadows.push({ owner: 'root', value: '0 0 2px blue' }) }],
  ['incomplete native sample', (_input, record) => { record.executionComplete = false }],
]) test('refuses old allowClear exception for ' + name, () => { const input = fixture(), record = addTextareaClearFailure(input); mutate(input, record); assert.throws(() => assess(input)) })

test('retains both original cancellation focus losses and separately verified native recovery', () => {
  const input = fixture(); addTreeFocusFailures(input)
  const before = structuredClone(input), result = assess(input)
  assert.equal(result.knownTreeFocusFailures.length, 2)
  assert.ok(result.knownTreeFocusFailures.every(item => item.originalFailurePreserved && item.separateRenameRecovery))
  assert.equal(result.productAcceptance, false); assert.deepEqual(input, before)
  input.report.feedbackFailures.splice(1, 1)
  assert.throws(() => assess(input), /Both reported defect classes/)
})
for (const [name, mutate] of [
  ['unknown cancellation probe', input => { input.report.feedbackFailures.at(-1).probeId = 'tree-create-cancel' }],
  ['incorrect failure stage', input => { input.report.feedbackFailures.at(-1).stage = 'hover' }],
  ['unfinished flow', (_input, flow) => { flow.executionComplete = false }],
  ['dialog still open', (_input, flow) => { flow.delete.closed = false }],
  ['untrusted dialog entry', (_input, flow) => { flow.rename.trustedOpen = false }],
  ['untrusted cancellation', (_input, flow) => { flow.delete.trustedCancel = false }],
  ['missing rename observation', (_input, flow) => { delete flow.rename.after }],
  ['wrong confirmation role', (_input, flow) => { flow.delete.dialog.role = 'alert' }],
  ['wrong confirmation title', (_input, flow) => { flow.delete.dialog.title = '其他操作' }],
  ['wrong delete target', (_input, flow) => { flow.delete.dialog.message = 'other note' }],
  ['missing cancel action', (_input, flow) => { flow.delete.dialog.buttons = ['移到回收站'] }],
  ['wrong dialog focus', (_input, flow) => { flow.delete.dialog.focusedButton = '取消' }],
  ['unfocused initial tree', (_input, flow) => { flow.rename.before.treeFocused = false }],
  ['wrong selected item', (_input, flow) => { flow.rename.before.selectedId = 'hover-long' }],
  ['unexpected synthetic record', (_input, flow) => { flow.rename.before.loadedIds[0] = 'unexpected' }],
  ['changed selection after cancel', (_input, flow) => { flow.delete.after.selectedIds = ['hover-long'] }],
  ['changed data after cancel', (_input, flow) => { flow.delete.after.loadedIds.pop() }],
  ['changed keyboard target after cancel', (_input, flow) => { flow.rename.after.activeDescendant = 'file-tree-item-hover-long' }],
  ['focus stolen by another input', (_input, flow) => { flow.rename.after.activeElement = { tag: 'INPUT', id: 'other' } }],
  ['original failure overwritten by later success', (_input, flow) => { flow.rename.after = structuredClone(flow.renameRecovery.after) }],
  ['hidden recovery', (_input, flow) => { flow.renameRecovery.needed = false }],
  ['programmatic focus recovery', (_input, flow) => { flow.renameRecovery.usedNativeClick = false }],
  ['untrusted recovery click', (_input, flow) => { flow.renameRecovery.trustedPointer = false }],
  ['missing recovery measurement', (_input, flow) => { delete flow.renameRecovery.after }],
  ['recovery changed data', (_input, flow) => { flow.renameRecovery.after.visibleIds.pop() }],
  ['arrow run before recovery', (_input, flow) => { flow.navigation.before = structuredClone(flow.rename.after) }],
  ['untrusted ArrowDown', (_input, flow) => { flow.navigation.downTrusted = false }],
  ['untrusted ArrowUp', (_input, flow) => { flow.navigation.upTrusted = false }],
  ['arrow lost focus', (_input, flow) => { flow.navigation.down.treeFocused = false }],
  ['arrow changed selection', (_input, flow) => { flow.navigation.down.selectedId = 'hover-short' }],
  ['delete before traversal completed', (_input, flow) => { flow.delete.before = structuredClone(flow.navigation.down) }],
  ['attempted data write', input => { input.report.scenes[0].feedback.libraryRequests.push({ accepted: false, method: 'POST', path: '/api/files' }) }],
  ['changed rename text', input => { input.report.scenes[0].feedback.nameDialog.valueAfter = 'changed' }],
  ['failure points to repaired sample', (input, flow) => { input.report.feedbackFailures.at(-1).error.actual = structuredClone(flow.renameRecovery.after) }],
  ['failure omits original expectation', input => { delete input.report.feedbackFailures.at(-1).error.expected }],
]) test('refuses old tree-cancel exception for ' + name, () => { const input = fixture(), flow = addTreeFocusFailures(input); mutate(input, flow); assert.throws(() => assess(input)) })

test('parses exact NUL-delimited changes, spaces and rename origins', () => {
  assert.deepEqual(parseGitStatus(''), [])
  assert.deepEqual(parseGitStatus(' M scripts/a file.mjs\0R  renamed.mjs\0previous name.mjs\0'), [
    { status: ' M', path: 'scripts/a file.mjs' }, { status: 'R ', path: 'renamed.mjs', originalPath: 'previous name.mjs' }])
  for (const malformed of [' M incomplete', ' M \0', 'M bad\0', 'R  renamed\0']) assert.throws(() => parseGitStatus(malformed))
})
test('allows only the three existing runtime verifier replacements', () => {
  assert.equal(VERIFIER_RUNTIME_FILES.length, 3)
  assertAllowedVerifierChanges(VERIFIER_RUNTIME_FILES.map(name => ({ status: ' M', path: name })))
  for (const change of [
    { status: ' M', path: 'src/styles/index.css' }, { status: ' M', path: 'package-lock.json' },
    { status: '??', path: VERIFIER_RUNTIME_FILES[0] }, { status: 'M ', path: VERIFIER_RUNTIME_FILES[0] },
    { status: ' M', path: VERIFIER_RUNTIME_FILES[0], originalPath: 'src/old.jsx' },
    { status: ' M', path: 'scripts/../' + VERIFIER_RUNTIME_FILES[0] },
    { status: ' M', path: 'scripts/ui-control-render-evidence.node.cjs' },
  ]) assert.throws(() => assertAllowedVerifierChanges([change]))
})

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0) }
  return (value ^ 0xffffffff) >>> 0
}
function pngBytes() {
  const chunk = (name, content) => { const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(content.length); crc.writeUInt32BE(crc32(Buffer.concat([type, content]))); return Buffer.concat([size, type, content, crc]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(16, 0); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 6
  const pixels = Buffer.alloc(8 * 65)
  for (let y = 0; y < 8; y++) for (let x = 1; x < 65; x++) pixels[y * 65 + x] = (x * 73 + y * 31) % 256
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
function imageFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-feedback-contract-')), bytes = pngBytes()
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'native.png'), bytes)
  return { directory, bytes, receipt: { name: 'native.png', bytes: bytes.length, sha256: digest(bytes), width: 16, height: 8 } }
}
test('verifies retained PNG bytes, hash, dimensions and complete image envelope', t => {
  const { directory, receipt } = imageFixture(t)
  assert.deepEqual(verifyPngReceipt(directory, receipt), receipt)
})
test('rejects changed PNG bytes, hashes and mismatched recorded dimensions', t => {
  const { directory, bytes, receipt } = imageFixture(t)
  for (const patch of [{ bytes: receipt.bytes + 1 }, { sha256: '0'.repeat(64) }, { width: 15 }, { height: 9 }]) {
    assert.throws(() => verifyPngReceipt(directory, { ...receipt, ...patch }))
  }
  const damaged = Buffer.from(bytes); damaged[0] = 0
  fs.writeFileSync(path.join(directory, receipt.name), damaged)
  assert.throws(() => verifyPngReceipt(directory, { ...receipt, sha256: digest(damaged) }), /signature/)
  const truncated = bytes.subarray(0, -1); fs.writeFileSync(path.join(directory, receipt.name), truncated)
  assert.throws(() => verifyPngReceipt(directory, { ...receipt, bytes: truncated.length, sha256: digest(truncated) }), /end marker/)
})
test('rejects evidence paths that escape, alias or are not regular files', t => {
  const { directory } = imageFixture(t)
  for (const name of ['../native.png', '/tmp/native.png', 'C:/native.png', 'folder\\native.png', './native.png', 'folder//native.png', 'native.png\0', '']) {
    assert.throws(() => safeEvidenceFile(directory, name), /Unsafe evidence filename/)
  }
  fs.mkdirSync(path.join(directory, 'folder'))
  assert.throws(() => safeEvidenceFile(directory, 'folder'), /regular file/)
})
