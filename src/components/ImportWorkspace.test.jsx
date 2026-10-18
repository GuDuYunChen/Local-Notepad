import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import ImportWorkspace from './ImportWorkspace'
import { api, listAllFiles } from '../services/api'
import { normalizeImportedContent } from '../services/importContent'
import { createImportLedger, importPayloadHash, LOCAL_IMPORT_PREFIX } from '../services/localImport.mjs'

vi.mock('../services/api', () => ({ api: vi.fn(), listAllFiles: vi.fn() }))
const folderId = '33333333-3333-4333-8333-333333333333'
const childId = '44444444-4444-4444-8444-444444444444'
let root, host, native, sources, receipts, files, onClose, onChanged, onOpenNote, folders
const preparedContent = text => normalizeImportedContent({ title: 'test.txt', contentType: 'text', content: text })
const writes = () => api.mock.calls.filter(([, init]) => init?.method === 'POST')
const records = () => createImportLedger(localStorage).list()
const currentRows = () => [...host.querySelectorAll('[data-local-import-row]')]
const findRow = name => currentRows().find(row => row.querySelector('strong')?.textContent === name)
const state = row => row.getAttribute('data-local-import-state')
const control = (name, scope = host) => scope.querySelector('[data-local-import-' + name + ']')
const pause = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
async function until(predicate) { for (let i = 0; i < 180; i++) { if (predicate()) return; await pause() }; throw Error('Import UI did not reach the expected state: ' + host.textContent.slice(-1500)) }
async function settle() { await until(() => !control('workspace') || (control('stop')?.disabled && !control('ledger-refresh')?.disabled && !control('folders-refresh')?.disabled)) }
async function click(name, scope = host, wait = true) {
  const button = control(name, scope); expect(button, 'missing ' + name).toBeTruthy(); expect(button.disabled, 'disabled ' + name).toBe(false)
  await act(async () => button.click()); if (wait) await settle()
}
async function fill(name, value, scope = host) {
  const input = control(name, scope); expect(input).toBeTruthy()
  const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
async function mount(props = {}) {
  await act(async () => root.render(<React.StrictMode><ImportWorkspace onClose={onClose} onChanged={onChanged} onOpenNote={onOpenNote} {...props} /></React.StrictMode>))
  await settle()
}
function source(path, content = '完整正文\n第二行', extra = {}) {
  const format = path.split('.').at(-1).toLowerCase(), office = ['docx', 'xlsx', 'xls'].includes(format)
  sources.set(path, { success: true, title: path.split(/[\\/]/).at(-1), format, contentType: office || format === 'md' ? 'markdown' : 'text', ...(office ? { tableCellEncoding: 'base64-utf8-v1', officeTextPrefix: 'NPIMPORT0' } : {}), content, originalPath: path, ...extra })
  return path
}
async function choose(paths, wait = true) {
  const input = control('input'); expect(input.disabled).toBe(false)
  const selected = paths.map(path => { const file = new File(['fixture'], path.split(/[\\/]/).at(-1)); Object.defineProperty(file, 'fixturePath', { value: path }); return file })
  await act(async () => { Object.defineProperty(input, 'files', { value: selected, configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })) })
  if (wait) await settle()
}
async function seed(patch = {}, attempted = true) {
  const ledger = createImportLedger(localStorage), entry = await ledger.reserve({ title: '恢复.txt', parent_id: '', content: preparedContent('恢复的完整正文'), ...patch }, '恢复.txt')
  return attempted ? ledger.update(entry, { attempted: true }) : entry
}
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('crypto', webcrypto); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  sources = new Map(); receipts = new Map(); files = new Map()
  folders = [{ id: folderId, parent_id: '', title: '工作', is_folder: true, is_deleted: false }, { id: childId, parent_id: folderId, title: '项目', is_folder: true, is_deleted: false }]
  listAllFiles.mockReset(); listAllFiles.mockImplementation(async () => folders.map(folder => ({ ...folder })))
  api.mockReset(); api.mockImplementation(async (path, init = {}) => {
    const id = path.split('/').at(-1)
    if (init.method !== 'POST') return receipts.get(id) || { found: false, request_id: id }
    const p = JSON.parse(init.body), fileId = crypto.randomUUID()
    const receipt = { found: true, request_id: id, payload_sha256: await importPayloadHash(p), file_id: fileId, title: p.title, parent_id: p.parent_id, state: 'available', created_at: 1 }
    receipts.set(id, receipt); files.set(fileId, { id: fileId, ...p })
    return { status: 'committed', receipt }
  })
  native = { getPathForFile: vi.fn(file => file.fixturePath), importPaths: vi.fn(async paths => ({ success: true, results: paths.map(path => sources.get(path)) })), cancelImport: vi.fn(async () => ({ success: true })) }
  window.electronAPI = native
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  onClose = vi.fn(() => root.render(null)); onChanged = vi.fn(); onOpenNote = vi.fn(async () => true)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.clear(); delete window.electronAPI; delete globalThis.IS_REACT_ACT_ENVIRONMENT; vi.unstubAllGlobals() })

