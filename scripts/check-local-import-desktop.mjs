import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { desktopNote } from './desktop-save-fixture.mjs'
import { createLocalImportDesktopFixtures } from './local-import-desktop-fixture.mjs'
import { LOCAL_IMPORT_WORKBOOK_HEADINGS, LOCAL_IMPORT_WORKBOOK_CELLS, extractImportedWorkbookHeadings,
  extractImportedWorkbookCells, verifyLocalImportDesktopReport } from './local-import-desktop-evidence.mjs'

const base = 'http://127.0.0.1:27121'
const requestPath = '/api/local-import/requests/'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hash = value => createHash('sha256').update(value).digest('hex')
const selector = id => '[data-local-import-row=' + JSON.stringify(id) + ']'
const stateFile = out => path.join(out, 'local-import.json')
const save = (out, report) => writeFileSync(stateFile(out), JSON.stringify(report, null, 2) + '\n')
const textOf = node => [node?.text || '', ...(node?.children || []).map(textOf)].join('\n')

export async function clearLocalImportWorkspace({ evaluate, action, rows, until }) {
  // Reopening mounts an empty view while the real ledger verifies its records.
  // Readiness must precede deciding which of the original UI actions to use.
  await until(() => evaluate("!!document.querySelector('[data-local-import-ledger-refresh]:not(:disabled)')"), 'Local import records are not ready for cleanup')
  if (await evaluate("!!document.querySelector('[data-local-import-clear]:not(:disabled)')")) {
    await action('[data-local-import-clear]')
    await until(() => evaluate("!document.querySelector('[data-local-import-clear-row]')"), 'Confirmed import records were not cleared by the original control')
  }
  if (await evaluate("!!document.querySelector('[data-local-import-reset]:not(:disabled)')")) await action('[data-local-import-reset]')
  await until(async () => (await rows()).length === 0 && await evaluate("!!document.querySelector('[data-local-import-input]:not(:disabled)')"), 'Confirmed record cleanup did not retain a fresh input state')
}

