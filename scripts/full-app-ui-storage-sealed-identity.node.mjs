// Storage-only regression contracts. Every write remains an atomic checkpoint;
// these cases do not run a native application or change its acceptance gates.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFullAppEvidenceWriter, readFullAppEvidence } from './full-app-ui-storage.mjs'

const parse = JSON.parse, stringify = JSON.stringify
const clone = value => parse(stringify(value))
function scene(index) {
  return { group: 'settings', routeId: 'sealed-identity-' + index, stateId: 'ordinary', theme: 'light',
    viewport: { width: 704, height: 455 }, complete: true, geometry: { valid: true, failures: [] },
    diagnostic: { value: 'original-' + index }, rawSamples: [{ phase: 'before-capture', image: 'part-' + index + '.png', text: '保留原始值' }] }
}
function fixture({ scenes = [scene(0), scene(1)], seal = true } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'notepad-sealed-identity-'))
  const filename = path.join(directory, 'report.json')
  const report = { productCommit: '1'.repeat(40), productTree: '2'.repeat(40), verifierCommit: '3'.repeat(40),
    group: 'settings', runner: { runID: 'sealed-identity-contract', attempt: '1' }, sourceFiles: {},
    startedAt: '2026-11-16T00:00:00.000Z', complete: false, screenshots: [],
    fullAppUi: { complete: false, scenes, focus: [], popups: [], optionPointerPreparations: [] } }
  try {
    const writer = createFullAppEvidenceWriter(filename, report, { storageVersion: 3 })
    writer.save()
    if (seal) for (const current of scenes) writer.sealScene(current)
    return { filename, report, writer, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
}
const manifest = f => parse(readFileSync(f.filename, 'utf8'))
const reuses = f => f.writer.statistics().sealedIdentityReuses ?? 0
const roundtrip = f => assert.deepEqual(clone(readFullAppEvidence(f.filename).report), clone(f.report))

test('frozen scene identities keep every mutable active value and atomic checkpoint exact', () => {
  const f = fixture()
  try {
    const active = scene(2); active.complete = false; f.report.fullAppUi.scenes.push(active)
    f.writer.save(); const checkpoint = manifest(f).checkpoint, before = reuses(f)
    for (const value of ['changed', '再次更改', 'final']) {
      active.diagnostic.value = value; f.report.live = { value }; f.writer.save(); roundtrip(f)
      assert.equal(readFullAppEvidence(f.filename).report.fullAppUi.scenes[2].diagnostic.value, value)
    }
    assert.equal(manifest(f).checkpoint, checkpoint + 3)
    assert.equal(f.writer.statistics().saves, checkpoint + 3)
    assert.equal(reuses(f) - before, 6)
    const bytes = readFileSync(f.filename)
    active.stateId = 'different'
    assert.throws(() => f.writer.save(), /scene identity changed/)
    assert.deepEqual(readFileSync(f.filename), bytes)
  } finally { f.cleanup() }
})

for (const [name, change] of [
  ['reverse', values => values.reverse()],
  ['replace with an equal object', values => { values[0] = clone(values[0]) }],
  ['remove the tail', values => values.pop()],
]) test('a warm frozen identity never accepts a current scene-array ' + name, () => {
  const f = fixture()
  try {
    f.writer.save(); const bytes = readFileSync(f.filename), checkpoint = manifest(f).checkpoint
    change(f.report.fullAppUi.scenes)
    assert.throws(() => f.writer.save())
    assert.deepEqual(readFileSync(f.filename), bytes)
    assert.equal(manifest(f).checkpoint, checkpoint)
  } finally { f.cleanup() }
})

test('a frozen proxy view still has its live identity observed and rejected when changed', () => {
  let spoof = false
  const proxy = new Proxy(scene(0), { get(target, key, receiver) {
    return spoof && key === 'stateId' ? 'foreign-proxy-state' : Reflect.get(target, key, receiver)
  } })
  const f = fixture({ scenes: [proxy] })
  try {
    assert.equal(Object.isFrozen(proxy), true); f.writer.save(); roundtrip(f)
    const bytes = readFileSync(f.filename), before = reuses(f)
    spoof = true
    assert.throws(() => f.writer.save(), /scene identity changed/)
    assert.deepEqual(readFileSync(f.filename), bytes); assert.equal(reuses(f), before)
  } finally { f.cleanup() }
})

test('a sealed view missing an own identity field retains the original inherited-field check', () => {
  const current = scene(0), prototype = { stateId: current.stateId }
  delete current.stateId; Object.setPrototypeOf(current, prototype)
  const f = fixture({ scenes: [current] })
  try {
    // This exotic source is not a valid reconstructed scene: its own metadata
    // omitted stateId. The fast path must not turn it into accepted evidence.
    assert.throws(() => readFullAppEvidence(f.filename), /another scene/)
    const bytes = readFileSync(f.filename)
    prototype.stateId = 'changed-inherited-state'
    assert.throws(() => f.writer.save(), /scene identity changed/)
    assert.deepEqual(readFileSync(f.filename), bytes); assert.equal(reuses(f), 0)
  } finally { f.cleanup() }
})

for (const accessor of [false, true]) test('a hidden own viewport ' + (accessor ? 'accessor' : 'object') + ' cannot bypass the original changed-identity refusal', () => {
  const current = scene(0), viewport = current.viewport
  Object.defineProperty(current, 'viewport', accessor
    ? { configurable: true, enumerable: false, get: () => viewport }
    : { configurable: true, enumerable: false, writable: true, value: viewport })
  const f = fixture({ scenes: [current] })
  try {
    assert.equal(Object.isFrozen(current), true); assert.equal(Object.isFrozen(viewport), false)
    assert.equal(Object.hasOwn(current, 'viewport'), true)
    assert.throws(() => readFullAppEvidence(f.filename), /another scene/)
    const bytes = readFileSync(f.filename)
    viewport.width = 800
    assert.throws(() => f.writer.save(), /scene identity changed/)
    assert.deepEqual(readFileSync(f.filename), bytes); assert.equal(reuses(f), 0)
  } finally { f.cleanup() }
})

for (const kind of ['prototype', 'stringify']) test('a late ' + kind + ' JSON protocol cannot hide changed frozen identity semantics', () => {
  const f = fixture(), descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
  let observedIdentities = 0
  const changed = value => {
    if (value && Object.hasOwn(value, 'index') && value.routeId === 'sealed-identity-0') {
      observedIdentities++; return { ...value, stateId: 'hook-changed-state' }
    }
    return value
  }
  try {
    f.writer.save(); const bytes = readFileSync(f.filename), before = reuses(f)
    if (kind === 'prototype') {
      assert.equal(descriptor, undefined)
      Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { return changed(this) } })
    } else JSON.stringify = function (value, ...args) { return stringify(changed(value), ...args) }
    assert.throws(() => f.writer.save(), /scene identity changed/)
    assert.equal(observedIdentities, 1); assert.equal(reuses(f), before)
    assert.deepEqual(readFileSync(f.filename), bytes)
  } finally {
    JSON.stringify = stringify
    if (descriptor) Object.defineProperty(Object.prototype, 'toJSON', descriptor)
    else delete Object.prototype.toJSON
    f.cleanup()
  }
})

