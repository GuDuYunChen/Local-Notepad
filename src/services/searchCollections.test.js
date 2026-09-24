import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectSearchResultReport } from './searchResultExport'
import { createSearchCollectionStore, readSearchCollection, copyCollectionReport, compareSearchCollection,
  checkSearchCollection, downloadSearchCollection, SEARCH_COLLECTION_PREFIX, MAX_COLLECTION_BYTES } from './searchCollections'

const NOW = new Date('2026-09-23T12:00:00.000Z')
const filters = { query: '关关', source: 'all', folderId: '', pinned: false, matchCase: false, since: 0, sort: 'relevance' }
const item = i => ({ id: 'n'+i, title: '第'+i+'章', folder_path: '项目 / 卷一', updated_at: 1,
  is_pinned: false, title_match: true, body_count: 1, content_sha256: 'a'.repeat(64), snippets: [] })
function response(number = 1, rows = Array.from({ length: 23 }, (_, i) => item(i)), patch = {}) {
  return { query: '关关', items: rows.slice((number-1)*20, number*20), folders: [], total: rows.length,
    total_occurrences: rows.reduce((n,row)=>n+row.body_count,0), scanned: rows.length, unsupported: 0,
    page: number, pages: Math.max(1, Math.ceil(rows.length/20)), page_size: 20, revision: 'b'.repeat(64), ...patch }
}
const report = async (rows, options = {}) => collectSearchResultReport(filters, response(1,rows), {
  mode: 'all', now: NOW, request: async f => response(f.page,rows), ...options })
const memory = () => {
  const map = new Map()
  return { map, get length(){return map.size}, key: i=>[...map.keys()][i]??null,
    getItem: key=>map.get(key)??null, setItem: (key,value)=>map.set(key,value), removeItem: key=>map.delete(key) }
}
function storeFixture(storage = memory()) {
  let id=0
  return { storage, store:createSearchCollectionStore({storage:()=>storage,createId:()=>`test-${++id}`,now:()=>NOW}) }
}
const snapshot = async rows => ({ format:'local-notepad-search-collection',version:1,id:'fixture',name:'设定资料',savedAt:NOW.toISOString(),report:await report(rows) })
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})

