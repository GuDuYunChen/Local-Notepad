import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { createResearchTaskStore, createResearchTaskService, RESEARCH_TASK_PREFIX, MAX_RESEARCH_TASK_BYTES } from './researchTasks'
import { buildStudyCompilation } from './studyCompilation'
import { memoryStorage } from '../test/collectionFixtures'
import { researchReceipt, RESEARCH_FILE_ID, testLocks } from '../test/researchFixtures'
const preview = (patch = {}) => buildStudyCompilation([{ collectionId: 'c1', collectionKey: 'c1', collectionName: '资料', id: 'n1', title: '原文', folderPath: '卷一', ordinal: 1, status: 'revisit', note: ' 中文\n\n😀𠮷', updatedAt: '2026-09-24T12:00:00.000Z' }], { title: '研究笔记', goal: '核对目标', parentId: '', group: 'collection', ...patch }, '2026-09-24T13:00:00.000Z', '2026-09-24T12:30:00.000Z')
let storage, store, service, request, server
beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID, subtle: { digest: async (_a, b) => Uint8Array.from(createHash('sha256').update(b).digest()).buffer } })
  storage = memoryStorage(); server = new Map()
  store = createResearchTaskStore({ storage: () => storage, locks: () => testLocks })
  request = vi.fn(async (path, init) => {
    const id = path.split('/').at(-1)
    if (init?.method === 'POST') { const result = researchReceipt(path, JSON.parse(init.body)); server.set(id, result); return result }
    return server.get(id) || { found: false, request_id: id }
  })
  service = createResearchTaskService({ store, request })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const posts = () => request.mock.calls.filter(([, init]) => init?.method === 'POST')