function helpers({ evaluate, click, cdp, until, api, out }, report) {
  const keys = async (key, code, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code, modifiers })
  }
  const settle = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
  const clean = () => until(() => evaluate("!document.querySelector('.workspace-save-chip,.save-state')"), 'Imported editor is not clean')
  const action = async control => {
    await settle()
    await until(() => evaluate(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(control)})];if(all.length!==1||all[0].disabled)return false;const n=all[0];n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&n.contains(hit)})()`), 'Import control is not reachable: ' + control)
    await click(control)
  }
  const panel = async () => {
    if (!await evaluate("!!document.querySelector('[data-local-import-workspace]')")) {
      await action('button[aria-label="更多笔记操作"]')
      await action('[data-local-import-entry]')
    }
    await until(() => evaluate("!!document.querySelector('[data-local-import-workspace]')"), 'Original import entry did not open')
  }
  const rows = () => evaluate(`Array.from(document.querySelectorAll('[data-local-import-row]'),n=>({
    id:n.getAttribute('data-local-import-row'),state:n.getAttribute('data-local-import-state'),requestId:n.getAttribute('data-local-import-request-id'),
    title:n.querySelector('[data-local-import-title]')?.value||n.querySelector('[data-local-import-title]')?.textContent||'',
    text:n.innerText,errorMessage:n.querySelector('[role=alert]')?.textContent||'',preview:n.querySelector('[data-local-import-preview]')?.value||n.querySelector('[data-local-import-preview]')?.textContent||''
  }))`)
  const rowNamed = async title => until(async () => {
    const found = (await rows()).filter(row => row.title === title)
    return found.length === 1 ? found[0] : null
  }, 'Import row absent or ambiguous: ' + title)
  const rowInState = async (title, state) => until(async () => {
    const row = await rowNamed(title)
    return row.state === state ? row : null
  }, 'Import row did not reach ' + state + ': ' + title)
  const fill = async (control, value) => {
    await action(control); await keys('a', 65, 2); await cdp.send('Input.insertText', { text: value })
    await until(() => evaluate(`document.querySelector(${JSON.stringify(control)})?.value===${JSON.stringify(value)}`), 'Original import input did not accept text')
  }
  const title = async (row, value) => fill(selector(row.id) + ' [data-local-import-title]', value)
  const destination = async (row, value) => {
    const control = selector(row.id) + ' [data-local-import-destination]'
    await until(() => evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(control)});return !!n&&!n.disabled&&Array.from(n.options).some(option=>option.value===${JSON.stringify(value)})})()`), 'Complete live destination choices have not loaded')
    const index = await evaluate(`Array.from(document.querySelector(${JSON.stringify(control)}).options).findIndex(option=>option.value===${JSON.stringify(value)})`)
    assert.ok(index >= 0, 'Requested live destination missing from original select')
    await action(control); await keys('Home', 36)
    for (let i = 0; i < index; i++) await keys('ArrowDown', 40)
    await keys('Enter', 13)
    await until(() => evaluate(`document.querySelector(${JSON.stringify(control)})?.value===${JSON.stringify(value)}`), 'Original destination select did not change')
  }
  const choose = async files => {
    await until(() => evaluate("!!document.querySelector('[data-local-import-input]:not(:disabled)')"), 'Original file input is still waiting for durable records')
    const { root } = await cdp.send('DOM.getDocument')
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-local-import-input]' })
    assert.ok(nodeId, 'Actual file input missing')
    await cdp.send('DOM.setFileInputFiles', { nodeId, files })
    await until(async () => (await rows()).length === files.length && (await rows()).every(row => ['prepared', 'error'].includes(row.state)), 'Native import parsing did not settle')
  }
  const clear = () => clearLocalImportWorkspace({ evaluate, action, rows, until })
  const openNote = async (file, marker) => {
    await evaluate("window.dispatchEvent(new Event('library:refresh'))")
    const parents = []
    let parent = file.parent_id
    while (parent) {
      const folder = await api('/api/files/' + parent)
      parents.unshift(folder.id); parent = folder.parent_id
      assert.ok(parents.length < 20, 'Unexpected import fixture folder cycle')
    }
    for (const id of parents) {
      const control = '[data-file-id="' + id + '"]'
      await until(() => evaluate(`!!document.querySelector(${JSON.stringify(control)})`), 'Imported ancestor not listed')
      if (await evaluate(`document.querySelector(${JSON.stringify(control)})?.getAttribute('aria-expanded')==='false'`)) await click(control)
    }
    await until(() => evaluate(`!!document.querySelector('[data-file-id="${file.id}"]')`), 'Imported note not listed')
    await click('[data-file-id="' + file.id + '"]')
    await until(() => evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(marker)})`), 'Imported note body not loaded')
    await clean()
  }
  const edit = async marker => {
    await action('.editor-input[contenteditable="true"]'); await keys('End', 35, 2)
    await cdp.send('Input.insertText', { text: ' ' + marker })
    await until(() => evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(marker)})&&!!document.querySelector('.workspace-save-chip.dirty')`), 'Original editor did not retain the new imported draft')
  }
  const decision = async label => {
    await until(() => evaluate("!!document.querySelector('.consumer-confirm-modal')"), 'Original unsaved decision was bypassed')
    assert.equal(await evaluate(`(()=>{const n=Array.from(document.querySelectorAll('.consumer-confirm-modal button')).filter(n=>n.textContent.trim()===${JSON.stringify(label)});if(n.length!==1)return false;n[0].setAttribute('data-import-original-decision','');return true})()`), true)
    try { await action('[data-import-original-decision]') }
    finally { await evaluate("document.querySelector('[data-import-original-decision]')?.removeAttribute('data-import-original-decision')") }
  }
  const screenshot = async filename => {
    await settle()
    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    writeFileSync(path.join(out, filename), bytes)
    report.screenshots.push({ filename, bytes: bytes.length, sha256: hash(bytes) }); save(out, report)
  }
  return { keys, settle, clean, action, panel, rows, rowNamed, rowInState, fill, title, destination, choose, clear, openNote, edit, decision, screenshot }
}

