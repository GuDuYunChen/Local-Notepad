// Storage and exact producer-boundary contracts only. The producer snippets
// below are copied from the actual module at runtime; they do not simulate or
// claim the complete installed offline UI workflow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createFullAppEvidenceWriter, readFullAppEvidence } from './full-app-ui-storage.mjs'

const nativeParse = JSON.parse, nativeStringify = JSON.stringify
const clone = value => nativeParse(nativeStringify(value))
const load = f => nativeParse(readFileSync(f.filename, 'utf8'))
function scene() {
  return { group: 'settings', routeId: 'hot-metadata', stateId: 'ordinary', theme: 'light', viewport: { width: 704, height: 455 },
    complete: false, geometry: { valid: true, failures: [] }, diagnostic: { value: 'first', rows: [{ label: '保留值', count: 1 }] }, rawSamples: [] }
}
function report() {
  return { productCommit: '1'.repeat(40), productTree: '2'.repeat(40), verifierCommit: '3'.repeat(40), group: 'settings',
    runner: { runID: 'hotpaths-contract', attempt: '1' }, sourceFiles: {}, startedAt: '2026-11-16T00:00:00.000Z',
    complete: false, screenshots: [], fullAppUi: { complete: false, scenes: [scene()], focus: [], popups: [], optionPointerPreparations: [], offlineSettings: [] } }
}
function fixture(createWriter = createFullAppEvidenceWriter) {
  const directory = mkdtempSync(path.join(tmpdir(), 'notepad-hotpaths-')), filename = path.join(directory, 'report.json'), value = report()
  try {
    const writer = createWriter(filename, value, { storageVersion: 2 })
    return { directory, filename, report: value, writer, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
}
function roundtrip(f) { assert.deepEqual(clone(readFullAppEvidence(f.filename).report), clone(f.report)) }
function metric(f, name) { return f.writer.statistics().stableJSON[name] ?? 0 }
const producerSource = readFileSync(new URL('./full-app-ui-offline-settings.mjs', import.meta.url), 'utf8')
function createActualProducerEvidence(matrix, fixture) {
  const start = producerSource.indexOf('  const evidence = { ...matrix,')
  const end = producerSource.indexOf('  ;(report.fullAppUi.offlineSettings ||= []).push(evidence); save()', start)
  assert.ok(start >= 0 && end > start, 'Actual producer construction anchors must remain exact')
  return new Function('matrix', 'fixture', producerSource.slice(start, end) + '\nreturn evidence')(matrix, fixture)
}
function finishActualProducerEvidence(ctx, evidence) {
  const start = producerSource.lastIndexOf('  evidence.complete = true; evidence.settingsUnchanged = true; evidence.liveHistoryUnchanged = true; evidence.clockPreferenceUnchanged = true; save()')
  const end = producerSource.lastIndexOf('\n}')
  assert.ok(start >= 0 && end > start, 'Actual producer final success block must remain exact')
  return new Function('ctx', 'evidence', 'save', 'matrix', 'setup', 'fixture', 'report', producerSource.slice(start, end))(
    ctx, evidence, ctx.save, ctx.matrix, ctx.setup, ctx.setup.offlineSettings, ctx.report)
}
function producerContext(f, save = () => f.writer.save(), evidenceStore = f.writer) {
  const matrix = { theme: 'light', viewport: { width: 704, height: 455 } }
  const offlineSettings = { scope: 'owned-synthetic-offline-files-only', files: { history: { name: 'history.json', bytes: 10 } } }
  return { matrix, setup: { offlineSettings }, report: f.report, save, evidenceStore }
}

test('each active save qualifies its own fresh native parse graph without retaining mutable metadata', () => {
  const f = fixture()
  try {
    f.writer.save(); f.report.fullAppUi.scenes[0].diagnostic.value = 'second'; f.writer.save(); roundtrip(f)
    assert.equal(metric(f, 'activeMetadataCandidates'), 2)
    assert.equal(metric(f, 'activeMetadataTrusted'), 2)
    assert.equal(metric(f, 'activeMetadataQualificationHits'), 2)
    assert.equal(load(f).scenes[0].value.metadata.diagnostic.value, 'second')
    assert.equal(load(f).storageVersion, 2); assert.equal(f.writer.statistics().saves, 2)
  } finally { f.cleanup() }
})

test('the private graph proof preserves every original nested getter and own toJSON call', () => {
  const f = fixture(); let getterCalls = 0, toJSONCalls = 0
  try {
    const value = { marker: 'actual source', toJSON() { toJSONCalls++; assert.equal(this, value); return { marker: this.marker, output: 7 } } }
    Object.defineProperty(f.report.fullAppUi.scenes[0], 'observed', { enumerable: true, configurable: true, get() { getterCalls++; return value } })
    f.writer.save(); f.writer.save()
    assert.equal(getterCalls, 2); assert.equal(toJSONCalls, 2)
    assert.deepEqual(load(f).scenes[0].value.metadata.observed, { marker: 'actual source', output: 7 })
  } finally { f.cleanup() }
})

test('a failed atomic save discards its private graph and the next save normalizes the changed live value again', () => {
  const f = fixture()
  try {
    f.writer.save(); const before = readFileSync(f.filename), saves = f.writer.statistics().saves
    f.report.fullAppUi.scenes[0].diagnostic.value = 'failed-value'
    writeFileSync(f.filename + '.next', 'foreign', { flag: 'wx' })
    assert.throws(() => f.writer.save(), /EEXIST/); assert.deepEqual(readFileSync(f.filename), before); assert.equal(f.writer.statistics().saves, saves)
    unlinkSync(f.filename + '.next'); f.report.fullAppUi.scenes[0].diagnostic.value = 'actual-retry'; f.writer.save()
    assert.equal(load(f).scenes[0].value.metadata.diagnostic.value, 'actual-retry'); roundtrip(f)
    assert.equal(metric(f, 'activeMetadataCandidates'), 3); assert.equal(metric(f, 'activeMetadataTrusted'), 3)
  } finally { f.cleanup() }
})

test('a throwing normalization preserves the prior checkpoint without registering a partial metadata graph', () => {
  const f = fixture()
  try {
    f.writer.save(); const before = readFileSync(f.filename), candidates = metric(f, 'activeMetadataCandidates')
    f.report.fullAppUi.scenes[0].diagnostic.toJSON = () => { throw Error('original normalization failure') }
    assert.throws(() => f.writer.save(), /original normalization failure/); assert.deepEqual(readFileSync(f.filename), before)
    assert.equal(metric(f, 'activeMetadataCandidates'), candidates)
    delete f.report.fullAppUi.scenes[0].diagnostic.toJSON; f.writer.save(); roundtrip(f)
  } finally { f.cleanup() }
})

test('nonfunction toJSON on the parsed graph retains the original whole native fallback', () => {
  const f = fixture()
  try {
    f.report.fullAppUi.scenes[0].diagnostic.toJSON = null; f.writer.save()
    assert.equal(load(f).storageVersion, 1); assert.equal(metric(f, 'activeMetadataTrusted'), 0); roundtrip(f)
  } finally { f.cleanup() }
})

for (const [name, text] of [['literal word', 'toJSON is ordinary retained text'], ['escaped Unicode', '\ud800']]) test('a conservative metadata proof opt-out for ' + name + ' does not force native v1', () => {
  const f = fixture()
  try {
    f.report.fullAppUi.scenes[0].diagnostic.value = text; f.writer.save()
    assert.equal(load(f).storageVersion, 2); assert.equal(metric(f, 'activeMetadataTrusted'), 0)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, false); roundtrip(f)
  } finally { f.cleanup() }
})

test('proxy integer-key order is normalized by the original parse and later whole-slot stringify', () => {
  const f = fixture(); let ownKeys = 0
  try {
    f.report.fullAppUi.scenes[0].diagnostic = new Proxy({ 1: 'one', 2: 'two' }, { ownKeys() { ownKeys++; return ['2', '1'] } })
    f.writer.save(); assert.equal(ownKeys, 1)
    assert.deepEqual(Object.keys(load(f).scenes[0].value.metadata.diagnostic), ['1', '2'])
    assert.ok(readFileSync(f.filename, 'utf8').includes('"diagnostic":{"1":"one","2":"two"}'))
  } finally { f.cleanup() }
})

for (const [literal, expected] of [['1e2', 100], ['1.0', 1], ['"\\u0061"', 'a']]) test('native raw JSON ' + literal + ' retains the original canonical parsed value', () => {
  const f = fixture()
  try {
    assert.equal(typeof JSON.rawJSON, 'function', 'This explicit runtime contract requires native rawJSON')
    f.report.fullAppUi.scenes[0].diagnostic = { retained: JSON.rawJSON(literal) }; f.writer.save()
    assert.deepEqual(load(f).scenes[0].value.metadata.diagnostic, { retained: expected })
    assert.ok(readFileSync(f.filename, 'utf8').includes('"diagnostic":' + nativeStringify({ retained: expected })))
  } finally { f.cleanup() }
})

test('an observing parse result is never treated as an unescaped current private graph', () => {
  const f = fixture(); let escaped
  try {
    JSON.parse = function (text) { const value = nativeParse(text); if (value?.routeId === 'hot-metadata' && value.diagnostic) escaped = value; return value }
    try { f.writer.save() } finally { JSON.parse = nativeParse }
    assert.ok(escaped); assert.equal(metric(f, 'activeMetadataTrusted'), 0)
    escaped.diagnostic.value = 'escaped mutation'; f.writer.save()
    assert.equal(load(f).scenes[0].value.metadata.diagnostic.value, 'first')
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
  } finally { JSON.parse = nativeParse; f.cleanup() }
})

test('a native parse from another realm retains the original foreign-prototype fallback', async () => {
  let f
  try {
    JSON.parse = runInNewContext('JSON.parse')
    const storage = await import(new URL('./full-app-ui-storage.mjs?hotpaths-foreign-parse', import.meta.url))
    f = fixture(storage.createFullAppEvidenceWriter); f.writer.save()
    JSON.parse = nativeParse
    assert.equal(load(f).storageVersion, 1); assert.equal(metric(f, 'activeMetadataTrusted'), 0)
    assert.deepEqual(clone(storage.readFullAppEvidence(f.filename).report), clone(f.report))
  } finally { JSON.parse = nativeParse; f?.cleanup() }
})

test('sealScene outside a save does not grant a later active object the earlier private graph proof', () => {
  const f = fixture()
  try {
    const first = f.report.fullAppUi.scenes[0]; f.writer.save(); first.complete = true; f.writer.sealScene(first)
    const candidates = metric(f, 'activeMetadataCandidates')
    assert.equal(candidates, 1, 'Sealing its part and the following sealed-only checkpoint have no active metadata candidate')
    const second = scene(); second.routeId = 'next-active'; second.diagnostic.value = 'fresh next scene'; f.report.fullAppUi.scenes.push(second); f.writer.save()
    assert.equal(metric(f, 'activeMetadataCandidates'), candidates + 1); roundtrip(f)
  } finally { f.cleanup() }
})

test('complete offline records reuse inline bytes while v2 retains exactly its original three part collections', () => {
  const f = fixture()
  try {
    const records = [0, 1].map(index => ({ complete: true, index, viewport: { width: 704, height: 455 }, historyPages: [{ retained: index }] }))
    f.report.fullAppUi.offlineSettings.push(...records); f.writer.save()
    for (const record of records) assert.equal(f.writer.sealStableJSON('fullAppUi.offlineSettings', record), true)
    const before = metric(f, 'offlineSettingsCachedHits'); f.writer.save(); f.writer.save()
    assert.equal(metric(f, 'offlineSettingsCachedHits') - before, 4)
    assert.deepEqual(load(f).stableReceipts.collections.map(value => value.path), ['fullAppUi.focus', 'fullAppUi.popups', 'fullAppUi.optionPointerPreparations'])
    assert.deepEqual(load(f).body.fullAppUi.offlineSettings, clone(records)); roundtrip(f)
    f.report.fullAppUi.offlineSettings.reverse(); f.writer.save(); roundtrip(f)
    f.report.fullAppUi.offlineSettings[0] = { complete: false, mutable: { count: 1 } }; f.writer.save()
    f.report.fullAppUi.offlineSettings[0].mutable.count++; f.writer.save(); roundtrip(f)
  } finally { f.cleanup() }
})

test('the actual producer creates an owned viewport without freezing or changing its original external owner', () => {
  const f = fixture()
  try {
    const ctx = producerContext(f), evidence = createActualProducerEvidence(ctx.matrix, ctx.setup.offlineSettings)
    assert.notEqual(evidence.viewport, ctx.matrix.viewport); assert.deepEqual(evidence.viewport, ctx.matrix.viewport)
    assert.deepEqual(Object.keys(evidence).slice(0, 2), ['theme', 'viewport'])
    f.report.fullAppUi.offlineSettings.push(evidence); finishActualProducerEvidence(ctx, evidence)
    assert.equal(Object.isFrozen(evidence), true); assert.equal(Object.isFrozen(evidence.viewport), true)
    for (const owner of [ctx, ctx.matrix, ctx.matrix.viewport, ctx.setup, ctx.setup.offlineSettings, ctx.setup.offlineSettings.files]) assert.equal(Object.isFrozen(owner), false)
    ctx.matrix.viewport.width = 1280; assert.equal(evidence.viewport.width, 704); roundtrip(f)
  } finally { f.cleanup() }
})

test('the actual final producer block seals only after its original successful save, with all terminal fields', () => {
  const f = fixture(); const calls = []
  try {
    let ctx
    const store = { sealStableJSON(collection, value, options) { assert.equal(this, store); calls.push('seal'); assert.equal(collection, 'fullAppUi.offlineSettings'); assert.equal(value.complete, true); for (const key of ['settingsUnchanged', 'liveHistoryUnchanged', 'clockPreferenceUnchanged']) assert.equal(value[key], true); for (const owner of [ctx, ctx.matrix, ctx.matrix.viewport, ctx.setup, ctx.setup.offlineSettings, ctx.setup.offlineSettings.files]) assert.ok(options.protectedObjects.includes(owner)); return false } }
    ctx = producerContext(f, () => { calls.push('save') }, store)
    finishActualProducerEvidence(ctx, createActualProducerEvidence(ctx.matrix, ctx.setup.offlineSettings))
    assert.deepEqual(calls, ['save', 'seal'])
  } finally { f.cleanup() }
})

test('the actual final producer block never seals after the original save throws', () => {
  const f = fixture(); let seals = 0; const failure = Error('original save refused')
  try {
    const ctx = producerContext(f, () => { throw failure }, { sealStableJSON() { seals++; return true } })
    const evidence = createActualProducerEvidence(ctx.matrix, ctx.setup.offlineSettings)
    assert.throws(() => finishActualProducerEvidence(ctx, evidence), error => error === failure)
    assert.equal(seals, 0); assert.equal(Object.isFrozen(evidence), false); assert.equal(Object.isFrozen(ctx.matrix.viewport), false)
  } finally { f.cleanup() }
})

test('a completed producer record that aliases a protected fixture file is refused without freezing any active owner', () => {
  const f = fixture()
  try {
    const ctx = producerContext(f), evidence = createActualProducerEvidence(ctx.matrix, ctx.setup.offlineSettings)
    evidence.foreignOwner = ctx.setup.offlineSettings.files.history; f.report.fullAppUi.offlineSettings.push(evidence)
    assert.throws(() => finishActualProducerEvidence(ctx, evidence), /active external owner/)
    assert.equal(Object.isFrozen(evidence), false); assert.equal(Object.isFrozen(evidence.foreignOwner), false)
    assert.equal(Object.isFrozen(ctx.setup.offlineSettings.files), false); roundtrip(f)
  } finally { f.cleanup() }
})

test('offline native-returning stringify accessors keep the actual original 64-read save trace', () => {
  const f = fixture(), descriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify'); let reads = 0
  try {
    f.report.fullAppUi.offlineSettings.push({ id: 'offline-a', complete: true }, { id: 'offline-b', complete: true })
    Object.defineProperty(JSON, 'stringify', { configurable: true, enumerable: true, get() { reads++; return nativeStringify } })
    try { f.writer.save() } finally { Object.defineProperty(JSON, 'stringify', descriptor) }
    assert.equal(reads, 64); assert.equal(load(f).storageVersion, 2); roundtrip(f)
  } finally { Object.defineProperty(JSON, 'stringify', descriptor); f.cleanup() }
})

test('offline stringify wrappers retain the original collection argument and its actual returned JSON', () => {
  const f = fixture(), calls = []
  try {
    f.report.fullAppUi.offlineSettings.push({ id: 'offline-a', complete: true }, { id: 'offline-b', complete: true })
    JSON.stringify = function (value, ...rest) {
      if (value && typeof value === 'object' && Object.keys(value).length === 1 && Object.hasOwn(value, 'offlineSettings')) {
        calls.push('collection')
        return nativeStringify({ offlineSettings: value.offlineSettings.map(item => ({ ...item, wrapperObserved: true })) }, ...rest)
      }
      if (value?.id?.startsWith('offline-')) calls.push('item:' + value.id)
      if (value === 'offlineSettings') calls.push('key')
      return nativeStringify(value, ...rest)
    }
    try { f.writer.save() } finally { JSON.stringify = nativeStringify }
    assert.deepEqual(calls, ['collection'])
    assert.deepEqual(load(f).body.fullAppUi.offlineSettings, f.report.fullAppUi.offlineSettings.map(item => ({ ...item, wrapperObserved: true })))
    assert.equal(load(f).storageVersion, 2)
  } finally { JSON.stringify = nativeStringify; f.cleanup() }
})

test('offline sealing with a stringify accessor opts out before publication assertions or any freeze', () => {
  const f = fixture(), descriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify')
  try {
    const record = { id: 'offline-a', complete: true }; f.report.fullAppUi.offlineSettings.push(record)
    Object.defineProperty(JSON, 'stringify', { configurable: true, enumerable: true, get() { return nativeStringify } })
    f.writer.save(); const before = readFileSync(f.filename), saves = f.writer.statistics().saves
    assert.equal(f.writer.sealStableJSON('fullAppUi.offlineSettings', record), false)
    assert.equal(Object.isFrozen(record), false); assert.deepEqual(readFileSync(f.filename), before); assert.equal(f.writer.statistics().saves, saves)
  } finally { Object.defineProperty(JSON, 'stringify', descriptor); f.cleanup() }
})
