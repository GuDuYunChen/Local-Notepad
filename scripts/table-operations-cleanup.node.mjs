import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { closeTableOperationsApp } from './run-table-operations-desktop.mjs'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function app({ failed = false } = {}) {
  const child = new EventEmitter(), calls = [], waits = []
  Object.assign(child, { pid: 412, exitCode: null, signalCode: null })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  let exitCount = 0
  const emitExit = (code = 0, signal = null) => {
    assert.equal(exitCount++, 0, 'The owned process exits only once')
    child.exitCode = code; child.signalCode = signal
    calls.push({ type: 'exit', code, signal })
    child.emit('exit', code, signal)
  }
  const executable = 'C:\\owned-table-cleanup\\Local-Notepad.exe'
  const report = { pid: child.pid, executable, complete: !failed, cleanupComplete: false,
    forceTerminated: false, realBackend: true, nativeInputs: [] }
  if (failed) report.error = 'Original Table business assertion failed'
  const boundWindow = { pid: child.pid, handle: 900, title: 'Local Notepad', cls: 'Chrome_WidgetWin_1',
    visible: true, childText: ['Chrome Legacy Window'], image: executable }
  const context = {
    report, child, exited, boundWindow, failed,
    cdp: { async send(method, params, budget) { calls.push({ type: 'input', method, params, budget }); return {} } },
    windowSession: { async close(window) {
      assert.equal(window, boundWindow, 'Close uses the already verified native window')
      calls.push({ type: 'close' }); queueMicrotask(() => emitExit()); return true
    } },
  }
  const dependencies = {
    async wait(promise, label, budget) { waits.push({ label, budget }); return promise },
    async backendStopped() {
      assert.equal(exitCount, 1, 'Backend cleanup cannot be asserted before the process exit event')
      calls.push({ type: 'backend' }); return true
    },
    forceKill(pid) {
      assert.equal(pid, child.pid, 'Only the owned child may be terminated')
      calls.push({ type: 'force', pid }); emitExit(null, 'SIGKILL'); return { status: 0, signal: null }
    },
  }
  return { context, dependencies, report, child, calls, waits, emitExit, get exitCount() { return exitCount } }
}

test('confirmed WM_CLOSE waits for an actual child exit and backend stop before reporting graceful cleanup', async () => {
  const f = app(), close = deferred(), backend = deferred()
  f.context.windowSession.close = async window => {
    assert.equal(window, f.context.boundWindow); f.calls.push({ type: 'close' }); return close.promise
  }
  f.dependencies.backendStopped = async () => {
    assert.equal(f.exitCount, 1); f.calls.push({ type: 'backend' }); return backend.promise
  }
  let finished = false
  const result = closeTableOperationsApp(f.context, f.dependencies).then(value => { finished = true; return value })
  await nextTurn()
  assert.equal(f.report.cleanup.closeRequested, true)
  close.resolve(true)
  await nextTurn()
  assert.equal(f.report.cleanup.closeConfirmed, true)
  assert.equal(f.exitCount, 0)
  assert.equal(f.report.exit, undefined, 'A fulfilled close request is not an observed process exit')
  assert.equal(f.report.backendStopped, undefined)
  assert.equal(finished, false)
  f.emitExit(0, null)
  await nextTurn()
  assert.equal(finished, false, 'A successful process exit still requires the backend check')
  assert.equal(f.report.backendStopped, undefined)
  backend.resolve(true)
  assert.equal(await result, true)
  assert.deepEqual(f.report.exit, { pid: 412, code: 0, signal: null, normalClose: true })
  assert.equal(f.report.backendStopped, true)
  assert.equal(f.report.forceTerminated, false)
  assert.equal(f.report.complete, true)
  assert.equal(f.report.cleanupComplete, false, 'The runner still owns helper disposal and file cleanup')
  assert.deepEqual(f.calls.map(call => call.type), ['close', 'exit', 'backend'])
  assert.deepEqual(f.waits.map(wait => wait.budget), [15000, 5000])
})