describe('explicit metadata-only collection persistence',()=>{
 it('persists a complete 23-item collection across fresh store instances',async()=>{
  const {store,storage}=storeFixture();store.save('  设定资料  ',await report())
  const reopened=storeFixture(storage).store.list();expect(reopened.error).toBe('');expect(reopened.entries[0].collection.name).toBe('设定资料')
  expect(reopened.entries[0].collection.report.items.at(-1).id).toBe('n22')
 })
 it('saves selected subsets without expanding them to the full scope',async()=>{
  const chosen=await report(undefined,{mode:'selected',selection:[{id:'n22',page:2,contentSHA256:'a'.repeat(64)}]})
  const {store}=storeFixture();const saved=store.save('末章',chosen);expect(saved.report.count).toBe(1);expect(saved.report.scope.total).toBe(23)
 })
 it('whitelists every nested level without retaining manuscript or runtime fields',async()=>{
  const source=structuredClone(await report());source.content='PRIVATE BODY';source.scope.criteria.token='TOKEN';source.items[0].snippets=['SECRET'];source.items[0].url='PRIVATE URL'
  const {store,storage}=storeFixture();store.save('资料',source)
  const raw=[...storage.map.values()][0];for(const text of ['PRIVATE','SECRET','TOKEN','snippets']) expect(raw).not.toContain(text)
  expect(source.items[0].snippets).toEqual(['SECRET'])
 })
 it('rejects snippet-bearing reports rather than silently persisting them',async()=>{
  const {store}=storeFixture();const source=await report(undefined,{includeSnippets:true})
  expect(()=>store.save('资料',source)).toThrow();expect(store.list().entries).toHaveLength(0)
 })
 it('uses independent keys for same-name saves and never overwrites the old record',async()=>{
  const {store}=storeFixture(),source=await report();store.save('同名',source);store.save('同名',source)
  expect(store.list().entries).toHaveLength(2)
 })
 it('leaves input mutable while returning deeply frozen detached metadata',async()=>{
  const {store}=storeFixture(),source=structuredClone(await report());const saved=store.save('资料',source)
  source.items[0].title='changed';expect(saved.report.items[0].title).not.toBe('changed');expect(Object.isFrozen(saved.report.items[0])).toBe(true)
 })
 it.each(['', ' ', 'a'.repeat(49), null])('rejects invalid name %j before writes',async name=>{
  const {store}=storeFixture(), good=await report();expect(()=>store.save(name,good)).toThrow()
  expect(store.list().entries).toHaveLength(0)
 })
 it('validates names using Unicode codepoints',async()=>{
  const {store}=storeFixture();expect(store.save('😀'.repeat(48),await report()).name).toHaveLength(96)
 })
 it.each([null, '{}', '{broken', '[]'])('invalid JSON record %s is rejected',raw=>expect(()=>readSearchCollection(raw)).toThrow())
 it('preserves unreadable and future-version entries and counts them against capacity',async()=>{
  const {store,storage}=storeFixture();for(let i=0;i<40;i++)storage.setItem(SEARCH_COLLECTION_PREFIX+i,'{}')
  expect(store.list().entries).toHaveLength(40);expect(store.list().entries.every(e=>e.error)).toBe(true)
  const good=await report();expect(()=>store.save('新',good)).toThrow('40')
 })
 it('reports unavailable storage as error, not an empty successful shelf',()=>{
  const store=createSearchCollectionStore({storage:()=>{throw new Error('denied')}});expect(store.list().error).not.toBe('')
 })
 it('quota failure preserves existing records and unrelated settings',async()=>{
  const {store,storage}=storeFixture();const source=await report();store.save('旧',source);storage.setItem('theme','dark')
  const before=[...storage.map];vi.spyOn(storage,'setItem').mockImplementation(()=>{throw new Error('quota')})
  expect(()=>store.save('新',source)).toThrow('空间');expect([...storage.map]).toEqual(before)
 })
 it('ID collision refuses to overwrite',async()=>{
  const storage=memory(),source=await report(),store=createSearchCollectionStore({storage:()=>storage,createId:()=> 'same',now:()=>NOW})
  store.save('旧',source);expect(()=>store.save('新',source)).toThrow('冲突');expect(store.list().entries[0].collection.name).toBe('旧')
 })
 it('stale export and deletion fail without touching changed data',async()=>{
  const {store,storage}=storeFixture();store.save('旧',await report());const entry=store.list().entries[0]
  storage.setItem(entry.key,entry.raw+' ');expect(()=>store.export(entry)).toThrow('更改');expect(()=>store.remove(entry)).toThrow('更改')
  expect(storage.getItem(entry.key)).toBe(entry.raw+' ')
 })
 it('deletion failure does not notify success or remove the record',async()=>{
  const {store,storage}=storeFixture();store.save('资料',await report());const cb=vi.fn();store.subscribe(cb)
  vi.spyOn(storage,'removeItem').mockImplementation(()=>{throw new Error('denied')})
  expect(()=>store.remove(store.list().entries[0])).toThrow();expect(cb).not.toHaveBeenCalled();expect(store.list().entries).toHaveLength(1)
 })
 it('only collection keys can be deleted and corrupt collection records are removable',()=>{
  const {store,storage}=storeFixture();storage.setItem('theme','dark');storage.setItem(SEARCH_COLLECTION_PREFIX+'bad','broken')
  expect(()=>store.remove({key:'theme',raw:'dark'})).toThrow();store.remove(store.list().entries[0]);expect(storage.getItem('theme')).toBe('dark')
 })
 it('throwing listeners cannot turn a saved collection into a failed save',async()=>{
  const {store}=storeFixture(),cb=vi.fn();const off=store.subscribe(cb);store.subscribe(()=>{throw new Error('view')})
  store.save('资料',await report());expect(cb).toHaveBeenCalledOnce();off();store.remove(store.list().entries[0]);expect(cb).toHaveBeenCalledOnce()
 })
 it('roundtrips JSON with a BOM, imported copies retain historical time and get new identity',async()=>{
  const {store}=storeFixture();store.save('资料',await report());const raw=store.export(store.list().entries[0]);const old=readSearchCollection(raw)
  const fresh=store.importCopy('\uFEFF'+raw);expect(fresh.id).not.toBe(old.id);expect(fresh.report).toEqual(old.report)
 })
 it('rejects mismatched record identity, unsupported versions and duplicate note IDs',async()=>{
  const value=await snapshot();for(const patch of [{version:2},{id:'../escape'},{savedAt:'today'}])expect(()=>readSearchCollection(JSON.stringify({...value,...patch}))).toThrow()
  const duplicate=structuredClone(value);duplicate.report.items[1]=duplicate.report.items[0];expect(()=>readSearchCollection(JSON.stringify(duplicate))).toThrow('重复')
  const {store,storage}=storeFixture();storage.setItem(SEARCH_COLLECTION_PREFIX+'wrong',JSON.stringify(value));expect(store.list().entries[0].collection).toBeNull()
 })
 it.each(['count','exportedBodyOccurrences'])('rejects contradictory report field %s',async key=>{
  const value=structuredClone(await report());value[key]++;expect(()=>copyCollectionReport(value)).toThrow()
 })
 it('rejects oversized input before JSON parsing and does not truncate',()=>{
  expect(()=>readSearchCollection('x'.repeat(MAX_COLLECTION_BYTES+1))).toThrow('2 MiB')
  expect(()=>readSearchCollection('关'.repeat(MAX_COLLECTION_BYTES/2))).toThrow('2 MiB')
 })
 it('validates SHA-256, scalar types, source, sort and scope counts',async()=>{
  const source=await report()
  for(const mutation of [v=>v.items[0].contentSHA256='bad',v=>v.scope.criteria.source='regex',v=>v.scope.criteria.sort='random',v=>v.scope.criteria.since=-1,v=>v.scope.criteria.query=' 关关 ',v=>v.scope.scanned=0,v=>v.scope.pages=9,v=>v.items[0].pinned='false']){
   const value=structuredClone(source);mutation(value);expect(()=>copyCollectionReport(value)).toThrow()
  }
 })
 it('treats reserved note IDs as inert metadata rather than object properties',async()=>{
  const {store}=storeFixture();const value=await report([{...item(0),id:'__proto__'}]);const saved=store.save('资料',value)
  expect(saved.report.items[0].id).toBe('__proto__');expect({}.polluted).toBeUndefined()
 })
 it('downloads a sanitized metadata-only copy and releases its object URL',async()=>{
  vi.useFakeTimers();const create=vi.fn(()=> 'blob:collection'),revoke=vi.fn();vi.stubGlobal('URL',Object.assign(class {},{createObjectURL:create,revokeObjectURL:revoke}))
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});downloadSearchCollection(JSON.stringify(await snapshot()))
  expect(create).toHaveBeenCalledOnce();expect(document.querySelector('a')).toBeNull();await vi.advanceTimersByTimeAsync(1000);expect(revoke).toHaveBeenCalledWith('blob:collection')
 })
})

