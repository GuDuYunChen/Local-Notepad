import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto, createHash } from 'node:crypto'
import { api } from './api'
import { searchParameters, searchLibrary, searchTitleSegments, validateSearchResponse, prepareSearchLocation } from './globalSearch'
import { resolveEvidenceTarget } from '../components/Editor/utils/evidenceNavigationUtils'
vi.mock('./api', () => ({ api: vi.fn() }))
export const digest = content => createHash('sha256').update(content).digest('hex')
const body = JSON.stringify({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: '😀关' }, { type: 'text', text: '关与关关', format: 1 }] }] } })
const item = () => ({ id: 'a', title: 'one', folder_path: '根目录', updated_at: 0, is_pinned: false, title_match: false, body_count: 2, content_sha256: digest(body), snippets: [{ kind: 'body', start: 5, end: 7, before: '😀关关与', match: '关关', after: '', leading: false, trailing: false }] })
const reply = () => ({ query: '关关', items: [item()], total: 1, total_occurrences: 2, folders: [], page: 1, pages: 1, page_size: 20, scanned: 1, unsupported: 0, revision: 'a'.repeat(64) })
beforeEach(() => { api.mockReset(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.unstubAllGlobals() })

describe('global search protocol and location', () => {
 it('encodes literal punctuation and every selected filter without FTS operators', () => {
   const params = searchParameters({ query: ' 100%_ A+B ', source: 'body', folderId: 'id/&?', pinned: true, matchCase: true, since: 100, sort: 'title', page: 3, revision: 'b'.repeat(64) })
   expect(params.get('q')).toBe('100%_ A+B'); expect(params.get('folder_id')).toBe('id/&?'); expect(params.get('size')).toBe('20'); expect(params.get('page')).toBe('3'); expect(params.get('revision')).toBe('b'.repeat(64))
 })
 it('validates the Unicode codepoint query limit without truncating it', () => {
   expect(() => searchParameters({ query: '😀'.repeat(128) })).not.toThrow()
   expect(() => searchParameters({ query: '😀'.repeat(129) })).toThrow('128')
 })
 it('normalizes composed spellings and highlights every literal title occurrence', () => {
   expect(searchTitleSegments('E\u0301lodie ÉLODIE', 'élodie').filter(part => part.match).map(part => part.text)).toEqual(['Élodie', 'ÉLODIE'])
   expect(searchTitleSegments('A+B versus AAB A+B', 'A+B').filter(part => part.match)).toHaveLength(2)
 })
 it('handles case-sensitive matching and markup as text without slicing wrong offsets', () => {
   expect(searchTitleSegments('İ alpha ALPHA', 'alpha', true)).toEqual([{ text: 'İ ', match: false }, { text: 'alpha', match: true }, { text: ' ALPHA', match: false }])
   expect(searchTitleSegments('<img>needle</img>', 'needle').map(p => p.text).join('')).toBe('<img>needle</img>')
 })
 it('passes an AbortSignal to the search endpoint and validates its result', async () => {
   api.mockResolvedValue(reply()); const signal = new AbortController().signal
   await expect(searchLibrary({ query: '关关' }, signal)).resolves.toMatchObject({ total: 1 })
   expect(api.mock.calls[0][0]).toContain('/api/search?'); expect(api.mock.calls[0][1].signal).toBe(signal)
 })
 it('rejects missing totals instead of pretending there are no results', () => {
   for (const value of [null, [], {}, { ...reply(), total: undefined }, { ...reply(), revision: '' }, { ...reply(), total: 21 }, { ...reply(), items: [] }]) expect(() => validateSearchResponse(value)).toThrow('回执')
 })
 it('rejects duplicate identities and malformed snippets', () => {
   expect(() => validateSearchResponse({ ...reply(), total: 2, scanned: 2, items: [item(), item()] })).toThrow()
   expect(() => validateSearchResponse({ ...reply(), items: [{ ...item(), snippets: [{ ...item().snippets[0], kind: '__proto__' }] }] })).toThrow()
   expect(() => validateSearchResponse({ ...reply(), folders: [{ id: 'a', label: 'one' }, { id: 'a', label: 'two' }] })).toThrow()
 })
 it('accepts an explicit empty success with stable pagination', () => {
   expect(validateSearchResponse({ ...reply(), items: [], total: 0, total_occurrences: 0, scanned: 0 })).toMatchObject({ total: 0 })
 })
 it('locates the selected repeated occurrence across formatting and astral characters', async () => {
   api.mockResolvedValue({ id: 'a', content: body })
   const target = await prepareSearchLocation(item(), item().snippets[0])
   const resolved = resolveEvidenceTarget(body, target)
   expect(resolved.status).toBe('found'); expect(resolved.anchor).toEqual({ path: [0, 1], offset: 2 }); expect(target.start).toBe(5)
 })
 it('rejects body changes even when the selected phrase still exists', async () => {
   api.mockResolvedValue({ id: 'a', content: body.replace('😀', '后来') })
   await expect(prepareSearchLocation(item(), item().snippets[0])).rejects.toThrow('正文已变化')
 })
 it('refuses deleted or wrong files, without creating navigation', async () => {
   for (const file of [{ id: 'a', content: body, is_deleted: true }, { id: 'b', content: body }, null]) {
     api.mockResolvedValue(file); await expect(prepareSearchLocation(item(), item().snippets[0])).rejects.toThrow('不存在')
   }
 })
 it('does not pretend code and link labels have prose offsets', async () => {
   await expect(prepareSearchLocation(item(), { kind: 'code' })).rejects.toThrow('暂不支持')
   expect(api).not.toHaveBeenCalled()
 })
 it('cannot guess a location when the service provides wrong offsets', async () => {
   api.mockResolvedValue({ id: 'a', content: body })
   await expect(prepareSearchLocation(item(), { ...item().snippets[0], start: 0, end: 2 })).rejects.toThrow('映射')
 })
 it('does not complete cancelled hashing/fetch operations', async () => {
   api.mockResolvedValue({ id: 'a', content: body }); const controller = new AbortController(); controller.abort()
   await expect(prepareSearchLocation(item(), item().snippets[0], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
 })
 it('reports hash support failures instead of skipping version protection', async () => {
   api.mockResolvedValue({ id: 'a', content: body }); vi.stubGlobal('crypto', {})
   await expect(prepareSearchLocation(item(), item().snippets[0])).rejects.toThrow('无法校验')
 })
})

it('rejects invalid cache metrics instead of displaying misleading counts', () => {
  // A valid response is supplied by the same response fixture used above.
  const valid = { items: [], folders: [], total:0, total_occurrences:0, page:1, pages:1, page_size:20, revision:'a'.repeat(64), scanned:2, unsupported:0, query:'x' }
  expect(() => validateSearchResponse({...valid,cache_hits:2,parsed:1})).toThrow()
  expect(() => validateSearchResponse({...valid,cache_hits:-1,parsed:0})).toThrow()
  expect(() => validateSearchResponse({...valid,cache_hits:1})).toThrow()
  expect(validateSearchResponse({...valid,cache_hits:1,parsed:1}).cache_hits).toBe(1)
  expect(validateSearchResponse(valid)).toBe(valid)
})

it('encodes return identities literally and rejects invalid anchor IDs', () => {
 expect(searchParameters({ anchorId: 'a/&?' }).get('anchor_id')).toBe('a/&?')
 for (const anchorId of ['x'.repeat(513), 'a\0b', {}]) expect(() => searchParameters({anchorId})).toThrow()
})
it('requires an exact anchor acknowledgement from the backend', async () => {
 for (const patch of [{}, {anchor_id:'wrong',anchor_found:true}, {anchor_id:'a',anchor_found:false}]) {
  api.mockResolvedValue({...reply(),...patch});await expect(searchLibrary({anchorId:'a'})).rejects.toThrow('原结果回执')
 }
 api.mockResolvedValue({...reply(),anchor_id:'a',anchor_found:true});await expect(searchLibrary({anchorId:'a'})).resolves.toMatchObject({anchor_found:true})
})
it('accepts an explicitly missing anchor without inventing a selected target', async () => {
 api.mockResolvedValue({...reply(),anchor_id:'deleted',anchor_found:false})
 await expect(searchLibrary({anchorId:'deleted'})).resolves.toMatchObject({anchor_found:false})
})
