// Verifier-owned supplement for the three original screenshots. Runs against
// the actual installed App; it does not mount replacement pages or alter CSS.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createNativeUiSelect } from './native-ui-select.mjs'
import { desktopNote } from './desktop-save-fixture.mjs'
import controlEvidence from './check-ui-control-render.cjs'
import { UI_SCREEN_COLLECTION_PREFIX, createUiScreenPopupReader, captureUiScreenPopup, captureUiScreenPage, validateUiScreenFocus, validateUiScreenMinimumSidebar, validateUiScreensEvidence } from './ui-screens-evidence.mjs'

const { hasVisibleBoxShadow, selectStateSnapshot } = controlEvidence
const hash = value => createHash('sha256').update(value).digest('hex')
const q = JSON.stringify
const selectors = {
  password: 'input[aria-label="WebDAV 密码"]',
  collection: '.search-collections [role="combobox"][aria-label="已保存资料集"]',
  pinned: ['.pinned-tools input[aria-label="查找置顶笔记"]', '.pinned-tools [role="combobox"][aria-label="置顶显示范围"]', '.pinned-tools [role="combobox"][aria-label="置顶笔记排序"]', '.pinned-tools button.pinned-clear'],
}

function focusObservation(selector, shadowVisible) {
  const elements = [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width > 0)
  if (elements.length !== 1) throw Error('Expected one visible focus target')
  const field = elements[0], root = field.closest('.ant-input-affix-wrapper, .ant-select') || field
  const rect = root.getBoundingClientRect(), outlines = [], shadows = [], shadowStyles = []
  for (const [index, node] of [root, ...root.querySelectorAll('*')].entries()) {
    const box = node.getBoundingClientRect(), css = getComputedStyle(node)
    if (box.width <= 0 || box.height <= 0 || css.visibility === 'hidden' || css.opacity === '0') continue
    const owner = index ? node.tagName.toLowerCase() + ':' + index : 'root'
    if (css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0) outlines.push({ owner, width: parseFloat(css.outlineWidth), color: css.outlineColor })
    if (css.boxShadow !== 'none') {
      const entry = { owner, value: css.boxShadow, visible: shadowVisible(css.boxShadow) }; shadowStyles.push(entry)
      if (entry.visible) shadows.push(entry)
    }
  }
  let visible = rect.top >= -1 && rect.left >= -1 && rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent), box = parent.getBoundingClientRect()
    if (/hidden|auto|scroll|clip/.test(css.overflowY)) visible &&= rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
    if (/hidden|auto|scroll|clip/.test(css.overflowX)) visible &&= rect.left >= box.left - 1 && rect.right <= box.right + 1
  }
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  return { selector, focused: document.activeElement === field, focusVisible: field.matches(':focus-visible'),
    inViewport: visible, hit: hit === root || root.contains(hit), outlines, shadows, shadowStyles }
}

