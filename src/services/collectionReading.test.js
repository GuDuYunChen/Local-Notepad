import { describe, it, expect } from 'vitest'
import { collectionFixture, collectionReport } from '../test/collectionFixtures'
import { compareSearchCollection } from './searchCollections'
import { createCollectionReadingContext, readCollectionReadingContext, stepCollectionReading, restoreCollectionReading, selectCollectionRows } from './collectionReading'
const view = { query: '', status: 'all' }

describe('collection reading identity and bounded scope', () => {
  it('builds the full cross-page queue, not the current eight rows', () => {
    const { entry } = collectionFixture(); const context = createCollectionReadingContext(entry, null, view, 'n22')
    expect(context.queue).toHaveLength(23); expect(context.index).toBe(22); expect(context.documentId).toBe('n22')
    expect(context.queue[0].title).toBe('章节 0')
  })
  it('restores the exact page from identity and keeps filter text', () => {
    const { entry, store } = collectionFixture(); const context = createCollectionReadingContext(entry, null, view, 'n17')
    const restored = restoreCollectionReading(context, store)
    expect(restored.page).toBe(3); expect(restored.context.view).toEqual(view); expect(restored.check).toBeNull()
  })
  it('steps across page boundaries without changing collection bytes', () => {
    const { entry, store, storage, key } = collectionFixture()
    const before = storage.getItem(key), context = createCollectionReadingContext(entry, null, view, 'n7')
    const next = stepCollectionReading(context, 1, store)
    expect(next.documentId).toBe('n8'); expect(stepCollectionReading(next, -1, store).documentId).toBe('n7')
    expect(storage.getItem(key)).toBe(before); expect(context.documentId).toBe('n7')
  })
  it('never wraps around at either end', () => {
    const { entry, store } = collectionFixture(2)
    expect(stepCollectionReading(createCollectionReadingContext(entry, null, view, 'n0'), -1, store)).toBeNull()
    expect(stepCollectionReading(createCollectionReadingContext(entry, null, view, 'n1'), 1, store)).toBeNull()
  })
  it('search and status produce the same queue as visible rows', () => {
    const { entry, collection } = collectionFixture()
    const report = collectionReport(); report.items[3].title = '  Ａlice  '; report.items[13].title = 'ALICE'; report.items[13].contentSHA256 = 'c'.repeat(64)
    const check = compareSearchCollection(collection, report), filtered = { query: ' alice ', status: 'body' }
    const context = createCollectionReadingContext(entry, check, filtered, 'n13')
    expect(context.queue.map(row => row.id)).toEqual(selectCollectionRows(collection, check, filtered).map(row => row.id))
    expect(context.queue).toHaveLength(1)
  })
  it('preserves the old comparison time on return rather than calling it live', () => {
    const { entry, store, collection } = collectionFixture()
    const check = compareSearchCollection(collection, collectionReport())
    const context = createCollectionReadingContext(entry, check, view, 'n2')
    expect(restoreCollectionReading(context, store).check.checkedAt).toBe(check.checkedAt)
  })
  it('outside entries remain navigable by identity and are never deleted from the queue', () => {
    const { entry, collection } = collectionFixture()
    const check = compareSearchCollection(collection, collectionReport(0))
    const context = createCollectionReadingContext(entry, check, { query: '', status: 'outside' }, 'n22')
    expect(context.queue).toHaveLength(23)
  })
  it('rejects an item outside the filtered scope', () => {
    const { entry } = collectionFixture()
    expect(() => createCollectionReadingContext(entry, null, { query: '章节 22', status: 'all' }, 'n0')).toThrow()
  })
  it('does not conflate identical titles with identities', () => {
    const { entry, store } = collectionFixture(2)
    const value = JSON.parse(entry.raw); value.report.items[1].title = value.report.items[0].title
    const raw = JSON.stringify(value); const local = { key: entry.key, raw }
    const context = createCollectionReadingContext(local, null, view, 'n1')
    expect(context.index).toBe(1); expect(context.queue.map(row => row.id)).toEqual(['n0', 'n1'])
    expect(() => readCollectionReadingContext(context, store)).toThrow()
  })
  it.each(['remove', 'change', 'corrupt'])('refuses %s of the stored source', operation => {
    const { entry, store, storage, key } = collectionFixture()
    const context = createCollectionReadingContext(entry, null, view, 'n0')
    if (operation === 'remove') storage.removeItem(key)
    else storage.setItem(key, operation === 'change' ? entry.raw + ' ' : 'broken')
    expect(() => stepCollectionReading(context, 1, store)).toThrow()
    expect(() => restoreCollectionReading(context, store)).toThrow()
  })
  it('handles blocked storage by failing without an empty-collection claim', () => {
    const { entry } = collectionFixture()
    const context = createCollectionReadingContext(entry, null, view, 'n0')
    expect(() => readCollectionReadingContext(context, { readUnchanged() { throw new Error('permission') } })).toThrow('permission')
  })
  it('rebuilds rather than trusting forged queue and index fields', () => {
    const { entry, store } = collectionFixture()
    const context = createCollectionReadingContext(entry, null, view, 'n0')
    const valid = readCollectionReadingContext({ ...context, index: 999, queue: [{ id: 'secret' }] }, store)
    expect(valid.index).toBe(0); expect(valid.queue[0].id).toBe('n0')
  })
  it('rejects a check with a different fixed scope', () => {
    const { entry } = collectionFixture(); const current = collectionReport(); current.scope.criteria.folderId = 'different'
    expect(() => createCollectionReadingContext(entry, { currentReport: current }, view, 'n0')).toThrow('范围不一致')
  })
  it('holds immutable detached queue metadata with no arbitrary item fields', () => {
    const { entry } = collectionFixture(); const context = createCollectionReadingContext(entry, null, view, 'n0')
    expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen(context.queue[0])).toBe(true)
    expect(Object.keys(context.queue[0])).toEqual(['id', 'title']); expect(context.view).not.toBe(view)
  })
  it.each([null, {}, { kind: 'search' }])('invalid return contexts never fall back to all notes', context => {
    expect(() => readCollectionReadingContext(context)).toThrow()
  })
  it.each([0, 2, NaN])('invalid direction %s cannot jump arbitrary queue positions', direction => {
    const { entry, store } = collectionFixture()
    expect(() => stepCollectionReading(createCollectionReadingContext(entry, null, view, 'n0'), direction, store)).toThrow()
  })
})