test('a previously escaped parse identity never becomes trusted after the hook is removed', () => {
  const escaped = []; let f
  try {
    JSON.parse = function (text) {
      const value = parse(text)
      if (value && Object.hasOwn(value, 'index') && value.routeId === 'sealed-identity-0') escaped.push(value)
      return value
    }
    f = fixture({ scenes: [scene(0)] }); JSON.parse = parse
    assert.ok(escaped.length >= 2)
    const bytes = readFileSync(f.filename)
    escaped[0].stateId = 'changed-escaped-private-identity'
    assert.throws(() => f.writer.save(), /scene identity changed/)
    assert.deepEqual(readFileSync(f.filename), bytes); assert.equal(reuses(f), 0)
  } finally { JSON.parse = parse; f?.cleanup() }
})

test('failed seal publication leaves the original writable scene and cannot register frozen identity reuse', () => {
  const f = fixture({ scenes: [scene(0)], seal: false })
  try {
    const current = f.report.fullAppUi.scenes[0], bytes = readFileSync(f.filename), checkpoint = manifest(f).checkpoint
    writeFileSync(f.filename + '.next', 'unowned-staging-file', { flag: 'wx' })
    assert.throws(() => f.writer.sealScene(current), /EEXIST/)
    assert.equal(Object.isFrozen(current), false); assert.equal(reuses(f), 0)
    assert.deepEqual(readFileSync(f.filename), bytes); assert.equal(manifest(f).checkpoint, checkpoint)
    current.diagnostic.value = 'actual-followup-value'; unlinkSync(f.filename + '.next')
    f.writer.sealScene(current); f.writer.save(); roundtrip(f)
    assert.equal(readFullAppEvidence(f.filename).report.fullAppUi.scenes[0].diagnostic.value, 'actual-followup-value')
    assert.equal(manifest(f).checkpoint, checkpoint + 2); assert.equal(reuses(f), 1)
  } finally { f.cleanup() }
})
