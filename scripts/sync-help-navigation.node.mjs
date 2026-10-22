import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { syncHelpRecommendation, focusSyncHelpTopic } from '../src/services/syncHelpNavigation.mjs'

for (const [state, topic] of Object.entries({
  disabled: 'first-use', draft: 'first-use', preview: 'operations', conflicts: 'conflicts', mismatch: 'conflicts',
  uncertain: 'recovery', unavailable: 'recovery', waiting: 'recovery', stale: 'recovery',
  blocked: 'recovery', backoff: 'recovery', unknown: 'recovery', error: 'recovery',
})) test(`${state} selects fixed documentation, not an executable action`, () => {
  const result = syncHelpRecommendation(state)
  assert.equal(result.key, topic); assert.ok(Object.isFrozen(result))
  assert.deepEqual(Object.keys(result), ['key', 'label'])
})
test('untrusted state values never enter a selector or output text', () => {
  for (const state of [null, undefined, {}, [], false, 1, 'constructor', '__proto__', 'PRIVATE_<script>']) {
    assert.deepEqual(syncHelpRecommendation(state), { key: 'recovery', label: '状态与恢复' })
  }
})
function fixture() {
  const calls = [], doc = { activeElement: {} }
  const root = { isConnected: true, matches: s => s === '[data-sync-section="overview"]', closest: () => null,
    querySelector: () => help }
  const help = { isConnected: true, tagName: 'DETAILS', parentElement: root, open: false, closest: () => null,
    querySelector: () => topic }
  const summary = { isConnected: true, tagName: 'SUMMARY', ownerDocument: doc, closest: () => null,
    focus: options => { calls.push(['focus', options]); doc.activeElement = summary },
    scrollIntoView: options => { calls.push(['scroll', options]) } }
  const topic = { isConnected: true, tagName: 'DETAILS', open: false, firstElementChild: summary,
    closest: s => s === '[data-sync-help]' ? help : s === '[data-sync-section="overview"]' ? root : null }
  return { root, help, topic, summary, doc, calls }
}
test('explicit request opens existing disclosures and focuses only the topic summary', () => {
  const f = fixture(); assert.equal(focusSyncHelpTopic(f.root, 'recovery'), true)
  assert.equal(f.help.open, true); assert.equal(f.topic.open, true)
  assert.equal(f.doc.activeElement, f.summary)
  assert.deepEqual(f.calls, [['focus', { preventScroll: true }], ['scroll', { block: 'start', behavior: 'instant' }]])
})
test('repeated navigation does not toggle closed or recreate an existing topic', () => {
  const f = fixture(); f.help.open = f.topic.open = true
  assert.equal(focusSyncHelpTopic(f.root, 'operations'), true)
  assert.equal(focusSyncHelpTopic(f.root, 'operations'), true)
  assert.equal(f.help.open, true); assert.equal(f.topic.open, true); assert.equal(f.topic.firstElementChild, f.summary)
})
test('invalid keys are refused before even reading the root', () => {
  const root = new Proxy({}, { get() { throw new Error('root must not be read') } })
  for (const key of [undefined, null, 'constructor', '__proto__', {}, [], 3, 'recovery"] button', 'https://private.test']) {
    assert.equal(focusSyncHelpTopic(root, key), false)
  }
})
test('missing, foreign, nested, hidden or executable targets fail without DOM changes', () => {
  for (const change of [
    f => { f.root.isConnected = false }, f => { f.root.matches = () => false },
    f => { f.root.closest = () => ({}) }, f => { f.root.querySelector = () => null },
    f => { f.help.parentElement = {} }, f => { f.help.isConnected = false },
    f => { f.help.tagName = 'BUTTON' }, f => { f.help.closest = () => ({}) },
    f => { f.help.querySelector = () => null }, f => { f.topic.isConnected = false },
    f => { f.topic.closest = () => ({}) }, f => { f.topic.tagName = 'INPUT' },
    f => { f.topic.firstElementChild = null }, f => { f.summary.tagName = 'BUTTON' },
    f => { f.summary.isConnected = false }, f => { f.summary.closest = () => ({}) },
  ]) {
    const f = fixture(); change(f)
    assert.equal(focusSyncHelpTopic(f.root, 'recovery'), false)
    assert.equal(f.help.open, false); assert.equal(f.topic.open, false); assert.deepEqual(f.calls, [])
  }
})
test('failed focus restores only previous disclosure states and never falls back to an action', () => {
  for (const wasHelpOpen of [false, true]) for (const wasTopicOpen of [false, true]) {
    const f = fixture(); f.help.open = wasHelpOpen; f.topic.open = wasTopicOpen
    f.summary.focus = () => {}
    assert.equal(focusSyncHelpTopic(f.root, 'conflicts'), false)
    assert.equal(f.help.open, wasHelpOpen); assert.equal(f.topic.open, wasTopicOpen)
    assert.deepEqual(f.calls, [])
  }
})
test('detachment or exceptions during focus are contained and do not trigger another lookup', () => {
  for (const fail of [f => { f.summary.isConnected = false }, () => { throw new Error('lost DOM') }]) {
    const f = fixture(); f.summary.focus = () => fail(f)
    assert.equal(focusSyncHelpTopic(f.root, 'recovery'), false)
    assert.equal(f.help.open, false); assert.equal(f.topic.open, false)
  }
  assert.equal(focusSyncHelpTopic({}, 'recovery'), false)
})
test('unknown presentation state still points to real static help', async () => {
  const { SYNC_HELP_TOPICS } = await import('../src/services/syncHelp.mjs')
  for (const state of ['preview', 'conflicts', 'disabled', 'unavailable']) {
    assert.ok(SYNC_HELP_TOPICS.some(t => t.key === syncHelpRecommendation(state).key))
  }
})
test('navigation module has no IO or operation capabilities', () => {
  const source = readFileSync(new URL('../src/services/syncHelpNavigation.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bfetch\s*\(|\bapi\s*\(|\.click\s*\(|localStorage|sessionStorage|electronAPI|clipboard|setTimeout|setInterval|location\s*=|innerHTML|onResolve/)
})
