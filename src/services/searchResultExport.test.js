import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { collectSearchResultReport, createSearchExportScope, searchExportFilterKey, serializeSearchResultReport,
  downloadSearchResultReport, MAX_SEARCH_EXPORT_ITEMS, MAX_SEARCH_EXPORT_BYTES, SEARCH_EXPORT_TIMEOUT } from './searchResultExport'

const filters = { query: '关关', source: 'all', folderId: '', sort: 'relevance', since: 0 }
const item = i => ({ id: 'n' + i, title: '第' + i + '章', folder_path: '仙侠 / 正文', updated_at: 1720000000,
  is_pinned: false, title_match: false, body_count: 4, content_sha256: 'a'.repeat(64),
  content: 'NEVER EXPORT FULL BODY', private_extra: 'private',
  snippets: [{ kind: 'body', before: '<script>', match: '关关', after: '</script>', start: 1, end: 3, leading: true, trailing: false }] })
function page(number = 1, total = 65) {
  return { items: Array.from({ length: Math.min(20, Math.max(0, total - (number - 1) * 20)) }, (_, i) => item((number - 1) * 20 + i + 1)),
    total, total_occurrences: total * 4, page: number, pages: Math.max(1, Math.ceil(total / 20)), page_size: 20,
    scanned: total + 2, unsupported: 2, revision: 'b'.repeat(64), query: '关关', folders: [{ id: 'f', label: '仙侠' }] }
}
const choice = (i, number = Math.ceil(i / 20)) => ({ id: 'n' + i, page: number, contentSHA256: 'a'.repeat(64) })
const all = (options = {}, response = page()) => collectSearchResultReport(filters, response, { mode: 'all', request: async f => page(f.page, response.total), ...options })
beforeEach(() => vi.restoreAllMocks())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('search result collection and bounded report export', () => {
  it('collects every result on four pages and verifies again before returning', async () => {
    const request = vi.fn(async f => page(f.page)), onProgress = vi.fn()
    const result = await all({ request, onProgress })
    expect(result.items).toHaveLength(65); expect(result.items.at(-1).id).toBe('n65')
    expect(result.exportedBodyOccurrences).toBe(260)
    expect(request.mock.calls.map(([f]) => f.page)).toEqual([1, 2, 3, 4, 1])
    expect(request.mock.calls.every(([f]) => f.revision === 'b'.repeat(64) && f.anchorId === '')).toBe(true)
    expect(onProgress.mock.calls.at(-1)[0]).toEqual({ completed: 4, total: 4, phase: 'verify' })
  })
  it('selected export re-reads only selected pages, preserving search order not click order', async () => {
    const request = vi.fn(async f => page(f.page))
    const result = await all({ mode: 'selected', selection: [choice(65), choice(2), choice(1)], request })
    expect(result.items.map(i => i.id)).toEqual(['n1', 'n2', 'n65'])
    expect(result.count).toBe(3); expect(result.scope.total).toBe(65)
    expect(request.mock.calls.map(([f]) => f.page)).toEqual([1, 4, 1])
  })
  it('selected export may start on a late page without assuming the visible page is page one', async () => {
    const result = await all({ mode: 'selected', selection: [choice(62)] }, page(3))
    expect(result.items[0].id).toBe('n62')
  })
  it('default report contains metadata only, never full body, snippets, offsets or arbitrary fields', async () => {
    const result = await all()
    const raw = JSON.stringify(result)
    for (const value of ['NEVER EXPORT', 'private_extra', '<script>', '"start"', '"snippets"']) expect(raw).not.toContain(value)
    expect(result.includeSnippets).toBe(false)
    expect(Object.keys(result.items[0])).toEqual(['id','title','folderPath','updatedAt','pinned','titleMatch','bodyOccurrences','contentSHA256'])
  })
  it('explicit snippet opt-in retains bounded context and provenance but not navigation offsets', async () => {
    const result = await all({ includeSnippets: true })
    expect(result.items[0].snippets[0]).toEqual({ kind: 'body', before: '<script>', match: '关关', after: '</script>', leading: true, trailing: false })
  })
  it('normalizes scope but does not persist pagination, return anchor or rolling-day tokens', () => {
    const original = { ...filters, page: 3, anchorId: 'n45', revision: 'c'.repeat(64), days: '7' }
    expect(searchExportFilterKey(original)).toBe(searchExportFilterKey(filters))
    const scope = createSearchExportScope(original, page())
    expect(scope.criteria).not.toHaveProperty('page'); expect(scope.criteria).not.toHaveProperty('days')
    expect(scope.criteria).not.toHaveProperty('anchorId'); expect(scope.criteria).not.toHaveProperty('revision')
  })
  it('copies and deeply freezes the report without freezing caller data', async () => {
    const input = page(), snapshot = structuredClone(input)
    const result = await all({ includeSnippets: true }, input)
    expect(input).toEqual(snapshot); expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(result.items[0].snippets[0])).toBe(true)
    expect(Object.isFrozen(result.scope.criteria)).toBe(true)
  })
  it('rejects overlong or mismatched query scopes before requesting any pages', async () => {
    const request = vi.fn()
    await expect(collectSearchResultReport({ query: 'wrong' }, page(), { mode: 'all', request })).rejects.toThrow('变化')
    await expect(collectSearchResultReport({ query: 'x'.repeat(129) }, page(), { mode: 'all', request })).rejects.toThrow('128')
    expect(request).not.toHaveBeenCalled()
  })
  it.each([{ source: 'bad' }, { sort: 'bad' }, { since: -1 }, { since: 1.5 }])('rejects unsupported scope %j', patch => {
    expect(() => createSearchExportScope({ ...filters, ...patch }, page())).toThrow()
  })
  it('keeps exact fixed date, folder, case and pinned criteria in every request', async () => {
    const request = vi.fn(async f => page(f.page))
    const result = await collectSearchResultReport({ ...filters, since: 123456, days: '7', folderId: 'f', pinned: true, matchCase: true }, page(), { mode: 'all', request })
    expect(result.scope.folderLabel).toBe('仙侠')
    for (const [f] of request.mock.calls) expect(f).toMatchObject({ since: 123456, folderId: 'f', pinned: true, matchCase: true })
  })
  it('rejects empty or invalid export modes and selections', async () => {
    for (const options of [{mode:'bad'}, {mode:'selected'}, {mode:'selected',selection:{}}, {mode:'selected',selection:[choice(1),choice(1)]}, {mode:'selected',selection:[choice(1,9)]}, {mode:'selected',selection:[{...choice(1),contentSHA256:'bad'}]}]) {
      await expect(all(options)).rejects.toThrow()
    }
    await expect(all({}, page(1, 0))).rejects.toThrow('没有')
  })
  it('rejects all-result export above the cap without any network work', async () => {
    const request = vi.fn()
    await expect(all({request}, page(1, MAX_SEARCH_EXPORT_ITEMS+1))).rejects.toThrow('没有截断')
    expect(request).not.toHaveBeenCalled()
  })
  it('still exports a small selected subset from a larger result set', async () => {
    const result = await all({mode:'selected',selection:[choice(2201)]}, page(1, 2300))
    expect(result.items.map(i=>i.id)).toEqual(['n2201'])
  })
  it('fails instead of mixing a changed revision midway', async () => {
    await expect(all({ request: async f => ({ ...page(f.page), revision: f.page === 2 ? 'c'.repeat(64) : 'b'.repeat(64) }) })).rejects.toThrow('变化')
  })
  it('catches changes during the final verification even for a single-page report', async () => {
    let calls=0
    await expect(all({ request: async f => ({ ...page(f.page,1), revision: ++calls === 2 ? 'c'.repeat(64) : 'b'.repeat(64) }) },page(1,1))).rejects.toThrow('变化')
  })
  it('rejects duplicated identities across different pages', async () => {
    await expect(all({ request: async f => {const data=page(f.page);if(f.page===2)data.items[0].id='n1';return data} })).rejects.toThrow('变化')
  })
  it('rejects missing selections and selections returned on the wrong page', async () => {
    await expect(all({mode:'selected',selection:[choice(100,1)]})).rejects.toThrow('变化')
    await expect(all({mode:'selected',selection:[choice(1,2)]})).rejects.toThrow('变化')
  })
  it('rejects a selected item whose content hash differs despite a matching scope revision', async () => {
    await expect(all({mode:'selected',selection:[{...choice(1),contentSHA256:'c'.repeat(64)}]})).rejects.toThrow('变化')
  })
  it.each(['query','total_occurrences','scanned','unsupported','page'])('rejects a contradictory %s receipt', async field => {
    await expect(all({request:async f=>{const data=page(f.page);data[field]=field==='query'?'wrong':data[field]+1;return data}})).rejects.toThrow()
  })
  it('rejects malformed incomplete pages, rather than exporting missing rows', async () => {
    await expect(all({request:async f=>({...page(f.page),items:[]})})).rejects.toThrow('不完整')
  })
  it('propagates backend failure without returning partial results', async () => {
    await expect(all({request:async f=>{if(f.page===2)throw new Error('服务器读取失败');return page(f.page)}})).rejects.toThrow('读取失败')
  })
  it('never calls the backend for an already-cancelled request', async () => {
    const controller=new AbortController();controller.abort();const request=vi.fn()
    await expect(all({signal:controller.signal,request})).rejects.toMatchObject({name:'AbortError'})
    expect(request).not.toHaveBeenCalled()
  })
  it('cancels even when a request ignores the signal and resolves late', async () => {
    const controller=new AbortController();let resolve
    const pending=all({signal:controller.signal,request:()=>new Promise(done=>{resolve=done})})
    const check=expect(pending).rejects.toMatchObject({name:'AbortError'})
    controller.abort();await check;resolve(page())
  })
  it('cancels between page reads without reaching download preparation', async () => {
    const controller=new AbortController(),request=vi.fn(async f=>page(f.page))
    await expect(all({signal:controller.signal,request,onProgress:()=>controller.abort()})).rejects.toMatchObject({name:'AbortError'})
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('times out and releases the deadline timer', async () => {
    vi.useFakeTimers();let resolve
    const pending=all({request:()=>new Promise(done=>{resolve=done})})
    const check=expect(pending).rejects.toThrow('超过两分钟')
    await vi.advanceTimersByTimeAsync(SEARCH_EXPORT_TIMEOUT);await check;resolve(page())
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects oversized metadata instead of silently shortening titles', async () => {
    await expect(all({request:async()=>({...page(1,1),items:[{...item(1),title:'x'.repeat(MAX_SEARCH_EXPORT_BYTES)}]})},page(1,1))).rejects.toThrow('8 MiB')
  })
  it('keeps unsupported-body counts visible and distinguishes total from selected mentions', async () => {
    const result=await all({mode:'selected',selection:[choice(1)],includeSnippets:true})
    const raw=serializeSearchResultReport(result)
    expect(raw).toContain('1 篇 / 范围内 65 篇');expect(raw).toContain('4 处；整个范围：260 处')
    expect(raw).toContain('2 篇正文格式未能解析');expect(raw).toContain('还有 3 处命中未附节选')
  })
  it('escapes hostile markdown and HTML while retaining readable Unicode', async () => {
    const result=await all({includeSnippets:true,request:async()=>({...page(1,1),items:[{...item(1),title:'<img src=x>\n# 标题 [link](javascript:evil) ```'}]})},page(1,1))
    const raw=serializeSearchResultReport(result)
    for(const value of ['<img','<script>','[link]','javascript:', '\n# 标题','```'])expect(raw).not.toContain(value)
    expect(raw).toContain('关关');expect(raw).toContain('&#60;script&#62;')
  })
  it('JSON roundtrips metadata and optional snippets exactly without becoming a preset backup', async () => {
    const result=await all({includeSnippets:true})
    const raw=serializeSearchResultReport(result,'json')
    expect(JSON.parse(raw)).toEqual(result);expect(JSON.parse(raw).format).toBe('local-notepad-search-results')
  })
  it('rejects unsupported formats and an oversized serialized representation', async () => {
    const result=await all({},page(1,1))
    expect(()=>serializeSearchResultReport(result,'csv')).toThrow('不支持')
    expect(()=>serializeSearchResultReport({...result,items:[{...result.items[0],title:'<'.repeat(MAX_SEARCH_EXPORT_BYTES/2)}]})).toThrow('8 MiB')
  })
  it('download has a non-query filename and always cleans up the URL and anchor', async () => {
    vi.useFakeTimers();const create=vi.fn(()=> 'blob:export'),revoke=vi.fn()
    vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:create,revokeObjectURL:revoke}))
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
    const result=await all({now:new Date('2026-09-23T12:00:00Z')},page(1,1))
    const name=downloadSearchResultReport(result,'json')
    expect(name).toMatch(/\.json$/);expect(name).not.toContain('关关');expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a')).toBeNull();await vi.advanceTimersByTimeAsync(1000);expect(revoke).toHaveBeenCalledWith('blob:export')
  })
  it('cleans up after a download dispatch failure and does not claim a saved file', async () => {
    vi.useFakeTimers();const revoke=vi.fn()
    vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:()=> 'blob:failed',revokeObjectURL:revoke}))
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{throw new Error('download blocked')})
    const report=await all({},page(1,1))
    expect(()=>downloadSearchResultReport(report,'markdown')).toThrow('blocked')
    expect(document.querySelector('a')).toBeNull();await vi.advanceTimersByTimeAsync(1000);expect(revoke).toHaveBeenCalled()
  })
})

