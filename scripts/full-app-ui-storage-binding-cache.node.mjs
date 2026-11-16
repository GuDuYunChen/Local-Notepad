// Writer-only contracts. These retain every atomic checkpoint and do not run
// an installed app, change its readiness windows, or prove Windows performance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFullAppEvidenceWriter, readFullAppEvidence } from './full-app-ui-storage.mjs'

const nativeParse = JSON.parse, nativeStringify = JSON.stringify, nativeApply = Reflect.apply
const json = value => nativeParse(nativeStringify(value))
const read = f => nativeParse(readFileSync(f.filename, 'utf8'))
function report() {
  return { productCommit: '1'.repeat(40), productTree: '2'.repeat(40), verifierCommit: '3'.repeat(40),
    group: 'settings', runner: { runID: 'sequence-cache-contract', attempt: '1' },
    sourceFiles: { keep: { bytes: 12, sha256: '4'.repeat(64) } }, startedAt: '2026-11-16T00:00:00.000Z',
    complete: false, screenshots: [], fullAppUi: { complete: false, scenes: [], focus: [], popups: [], optionPointerPreparations: [] } }
}
function scene(index) {
  return { group: 'settings', routeId: 'sequence-' + index, stateId: 'ordinary', theme: 'light',
    viewport: { width: 704, height: 455 }, complete: true, geometry: { valid: true, failures: [] },
    rawSamples: [{ phase: 'before-capture', image: 'scene-' + index + '.png', detail: { index, keep: '原始值' } }] }
}
function fixture({ warm = true, beforeWriter = () => {}, createWriter = createFullAppEvidenceWriter } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'notepad-sequence-cache-'))
  const value = report(), filename = path.join(directory, 'full-app-ui-installed.json')
  beforeWriter(value)
  let writer
  try { writer = createWriter(filename, value, { storageVersion: 2 }) }
  catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
  const f = { directory, filename, report: value, writer, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
  if (warm) {
    for (let index = 0; index < 3; index++) {
      const current = scene(index); value.fullAppUi.scenes.push(current); writer.save(); writer.sealScene(current)
      const shot = { file: 'shot-' + index + '.png', bytes: 100 + index, data: { text: '截图 ' + index } }
      value.screenshots.push(shot); writer.save(); assert.equal(writer.sealStableJSON('screenshots', shot), true)
    }
    for (const key of ['focus', 'popups', 'optionPointerPreparations']) {
      const receipt = { name: key, detail: { value: 1 } }
      value.fullAppUi[key].push(receipt); writer.save(); assert.equal(writer.sealStableJSON('fullAppUi.' + key, receipt), true)
    }
    writer.save(); writer.save()
  }
  return f
}
function roundtrip(f) {
  const loaded = readFullAppEvidence(f.filename)
  assert.deepEqual(json(loaded.report), json(f.report))
  return loaded
}
function currentScreenshots(f) {
  const current = read(f), expected = { ...current, body: { ...current.body, screenshots: json(f.report.screenshots) } }
  assert.equal(readFileSync(f.filename, 'utf8'), nativeStringify(expected) + '\n')
  roundtrip(f)
}
function hookPrototype(target, hook, callback) {
  const before = Object.getOwnPropertyDescriptor(target, 'toJSON')
  assert.equal(before, undefined)
  Object.defineProperty(target, 'toJSON', { configurable: true, value: hook })
  try { return callback() } finally { delete target.toJSON }
}

test('full sealed sequences reuse encoding while each current checkpoint, publication and ordinal remains real', () => {
  const f = fixture()
  try {
    const before = f.writer.statistics(), checkpoint = read(f).checkpoint
    f.report.mutable = { value: 1 }; f.writer.save(); f.report.mutable.value = 2; f.writer.save()
    const after = f.writer.statistics()
    assert.equal(after.saves, before.saves + 2); assert.equal(read(f).checkpoint, checkpoint + 2)
    assert.ok(after.stableJSON.aggregateArrayHits > before.stableJSON.aggregateArrayHits)
    assert.ok(after.stableJSON.scenePrefixHits > before.stableJSON.scenePrefixHits)
    assert.equal(after.stableJSON.aggregateArrayEncodes, before.stableJSON.aggregateArrayEncodes)
    assert.equal(after.stableJSON.scenePrefixEncodes, before.stableJSON.scenePrefixEncodes)
    assert.equal(after.stableJSON.cachedHits - before.stableJSON.cachedHits, 12)
    assert.equal(after.stableReferences - before.stableReferences, 6)
    assert.equal(after.stableRefCacheHits - before.stableRefCacheHits, 6)
    assert.equal(roundtrip(f).report.mutable.value, 2); currentScreenshots(f)
  } finally { f.cleanup() }
})

