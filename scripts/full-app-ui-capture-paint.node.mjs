import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { createFullAppCapturePaint } from './full-app-ui-capture-paint.mjs'

const filename = 'settings-dark-1920x1080-settings-main-default-part-1.png'
const canonicalSource = value => value.replace(/\r\n/g, '\n')
const readSource = filename => readFileSync(new URL(filename, import.meta.url), 'utf8')
function checkoutRepresentations(value) {
  const lf = canonicalSource(value)
  return [lf, lf.replace(/\n/g, '\r\n')]
}
function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

test('paint prepare sends immediately and joins the same unresolved two-frame request before the guard or PNG', async () => {
  const frame = deferred(), events = []
  const paint = createFullAppCapturePaint(() => { events.push('send-two-frames'); return frame.promise })
  const ticket = paint.prepare(filename)
  assert.deepEqual(events, ['send-two-frames'])
  assert.equal(Object.isFrozen(ticket), true)
  assert.deepEqual(Reflect.ownKeys(ticket), [])
  events.push('host-append', 'host-save', 'host-assertions')
  const capture = (async () => {
    await paint.wait(filename, ticket)
    events.push('sync-wait', 'fresh-observation', 'before-boundary', 'PNG')
  })()
  await Promise.resolve()
  assert.deepEqual(events, ['send-two-frames', 'host-append', 'host-save', 'host-assertions'])
  frame.resolve(true)
  await capture
  assert.deepEqual(events, ['send-two-frames', 'host-append', 'host-save', 'host-assertions',
    'sync-wait', 'fresh-observation', 'before-boundary', 'PNG'])
})

test('frames completing before the host work ends do not run the capture guard early or request more frames', async () => {
  let sends = 0, hostComplete = false, guarded = false
  const paint = createFullAppCapturePaint(() => { sends++; return true })
  const ticket = paint.prepare(filename)
  await Promise.resolve()
  assert.equal(guarded, false)
  hostComplete = true
  await paint.wait(filename, ticket)
  assert.equal(hostComplete, true); guarded = true
  assert.equal(sends, 1); assert.equal(guarded, true)
})

test('early asynchronous frame rejection is handled until consumption and throws the exact original error', async () => {
  const error = new Error('original-frame-rejection')
  const paint = createFullAppCapturePaint(() => Promise.reject(error))
  const ticket = paint.prepare(filename)
  await setImmediate() // An unhandled early rejection would fail this test turn.
  await assert.rejects(paint.wait(filename, ticket), value => value === error)
  await assert.rejects(paint.wait(filename, ticket), /foreign or already consumed/)
})

test('a synchronous frame dispatch exception is retained until the original capture boundary', async () => {
  const error = new Error('original-synchronous-dispatch-failure')
  const paint = createFullAppCapturePaint(() => { throw error })
  let ticket
  assert.doesNotThrow(() => { ticket = paint.prepare(filename) })
  await assert.rejects(paint.wait(filename, ticket), value => value === error)
})

for (const kind of ['synchronous', 'asynchronous']) test(`host failure keeps its original priority with an abandoned ${kind} failed paint ticket`, async () => {
  const frameError = new Error('frame-failed'), hostError = new Error('original-host-assertion')
  let sends = 0
  const paint = createFullAppCapturePaint(() => {
    sends++
    if (kind === 'synchronous') throw frameError
    return Promise.reject(frameError)
  })
  await assert.rejects((async () => {
    paint.prepare(filename)
    throw hostError
  })(), error => error === hostError)
  await setImmediate()
  assert.equal(sends, 1)
})