function pageObservation({ page, definitions, region }) {
  const areas = [...document.querySelectorAll(region)]
  if (areas.length !== 1) throw Error('Actual page region missing or ambiguous')
  const area = areas[0]
  const controls = definitions.map(({ id, selector, kind }) => {
    const elements = [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width > 0)
    if (elements.length !== 1) throw Error('Missing or ambiguous actual page control: ' + id)
    const field = elements[0], root = field.closest('.ant-input-affix-wrapper, .ant-select') || field
    const box = root.getBoundingClientRect(), ancestors = []
    let inViewport = box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1
    for (let node = root; node; node = node.parentElement) {
      const css = getComputedStyle(node), bounds = node.getBoundingClientRect()
      ancestors.push({ tag: node.tagName, className: String(node.className), display: css.display, visibility: css.visibility, opacity: css.opacity })
      if (node !== root && /hidden|auto|scroll|clip/.test(css.overflowY)) inViewport &&= box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1
      if (node !== root && /hidden|auto|scroll|clip/.test(css.overflowX)) inViewport &&= box.left >= bounds.left - 1 && box.right <= bounds.right + 1
    }
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    const sample = { id, kind, selector, owner: region, fieldTag: field.tagName, fieldId: field.id, rootTag: root.tagName, rootId: root.id,
      owned: area.contains(root) && root.contains(field), disabled: field.disabled === true, ancestors,
      visible: box.width > 0 && box.height > 0 && ancestors.every(css => css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0),
      inViewport, hit: hit === root || root.contains(hit), height: box.height, width: box.width,
      left: box.left, right: box.right, top: box.top, bottom: box.bottom }
    if (kind === 'password') {
      const css = getComputedStyle(field)
      sample.innerPadding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(key => parseFloat(css[key]))
      sample.innerHeight = field.getBoundingClientRect().height
    }
    return sample
  })
  const bounds = area.getBoundingClientRect()
  const result = { page, theme: document.documentElement.dataset.theme, region,
    regionBounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height },
    controls, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio,
    overflow: document.documentElement.scrollWidth - innerWidth, regionOverflow: area.scrollWidth - area.clientWidth }
  if (page === 'pinned') {
    const rows = []
    for (const item of controls) {
      const row = rows.find(row => Math.abs(row[0].top - item.top) <= 0.6)
      if (row) row.push(item); else rows.push([item])
    }
    result.layout = { rowCount: rows.length,
      allHeightsEqual: Math.max(...controls.map(item => item.height)) - Math.min(...controls.map(item => item.height)) <= 0.6,
      rowsAligned: rows.every(row => Math.max(...row.map(item => item.bottom)) - Math.min(...row.map(item => item.bottom)) <= 0.6) }
  }
  return result
}

function popupObservation(selector, readOwnedPopup) {
  const field = document.querySelector(selector), dialog = field?.closest('.global-search-panel[role="dialog"]')
  const list = document.getElementById(field?.getAttribute('aria-controls'))
  if (!field || !dialog || !list || field.getAttribute('aria-expanded') !== 'true') return null
  const options = [...list.querySelectorAll('[role="option"]')].map(option => {
    const box = option.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { value: option.querySelector('[data-ui-option-value]')?.getAttribute('data-ui-option-value'),
      text: option.textContent, disabled: option.getAttribute('aria-disabled') === 'true',
      height: box.height, width: box.width, hit: hit === option || option.contains(hit) }
  })
  return { ...(readOwnedPopup ? readOwnedPopup(field.id) : {}), inputId: field.id,
    ownedByDialog: list.closest('.global-search-panel[role="dialog"]') === dialog, options }
}

function collectionViewObservation() {
  const region = document.querySelector('.search-collections')
  if (!region) throw Error('Actual saved-collection panel missing')
  const status = region.querySelector('[role="combobox"][aria-label="资料集变化筛选"]')?.closest('[data-ui-control="select"]')
  return {
    dialogPresent: Boolean(region.closest('.global-search-panel[role="dialog"]')),
    contextName: region.querySelector('.search-collections-context h4')?.textContent ?? null,
    queryValue: region.querySelector('input[aria-label="搜索资料集条目"]')?.value ?? null,
    statusValue: status ? JSON.parse(status.getAttribute('data-ui-value')) : null,
    rowCount: region.querySelectorAll('[data-collection-note]').length,
    paginationText: region.querySelector('.search-collections-pagination > span')?.textContent ?? null,
    emptyMessagePresent: Boolean(region.querySelector('.global-search-empty')),
    actions: ['检查当前变化', '备份此资料集 JSON', '删除此资料集'].map(label => {
      const buttons = [...region.querySelectorAll('button')].filter(button => button.textContent.trim() === label)
      return { label, count: buttons.length, disabled: buttons.length === 1 && buttons[0].disabled }
    }),
  }
}