for (const [label, mutate] of [
  ['reverse', value => value.reverse()],
  ['pop', value => value.pop()],
  ['duplicate', value => { value[1] = value[0] }],
  ['same-length mutable replacement', value => { value[1] = { file: 'new.png', detail: { count: 1 } } }],
]) test('a warm screenshot sequence follows its current ' + label, () => {
  const f = fixture()
  try {
    mutate(f.report.screenshots); f.writer.save(); currentScreenshots(f)
    const changed = f.report.screenshots.find(item => item?.file === 'new.png')
    if (changed) { changed.detail.count++; f.writer.save(); currentScreenshots(f) }
    const before = f.report.screenshots
    f.report.screenshots = [...before]; f.writer.save(); currentScreenshots(f)
    f.report.screenshots = before; f.writer.save(); currentScreenshots(f)
  } finally { f.cleanup() }
})

for (const [label, mutate] of [
  ['hole', value => { delete value[1] }],
  ['hidden index', value => { Object.defineProperty(value, '1', { enumerable: false }) }],
  ['extra string key', value => { value.extra = 'retained' }],
  ['extra symbol key', value => { value[Symbol('own-extra')] = 'retained' }],
  ['custom prototype', value => { Object.setPrototypeOf(value, Object.create(Array.prototype)) }],
]) test('a warm sequence keeps the original whole native fallback for ' + label, () => {
  const f = fixture()
  try {
    mutate(f.report.screenshots); f.writer.save()
    assert.equal(read(f).storageVersion, 1); currentScreenshots(f)
  } finally { f.cleanup() }
})

test('qualification never reads an indexed getter; only the one original native fallback does', () => {
  const f = fixture(); let calls = 0
  try {
    const original = f.report.screenshots[1]
    Object.defineProperty(f.report.screenshots, '1', { configurable: true, enumerable: true, get() { calls++; return original } })
    f.writer.save(); assert.equal(calls, 1); assert.equal(read(f).storageVersion, 1)
    assert.deepEqual(read(f).body.screenshots[1], json(original))
    delete f.report.screenshots[1]; f.report.screenshots[1] = original
    f.writer.save(); currentScreenshots(f)
  } finally { f.cleanup() }
})

test('proxy arrays retain their native access sequence and cannot use a warm aggregate', () => {
  const f = fixture(); const gets = []
  try {
    const original = f.report.screenshots
    f.report.screenshots = new Proxy(original, { get(target, key, receiver) { gets.push(key); return Reflect.get(target, key, receiver) } })
    f.writer.save(); assert.equal(read(f).storageVersion, 1)
    assert.deepEqual(gets, ['toJSON', 'length', '0', '1', '2'])
    f.report.screenshots = original; f.writer.save(); currentScreenshots(f)
  } finally { f.cleanup() }
})

test('own nonfunction toJSON retains fallback qualification and its field value', () => {
  const f = fixture()
  try {
    f.report.screenshots.push({ file: 'mutable.png', toJSON: null, detail: { present: true } }); f.writer.save()
    assert.equal(read(f).storageVersion, 1); assert.equal(read(f).body.screenshots.at(-1).toJSON, null); currentScreenshots(f)
  } finally { f.cleanup() }
})