test('menu workspace and file preview never POST; the real file input uses getPathForFile and native importPaths', async () => {
  await mount(); expect(control('input').accept).toBe('.md,.txt,.docx,.doc,.xlsx,.xls'); expect(control('input').multiple).toBe(true)
  await choose([source('/tmp/正文.txt', '<script>unsafe()</script>\n原文🙂')])
  expect(native.getPathForFile).toHaveBeenCalledTimes(1); expect(native.importPaths).toHaveBeenCalledTimes(1)
  expect(native.importPaths.mock.calls[0][0]).toEqual(['/tmp/正文.txt']); expect(native.importPaths.mock.calls[0][1].requestId).toMatch(/^[a-f0-9-]{36}$/)
  expect(control('preview').textContent).toContain('<script>unsafe()</script>'); expect(host.querySelector('script')).toBeNull()
  expect(writes()).toHaveLength(0); expect(records()).toHaveLength(0)
})
test('initial native drop parses once under StrictMode and callback rerenders do not restart a batch', async () => {
  const path = source('/tmp/拖入.md', '# 标题\n\n**内容**', { contentType: 'markdown' })
  await mount({ initialPaths: [path] }); expect(currentRows()).toHaveLength(1); expect(native.importPaths).toHaveBeenCalledTimes(1)
  await mount({ initialPaths: [path], onChanged: vi.fn() }); expect(native.importPaths).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0)
})
test('explicit confirmation freezes the whole batch first, uses edited title and full destination, and preserves partial success', async () => {
  const original = api.getMockImplementation()
  api.mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      expect(records()).toHaveLength(2)
      const p = JSON.parse(init.body)
      if (p.title === '同名.txt') return { status: 'rejected', request_id: path.split('/').at(-1), reason: 'name-conflict', message: '目标位置存在同名项目' }
    }
    return original(path, init)
  })
  await mount(); await choose([source('/tmp/一.txt'), source('/tmp/同名.txt')])
  const one = findRow('一.txt'); expect([...control('destination', one).options].map(option => option.textContent)).toContain('我的笔记 / 工作 / 项目')
  await fill('title', '修改后的标题', one); await fill('destination', childId, one); await click('confirm')
  expect(state(findRow('一.txt'))).toBe('committed'); expect(state(findRow('同名.txt'))).toBe('rejected')
  expect(JSON.parse(writes()[0][1].body)).toMatchObject({ title: '修改后的标题', parent_id: childId })
  expect(onChanged).toHaveBeenCalledTimes(1); expect(onOpenNote).not.toHaveBeenCalled(); expect(writes()).toHaveLength(2)
})
test('selected duplicate names are rejected before any ledger write using SQLite ASCII case folding', async () => {
  await mount(); await choose([source('/tmp/first.txt'), source('/tmp/second.txt')])
  await fill('title', 'Same Title', findRow('first.txt')); await fill('title', 'sAME tITLE', findRow('second.txt')); await click('confirm')
  expect(host.textContent).toContain('同一目录有重复标题'); expect(writes()).toHaveLength(0); expect(records()).toHaveLength(0)
  await fill('destination', childId, findRow('second.txt')); await click('confirm'); expect(writes()).toHaveLength(2)
})
test('invalid title and IME confirmation never send early or truncate Chinese input', async () => {
  await mount(); await choose([source('/tmp/标题.txt')]); const row = findRow('标题.txt'), input = control('title', row)
  await fill('title', 'bad/name', row); await click('confirm'); expect(writes()).toHaveLength(0); expect(host.textContent).toContain('标题须为')
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  const long = '汉'.repeat(256); await fill('title', long, row); expect(input.value).toBe(long); expect(control('confirm').disabled).toBe(true)
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))); expect(onClose).not.toHaveBeenCalled()
  await fill('title', '组合结束标题', row)
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '题' })))
  await click('confirm'); expect(JSON.parse(writes()[0][1].body).title).toBe('组合结束标题')
})
test('directory read failure disables confirmation instead of assuming root, and explicit refresh recovers', async () => {
  listAllFiles.mockRejectedValueOnce(Error('offline')); await mount(); await choose([source('/tmp/目录.txt')])
  expect(control('confirm').disabled).toBe(true); expect(control('destination').disabled).toBe(true); expect(host.textContent).toContain('未采用不完整的目录')
  expect(writes()).toHaveLength(0); await click('folders-refresh'); expect(control('confirm').disabled).toBe(false)
  expect(listAllFiles.mock.calls.every(([q, options]) => q === '' && options.strict === true && options.signal)).toBe(true)
})
test('a disappeared selected folder is a definite rejection; revision retains preview and explicitly commits corrected placement', async () => {
  let missing = true; const original = api.getMockImplementation()
  api.mockImplementation(async (path, init) => init?.method === 'POST' && JSON.parse(init.body).parent_id === childId && missing ? { status: 'rejected', request_id: path.split('/').at(-1), reason: 'folder-unavailable', message: '原目录已经不可用' } : original(path, init))
  await mount(); await choose([source('/tmp/失效目录.txt', '保留全部正文')]); await fill('destination', childId); await click('confirm')
  const oldId = control('workspace').querySelector('[data-local-import-row]').getAttribute('data-local-import-request-id')
  expect(state(findRow('失效目录.txt'))).toBe('rejected'); await click('revise'); expect(control('preview').textContent).toBe('保留全部正文'); expect(records()).toHaveLength(0)
  folders = folders.filter(folder => folder.id !== childId); await click('folders-refresh'); expect(control('destination').selectedOptions[0].textContent).toContain('原目录已不可用')
  await fill('destination', folderId); missing = false; await click('confirm')
  expect(state(findRow('失效目录.txt'))).toBe('committed'); expect(writes()).toHaveLength(2); expect(writes()[1][0].endsWith(oldId)).toBe(false)
  expect(JSON.parse(writes()[1][1].body).content).toBe(JSON.parse(writes()[0][1].body).content)
})
test('lost POST response remains frozen; read-only recovery confirms exactly the original request', async () => {
  const original = api.getMockImplementation()
  api.mockImplementation(async (path, init) => { const result = await original(path, init); if (init?.method === 'POST') throw Error('lost response'); return result })
  await mount(); await choose([source('/tmp/未知.txt')]); await click('confirm')
  const row = findRow('未知.txt'), id = row.getAttribute('data-local-import-request-id')
  expect(state(row)).toBe('unknown'); expect(control('title', row).disabled).toBe(true); expect(control('clear').disabled).toBe(true); expect(control('cancel', row)).toBeNull()
  await click('refresh', row); expect(state(findRow('未知.txt'))).toBe('committed'); expect(writes()).toHaveLength(1); expect(records()[0].value.requestId).toBe(id)
  expect(onChanged).toHaveBeenCalledTimes(1)
})
test('explicit continuation reuses the original ID and exact payload after unresolved readback', async () => {
  const original = api.getMockImplementation(); let fail = true
  api.mockImplementation(async (path, init) => { if (init?.method === 'POST' && fail) throw Error('before response'); return original(path, init) })
  await mount(); await choose([source('/tmp/重试.txt')]); await click('confirm'); const first = writes()[0]
  await click('refresh'); expect(writes()).toHaveLength(1); fail = false; await click('retry')
  expect(writes()).toHaveLength(2); expect(writes()[1][0]).toBe(first[0]); expect(writes()[1][1].body).toBe(first[1].body); expect(state(findRow('重试.txt'))).toBe('committed')
})
test('stop aborts a held first POST, retains all selected content, and never sends the second item late', async () => {
  let release; const original = api.getMockImplementation()
  api.mockImplementation(async (path, init) => { const value = await original(path, init); return init?.method === 'POST' ? new Promise(resolve => { release = () => resolve(value) }) : value })
  await mount(); await choose([source('/tmp/首项.txt'), source('/tmp/后项.txt')]); await click('confirm', host, false)
  await until(() => !!release); expect(records()).toHaveLength(2)
  await click('stop'); expect(state(findRow('首项.txt'))).toBe('unknown'); expect(state(findRow('后项.txt'))).toBe('pending')
  await act(async () => release()); await pause(); expect(writes()).toHaveLength(1); expect(onChanged).not.toHaveBeenCalled()
  await click('close'); await mount(); expect(writes()).toHaveLength(1); expect(currentRows()).toHaveLength(2)
  await click('refresh', findRow('首项.txt')); expect(state(findRow('首项.txt'))).toBe('committed')
  await click('cancel', findRow('后项.txt')); expect(currentRows()).toHaveLength(1); expect(writes()).toHaveLength(1)
})
test('closing a held parse cancels native work and late converted content cannot reopen or write', async () => {
  let release
  const path = source('/tmp/迟到.txt')
  native.importPaths.mockImplementation(() => new Promise(resolve => { release = () => resolve({ success: true, results: [sources.get(path)] }) }))
  await mount(); await choose([path], false); await until(() => !!release); const parserId = native.importPaths.mock.calls[0][1].requestId
  await click('close'); expect(native.cancelImport).toHaveBeenCalledWith(parserId)
  await act(async () => release()); await pause(); expect(control('workspace')).toBeNull(); expect(records()).toHaveLength(0); expect(writes()).toHaveLength(0); expect(onChanged).not.toHaveBeenCalled()
})
test('restart only shows persisted requests, and initial dropped files cannot replace them', async () => {
  const saved = await seed(); const path = source('/tmp/新的拖入.txt')
  await mount({ initialPaths: [path] }); expect(native.importPaths).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled(); expect(currentRows()).toHaveLength(1)
  expect(currentRows()[0].getAttribute('data-local-import-request-id')).toBe(saved.value.requestId); expect(host.textContent).toContain('未覆盖原批次'); expect(control('input').disabled).toBe(true)
})
test('quota failure blocks all POST and a complete reread safely restores an unsent preview', async () => {
  await mount(); await choose([source('/tmp/额度.txt')]); const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw Error('quota') })
  await click('confirm'); expect(writes()).toHaveLength(0); expect(host.textContent).toContain('可靠保存'); expect(control('confirm').disabled).toBe(true)
  spy.mockRestore(); await click('ledger-refresh'); expect(currentRows()).toHaveLength(1); expect(state(currentRows()[0])).toBe('prepared'); await click('confirm'); expect(writes()).toHaveLength(1)
})
test('successful reservation write with failed readback never duplicates the original preview when records are reloaded', async () => {
  await mount(); await choose([source('/tmp/校验失败.txt')]); const originalSet = localStorage.setItem.bind(localStorage), originalGet = localStorage.getItem.bind(localStorage)
  let failNextRead = false
  const writeSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => { originalSet(key, value); failNextRead = true })
  const readSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(key => { if (failNextRead) { failNextRead = false; throw Error('read-back unavailable') }; return originalGet(key) })
  await click('confirm'); expect(writes()).toHaveLength(0); const originalId = currentRows()[0].getAttribute('data-local-import-request-id'); expect(originalId).toBeTruthy()
  writeSpy.mockRestore(); readSpy.mockRestore(); await click('ledger-refresh')
  expect(currentRows()).toHaveLength(1); expect(state(currentRows()[0])).toBe('pending'); expect(currentRows()[0].getAttribute('data-local-import-request-id')).toBe(originalId)
  expect(control('confirm').disabled).toBe(true); await click('retry'); expect(writes()).toHaveLength(1); expect(writes()[0][0]).toContain(originalId); expect(records()).toHaveLength(1)
})
test('corrupt storage is visible and can restore only a valid same-request backup without automatically sending', async () => {
  const entry = await seed(); localStorage.setItem(entry.key, '{broken')
  await mount(); expect(control('corrupt')).toBeTruthy(); expect(control('input').disabled).toBe(true); expect(api).not.toHaveBeenCalled()
  await fill('recovery-input', '{wrong'); await click('restore-record'); expect(host.textContent).toContain('备份结构无效'); expect(localStorage.getItem(entry.key)).toBe('{broken')
  await fill('recovery-input', entry.raw); await click('restore-record')
  expect(control('corrupt')).toBeNull(); expect(currentRows()).toHaveLength(1); expect(currentRows()[0].getAttribute('data-local-import-request-id')).toBe(entry.value.requestId); expect(api).not.toHaveBeenCalled()
})
test('parser per-file errors and conversion warnings remain separate while valid selection can complete', async () => {
  await mount(); const bad = source('/tmp/坏.doc', '', { error: true, success: false, message: '文件无法读取', code: 'invalid-document' })
  const good = source('/tmp/好.docx', '保留可转换内容', { warnings: ['图片和版式未导入'], format: 'docx' })
  await choose([bad, good]); expect(state(findRow('坏.doc'))).toBe('error'); expect(host.textContent).toContain('图片和版式未导入')
  await click('confirm'); expect(writes()).toHaveLength(1); expect(state(findRow('好.docx'))).toBe('committed'); expect(state(findRow('坏.doc'))).toBe('error')
})
test('payload identity conflict has no revise, clear or new-ID action', async () => {
  api.mockImplementation(async (path, init) => init?.method === 'POST' ? { status: 'rejected', request_id: path.split('/').at(-1), reason: 'payload-mismatch', message: '请求身份冲突' } : { found: false, request_id: path.split('/').at(-1) })
  await mount(); await choose([source('/tmp/身份.txt')]); await click('confirm')
  expect(state(findRow('身份.txt'))).toBe('rejected'); expect(control('revise')).toBeNull(); expect(control('retry')).toBeNull(); expect(control('clear').disabled).toBe(true); expect(control('input').disabled).toBe(true)
  await click('refresh'); expect(writes()).toHaveLength(1)
})
test('deleted and missing recovered targets are never recreated or offered for opening', async () => {
  const entry = await seed(), p = entry.value.payload
  receipts.set(entry.value.requestId, { found: true, request_id: entry.value.requestId, payload_sha256: entry.value.payloadHash, file_id: crypto.randomUUID(), title: p.title, parent_id: p.parent_id, created_at: 1, state: 'deleted' })
  await mount(); await click('refresh'); expect(control('open')).toBeNull(); expect(host.textContent).toContain('不会重新创建'); expect(writes()).toHaveLength(0)
  await click('clear'); expect(records()).toHaveLength(0); expect(control('input').disabled).toBe(false)
})
test('opening uses the original guarded opener and only closes after a true result; cancellation leaves the workspace', async () => {
  onOpenNote.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await mount(); await choose([source('/tmp/打开.txt')]); await click('confirm'); await click('open')
  expect(onClose).not.toHaveBeenCalled(); expect(control('workspace')).toBeTruthy()
  const options = onOpenNote.mock.calls[0][1]; expect(options.signal).toBeInstanceOf(AbortSignal); expect(options.shouldSelect).toBeTypeOf('function'); expect(options.shouldSelect()).toBe(false)
  await click('open'); expect(onClose).toHaveBeenCalledTimes(1); expect(control('workspace')).toBeNull(); expect(writes()).toHaveLength(1)
})
test('a stopped guarded open invalidates its shouldSelect callback and ignores a late true result', async () => {
  let finish
  onOpenNote.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await mount(); await choose([source('/tmp/晚打开.txt')]); await click('confirm'); await click('open', host, false)
  await until(() => !!finish); const options = onOpenNote.mock.calls[0][1]; expect(options.shouldSelect()).toBe(true)
  await click('stop'); expect(options.signal.aborted).toBe(true); expect(options.shouldSelect()).toBe(false)
  await act(async () => finish(true)); expect(onClose).not.toHaveBeenCalled(); expect(control('workspace')).toBeTruthy()
})
test('initial focus and Tab boundary stay in the workspace, IME Escape is ignored, and normal Escape returns focus to the entrance', async () => {
  const entrance = document.createElement('button'); entrance.textContent = '入口'; document.body.append(entrance); entrance.focus()
  try {
    await mount(); expect(document.activeElement).toBe(control('close'))
    const first = control('close'), last = control('ledger-refresh')
    await act(async () => { first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })) }); expect(document.activeElement).toBe(last)
    await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))); expect(document.activeElement).toBe(first)
    await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))); expect(onClose).not.toHaveBeenCalled()
    await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(onClose).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(entrance)
  } finally { entrance.remove() }
})
test('Escape belongs to an overlaid original save confirmation while guarded opening is pending', async () => {
  let resolveOpen; onOpenNote.mockImplementation(() => new Promise(resolve => { resolveOpen = resolve }))
  await mount(); await choose([source('/tmp/护栏.txt')]); await click('confirm'); await click('open', host, false); await until(() => !!resolveOpen)
  const dialog = document.createElement('div'); dialog.className = 'consumer-confirm-modal'; document.body.append(dialog)
  try {
    const escape = vi.fn(); document.addEventListener('keydown', escape)
    await act(async () => control('close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(escape).toHaveBeenCalledTimes(1); expect(onClose).not.toHaveBeenCalled(); expect(onOpenNote.mock.calls[0][1].shouldSelect()).toBe(true)
    document.removeEventListener('keydown', escape)
    await act(async () => resolveOpen(false)); await settle()
  } finally { dialog.remove() }
})
test('missing desktop bridge is an explicit blocked state, not a browser file-import fallback', async () => {
  delete window.electronAPI; await mount({ initialPaths: ['/tmp/unavailable.txt'] })
  expect(host.textContent).toContain('需要桌面客户端'); expect(control('input').disabled).toBe(true); expect(native.importPaths).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0)
})
test('clearing completed local records leaves imported files intact and enables a new complete batch', async () => {
  await mount(); await choose([source('/tmp/完成.txt')]); await click('confirm'); const ids = [...files.keys()]
  await click('clear'); expect(records()).toHaveLength(0); expect([...files.keys()]).toEqual(ids); expect(control('input').disabled).toBe(false)
  await choose([source('/tmp/下一批.txt')]); await click('confirm'); expect(writes()).toHaveLength(2); expect(files.size).toBe(2)
})
test('normal persisted records expose a valid backup before damage, and that export restores the same frozen request', async () => {
  const entry = await seed(); let blob, filename
  vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value; return 'blob:local-import-fixture' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { filename = this.download })
  await mount(); await click('export-record')
  expect(filename).toContain(entry.value.requestId); const raw = await blob.text(); expect(JSON.parse(raw)).toEqual(entry.value); expect(api).not.toHaveBeenCalled()
  localStorage.setItem(entry.key, '{damaged'); await click('ledger-refresh'); expect(control('corrupt')).toBeTruthy()
  await fill('recovery-input', raw); await click('restore-record'); expect(records()[0].value.requestId).toBe(entry.value.requestId); expect(records()[0].value.payload).toEqual(entry.value.payload); expect(api).not.toHaveBeenCalled()
})
test('closing a held receipt lookup ignores its late confirmation and a reopened workspace performs no automatic request', async () => {
  const entry = await seed(); let release
  api.mockImplementation(() => new Promise(resolve => { release = () => resolve({ found: true, request_id: entry.value.requestId, payload_sha256: entry.value.payloadHash, file_id: crypto.randomUUID(), title: entry.value.payload.title, parent_id: '', created_at: 1, state: 'available' }) }))
  await mount(); await click('refresh', host, false); await until(() => !!release); await click('close')
  await act(async () => release()); await pause(); expect(onChanged).not.toHaveBeenCalled(); expect(onOpenNote).not.toHaveBeenCalled(); expect(control('workspace')).toBeNull()
  await mount(); expect(api).toHaveBeenCalledTimes(1); expect(state(currentRows()[0])).toBe('unknown'); expect(records()[0].value.outcome).toBeNull()
})
test('unsafe imported links and mismatched native source identities are rejected during preview without writes', async () => {
  await mount(); await choose([source('/tmp/危险.md', '[危险](javascript:alert)', { contentType: 'markdown' })]); expect(state(currentRows()[0])).toBe('error'); expect(writes()).toHaveLength(0); expect(records()).toHaveLength(0)
  await click('reset'); source('/tmp/正确.txt')
  native.importPaths.mockResolvedValueOnce({ success: true, results: [{ ...sources.get('/tmp/正确.txt'), originalPath: '/tmp/其他.txt' }] })
  await choose(['/tmp/正确.txt']); expect(state(currentRows()[0])).toBe('error'); expect(host.textContent).toContain('文件身份不匹配'); expect(writes()).toHaveLength(0)
})
test('missing or wrong Office encoding metadata stays a visible per-file preflight error with no ledger or POST', async () => {
  const missing = source('/tmp/缺标记.docx'); delete sources.get(missing).tableCellEncoding
  const wrong = source('/tmp/错标记.xlsx', '正文', { tableCellEncoding: 'base64-utf8-v2' })
  const wrongType = source('/tmp/错类型.xls', '正文', { contentType: 'text' })
  const mismatched = source('/tmp/错格式.docx', '正文', { format: 'xlsx' })
  const missingPrefix = source('/tmp/缺前缀.docx'); delete sources.get(missingPrefix).officeTextPrefix
  const wrongPrefix = source('/tmp/错前缀.xlsx', '正文', { officeTextPrefix: 'NPIMPORT00' })
  await mount(); await choose([missing, wrong, wrongType, mismatched, missingPrefix, wrongPrefix])
  expect(currentRows()).toHaveLength(6); expect(currentRows().every(row => state(row) === 'error')).toBe(true)
  expect(host.textContent).toContain('Office 表格编码标记缺失或无效'); expect(host.textContent).toContain('扩展名不一致')
  expect(control('confirm').disabled).toBe(true); expect(writes()).toHaveLength(0); expect(records()).toHaveLength(0)
})
test('ordinary Markdown sentinel text remains literal and a forged Office decoding flag is rejected', async () => {
  const marker = 'NPIMPORT0CELLV1:' + Buffer.from('原单元格', 'utf8').toString('base64')
  const plain = source('/tmp/普通.md', '| 原文 |\n| --- |\n| ' + marker + ' |')
  const forged = source('/tmp/伪装.md', '| 原文 |\n| --- |\n| ' + marker + ' |', { tableCellEncoding: 'base64-utf8-v1' })
  const forgedPrefix = source('/tmp/伪装前缀.md', '| 原文 |\n| --- |\n| ' + marker + ' |', { officeTextPrefix: 'NPIMPORT0' })
  await mount(); await choose([plain, forged, forgedPrefix])
  expect(state(findRow('普通.md'))).toBe('prepared'); expect(control('preview', findRow('普通.md')).textContent).toContain(marker)
  expect(state(findRow('伪装.md'))).toBe('error'); expect(host.textContent).toContain('不允许携带 Office 表格编码标记'); expect(writes()).toHaveLength(0)
  expect(state(findRow('伪装前缀.md'))).toBe('error'); expect(records()).toHaveLength(0)
})
test('encoded Office literal cells preview and commit exact backslashes, pipes, dollar text, HTML text and Unicode once', async () => {
  const officeTextPrefix = 'NPIMPORT17'
  const cells = ['C:\\temp\\file.txt', 'A\\|B', '$100$', 'literal <br> tag', '  中文🙂\n第二行  ', officeTextPrefix + 'CELLV1:VGV4dA==']
  const encode = value => officeTextPrefix + 'CELLV1:' + Buffer.from(value, 'utf8').toString('base64')
  const markdown = '| ' + encode('原始内容') + ' |\n| --- |\n' + cells.map(value => '| ' + encode(value) + ' |').join('\n')
  await mount(); await choose([source('/tmp/字面值.xlsx', markdown, { officeTextPrefix })])
  expect(state(currentRows()[0])).toBe('prepared'); for (const value of cells) expect(control('preview').textContent).toContain(value)
  expect(writes()).toHaveLength(0); await click('confirm')
  const doc = JSON.parse(JSON.parse(writes()[0][1].body).content), table = doc.root.children.find(node => node.type === 'table')
  const text = node => node.type === 'linebreak' ? '\n' : node.text ?? node.children?.map(text).join('') ?? ''
  expect(table.children.slice(1).map(row => row.children.map(text))).toEqual(cells.map(value => [value]))
  expect(JSON.stringify(doc)).not.toContain('"type":"formula"'); expect(host.querySelector('br')).toBeNull()
})