function sidebarObservation() {
  const sidebar = document.querySelector('.workspace-sidebar'), content = document.querySelector('.workspace-content')
  if (!sidebar || !content) throw Error('Actual installed workspace shell missing')
  const rect = node => { const box = node.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom } }
  const button = label => {
    const nodes = [...sidebar.querySelectorAll('button')].filter(node => node.getAttribute('aria-label') === label)
    if (nodes.length !== 1) return { label, unique: false, hit: false, inViewport: false }
    const node = nodes[0], box = node.getBoundingClientRect(), css = getComputedStyle(node)
    const inViewport = box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { label, unique: true, inViewport, hit: !node.disabled && css.visibility === 'visible' && css.opacity !== '0' && (hit === node || node.contains(hit)) }
  }
  const side = rect(sidebar), main = rect(content), left = Math.max(side.left, main.left), right = Math.min(side.right, main.right)
  const top = Math.max(side.top, main.top), bottom = Math.min(side.bottom, main.bottom)
  const hit = right - left > 1 && bottom - top > 1 ? document.elementFromPoint((left + right) / 2, (top + bottom) / 2) : null
  return { viewport: { width: innerWidth, height: innerHeight }, collapsed: sidebar.classList.contains('collapsed'),
    occluding: Boolean(hit && (hit === sidebar || sidebar.contains(hit))), sidebar: side, content: main,
    collapseButton: button('折叠侧边栏'), entries: ['搜索笔记', '置顶笔记', '更多功能'].map(button) }
}