test('same objects moved among stable collections keep each real ordinal projection and published-object boundary', () => {
  const f = fixture()
  try {
    const first = f.report.fullAppUi.focus[0]
    f.report.fullAppUi.focus = [first, first]; f.report.fullAppUi.popups.unshift(first)
    f.writer.save(); roundtrip(f)
    const descriptor = read(f).stableReceipts.collections
    assert.deepEqual(descriptor[0].entries.map(item => item.ref.context), [0, 1].map(ordinal => ({ collection: 'fullAppUi.focus', ordinal })))
    assert.deepEqual(descriptor[1].entries[0].ref.context, { collection: 'fullAppUi.popups', ordinal: 0 })
    assert.notEqual(descriptor[0].entries[0].ref.file, descriptor[0].entries[1].ref.file)
    const fresh = { file: 'not-yet-published.png', value: 1 }; f.report.screenshots.push(fresh)
    assert.throws(() => f.writer.sealStableJSON('screenshots', fresh), /successful publication/)
    f.writer.save(); assert.equal(f.writer.sealStableJSON('screenshots', fresh), true)
    f.writer.save(); currentScreenshots(f)
    f.report.screenshots = []; f.writer.save(); assert.throws(() => f.writer.sealStableJSON('screenshots', fresh), /original published collection/)
    f.report.screenshots.push(fresh); assert.throws(() => f.writer.sealStableJSON('screenshots', fresh), /successful publication/)
    f.writer.save(); assert.equal(f.writer.sealStableJSON('screenshots', fresh), true)
  } finally { f.cleanup() }
})

test('a failed new scene seal never commits a prefix or loses later active metadata and raw samples', () => {
  const f = fixture()
  try {
    const next = scene(3); f.report.fullAppUi.scenes.push(next); f.writer.save()
    const preceding = readFileSync(f.filename), saves = f.writer.statistics().saves, temporary = f.filename + '.next'
    writeFileSync(temporary, 'foreign staging path', { flag: 'wx' })
    assert.throws(() => f.writer.sealScene(next), /EEXIST/)
    assert.deepEqual(readFileSync(f.filename), preceding); assert.equal(f.writer.statistics().saves, saves)
    assert.equal(readFileSync(temporary, 'utf8'), 'foreign staging path'); unlinkSync(temporary)
    next.diagnostic = { value: 'after failure' }; next.rawSamples.push({ phase: 'after-failure', image: 'fresh.png', value: 9 })
    f.writer.save(); assert.equal(read(f).scenes.at(-1).state, 'active'); roundtrip(f)
    f.writer.sealScene(next); f.writer.save(); assert.equal(read(f).scenes.at(-1).state, 'sealed'); roundtrip(f)
  } finally { f.cleanup() }
})

for (const target of [Object.prototype, Array.prototype]) test('a throwing ' + (target === Object.prototype ? 'Object' : 'Array') + ' hook cannot revive an old warm sequence', () => {
  const f = fixture()
  try {
    const preceding = readFileSync(f.filename), saves = f.writer.statistics().saves
    hookPrototype(target, function () { throw Error('current protocol refusal') }, () => assert.throws(() => f.writer.save(), /current protocol refusal/))
    assert.deepEqual(readFileSync(f.filename), preceding); assert.equal(f.writer.statistics().saves, saves)
    f.report.screenshots.reverse(); f.writer.save(); currentScreenshots(f)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
  } finally { f.cleanup() }
})

for (const mode of ['wrapper', 'proxy']) test('a parse ' + mode + ' before import cannot leave an escaped constructor binding trusted after removal', async () => {
  let f, escaped
  const observe = result => { if (!escaped && result?.sourceFiles && result?.productCommit) escaped = result; return result }
  try {
    JSON.parse = mode === 'wrapper' ? function (...args) { return observe(nativeApply(nativeParse, this, args)) }
      : new Proxy(nativeParse, { apply(target, receiver, args) { return observe(nativeApply(target, receiver, args)) } })
    const isolated = await import(new URL('./full-app-ui-storage.mjs?parse-preimport-' + mode, import.meta.url))
    f = fixture({ warm: false, createWriter: isolated.createFullAppEvidenceWriter })
    JSON.parse = nativeParse
    assert.ok(escaped); assert.equal(Object.isFrozen(escaped), false); f.writer.save()
    escaped.sourceFiles.keep.bytes++; f.report.sourceFiles.keep.bytes++; f.writer.save()
    assert.equal(read(f).binding.sourceFiles.keep.bytes, f.report.sourceFiles.keep.bytes)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.throws(() => isolated.readFullAppEvidence(f.filename), /owner differs/)
  } finally { JSON.parse = nativeParse; f?.cleanup() }
})

