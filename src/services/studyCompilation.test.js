import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { createStudyCompilation, buildStudyCompilation } from './studyCompilation'
import { createCollectionStudyHub } from './collectionStudyHub'
import { createCollectionStudyStore } from './collectionStudy'
import { createSearchCollectionStore } from './searchCollections'
import { studyDraftKey } from './collectionStudyDrafts'
import { collectionReport, memoryStorage } from '../test/collectionFixtures'

let storage, source, study, hub, service, request, drafts, count
const config = patch => ({ title: '研究笔记', goal: '检查世界设定', group: 'collection', parentId: '', ...patch })
function add(name = '同名资料', size = 23) { const saved = source.save(name, collectionReport(size)); return source.list().entries.find(row => row.collection.id === saved.id) }
async function mark(entry, id = 'n22', note = '中文批注\n😀', status = 'revisit') { return study.saveNote(await study.load(entry, source), id, status, note, { sourceStore: source }) }
async function prepare(patch = {}) { const model = await hub.load(); return service.prepare(model, model.rows.filter(row => row.note).map(row => row.key), config(patch)) }
const posts = () => request.mock.calls.filter(([, init]) => init?.method === 'POST')
beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID, subtle: { digest: async (_algorithm, bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer } })
  storage = memoryStorage(); count = 0; drafts = new Map()
  source = createSearchCollectionStore({ storage: () => storage, createId: () => 'c' + ++count })
  study = createCollectionStudyStore({ storage: () => storage, locks: () => ({ request: (_name, _options, fn) => Promise.resolve().then(fn) }) })
  hub = createCollectionStudyHub({ storage: () => storage, sourceStore: source, studyStore: study })
  request = vi.fn(async (_url, init) => ({ id: 'new-note', ...JSON.parse(init.body), is_deleted: false }))
  service = createStudyCompilation({ hub, sourceStore: source, studyStore: study, drafts, request, now: () => new Date('2026-09-24T14:00:00.000Z') })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('retains same-note provenance across same-named collections without body reads or source writes', async () => {
  const a = add(), b = add(); await mark(a); await mark(b, 'n22', '第二批注')
  const before = Array.from({ length: storage.length }, (_, i) => [storage.key(i), storage.getItem(storage.key(i))])
  const preview = await prepare()
  expect(preview.count).toBe(2); expect(preview.groups).toHaveLength(2)
  expect(preview.content).toContain('中文批注'); expect(preview.content).toContain('第二批注')
  expect(request).not.toHaveBeenCalled()
  expect(before).toEqual(Array.from({ length: storage.length }, (_, i) => [storage.key(i), storage.getItem(storage.key(i))]))
})
it('builds all selected pages and actual WikiLink source nodes', async () => {
  const entry = add(); for (let i = 0; i < 23; i++) await mark(entry, 'n' + i)
  const preview = await prepare(), nodes = JSON.parse(preview.content).root.children
  const links = nodes.flatMap(n => n.children).filter(n => n.type === 'wiki-link')
  expect(preview.count).toBe(23); expect(links).toHaveLength(23); expect(links.at(-1).id).toBe('n22')
  expect(preview.markdown).toContain('笔记 ID：n22'); expect(Object.isFrozen(preview.groups[0].items[0])).toBe(true)
})
it('groups by saved manual state without changing any state', async () => {
  const entry = add(); await mark(entry, 'n0', '已读批注', 'read'); await mark(entry, 'n1', '未读批注', 'unread')
  const preview = await prepare({ group: 'status' }); expect(preview.groups.map(g => g.title)).toEqual(['已读', '未读'])
  expect((await study.load(entry, source)).data.records.map(r => r.status)).toEqual(['read', 'unread'])
})
it('does not treat user markup as HTML or generate a conclusion', async () => {
  await mark(add(), 'n22', '<script>alert(1)</script>\n# 假标题\n[[伪链接]]')
  const preview = await prepare({ goal: '<img src=x>' })
  expect(preview.markdown).toContain('&lt;script&gt;'); expect(preview.markdown).toContain('> \\# 假标题')
  expect(JSON.parse(preview.content).root.children.some(n => n.type === 'html')).toBe(false)
  expect(preview.content).toContain('请在阅读和核对来源后填写')
})
it('preserves leading spaces, blank lines, Unicode and annotation text', async () => {
  const note = '  首行\n\n尾行😀𠮷'; await mark(add(), 'n22', note)
  const preview = await prepare(); expect(preview.groups[0].items[0].note).toBe(note)
  expect(preview.markdown).toContain('>   首行\n> \n> 尾行😀𠮷')
})
it.each(['', '.md', '../坏名', 'bad:name', 'x\n', 'a'.repeat(121)])('rejects invalid title %j before writes', async title => {
  await mark(add()); await expect(prepare({ title })).rejects.toThrow(); expect(posts()).toHaveLength(0)
})
it('rejects invalid goal, folder and grouping', async () => {
  await mark(add())
  for (const patch of [{ goal: 'x'.repeat(2001) }, { goal: '\0' }, { parentId: null }, { group: 'unsupported' }]) await expect(prepare(patch)).rejects.toThrow()
})
it('does not silently drop selected rows without annotations', async () => {
  await mark(add()); const model = await hub.load()
  await expect(service.prepare(model, model.rows.map(r => r.key), config())).rejects.toThrow('没有已存批注')
})
it('rejects empty, duplicate, oversized or foreign selection', async () => {
  await mark(add()); const model = await hub.load(), key = model.rows.at(-1).key
  for (const keys of [[], [key, key], ['foreign'], Array.from({ length: 201 }, (_, i) => '' + i)]) await expect(service.prepare(model, keys, config())).rejects.toThrow()
})
it('does not generate from an incomplete aggregate', async () => {
  await mark(add()); storage.setItem('localNotepad.collectionStudy.v1:orphan', 'broken'); const model = await hub.load()
  await expect(service.prepare(model, [model.rows.at(-1).key], config())).rejects.toThrow('未关联')
})
it('rejects stale model and stale preview', async () => {
  const entry = add(); await mark(entry); const model = await hub.load(), preview = await prepare()
  await mark(entry, 'n22', '修改后的批注')
  await expect(service.prepare(model, [model.rows.at(-1).key], config())).rejects.toThrow('变化')
  await expect(service.create(preview)).rejects.toThrow('变化'); expect(posts()).toHaveLength(0)
})
it('selected unsaved drafts block prepare and later confirmation', async () => {
  const entry = add(); const snap = await mark(entry), key = studyDraftKey(snap, 'n22'), preview = await prepare()
  drafts.set(key, { note: '未存' }); await expect(prepare()).rejects.toThrow('未保存')
  await expect(service.create(preview)).rejects.toThrow('未保存'); expect(posts()).toHaveLength(0)
  expect(drafts.get(key).note).toBe('未存')
})
it('unselected drafts do not get copied or removed', async () => {
  const snap = await mark(add()); drafts.set(studyDraftKey(snap, 'n0'), { note: '不要复制' })
  const preview = await prepare(); expect(preview.content).not.toContain('不要复制'); expect(drafts.size).toBe(1)
})
it('accepts exactly 200 selected records without silent truncation', async () => {
  const entry = add('大资料集', 200)
  for (let i = 0; i < 200; i++) await mark(entry, 'n' + i, '批注 ' + i)
  const preview = await prepare(); expect(preview.count).toBe(200); expect(preview.markdown).toContain('批注 199')
})
it('bounds serialized output rather than dropping the last selected item', () => {
  const row = { collectionKey: 'c', collectionId: 'c', collectionName: 'x', id: 'n', title: 'x', status: 'read', note: 'x'.repeat(2 * 1024 * 1024) }
  expect(() => buildStudyCompilation([row], config(), 'now', 'before')).toThrow('2 MiB')
})
it('uses only a create POST and reuses its confirmed receipt on repeat clicks', async () => {
  await mark(add()); const preview = await prepare(), first = await service.create(preview), second = await service.create(preview)
  expect(first).toBe(second); expect(posts()).toHaveLength(1)
  expect(posts()[0][0]).toBe('/api/files'); expect(JSON.parse(posts()[0][1].body).content).toBe(preview.content)
})
it('validates a selected destination without falling back to root', async () => {
  await mark(add()); const preview = await prepare({ parentId: 'folder' })
  request.mockResolvedValueOnce({ id: 'folder', is_folder: false })
  await expect(service.create(preview)).rejects.toThrow('未改存根目录'); expect(posts()).toHaveLength(0)
})
it('rechecks source after the folder read, before the POST', async () => {
  const entry = add(); await mark(entry); const preview = await prepare({ parentId: 'folder' })
  request.mockImplementationOnce(async () => { await mark(entry, 'n22', 'changed'); return { id: 'folder', is_folder: true } })
  await expect(service.create(preview)).rejects.toThrow('变化'); expect(posts()).toHaveLength(0)
})
it('cancellation and late inactive callbacks prevent submission', async () => {
  await mark(add()); const preview = await prepare(), controller = new AbortController(); controller.abort()
  await expect(service.create(preview, { signal: controller.signal })).rejects.toThrow('取消')
  await expect(service.create(preview, { isCurrent: () => false })).rejects.toThrow('取消'); expect(posts()).toHaveLength(0)
})
it('does not repeat a POST after a lost response', async () => {
  await mark(add()); const preview = await prepare(); request.mockRejectedValueOnce(new Error('网络断开'))
  await expect(service.create(preview)).rejects.toMatchObject({ mayHaveCreated: true })
  await expect(service.create(preview)).rejects.toThrow('不会重复'); expect(posts()).toHaveLength(1)
})
it('invalid success responses remain uncertain and cannot be replayed', async () => {
  await mark(add()); const preview = await prepare(); request.mockResolvedValueOnce({ id: 'wrong', content: 'wrong' })
  await expect(service.create(preview)).rejects.toMatchObject({ mayHaveCreated: true }); expect(posts()).toHaveLength(1)
})
it('double confirmation during an in-flight request sends once', async () => {
  await mark(add()); const preview = await prepare(); let resolve
  request.mockImplementationOnce((_url, init) => new Promise(done => { resolve = () => done({ id: 'new', ...JSON.parse(init.body) }) }))
  const first = service.create(preview); await expect(service.create(preview)).rejects.toThrow('不会重复')
  resolve(); await expect(first).resolves.toMatchObject({ id: 'new' }); expect(posts()).toHaveLength(1)
})
it('untrusted copies of a preview cannot be submitted', async () => {
  await mark(add()); const preview = await prepare(); await expect(service.create({ ...preview })).rejects.toThrow('预览无效'); expect(posts()).toHaveLength(0)
})
it('a timed-out POST becomes uncertain instead of an endless pending or retry', async () => {
  await mark(add()); const preview = await prepare(); vi.useFakeTimers()
  request.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('超时')))))
  const task = service.create(preview); const assertion = expect(task).rejects.toMatchObject({ mayHaveCreated: true })
  await vi.advanceTimersByTimeAsync(15001); await assertion
  await expect(service.create(preview)).rejects.toThrow('不会重复'); vi.useRealTimers()
})