describe('revision-checked collection inspection',()=>{
 it('compares by note identity, distinguishes body/metadata/outside and preserves historical order',async()=>{
  const old=await snapshot([item(0),item(1),item(2),item(3)])
  const current=await report([item(3),{...item(1),content_sha256:'c'.repeat(64)},{...item(0),title:'新名',folder_path:'新卷'},item(8)])
  const result=compareSearchCollection(old,current)
  expect(result.rows.map(r=>r.id)).toEqual(['n0','n1','n2','n3']);expect(result.counts).toEqual({metadata:1,body:1,outside:1,unchanged:1});expect(result.otherMatches).toBe(1)
  expect(result.rows[2].current).toBeNull();expect(old.report.items[0].title).toBe('第0章')
 })
 it('does not confuse identical titles with matching identities',async()=>{
  const old=await snapshot([{...item(0),title:'同名'}]);const current=await report([{...item(9),title:'同名'}]);expect(compareSearchCollection(old,current).counts.outside).toBe(1)
 })
 it('does not call unselected original matches newly created notes',async()=>{
  const old=await snapshot();old.report=await report(undefined,{mode:'selected',selection:[{id:'n0',page:1,contentSHA256:'a'.repeat(64)}]})
  expect(compareSearchCollection(old,await report()).otherMatches).toBe(22)
 })
 it('uses fixed original date, source and folder for every read and verifies final revision',async()=>{
  const old=await snapshot();old.report=structuredClone(old.report);Object.assign(old.report.scope.criteria,{since:12345,pinned:true,matchCase:true,folderId:'f'})
  const request=vi.fn(async f=>response(f.page,undefined,{folders:[{id:'f',label:'新目录名称'}]}))
  const checked=await checkSearchCollection(old,{request,now:NOW})
  expect(checked.counts.unchanged).toBe(23);expect(request.mock.calls.map(([f])=>f.page)).toEqual([1,1,2,1])
  for(const [f] of request.mock.calls)expect(f).toMatchObject({since:12345,pinned:true,matchCase:true,folderId:'f',anchorId:''})
 })
 it('empty current results are revision-verified rather than failing or silently deleting history',async()=>{
  const old=await snapshot(),request=vi.fn(async()=>response(1,[]))
  const checked=await checkSearchCollection(old,{request,now:NOW});expect(checked.counts.outside).toBe(23);expect(request).toHaveBeenCalledTimes(2)
 })
 it('empty second read with a different revision is rejected',async()=>{
  const request=vi.fn().mockResolvedValueOnce(response(1,[])).mockResolvedValueOnce(response(1,[],{revision:'c'.repeat(64)}))
  await expect(checkSearchCollection(await snapshot(),{request})).rejects.toThrow('变化')
 })
 it('a missing original folder fails rather than broadening to the whole library',async()=>{
  const old=await snapshot();old.report=structuredClone(old.report);old.report.scope.criteria.folderId='gone'
  await expect(checkSearchCollection(old,{request:async()=>response(1,[])})).rejects.toThrow('目录已不可用')
 })
 it('over-limit current scope does not emit a truncated comparison',async()=>{
  const rows=Array.from({length:2001},(_,i)=>item(i))
  await expect(checkSearchCollection(await snapshot(),{request:async()=>response(1,rows)})).rejects.toThrow('2000')
 })
 it('mid-pagination changes and transport errors produce no partial result',async()=>{
  const request=vi.fn(async f=>response(f.page,undefined,f.page===2?{revision:'c'.repeat(64)}:{}))
  await expect(checkSearchCollection(await snapshot(),{request})).rejects.toThrow('变化')
  await expect(checkSearchCollection(await snapshot(),{request:async()=>{throw new Error('offline')}})).rejects.toThrow('offline')
 })
 it('cancels promptly even if the first transport ignores AbortSignal',async()=>{
  const controller=new AbortController();const old=await snapshot(),task=checkSearchCollection(old,{signal:controller.signal,request:()=>new Promise(()=>{})})
  controller.abort();await expect(task).rejects.toMatchObject({name:'AbortError'})
 })
 it('enforces a deadline across the entire inspection including the initial read',async()=>{
  const old=await snapshot();vi.useFakeTimers();const task=checkSearchCollection(old,{request:()=>new Promise(()=>{})});const outcome=expect(task).rejects.toThrow('两分钟')
  await vi.advanceTimersByTimeAsync(120000);await outcome;expect(vi.getTimerCount()).toBe(0)
 })
 it('rejects comparison with different criteria or a partial current report',async()=>{
  const old=await snapshot(),current=structuredClone(await report());current.scope.criteria.query='赵三';expect(()=>compareSearchCollection(old,current)).toThrow('范围不一致')
  current.scope.criteria.query='关关';current.mode='selected';expect(()=>compareSearchCollection(old,current)).toThrow('范围不一致')
 })
})