test('a self-removing parse hook installed by a binding getter is observed at the actual normalization call', () => {
  let f, escaped
  try {
    f = fixture({ warm: false, beforeWriter(value) {
      const original = value.sourceFiles; let first = true
      Object.defineProperty(value, 'sourceFiles', { enumerable: true, configurable: true, get() {
        if (first) {
          first = false
          JSON.parse = function (text) { JSON.parse = nativeParse; escaped = nativeApply(nativeParse, this, [text]); return escaped }
        }
        return original
      } })
    } })
    assert.ok(escaped); assert.equal(JSON.parse, nativeParse); f.writer.save()
    escaped.sourceFiles.keep.bytes++; f.report.sourceFiles.keep.bytes++; f.writer.save()
    assert.equal(read(f).binding.sourceFiles.keep.bytes, f.report.sourceFiles.keep.bytes)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.throws(() => readFullAppEvidence(f.filename), /owner differs/)
  } finally { JSON.parse = nativeParse; f?.cleanup() }
})

test('a parse accessor is invoked once per original normalization, without extra guard reads', () => {
  const before = Object.getOwnPropertyDescriptor(JSON, 'parse'); let reads = 0, calls = 0, f
  try {
    Object.defineProperty(JSON, 'parse', { configurable: true, get() { reads++; return function (text) { calls++; assert.equal(this, JSON); return nativeParse(text) } } })
    f = fixture({ warm: false }); assert.equal(reads, 1); assert.equal(calls, 1)
    f.writer.save(); assert.equal(reads, 2); assert.equal(calls, 2)
    f.writer.save(); assert.equal(reads, 3); assert.equal(calls, 3)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
  } finally { Object.defineProperty(JSON, 'parse', before); f?.cleanup() }
})

test('normalization captures parse before stringify and keeps both original receivers when a toJSON replaces global JSON', () => {
  const originalJSON = JSON; let parseCalls = 0, lateCalls = 0, stringifyCalls = 0, f
  try {
    originalJSON.parse = function (text) { parseCalls++; assert.equal(this, originalJSON); return nativeParse(text) }
    originalJSON.stringify = function (value) { stringifyCalls++; assert.equal(this, originalJSON); return nativeStringify(value) }
    f = fixture({ warm: false, beforeWriter(value) {
      value.runner.toJSON = function () {
        globalThis.JSON = { parse() { lateCalls++; throw Error('late parse must not run') }, stringify: nativeStringify }
        return { runID: this.runID, attempt: this.attempt }
      }
    } })
    assert.equal(parseCalls, 1); assert.equal(lateCalls, 0); assert.equal(stringifyCalls, 1)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
  } finally { globalThis.JSON = originalJSON; originalJSON.parse = nativeParse; originalJSON.stringify = nativeStringify; f?.cleanup() }
})

test('identity getters keep their original initial double read and every later active read', () => {
  const f = fixture({ warm: false }); let calls = 0
  try {
    const next = scene(0); next.rawSamples = []
    Object.defineProperty(next, 'group', { enumerable: true, configurable: true, get() { calls++; return 'settings' } })
    f.report.fullAppUi.scenes.push(next); f.writer.save(); assert.equal(calls, 3)
    f.writer.save(); assert.equal(calls, 5)
    f.writer.sealScene(next); assert.equal(calls, 8)
    f.writer.save(); assert.equal(calls, 8); roundtrip(f)
  } finally { f.cleanup() }
})

