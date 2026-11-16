// Synthetic storage contracts only. These do not execute an installed page,
// change a readiness threshold, or establish a Windows timing result.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFullAppEvidenceWriter, readFullAppEvidence } from './full-app-ui-storage.mjs'

const originalStringify = JSON.stringify
const copy = value => JSON.parse(originalStringify(value))
const manifest = fixture => JSON.parse(readFileSync(fixture.filename, 'utf8'))
function report() {
  return { productCommit: '1'.repeat(40), productTree: '2'.repeat(40), verifierCommit: '3'.repeat(40),
    group: 'settings', runner: { runID: 'private-cache-contract', attempt: '1' },
    sourceFiles: { keep: { bytes: 12, sha256: '4'.repeat(64) } }, startedAt: '2026-11-16T00:00:00.000Z',
    complete: false, screenshots: [], fullAppUi: { complete: false, scenes: [], focus: [], popups: [], optionPointerPreparations: [] } }
}
function scene(index) {
  return { group: 'settings', routeId: 'cache-' + index, stateId: 'ordinary', theme: 'light',
    viewport: { width: 704, height: 455 }, complete: true, geometry: { valid: true, failures: [] },
    rawSamples: [{ phase: 'before-capture', image: 'scene-' + index + '.png', observation: { keep: '真实字节', index } }] }
}
function fixture({ warm = true, beforeWriter = () => {}, createWriter = createFullAppEvidenceWriter } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'notepad-private-descriptor-'))
  const value = report(), filename = path.join(directory, 'full-app-ui-installed.json')
  beforeWriter(value)
  const writer = createWriter(filename, value, { storageVersion: 2 })
  const result = { directory, filename, report: value, writer,
    cleanup: () => rmSync(directory, { recursive: true, force: true }) }
  if (warm) {
    value.fullAppUi.scenes.push(scene(0)); writer.save(); writer.sealScene(value.fullAppUi.scenes[0])
    for (const key of ['focus', 'popups', 'optionPointerPreparations']) {
      const receipt = { name: key, nested: { keep: '独立回执', count: 1 } }
      value.fullAppUi[key].push(receipt); writer.save()
      assert.equal(writer.sealStableJSON('fullAppUi.' + key, receipt), true)
    }
    writer.save(); writer.save()
  }
  return result
}
function roundtrip(fixture) {
  const loaded = readFullAppEvidence(fixture.filename)
  assert.deepEqual(copy(loaded.report), copy(fixture.report))
  return loaded
}
function withObjectHook(hook, callback) {
  const before = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
  assert.equal(before, undefined)
  Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value: hook })
  try { return callback() } finally {
    if (before) Object.defineProperty(Object.prototype, 'toJSON', before)
    else delete Object.prototype.toJSON
  }
}

test('private descriptors reuse bytes while every checkpoint and mutable JSON value stays current', () => {
  const f = fixture()
  try {
    roundtrip(f)
    const before = f.writer.statistics(), checkpoint = manifest(f).checkpoint
    f.report.mutableDiagnostic = { value: 1 }; f.writer.save()
    f.report.mutableDiagnostic.value = 2; f.writer.save()
    const after = f.writer.statistics()
    assert.equal(after.saves, before.saves + 2); assert.equal(manifest(f).checkpoint, checkpoint + 2)
    assert.equal(after.stableJSON.privateDescriptorEncodes, before.stableJSON.privateDescriptorEncodes)
    assert.ok(after.stableJSON.privateDescriptorHits > before.stableJSON.privateDescriptorHits)
    assert.ok(after.stableJSON.eligibleArrayReuses > before.stableJSON.eligibleArrayReuses)
    assert.equal(after.stableJSON.privateCacheDisabled, false)
    assert.equal(roundtrip(f).report.mutableDiagnostic.value, 2)
    const first = f.report.fullAppUi.focus[0]
    f.report.fullAppUi.focus = [first, first]; f.writer.save()
    let entries = manifest(f).stableReceipts.collections[0].entries
    assert.equal(entries.length, 2); assert.notEqual(entries[0].ref.file, entries[1].ref.file)
    assert.deepEqual(entries.map(item => item.ref.context.ordinal), [0, 1])
    roundtrip(f)
    f.report.fullAppUi.focus.reverse(); f.report.fullAppUi.focus.pop(); f.writer.save(); roundtrip(f)
    f.report.fullAppUi.popups.unshift(first); f.writer.save(); roundtrip(f)
    entries = manifest(f).stableReceipts.collections[1].entries
    assert.equal(entries[0].ref.context.collection, 'fullAppUi.popups')
    assert.equal(entries[0].ref.context.ordinal, 0)
    f.report.fullAppUi.focus = { length: 9, retained: 'non-array' }; f.writer.save(); roundtrip(f)
    assert.deepEqual(manifest(f).body.fullAppUi.focus, { length: 9, retained: 'non-array' })
  } finally { f.cleanup() }
})