// Main phase precedes the existing native quit. The second phase below is
// invoked only after the owning driver actually starts a new packaged process.
export async function verifyLocalImportDesktop(context) {
  const { evaluate, cdp, until, api, out, noteIDs, processID } = context
  assert.equal(process.platform, 'win32'); assert.ok(Number.isInteger(processID) && processID > 0)
  const report = { complete: false, commit: process.env.GITHUB_SHA, platform: process.platform,
    realPackagedApp: true, realBackend: true, realPreload: true, syntheticData: true,
    timerAccelerated: false, bridgeOverridden: false, cleanupComplete: false,
    checks: [], screenshots: [], committed: [], guards: {}, cancellation: {} }
  const mark = name => { report.checks.push(name); save(out, report) }
  save(out, report)
  const h = helpers(context, report), fixture = createLocalImportDesktopFixtures(out)
  report.inputFiles = fixture.manifest
  const originals = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const persisted = [], requests = [], pending = new Set()
  let detachNetwork, detachFetch, intercept = false, interceptionError
  const inventory = () => api('/api/files?page=1&size=200')
  const countTitle = async title => (await inventory()).filter(item => item.title === title && !item.is_deleted).length
  const postCount = id => requests.filter(item => item.method === 'POST' && item.requestId === id).length
  const rowAction = (name, row) => h.action(selector(row.id) + ' [data-local-import-' + name + ']')
  const track = promise => { const task = promise.catch(error => { interceptionError ||= error }).finally(() => pending.delete(task)); pending.add(task) }
  const release = async () => {
    try { if (intercept) { await cdp.send('Fetch.disable'); intercept = false } }
    finally { await Promise.all([...pending]); detachFetch?.(); detachFetch = null }
    if (interceptionError) throw interceptionError
  }
  const pauseResponse = async (title, fail) => {
    const seen = []
    detachFetch = cdp.onEvent(event => {
      if (event.method !== 'Fetch.requestPaused') return
      const { requestId, request, responseStatusCode } = event.params
      let body; try { body = JSON.parse(request.postData || '{}') } catch {}
      if (request.method === 'POST' && body?.title === title && responseStatusCode === 200) {
        seen.push({ requestId, url: request.url, method: request.method, responseStatusCode })
        if (fail) track(cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }))
      } else track(cdp.send('Fetch.continueRequest', { requestId }))
    })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: base + requestPath + '*', requestStage: 'Response' }] })
    intercept = true
    return seen
  }
  const resultOf = async requestId => {
    const item = requests.findLast(item => item.requestId === requestId && item.method === 'POST')
    assert.ok(item)
    const raw = await cdp.send('Network.getResponseBody', { requestId: item.networkId })
    const value = JSON.parse(raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString('utf8') : raw.body)
    assert.equal(value.code, 0)
    return value.data
  }
  const remember = async row => {
    assert.match(row.requestId, uuid)
    const receipt = await api(requestPath + row.requestId)
    assert.equal(receipt.found, true); assert.equal(receipt.request_id, row.requestId); assert.equal(receipt.state, 'available')
    const file = await api('/api/files/' + receipt.file_id)
    assert.equal(file.title, receipt.title); assert.equal(file.parent_id, receipt.parent_id)
    assert.equal(postCount(row.requestId), 1)
    const item = { requestId: row.requestId, fileId: file.id, title: file.title, parentId: file.parent_id,
      initialContentSHA256: hash(file.content), savedContentSHA256: hash(file.content), payloadSHA256: receipt.payload_sha256,
      receiptState: receipt.state, postCount: postCount(row.requestId) }
    report.committed.push(item); persisted.push({ file, receipt }); save(out, report)
    return { item, file, receipt }
  }
  const reconcile = async row => {
    await rowAction('refresh', row)
    return h.rowInState(row.title, 'committed')
  }
  try {
    const diagnostics = await evaluate('window.electronAPI.appDiagnostics()')
    assert.equal(diagnostics.packaged, true); assert.equal(diagnostics.version, '4.246.0')
    report.appVersion = diagnostics.version
    assert.equal(await evaluate("typeof window.electronAPI?.getPathForFile==='function'&&typeof window.electronAPI?.importPaths==='function'"), true)
    detachNetwork = cdp.onEvent(event => {
      if (event.method !== 'Network.requestWillBeSent') return
      const { request, requestId: networkId } = event.params
      if (!request.url.startsWith(base + requestPath)) return
      const requestId = request.url.slice((base + requestPath).length)
      if (!uuid.test(requestId)) { interceptionError ||= Error('Unexpected local import request identity: ' + requestId); return }
      let payload; try { payload = JSON.parse(request.postData || '{}') } catch {}
      requests.push({ networkId, requestId, method: request.method, title: payload?.title || null })
    })
    const parent = await api('/api/files', { method: 'POST', body: JSON.stringify({ title: '导入99父目录', content: '', is_folder: true }) })
    const folder = await api('/api/files', { method: 'POST', body: JSON.stringify({ title: '导入99子目录', content: '', is_folder: true, parent_id: parent.id }) })
    const source = await api('/api/files', { method: 'POST', body: JSON.stringify({ title: '导入99原保护来源.md', content: desktopNote('导入保护来源', 'import99-guard-source') }) })
    await h.panel(); mark('original-library-menu-opens-the-local-import-workspace')
    const beforePreview = await inventory()
    await h.choose([fixture.files.markdown, fixture.files.text, fixture.files.workbook, fixture.files.malformed])
    report.fileInput = { method: 'DOM.setFileInputFiles', selector: '[data-local-import-input]', ownedNativeFiles: true }
    mark('real-file-input-uses-production-preload-for-owned-local-files')
    const firstRows = await h.rows(), preview = firstRows.map(row => row.preview).join('\n')
    const markers = ['import99-markdown-body', 'import99-text-body', 'import99-sheet-one', 'import99-sheet-two']
    for (const marker of markers) assert.ok(preview.includes(marker), 'Native parser lost preview content: ' + marker)
    const workbookPreview = firstRows.find(row => row.preview.includes('import99-sheet-one'))?.preview || ''
    for (const heading of LOCAL_IMPORT_WORKBOOK_HEADINGS) assert.ok(workbookPreview.includes(heading), 'XLSX preview changed an original sheet name: ' + heading)
    for (const value of LOCAL_IMPORT_WORKBOOK_CELLS.flat(2)) assert.ok(workbookPreview.includes(value), 'XLSX preview changed an original cell value: ' + value)
    for (const row of firstRows.filter(row => row.state === 'prepared')) {
      await h.action(selector(row.id) + ' details summary')
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector(row.id) + ' details')})?.open`), true)
    }
    mark('markdown-text-and-both-workbook-sheets-reach-the-preview')
    assert.equal(firstRows.filter(row => row.state === 'prepared').length, 3)
    assert.equal(firstRows.filter(row => row.state === 'error').length, 1)
    assert.ok(firstRows.find(row => row.state === 'error').errorMessage.trim())
    mark('one-malformed-file-is-an-individual-error-with-valid-rows-retained')
    assert.deepEqual(await inventory(), beforePreview); assert.equal(requests.length, 0)
    report.preview = { validRows: 3, errorRows: 1, noteWrites: 0, unchangedInventory: true, markers }
    mark('preview-and-selection-perform-zero-note-writes')
    const markdown = firstRows.find(row => row.preview.includes('import99-markdown-body'))
    const text = firstRows.find(row => row.preview.includes('import99-text-body'))
    const workbook = firstRows.find(row => row.preview.includes('import99-sheet-one'))
    await h.action(selector(text.id) + ' [data-local-import-selected]')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector(text.id) + ' [data-local-import-selected]')})?.checked`), false)
    assert.deepEqual(await inventory(), beforePreview); assert.equal(requests.length, 0)
    await h.action(selector(text.id) + ' [data-local-import-selected]')
    await h.title(markdown, '导入99目标子目录.md'); await h.destination(markdown, folder.id)
    await h.title(text, '导入99纯文本.md'); await h.title(workbook, '导入99两张表.md')
    assert.deepEqual(await inventory(), beforePreview)
    await h.screenshot('local-import-preview.png')
    mark('edited-title-and-child-folder-determine-the-confirmed-destination')
    await h.action('[data-local-import-confirm]')
    const rich = await remember(await h.rowInState('导入99目标子目录.md', 'committed'))
    const ordinary = await remember(await h.rowInState('导入99纯文本.md', 'committed'))
    const sheets = await remember(await h.rowInState('导入99两张表.md', 'committed'))
    assert.equal(rich.file.parent_id, folder.id)
    for (const marker of ['import99-sheet-one', 'import99-sheet-two']) assert.ok(sheets.file.content.includes(marker))
    const sheetNodes = JSON.parse(sheets.file.content).root.children
    const sheetHeadings = extractImportedWorkbookHeadings(sheets.file.content)
    assert.deepEqual(sheetHeadings, LOCAL_IMPORT_WORKBOOK_HEADINGS)
    assert.equal(sheetNodes.filter(node => node.type === 'table').length, 2)
    const workbookCells = extractImportedWorkbookCells(sheets.file.content)
    assert.deepEqual(workbookCells, LOCAL_IMPORT_WORKBOOK_CELLS, 'Native XLSX import changed an original cell value')
    report.workbook = { sheetHeadings, tableCount: 2, bothMarkersPreserved: true, cells: workbookCells }
    const textNodes = JSON.parse(ordinary.file.content).root.children
    assert.ok(textNodes.length >= 2 && textNodes.every(node => node.type === 'paragraph'))
    assert.ok(textOf({ children: textNodes }).includes('第二行保持原文。'))
    report.plainText = { paragraphsRetained: true, secondLine: '第二行保持原文。' }
    assert.equal((await h.rows()).filter(row => row.state === 'error').length, 1)
    mark('explicit-confirmation-returns-one-durable-receipt-per-valid-row')
    const nodes = [], walk = node => { nodes.push(node); for (const child of node.children || []) walk(child) }
    walk(JSON.parse(rich.file.content).root)
    const types = ['code-block', 'formula', 'heading', 'table'].filter(type => nodes.some(node => node.type === type))
    assert.deepEqual(types, ['code-block', 'formula', 'heading', 'table'])
    const code = nodes.find(node => node.type === 'code-block'), formula = nodes.find(node => node.type === 'formula')
    assert.equal(code.code, 'const import99 = "代码保留";'); assert.equal(formula.expression, 'x^2 + y^2 = z^2')
    assert.ok(textOf(nodes.find(node => node.type === 'table')).includes('表格99'))
    report.richContent = { nodeTypes: types, code: code.code, formula: formula.expression, tableTextIncludes: '表格99' }
    mark('imported-markdown-retains-native-code-table-and-formula-nodes')
    await h.screenshot('local-import-results.png')
    await rowAction('open', await h.rowNamed(rich.file.title))
    await until(() => evaluate("!document.querySelector('[data-local-import-workspace]')&&document.querySelector('.editor-input')?.innerText.includes('import99-markdown-body')"), 'Committed import result did not open through the actual editor')
    await h.clean(); await h.edit('import99-native-saved'); await h.keys('s', 83, 2)
    await until(async () => (await api('/api/files/' + rich.file.id)).content.includes('import99-native-saved'), 'Original save did not persist imported edit')
    await h.clean(); rich.file = await api('/api/files/' + rich.file.id)
    persisted.find(item => item.file.id === rich.file.id).file = rich.file
    rich.item.savedContentSHA256 = hash(rich.file.content); report.richContent.savedMarker = 'import99-native-saved'
    mark('result-opens-the-real-editor-and-original-save-persists-its-edit')

    await h.openNote(source, 'import99-guard-source'); await h.edit('import99-guard-cancel')
    await h.panel(); await rowAction('open', await h.rowNamed(ordinary.file.title)); await h.decision('取消')
    assert.equal(await evaluate("document.querySelector('.editor-input')?.innerText.includes('import99-guard-cancel')&&!!document.querySelector('.workspace-save-chip.dirty')"), true)
    assert.equal((await api('/api/files/' + source.id)).content, source.content)
    report.guards.cancel = { confirmed: true, sourceDraftRetained: true, databaseUnchanged: true }
    mark('original-cancel-decision-retains-the-source-draft-and-database-body')
    await rowAction('open', await h.rowNamed(ordinary.file.title)); await h.decision('不保存')
    await until(() => evaluate("!document.querySelector('[data-local-import-workspace]')&&document.querySelector('.editor-input')?.innerText.includes('import99-text-body')"), 'Discard did not reach the import result')
    assert.equal((await api('/api/files/' + source.id)).content, source.content); await h.clean()
    report.guards.discard = { confirmed: true, databaseUnchanged: true }
    mark('original-discard-decision-opens-the-result-without-saving-the-draft')
    await h.openNote(source, 'import99-guard-source'); await h.edit('import99-guard-save')
    await h.panel(); await rowAction('open', await h.rowNamed(ordinary.file.title)); await h.decision('保存')
    await until(() => evaluate("!document.querySelector('[data-local-import-workspace]')&&document.querySelector('.editor-input')?.innerText.includes('import99-text-body')"), 'Save decision did not reach the import result')
    assert.ok((await api('/api/files/' + source.id)).content.includes('import99-guard-save')); await h.clean()
    report.guards.save = { confirmed: true, persistedBeforeOpen: true }
    mark('original-save-decision-persists-the-source-before-opening-the-result')

    await h.panel(); await h.clear(); await h.choose([fixture.files.unknown])
    await h.title((await h.rows())[0], ordinary.file.title); await h.action('[data-local-import-confirm]')
    const conflict = await h.rowInState(ordinary.file.title, 'rejected'), rejectedName = await resultOf(conflict.requestId)
    assert.equal(rejectedName.status, 'rejected'); assert.equal(rejectedName.reason, 'name-conflict')
    assert.deepEqual(await api('/api/files/' + ordinary.file.id), ordinary.file)
    report.nameConflict = { reason: rejectedName.reason, rejectedRequestId: conflict.requestId, existingFileUnchanged: true }
    mark('same-name-rejection-does-not-overwrite-the-existing-note')
    await rowAction('revise', conflict); const revised = await h.rowInState(ordinary.file.title, 'prepared')
    await h.title(revised, '导入99同名修复.md'); await h.action('[data-local-import-confirm]')
    const renamed = await remember(await h.rowInState('导入99同名修复.md', 'committed'))
    report.nameConflict.repairedRequestId = renamed.receipt.request_id; report.nameConflict.revisedTitle = renamed.file.title
    assert.notEqual(conflict.requestId, renamed.receipt.request_id)
    mark('explicit-revision-after-name-rejection-creates-the-renamed-note')

    await h.clear()
    const stale = await api('/api/files', { method: 'POST', body: JSON.stringify({ title: '导入99失效目标', content: '', is_folder: true }) })
    await h.action('[data-local-import-folders-refresh]'); await h.choose([fixture.files.stale])
    await h.title((await h.rows())[0], '导入99目录修复.md'); await h.destination(await h.rowNamed('导入99目录修复.md'), stale.id)
    await api('/api/files/' + stale.id, { method: 'DELETE' })
    await h.action('[data-local-import-confirm]')
    const staleRow = await h.rowInState('导入99目录修复.md', 'rejected'), rejectedFolder = await resultOf(staleRow.requestId)
    assert.equal(rejectedFolder.status, 'rejected'); assert.equal(rejectedFolder.reason, 'folder-unavailable')
    assert.equal(await countTitle('导入99目录修复.md'), 0)
    report.staleDestination = { reason: rejectedFolder.reason, rejectedRequestId: staleRow.requestId, noNoteCreated: true }
    mark('deleted-destination-is-rejected-with-no-created-note')
    await rowAction('revise', staleRow); await h.destination(await h.rowInState('导入99目录修复.md', 'prepared'), '')
    await h.action('[data-local-import-confirm]')
    const repaired = await remember(await h.rowInState('导入99目录修复.md', 'committed'))
    assert.ok(repaired.file.content.includes('import99-stale-parent-body'))
    report.staleDestination.repairedRequestId = repaired.receipt.request_id; report.staleDestination.repairedByExplicitRevision = true
    mark('explicit-destination-repair-reuses-the-retained-preview')

    await h.clear(); await h.choose([fixture.files.unknown]); await h.title((await h.rows())[0], '导入99回执查回.md')
    const lost = await pauseResponse('导入99回执查回.md', true)
    await h.action('[data-local-import-confirm]')
    const unknown = await h.rowInState('导入99回执查回.md', 'unknown')
    await release(); assert.equal(lost.length, 1)
    const committedUnknown = await api(requestPath + unknown.requestId)
    assert.equal(committedUnknown.found, true); assert.equal(postCount(unknown.requestId), 1)
    mark('lost-real-post-commit-response-retains-the-original-request-identity')
    const recovered = await remember(await reconcile(unknown))
    assert.equal(recovered.file.id, committedUnknown.file_id)
    report.reconciliation = { requestId: unknown.requestId, fileId: recovered.file.id, method: lost[0].method,
      responseStatusCode: lost[0].responseStatusCode, realCommittedResponseFailed: true, lookupMethod: 'GET',
      postCountBefore: 1, postCountAfter: postCount(unknown.requestId),
      browserGetCount: requests.filter(item => item.requestId === unknown.requestId && item.method === 'GET').length, sameFileRecovered: true }
    assert.ok(report.reconciliation.browserGetCount >= 1)
    await h.screenshot('local-import-reconciled.png')
    mark('read-only-reconciliation-recovers-the-same-file-without-another-post')

    for (const [kind, firstKey, nextKey, firstTitle, followingTitle] of [
      ['stop', 'stopFirst', 'stopNext', '导入99停止首项.md', '导入99停止后项.md'],
      ['close', 'closeFirst', 'closeNext', '导入99关闭首项.md', '导入99关闭后项.md'],
    ]) {
      await h.clear(); await h.choose([fixture.files[firstKey], fixture.files[nextKey]])
      const selected = await h.rows()
      await h.title(selected[0], firstTitle); await h.title(selected[1], followingTitle)
      const held = await pauseResponse(firstTitle, false)
      await h.action('[data-local-import-confirm]')
      await until(() => held.length === 1, 'Actual import response was not held before ' + kind)
      const first = await h.rowInState(firstTitle, 'submitting')
      await h.action('[data-local-import-' + kind + ']')
      if (kind === 'close') await until(() => evaluate("!document.querySelector('[data-local-import-workspace]')"), 'Import close did not dismiss the workspace')
      await release(); await h.settle()
      assert.equal(requests.filter(item => item.method === 'POST' && item.title === followingTitle).length, 0)
      assert.equal(await countTitle(followingTitle), 0)
      if (kind === 'close') await h.panel()
      const retained = await h.rowInState(firstTitle, 'unknown')
      assert.equal(retained.requestId, first.requestId)
      const following = await h.rowInState(followingTitle, 'pending')
      assert.match(following.requestId, uuid)
      assert.equal((await api(requestPath + following.requestId)).found, false)
      const confirmed = await remember(await reconcile(retained))
      assert.equal(confirmed.receipt.request_id, first.requestId)
      await rowAction('cancel', following)
      assert.equal((await h.rows()).some(row => row.requestId === following.requestId), false)
      report.cancellation[kind] = { requestId: first.requestId, method: held[0].method, realResponseStatusCode: held[0].responseStatusCode,
        heldRealResponse: true, followingTitle, followingRequestId: following.requestId, followingState: following.state,
        followingPostCount: 0, followingNoteCount: 0, recoveredByGet: true, unstartedRecordExplicitlyCancelled: true }
      mark(kind === 'stop' ? 'stopping-a-held-real-response-leaves-following-items-unsubmitted' : 'closing-a-held-real-response-cannot-submit-following-items-later')
    }
    mark('reopen-retains-unresolved-records-and-allows-explicit-recovery')
    await h.clear(); await h.action('[data-local-import-close]')
    const beforeDrop = await inventory()
    const point = await evaluate("(()=>{const n=document.querySelector('.file-list[data-local-import-drop]');if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
    assert.ok(point)
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, ...point, data: { items: [], files: [fixture.files.drag], dragOperationsMask: 1 } })
    await until(async () => (await h.rows()).length === 1 && (await h.rows())[0].state === 'prepared', 'Actual native file drag did not enter the same workspace')
    assert.deepEqual(await inventory(), beforeDrop)
    await h.title((await h.rows())[0], '导入99拖入.md'); await h.action('[data-local-import-confirm]')
    await remember(await h.rowInState('导入99拖入.md', 'committed'))
    report.drag = { method: 'Input.dispatchDragEvent', realFilePath: true, previewBeforeWrite: true, explicitConfirmation: true }
    mark('real-file-drag-opens-the-same-preview-before-explicit-import')
    for (const item of Object.values(report.cancellation)) {
      assert.equal(requests.filter(request => request.method === 'POST' && request.title === item.followingTitle).length, 0)
      assert.equal(await countTitle(item.followingTitle), 0)
    }
    await h.clear(); await h.action('[data-local-import-close]')
    assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), originals)
    report.originalNotesUnchanged = true
    mark('unrelated-note-bodies-metadata-and-pins-remain-unchanged')
    assert.equal(report.committed.length, 9)
    report.observedRequests = requests
    return { report, persisted, processID, out, richFileId: rich.file.id, workbookFileId: sheets.file.id }
  } catch (error) {
    report.error = String(error.stack || error); save(out, report); throw error
  } finally {
    try { await release() }
    finally { detachNetwork?.(); report.cleanupComplete = !intercept && pending.size === 0 && !interceptionError; save(out, report) }
  }
}