test('tickets reject foreign instances, a different filename, forged objects and null without sending replacement frames', async () => {
  let sends = 0
  const paint = createFullAppCapturePaint(() => { sends++; return true })
  const foreign = createFullAppCapturePaint(() => { assert.fail('Foreign rejection must not request frames') })
  const ticket = paint.prepare(filename)
  await assert.rejects(foreign.wait(filename, ticket), /foreign or already consumed/)
  for (const invalid of [null, {}, 'ticket', 0]) await assert.rejects(paint.wait(filename, invalid), /foreign or already consumed/)
  await assert.rejects(paint.wait('different.png', ticket), /filename changed/)
  assert.equal(await paint.wait(filename, ticket), true)
  assert.equal(sends, 1)
})

test('the same ticket cannot be consumed concurrently while its frames remain pending', async () => {
  const frame = deferred()
  const paint = createFullAppCapturePaint(() => frame.promise), ticket = paint.prepare(filename)
  const first = paint.wait(filename, ticket)
  await assert.rejects(paint.wait(filename, ticket), /foreign or already consumed/)
  frame.resolve(true)
  assert.equal(await first, true)
})

test('an invalid predicted filename is not checked before the host assertions', async () => {
  const paint = createFullAppCapturePaint(() => true)
  assert.doesNotThrow(() => paint.prepare('../invalid.png'))
  // The actual capture still performs its original filename assertion first.
})

test('no ticket preserves a new original paint wait for every ordinary or failure capture', async () => {
  const first = deferred(), second = deferred(), events = []
  let sends = 0
  const paint = createFullAppCapturePaint(() => { events.push(++sends); return (sends === 1 ? first : second).promise })
  const ordinary = paint.wait(filename)
  assert.deepEqual(events, [1]); first.resolve(true); assert.equal(await ordinary, true)
  const failure = paint.wait('full-app-ui-failed.png')
  assert.deepEqual(events, [1, 2]); second.resolve(false); assert.equal(await failure, false)
})

test('no-ticket paint rejection propagates the original error without a ticket or retry', async () => {
  const error = new Error('original-no-ticket-frame-failure')
  let sends = 0
  const paint = createFullAppCapturePaint(() => { sends++; throw error })
  await assert.rejects(paint.wait(filename), value => value === error)
  assert.equal(sends, 1)
})

