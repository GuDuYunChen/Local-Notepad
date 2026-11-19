import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFullAppCapturePaint } from './full-app-ui-capture-paint.mjs'

// Execute the actual nested capture function, with controlled protocol/frame
// dependencies and real exclusive file writes. The opaque synthetic payload
// proves byte handling, not PNG decoding, pixel identity, native rendering or
// speed. No installed application, browser, timer budget or workflow is run.
const source = readFileSync(new URL('./run-full-app-ui-installed.mjs', import.meta.url), 'utf8')
const digest = value => createHash('sha256').update(value).digest('hex')
const originalCaptureLine = "    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')"
const fastCaptureLine = originalCaptureLine.replace("{ format: 'png' }", "{ format: 'png', optimizeForSpeed: true }")
// Undo only the reviewed paint-ticket wiring before retaining the original
// whole-runner fingerprint. Every literal must occur exactly once.
const withoutPreparedCapturePaint = text => {
  // Invert only the unique current release declaration before the unchanged
  // reviewed paint/speed identity chain. Executed closures keep the raw source.
  const currentVersion = "const VERSION = '4.249.1'"
  const previousVersion = "const VERSION = '4.249.0'"
  const currentSource = text.replace(/\r\n/g, '\n')
  assert.equal(currentSource.split(currentVersion).length - 1, 1)
  assert.equal(currentSource.split(previousVersion).length - 1, 0)
  text = currentSource.replace(currentVersion, previousVersion)
  assert.equal(text.split(previousVersion).length - 1, 1)
  assert.equal(text.replace(previousVersion, currentVersion), currentSource)
  const changes = [
  [
    "import { createFullAppCapturePaint } from './full-app-ui-capture-paint.mjs'\n",
    ""
  ],
  [
    "  const capturePaint = createFullAppCapturePaint(() => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'))\n",
    ""
  ],
  [
    "  const capture = async (filename, observeBeforeCapture, paintTicket) => {",
    "  const capture = async (filename, observeBeforeCapture) => {"
  ],
  [
    "    await capturePaint.wait(filename, paintTicket)",
    "    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')"
  ],
  [
    "  capture.preparePaint = capturePaint.prepare\n",
    ""
  ]
]
  const present = text.includes(changes[0][0])
  if (!present) return text
  for (const [current, original] of changes) {
    assert.equal(text.split(current).length - 1, 1, 'Unique reviewed paint-ticket source change')
    text = text.replace(current, original)
  }
  return text
}
const oldCount = source.split(originalCaptureLine).length - 1
const newCount = source.split(fastCaptureLine).length - 1
assert.equal(oldCount + newCount, 1, 'Use the unique actual6dae capture call or its one-line PNG-speed candidate')
assert.ok((oldCount === 1 && newCount === 0) || (oldCount === 0 && newCount === 1))
assert.equal(digest(withoutPreparedCapturePaint(source).replace(fastCaptureLine, originalCaptureLine)),
  'eaf27dadcdc8a8544fefb02f78e87ad8ed0e8a853358d7a124a777f3ac6b9091',
  'The whole actual runner must equal6dae after only the declared inverse change')