for (const [name, mutate, inspect, refusal] of [
  ['scene envelope', value => { value.rawCount++ }, value => value.rawCount, /raw sample tail/],
  ['scene keys', value => { value.keys.push('retained-hook-key') }, value => value.keys.at(-1), /fields were omitted or reordered/],
  ['scene part reference', value => { value.part.bytes++ }, value => value.part.bytes, /truncated or extended/],
]) test('a removed global JSON hook cannot revive stale cached ' + name, () => {
  const f = fixture(); let escaped
  try {
    withObjectHook(function () {
      if (this.state === 'sealed' && this.part?.kind === 'scene') escaped = this
      return this
    }, () => f.writer.save())
    assert.ok(escaped); assert.equal(Object.isFrozen(escaped), false)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    const before = f.writer.statistics().stableJSON.privateDescriptorHits
    mutate(escaped); const changed = inspect(escaped); f.writer.save()
    assert.equal(inspect(manifest(f).scenes[0]), changed)
    assert.equal(f.writer.statistics().stableJSON.privateDescriptorHits, before)
    assert.throws(() => readFullAppEvidence(f.filename), refusal)
  } finally { f.cleanup() }
})

test('a throwing JSON hook leaves prior bytes and permanently taints its retained private descriptor', () => {
  const f = fixture(); let escaped
  try {
    const preceding = readFileSync(f.filename), saves = f.writer.statistics().saves
    withObjectHook(function () {
      if (this.state === 'sealed' && this.part?.kind === 'scene') { escaped = this; throw Error('retain then refuse') }
      return this
    }, () => assert.throws(() => f.writer.save(), /retain then refuse/))
    assert.ok(escaped); assert.equal(f.writer.statistics().saves, saves)
    assert.deepEqual(readFileSync(f.filename), preceding)
    escaped.rawCount++; f.writer.save()
    assert.equal(manifest(f).scenes[0].rawCount, escaped.rawCount)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.throws(() => readFullAppEvidence(f.filename), /raw sample tail/)
  } finally { f.cleanup() }
})

test('a removed Array prototype hook cannot hide changes to a retained sealed key array', () => {
  const f = fixture(); let escaped
  const before = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')
  try {
    assert.equal(before, undefined)
    Object.defineProperty(Array.prototype, 'toJSON', { configurable: true, value: function () {
      if (this.includes('rawSamples') && this.includes('geometry')) escaped = this
      return this
    } })
    try { f.writer.save() } finally { delete Array.prototype.toJSON }
    assert.ok(escaped); assert.equal(Object.isFrozen(escaped), false)
    escaped.push('retained-array-hook-key'); f.writer.save()
    assert.equal(manifest(f).scenes[0].keys.at(-1), 'retained-array-hook-key')
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.throws(() => readFullAppEvidence(f.filename), /fields were omitted or reordered/)
  } finally {
    if (before) Object.defineProperty(Array.prototype, 'toJSON', before)
    else delete Array.prototype.toJSON
    f.cleanup()
  }
})

