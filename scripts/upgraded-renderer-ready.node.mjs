import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { isUpgradedRendererReady, observeUpgradedQuit, upgradedRendererSnapshot, waitForUpgradedRenderer } from './upgraded-renderer-ready.mjs'

const expected = { url: 'file:///D:/owned/resources/app.asar/dist/index.html', noteId: 'retained-note', marker: 'UPGRADE-PRESERVE-real-marker-SAVED-BY-4.249.0' }
const ready = () => ({ url: expected.url, readyState: 'complete', timeOrigin: 1, rootMounted: true,
  rootInert: false, appVisible: true, editorVisible: true, retainedMarkerVisible: true,
  editorText: expected.marker, retainedNotePresent: true, preload: true, pending: [], quitVeil: false })

test('the actual retained body and completed renderer permit the original close check', () => {
  assert.equal(isUpgradedRendererReady(ready(), expected), true)
})

for (const [name, patch] of [
  ['the DevTools URL exists before React mounts', { rootMounted: false, appVisible: false, editorVisible: false }],
  ['the renderer document is still loading', { readyState: 'loading' }],
  ['the editor is reading the selected body', { editorVisible: false, pending: [{ text: '加载中…' }] }],
  ['the HTTP note is current but the visible editor body is old', { retainedMarkerVisible: false, editorText: 'old note' }],
  ['a forged boolean cannot replace the actual retained marker text', { editorText: 'different note' }],
  ['the retained note is absent from the real library', { retainedNotePresent: false }],
  ['the production preload quit bridge is missing', { preload: false }],
  ['a current save is still pending', { pending: [{ text: '保存中…' }] }],
  ['a current save failed', { pending: [{ text: '保存未确认' }] }],
  ['a quit challenge already froze the root', { rootInert: true }],
  ['a quit veil is already present', { quitVeil: true }],
  ['the renderer navigated to another target', { url: 'file:///D:/different/index.html' }],
]) test('readiness refuses ' + name, () => {
  const observed = { ...ready(), ...patch }
  assert.equal(isUpgradedRendererReady(observed, expected), false)
})

test('the previous health plus target-URL predicate admits the concrete startup race', () => {
  const early = { ...ready(), rootMounted: false, appVisible: false, editorVisible: false, editorText: '', retainedMarkerVisible: false }
  const oldPage = { type: 'page', url: early.url }, health = { code: 0 }
  assert.equal(health.code === 0 && oldPage.type === 'page' && /dist\/index\.html/.test(oldPage.url), true)
  assert.equal(isUpgradedRendererReady(early, expected), false)
})

test('waiting preserves the first raw unready observation and uses the original deadline', async () => {
  let clock = 100, reads = 0
  const saved = [], pauses = []
  const first = { ...ready(), editorVisible: false, editorText: '', retainedMarkerVisible: false }
  const result = await waitForUpgradedRenderer({ expected, deadline: 350,
    now: () => clock, read: async budget => { assert.ok(budget <= 250); return ++reads === 1 ? first : ready() },
    pause: async ms => { pauses.push(ms); clock += ms }, save: value => saved.push(value) })
  assert.equal(result.first, first); assert.equal(result.observations, 2); assert.equal(result.ready, true)
  assert.deepEqual(pauses, [100]); assert.equal(saved.length, 2)
})

test('an unready renderer cannot gain more startup time or silently pass', async () => {
  let clock = 0, reads = 0
  await assert.rejects(waitForUpgradedRenderer({ expected, deadline: 150, now: () => clock,
    read: async () => { reads += 1; return { ...ready(), rootMounted: false } },
    pause: async ms => { assert.ok(ms <= 100); clock += ms } }), /original desktop startup deadline/)
  assert.equal(clock, 150); assert.equal(reads, 2)
})

test('a ready sample that completes after the original deadline is refused', async () => {
  let clock = 0
  await assert.rejects(waitForUpgradedRenderer({ expected, deadline: 10, now: () => clock,
    read: async () => { clock = 11; return ready() }, pause: async () => assert.fail('No late retry') }), /original desktop startup deadline/)
})

test('a transient pre-renderer CDP error is recorded and uses only the remaining startup budget', async () => {
  let clock = 0, reads = 0
  const result = await waitForUpgradedRenderer({ expected, deadline: 250, now: () => clock,
    read: async () => { if (++reads === 1) throw new Error('Execution context was destroyed'); return ready() },
    pause: async ms => { clock += ms } })
  assert.deepEqual(result.first, { readError: 'Execution context was destroyed' })
  assert.equal(result.ready, true); assert.equal(result.observations, 2); assert.equal(clock, 100)
})