export async function verifyLocalImportRestart(context, state) {
  const { api, evaluate, until, processID, out } = context
  const { report, persisted } = state, h = helpers(context, report)
  const mark = name => { report.checks.push(name); save(out, report) }
  try {
    assert.equal(out, state.out)
    assert.ok(Number.isInteger(processID) && processID > 0 && processID !== state.processID)
    assert.equal(report.complete, false); assert.equal(report.cleanupComplete, true)
    assert.equal(report.checks.length, 23)
    for (const expected of persisted) {
      const receipt = await api(requestPath + expected.receipt.request_id)
      assert.deepEqual(receipt, expected.receipt)
      const file = await api('/api/files/' + expected.file.id)
      assert.equal(file.content, expected.file.content); assert.equal(file.title, expected.file.title); assert.equal(file.parent_id, expected.file.parent_id)
      const item = report.committed.find(item => item.fileId === file.id)
      assert.equal(hash(file.content), item.savedContentSHA256)
      if (file.id === state.workbookFileId) {
        assert.deepEqual(extractImportedWorkbookHeadings(file.content), LOCAL_IMPORT_WORKBOOK_HEADINGS, 'Restart changed an original XLSX sheet heading')
        report.workbook.restartedCells = extractImportedWorkbookCells(file.content)
        assert.deepEqual(report.workbook.restartedCells, LOCAL_IMPORT_WORKBOOK_CELLS, 'Restart changed an original XLSX cell value')
      }
      item.restartedContentMatches = true; item.restartedReceiptMatches = true
    }
    report.restart = { firstPID: state.processID, secondPID: processID, freshProfile: true, nativeProcessRestart: true, draftCacheUsed: false }
    mark('fresh-native-process-recovers-identical-files-and-request-receipts')
    const rich = persisted.find(item => item.file.id === state.richFileId).file
    await h.openNote(rich, 'import99-native-saved')
    await until(() => evaluate("!!document.querySelector('.editor-input table')&&!!document.querySelector('.editor-input .katex')"), 'Restart did not render imported native table and formula')
    await h.clean(); report.restart.openedSavedBody = true
    await h.screenshot('local-import-restarted.png')
    mark('restarted-imported-note-opens-its-saved-rich-body-without-draft-cache')
    report.complete = true; save(out, report)
    verifyLocalImportDesktopReport(out, process.env.GITHUB_SHA)
  } catch (error) {
    report.complete = false; report.error = String(error.stack || error); save(out, report); throw error
  }
}