test('current source getters and own toJSON retain their original calls and JSON-domain key-order compatibility', () => {
  let groupReads = 0, runnerCalls = 0
  const f = fixture({ warm: false, beforeWriter(value) {
    Object.defineProperty(value, 'group', { enumerable: true, configurable: true, get() { groupReads++; return 'settings' } })
    const runner = value.runner
    Object.defineProperty(runner, 'toJSON', { configurable: true, value() { runnerCalls++; assert.equal(this, runner); return { attempt: this.attempt, runID: this.runID } } })
  } })
  try {
    assert.equal(groupReads, 1); assert.equal(runnerCalls, 1)
    f.writer.save(); assert.equal(groupReads, 3); assert.equal(runnerCalls, 3)
    f.writer.save(); assert.equal(groupReads, 5); assert.equal(runnerCalls, 5)
    const previous = readFileSync(f.filename); f.report.runner.attempt = 'foreign'
    assert.throws(() => f.writer.save(), /source\/run binding/); assert.deepEqual(readFileSync(f.filename), previous)
  } finally { f.cleanup() }
})

for (const mode of ['wrapper', 'proxy']) test('a pre-import application ' + mode + ' cannot become a new JSON observation or mutation path', async () => {
  let f, observed = 0
  const observe = (target, receiver, args) => {
    if (target === nativeParse || target === nativeStringify) observed++
    return nativeApply(target, receiver, args)
  }
  try {
    Reflect.apply = mode === 'wrapper' ? function (target, receiver, args) { return observe(target, receiver, args) }
      : new Proxy(nativeApply, { apply(_target, _receiver, args) { return observe(...args) } })
    const isolated = await import(new URL('./full-app-ui-storage.mjs?application-preimport-' + mode, import.meta.url))
    f = fixture({ warm: false, createWriter: isolated.createFullAppEvidenceWriter }); f.writer.save()
    assert.equal(observed, 0, 'The original JSON call never used a caller-controlled application helper')
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    Reflect.apply = nativeApply
    f.writer.save(); assert.deepEqual(json(isolated.readFullAppEvidence(f.filename).report), json(f.report))
  } finally { Reflect.apply = nativeApply; f?.cleanup() }
})

test('a native Function.prototype.apply replacement keeps the original JSON call instead of using the wrong native signature', async () => {
  let f
  try {
    Reflect.apply = Function.prototype.apply
    const isolated = await import(new URL('./full-app-ui-storage.mjs?application-wrong-native', import.meta.url))
    f = fixture({ warm: false, createWriter: isolated.createFullAppEvidenceWriter }); f.writer.save()
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    Reflect.apply = nativeApply
    assert.deepEqual(json(isolated.readFullAppEvidence(f.filename).report), json(f.report))
  } finally { Reflect.apply = nativeApply; f?.cleanup() }
})

test('a native stringify member accessor keeps the actual original per-stage call trace and opts out of new aggregates', () => {
  const descriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify'), phases = Object.create(null)
  let phase = 'constructor', f
  Object.defineProperty(JSON, 'stringify', { configurable: true, enumerable: true, get() { phases[phase] = (phases[phase] || 0) + 1; return nativeStringify } })
  try {
    f = fixture({ warm: false, beforeWriter(value) { const current = scene(0); current.rawSamples = []; value.fullAppUi.scenes.push(current) } })
    phase = 'first-save'; f.writer.save()
    phase = 'seal-scene'; f.writer.sealScene(f.report.fullAppUi.scenes[0])
    const image = { file: 'retained.png', bytes: 123, detail: { value: 'original' } }; f.report.screenshots.push(image)
    phase = 'publish-screenshot'; f.writer.save()
    phase = 'seal-screenshot'; assert.equal(f.writer.sealStableJSON('screenshots', image), true)
    phase = 'warm-save-1'; f.writer.save()
    phase = 'warm-save-2'; f.writer.save()
    assert.deepEqual({ ...phases }, { constructor: 6, 'first-save': 62, 'seal-scene': 63, 'publish-screenshot': 58, 'seal-screenshot': 1, 'warm-save-1': 57, 'warm-save-2': 57 })
    assert.equal(f.writer.statistics().stableJSON.aggregateArrayEncodes, 0)
    assert.equal(f.writer.statistics().stableJSON.scenePrefixEncodes, 0)
  } finally { Object.defineProperty(JSON, 'stringify', descriptor); f?.cleanup() }
})