it('uses the production API wrapper and encoded read-only query without a request substitute', async () => {
  const fetch = vi.fn(async url => {
    const params = new URL(url).searchParams
    expect(params.get('q')).toBe('关关')
    expect(params.get('revision')).toBe('b'.repeat(64))
    expect(params.has('anchor_id')).toBe(false)
    return {ok:true, json:async()=>({code:0,data:page(Number(params.get('page')))})}
  })
  vi.stubGlobal('fetch', fetch)
  const report = await collectSearchResultReport(filters, page(), {mode:'all'})
  expect(report.items).toHaveLength(65)
  expect(fetch).toHaveBeenCalledTimes(5)
  expect(fetch.mock.calls.every(([,init]) => !init.method && init.signal instanceof AbortSignal)).toBe(true)
})
it('production API errors cannot produce a partial report', async () => {
  let calls=0
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=> ++calls===1 ? {code:0,data:page()} : {code:1005,detail:'检索版本已变化'}})))
  await expect(collectSearchResultReport(filters,page(),{mode:'all'})).rejects.toThrow('版本已变化')
})

it('refuses inconsistent per-note mention totals despite a plausible scope count', async () => {
  await expect(all({ request: async f => { const data = page(f.page); data.items[0].body_count = 5; return data } })).rejects.toThrow('变化')
})