test('failed business work releases held native input before close without changing its error or acceptance result', async () => {
  const f = app({ failed: true })
  f.report.nativeInputs = [
    { sequence: 1, method: 'Input.dispatchKeyEvent', type: 'rawKeyDown', key: 'Control', windowsVirtualKeyCode: 17, modifiers: 2 },
    { sequence: 2, method: 'Input.dispatchMouseEvent', type: 'mousePressed', x: 47, y: 53, button: 'left', buttons: 1, clickCount: 1 },
  ]
  const inputs = structuredClone(f.report.nativeInputs), originalError = f.report.error
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), true)
  assert.equal(f.exitCount, 1)
  assert.equal(f.report.complete, false)
  assert.equal(f.report.error, originalError)
  assert.equal(f.report.cleanupComplete, false)
  assert.deepEqual(f.report.nativeInputs, inputs, 'Cleanup receipts do not rewrite business input evidence')
  const released = f.calls.filter(call => call.type === 'input')
  assert.deepEqual(released.slice(0, 2).map(call => [call.method, call.params.type, call.params.key]), [
    ['Input.dispatchKeyEvent', 'rawKeyDown', 'Escape'], ['Input.dispatchKeyEvent', 'keyUp', 'Escape'],
  ])
  assert.ok(released.some(call => call.method === 'Input.dispatchKeyEvent' && call.params.type === 'keyUp' && call.params.key === 'Control'))
  assert.ok(released.some(call => call.method === 'Input.dispatchMouseEvent' && call.params.type === 'mouseReleased' &&
    call.params.button === 'left' && call.params.buttons === 0 && call.params.x === 47 && call.params.y === 53))
  assert.deepEqual(released.slice(-2).map(call => [call.method, call.params]), [
    ['Input.setInterceptDrags', { enabled: false }], ['Network.setBlockedURLs', { urls: [] }],
  ])
  assert.ok(released.every(call => call.budget > 0 && call.budget <= 500))
  assert.ok(f.report.cleanup.inputRelease.every(item => item.confirmed === true))
  assert.equal(f.calls.findIndex(call => call.type === 'close'), released.length)
  assert.deepEqual(f.waits.map(wait => wait.budget), [15000, 5000])
  assert.equal(f.report.forceTerminated, false)
})

test('no child process cannot produce a fabricated normal-close or backend receipt', async () => {
  const f = app({ failed: true })
  Object.assign(f.context, { child: undefined, exited: undefined, boundWindow: undefined })
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
  assert.equal(f.report.cleanup.started, false)
  assert.equal(f.report.exit, undefined)
  assert.equal(f.report.backendStopped, undefined)
  assert.equal(f.report.forceTerminated, false)
  assert.equal(f.report.complete, false)
  assert.equal(f.exitCount, 0)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.waits, [])
})

test('no verified native binding never posts close and forced exit cannot become normal close', async () => {
  const f = app({ failed: true })
  f.context.boundWindow = undefined
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
  assert.equal(f.report.cleanup.closeRequested, false)
  assert.equal(f.report.cleanup.closeConfirmed, false)
  assert.equal(f.report.cleanup.exitObserved, true)
  assert.equal(f.exitCount, 1)
  assert.equal(f.report.forceTerminated, true)
  assert.deepEqual(f.report.exit, { pid: 412, code: null, signal: 'SIGKILL', normalClose: false })
  assert.equal(f.calls.some(call => call.type === 'close'), false)
  assert.deepEqual(f.calls.filter(call => call.type === 'force'), [{ type: 'force', pid: 412 }])
  assert.equal(f.report.error, 'Original Table business assertion failed')
})

test('the unchanged 15-second native-close deadline forces only the owned process and records its actual forced exit', async () => {
  const f = app({ failed: true }), close = deferred()
  f.context.cdp = undefined
  f.context.windowSession.close = async () => { f.calls.push({ type: 'close' }); return close.promise }
  f.dependencies.wait = async (promise, label, budget) => {
    f.waits.push({ label, budget })
    if (budget === 15000) { void promise.catch(() => {}); throw new Error('Synthetic native close deadline') }
    return promise
  }
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
  assert.equal(f.report.cleanup.closeRequested, true)
  assert.equal(f.report.cleanup.closeConfirmed, false)
  assert.equal(f.report.cleanup.exitObserved, true)
  assert.equal(f.exitCount, 1)
  assert.equal(f.report.forceTerminated, true)
  assert.equal(f.report.exit.normalClose, false)
  assert.equal(f.report.complete, false)
  assert.match(f.report.cleanupError, /Synthetic native close deadline/)
  assert.deepEqual(f.waits.map(wait => wait.budget), [15000, 3000, 5000])
  close.resolve(true)
  await nextTurn()
  assert.equal(f.report.exit.normalClose, false, 'A late close acknowledgement cannot relabel a forced exit')
  assert.equal(f.calls.filter(call => call.type === 'force').length, 1)
})