test('part context exposure before manifest qualification permanently disables private descriptor caching', () => {
  const f = fixture(); let escaped
  try {
    const next = scene(1); next.rawSamples = []; f.report.fullAppUi.scenes.push(next)
    withObjectHook(function () {
      if (this.kind === 'scene' && this.format?.endsWith('-part')) {
        escaped = this.context
        delete Object.prototype.toJSON
      }
      return this
    }, () => f.writer.sealScene(next))
    assert.ok(escaped); assert.equal(Object.isFrozen(escaped), false)
    roundtrip(f)
    escaped.retainedAfterHookRemoval = true; f.writer.save()
    assert.equal(manifest(f).scenes[1].part.context.retainedAfterHookRemoval, true)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.throws(() => readFullAppEvidence(f.filename), /source context differs/)
  } finally { f.cleanup() }
})

test('constructor owner encoding cannot silently freeze or trust a binding exposed to a self-removing hook', () => {
  let f, escaped
  try {
    withObjectHook(function () {
      if (this.storeID && this.binding && !this.format) {
        escaped = this.binding; delete Object.prototype.toJSON
      }
      return this
    }, () => { f = fixture({ warm: false }) })
    assert.ok(escaped); assert.equal(Object.isFrozen(escaped), false)
    f.writer.save(); const preceding = readFileSync(f.filename)
    escaped.group = 'foreign-retained-binding'
    assert.throws(() => f.writer.save(), /source\/run binding/)
    assert.deepEqual(readFileSync(f.filename), preceding)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
  } finally { f?.cleanup() }
})

test('an own source JSON protocol that installs a self-removing owner hook cannot create a stale binding cache', () => {
  let f, escaped
  try {
    f = fixture({ warm: false, beforeWriter(value) {
      Object.defineProperty(value.sourceFiles, 'toJSON', { configurable: true, value: function () {
        delete this.toJSON
        Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value: function (key) {
          if (key === 'binding' && this.sourceFiles) {
            escaped = this; delete Object.prototype.toJSON
          }
          return this
        } })
        return this
      } })
    } })
    assert.ok(escaped); assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON'), undefined)
    assert.equal(Object.isFrozen(escaped), false); f.writer.save()
    // Keep the original binding assertion satisfied: a native hook retained and
    // changed its private copy as well as the caller's source value. Encoding
    // must still reflect the actual graph and let the reader reject its owner.
    escaped.sourceFiles.keep.bytes++; f.report.sourceFiles.keep.bytes++
    f.writer.save()
    assert.equal(manifest(f).binding.sourceFiles.keep.bytes, f.report.sourceFiles.keep.bytes)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.throws(() => readFullAppEvidence(f.filename), /owner differs/)
  } finally { delete Object.prototype.toJSON; f?.cleanup() }
})

test('an observing stringify wrapper cannot retain an envelope that later returns from the private cache', () => {
  const f = fixture(); let escapedScene, escapedStableRef, escapedEnvelope
  try {
    JSON.stringify = function (value, ...rest) {
      if (value?.scenes?.[0]?.state === 'sealed') escapedScene = value.scenes[0]
      if (value?.stableReceipts) {
        escapedEnvelope = value.stableReceipts
        escapedStableRef = value.stableReceipts.collections[0].entries[0].ref
      }
      return originalStringify(value, ...rest)
    }
    try { f.writer.save() } finally { JSON.stringify = originalStringify }
    assert.ok(escapedScene); assert.ok(escapedStableRef); assert.ok(escapedEnvelope)
    assert.equal(Object.isFrozen(escapedScene), false); assert.equal(Object.isFrozen(escapedEnvelope), false)
    escapedEnvelope.collections[0].entries[0].mode = 'discarded-wrapper-mutation'
    escapedStableRef.bytes++; f.writer.save()
    const current = manifest(f)
    assert.equal(current.stableReceipts.collections[0].entries[0].mode, 'part')
    assert.equal(current.stableReceipts.collections[0].entries[0].ref.bytes, escapedStableRef.bytes)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.throws(() => readFullAppEvidence(f.filename), /truncated or extended/)
  } finally { JSON.stringify = originalStringify; f.cleanup() }
})