// Keep the real runner bytes for capture/until execution; only the exact
// whole-file identity adapter above may undo its one release declaration.
const releaseIdentitySource = source.replace(/\r\n/g, '\n')
const releaseFingerprint = value => digest(withoutPreparedCapturePaint(value).replace(fastCaptureLine, originalCaptureLine))
for (const current of [releaseIdentitySource, releaseIdentitySource.replace(/\n/g, '\r\n')]) {
  assert.equal(releaseFingerprint(current), 'eaf27dadcdc8a8544fefb02f78e87ad8ed0e8a853358d7a124a777f3ac6b9091')
  const statement = "const VERSION = '4.249.1'"
  for (const replacement of ['', statement + '\n' + statement,
    "const VERSION = '4.249.0'", "const VERSION = '4.249.2'", "const  VERSION = '4.249.1'"]) {
    const changed = current.replace(statement, replacement)
    assert.notEqual(changed, current)
    assert.throws(() => releaseFingerprint(changed), { code: 'ERR_ASSERTION' })
  }
  const changed = current.replace('const API_BASE =', 'const ALTERED_API_BASE =')
  assert.notEqual(changed, current)
  assert.throws(() => assert.equal(releaseFingerprint(changed),
    'eaf27dadcdc8a8544fefb02f78e87ad8ed0e8a853358d7a124a777f3ac6b9091'), { code: 'ERR_ASSERTION' })
}
const startAnchor = source.includes("import { createFullAppCapturePaint }")
  ? '  const capturePaint = createFullAppCapturePaint('
  : '  const capture = async (filename, observeBeforeCapture) => {'
const endAnchor = '\n  const mainWindow = async () => {'
assert.equal(source.split(startAnchor).length, 2)
assert.equal(source.split(endAnchor).length, 2)
const start = source.indexOf(startAnchor), end = source.indexOf(endAnchor, start)
assert.ok(end > start)
const actualCaptureDeclaration = source.slice(start, end)
const instantiateCapture = new Function('dependencies', 'createFullAppCapturePaint',
  'const { assert, evaluate, cdp, Buffer, writeFileSync, path, out, sha, report, save, evidenceStore } = dependencies;\n' +
  actualCaptureDeclaration + '\nreturn capture')
const createCapture = dependencies => instantiateCapture(dependencies, createFullAppCapturePaint)

const frameExpression = 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'
const filename = 'ordinary-capture.png'
const successOrder = ['validate-name', 'frame', 'guard', 'cdp', 'validate-bytes', 'write', 'hash', 'push', 'save', 'seal']

function fixture({ failAt = null, bytes = 2049 } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'notepad-png-capture-'))
  const payload = Buffer.alloc(bytes)
  for (let index = 0; index < payload.length; index++) payload[index] = (index * 37 + 19) & 255
  const failure = new Error('original-' + failAt + '-failure')
  const events = [], calls = [], writes = [], hashes = [], assertions = [], saved = [], sealed = []
  const screenshots = []
  Object.defineProperty(screenshots, 'push', { configurable: true, value(record) {
    events.push('push')
    return Array.prototype.push.call(this, record)
  } })
  const report = { complete: false, screenshots }
  const value = { directory, payload, failure, events, calls, writes, hashes, assertions, saved, sealed, report, writeFailure: null }
  const captureAssert = {
    match(...args) {
      events.push('validate-name')
      try { return assert.match(...args) } catch (error) { assertions.push(error); throw error }
    },
    ok(...args) {
      events.push('validate-bytes')
      try { return assert.ok(...args) } catch (error) { assertions.push(error); throw error }
    },
  }
  const capture = createCapture({
    assert: captureAssert, Buffer, path, out: directory, report,
    evaluate: async expression => {
      events.push('frame')
      assert.equal(expression, frameExpression)
      if (failAt === 'frame') throw failure
      return true
    },
    cdp: { send: async (method, parameters) => {
      events.push('cdp'); calls.push({ method, parameters })
      assert.equal(method, 'Page.captureScreenshot')
      if (failAt === 'cdp') throw failure
      return { data: payload.toString('base64') }
    } },
    writeFileSync: (target, contents, flags) => {
      events.push('write'); writes.push({ target, contents, flags })
      assert.equal(target, path.join(directory, filename))
      assert.deepEqual(flags, { flag: 'wx' })
      try { writeFileSync(target, contents, flags) } catch (error) { value.writeFailure = error; throw error }
    },
    sha: contents => { events.push('hash'); hashes.push(contents); return digest(contents) },
    save: () => {
      events.push('save')
      assert.equal(report.screenshots.length, 1)
      saved.push(report.screenshots[0])
      if (failAt === 'save') throw failure
    },
    evidenceStore: { sealStableJSON: (collection, record) => {
      events.push('seal'); sealed.push({ collection, record })
      assert.equal(collection, 'screenshots')
      assert.equal(record, report.screenshots[0])
      assert.equal(record, saved[0])
      if (failAt === 'seal') throw failure
    } },
  })
  const guard = async () => {
    events.push('guard')
    if (failAt === 'guard') throw failure
  }
  value.capture = name => capture(name, guard)
  value.close = () => rmSync(directory, { recursive: true, force: true })
  return value
}