for (const [code, signal] of [[7, null], [null, 'SIGTERM']]) {
  test(`observed abnormal exit code=${code} signal=${signal} is never reported as normal close`, async () => {
    const f = app({ failed: true })
    f.context.cdp = undefined
    f.context.windowSession.close = async () => { f.calls.push({ type: 'close' }); queueMicrotask(() => f.emitExit(code, signal)); return true }
    assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
    assert.equal(f.exitCount, 1)
    assert.deepEqual(f.report.exit, { pid: 412, code, signal, normalClose: false })
    assert.equal(f.report.cleanup.exitObserved, true)
    assert.equal(f.report.backendStopped, true)
    assert.equal(f.report.forceTerminated, false, 'An already exited process must not be killed again')
    assert.equal(f.calls.some(call => call.type === 'force'), false)
    assert.match(f.report.cleanupError, /did not exit normally/)
    assert.equal(f.report.error, 'Original Table business assertion failed')
    assert.equal(f.report.complete, false)
  })
}

test('a clean application exit does not assert that an unconfirmed backend stopped', async () => {
  const f = app({ failed: true })
  f.context.cdp = undefined
  f.dependencies.backendStopped = async () => { assert.equal(f.exitCount, 1); f.calls.push({ type: 'backend' }); return false }
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
  assert.equal(f.exitCount, 1)
  assert.equal(f.report.exit.normalClose, true)
  assert.equal(f.report.cleanup.backendChecked, true)
  assert.equal(f.report.backendStopped, undefined)
  assert.equal(f.report.forceTerminated, false)
  assert.ok(f.report.cleanupError)
  assert.deepEqual(f.waits.map(wait => wait.budget), [15000, 5000])
  assert.equal(f.report.error, 'Original Table business assertion failed')
  assert.equal(f.report.complete, false)
})

import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { JSDOM } from 'jsdom'

// Execute the actual runner click closure, including its renderer expression.
// DOM selection/containment are real; rectangles and elementFromPoint below are
// an explicit geometry contract, not Chromium layout or native UI acceptance.
// A local counterexample run may supply the exact old runner from git show;
// normal CI always reads the current source beside this unchanged test file.
const nativeClickSource = readFileSync(process.env.TABLE_CLICK_SOURCE_FIXTURE ||
  new URL('./run-table-operations-desktop.mjs', import.meta.url), 'utf8')
