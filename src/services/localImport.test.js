import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { normalizeImportedContent } from './importContent'
import {
  LOCAL_IMPORT_LIMIT, LOCAL_IMPORT_PREFIX, canCancelImport, canClearImport,
  createImportLedger, createImportOperations, importFolders, importLink,
  importPayloadHash, importTitle, validateImportedBody, validateNativeImportResult,
} from './localImport.mjs'

const id = '11111111-1111-4111-8111-111111111111'
const fileId = '22222222-2222-4222-8222-222222222222'
const folderId = '33333333-3333-4333-8333-333333333333'
const content = text => normalizeImportedContent({ title: '样本.txt', content: text, contentType: 'text' })
const payload = (patch = {}) => ({ title: '导入标题', parent_id: '', content: content('完整正文\n🙂'), ...patch })
const storage = () => {
  const map = new Map()
  return { map, get length() { return map.size }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }
}
const receipt = (entry, patch = {}) => ({ found: true, request_id: entry.value.requestId, payload_sha256: entry.value.payloadHash, file_id: fileId, title: entry.value.payload.title, parent_id: entry.value.payload.parent_id, state: 'available', created_at: 1, ...patch })
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())

test('real normalized rich content validates and its plain preview retains table, code and formula text', () => {
  const rich = normalizeImportedContent({ title: '样本.md', contentType: 'markdown', content: '# 标题\n\n**加粗** [链接](https://example.com/a)\n\n- 项一\n- 项二\n\n> 引用\n\n| 甲 | 乙 |\n| --- | --- |\n| A | B |\n\n```javascript\nconst n = 1\n```\n\n$x^2$\n\n---' })
  const parsed = validateImportedBody(rich)
  for (const text of ['标题', '加粗', '链接', '项一', '项二', '引用', '甲', '乙', 'A', 'B', 'const n = 1', 'x^2']) expect(parsed.preview).toContain(text)
  expect(parsed.content).toBe(rich)
})
test('validation rejects unsupported active nodes, unsafe styles, broken JSON and oversize documents without truncation', () => {
  for (const type of ['image', 'embed', 'attachment', 'wiki-link']) {
    const doc = JSON.parse(content('正文')); doc.root.children[0].children.push({ type, version: 1, url: 'https://example.com' })
    expect(() => validateImportedBody(JSON.stringify(doc))).toThrow()
  }
  const styled = JSON.parse(content('正文')); styled.root.children[0].children[0].style = 'background:url(https://example.com)'
  expect(() => validateImportedBody(JSON.stringify(styled))).toThrow('样式')
  expect(() => validateImportedBody('{"root":')).toThrow()
  expect(() => validateImportedBody(content('a'.repeat(LOCAL_IMPORT_LIMIT)))).toThrow('2 MiB')
})
test('unpaired Unicode, deep trees and node expansion budgets are rejected', () => {
  expect(() => validateImportedBody(content('safe').replace('safe', '\\ud800'))).toThrow('无效字符')
  const doc = JSON.parse(content('x')); let cursor = doc.root
  for (let i = 0; i < 65; i++) { cursor.children = [{ type: 'paragraph', version: 1, children: [] }]; cursor = cursor.children[0] }
  expect(() => validateImportedBody(JSON.stringify(doc))).toThrow('结构上限')
  const many = JSON.parse(content('x')); many.root.children[0].children = Array.from({ length: 20001 }, () => ({ type: 'linebreak', version: 1 }))
  expect(() => validateImportedBody(JSON.stringify(many))).toThrow('结构上限')
})
test('safe link allowlist rejects executable protocols, credentials, invisible characters and network paths', () => {
  for (const value of ['https://example.com/a', 'http://example.com', 'mailto:a@example.com', 'tel:+123', '#章节', '../笔记', '/本地路径']) expect(importLink(value)).toBe(value)
  for (const value of ['javascript:alert(1)', 'data:text/html,a', 'vbscript:x', 'file:///tmp/a', '//example.com', '\\remote', 'java\nscript:x', 'https://a:b@example.com', 'mailto:', 'https://']) expect(() => importLink(value)).toThrow()
})
test('title checks preserve Chinese composition and reject reserved or malformed names', () => {
  expect(importTitle('中文🙂标题')).toBe('中文🙂标题')
  expect(importTitle('字'.repeat(255))).toHaveLength(255)
  for (const value of ['', ' a', 'a ', 'a/b', '__tpl__secret', 'x\u0085y', '字'.repeat(256), '\ud800']) expect(() => importTitle(value)).toThrow()
})
test('folder choices show full paths and reject incomplete, deleted, duplicate or cyclic indices', () => {
  const a = { id: folderId, parent_id: '', title: '工作', is_folder: true, is_deleted: false }
  const b = { id: 'legacy-folder', parent_id: folderId, title: '项目', is_folder: true, is_deleted: false }
  expect(importFolders([b, a]).find(row => row.id === b.id).label).toBe('我的笔记 / 工作 / 项目')
  expect(importFolders([])).toEqual([{ id: '', label: '我的笔记（根目录）' }])
  for (const files of [null, [b], [a, a], [{ ...a, is_deleted: true }], [{ ...a, parent_id: b.id }, b]]) expect(() => importFolders(files)).toThrow()
})
test('payload hash uses exact title, parent, content bytes with NUL delimiters', async () => {
  const p = payload({ title: '中文🙂', parent_id: folderId })
  expect(await importPayloadHash(p)).toBe(createHash('sha256').update(p.title + '\0' + p.parent_id + '\0' + p.content).digest('hex'))
})
test('reservation verifies durable storage and freezes all identity and payload fields before requests', async () => {
  const s = storage(), ledger = createImportLedger(s, () => id, () => 1), entry = await ledger.reserve(payload(), '源文件.txt')
  expect(entry.value.attempted).toBe(false); expect(canCancelImport(entry)).toBe(true)
  expect(JSON.parse(s.getItem(LOCAL_IMPORT_PREFIX + id))).toEqual(entry.value)
  expect(Object.isFrozen(entry.value.payload)).toBe(true)
  expect(() => ledger.update(entry, { payload: payload({ title: 'changed' }) })).toThrow('不可修改')
})
test('quota or readback failure prevents reservation and any request', async () => {
  for (const mode of ['quota', 'readback']) {
    const s = storage(), set = s.setItem
    s.setItem = mode === 'quota' ? () => { throw Error('quota') } : (key, value) => set(key, value + 'corrupt')
    const ledger = createImportLedger(s)
    await expect(ledger.reserve(payload())).rejects.toThrow('可靠保存')
  }
})
test('corrupt records block new reservations without dropping their original bytes', async () => {
  const s = storage(), key = LOCAL_IMPORT_PREFIX + id; s.setItem(key, '{broken')
  const ledger = createImportLedger(s)
  expect(ledger.list()[0].error).toContain('损坏')
  await expect(ledger.reserve(payload())).rejects.toThrow('损坏')
  expect(s.getItem(key)).toBe('{broken')
})
test('fingerprint damage is visible through inspection, and operations cannot send it', async () => {
  const s = storage(), ledger = createImportLedger(s, () => id), original = await ledger.reserve(payload())
  const damaged = { ...original.value, payload: { ...original.value.payload, content: content('changed') } }
  s.setItem(original.key, JSON.stringify(damaged))
  const entry = ledger.list()[0], request = vi.fn()
  expect((await ledger.inspect())[0].error).toContain('指纹')
  const result = await createImportOperations(request, ledger).run(entry, { send: true })
  expect(result.status).toBe('unknown'); expect(request).not.toHaveBeenCalled()
})
test('same-ID lost-response retry checks the receipt and never creates another note', async () => {
  const s = storage(), ledger = createImportLedger(s, () => id), entry = await ledger.reserve(payload())
  let saved = null, posts = 0
  const request = vi.fn(async (path, init) => {
    expect(path).toBe('/api/local-import/requests/' + id)
    if (init.method === 'POST') { posts++; expect(JSON.parse(s.getItem(entry.key)).attempted).toBe(true); saved = receipt(entry); throw Error('response lost') }
    return saved || { found: false, request_id: id }
  })
  const operations = createImportOperations(request, ledger)
  const first = await operations.run(entry, { send: true })
  expect(first.status).toBe('unknown'); expect(first.entry.value.attempted).toBe(true); expect(canClearImport(first.entry)).toBe(false)
  const recovered = await operations.run(first.entry, { send: true })
  expect(recovered.status).toBe('committed'); expect(posts).toBe(1); expect(recovered.receipt.file_id).toBe(fileId)
})
test('an explicit same-ID continuation posts identical frozen payload only after a clean not-found read', async () => {
  const ledger = createImportLedger(storage(), () => id), entry = await ledger.reserve(payload())
  let posts = 0
  const request = vi.fn(async (_, init) => {
    if (init.method !== 'POST') return { found: false, request_id: id }
    posts++; expect(JSON.parse(init.body)).toEqual(entry.value.payload)
    if (posts === 1) throw Error('unavailable')
    return { status: 'committed', receipt: receipt(entry) }
  })
  const operations = createImportOperations(request, ledger), unknown = await operations.run(entry, { send: true })
  const readOnly = await operations.run(unknown.entry)
  expect(readOnly.status).toBe('unknown'); expect(posts).toBe(1)
  expect((await operations.run(readOnly.entry, { send: true })).status).toBe('committed'); expect(posts).toBe(2)
  expect(new Set(request.mock.calls.map(([path]) => path)).size).toBe(1)
})
test('ordinary API errors and malformed or mismatched receipts stay unresolved', async () => {
  for (const result of [{ status: 'committed', receipt: { found: true } }, { status: 'rejected', request_id: fileId, reason: 'name-conflict', message: '冲突' }, { status: 'rejected', request_id: id, reason: 'unknown', message: '未知' }]) {
    const ledger = createImportLedger(storage(), () => id), entry = await ledger.reserve(payload())
    const run = await createImportOperations(async (_, init) => init.method === 'POST' ? result : { found: false, request_id: id }, ledger).run(entry, { send: true })
    expect(run.status).toBe('unknown'); expect(run.entry.value.outcome).toBeNull()
  }
  for (const patch of [{ request_id: fileId }, { payload_sha256: '0'.repeat(64) }, { title: '其他' }, { parent_id: folderId }, { state: 'unexpected' }, { file_id: 'wrong' }]) {
    const ledger = createImportLedger(storage(), () => id), entry = await ledger.reserve(payload()), request = vi.fn(async () => receipt(entry, patch))
    expect((await createImportOperations(request, ledger).run(entry, { send: true })).status).toBe('unknown')
    expect(request.mock.calls.every(([, init]) => !init.method)).toBe(true)
  }
})
test('deleted and missing destinations are acknowledged without recreating or overwriting them', async () => {
  for (const state of ['deleted', 'missing']) {
    const ledger = createImportLedger(storage(), () => id), entry = await ledger.reserve(payload()), request = vi.fn(async () => receipt(entry, { state }))
    const result = await createImportOperations(request, ledger).run(entry, { send: true })
    expect(result.status).toBe('committed'); expect(result.receipt.state).toBe(state)
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][1].method).toBeUndefined()
  }
})
test('confirmed success with a now-missing server receipt cannot turn into another POST', async () => {
  const ledger = createImportLedger(storage(), () => id), entry = await ledger.reserve(payload())
  const success = await createImportOperations(async () => receipt(entry), ledger).run(entry)
  const request = vi.fn(async () => ({ found: false, request_id: id }))
  const result = await createImportOperations(request, ledger).run(success.entry, { send: true })
  expect(result.status).toBe('unknown'); expect(request).toHaveBeenCalledTimes(1); expect(result.entry.value.outcome.status).toBe('committed')
})
test('known non-commit rejection is persisted and may be retired for explicit preflight correction', async () => {
  for (const reason of ['invalid-payload', 'name-conflict', 'folder-unavailable', 'payload-mismatch']) {
    const ledger = createImportLedger(storage(), () => id), entry = await ledger.reserve(payload())
    const response = { status: 'rejected', request_id: id, reason, message: '拒绝原因' }
    const request = vi.fn(async (_, init) => init.method === 'POST' ? response : { found: false, request_id: id })
    const operations = createImportOperations(request, ledger), rejected = await operations.run(entry, { send: true })
    expect(rejected.status).toBe('rejected'); expect(rejected.entry.value.outcome.reason).toBe(reason)
    const repeated = await operations.run(rejected.entry, { send: true })
    expect(repeated.status).toBe('rejected'); expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    if (reason === 'payload-mismatch') expect(() => ledger.remove(rejected.entry)).toThrow('身份冲突')
    else { ledger.remove(rejected.entry); expect(ledger.list()).toHaveLength(0) }
  }
})
test('a confirmed response remains confirmed if persisting its outcome fails', async () => {
  const s = storage(), ledger = createImportLedger(s, () => id), entry = await ledger.reserve(payload())
  const request = async (_, init) => {
    if (init.method !== 'POST') return { found: false, request_id: id }
    s.setItem = () => { throw Error('quota after commit') }
    return { status: 'committed', receipt: receipt(entry) }
  }
  const result = await createImportOperations(request, ledger).run(entry, { send: true })
  expect(result.status).toBe('committed'); expect(result.storageError).toContain('可靠保存'); expect(result.receipt.file_id).toBe(fileId)
  expect(ledger.list()[0].value.attempted).toBe(true)
})
test('failed attempt-marker persistence is checked before POST', async () => {
  const s = storage(), ledger = createImportLedger(s, () => id), entry = await ledger.reserve(payload()), request = vi.fn(async () => ({ found: false, request_id: id }))
  s.setItem = () => { throw Error('quota') }
  const result = await createImportOperations(request, ledger).run(entry, { send: true })
  expect(result.status).toBe('unknown'); expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][1].method).toBeUndefined()
})
test('aborting an adapter that ignores cancellation keeps a durable unknown intent and ignores its late response', async () => {
  const ledger = createImportLedger(storage(), () => id), entry = await ledger.reserve(payload()), controller = new AbortController()
  let release, started
  const startedPromise = new Promise(resolve => { started = resolve })
  const request = async (_, init) => init.method !== 'POST' ? { found: false, request_id: id } : new Promise(resolve => { release = () => resolve({ status: 'committed', receipt: receipt(entry) }); started() })
  const pending = createImportOperations(request, ledger).run(entry, { send: true, signal: controller.signal })
  await startedPromise; controller.abort()
  const stopped = await pending
  expect(stopped.status).toBe('unknown'); expect(stopped.entry.value.attempted).toBe(true); expect(stopped.entry.value.outcome).toBeNull()
  release(); await Promise.resolve(); expect(ledger.list()[0].value.outcome).toBeNull()
})
test('request budget terminates an unanswered GET without POST', async () => {
  const ledger = createImportLedger(storage(), () => id), entry = await ledger.reserve(payload()), request = vi.fn(() => new Promise(() => {}))
  const result = await createImportOperations(request, ledger, 15).run(entry, { send: true })
  expect(result.status).toBe('unknown'); expect(result.message).toContain('超时'); expect(request).toHaveBeenCalledTimes(1)
})
test('unstarted cancellation is durable across restart and refuses changed or attempted records', async () => {
  const s = storage(), ledger = createImportLedger(s, () => id), entry = await ledger.reserve(payload())
  const reopened = createImportLedger(s), recovered = reopened.list()[0]
  expect(canCancelImport(recovered)).toBe(true); reopened.cancel(recovered); expect(s.length).toBe(0)
  const next = await ledger.reserve(payload()), attempted = ledger.update(next, { attempted: true })
  expect(() => ledger.cancel(next)).toThrow('变化')
  expect(() => ledger.cancel(attempted)).toThrow('可能已经发送')
  expect(() => ledger.remove(attempted)).toThrow('结果仍未知')
  expect(() => ledger.read(entry)).toThrow()
})
test('restoration verifies key and content fingerprint, never silently deletes corrupt bytes, and requires readback', async () => {
  const s = storage(), ledger = createImportLedger(s, () => id), original = await ledger.reserve(payload())
  s.setItem(original.key, '{broken'); const broken = ledger.list()[0]
  const mismatched = { ...original.value, requestId: fileId }
  await expect(ledger.restore(broken, JSON.stringify(mismatched))).rejects.toThrow('标识')
  await expect(ledger.restore(broken, JSON.stringify({ ...original.value, payloadHash: '0'.repeat(64) }))).rejects.toThrow('指纹')
  expect(s.getItem(original.key)).toBe('{broken')
  const recovered = await ledger.restore(broken, original.raw)
  expect(recovered.value.requestId).toBe(id); expect(recovered.value.payload).toEqual(original.value.payload)
  expect(recovered.value.attempted).toBe(true); expect(canCancelImport(recovered)).toBe(false)
  expect((await ledger.inspect())[0].error).toBeUndefined()
})
test('restoration refuses replacement of an unknown request with a different valid payload', async () => {
  const s = storage(), ledger = createImportLedger(s, () => id), original = await ledger.reserve(payload())
  s.setItem(original.key, JSON.stringify({ ...original.value, version: 99 }))
  const broken = ledger.list()[0], replacement = payload({ title: '另一个标题' })
  await expect(ledger.restore(broken, JSON.stringify({ ...original.value, payload: replacement, payloadHash: await importPayloadHash(replacement) }))).rejects.toThrow('禁止替换')
  expect(s.getItem(original.key)).toBe(broken.raw)
})
test('record count and total normalized body are bounded before reservation', async () => {
  const s = storage(), ledger = createImportLedger(s)
  for (let i = 0; i < 20; i++) await ledger.reserve(payload({ title: '第' + i + '项' }))
  await expect(ledger.reserve(payload())).rejects.toThrow('上限')
  const second = createImportLedger(storage())
  await second.reserve(payload({ content: content('a'.repeat(1100000)) }))
  await expect(second.reserve(payload({ content: content('b'.repeat(1100000)) }))).rejects.toThrow('上限')
})
test('a successful setItem followed by failed verification preserves its allocated identity', async () => {
  const s = storage(), set = s.setItem, get = s.getItem
  let failNextRead = false
  s.setItem = (key, value) => { set(key, value); failNextRead = true }
  s.getItem = key => { if (failNextRead) { failNextRead = false; throw Error('read unavailable') }; return get(key) }
  const ledger = createImportLedger(s, () => id)
  let failure
  try { await ledger.reserve(payload()) } catch (error) { failure = error }
  expect(failure.localImportStorageFailure).toBe(true); expect(failure.entry.value.requestId).toBe(id)
  expect((await ledger.inspect())[0].value.requestId).toBe(id)
  expect(s.length).toBe(1)
})
test('a valid near-limit record with JSON escaping can be restored from its own full backup', async () => {
  const s = storage(), ledger = createImportLedger(s, () => id)
  const p = payload({ content: content('\\"'.repeat(340000)) }), original = await ledger.reserve(p)
  expect(new TextEncoder().encode(p.content).length).toBeLessThan(LOCAL_IMPORT_LIMIT)
  expect(new TextEncoder().encode(original.raw).length).toBeGreaterThan(LOCAL_IMPORT_LIMIT + 32768)
  s.setItem(original.key, '{broken')
  const restored = await ledger.restore(ledger.list()[0], original.raw)
  expect(restored.value.payload.content).toBe(p.content)
  expect(restored.value.payloadHash).toBe(original.value.payloadHash)
})
test('native Office results require the exact literal-cell encoding protocol and Markdown content type', () => {
  for (const format of ['docx', 'xlsx', 'xls']) {
    const item = { success: true, title: 'source.' + format, originalPath: '/tmp/source.' + format, format, contentType: 'markdown', content: '正文', tableCellEncoding: 'base64-utf8-v1', officeTextPrefix: 'NPIMPORT0', warnings: ['转换提示'] }
    expect(validateNativeImportResult(item)).toBe(item)
    for (const tableCellEncoding of [undefined, null, '', false, 'base64', 'base64-utf8-v2', ' base64-utf8-v1']) expect(() => validateNativeImportResult({ ...item, tableCellEncoding })).toThrow('编码标记')
    const missing = { ...item }; delete missing.tableCellEncoding
    expect(() => validateNativeImportResult(missing)).toThrow('编码标记')
    for (const officeTextPrefix of ['NPIMPORT0', 'NPIMPORT1', 'NPIMPORT999999']) expect(validateNativeImportResult({ ...item, officeTextPrefix }).officeTextPrefix).toBe(officeTextPrefix)
    for (const officeTextPrefix of [undefined, null, false, '', 'NPIMPORT', 'NPIMPORT00', 'NPIMPORT01', 'NPIMPORT-1', 'NPIMPORT1000000', ' NPIMPORT0', 'NPIMPORT0 ', 'NPIMPORT0\n', 'npimport0']) expect(() => validateNativeImportResult({ ...item, officeTextPrefix })).toThrow('编码标记')
    const missingPrefix = { ...item }; delete missingPrefix.officeTextPrefix
    expect(() => validateNativeImportResult(missingPrefix)).toThrow('编码标记')
    expect(() => validateNativeImportResult({ ...item, contentType: 'text' })).toThrow('编码标记')
  }
})
test('ordinary Markdown, TXT and legacy Word cannot activate the Office cell decoder', () => {
  for (const format of ['md', 'txt', 'doc']) {
    const item = { success: true, title: 'source.' + format, originalPath: '/tmp/source.' + format, format, contentType: format === 'md' ? 'markdown' : 'text', content: 'NPIMPORT0CELLV1:VGV4dA==' }
    expect(validateNativeImportResult(item)).toBe(item)
    for (const tableCellEncoding of [undefined, null, 'base64-utf8-v1']) expect(() => validateNativeImportResult({ ...item, tableCellEncoding })).toThrow('不允许')
    for (const officeTextPrefix of [undefined, null, 'NPIMPORT0']) expect(() => validateNativeImportResult({ ...item, officeTextPrefix })).toThrow('不允许')
  }
})
test('native format metadata must match the original file extension before its decoding mode is considered', () => {
  const item = { success: true, title: 'source.docx', originalPath: 'C:\\资料\\source.DOCX', format: 'docx', contentType: 'markdown', content: '正文', tableCellEncoding: 'base64-utf8-v1', officeTextPrefix: 'NPIMPORT0' }
  expect(validateNativeImportResult(item)).toBe(item)
  for (const format of ['md', 'txt', 'xlsx', 'DOCX', '', undefined]) expect(() => validateNativeImportResult({ ...item, format })).toThrow('扩展名不一致')
  expect(() => validateNativeImportResult({ ...item, originalPath: '/tmp/source.md' })).toThrow('扩展名不一致')
})
test('the shared native-result boundary retains raw content, warning and size checks before normalization', () => {
  const item = { success: true, title: 'source.txt', originalPath: '/tmp/source.txt', format: 'txt', contentType: 'text', content: '正文' }
  for (const patch of [{ content: null }, { contentType: 'html' }, { warnings: 'not-an-array' }, { warnings: Array(31).fill('warning') }, { warnings: ['a'.repeat(2001)] }, { content: 'a'.repeat(LOCAL_IMPORT_LIMIT + 1) }]) expect(() => validateNativeImportResult({ ...item, ...patch })).toThrow('转换格式无效')
})