function actualCaptureFixture(checkoutSource) {
  const source = canonicalSource(checkoutSource)
  const startText = '  const capturePaint = createFullAppCapturePaint('
  const endText = '\n  const mainWindow = async () => {'
  assert.equal(source.split(startText).length, 2); assert.equal(source.split(endText).length, 2)
  const start = source.indexOf(startText), end = source.indexOf(endText, start)
  const create = new Function('dependencies',
    'const { assert, evaluate, cdp, Buffer, writeFileSync, path, out, sha, report, save, evidenceStore, createFullAppCapturePaint } = dependencies;\n' +
    source.slice(start, end) + '\nreturn capture')
  const frame = deferred(), events = [], payload = Buffer.alloc(2049, 37), report = { screenshots: [] }
  const capture = create({ assert, Buffer, report, createFullAppCapturePaint,
    evaluate(expression) {
      assert.equal(expression, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
      events.push('send-two-frames'); return frame.promise
    },
    cdp: { async send(method, parameters) {
      assert.equal(method, 'Page.captureScreenshot')
      assert.deepEqual(parameters, { format: 'png', optimizeForSpeed: true })
      events.push('PNG'); return { data: payload.toString('base64') }
    } },
    writeFileSync(target, bytes, options) { assert.deepEqual(bytes, payload); assert.deepEqual(options, { flag: 'wx' }); events.push('write') },
    path: { join: (...parts) => parts.join('/') }, out: 'contract-only', sha: () => 'contract-only',
    save() { events.push('save') },
    evidenceStore: { sealStableJSON(collection, record) {
      assert.equal(collection, 'screenshots'); assert.equal(record, report.screenshots[0]); events.push('seal')
    } },
  })
  return { capture, frame, events, report }
}

test('the actual runner capture joins its prepared frame before its original guard and one PNG write/save/seal', async () => {
  for (const source of checkoutRepresentations(readSource('./run-full-app-ui-installed.mjs'))) {
    const f = actualCaptureFixture(source), ticket = f.capture.preparePaint(filename)
    assert.deepEqual(f.events, ['send-two-frames'])
    f.events.push('host-evidence-complete')
    const capture = f.capture(filename, async () => { f.events.push('guard') }, ticket)
    await Promise.resolve()
    assert.deepEqual(f.events, ['send-two-frames', 'host-evidence-complete'])
    f.frame.resolve(true)
    const image = await capture
    assert.equal(image, f.report.screenshots[0])
    assert.deepEqual(f.events, ['send-two-frames', 'host-evidence-complete', 'guard', 'PNG', 'write', 'save', 'seal'])
  }
})

test('the actual runner capture retains its original guard rejection after a prepared frame without PNG or writes', async () => {
  for (const source of checkoutRepresentations(readSource('./run-full-app-ui-installed.mjs'))) {
    const f = actualCaptureFixture(source), original = new Error('original-fresh-observation-refusal')
    const ticket = f.capture.preparePaint(filename)
    f.frame.resolve(true)
    await assert.rejects(f.capture(filename, async () => { f.events.push('guard'); throw original }, ticket), error => error === original)
    assert.deepEqual(f.events, ['send-two-frames', 'guard'])
    assert.deepEqual(f.report.screenshots, [])
  }
})

function verifyActualSharedWiring(sharedCheckout, runnerCheckout) {
  const shared = canonicalSource(sharedCheckout), runner = canonicalSource(runnerCheckout)
  const start = shared.indexOf('    const snap = async targetAnchors => {')
  const end = shared.indexOf('\n    try {', start)
  assert.ok(start >= 0 && end > start)
  const snap = shared.slice(start, end)
  const sourceOrder = [
    'const before = await samplePage(',
    "const paintTicket = capture.preparePaint?.(nameFor(meta, 'part-' + (index + 1)))",
    'appendRaw(scene, { ...before, text: undefined }); save()',
    'assert.deepEqual(before.viewport, meta.viewport)',
    "const filename = nameFor(meta, 'part-' + (++index))",
    'motion.image = filename',
    'const image = await capture(filename, async () => {',
    'syncTicket = syncReadiness ? await syncReadiness.wait() : null',
    'const fresh = await samplePage(',
    "syncReadiness.boundary(syncTicket, 'before-capture', filename)",
    '}, paintTicket)',
    'scene.images.push(image)',
    'afterCapture = await samplePage(',
    "syncReadiness.boundary(syncTicket, 'after-capture', image.filename)",
  ]
  let previous = -1
  for (const text of sourceOrder) {
    const at = snap.indexOf(text)
    assert.ok(at > previous, 'Actual capture ordering changed: ' + text)
    previous = at
  }
  assert.equal(snap.split('capture.preparePaint').length, 2)
  assert.equal(snap.split('++index').length, 2)
  assert.ok(runner.includes("const capturePaint = createFullAppCapturePaint(() => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'))"))
  assert.ok(runner.includes("const capture = async (filename, observeBeforeCapture, paintTicket) => {\n    assert.match(filename, /^[a-z0-9][a-z0-9_-]*\\.png$/)\n    await capturePaint.wait(filename, paintTicket)\n    if (observeBeforeCapture) await observeBeforeCapture()"))
  assert.ok(runner.includes('capture.preparePaint = capturePaint.prepare'))
}

test('actual shared wiring starts after before-observation and preserves host, filename, motion and capture callback order', () => {
  const shared = checkoutRepresentations(readSource('./full-app-ui-shared.mjs'))
  const runner = checkoutRepresentations(readSource('./run-full-app-ui-installed.mjs'))
  assert.equal(shared[0].includes('\r'), false); assert.equal(runner[0].includes('\r'), false)
  assert.ok(shared[1].includes('\r\n')); assert.ok(runner[1].includes('\r\n'))
  for (let index = 0; index < 2; index++) verifyActualSharedWiring(shared[index], runner[index])
})
