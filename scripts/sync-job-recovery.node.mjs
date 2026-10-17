import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

// Exercise the actual event handler without claiming a React/render test.
const source = readFileSync(new URL('../src/components/SyncCenterPanel.jsx', import.meta.url), 'utf8')
const start = source.indexOf('  const synchronize = ')
const end = source.indexOf('  const resolve = ', start)
assert.ok(start >= 0 && end > start)
const handler = source.slice(start, end).replace('  const synchronize = ', '').trim()
function fixture(mode, answer = true, fail = false) {
  const calls = []; let prompts = 0; let refreshes = 0
  const context = {
    status: { recovery: { mode } },
    window: { confirm: () => { prompts++; return answer } },
    exclusive: async (_key, fn) => fn(),
    api: async (path, init) => { calls.push([path, init]); if (fail) throw new Error('server blocked'); return {} },
    alive: { current: true }, setPlan: () => {},
    refresh: async () => { refreshes++; return true },
    refreshAfterChange: async () => { refreshes++ },
  }
  return { run: vm.runInNewContext('(' + handler + ')', context), calls, counts: () => ({ prompts, refreshes }) }
}
test('ordinary run retains the empty request body', async () => {
  const f = fixture('idle'); await f.run()
  assert.equal(f.calls[0][1].body, '{}'); assert.equal(f.counts().prompts, 0)
})
test('declining uncertain write recovery makes no request', async () => {
  const f = fixture('review_required', false); await f.run()
  assert.equal(f.calls.length, 0); assert.equal(f.counts().prompts, 1)
})
test('confirmed recovery explicitly acknowledges the uncertain outcome', async () => {
  const f = fixture('review_required'); await f.run()
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { acknowledge_uncertain: true })
})
test('an interrupted applying checkpoint also requires confirmation', async () => {
  const f = fixture('applying', false); await f.run(); assert.equal(f.calls.length, 0)
})
test('a rejected run refreshes status instead of silently retaining stale state', async () => {
  const f = fixture('idle', true, true); await assert.rejects(f.run(), /server blocked/)
  assert.equal(f.counts().refreshes, 1)
})
