import assert from 'node:assert/strict'
import { validDailyDate, dailyDateKey, dailyCalendar, moveDailyMonth, dailyRequest, readDailyIndex, createDailyWorkspace } from '../src/services/dailyNotes.mjs'
const file = (patch = {}) => ({ id: 'note-a', title: '2026-10-13', content: 'saved-body', parent_id: '', is_folder: false, is_deleted: false, updated_at: 20, ...patch })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }
export function registerDailyNotesTests(test) {
  for (const key of ['2024-02-29', '2000-02-29', '2026-10-13', '0001-01-01', '9999-12-31']) test('valid civil date ' + key, () => assert.equal(validDailyDate(key), true))
  for (const key of ['2025-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '0000-01-01', '2026-2-01', '', '../note', '2026-10-13x', null])
    test('invalid date refused ' + key, () => assert.equal(validDailyDate(key), false))
  test('month movement clamps day and respects year bounds', () => {
    assert.equal(moveDailyMonth('2024-01-31', 1), '2024-02-29'); assert.equal(moveDailyMonth('2025-01-31', 1), '2025-02-28')
    assert.equal(moveDailyMonth('2026-01-01', -1), '2025-12-01'); assert.equal(moveDailyMonth('0001-01-01', -1), null); assert.equal(moveDailyMonth('9999-12-31', 1), null)
  })
  test('calendar has each day once, includes leap day and only leading padding', () => {
    const days = dailyCalendar('2024-02-17'); assert.equal(days.filter(Boolean).length, 29)
    assert.equal(days.filter(Boolean).at(-1).key, '2024-02-29'); assert.equal(new Set(days.filter(Boolean).map(d => d.key)).size, 29)
    assert.equal(dailyDateKey(new Date(2026, 9, 13, 0, 1)), '2026-10-13')
  })
  test('complete index ignores nested, deleted and non-calendar names; surfaces folders and duplicates', async () => {
    const value = [file(), file({ id: 'nested', parent_id: 'folder' }), file({ id: 'deleted', is_deleted: true }),
      file({ id: 'bad-date', title: '2025-02-29' }), file({ id: 'ordinary', title: 'hello' }),
      file({ id: 'duplicate' }), file({ id: 'folder', title: '2026-10-12', is_folder: true })]
    const result = await readDailyIndex(() => value)
    assert.deepEqual(result.notes.map(n => n.id), ['duplicate', 'note-a']); assert.deepEqual(new Set(result.conflicts), new Set(['2026-10-13', '2026-10-12']))
  })
  test('nil and genuinely empty metadata lists are empty success', async () => {
    for (const value of [null, []]) assert.deepEqual(await readDailyIndex(() => value), { notes: [], conflicts: [] })
  })
  for (const value of [undefined, {}, '[]', [file({ id: null })], [file(), file()]]) test('malformed metadata fails instead of empty success: ' + JSON.stringify(value), async () => {
    await assert.rejects(readDailyIndex(() => value), { code: 'index' })
  })
  test('index drains multiple real page shapes without silently truncating at 200', async () => {
    const first = Array.from({ length: 200 }, (_, id) => file({ id: 'first-' + id, title: 'ordinary-' + id })), calls = []
    const result = await readDailyIndex(path => { calls.push(path); return calls.length === 1 ? first : [file()] })
    assert.equal(calls.length, 2); assert.match(calls[1], /page=2&size=200&compact=1$/); assert.equal(result.notes.length, 1)
  })
  test('failed second page never returns a partial index', async () => {
    let calls = 0
    await assert.rejects(readDailyIndex(() => { if (calls++) throw Error('database detail'); return Array.from({ length: 200 }, (_, n) => file({ id: String(n) })) }))
    assert.equal(calls, 2)
  })
  test('cancellation before the deferred send performs zero requests', async () => {
    const controller = new AbortController(); let sent = 0
    const promise = dailyRequest(() => { sent++ }, '/notes', { signal: controller.signal }); controller.abort()
    await assert.rejects(promise, { code: 'cancelled' }); assert.equal(sent, 0)
  })
  test('timeout rejects ignored-abort requests and consumes late rejection', async () => {
    const d = deferred(); let signal
    const promise = dailyRequest((_p, init) => { signal = init.signal; return d.promise }, '/notes', {}, 15)
    await assert.rejects(promise, { code: 'timeout' }); assert.equal(signal.aborted, true)
    d.reject(Error('late private error')); await flush()
  })
  test('existing daily opens via read-only request; no POST and no original content mutation', async () => {
    const calls = [], original = file(), session = createDailyWorkspace((path, init) => { calls.push([path, init.method]); return { file: original, created: false } })
    const result = await session.open(original.title)
    assert.deepEqual(calls, [['/api/files/daily/2026-10-13?read_only=1', undefined]])
    assert.equal(result.file, original); assert.equal(original.content, 'saved-body'); assert.equal(session.snapshot().busy, false)
  })
  test('missing date is created once only after successful read-only check', async () => {
    const calls = [], created = file({ content: '' }), session = createDailyWorkspace((path, init) => {
      calls.push([path, init.method]); return init.method === 'POST' ? { file: created, created: true } : { file: null, created: false }
    })
    const result = await session.open(created.title)
    assert.equal(calls.length, 2); assert.equal(calls[1][1], 'POST'); assert.equal(result.created, true)
  })
  test('inspection of a missing date has no side effects', async () => {
    let sends = 0; const session = createDailyWorkspace((_p, init) => { sends++; assert.equal(init.method, undefined); return { file: null, created: false } })
    assert.equal((await session.open('2026-10-13', { inspectOnly: true })).file, null); assert.equal(sends, 1)
  })
  test('concurrent date opens are refused while original task is waiting', async () => {
    const d = deferred(); let sends = 0; const session = createDailyWorkspace(() => { sends++; return d.promise })
    const first = session.open('2026-10-13'); await flush()
    await assert.rejects(session.open('2026-10-14'), { code: 'busy' }); assert.equal(sends, 1)
    d.resolve({ file: file(), created: false }); await first
  })
  test('cancellation during preflight cannot send a later creation', async () => {
    const d = deferred(), calls = []; const session = createDailyWorkspace((p, i) => { calls.push([p, i.method]); return d.promise })
    const promise = session.open('2026-10-13'); await flush(); session.cancel(); await assert.rejects(promise)
    d.resolve({ file: null, created: false }); await flush()
    assert.equal(calls.length, 1); assert.deepEqual(session.snapshot().uncertain, [])
  })
  for (const bad of [{ file: null, created: true }, { file: file({ title: '2026-10-14' }), created: false },
    { file: file({ parent_id: 'nested' }), created: false }, { file: file({ is_folder: true }), created: false },
    { file: file({ is_deleted: true }), created: false }, { file: file({ content: null }), created: false }])
    test('wrong note/identity/receipt cannot be opened: ' + JSON.stringify(bad), async () => {
      let calls = 0; const session = createDailyWorkspace(() => { calls++; return bad })
      await assert.rejects(session.open('2026-10-13'), { code: 'receipt' }); assert.equal(calls, 1)
    })
  test('lost creation reply is reconciled read-only with the committed note and no second POST', async () => {
    let stored = null, posts = 0
    const session = createDailyWorkspace((_p, init) => {
      if (init.method === 'POST') { posts++; stored = file(); throw Error('reply lost after commit') }
      return { file: stored, created: false }
    })
    await assert.rejects(session.open('2026-10-13')); assert.deepEqual(session.snapshot().uncertain, ['2026-10-13'])
    const result = await session.open('2026-10-13', { inspectOnly: true }); assert.equal(result.file.id, stored.id)
    assert.equal(posts, 1); assert.deepEqual(session.snapshot().uncertain, [])
  })
  test('negative reconciliation retains uncertainty and will not automatically re-create', async () => {
    let posts = 0; const session = createDailyWorkspace((_p, init) => { if (init.method === 'POST') { posts++; throw Error('offline') }; return { file: null, created: false } })
    await assert.rejects(session.open('2026-10-13')); const result = await session.open('2026-10-13')
    assert.equal(result.uncertain, true); assert.equal(posts, 1); assert.equal(session.snapshot().kind, 'uncertain')
  })
  test('explicit uncertain-create consent still rechecks then accepts an existing note without writing', async () => {
    let posts = 0, found = false; const session = createDailyWorkspace((_p, init) => { if (init.method === 'POST') { posts++; throw Error('lost') }; return { file: found ? file() : null, created: false } })
    await assert.rejects(session.open('2026-10-13')); found = true
    const result = await session.open('2026-10-13', { acknowledgeUncertain: true }); assert.equal(result.file.id, 'note-a'); assert.equal(posts, 1)
  })
  test('cancelling an already dispatched creation retains its date and ignores late success', async () => {
    const d = deferred(); let posts = 0; const session = createDailyWorkspace((_p, init) => { if (init.method === 'POST') { posts++; return d.promise }; return { file: null, created: false } })
    const promise = session.open('2026-10-13'); await flush(); assert.equal(posts, 1); session.cancel(); await assert.rejects(promise)
    d.resolve({ file: file(), created: true }); await flush(); assert.equal(session.snapshot().kind, 'uncertain'); assert.deepEqual(session.snapshot().uncertain, ['2026-10-13'])
  })
  test('invalid date never reaches transport and subscribers detach cleanly', async () => {
    let calls = 0, updates = 0; const session = createDailyWorkspace(() => { calls++; return { file: file(), created: false } })
    const detach = session.subscribe(() => updates++); await assert.rejects(session.open('2025-02-29'), { code: 'date' }); assert.equal(calls, 0)
    await session.open('2026-10-13'); assert.ok(updates > 0); const n = updates; detach(); await session.open('2026-10-13'); assert.equal(updates, n)
  })
}
