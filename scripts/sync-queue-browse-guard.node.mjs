import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Execute the actual callbacks with a deliberately deferred setBrowse. This is
// a handler-level ordering test, not a replacement for the real React suite.
const source = fs.readFileSync(process.env.NOTEPAD_QUEUE_GUARD_SOURCE || new URL('../src/components/SyncConflictQueue.jsx', import.meta.url), 'utf8')
const start = source.indexOf('  const change = '), end = source.indexOf('  return <section', start)
assert.ok(start >= 0 && end > start, 'Actual queue callbacks must be present')
const factory = vm.runInNewContext(`(state) => { const { browse, busy, disabled, model, onResolve, alive, pending, browseEpoch, focusRequested, setBrowse, setSubmitting } = state; ${source.slice(start, end)}; return { change, resolve } }`)
function harness(options = {}) {
  const calls = [], updates = [], submitting = []
  const state = { browse: { epoch: 0, page: 1, order: 'server' }, busy: false, disabled: false, model: { valid: true },
    alive: { current: true }, pending: { current: false }, browseEpoch: { current: 0 }, focusRequested: { current: false },
    onResolve: (...args) => { calls.push(args); return options.reply ? options.reply(...args) : true },
    setBrowse: next => updates.push(next), setSubmitting: value => submitting.push(value) }
  const render = () => factory(state)
  const flush = () => { for (const update of updates.splice(0)) state.browse = update(state.browse); return render() }
  return { state, calls, updates, submitting, render, flush }
}
for (const [name, patch] of [
  ['order', { order: 'oldest', page: 1 }], ['query', { query: '001', page: 1 }],
  ['kind', { kind: 'file', page: 1 }], ['risk', { risk: 'attention', page: 1 }],
  ['clear', { query: '', kind: 'all', risk: 'all', page: 1 }], ['page', { page: 2 }],
]) test(`REGRESSION_BROWSE: ${name} revokes the old resolver before a deferred render`, async () => {
  const h = harness(), old = h.render()
  old.change(patch)
  assert.equal(h.updates.length, 1)
  assert.equal(await old.resolve({ id: 'old-review' }, 'local', () => true), false, 'REGRESSION_BROWSE: old resolver accepted revoked browsing consent')
  assert.equal(h.calls.length, 0)
  assert.deepEqual(h.submitting, [])
})
test('an unchanged view forwards the exact review side and live guard once', async () => {
  const h = harness(), review = { id: 'review' }, guard = () => true
  assert.equal(await h.render().resolve(review, 'remote', guard), true)
  assert.deepEqual(h.calls, [[review, 'remote', guard]])
  assert.deepEqual(h.submitting, [true, false])
})
test('new render can resolve a new review but cannot revive an older callback', async () => {
  const h = harness(), old = h.render(); old.change({ order: 'oldest' })
  const current = h.flush()
  assert.equal(await old.resolve('old', 'local'), false)
  assert.equal(await current.resolve('new', 'remote'), true)
  assert.deepEqual(h.calls, [['new', 'remote']])
})
test('A-B-A browsing invalidation is monotonic before and after rendering', async () => {
  const h = harness(), old = h.render()
  old.change({ order: 'oldest' }); old.change({ order: 'server' })
  assert.equal(await old.resolve('old', 'local'), false)
  const current = h.flush()
  assert.equal(h.state.browse.order, 'server'); assert.equal(h.state.browse.epoch, 2)
  assert.equal(await old.resolve('old', 'local'), false)
  assert.equal(await current.resolve('new', 'local'), true)
})
test('React replaying a state updater cannot increment or roll back the synchronous epoch', () => {
  const h = harness(), old = h.render(); old.change({ order: 'oldest' })
  const updater = h.updates[0]
  assert.equal(updater(h.state.browse).epoch, 1); assert.equal(updater(h.state.browse).epoch, 1)
  assert.equal(h.state.browseEpoch.current, 1)
})
test('submission first prevents later browsing and duplicate submission in the same turn', async () => {
  let finish; const h = harness({ reply: () => new Promise(r => { finish = r }) }), old = h.render()
  const pending = old.resolve('review', 'local')
  old.change({ order: 'oldest' }); assert.equal(h.updates.length, 0)
  assert.equal(h.state.browseEpoch.current, 0); assert.equal(await old.resolve('review', 'remote'), false)
  finish(true); assert.equal(await pending, true); assert.equal(h.calls.length, 1)
})
test('busy, disabled, invalid models and missing resolvers cannot authorize a call', async () => {
  for (const patch of [{ busy: true }, { disabled: true }, { model: { valid: false } }, { onResolve: null }]) {
    const h = harness(); Object.assign(h.state, patch)
    assert.equal(await h.render().resolve('review', 'local'), false); assert.equal(h.calls.length, 0)
  }
})
test('unmount invalidates retained callbacks and prevents queued browsing', async () => {
  const h = harness(), old = h.render(); h.state.alive.current = false
  assert.equal(await old.resolve('review', 'local'), false); old.change({ page: 2 })
  assert.equal(h.calls.length, 0); assert.equal(h.updates.length, 0)
})
test('failed submission releases the lock without silently replaying a request', async () => {
  const h = harness({ reply: () => { throw new Error('failed') } })
  await assert.rejects(h.render().resolve('review', 'local'), /failed/)
  assert.equal(h.calls.length, 1); assert.equal(h.state.pending.current, false)
  assert.deepEqual(h.submitting, [true, false])
})
