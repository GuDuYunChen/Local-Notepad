import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Deterministic IDB request/transaction event fixture. This is not evidence of
// browser disk persistence; mutations become visible only at transaction commit.
function idbFixture(initial = []) {
  const records = new Map(initial.map(value => [value.id, structuredClone(value)]))
  const f = { records, requests: [], transactions: [], openRequests: [], closes: 0 }
  const later = fn => Promise.resolve().then(fn)
  const database = {
    objectStoreNames: { contains: () => true },
    close: () => { f.closes++ },
    transaction(_name, mode) {
      const tx = { mode, pending: 0, writes: [], done: false, error: null }
      f.transactions.push(tx)
      tx.abort = () => { if (tx.done) return; tx.done = true; tx.error = new Error('transaction aborted'); later(() => tx.onabort?.()) }
      tx.complete = () => {
        if (tx.done) return
        tx.done = true
        for (const [method, key, value] of tx.writes) method === 'put' ? records.set(key, structuredClone(value)) : records.delete(key)
        tx.oncomplete?.()
      }
      tx.objectStore = () => Object.fromEntries(['get', 'put', 'delete'].map(method => [method, input => {
        const key = method === 'put' ? input.id : input
        const request = { error: null }; f.requests.push({ method, key, request, tx }); tx.pending++
        later(() => {
          if (tx.done) return
          if (method === 'get') {
            request.result = records.has(key) ? structuredClone(records.get(key)) : undefined
            f.beforeReadSuccess?.(key)
          } else tx.writes.push([method, key, input])
          request.onsuccess?.(); tx.pending--
          later(() => {
            if (tx.done || tx.pending) return
            if (mode === 'readwrite' && f.abortWrites) tx.abort()
            else if (!(mode === 'readwrite' && f.holdWrites)) tx.complete()
          })
        })
        return request
      }]))
      return tx
    },
  }
  f.completeOpen = request => { request.result = database; request.onsuccess?.() }
  f.open = () => {
    if (f.openError) throw new Error('storage disabled')
    const request = {}; f.openRequests.push(request)
    if (f.blockOpen) later(() => request.onblocked?.())
    else if (!f.hangOpen) later(() => f.completeOpen(request))
    return request
  }
  return f
}
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const saved = (id, content = 'old persistent draft') => ({ id, content, editedAt: 10, savedAt: 1 })
let fixture, cache, events
beforeEach(async () => {
  vi.resetModules(); localStorage.clear(); events = []
  fixture = idbFixture(); vi.stubGlobal('indexedDB', fixture)
  vi.stubGlobal('dispatchEvent', event => { events.push({ type: event.type, detail: event.detail }); return true })
  cache = await import('./editorDraftCache.js')
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('durable editor draft ordering and transaction boundaries', () => {
  it('does not resurrect a draft removed while its durable read is in flight', async () => {
    fixture.records.set('a', saved('a'))
    fixture.beforeReadSuccess = () => { fixture.beforeReadSuccess = null; cache.removeEditorDraft('a') }
    expect(await cache.readEditorDraftDurable('a')).toBeNull()
    expect(cache.readEditorDraft('a')).toBeNull()
    await drain(); expect(fixture.records.has('a')).toBe(false)
  })
  it('does not replace a new edit with an older in-flight durable read', async () => {
    fixture.records.set('a', saved('a'))
    fixture.beforeReadSuccess = () => { fixture.beforeReadSuccess = null; cache.writeEditorDraft('a', 'new edit', 1) }
    expect((await cache.readEditorDraftDurable('a')).content).toBe('new edit')
    expect(cache.readEditorDraft('a').content).toBe('new edit')
    await drain(); expect(fixture.records.get('a').content).toBe('new edit')
  })
  it('waits for transaction completion, not only put request success', async () => {
    fixture.holdWrites = true
    cache.writeEditorDraft('a', 'new edit', 1)
    let settled = false
    const read = cache.readEditorDraftDurable('a').then(value => { settled = true; return value })
    await drain()
    expect(fixture.requests.some(item => item.method === 'put')).toBe(true)
    expect(settled).toBe(false)
    expect(fixture.records.has('a')).toBe(false)
    fixture.holdWrites = false
    fixture.transactions.filter(tx => tx.mode === 'readwrite').forEach(tx => tx.complete())
    expect((await read).content).toBe('new edit')
    expect(fixture.records.get('a').content).toBe('new edit')
  })
  it('reports an aborted write even after its put request succeeded', async () => {
    { const storage = localStorage; vi.stubGlobal('localStorage', { getItem: key => storage.getItem(key), removeItem: key => storage.removeItem(key), setItem() { throw new Error('quota') } }) }
    fixture.abortWrites = true
    cache.writeEditorDraft('a', 'only in memory', 1)
    await drain()
    expect(fixture.records.has('a')).toBe(false)
    expect(cache.readEditorDraft('a').content).toBe('only in memory')
    expect(events.some(event => event.type === 'editor:draft-persistence-error' && event.detail.id === 'a')).toBe(true)
  })
  it('lets a committed delete finish before a later read can use persistent data', async () => {
    fixture.records.set('a', saved('a')); fixture.holdWrites = true
    cache.removeEditorDraft('a')
    let settled = false
    const read = cache.readEditorDraftDurable('a').then(value => { settled = true; return value })
    await drain(); expect(settled).toBe(false)
    fixture.holdWrites = false
    fixture.transactions.filter(tx => tx.mode === 'readwrite').forEach(tx => tx.complete())
    expect(await read).toBeNull(); expect(fixture.records.has('a')).toBe(false)
  })
  it('keeps a current-session removal authoritative when localStorage removal fails', async () => {
    localStorage.setItem('editor:cache:a', JSON.stringify(saved('a')))
    { const storage = localStorage; vi.stubGlobal('localStorage', { getItem: key => storage.getItem(key), setItem: (key, value) => storage.setItem(key, value), removeItem() { throw new Error('storage denied') } }) }
    fixture.openError = true
    cache.removeEditorDraft('a')
    expect(cache.readEditorDraft('a')).toBeNull()
    expect(await cache.readEditorDraftDurable('a')).toBeNull()
  })
  it('can still read an existing local draft when storage has no write quota', () => {
    localStorage.setItem('editor:cache:a', JSON.stringify(saved('a')))
    { const storage = localStorage; vi.stubGlobal('localStorage', { getItem: key => storage.getItem(key), removeItem: key => storage.removeItem(key), setItem() { throw new Error('quota') } }) }
    expect(cache.readEditorDraft('a')?.content).toBe('old persistent draft')
  })
  it('closes a database that opens after the blocked open was already rejected', async () => {
    fixture.blockOpen = true
    expect(await cache.readEditorDraftDurable('a')).toBeNull()
    fixture.completeOpen(fixture.openRequests[0]); await drain()
    expect(fixture.closes).toBe(1)
  })
  it('bounds a hung database open and retains the current draft', async () => {
    vi.useFakeTimers(); fixture.hangOpen = true
    cache.writeEditorDraft('a', 'local fallback', 1)
    const read = cache.readEditorDraftDurable('a')
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await read).content).toBe('local fallback')
    fixture.openRequests.forEach(request => fixture.completeOpen(request))
    await drain(); expect(fixture.closes).toBe(fixture.openRequests.length)
  })
  it('reports the memory-only limit instead of silently skipping persistence', async () => {
    cache.writeEditorDraft('a', 'x'.repeat(16 * 1024 * 1024 + 1), 1)
    await drain()
    expect(events.some(event => event.type === 'editor:draft-persistence-error' && event.detail.id === 'a')).toBe(true)
  })
  it('restores a large committed mirror with its recovery identity after a new module instance', async () => {
    const body = 'x'.repeat(1024 * 1024 + 1)
    const recovery = { version: 1, id: 'a', expectedContent: 'database', conflicted: false, attempt: null }
    cache.writeEditorDraft('a', body, 1, recovery)
    await cache.readEditorDraftDurable('a')
    vi.resetModules(); const restarted = await import('./editorDraftCache.js')
    const restored = await restarted.readEditorDraftDurable('a')
    expect(restored.content).toBe(body); expect(restored.recovery).toEqual(recovery)
  })
  it('preserves the order of write, remove, and a newer write', async () => {
    cache.writeEditorDraft('a', 'first', 1); cache.removeEditorDraft('a'); cache.writeEditorDraft('a', 'latest', 1)
    expect((await cache.readEditorDraftDurable('a')).content).toBe('latest')
    expect(fixture.records.get('a').content).toBe('latest')
  })
})