async function withFixture(options, action) {
  const value = fixture(options)
  try { await action(value) } finally { value.close() }
}

function noReportCompletion(value) {
  assert.equal(value.report.complete, false)
  assert.ok(value.calls.length <= 1, 'No retry or replacement screenshot is permitted')
  assert.ok(value.saved.length <= 1)
  assert.ok(value.sealed.length <= 1)
}

test('PNG01 actual capture keeps frame, guard, one fast PNG request, exact exclusive bytes and record-save-seal order', async () => {
  await withFixture({}, async value => {
    const record = await value.capture(filename)
    assert.deepEqual(value.events, successOrder)
    assert.equal(value.calls.length, 1)
    assert.equal(value.writes.length, 1)
    assert.equal(value.hashes.length, 1)
    assert.equal(value.saved.length, 1)
    assert.equal(value.sealed.length, 1)
    assert.deepEqual(value.writes[0].flags, { flag: 'wx' })
    assert.equal(value.writes[0].contents, value.hashes[0])
    assert.deepEqual(value.writes[0].contents, value.payload)
    assert.deepEqual(readFileSync(path.join(value.directory, filename)), value.payload)
    assert.deepEqual(record, { filename, bytes: value.payload.length, sha256: digest(value.payload) })
    assert.equal(record, value.report.screenshots[0])
    assert.equal(record, value.saved[0])
    assert.equal(record, value.sealed[0].record)
    assert.equal(value.sealed[0].collection, 'screenshots')
    assert.deepEqual(readdirSync(value.directory), [filename])
    assert.deepEqual(value.assertions, [])
    noReportCompletion(value)
    // The old6dae negative control reaches this final parameter assertion
    // only after proving the unchanged original byte/record/order contracts.
    assert.deepEqual(value.calls[0], { method: 'Page.captureScreenshot', parameters: { format: 'png', optimizeForSpeed: true } })
  })
})

test('PNG02 invalid filename preserves the actual assertion identity before any frame or screenshot', async () => {
  await withFixture({}, async value => {
    await assert.rejects(value.capture('../not-owned.png'), error => {
      assert.equal(error, value.assertions[0])
      assert.equal(error.code, 'ERR_ASSERTION')
      assert.equal(error.actual, '../not-owned.png')
      return true
    })
    assert.deepEqual(value.events, ['validate-name'])
    assert.equal(value.assertions.length, 1)
    assert.deepEqual(value.report.screenshots, [])
    assert.deepEqual(readdirSync(value.directory), [])
    noReportCompletion(value)
  })
})

test('PNG03 frame failure remains the original error and prevents guard, screenshot and evidence writes', async () => {
  await withFixture({ failAt: 'frame' }, async value => {
    await assert.rejects(value.capture(filename), error => error === value.failure)
    assert.deepEqual(value.events, successOrder.slice(0, 2))
    assert.deepEqual(value.calls, [])
    assert.deepEqual(value.report.screenshots, [])
    assert.deepEqual(readdirSync(value.directory), [])
    noReportCompletion(value)
  })
})