for (const mode of ['wrapper', 'proxy']) test('a stringify ' + mode + ' installed before module import cannot qualify a retained binding for caching', async () => {
  let f, escaped
  const observe = value => {
    if (value?.storeID && value.binding && !value.format) escaped = value.binding
  }
  try {
    JSON.stringify = mode === 'wrapper' ? function (value, ...rest) {
      observe(value); return originalStringify(value, ...rest)
    } : new Proxy(originalStringify, { apply(target, receiver, args) {
      observe(args[0]); return Reflect.apply(target, receiver, args)
    } })
    const isolated = await import(new URL('./full-app-ui-storage.mjs?preimport-' + mode, import.meta.url))
    f = fixture({ warm: false, createWriter: isolated.createFullAppEvidenceWriter })
    assert.ok(escaped); assert.equal(Object.isFrozen(escaped), false); f.writer.save()
    escaped.sourceFiles.keep.bytes++; f.report.sourceFiles.keep.bytes++
    f.writer.save()
    assert.equal(manifest(f).binding.sourceFiles.keep.bytes, f.report.sourceFiles.keep.bytes)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.throws(() => isolated.readFullAppEvidence(f.filename), /owner differs/)
  } finally { JSON.stringify = originalStringify; f?.cleanup() }
})

test('complete receipt native comparison also taints a private scene retained by a temporary hook', () => {
  const f = fixture(); let escaped
  try {
    f.report.complete = true; f.report.fullAppUi.complete = true; f.writer.save()
    withObjectHook(function () {
      if (this.state === 'sealed' && this.part?.kind === 'scene') escaped = this
      return this
    }, () => assert.equal(f.writer.receipt().storageVersion, 2))
    assert.ok(escaped); assert.equal(Object.isFrozen(escaped), false)
    escaped.part.context.retainedAfterReceipt = true; f.writer.save()
    assert.equal(manifest(f).scenes[0].part.context.retainedAfterReceipt, true)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.throws(() => readFullAppEvidence(f.filename), /source context differs/)
  } finally { f.cleanup() }
})

test('a removed unsupported protocol never turns an earlier qualification into a cross-save array proof', () => {
  const f = fixture()
  try {
    f.report.observed = { toJSON() { return { originalProtocol: true } } }; f.writer.save()
    assert.equal(manifest(f).storageVersion, 1)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    delete f.report.observed
    const value = [{ keep: 'own' }]; f.report.screenshots = value; f.writer.save(); roundtrip(f)
    delete value[0]; f.writer.save(); roundtrip(f)
    assert.deepEqual(manifest(f).body.screenshots, [null])
    Object.defineProperty(value, '0', { enumerable: true, configurable: true, get() { return { keep: 'getter' } } })
    f.writer.save(); roundtrip(f)
    assert.deepEqual(manifest(f).body.screenshots, [{ keep: 'getter' }])
    Object.defineProperty(value, '0', { enumerable: true, configurable: true, writable: true, value: { keep: 'ordinary-again' } })
    f.writer.save(); roundtrip(f)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
  } finally { f.cleanup() }
})

test('warm private descriptors preserve failed-publication bytes and retry all new receipt ordinals', () => {
  const f = fixture()
  try {
    const value = { name: 'new', nested: { keep: 'new published object' } }
    f.report.fullAppUi.focus.push(value); f.writer.save()
    assert.equal(f.writer.sealStableJSON('fullAppUi.focus', value), true)
    const before = readFileSync(f.filename), saves = f.writer.statistics().saves
    mkdirSync(f.filename + '.next')
    assert.throws(() => f.writer.save(), /EEXIST/)
    assert.deepEqual(readFileSync(f.filename), before)
    assert.equal(f.writer.statistics().saves, saves)
    roundtrip(f)
    rmSync(f.filename + '.next', { recursive: true }); f.writer.save()
    assert.equal(f.writer.statistics().saves, saves + 1)
    const entries = manifest(f).stableReceipts.collections[0].entries
    assert.deepEqual(entries.map(item => item.mode), ['part', 'part'])
    assert.deepEqual(entries.map(item => item.ref.context.ordinal), [0, 1])
    roundtrip(f)
  } finally { f.cleanup() }
})
