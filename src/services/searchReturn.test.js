import { it, expect } from 'vitest'
import { createSearchReturnContext, restoreSearchReturnFilters } from './searchReturn'
const filters = () => ({ query: '关关', source: 'body', folderId: 'p', pinned: false, matchCase: true, days: '7', sort: 'updated', page: 9, revision: 'secret', content: 'secret body' })
const item = { id: 'a', title: '第一章', content: 'not retained', snippets: ['not retained'] }
const context = () => createSearchReturnContext(item, filters(), { page: 3, items: [item] }, 180)
it('retains only detached navigation metadata and whitelisted filters', () => {
 const c = context(); expect(Object.keys(c)).toEqual(['documentId', 'title', 'filters', 'page', 'scrollTop'])
 expect(JSON.stringify(c)).not.toContain('secret'); expect(JSON.stringify(c)).not.toContain('snippets')
 expect(Object.isFrozen(c)).toBe(true); expect(Object.isFrozen(c.filters)).toBe(true)
})
it('returns by identity with a fresh revision and recomputed rolling date', () => {
 expect(restoreSearchReturnFilters(context(), Date.parse('2026-10-01T00:00:00.000Z'))).toMatchObject({
  page: 3, anchorId: 'a', revision: '', since: Date.parse('2026-09-24T00:00:00.000Z')/1000, folderId: 'p', days: '7',
 })
})
it('rejects unknown results and malformed identities instead of guessing an origin', () => {
 for (const i of [null, {...item, id:''}, {...item, id:'a\0b'}, {...item, id:'x'.repeat(513)}]) expect(createSearchReturnContext(i, filters(), {page:1,items:[item]})).toBeNull()
 expect(createSearchReturnContext(item, filters(), {page:1,items:[]})).toBeNull()
})
it('normalizes invalid scroll and rejects invalid page tokens', () => {
 expect(createSearchReturnContext(item, filters(), {page:1,items:[item]}, Infinity).scrollTop).toBe(0)
 expect(createSearchReturnContext(item, filters(), {page:0,items:[item]})).toBeNull()
 expect(() => restoreSearchReturnFilters({...context(),page:NaN})).toThrow()
})
it('does not mutate source filters and never persists automatic search history', () => {
 const f=filters(), before=structuredClone(f);const c=createSearchReturnContext(item,f,{page:1,items:[item]})
 f.query='changed';expect(c.filters.query).toBe('关关');expect(before.query).toBe('关关')
 expect(restoreSearchReturnFilters({...c,filters:{...c.filters,days:'0'}}).since).toBe(0)
})