it('saves and reconstructs the exact Unicode document without any HTTP or source changes', async () => {
  storage.setItem('unrelated', 'keep'); const p = preview(), entry = await service.save(p)
  expect(store.read(entry).preview.content).toBe(p.content); expect(store.read(entry).preview.markdown).toBe(p.markdown)
  expect(store.list()).toHaveLength(1); expect(request).not.toHaveBeenCalled(); expect(storage.getItem('unrelated')).toBe('keep')
})
it('a fresh store/service reopens the same immutable payload and task identity', async () => {
  const entry = await service.save(preview()), next = createResearchTaskStore({ storage: () => storage, locks: () => testLocks })
  expect(next.read(entry).id).toBe(store.read(entry).id)
  const result = await createResearchTaskService({ store: next, request }).submit(next.list()[0])
  expect(result.receipt.file_id).toBe(RESEARCH_FILE_ID); expect(posts()).toHaveLength(1)
})
it('check is GET-only and never changes a missing task into a created note', async () => {
  const entry = await service.save(preview()), raw = entry.raw
  const result = await service.check(entry); expect(result.receipt).toBeNull(); expect(posts()).toHaveLength(0)
  expect(storage.getItem(entry.key)).toBe(raw)
})
it('creates only after journaling and checks the receipt before posting', async () => {
  const entry = await service.save(preview()), original = request.getMockImplementation()
  request.mockImplementation(async (path, init) => {
    if (init.method === 'POST') expect(JSON.parse(storage.getItem(entry.key)).phase).toBe('submitted')
    return original(path, init)
  })
  const result = await service.submit(entry)
  expect(request.mock.calls[0][1].method).toBeUndefined(); expect(posts()).toHaveLength(1)
  expect(store.read(result.entry).phase).toBe('confirmed')
})
it('lost POST response is recoverable without a second POST after service restart', async () => {
  const entry = await service.save(preview()), original = request.getMockImplementation()
  request.mockImplementation(async (path, init) => { const value = await original(path, init); if (init?.method === 'POST') throw new Error('response lost'); return value })
  await expect(service.submit(entry)).rejects.toMatchObject({ mayHaveCreated: true })
  const pending = store.list()[0]; expect(pending.task.phase).toBe('uncertain')
  const recovered = await createResearchTaskService({ store, request }).submit(pending)
  expect(recovered.receipt.file_id).toBe(RESEARCH_FILE_ID); expect(posts()).toHaveLength(1)
})
it('a failed unsent POST can be explicitly retried with the exact same task ID and body', async () => {
  const entry = await service.save(preview()), original = request.getMockImplementation(); let first = true
  request.mockImplementation(async (path, init) => { if (init?.method === 'POST' && first) { first = false; throw new Error('offline') }; return original(path, init) })
  await expect(service.submit(entry)).rejects.toThrow('结果尚未确认')
  await service.submit(store.list()[0]); expect(posts()).toHaveLength(2)
  expect(posts()[0][0]).toBe(posts()[1][0]); expect(posts()[0][1].body).toBe(posts()[1][1].body); expect(server.size).toBe(1)
})
it.each(['deleted', 'missing'])('receipt for a %s file prevents automatic resurrection', async state => {
  const result = await service.submit(await service.save(preview()))
  server.get(result.receipt.request_id).state = state
  const checked = await service.submit(store.list()[0]); expect(checked.receipt.state).toBe(state); expect(posts()).toHaveLength(1)
})
it('a known success missing from a different/rolled-back database is not replayed', async () => {
  await service.submit(await service.save(preview())); server.clear()
  await expect(service.submit(store.list()[0])).rejects.toThrow('切换或回退'); expect(posts()).toHaveLength(1)
})
it('receipt mismatch is never accepted as successful creation', async () => {
  const entry = await service.save(preview()), original = request.getMockImplementation()
  request.mockImplementation(async (path, init) => { const value = await original(path, init); return init?.method === 'POST' ? { ...value, payload_sha256: 'a'.repeat(64) } : value })
  await expect(service.submit(entry)).rejects.toMatchObject({ mayHaveCreated: true }); expect(store.list()[0].task.phase).toBe('uncertain')
})
it('mismatched existing server receipt blocks the POST entirely', async () => {
  const entry = await service.save(preview()); const task = store.read(entry)
  server.set(task.id, researchReceipt('/' + task.id, { title: 'another', content: 'x' }))
  await expect(service.submit(entry)).rejects.toThrow('不一致'); expect(posts()).toHaveLength(0)
})
it('corrupted saved content fails the fingerprint check before any request', async () => {
  const entry = await service.save(preview()), changed = JSON.parse(entry.raw); changed.document.rows[0].note = '被修改'
  storage.setItem(entry.key, JSON.stringify(changed))
  await expect(service.submit(store.list()[0])).rejects.toThrow('指纹不符'); expect(request).not.toHaveBeenCalled()
})
it('stale raw versions cannot be checked, submitted or removed', async () => {
  const entry = await service.save(preview()); await store.update(entry, 'submitted')
  await expect(service.submit(entry)).rejects.toThrow('变化'); await expect(store.remove(entry)).rejects.toThrow('变化'); expect(request).not.toHaveBeenCalled()
})
it('failed draft save prevents network creation and preserves old records', async () => {
  const entry = await service.save(preview()); vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await expect(service.save(preview())).rejects.toThrow('保存失败'); expect(request).not.toHaveBeenCalled(); expect(storage.getItem(entry.key)).toBe(entry.raw)
})
it('failed sending-journal write prevents POST even after a successful GET', async () => {
  const entry = await service.save(preview()); vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await expect(service.submit(entry)).rejects.toThrow('保存失败'); expect(posts()).toHaveLength(0)
})
it('a local receipt-save failure reports verified server success, not a fake creation failure', async () => {
  const entry = await service.save(preview()), original = storage.setItem
  vi.spyOn(storage, 'setItem').mockImplementation((key, raw) => { if (JSON.parse(raw).phase === 'confirmed') throw new Error('quota'); original(key, raw) })
  const result = await service.submit(entry); expect(result.receipt.found).toBe(true); expect(result.localWarning).toContain('服务端已确认'); expect(posts()).toHaveLength(1)
})
it('source guards run again after waiting for the journal lock', async () => {
  const entry = await service.save(preview()); let times = 0
  await expect(service.submit(entry, { beforeSend: () => { if (++times === 2) throw new Error('source changed') } })).rejects.toThrow('source changed')
  expect(times).toBe(2); expect(posts()).toHaveLength(0)
})
it('cancel before checking does not contact the server', async () => {
  const entry = await service.save(preview()), controller = new AbortController(); controller.abort()
  await expect(service.submit(entry, { signal: controller.signal })).rejects.toThrow('取消'); expect(request).not.toHaveBeenCalled()
})
it('an interrupted status GET cannot trigger a creation attempt', async () => {
  const entry = await service.save(preview()); request.mockRejectedValue(new Error('GET offline'))
  await expect(service.submit(entry)).rejects.toThrow('GET offline'); expect(posts()).toHaveLength(0)
})
it('late check after UI cancellation cannot post', async () => {
  const entry = await service.save(preview()), controller = new AbortController()
  request.mockImplementation(async path => { controller.abort(); return { found: false, request_id: path.split('/').at(-1) } })
  await expect(service.submit(entry, { signal: controller.signal })).rejects.toThrow('取消'); expect(posts()).toHaveLength(0)
})
it('double submit in one service is rejected while the original is waiting', async () => {
  const entry = await service.save(preview()); let release
  request.mockImplementationOnce(path => new Promise(resolve => { release = () => resolve({ found: false, request_id: path.split('/').at(-1) }) }))
  const first = service.submit(entry); await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  await expect(service.submit(entry)).rejects.toThrow('正在处理'); release(); await first; expect(posts()).toHaveLength(1)
})
it('ten-task capacity counts unreadable records and never evicts old drafts', async () => {
  for (let i=0;i<10;i++) storage.setItem(RESEARCH_TASK_PREFIX + randomUUID(), 'broken')
  await expect(service.save(preview())).rejects.toThrow('10 份'); expect(storage.length).toBe(10); expect(store.list().every(x => x.error)).toBe(true)
})
it('UUID collisions cannot replace an existing draft', async () => {
  const entry = await service.save(preview()), id = store.read(entry).id
  const next = createResearchTaskStore({ storage: () => storage, locks: () => testLocks, createId: () => id })
  await expect(next.save(preview())).rejects.toThrow('冲突'); expect(storage.getItem(entry.key)).toBe(entry.raw)
})
it('explicit deletion is local-only, exact-version and preserves unrelated records', async () => {
  const entry = await service.save(preview()); storage.setItem('private-setting','keep'); await store.remove(entry)
  expect(store.list()).toHaveLength(0); expect(storage.getItem('private-setting')).toBe('keep'); expect(request).not.toHaveBeenCalled()
})
it('corrupt records remain visible and can only be explicitly removed', async () => {
  const key=RESEARCH_TASK_PREFIX+randomUUID();storage.setItem(key,'corrupt'); const entry=store.list()[0]
  expect(entry.error).toBeTruthy();await store.remove(entry); expect(storage.getItem(key)).toBeNull()
})
it('unknown future versions, oversized raw and wrong identities are not accepted', async () => {
  const entry=await service.save(preview()), input=JSON.parse(entry.raw)
  for (const raw of [JSON.stringify({...input,version:2}),JSON.stringify({...input,id:randomUUID()}),'x'.repeat(MAX_RESEARCH_TASK_BYTES+1)]) {
    storage.setItem(entry.key,raw);expect(()=>store.read({key:entry.key,raw})).toThrow()
  }
})
it('missing Web Locks cannot silently use an unsafe fallback', async () => {
  const next=createResearchTaskStore({storage:()=>storage,locks:()=>null})
  await expect(next.save(preview())).rejects.toThrow('不支持安全保存'); expect(storage.length).toBe(0)
})
it('throwing subscribers cannot turn a successful save into an error',async()=>{
  store.subscribe(()=>{throw new Error('view')});const entry=await service.save(preview());expect(store.read(entry).phase).toBe('draft')
})
it('unsupported status endpoint cannot fall back to legacy POST /files',async()=>{
  const entry=await service.save(preview());request.mockResolvedValue({code:0})
  await expect(service.submit(entry)).rejects.toThrow('不支持');expect(posts()).toHaveLength(0)
})
it('two different saved previews retain different IDs and never share a receipt',async()=>{
  const a=await service.save(preview()),b=await service.save(preview({title:'第二研究'}))
  expect(store.read(a).id).not.toBe(store.read(b).id);expect(store.list()).toHaveLength(2)
})
