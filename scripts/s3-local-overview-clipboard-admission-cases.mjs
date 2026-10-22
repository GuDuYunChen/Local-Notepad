import assert from 'node:assert/strict'
import { createLocalOverviewClipboard, LOCAL_REPORT_COPY_WAIT_MS } from '../src/services/s3LocalOverviewReport.mjs'

const summary = () => ({
  format: 'local-notepad-s3-local-candidate-overview', version: 1,
  read_only: true, observed_stable: true, complete_for_preview: false,
  records: 0, record_bytes: 0, attachment_bytes: 0, base_items: 0,
  kinds: ['file', 'tag', 'file-tag', 'attachment'].map(kind => ({ kind, records: 0, record_bytes: 0 })),
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

// Inject a scheduling pause without sleeping, changing global timers, touching
// a system clipboard or relying on CPU speed. The real service is under test.
function fixture(afterSchedule = 100) {
  const state = { at: 100, afterSchedule, writes: [], cleared: [], timers: [], clockThrows: false }
  const service = createLocalOverviewClipboard({
    clock() { if (state.clockThrows) throw new Error('PRIVATE_CLOCK'); return state.at },
    reportTime: () => 0,
    schedule(fn, ms) {
      assert.equal(ms, LOCAL_REPORT_COPY_WAIT_MS)
      const id = state.timers.length
      state.timers.push(fn); state.at = state.afterSchedule
      if (state.throwAfterSchedule) state.clockThrows = true
      if (state.fireSynchronously) fn()
      return id
    },
    cancel(id) { state.cleared.push(id) },
    write(text) { state.writes.push(text); return state.pending ? state.pending.promise : Promise.resolve() },
  })
  return { state, service }
}

export function registerClipboardAdmissionTests(test) {
  for (const [label, at, code] of [
    ['exact deadline', 5100, 'copy-timeout'],
    ['past deadline', 5101, 'copy-timeout'],
    ['NaN clock', NaN, 'copy-unconfirmed'],
    ['infinite clock', Infinity, 'copy-unconfirmed'],
    ['backwards clock', 99, 'copy-unconfirmed'],
  ]) test(`clipboard admission refuses ${label} before the OS write`, async () => {
    const { state, service } = fixture(at)
    const out = await service.copy(summary())
    assert.equal(out.code, code)
    assert.equal(state.writes.length, 0, 'a refused operation must not touch the clipboard')
    assert.deepEqual(state.cleared, [0])
    assert.ok(Object.isFrozen(out))
  })

  test('clipboard admission refuses a failed pre-write clock without exposing the exception', async () => {
    const { state, service } = fixture(); state.throwAfterSchedule = true
    const out = await service.copy(summary())
    assert.deepEqual(out, { code: 'copy-unconfirmed' })
    assert.equal(state.writes.length, 0)
    assert.ok(!JSON.stringify(out).includes('PRIVATE'))
    assert.deepEqual(state.cleared, [0])
  })

  test('clipboard admission refusal frees only the unused slot for a new explicit attempt', async () => {
    const { state, service } = fixture(5100)
    assert.equal((await service.copy(summary())).code, 'copy-timeout')
    assert.equal(state.writes.length, 0)
    state.at = state.afterSchedule = 6000
    assert.equal((await service.copy(summary())).code, 'copied')
    assert.equal(state.writes.length, 1)
    assert.deepEqual(state.cleared, [0, 1])
  })

  test('clipboard admission one millisecond before deadline still waits for a real receipt', async () => {
    const { state, service } = fixture(5099); state.pending = deferred()
    let delivered = false
    const p = service.copy(summary()); p.then(() => { delivered = true })
    await flush()
    assert.equal(state.writes.length, 1); assert.equal(delivered, false)
    assert.equal((await service.copy(summary())).code, 'copy-busy')
    state.pending.resolve()
    assert.equal((await p).code, 'copied')
    assert.deepEqual(state.cleared, [0])
  })

  for (const result of ['resolve', 'reject']) test(`clipboard admission retains an already-issued write through timeout and late ${result}`, async () => {
    const { state, service } = fixture(); state.pending = deferred()
    const p = service.copy(summary())
    state.at = 5100; state.timers[0]()
    assert.equal((await p).code, 'copy-timeout')
    assert.equal((await service.copy(summary())).code, 'copy-busy')
    assert.equal(state.writes.length, 1)
    state.pending[result](new Error('PRIVATE_LATE')); await flush()
    assert.equal((await p).code, 'copy-timeout')
    state.pending = null; state.at = state.afterSchedule = 6000
    assert.equal((await service.copy(summary())).code, 'copied')
    assert.equal(state.writes.length, 2)
  })

  test('clipboard admission preserves synchronous timer refusal without double cleanup or write', async () => {
    const { state, service } = fixture(); state.fireSynchronously = true
    assert.equal((await service.copy(summary())).code, 'copy-timeout')
    assert.equal(state.writes.length, 0); assert.deepEqual(state.cleared, [0])
  })

  test('clipboard admission invalid report never starts timers or writes', async () => {
    const { state, service } = fixture()
    assert.equal((await service.copy({ ...summary(), records: 1 })).code, 'invalid-report')
    assert.equal(state.writes.length, 0); assert.equal(state.timers.length, 0)
    assert.equal((await service.copy(summary())).code, 'copied')
    assert.equal(state.writes.length, 1)
  })
}