test('the DOM snapshot reads the actual editor, exact note id and pending state', () => {
  const node = (text, extra = {}) => ({ innerText: text, className: '', getBoundingClientRect: () => ({ width: 20, height: 20 }), ...extra })
  const root = node('', { childElementCount: 1, inert: false }), app = node(''), editor = node(expected.marker)
  const pending = node('保存中…', { className: 'save-state' })
  const row = node('', { getAttribute: name => name === 'data-file-id' ? expected.noteId : null })
  const context = { expected, location: { href: expected.url }, performance: { timeOrigin: 5 },
    window: { electronAPI: { onQuitPrepare() {}, onQuitRelease() {}, reportQuitResult() {} } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: { readyState: 'complete', body: { innerText: expected.marker }, getElementById: () => root,
      querySelector: selector => ({ '.app-shell': app, '.editor-input': editor }[selector] || null),
      querySelectorAll: selector => selector === '[data-file-id]' ? [row] : [pending] } }
  const observed = vm.runInNewContext('(' + upgradedRendererSnapshot.toString() + ')(expected)', context)
  assert.equal(observed.retainedMarkerVisible, true); assert.equal(observed.retainedNotePresent, true)
  assert.equal(observed.pending[0].text, '保存中…'); assert.equal(isUpgradedRendererReady(observed, expected), false)
})

test('quit observation never reports a result, freezes the UI or changes the real callbacks', () => {
  const handlers = {}, replies = [], original = { onQuitPrepare(fn) { handlers.prepare = fn; return () => {} },
    onQuitRelease(fn) { handlers.release = fn; return () => {} }, reportQuitResult(value) { replies.push(value) } }
  const context = { window: { electronAPI: original }, performance: { timeOrigin: 9, now: () => 15 } }
  const result = vm.runInNewContext('(' + observeUpgradedQuit.toString() + ')()', context)
  assert.equal(result.attached, true); assert.equal(result.timeOrigin, 9)
  handlers.prepare({ id: 'real-challenge' }); handlers.release({ id: 'real-challenge' })
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.__upgradedRendererQuitObservation.events)), [
    { event: 'prepare', id: 'real-challenge', at: 15 }, { event: 'release', id: 'real-challenge', at: 15 } ])
  assert.equal(context.window.electronAPI, original); assert.deepEqual(replies, [])
  assert.throws(() => vm.runInNewContext('(' + observeUpgradedQuit.toString() + ')()', context), /already attached/)
})

test('the concurrent transport repair and the original 20-second process gates remain intact', () => {
  const source = readFileSync(new URL('../.github/scripts/windows-in-place-upgrade.ps1', import.meta.url), 'utf8')
  const historical = source.slice(source.indexOf(' }else{\n $ws=[System.Net.WebSockets.ClientWebSocket]::new()'))
  assert.ok(historical.includes('$ws.SendAsync($segment,[System.Net.WebSockets.WebSocketMessageType]::Text,$true,[Threading.CancellationToken]::None).GetAwaiter().GetResult()'))
  assert.ok(historical.indexOf('$gui.WaitForExit(20000)') < historical.indexOf('}finally{$ws.Dispose()}'))
  assert.equal((source.match(/\$r\.quitDiagnostics=\[ordered\]/g) || []).length, 2)
  assert.equal((source.match(/\$gui\.WaitForExit\(20000\)/g) || []).length, 3)
  assert.ok(source.includes('$deadline=[DateTime]::UtcNow.AddSeconds(30)'))
  assert.ok(source.includes('$stopDeadline=[DateTime]::UtcNow.AddSeconds(10)'))
  assert.ok(source.includes('if(-not $stopped){throw'))
  const candidate = source.slice(source.indexOf(' $r.desktopClose='), source.indexOf(' }else{\n $ws='))
  assert.ok(candidate.indexOf('$receive=$ws.ReceiveAsync') < candidate.indexOf('$ws.SendAsync'))
  assert.ok(candidate.indexOf('$receive=$ws.ReceiveAsync') < candidate.indexOf('$gui.WaitForExit(20000)'))
  assert.ok(candidate.indexOf('$gui.WaitForExit(20000)') < candidate.lastIndexOf('$ws.Dispose()'))
  assert.equal(/Stop-Process|\.Kill\(|reportQuitResult\(/.test(candidate), false)
  assert.ok(candidate.includes('if($gui.ExitCode -ne 0){throw'))
})