test('PNG04 pre-capture guard failure retains its error after the original frame and before any screenshot', async () => {
  await withFixture({ failAt: 'guard' }, async value => {
    await assert.rejects(value.capture(filename), error => error === value.failure)
    assert.deepEqual(value.events, successOrder.slice(0, 3))
    assert.deepEqual(value.calls, [])
    assert.deepEqual(value.report.screenshots, [])
    assert.deepEqual(readdirSync(value.directory), [])
    noReportCompletion(value)
  })
})

test('PNG05 the one CDP failure is propagated unchanged without another capture or a saved record', async () => {
  await withFixture({ failAt: 'cdp' }, async value => {
    await assert.rejects(value.capture(filename), error => error === value.failure)
    assert.deepEqual(value.events, successOrder.slice(0, 4))
    assert.equal(value.calls.length, 1)
    assert.deepEqual(value.writes, [])
    assert.deepEqual(value.report.screenshots, [])
    assert.deepEqual(readdirSync(value.directory), [])
    noReportCompletion(value)
  })
})

test('PNG06 the original greater-than1000-byte guard rejects the boundary with its assertion identity', async () => {
  await withFixture({ bytes: 1000 }, async value => {
    await assert.rejects(value.capture(filename), error => {
      assert.equal(error, value.assertions[0])
      assert.equal(error.code, 'ERR_ASSERTION')
      assert.equal(error.actual, false)
      return true
    })
    assert.deepEqual(value.events, successOrder.slice(0, 5))
    assert.equal(value.calls.length, 1)
    assert.equal(value.assertions.length, 1)
    assert.deepEqual(value.writes, [])
    assert.deepEqual(value.report.screenshots, [])
    assert.deepEqual(readdirSync(value.directory), [])
    noReportCompletion(value)
  })
})

test('PNG07 a real exclusive-write collision preserves its exact filesystem error and the existing bytes', async () => {
  await withFixture({}, async value => {
    const previous = Buffer.from([0, 255, 128, 17, 0, 63])
    writeFileSync(path.join(value.directory, filename), previous, { flag: 'wx' })
    await assert.rejects(value.capture(filename), error => {
      assert.equal(error, value.writeFailure)
      assert.equal(error.code, 'EEXIST')
      return true
    })
    assert.deepEqual(value.events, successOrder.slice(0, 6))
    assert.equal(value.calls.length, 1)
    assert.equal(value.writes.length, 1)
    assert.deepEqual(value.hashes, [])
    assert.deepEqual(value.report.screenshots, [])
    assert.deepEqual(readFileSync(path.join(value.directory, filename)), previous)
    assert.deepEqual(readdirSync(value.directory), [filename])
    noReportCompletion(value)
  })
})

test('PNG08 save failure keeps its error and the one already-written and pushed record without sealing', async () => {
  await withFixture({ failAt: 'save' }, async value => {
    await assert.rejects(value.capture(filename), error => error === value.failure)
    assert.deepEqual(value.events, successOrder.slice(0, 9))
    assert.equal(value.calls.length, 1)
    assert.equal(value.report.screenshots.length, 1)
    assert.equal(value.saved.length, 1)
    assert.equal(value.saved[0], value.report.screenshots[0])
    assert.deepEqual(value.sealed, [])
    assert.deepEqual(readFileSync(path.join(value.directory, filename)), value.payload)
    noReportCompletion(value)
  })
})

test('PNG09 seal failure keeps its error after one capture, write and save and never returns a false success', async () => {
  await withFixture({ failAt: 'seal' }, async value => {
    await assert.rejects(value.capture(filename), error => error === value.failure)
    assert.deepEqual(value.events, successOrder)
    assert.equal(value.calls.length, 1)
    assert.equal(value.report.screenshots.length, 1)
    assert.equal(value.saved.length, 1)
    assert.equal(value.sealed.length, 1)
    assert.equal(value.sealed[0].record, value.report.screenshots[0])
    assert.equal(value.sealed[0].record, value.saved[0])
    assert.deepEqual(readFileSync(path.join(value.directory, filename)), value.payload)
    noReportCompletion(value)
  })
})
