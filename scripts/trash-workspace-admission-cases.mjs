import assert from 'node:assert/strict'
import { createTrashWorkspace, summarizeTrashReport } from '../src/services/trashWorkspace.mjs'
const entries = () => ['a', 'b'].map(id => ({ id, title: id + '.md', is_folder: false, is_deleted: true, deleted_at: 100, updated_at: 100 }))
export function registerTrashAdmissionTests(test, factory = createTrashWorkspace) {
  for (const action of ['restore', 'delete']) {
    test(`stop before ${action} dispatch does not send the displayed sending row`, async () => {
      const writes = [], store = factory(async (route, init) => {
        if (!init.method) return entries()
        writes.push(route); return null
      })
      await store.refresh()
      const close = store.connect(() => {
        if (store.snapshot().report?.rows.some(row => row.status === 'sending')) store.stop()
      })
      try {
        const plan = store.plan(action, ['a', 'b'])
        assert.equal(await store.confirm(plan.key), false)
        assert.deepEqual(writes, [])
        assert.deepEqual(summarizeTrashReport(store.snapshot().report), { succeeded: 0, unconfirmed: 0, notStarted: 2, sending: 0 })
        assert.equal(store.snapshot().pending, 0)
        assert.equal(store.snapshot().phase, 'idle')
      } finally { close() }
    })
  }
  test('last view disconnect before dispatch stops writes and retains a reopenable report', async () => {
    let writes = 0, disconnect = () => {}
    const store = factory(async (route, init) => { if (!init.method) return entries(); writes++; return null })
    await store.refresh()
    disconnect = store.connect(() => {
      if (store.snapshot().report?.rows.some(row => row.status === 'sending')) disconnect()
    })
    const plan = store.plan('delete', ['a', 'b']); await store.confirm(plan.key)
    assert.equal(writes, 0)
    assert.equal(store.snapshot().report.rows[0].status, 'not-started')
    const close = store.connect(() => {})
    try { assert.equal(await store.refresh(), true); assert.equal(store.snapshot().report.rows.length, 2) } finally { close() }
  })
  test('a dispatched write keeps its real receipt after stop while the remaining target is not sent', async () => {
    let resolve, sent = 0
    const waiting = new Promise(r => { resolve = r })
    const store = factory(async (route, init) => { if (!init.method) return entries(); sent++; return waiting })
    await store.refresh(); const close = store.connect(() => {})
    try {
      const plan = store.plan('restore', ['a', 'b']), task = store.confirm(plan.key)
      for (let n = 0; n < 20 && sent === 0; n++) await Promise.resolve()
      assert.equal(sent, 1); store.stop(); resolve(null); await task
      assert.equal(sent, 1)
      assert.deepEqual(summarizeTrashReport(store.snapshot().report), { succeeded: 1, unconfirmed: 0, notStarted: 1, sending: 0 })
      assert.deepEqual(store.takeRestored(), ['a'])
    } finally { close() }
  })
  for (const action of ['restore', 'delete']) {
    test(`expired ${action} dispatch budget cannot send a late mutation`, async () => {
      let time = 0, writes = 0
      const store = factory(async (route, init) => { if (!init.method) return entries(); writes++; return null }, { timeoutMs: 50, now: () => time })
      await store.refresh()
      const close = store.connect(() => {
        if (store.snapshot().phase === 'writing' && store.snapshot().pending === 1) time = 51
      })
      try {
        const plan = store.plan(action, ['a', 'b'])
        assert.equal(await store.confirm(plan.key), false)
        assert.equal(writes, 0)
        assert.equal(summarizeTrashReport(store.snapshot().report).notStarted, 2)
        assert.equal(summarizeTrashReport(store.snapshot().report).unconfirmed, 0)
      } finally { close() }
    })
  }

}