export async function verifyUiScreensDesktop({ evaluate, click, cdp, until, api, capture, resize, report, save }) {
  for (const fn of [evaluate, click, until, api, capture, resize, save]) assert.equal(typeof fn, 'function')
  assert.equal(typeof cdp.onEvent, 'function')
  const ui = report.uiScreens = { schema: 1, scope: 'installed-original-three-pages', complete: false,
    setup: {}, scenes: [], notesUnchanged: false, syncSettingsUnchanged: false,
    externalRequests: [], forbiddenRequests: [], runtimeErrors: [] }
  save()
  const detach = cdp.onEvent(event => {
    if (event.method === 'Runtime.exceptionThrown') ui.runtimeErrors.push(String(event.params.exceptionDetails?.text || 'Renderer exception'))
    if (event.method !== 'Network.requestWillBeSent') return
    const request = event.params.request, url = new URL(request.url)
    if (/^(https?|wss?):$/.test(url.protocol) && url.origin !== 'http://127.0.0.1:27121') {
      ui.externalRequests.push({ origin: url.origin, pathname: url.pathname, method: request.method })
    }
    if (url.origin !== 'http://127.0.0.1:27121') return
    const mutation = /^(POST|PUT|PATCH|DELETE)$/.test(request.method)
    let forbidden = (/^\/api\/(sync|s3)(\/|$)/.test(url.pathname) && mutation) || /^\/api\/sync\/(?:check|probe|run|preview|rebind|initialize)(\/|$)/.test(url.pathname)
    if (url.pathname === '/api/settings' && mutation) {
      try { const body = JSON.parse(request.postData); forbidden ||= request.method !== 'PUT' || JSON.stringify(Object.keys(body)) !== '["theme"]' || !['light', 'dark'].includes(body.theme) }
      catch { forbidden = true }
    }
    if (forbidden) ui.forbiddenRequests.push({ pathname: url.pathname, method: request.method })
  })
  const frame = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
  const key = async (name, code, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers })
  }
  const text = async (selector, value) => {
    await click(selector); await key('a', 65, 2)
    if (value) await cdp.send('Input.insertText', { text: value }); else await key('Backspace', 8)
    await until(() => evaluate(`document.querySelector(${q(selector)})?.value===${q(value)}`), 'Actual text input did not settle')
  }
  const select = createNativeUiSelect({ evaluate, click, cdp, until })
  const collectionStorage = async () => {
    // Read every raw record in the collection namespace without parsing or
    // writing it. Compare original bytes as well as retaining their digest.
    const entries = await evaluate(`(() => Object.keys(localStorage).filter(key=>key.startsWith(${q(UI_SCREEN_COLLECTION_PREFIX)})).sort().map(key=>[key,localStorage.getItem(key)]))()`)
    const raw = JSON.stringify(entries)
    return { entries, receipt: { keys: entries.map(([key]) => key), bytes: Buffer.byteLength(raw), sha256: hash(raw) } }
  }
  const nativeFocus = async selector => {
    const shared = await evaluate(`Boolean(document.querySelector(${q(selector)})?.closest('[data-ui-control="select"]'))`)
    if (shared) {
      const before = await select.inspect(selector)
      await click('[data-ui-control="select"]:has([role="combobox"][id=' + q(before.inputId) + '])')
      await until(async () => (await select.inspect(selector)).expanded, 'Real focus target popup did not open')
      await key('Escape', 27)
      await until(async () => !(await select.inspect(selector)).expanded, 'Real focus target popup did not close')
    } else await click(selector)
    // Some real actions deliberately restore a different focus owner (the
    // Pinned clear action returns to its query). Follow native tab order back
    // to the requested field instead of assigning document focus in script.
    await key('Tab', 9, 8)
    let reached = false
    for (let index = 0; index < 18; index++) {
      await key('Tab', 9)
      if (await evaluate(`document.activeElement===document.querySelector(${q(selector)})`)) { reached = true; break }
    }
    assert.equal(reached, true, 'Native Tab did not reach the actual control')
    await frame()
    const sample = await until(async () => {
      const observation = await evaluate(`(${focusObservation.toString()})(${q(selector)},${hasVisibleBoxShadow.toString()})`)
      return observation.focused && observation.focusVisible && observation
    }, 'Keyboard focus observation')
    validateUiScreenFocus(sample)
    return sample
  }
  const openSettings = async () => {
    if (await evaluate("Boolean(document.querySelector('.settings-panel'))")) return
    await click('[aria-label="更多功能"]')
    await click({ selector: '.workspace-sidebar-more-menu [role="menuitem"]', text: '设置' })
    await until(() => evaluate("Boolean(document.querySelector('.settings-panel input[aria-label=\"WebDAV 密码\"]'))"), 'Actual WebDAV page did not mount')
  }
  const closeSettings = async () => { await click('.settings-panel [aria-label="返回笔记"]'); await until(() => evaluate("!document.querySelector('.settings-panel')"), 'Settings did not close') }
  const openCollections = async () => {
    await click('[aria-label="搜索笔记"]')
    await until(() => evaluate("Boolean(document.querySelector('.global-search-panel'))"), 'Actual search dialog did not open')
    await click('#search-tab-collections')
    await until(() => evaluate(`Boolean(document.querySelector(${q(selectors.collection)}))`), 'Actual saved collection Select missing')
  }
  const syncOnly = settings => Object.fromEntries(Object.entries(settings).filter(([name]) => name.startsWith('sync_')).sort(([a], [b]) => a.localeCompare(b)))
  try {
    const settings = await api('/api/settings'), syncBefore = syncOnly(settings)
    assert.notEqual(settings.sync_enabled, true); assert.notEqual(settings.sync_auto_enabled, true)
    assert.ok(!settings.sync_endpoint && !settings.sync_username && !settings.sync_password && !settings.sync_password_set, 'Only a fresh credential-free synthetic backend may be inspected')
    ui.setup.syncBeforeSHA256 = hash(JSON.stringify(syncBefore))
    const notes = []
    for (const suffix of ['甲', '乙']) notes.push(await api('/api/files', { method: 'POST', body: JSON.stringify({ title: `UI249三页验收${suffix}.md`, content: desktopNote('界面验收', 'synthetic-ui249-' + suffix) }) }))
    const noteBefore = await Promise.all(notes.map(note => api('/api/files/' + note.id)))
    ui.setup.noteIDs = notes.map(note => note.id)

    await resize('wide')
    await click('[aria-label="搜索笔记"]')
    await until(() => evaluate("Boolean(document.querySelector('.global-search-panel'))"), 'Actual search did not open')
    await text('input[aria-label="全局检索关键词"]', 'UI249三页验收')
    await until(() => evaluate("document.querySelectorAll('[data-search-result]').length===2 && !document.querySelector('.global-search-loading')"), 'Synthetic search results not ready')
    if (!(await evaluate("document.querySelector('.search-result-export').open"))) await click('.search-result-export > summary')
    const names = ['本地资料集界面验收：中文长名称和 English 名称完整保留，核对真实弹出选项、焦点和窗口换行', '第二份合成资料集']
    for (const name of names) {
      await text('input[aria-label="资料集名称"]', name)
      await click({ selector: '.search-result-export button', text: '保存全部为资料集' })
      await until(() => evaluate(`document.querySelector('.search-result-export')?.textContent.includes(${q('已保存资料集“' + name + '” · 2 篇')})`), 'Actual UI did not save the synthetic collection')
    }
    await click('#search-tab-collections')
    const initial = await until(async () => { const state = await select.inspect(selectors.collection); return state.kind === 'shared' && !state.disabled && state }, 'Shared saved collection control not ready')
    await click('[data-ui-control="select"]:has([role="combobox"][id=' + q(initial.inputId) + '])')
    const options = await until(async () => { const state = await select.inspect(selectors.collection); return state.expanded && state.popupReady && state.options.length === 3 && state.options }, 'Saved collection options did not mount')
    const labels = await evaluate(`(${popupObservation.toString()})(${q(selectors.collection)})`)
    ui.setup.collections = options.filter(option => typeof option.value === 'string' && option.value !== '').map(option => {
      const label = labels.options.find(item => item.value === option.value)?.text || ''
      const name = names.find(name => label.startsWith(name + ' · 2 篇'))
      assert.ok(name, 'Actual collection label lost its name or count')
      return { key: option.value, name, count: 2 }
    })
    assert.equal(ui.setup.collections.length, 2); ui.setup.createdThroughUi = true
    await key('Escape', 27); await key('Escape', 27)
    await until(() => evaluate("!document.querySelector('.global-search-panel')"), 'Search did not close after setup')

    // This observes input; it does not replace listeners, controls, handlers,
    // storage, bridges or network responses in the installed application.
    await evaluate(`(() => {
      window.__uiScreenEvents=[];
      for (const type of ['click','keydown']) document.addEventListener(type,event=>{
        if(!event.isTrusted)return;
        const option=type==='click'?event.target.closest?.('[role="option"]'):null;
        const marker=option?.querySelector('[data-ui-option-value]');
        window.__uiScreenEvents.push({type,key:event.key||null,
          sidebarCollapse:type==='click'&&Boolean(event.target.closest?.('[aria-label="折叠侧边栏"]')),
          option:marker?{listboxId:option.closest('[role="listbox"]')?.id,value:marker.getAttribute('data-ui-option-value')}:null});
      },true);
      return true;
    })()`)
    for (const size of ['wide', 'narrow']) {
      const native = await resize(size)
      assert.equal(native.nativeWindow, true, 'Actual native resize receipt required')
      const nativeViewport = native.viewport || native
      if (size === 'narrow') {
        const observe = () => evaluate(`(${sidebarObservation.toString()})()`)
        const start = await evaluate('window.__uiScreenEvents.length'), before = await observe()
        const receipt = ui.minimumSidebar = { before, action: 'none', entries: [], trustedCollapseClicks: 0 }
        if (!before.collapsed && before.occluding) {
          assert.ok(before.collapseButton.unique && before.collapseButton.inViewport && before.collapseButton.hit, 'Observed sidebar collapse control must be reachable')
          receipt.action = 'collapse'
          await click('.workspace-sidebar [aria-label="折叠侧边栏"]')
          await until(async () => (await observe()).collapsed, 'Real sidebar collapse did not settle')
        }
        // Bring each real rail entry into view without changing layout, state,
        // localStorage or window size. Subsequent navigation uses real clicks.
        for (const label of ['搜索笔记', '置顶笔记', '更多功能']) {
          await evaluate(`document.querySelector(${q('.workspace-sidebar [aria-label=' + q(label) + ']')}).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`)
          await frame()
          const observed = await observe()
          receipt.entries.push({ ...observed.entries.find(entry => entry.label === label), viewport: observed.viewport })
        }
        receipt.after = await observe()
        receipt.trustedCollapseClicks = await evaluate(`window.__uiScreenEvents.slice(${start}).filter(event=>event.sidebarCollapse).length`)
        validateUiScreenMinimumSidebar(receipt); save()
      }
      for (const theme of ['light', 'dark']) {
        await openSettings()
        if (await evaluate('document.documentElement.dataset.theme') !== theme) await click('.settings-panel [aria-label="切换主题"]')
        await until(() => evaluate(`document.documentElement.dataset.theme===${q(theme)}`), 'Actual theme toggle did not settle')
        await frame()
        for (const page of ['webdav', 'collections', 'pinned']) {
          const startEvent = await evaluate('window.__uiScreenEvents.length')
          const scene = { name: `${theme}-${size}-${page}`, page, theme, size, nativeWindow: native.nativeWindow,
            requestedViewport: native.requested, complete: false, focus: [] }
          ui.scenes.push(scene); save()
          if (page === 'webdav') {
            scene.focus.push(await nativeFocus(selectors.password))
            const readPage = () => evaluate(`(${pageObservation.toString()})(${q({ page, region: '.sync-provider-grid', definitions: [
              { id: 'endpoint', kind: 'input', selector: 'input[aria-label="WebDAV 端点"]' },
              { id: 'username', kind: 'input', selector: 'input[aria-label="WebDAV 用户名"]' },
              { id: 'password', kind: 'password', selector: selectors.password },
            ] })})`)
            Object.assign(scene, await readPage()); scene.capture = {}
            scene.screenshot = await captureUiScreenPage({ capture, filename: scene.name + '.png', read: readPage, observed: scene, record: scene.capture })
            await closeSettings()
          } else if (page === 'collections') {
            await openCollections()
            const [first, second] = ui.setup.collections
            await select.choose(selectors.collection, first.key)
            scene.focus.push(await nativeFocus(selectors.collection))
            Object.assign(scene, await evaluate(`(${pageObservation.toString()})(${q({ page, region: '.search-collections', definitions: [{ id: 'saved-collection', kind: 'select', selector: selectors.collection }] })})`))
            const control = await select.inspect(selectors.collection)
            const target = '[data-ui-control="select"]:has([role="combobox"][id=' + q(control.inputId) + '])'
            await click(target)
            const readPopup = createUiScreenPopupReader(() => evaluate(`(${popupObservation.toString()})(${q(selectors.collection)},${selectStateSnapshot.toString()})`), frame)
            const opened = await until(async () => {
              const observed = await readPopup()
              return observed?.options?.length === 3 && observed.options.every(option => option.height >= 31.4 && option.width > 20 && option.hit) && observed.popup?.ready && observed.popup.paintFrames === 2 && observed
            }, 'Actual saved-collection popup did not become visible')
            const { popup: paint, ...observed } = opened
            scene.popup = { actualSharedControl: control.kind === 'shared', pointerValue: first.key, ...observed, paint, capture: {} }
            scene.screenshot = await captureUiScreenPopup({ capture, filename: scene.name + '.png', read: readPopup, opened, record: scene.popup.capture })
            await click(target); await until(async () => !(await select.inspect(selectors.collection)).expanded, 'Repeated pointer did not close popup'); scene.popup.repeatClosed = true
            await key('ArrowDown', 40); await until(async () => (await select.inspect(selectors.collection)).expanded, 'Keyboard did not open popup')
            await key('Escape', 27)
            const escaped = await until(async () => { const state = await select.inspect(selectors.collection); return !state.expanded && state }, 'Escape did not close the saved collection popup')
            assert.equal(escaped.expanded, false); assert.equal(escaped.value, first.key)
            scene.popup.escapeRetainedDialog = await evaluate("Boolean(document.querySelector('.global-search-panel'))")
            scene.popup.escapeRetainedFocus = escaped.focused
            await key('ArrowDown', 40); await until(async () => (await select.inspect(selectors.collection)).expanded, 'Keyboard reopen failed')
            await key('ArrowDown', 40); await key('Enter', 13)
            const committed = await until(async () => { const state = await select.inspect(selectors.collection); return !state.expanded && state.value === second.key && state }, 'Keyboard did not commit the second actual collection')
            scene.popup.keyboardCommitted = committed.focused
            scene.popup.keyboardValue = committed.value
            await frame()
            scene.popup.displayedName = await evaluate("document.querySelector('.search-collections-context h4')?.textContent")
            const beforeClear = await collectionStorage()
            const clearStart = await evaluate('window.__uiScreenEvents.length')
            await click(target)
            const emptyOpened = await until(async () => {
              const state = await select.inspect(selectors.collection)
              return state.expanded && state.popupReady && state
            }, 'Empty saved-collection choice did not open')
            const cleared = await select.choose(selectors.collection, '')
            await frame()
            const clearView = await evaluate(`(${collectionViewObservation.toString()})()`)
            const afterClear = await collectionStorage()
            assert.deepEqual(afterClear.entries, beforeClear.entries, 'Clearing selection changed the stored collection bytes')
            const emptySelection = scene.popup.emptySelection = {
              beforeValue: emptyOpened.value,
              trustedOptionClicks: await evaluate(`window.__uiScreenEvents.slice(${clearStart}).filter(event=>event.type==='click'&&event.option?.listboxId===${q(emptyOpened.popupId)}&&event.option.value==='').length`),
              cleared: { value: cleared.value, expanded: cleared.expanded, focused: cleared.focused, ...clearView },
              storage: { prefix: UI_SCREEN_COLLECTION_PREFIX, before: beforeClear.receipt, cleared: afterClear.receipt },
            }
            const restored = await select.choose(selectors.collection, second.key)
            await frame()
            emptySelection.restored = { value: restored.value, expanded: restored.expanded, focused: restored.focused,
              ...await evaluate(`(${collectionViewObservation.toString()})()`) }
            const afterRestore = await collectionStorage()
            assert.deepEqual(afterRestore.entries, beforeClear.entries, 'Restoring selection changed the stored collection bytes')
            emptySelection.storage.restored = afterRestore.receipt
            // Re-open once more: first Escape belongs to Select, second to the
            // actual GlobalSearchPanel focus owner.
            await key('ArrowDown', 40); await until(async () => (await select.inspect(selectors.collection)).expanded, 'Final popup did not open')
            await key('Escape', 27); await until(async () => !(await select.inspect(selectors.collection)).expanded, 'First Escape did not collapse the final popup')
            assert.equal(await evaluate("Boolean(document.querySelector('.global-search-panel'))"), true)
            await key('Escape', 27); await until(() => evaluate("!document.querySelector('.global-search-panel')"), 'Second Escape did not close the actual search dialog')
            scene.popup.secondEscapeClosedDialog = true
            scene.popup.triggerFocusRestored = await evaluate("document.activeElement?.matches('[aria-label=\"搜索笔记\"]')===true")
          } else {
            await click('.workspace-sidebar-nav-item[aria-label="置顶笔记"]')
            await until(() => evaluate("Boolean(document.querySelector('.pinned-tools input:not(:disabled)'))"), 'Actual Pinned workspace did not become ready')
            await select.choose(selectors.pinned[1], 'all')
            await select.choose(selectors.pinned[2], 'title')
            for (const selector of selectors.pinned) scene.focus.push(await nativeFocus(selector))
            await evaluate("document.querySelector('.pinned-tools').scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
            await frame()
            const readPage = () => evaluate(`(${pageObservation.toString()})(${q({ page, region: '.pinned-workspace', definitions: selectors.pinned.map((selector, index) => ({ id: ['query', 'scope', 'order', 'clear'][index], kind: ['input', 'select', 'select', 'button'][index], selector })) })})`)
            Object.assign(scene, await readPage()); scene.capture = {}
            scene.screenshot = await captureUiScreenPage({ capture, filename: scene.name + '.png', read: readPage, observed: scene, record: scene.capture })
            await click({ selector: '.pinned-header button', text: '返回笔记' })
            await until(() => evaluate("!document.querySelector('.pinned-workspace')"), 'Pinned workspace did not close')
          }
          assert.deepEqual(scene.viewport, { width: nativeViewport.width, height: nativeViewport.height }, 'Observed native viewport changed during page capture')
          const events = await evaluate(`window.__uiScreenEvents.slice(${startEvent})`)
          scene.events = Object.fromEntries(['click', 'Tab', 'ArrowDown', 'Enter', 'Escape'].map(name => [name, events.filter(event => name === 'click' ? event.type === 'click' : event.type === 'keydown' && event.key === name).length]))
          scene.complete = true; save()
        }
      }
    }
    assert.deepEqual(await Promise.all(notes.map(note => api('/api/files/' + note.id))), noteBefore)
    ui.notesUnchanged = true
    const syncAfter = syncOnly(await api('/api/settings')); assert.deepEqual(syncAfter, syncBefore)
    ui.setup.syncAfterSHA256 = hash(JSON.stringify(syncAfter)); ui.syncSettingsUnchanged = true
    ui.complete = true; validateUiScreensEvidence(ui); save(); return ui
  } catch (error) {
    ui.complete = false; ui.error = String(error.message || error); save(); throw error
  } finally { detach() }
}