const clickStart = nativeClickSource.indexOf('  const click = async target => {')
const clickEnd = nativeClickSource.indexOf('\n  const capture = async filename => {', clickStart)
assert.ok(clickStart >= 0 && clickEnd > clickStart, 'Exercise the actual native click closure')
const actualClickClosure = nativeClickSource.slice(clickStart, clickEnd) + '\nclick'
const plain = value => JSON.parse(JSON.stringify(value))
const within = (x, y, box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height

function nativeClickScene(options = {}) {
  const tag = options.tag || 'p'
  const dom = new JSDOM(`<div id="outer"><div id="clip"><table><tbody><tr>
    <td data-table-column="0"><p id="frozen">frozen</p></td>
    <td data-table-column="1"><${tag} class="native-target"><span>target</span></${tag}></td>
    <td><p id="neighbor">neighbor</p></td></tr></tbody></table></div></div>`, { runScripts: 'outside-only' })
  const { window } = dom, { document } = window
  const target = document.querySelector('.native-target'), descendant = target.querySelector('span')
  const table = document.querySelector('table'), outer = document.querySelector('#outer'), clip = document.querySelector('#clip')
  const frozen = document.querySelector('#frozen'), neighbor = document.querySelector('#neighbor')
  const rectangles = new Map(), hitCalls = [], scrollCalls = [], calls = []
  const report = { nativeInputs: [] }
  const scene = { dom, window, document, target, descendant, table, outer, clip, frozen, neighbor,
    rectangles, hitCalls, scrollCalls, calls, report, attempts: 0, saves: 0 }
  window.innerWidth = options.viewport?.width || 600
  window.innerHeight = options.viewport?.height || 460
  scene.box = (node, value) => {
    const box = { x: 0, y: 0, width: 600, height: 460, ...value }
    rectangles.set(node, box)
    node.getBoundingClientRect = () => ({ ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height })
    for (const [name, fallback] of Object.entries({ clientLeft: 0, clientTop: 0, clientWidth: box.width, clientHeight: box.height })) {
      Object.defineProperty(node, name, { configurable: true, value: box[name] ?? fallback })
    }
  }
  scene.box(table, {})
  scene.box(outer, {})
  scene.box(clip, {})
  scene.box(target, { x: 100, y: 80, width: 120, height: 24, ...options.targetRect })
  target.scrollIntoView = value => {
    scrollCalls.push(plain(value))
    options.onScroll?.(scene)
  }
  target.click = () => { throw new Error('DOM click cannot replace native input') }
  document.elementFromPoint = (x, y) => {
    hitCalls.push({ x, y })
    if (!within(x, y, { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })) return null
    if (!within(x, y, rectangles.get(target))) return neighbor
    if (options.hit) return options.hit(x, y, scene)
    return descendant
  }
  scene.click = new Script(actualClickClosure).runInNewContext({
    q: JSON.stringify, report,
    save() { scene.saves++ },
    async until(check, label) {
      for (let attempt = 0; attempt < (options.attempts || 2); attempt++) {
        scene.attempts++
        options.onAttempt?.(scene)
        const point = await check()
        if (point) return point
      }
      throw new Error(label)
    },
    async evaluate(expression) { return plain(new Script(expression).runInContext(dom.getInternalVMContext())) },
    cdp: { async send(method, params) {
      calls.push({ method, params: plain(params) })
      if (options.inputError) throw options.inputError
    } },
  })
  return scene
}

async function clicked(scene, request = '.native-target') {
  await scene.click(request)
  assert.equal(scene.attempts, 1, 'An exposed point does not need another poll')
  assert.equal(scene.calls.length, 2)
  assert.equal(scene.saves, 2)
  const [down, up] = scene.report.nativeInputs
  assert.equal(down.sequence, 1); assert.equal(up.sequence, 2)
  assert.equal(down.method, 'Input.dispatchMouseEvent'); assert.equal(up.method, down.method)
  assert.equal(down.type, 'mousePressed'); assert.equal(up.type, 'mouseReleased')
  assert.equal(down.button, 'left'); assert.equal(up.button, 'left')
  assert.equal(down.clickCount, 1); assert.equal(up.clickCount, 1)
  assert.equal(down.x, up.x); assert.equal(down.y, up.y)
  assert.ok(within(down.x, down.y, scene.rectangles.get(scene.target)), 'A native click remains inside its actual target')
  assert.ok(within(down.x, down.y, { x: 0, y: 0, width: scene.window.innerWidth, height: scene.window.innerHeight }),
    'A native click remains inside the actual viewport')
  assert.ok(scene.hitCalls.length <= 5, 'Each observation uses at most five actual hit tests')
  assert.equal(scene.report.failedClick, undefined)
  assert.deepEqual(scene.scrollCalls, [{ block: 'nearest', inline: 'nearest' }])
  return { x: down.x, y: down.y }
}

async function refused(scene, request = '.native-target') {
  await assert.rejects(scene.click(request), /Native Table control missing, ambiguous, disabled, or covered/)
  assert.deepEqual(scene.report.nativeInputs, [])
  assert.deepEqual(scene.calls, [])
  assert.equal(scene.saves, 0, 'Only the existing outer failure path persists the last measurement')
  assert.ok(scene.hitCalls.length <= scene.attempts * 5)
}

for (const [label, targetRect, expected] of [
  ['ordinary control', { x: 100, y: 80, width: 120, height: 24 }, { x: 160, y: 92 }],
  ['tall paragraph first line', { x: 100, y: 80, width: 120, height: 180 }, { x: 160, y: 98 }],
]) test('native Table click keeps the original centre for an exposed ' + label, async () => {
  const scene = nativeClickScene({ targetRect })
  try { assert.deepEqual(await clicked(scene), expected); assert.equal(scene.hitCalls.length, 1) }
  finally { scene.dom.window.close() }
})

for (const [label, targetRect, visible] of [
  ['left viewport edge', { x: -260, y: 80, width: 300, height: 24 }, { x: 0, y: 80, width: 40, height: 24 }],
  ['bottom viewport edge', { x: 100, y: 450, width: 120, height: 100 }, { x: 100, y: 450, width: 120, height: 10 }],
]) test('native Table click reaches the actual target at a clipped ' + label, async () => {
  const scene = nativeClickScene({ targetRect })
  try { const point = await clicked(scene); assert.ok(within(point.x, point.y, visible)) }
  finally { scene.dom.window.close() }
})

for (const [axis, visible] of [
  ['x', { x: 430, y: 80, width: 70, height: 220 }],
  ['y', { x: 200, y: 160, width: 300, height: 100 }],
]) test('native Table click respects the ancestor client clip on the ' + axis + ' axis', async () => {
  const scene = nativeClickScene({ targetRect: { x: 200, y: 80, width: 300, height: 220 },
    hit: (x, y, f) => within(x, y, visible) ? f.descendant : f.neighbor })
  scene.box(scene.clip, axis === 'x' ? { x: 420, y: 0, width: 140, height: 460, clientLeft: 10, clientWidth: 100 } :
    { x: 0, y: 150, width: 600, height: 140, clientTop: 10, clientHeight: 100 })
  scene.clip.style[axis === 'x' ? 'overflowX' : 'overflowY'] = 'auto'
  try { const point = await clicked(scene); assert.ok(within(point.x, point.y, visible)) }
  finally { scene.dom.window.close() }
})

test('native Table click intersects independent nested clips and keeps inside their borders', async () => {
  const visible = { x: 430, y: 160, width: 70, height: 100 }
  const scene = nativeClickScene({ targetRect: { x: 200, y: 80, width: 300, height: 220 },
    hit: (x, y, f) => within(x, y, visible) ? f.descendant : f.neighbor })
  scene.box(scene.clip, { x: 420, y: 0, width: 140, height: 460, clientLeft: 10, clientWidth: 100 })
  scene.clip.style.overflowX = 'hidden'
  scene.box(scene.outer, { x: 0, y: 150, width: 600, height: 140, clientTop: 10, clientHeight: 100 })
  scene.outer.style.overflowY = 'clip'
  try {
    const point = await clicked(scene)
    assert.ok(point.x > visible.x && point.x < visible.x + visible.width)
    assert.ok(point.y > visible.y && point.y < visible.y + visible.height)
  } finally { scene.dom.window.close() }
})

for (const [label, exposed] of [
  ['frozen first column', (x, y) => x > 580],
  ['frozen first row', (x, y) => y > 145],
  ['both frozen edges', (x, y) => x > 580 && y > 145],
]) test('native Table click uses the exposed part of the same paragraph beside the ' + label, async () => {
  // This models the observed condition: a scrolled paragraph remains inside
  // the table scrollport, but its centre is under a sticky sibling. It does
  // not invent a final scrollLeft measurement for the Windows failure report.
  const scene = nativeClickScene({ viewport: { width: 1008, height: 655 },
    targetRect: { x: 396, y: 120, width: 293, height: 40 },
    hit: (x, y, f) => exposed(x, y) ? f.descendant : f.frozen })
  scene.box(scene.table, { x: 340, y: 100, width: 600, height: 500, clientWidth: 589 })
  scene.table.style.overflowX = 'auto'; scene.table.style.overflowY = 'auto'
  try {
    const point = await clicked(scene)
    assert.ok(exposed(point.x, point.y))
    assert.ok(scene.hitCalls.length > 1, 'The original covered centre is refused before an exposed point is used')
  } finally { scene.dom.window.close() }
})

for (const [label, request, arrange] of [
  ['exact text', { selector: '.native-target', text: 'target' }, () => {}],
  ['exact accessible label', { selector: '.native-target', text: 'accessible target' }, f => f.target.setAttribute('aria-label', 'accessible target')],
]) test('native Table click preserves matching by ' + label, async () => {
  const scene = nativeClickScene()
  arrange(scene)
  try { assert.deepEqual(await clicked(scene, request), { x: 160, y: 92 }) }
  finally { scene.dom.window.close() }
})

for (const [label, options, arrange] of [
  ['no target', {}, f => f.target.remove()],
  ['multiple visible targets', {}, f => { const duplicate = f.target.cloneNode(true); f.target.parentElement.append(duplicate); f.box(duplicate, { x: 250, y: 80, width: 120, height: 24 }) }],
  ['disabled target', { tag: 'button' }, f => { f.target.disabled = true }],
  ['zero width', { targetRect: { width: 0 } }, () => {}],
  ['zero height', { targetRect: { height: 0 } }, () => {}],
  ['outside viewport', { targetRect: { x: 700 } }, () => {}],
  ['fully clipped ancestor', { hit: (x, y, f) => f.neighbor }, f => { f.box(f.clip, { x: 300, y: 0, width: 100, height: 460 }); f.clip.style.overflowX = 'auto' }],
  ['covered by another cell', { hit: (x, y, f) => f.frozen }, () => {}],
  ['neighbor paragraph hit', { hit: (x, y, f) => f.neighbor }, () => {}],
  ['text mismatch', {}, () => {}],
]) test('native Table click still refuses ' + label + ' without any native input', async () => {
  const scene = nativeClickScene(options)
  arrange(scene)
  try { await refused(scene, label === 'text mismatch' ? { selector: '.native-target', text: 'other' } : '.native-target') }
  finally { scene.dom.window.close() }
})

test('native Table click never retries uncertain native input after finding a valid point', async () => {
  const error = new Error('native press uncertain'), scene = nativeClickScene({ inputError: error })
  try {
    await assert.rejects(scene.click('.native-target'), failure => failure === error)
    assert.equal(scene.attempts, 1)
    assert.equal(scene.calls.length, 1)
    assert.equal(scene.report.nativeInputs.length, 1)
    assert.equal(scene.report.nativeInputs[0].type, 'mousePressed')
    assert.equal(scene.report.failedClick, undefined, 'An input failure is not reported as a measured hit-test failure')
  } finally { scene.dom.window.close() }
})

test('native Table click diagnostics retain only the latest failed measurement without extra observation or input', async () => {
  const scene = nativeClickScene({ hit: (x, y, f) => f.frozen,
    onAttempt: f => { f.table.scrollLeft = f.attempts * 30; f.table.scrollTop = f.attempts * 90 } })
  try {
    await refused(scene)
    assert.equal(scene.scrollCalls.length, 2)
    assert.equal(scene.hitCalls.length, 10)
    const failure = plain(scene.report.failedClick)
    assert.deepEqual(failure.request, { selector: '.native-target' })
    assert.equal(failure.measurement.matchedCount, 1)
    assert.equal(failure.measurement.eligibleCount, 1)
    assert.equal(failure.measurement.disabledCount, 0)
    assert.equal(failure.measurement.target.disabled, false)
    assert.equal(failure.measurement.table.scrollLeft, 60)
    assert.equal(failure.measurement.table.scrollTop, 180)
    assert.equal(failure.measurement.points.length, 5)
    assert.ok(failure.measurement.points.every(point => point.hit.tag === 'P' && point.hit.className === ''))
    assert.equal(failure.measurement.point, null)
    assert.doesNotMatch(JSON.stringify(failure), /textContent|innerHTML|>frozen</)
  } finally { scene.dom.window.close() }
})

test('native Table click diagnostics distinguish a disabled target without hit testing or scrolling it', async () => {
  const scene = nativeClickScene({ tag: 'button' })
  scene.target.disabled = true
  try {
    await refused(scene)
    assert.equal(scene.scrollCalls.length, 0); assert.equal(scene.hitCalls.length, 0)
    const failure = plain(scene.report.failedClick)
    assert.equal(failure.measurement.matchedCount, 1)
    assert.equal(failure.measurement.eligibleCount, 0)
    assert.equal(failure.measurement.disabledCount, 1)
    assert.equal(failure.measurement.point, null)
  } finally { scene.dom.window.close() }
})
