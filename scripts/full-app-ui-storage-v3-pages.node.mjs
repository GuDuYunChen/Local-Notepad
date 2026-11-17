// Explicit v3 storage contracts only. All fixtures are synthetic; neither the
// real writer/reader calls nor the reused capture fixture claim Windows UI or
// timing acceptance. The original 100 + 15 + 28 + 22 contracts remain untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { runInNewContext } from 'node:vm'
import { createFullAppEvidenceWriter, readFullAppEvidence, fullAppEvidenceFingerprint } from './full-app-ui-storage.mjs'
import { FULL_APP_GROUPS, FULL_APP_MATRIX, validateFullAppUiEvidence } from './full-app-ui-evidence.mjs'
import { createFullAppUiShared, collectFullAppScrollOwners } from './full-app-ui-shared.mjs'

const nativeParse = JSON.parse, nativeStringify = JSON.stringify
const clone = value => nativeParse(nativeStringify(value))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const encode = value => Buffer.from(nativeStringify(value) + '\n')
const stablePaths = ['fullAppUi.focus', 'fullAppUi.popups', 'fullAppUi.optionPointerPreparations']
const roster = ['scenes', 'screenshots', ...stablePaths, 'fullAppUi.offlineSettings']
const read = f => nativeParse(fs.readFileSync(f.filename, 'utf8'))
const partPath = (f, ref) => path.join(f.directory, ...ref.file.split('/'))
const write = (f, manifest) => fs.writeFileSync(f.filename, encode(manifest))
function report() {
  return { productCommit: '1'.repeat(40), productTree: '2'.repeat(40), verifierCommit: '3'.repeat(40), group: 'settings',
    runner: { runID: 'explicit-v3-contract', attempt: '1' }, sourceFiles: { keep: { bytes: 12, sha256: '4'.repeat(64) } },
    startedAt: '2026-11-16T00:00:00.000Z', complete: false, screenshots: [],
    fullAppUi: { complete: false, scenes: [], focus: [], popups: [], optionPointerPreparations: [], offlineSettings: [], events: [] } }
}
function scene(index, complete = true) {
  return { group: 'settings', routeId: 'v3-scene-' + index, stateId: 'ordinary', theme: 'light', viewport: { width: 704, height: 455 },
    complete, geometry: { valid: true, failures: [] }, detail: { text: '保留元数据 ' + index, keys: { b: 2, a: 1 } },
    rawSamples: [{ phase: 'before-capture', image: 'v3-' + index + '.png', detail: { index, text: '原始观察' } }] }
}
function fixture({ version = 3, createWriter = createFullAppEvidenceWriter, beforeWriter = () => {} } = {}) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'notepad-index-pages-')), filename = path.join(directory, 'report.json'), value = report()
  beforeWriter(value)
  try {
    const writer = createWriter(filename, value, version === undefined ? undefined : { storageVersion: version })
    return { directory, filename, report: value, writer, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) }
  } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error }
}
function populate(f, { scenes = 0, shots = 0, stable = {}, offline = 0 } = {}) {
  for (let index = 0; index < scenes; index++) f.report.fullAppUi.scenes.push(scene(index))
  for (let index = 0; index < shots; index++) f.report.screenshots.push({ filename: 'synthetic-' + index + '.png', bytes: 100 + index,
    sha256: sha('synthetic image ' + index), detail: { index, text: '图像元数据', order: { z: 1, a: 2 } } })
  for (const collection of stablePaths) {
    const key = collection.slice('fullAppUi.'.length), count = typeof stable === 'number' ? stable : stable[key] || 0
    for (let index = 0; index < count; index++) f.report.fullAppUi[key].push({ collection, index, value: { text: '完整回执', z: index, a: true } })
  }
  for (let index = 0; index < offline; index++) f.report.fullAppUi.offlineSettings.push({ complete: true, index, rows: [{ name: '只读完成记录', b: 2, a: 1 }] })
  f.writer.save()
  for (const value of f.report.screenshots) assert.equal(f.writer.sealStableJSON('screenshots', value), true)
  for (const collection of [...stablePaths, 'fullAppUi.offlineSettings']) for (const value of f.report.fullAppUi[collection.slice('fullAppUi.'.length)]) {
    assert.equal(f.writer.sealStableJSON(collection, value), true)
  }
  for (const value of f.report.fullAppUi.scenes) f.writer.sealScene(value)
  f.writer.save()
  return f
}
function originalRelocation(value) {
  // This is the original v1/v2 public relocation rule, independently retained
  // in the old C01-C09 helper. Index pages must not introduce another order.
  const original = clone(value), result = {}
  for (const key of Object.keys(original)) if (key !== 'fullAppUi') result[key] = original[key]
  if (Object.hasOwn(original, 'fullAppUi')) {
    const ui = original.fullAppUi
    if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
      result.fullAppUi = {}
      for (const key of Object.keys(ui)) if (!['scenes', 'events'].includes(key)) result.fullAppUi[key] = ui[key]
      if (Object.hasOwn(ui, 'events') && !Array.isArray(ui.events)) result.fullAppUi.events = ui.events
      if (Object.hasOwn(ui, 'scenes')) result.fullAppUi.scenes = ui.scenes
      if (Array.isArray(ui.events)) result.fullAppUi.events = ui.events
    } else result.fullAppUi = ui
  }
  return result
}
function roundtrip(f) {
  const loaded = readFullAppEvidence(f.filename)
  assert.deepEqual(clone(loaded.report), clone(f.report))
  assert.equal(nativeStringify(loaded.report), nativeStringify(originalRelocation(f.report)), 'All recursive keys and the original relocation order must survive paging')
  return loaded
}
function pages(f, collection) { return read(f).indexPages.pages.filter(ref => ref.context.collection === collection) }
function complete(f) {
  f.report.fullAppUi.complete = f.report.complete = true; f.writer.save()
  return { complete: true, report: fullAppEvidenceFingerprint(f.filename), storage: f.writer.receipt() }
}
function withFS(name, wrap, callback) {
  const original = fs[name]; fs[name] = wrap(original); syncBuiltinESMExports()
  try { return callback() } finally { fs[name] = original; syncBuiltinESMExports() }
}
function hookPrototype(target, hook, callback) {
  const original = Object.getOwnPropertyDescriptor(target, 'toJSON')
  assert.equal(original, undefined)
  Object.defineProperty(target, 'toJSON', { configurable: true, value: hook })
  try { return callback() } finally { delete target.toJSON }
}
function rewritePage(f, ref, mutate) {
  const value = nativeParse(fs.readFileSync(partPath(f, ref), 'utf8')); mutate(value)
  const bytes = encode(value), digest = sha(bytes)
  ref.file = path.basename(f.filename) + '.parts/index-' + digest + '.json'; ref.bytes = bytes.length; ref.sha256 = digest
  fs.writeFileSync(partPath(f, ref), bytes, { flag: 'wx' })
}

test('v3 C01 is explicit while default1 explicit2 legacy and unknown-version guards retain their original paths', () => {
  for (const version of [1, 2, 3]) {
    const f = populate(fixture({ version }), { offline: 1 })
    try {
      const manifest = read(f); assert.equal(manifest.storageVersion, version)
      assert.equal(Object.hasOwn(manifest, 'indexPages'), version === 3)
      assert.equal(manifest.body.fullAppUi.offlineSettings[0] === null, version === 3)
      roundtrip(f)
    } finally { f.cleanup() }
  }
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'notepad-v3-version-'))
  try {
    const filename = path.join(directory, 'default.json'), writer = createFullAppEvidenceWriter(filename, report())
    writer.save(); assert.equal(nativeParse(fs.readFileSync(filename)).storageVersion, 1)
    for (const [name, options] of [['unknown', { storageVersion: 99 }], ['extra', { storageVersion: 3, guess: true }]]) {
      const target = path.join(directory, name + '.json')
      assert.throws(() => createFullAppEvidenceWriter(target, report(), options), /storage version|writer options/i)
      assert.equal(fs.existsSync(target), false); assert.equal(fs.existsSync(target + '.parts'), false)
    }
    const legacy = path.join(directory, 'legacy.json'); fs.writeFileSync(legacy, encode(report()))
    assert.deepEqual(clone(readFullAppEvidence(legacy).report), report()); assert.equal(readFullAppEvidence(legacy).storage, null)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('v3 C02 all six page families retain full values key order original payloads and accepted closure', () => {
  const f = populate(fixture(), { scenes: 33, shots: 129, stable: 65, offline: 2 })
  const control = populate(fixture({ version: 2 }), { scenes: 33, shots: 129, stable: 65, offline: 2 })
  try {
    const manifest = read(f), refs = manifest.indexPages.pages
    assert.deepEqual([...new Set(refs.map(ref => ref.context.collection))], roster)
    assert.deepEqual(refs.map(ref => [ref.context.collection, ref.context.offset, ref.context.count]),
      [['scenes', 0, 32], ['screenshots', 0, 128], ...stablePaths.map(collection => [collection, 0, 64]),
        ['fullAppUi.offlineSettings', 0, 1], ['fullAppUi.offlineSettings', 1, 1]])
    assert.equal(manifest.scenes.filter(x => x === null).length, 32); assert.equal(manifest.scenes[32].state, 'sealed')
    assert.equal(manifest.body.screenshots.filter(x => x === null).length, 128)
    assert.equal(manifest.body.screenshots[128].filename, 'synthetic-128.png')
    for (const descriptor of manifest.stableReceipts.collections) {
      assert.equal(descriptor.entries.filter(x => x === null).length, 64); assert.equal(descriptor.entries[64].index, 64)
    }
    assert.deepEqual(manifest.body.fullAppUi.offlineSettings, [null, null])
    const loaded = roundtrip(f), baseline = roundtrip(control)
    assert.equal(nativeStringify(loaded.report), nativeStringify(baseline.report))
    assert.equal(loaded.storage.rawSamples, 33); assert.equal(loaded.storage.scenes, 33)
    assert.equal(loaded.storage.parts.count, 33 + 33 + 195 + 7)
    const counters = f.writer.statistics()
    assert.equal(counters.indexParts, 7); assert.equal(counters.partBytes, loaded.storage.parts.bytes)
    assert.equal(counters.stableParts, 195)
    assert.ok(fs.statSync(f.filename).size < fs.statSync(control.filename).size)
    const before = f.writer.statistics(), files = fs.readdirSync(f.filename + '.parts').sort(), checkpoint = manifest.checkpoint
    const published = []
    withFS('renameSync', original => (...args) => { published.push(args); return original(...args) }, () => {
      f.report.mutable = { value: 1 }; f.writer.save(); f.report.mutable.value = 2; f.writer.save()
    })
    const after = f.writer.statistics()
    assert.equal(published.length, 2); assert.equal(after.saves - before.saves, 2); assert.equal(read(f).checkpoint, checkpoint + 2)
    assert.equal(after.indexParts, before.indexParts); assert.equal(after.indexRefCacheHits - before.indexRefCacheHits, 14)
    assert.deepEqual(fs.readdirSync(f.filename + '.parts').sort(), files); assert.equal(roundtrip(f).report.mutable.value, 2)
    const accepted = complete(f)
    assert.equal(accepted.storage.storageVersion, 3); assert.equal(accepted.storage.parts.count, 268)
    assert.deepEqual(clone(readFullAppEvidence(f.filename, { accepted }).report), clone(f.report))
  } finally { f.cleanup(); control.cleanup() }
})

test('v3 C03 the current active scene and incomplete offline tail remain live through page rotation', () => {
  const f = populate(fixture(), { scenes: 32, shots: 128, offline: 1 })
  try {
    const active = scene(32, false), receipt = { complete: false, rows: [{ count: 1 }] }
    f.report.fullAppUi.scenes.push(active); f.report.fullAppUi.offlineSettings.push(receipt); f.writer.save()
    const before = f.writer.statistics(), priorPages = read(f).indexPages.pages
    active.detail.text = 'second active value'; f.writer.appendRaw(active, { phase: 'after-capture', image: 'v3-32.png', detail: { actual: true } })
    receipt.rows[0].count = 2; f.writer.save()
    assert.equal(f.writer.statistics().indexParts, before.indexParts); assert.deepEqual(read(f).indexPages.pages, priorPages)
    assert.equal(read(f).scenes[32].value.metadata.detail.text, 'second active value')
    assert.equal(read(f).body.fullAppUi.offlineSettings[1].rows[0].count, 2); roundtrip(f)
    active.complete = true; f.writer.sealScene(active)
    receipt.complete = true; f.writer.save(); assert.equal(f.writer.sealStableJSON('fullAppUi.offlineSettings', receipt), true)
    const beforeSealPublication = f.writer.statistics(); f.writer.save()
    assert.equal(f.writer.statistics().indexParts, beforeSealPublication.indexParts + 1)
    assert.equal(pages(f, 'scenes').length, 1); assert.equal(pages(f, 'fullAppUi.offlineSettings').length, 2); roundtrip(f)
  } finally { f.cleanup() }
})

test('v3 C04 a private seal alone neither writes a page nor changes the already accepted checkpoint', () => {
  const f = fixture()
  try {
    const value = { complete: true, index: 0 }; f.report.fullAppUi.offlineSettings.push(value)
    const accepted = complete(f), bytes = fs.readFileSync(f.filename), before = f.writer.statistics()
    assert.equal(f.writer.sealStableJSON('fullAppUi.offlineSettings', value), true)
    assert.deepEqual(fs.readFileSync(f.filename), bytes); assert.equal(f.writer.statistics().saves, before.saves)
    assert.deepEqual(fs.readdirSync(f.filename + '.parts'), [])
    assert.equal(f.writer.receipt().parts.count, 0)
    assert.deepEqual(clone(readFullAppEvidence(f.filename, { accepted }).report), clone(f.report))
    f.writer.save(); assert.equal(f.writer.receipt().parts.count, 1)
    assert.throws(() => readFullAppEvidence(f.filename, { accepted }), /manifest bytes differ/)
    f.report.liveChange = 3; assert.throws(() => f.writer.receipt(), /changed after its last complete checkpoint/)
  } finally { f.cleanup() }
})

test('v3 C05 only a published successful seal grants a completed offline value a page', () => {
  const f = fixture()
  try {
    const value = { complete: true, rows: [] }; f.report.fullAppUi.offlineSettings.push(value)
    assert.throws(() => f.writer.sealStableJSON('fullAppUi.offlineSettings', value), /published/)
    f.writer.save(); assert.equal(pages(f, 'fullAppUi.offlineSettings').length, 0); assert.equal(Object.isFrozen(value), false)
    fs.writeFileSync(f.filename + '.next', 'foreign', { flag: 'wx' })
    value.rows.push('unsaved'); assert.throws(() => f.writer.save(), /EEXIST/)
    assert.throws(() => f.writer.sealStableJSON('fullAppUi.offlineSettings', value), /changed since/)
    assert.equal(Object.isFrozen(value), false); fs.unlinkSync(f.filename + '.next')
    f.writer.save(); assert.equal(f.writer.sealStableJSON('fullAppUi.offlineSettings', value), true); f.writer.save()
    assert.equal(pages(f, 'fullAppUi.offlineSettings').length, 1); roundtrip(f)
  } finally { f.cleanup() }
})

test('v3 C06 an explicitly sealed but incomplete offline receipt stays inline', () => {
  const f = fixture()
  try {
    const value = { complete: false, value: 1 }; f.report.fullAppUi.offlineSettings.push(value)
    f.writer.save(); assert.equal(f.writer.sealStableJSON('fullAppUi.offlineSettings', value), true); f.writer.save()
    assert.equal(pages(f, 'fullAppUi.offlineSettings').length, 0)
    assert.deepEqual(read(f).body.fullAppUi.offlineSettings, [value]); roundtrip(f)
  } finally { f.cleanup() }
})

for (const [name, mutate] of [
  ['reverse', values => values.reverse()],
  ['pop', values => values.pop()],
  ['same-length duplicate', values => { values[64] = values[63] }],
  ['same-length mutable replacement', values => { values[64] = { filename: 'current.png', value: 1 } }],
  ['unshift mutable value', values => values.unshift({ filename: 'first.png', value: 1 })],
]) test('v3 C07 a warm page observes current screenshot ' + name, () => {
  const f = populate(fixture(), { shots: 256 })
  try {
    const before = read(f).indexPages.pages.map(ref => ref.file)
    mutate(f.report.screenshots); f.writer.save(); roundtrip(f)
    const after = read(f).indexPages.pages.map(ref => ref.file)
    assert.notDeepEqual(after, before)
    const mutable = f.report.screenshots.find(item => item?.value === 1)
    if (mutable) { mutable.value = 2; f.writer.save(); assert.equal(roundtrip(f).report.screenshots.find(item => item?.filename === mutable.filename).value, 2) }
  } finally { f.cleanup() }
})

const corruptions = [
  ['missing index descriptor', (f, m) => { delete m.indexPages }],
  ['unknown manifest field', (f, m) => { m.unrecognized = true }],
  ['unknown index format', (f, m) => { m.indexPages.format += '-unknown' }],
  ['unknown index schema', (f, m) => { m.indexPages.schemaVersion++ }],
  ['unknown index envelope field', (f, m) => { m.indexPages.extra = true }],
  ['missing covered vector', (f, m) => { delete m.indexPages.covered }],
  ['wrong covered roster', (f, m) => { m.indexPages.covered.pop() }],
  ['fractional coverage', (f, m) => { m.indexPages.covered[5] = 1.5 }],
  ['non-page scene coverage', (f, m) => { m.indexPages.covered[0] = 1 }],
  ['missing page reference', (f, m) => { m.indexPages.pages.pop() }],
  ['extra unpromised page reference', (f, m) => { m.indexPages.covered[5]-- }],
  ['unknown collection', (f, m, r) => { r.context.collection = 'body.__proto__' }],
  ['unknown context field', (f, m, r) => { r.context.extra = true }],
  ['unknown reference field', (f, m, r) => { r.extra = true }],
  ['wrong offset', (f, m, r) => { r.context.offset = 1 }],
  ['wrong page count', (f, m, r) => { r.context.count = 2 }],
  ['reordered pages', (f, m) => { m.indexPages.pages.reverse() }],
  ['duplicate page', (f, m) => { m.indexPages.pages.push(clone(m.indexPages.pages[0])) }],
  ['missing page file', (f, m, r) => fs.unlinkSync(partPath(f, r))],
  ['escaped page path', (f, m, r) => { r.file = '../' + r.file }],
  ['page byte length differs', (f, m, r) => { r.bytes++ }],
  ['wrong reference kind', (f, m, r) => { r.kind = 'stable' }],
  ['same-size modified page bytes', (f, m, r) => { const p = partPath(f, r), b = fs.readFileSync(p); b[b.length - 1] = 32; fs.writeFileSync(p, b) }],
  ['symlink page', (f, m, r) => { const p = partPath(f, r), other = path.join(f.directory, 'elsewhere.json'); fs.renameSync(p, other); fs.symlinkSync(other, p) }],
  ['hardlink page', (f, m, r) => fs.linkSync(partPath(f, r), path.join(f.directory, 'alias.json'))],
  ['rehash wrong owner', (f, m, r) => rewritePage(f, r, p => { p.owner = '0'.repeat(64) })],
  ['rehash wrong payload version', (f, m, r) => rewritePage(f, r, p => { p.storageVersion = 2 })],
  ['rehash wrong payload kind', (f, m, r) => rewritePage(f, r, p => { p.kind = 'stable' })],
  ['rehash wrong payload context', (f, m, r) => rewritePage(f, r, p => { p.context.offset = 7 })],
  ['rehash unknown payload field', (f, m, r) => rewritePage(f, r, p => { p.extra = true })],
  ['rehash missing page value', (f, m, r) => rewritePage(f, r, p => { p.value = [] })],
  ['rehash extra page value', (f, m, r) => rewritePage(f, r, p => { p.value.push(clone(p.value[0])) })],
  ['rehash non-array value', (f, m, r) => rewritePage(f, r, p => { p.value = { value: p.value } })],
  ['rehash incomplete offline receipt', (f, m, r) => rewritePage(f, r, p => { p.value[0].complete = false })],
  ['overwrite current inline value', (f, m) => { m.body.fullAppUi.offlineSettings[0] = { complete: true, live: true } }],
  ['collection was shortened', (f, m) => { m.body.fullAppUi.offlineSettings.pop() }],
  ['source binding differs', (f, m) => { m.body.sourceFiles.keep.bytes++ }],
  ['manifest owner differs', (f, m) => { m.owner = '0'.repeat(64) }],
  ['unsupported manifest version', (f, m) => { m.storageVersion = 99 }],
]
for (const [name, mutate] of corruptions) test('v3 C12 rejects ' + name, () => {
  const f = populate(fixture(), { offline: 2 })
  try {
    const before = roundtrip(f); assert.equal(before.storage.parts.count, 2)
    const manifest = read(f); assert.equal(manifest.storageVersion, 3); assert.equal(manifest.indexPages.pages.length, 2)
    mutate(f, manifest, manifest.indexPages.pages[0]); write(f, manifest)
    assert.throws(() => readFullAppEvidence(f.filename))
  } finally { f.cleanup() }
})

for (const field of ['binding', 'owner']) test('v3 C13 verifies current ' + field + ' before any page file is read', () => {
  const f = populate(fixture(), { offline: 1 })
  try {
    const manifest = read(f)
    if (field === 'binding') manifest.body.sourceFiles.keep.bytes++
    else manifest.owner = '0'.repeat(64)
    write(f, manifest); let pageReads = 0
    withFS('readFileSync', original => (file, ...rest) => {
      if (typeof file === 'string' && path.basename(file).startsWith('index-')) pageReads++
      return original(file, ...rest)
    }, () => assert.throws(() => readFullAppEvidence(f.filename), /binding differs|owner differs/))
    assert.equal(pageReads, 0)
  } finally { f.cleanup() }
})

for (const kind of ['scene', 'raw', 'stable']) test('v3 C14 a valid metadata page cannot hide a missing original ' + kind + ' payload', () => {
  const f = populate(fixture(), kind === 'stable' ? { stable: { focus: 64 } } : { scenes: 32 })
  try {
    const manifest = read(f), index = manifest.indexPages.pages[0], page = nativeParse(fs.readFileSync(partPath(f, index)))
    const entry = page.value[0]
    let ref = kind === 'stable' ? entry.ref : entry.part
    if (kind === 'raw') ref = nativeParse(fs.readFileSync(partPath(f, ref))).value.rawSamples[0]
    const before = roundtrip(f)
    assert.ok(before.storage.parts.count > 1); fs.unlinkSync(partPath(f, ref))
    assert.throws(() => readFullAppEvidence(f.filename), /ENOENT/)
  } finally { f.cleanup() }
})

for (const [name, mutate] of [
  ['active descriptor in sealed page', p => { p.value[0].state = 'active' }],
  ['scene ordinal changed', p => { p.value[0].index = 1 }],
  ['scene identity changed', p => { p.value[0].identity.routeId = 'foreign' }],
  ['scene raw count omitted', p => { p.value[0].rawCount = 0 }],
  ['scene keys reordered', p => { p.value[0].keys.reverse() }],
]) test('v3 C15 rehashed ' + name + ' still fails the original scene checks', () => {
  const f = populate(fixture(), { scenes: 32 })
  try {
    const manifest = read(f); rewritePage(f, manifest.indexPages.pages[0], mutate); write(f, manifest)
    assert.throws(() => readFullAppEvidence(f.filename))
  } finally { f.cleanup() }
})

for (const [name, mutate] of [
  ['inline entry', p => { p.value[0].mode = 'inline' }],
  ['ordinal move', p => { p.value[0].index = 1 }],
  ['payload reference from another ordinal', p => { p.value[0].ref = clone(p.value[1].ref) }],
]) test('v3 C16 a rehashed stable page rejects ' + name, () => {
  const f = populate(fixture(), { stable: { focus: 64 } })
  try {
    const manifest = read(f); rewritePage(f, manifest.indexPages.pages[0], mutate); write(f, manifest)
    assert.throws(() => readFullAppEvidence(f.filename))
  } finally { f.cleanup() }
})

function pendingIndex() {
  const f = fixture(), value = { complete: true, rows: ['already published'] }
  f.report.fullAppUi.offlineSettings.push(value); f.writer.save()
  assert.equal(f.writer.sealStableJSON('fullAppUi.offlineSettings', value), true)
  const pending = { filename: 'uncommitted.png', bytes: 7 }; f.report.screenshots.push(pending)
  return { f, pending }
}
for (const boundary of ['index-part-write', 'temporary-write', 'rename-before', 'rename-after']) test('v3 C17 retains original atomic behavior at ' + boundary, () => {
  const { f, pending } = pendingIndex()
  try {
    const before = fs.readFileSync(f.filename), saves = f.writer.statistics().saves, failure = Error('deliberate v3 ' + boundary)
    let reached = 0
    if (boundary === 'index-part-write') withFS('writeFileSync', original => (target, data, ...rest) => {
      if (typeof target === 'string' && /^index-[a-f0-9]{64}\.json$/.test(path.basename(target))) {
        reached++; original(target, Buffer.from(data).subarray(0, 9), ...rest); throw failure
      }
      return original(target, data, ...rest)
    }, () => assert.throws(() => f.writer.save(), error => error === failure))
    else if (boundary === 'temporary-write') withFS('writeFileSync', original => (target, data, ...rest) => {
      if (typeof target === 'number') { reached++; original(target, Buffer.from(data).subarray(0, 9), ...rest); throw failure }
      return original(target, data, ...rest)
    }, () => assert.throws(() => f.writer.save(), error => error === failure))
    else withFS('renameSync', original => (...args) => {
      reached++; if (boundary === 'rename-after') original(...args); throw failure
    }, () => assert.throws(() => f.writer.save(), error => error === failure))
    assert.equal(reached, 1); assert.equal(f.writer.statistics().saves, saves)
    assert.equal(f.writer.statistics().indexRefCacheHits, 0)
    assert.throws(() => f.writer.sealStableJSON('screenshots', pending), /successful publication/)
    assert.equal(Object.isFrozen(pending), false)
    if (boundary === 'rename-after') {
      assert.notDeepEqual(fs.readFileSync(f.filename), before)
      assert.equal(roundtrip(f).storage.checkpoint, saves + 1)
    } else {
      assert.deepEqual(fs.readFileSync(f.filename), before)
      assert.equal(readFullAppEvidence(f.filename).storage.checkpoint, saves)
    }
    assert.equal(fs.existsSync(f.filename + '.next'), false)
    if (boundary !== 'index-part-write') {
      const parts = f.writer.statistics().indexParts
      pending.bytes = 8; f.writer.save()
      assert.equal(f.writer.statistics().indexParts, parts, 'A successful unreferenced page can be reused by its bytes without another physical write')
      assert.equal(f.writer.statistics().indexRefCacheHits, 0, 'A failed save cannot publish an in-memory page-vector cache')
      assert.equal(roundtrip(f).report.screenshots[0].bytes, 8)
      f.writer.save(); assert.equal(f.writer.statistics().indexRefCacheHits, 1)
    }
  } finally { f.cleanup() }
})

test('v3 C18 a first partial creation is retained and cannot be reopened as a new report', () => {
  const f = fixture()
  try {
    const failure = Error('deliberate first v3 creation partial')
    withFS('writeFileSync', original => (target, data, ...rest) => {
      if (target === f.filename) { original(target, Buffer.from(data).subarray(0, 11), ...rest); throw failure }
      return original(target, data, ...rest)
    }, () => assert.throws(() => f.writer.save(), error => error === failure))
    assert.equal(f.writer.statistics().saves, 0); assert.throws(() => readFullAppEvidence(f.filename), SyntaxError)
    assert.throws(() => createFullAppEvidenceWriter(f.filename, f.report, { storageVersion: 3 }), /existing evidence/)
  } finally { f.cleanup() }
})

for (const type of ['file', 'directory']) test('v3 C19 preserves a foreign staging ' + type + ' and excludes the real failed-publication page orphan', () => {
  const { f } = pendingIndex()
  try {
    const before = fs.readFileSync(f.filename), prior = readFullAppEvidence(f.filename).storage
    if (type === 'directory') fs.mkdirSync(f.filename + '.next')
    else fs.writeFileSync(f.filename + '.next', 'foreign', { flag: 'wx' })
    assert.throws(() => f.writer.save(), /EEXIST/)
    assert.deepEqual(fs.readFileSync(f.filename), before); assert.ok(fs.existsSync(f.filename + '.next'))
    assert.equal(fs.readdirSync(f.filename + '.parts').filter(file => file.startsWith('index-')).length, 1)
    assert.deepEqual(readFullAppEvidence(f.filename).storage.parts, prior.parts)
    fs.rmSync(f.filename + '.next', { recursive: true }); f.writer.save()
    assert.equal(roundtrip(f).storage.parts.count, 1)
  } finally { f.cleanup() }
})

test('v3 C20 accepted closure includes every index page and refuses stale or modified current bytes', () => {
  const f = populate(fixture(), { offline: 2 })
  try {
    const accepted = complete(f), wrong = clone(accepted)
    assert.equal(accepted.storage.parts.count, 2); wrong.storage.parts.count--
    assert.throws(() => readFullAppEvidence(f.filename, { accepted: wrong }), /closure differs/)
    const ref = read(f).indexPages.pages[0], bytes = fs.readFileSync(partPath(f, ref)); bytes[bytes.length - 1] = 32; fs.writeFileSync(partPath(f, ref), bytes)
    assert.throws(() => f.writer.receipt(), /digest differs/)
    assert.throws(() => readFullAppEvidence(f.filename, { accepted }), /digest differs/)
  } finally { f.cleanup() }
})

function protocolResult(version, exercise) {
  const f = populate(fixture({ version }), { offline: 2 }), trace = []
  try {
    exercise(f, trace)
    const manifest = read(f)
    delete manifest.storeID; delete manifest.owner
    return { trace, manifest, privateDisabled: f.writer.statistics().stableJSON.privateCacheDisabled }
  } finally { f.cleanup() }
}
const protocols = [
  ['Object toJSON', (f, trace) => hookPrototype(Object.prototype, function (key) {
    trace.push([key, Array.isArray(this) ? 'array' : Object.keys(this).join(',')]); return this
  }, () => f.writer.save())],
  ['Array toJSON', (f, trace) => hookPrototype(Array.prototype, function (key) {
    trace.push([key, this.length]); return this
  }, () => f.writer.save())],
  ['observing stringify wrapper', (f, trace) => {
    JSON.stringify = function (value, ...rest) { trace.push(value && typeof value === 'object' ? Object.keys(value) : [typeof value, value]); return nativeStringify(value, ...rest) }
    try { f.writer.save() } finally { JSON.stringify = nativeStringify }
  }],
  ['stringify member accessor', (f, trace) => {
    const descriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify')
    Object.defineProperty(JSON, 'stringify', { configurable: true, get() { trace.push('get stringify'); return nativeStringify } })
    try { f.writer.save() } finally { Object.defineProperty(JSON, 'stringify', descriptor) }
  }],
  ['parse member accessor', (f, trace) => {
    const descriptor = Object.getOwnPropertyDescriptor(JSON, 'parse')
    Object.defineProperty(JSON, 'parse', { configurable: true, get() { trace.push('get parse'); return nativeParse } })
    try { f.writer.save() } finally { Object.defineProperty(JSON, 'parse', descriptor) }
  }],
  ['indexed getter', (f, trace) => {
    const original = f.report.fullAppUi.offlineSettings[0]
    Object.defineProperty(f.report.fullAppUi.offlineSettings, '0', { enumerable: true, configurable: true, get() { trace.push('index 0'); return original } })
    f.writer.save(); assert.deepEqual(trace, ['index 0'])
  }],
  ['Proxy array', (f, trace) => {
    f.report.fullAppUi.offlineSettings = new Proxy(f.report.fullAppUi.offlineSettings, { get(target, key, receiver) { trace.push(String(key)); return Reflect.get(target, key, receiver) } })
    f.writer.save(); assert.deepEqual(trace, ['toJSON', 'length', '0', '1'])
  }],
]
for (const [name, exercise] of protocols) test('v3 C21 keeps the original explicit2 output and exact observable trace for ' + name, () => {
  const control = protocolResult(2, exercise), candidate = protocolResult(3, exercise)
  assert.deepEqual(candidate, control)
  assert.ok([1, 2].includes(candidate.manifest.storageVersion)); assert.equal(Object.hasOwn(candidate.manifest, 'indexPages'), false)
})

for (const [name, mutate] of [
  ['hole', values => { delete values[0] }],
  ['hidden index', values => Object.defineProperty(values, '0', { enumerable: false })],
  ['extra own string key', values => { values.extra = true }],
  ['extra own symbol', values => { values[Symbol('extra')] = true }],
  ['custom prototype', values => Object.setPrototypeOf(values, Object.create(Array.prototype))],
  ['own nonfunction toJSON', values => { values.toJSON = null }],
]) test('v3 C22 a warm page retains native fallback for ' + name, () => {
  const f = populate(fixture(), { shots: 128 })
  try {
    mutate(f.report.screenshots); f.writer.save()
    assert.equal(read(f).storageVersion, 1); assert.equal(Object.hasOwn(read(f), 'indexPages'), false); roundtrip(f)
  } finally { f.cleanup() }
})

for (const [name, make] of [['cycle', () => { const x = {}; x.self = x; return x }], ['BigInt', () => 1n]]) {
  test('v3 C23 unsupported ' + name + ' retains the native error and preceding complete checkpoint', () => {
    const f = populate(fixture(), { offline: 1 })
    try {
      const before = fs.readFileSync(f.filename), saves = f.writer.statistics().saves
      f.report.current = make(); assert.throws(() => f.writer.save(), TypeError)
      assert.deepEqual(fs.readFileSync(f.filename), before); assert.equal(f.writer.statistics().saves, saves)
    } finally { f.cleanup() }
  })
}

test('v3 C24 removing a throwing global hook cannot restore a private page capability', () => {
  const f = populate(fixture(), { offline: 1 })
  try {
    const before = fs.readFileSync(f.filename), failure = Error('actual prototype refusal')
    hookPrototype(Object.prototype, function () { throw failure }, () => assert.throws(() => f.writer.save(), error => error === failure))
    assert.deepEqual(fs.readFileSync(f.filename), before)
    f.report.mutable = { afterFailure: true }; f.writer.save()
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.equal(read(f).storageVersion, 2); assert.equal(Object.hasOwn(read(f), 'indexPages'), false); roundtrip(f)
  } finally { f.cleanup() }
})

test('v3 C25 an escaped private sealed descriptor cannot be hidden by a previously published page after hook removal', () => {
  const f = populate(fixture(), { scenes: 32 }); let escaped
  try {
    assert.equal(pages(f, 'scenes').length, 1)
    hookPrototype(Object.prototype, function () {
      if (!escaped && this.state === 'sealed' && this.index === 0 && Object.hasOwn(this, 'part')) escaped = this
      return this
    }, () => f.writer.save())
    assert.ok(escaped); assert.equal(Object.isFrozen(escaped), false)
    escaped.rawCount++; f.writer.save()
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    const manifest = read(f)
    assert.equal(manifest.storageVersion, 2); assert.equal(manifest.scenes[0].rawCount, 2)
    assert.equal(Object.hasOwn(manifest, 'indexPages'), false)
    assert.throws(() => readFullAppEvidence(f.filename), /raw sample tail/)
  } finally { f.cleanup() }
})

for (const member of ['parse', 'stringify']) test('v3 C26 a retained pre-import ' + member + ' wrapper keeps private binding changes observable', async () => {
  const original = Object.getOwnPropertyDescriptor(JSON, member); let escaped, f
  if (member === 'stringify') JSON.stringify = function (value, ...args) {
    if (!escaped && value?.storeID && value?.binding) escaped = value.binding
    return nativeStringify(value, ...args)
  }
  else JSON.parse = function (...args) {
    const value = nativeParse(...args)
    if (!escaped && value?.productCommit && value?.sourceFiles) escaped = value
    return value
  }
  try {
    const isolated = await import('./full-app-ui-storage.mjs?v3-preimport-' + member)
    f = fixture({ createWriter: isolated.createFullAppEvidenceWriter }); f.writer.save()
    assert.ok(escaped); escaped.sourceFiles.keep.bytes++; f.report.sourceFiles.keep.bytes++
    f.writer.save()
    const manifest = read(f)
    assert.equal(manifest.binding.sourceFiles.keep.bytes, 13)
    assert.equal(f.writer.statistics().stableJSON.privateCacheDisabled, true)
    assert.equal(Object.hasOwn(manifest, 'indexPages'), false)
    assert.throws(() => isolated.readFullAppEvidence(f.filename), /owner differs/)
  } finally { Object.defineProperty(JSON, member, original); f?.cleanup() }
})

test('v3 C27 active normalization still observes getters once and retains parsed integer-key order', () => {
  const f = populate(fixture(), { offline: 1 }); let reads = 0, ownKeys = 0
  try {
    const active = scene(0, false)
    const value = new Proxy({ 1: 'one', 2: 'two' }, { ownKeys() { ownKeys++; return ['2', '1'] } })
    Object.defineProperty(active, 'observed', { enumerable: true, configurable: true, get() { reads++; return value } })
    f.report.fullAppUi.scenes.push(active); f.writer.save()
    assert.equal(reads, 1); assert.equal(ownKeys, 1)
    assert.deepEqual(Object.keys(read(f).scenes[0].value.metadata.observed), ['1', '2'])
    assert.equal(read(f).storageVersion, 3); assert.equal(pages(f, 'fullAppUi.offlineSettings').length, 1)
    assert.deepEqual(readFullAppEvidence(f.filename).report.fullAppUi.scenes[0].observed, { 1: 'one', 2: 'two' })
  } finally { f.cleanup() }
})

for (const state of ['absent', 'undefined', 'null', 'object', 'empty', 'ordinary-null']) test('v3 C28 current offline ' + state + ' state is never replaced by a retained old page', () => {
  const f = populate(fixture(), { offline: 1 })
  try {
    if (state === 'absent') delete f.report.fullAppUi.offlineSettings
    else f.report.fullAppUi.offlineSettings = { undefined, null: null, object: { current: true }, empty: [], 'ordinary-null': [null] }[state]
    f.writer.save(); assert.equal(pages(f, 'fullAppUi.offlineSettings').length, 0); roundtrip(f)
  } finally { f.cleanup() }
})

test('v3 C29 the unchanged real capture producer and canonical validator consume a v3 roundtrip and still reject missing after-capture', async () => {
  // Reuse only three exact old fixture definition ranges, never import/register
  // or run the old test file again. The observer remains the actual serialized
  // production observer running in that existing controlled DOM model.
  const source = fs.readFileSync(new URL('./full-app-ui-evidence.node.mjs', import.meta.url), 'utf8')
  const section = (start, end) => {
    const from = source.indexOf(start), to = source.indexOf(end, from)
    assert.ok(from >= 0 && to > from, 'Original capture fixture definition anchors must remain')
    return source.slice(from, to)
  }
  const fixtureSource = section('const clone = value => structuredClone(value)', '// Deliberately synthetic contracts for the repaired sidebar only.') +
    section('function png(width, height,', '\nfunction sidebarPng(') +
    section('function serializedSweepContract(root, matrix)', '\ntest(')
  const originals = new Function('createHash', 'FULL_APP_GROUPS', 'FULL_APP_MATRIX', 'Buffer', 'deflateSync', 'runInNewContext', 'collectFullAppScrollOwners',
    fixtureSource + '\nreturn {ledgerFixture, uiFixture, png, serializedSweepContract}')(
    createHash, FULL_APP_GROUPS, FULL_APP_MATRIX, Buffer, deflateSync, runInNewContext, collectFullAppScrollOwners)
  const f = fixture({ beforeWriter: value => { value.group = 'projects' } }), ledger = originals.ledgerFixture(), ui = originals.uiFixture('projects', ledger), route = ledger.groups.projects.routes[0]
  const matrix = clone(FULL_APP_MATRIX[0]), previous = ui.scenes.find(item => item.stateId === 'ready' && item.theme === matrix.theme && item.viewport.width === matrix.viewport.width)
  ui.scenes.splice(ui.scenes.indexOf(previous), 1); f.report.fullAppUi = ui
  try {
    f.writer.save()
    for (const receipt of ui.focus) assert.equal(f.writer.sealStableJSON('fullAppUi.focus', receipt), true)
    f.writer.save(); assert.equal(read(f).storageVersion, 3)
    for (const item of ui.scenes) f.writer.sealScene(item)
    const model = originals.serializedSweepContract(route.root, matrix), captures = [], budgets = []
    const shared = createFullAppUiShared({ evaluate: model.evaluate, report: f.report, routes: [route], matrix, evidenceStore: f.writer,
      windowReceipt: { nativeWindow: true, viewport: clone(matrix.viewport), requested: clone(matrix.viewport) },
      click: async () => { throw Error('Unexpected pointer in v3 storage contract') },
      cdp: { send: async () => { throw Error('Unexpected keyboard in v3 storage contract') } },
      until: async (check, label, ...extra) => { budgets.push(extra); const value = await check(); assert.ok(value, label); return value },
      save: () => f.writer.save(), capture: async (name, guard) => {
        if (guard) await guard()
        const bytes = originals.png(matrix.viewport.width, matrix.viewport.height), image = { filename: name, bytes: bytes.length, sha256: sha(bytes) }
        fs.writeFileSync(path.join(f.directory, name), bytes); captures.push(image); return image
      } })
    const actual = await shared.captureState({ routeId: route.id, stateId: 'ready', anchors: ['#owned-select'] })
    assert.equal(actual, ui.scenes.at(-1)); assert.equal(Object.isFrozen(actual), true)
    assert.equal(actual.images.length, 3); assert.equal(captures.length, 3)
    assert.ok(budgets.every(value => value.length === 0))
    assert.equal(validateFullAppUiEvidence(ui, ledger), ui)
    const loaded = roundtrip(f)
    assert.equal(loaded.storage.storageVersion, 3); assert.ok(loaded.statistics().reads.stableParts > 0)
    assert.equal(validateFullAppUiEvidence(loaded.report.fullAppUi, ledger), loaded.report.fullAppUi)
    const missing = clone(loaded.report.fullAppUi)
    missing.scenes.at(-1).rawSamples = missing.scenes.at(-1).rawSamples.filter(sample => sample.phase !== 'after-capture')
    assert.throws(() => validateFullAppUiEvidence(missing, ledger))
    const currentValidatorSource = fs.readFileSync(new URL('./full-app-ui-evidence.mjs', import.meta.url), 'utf8')
    const lfSource = currentValidatorSource.replace(/\r\n/g, '\n')
    assert.equal(sha(lfSource), '0b78ed5c7ebc9c43cfd11a84da2d3123a2c1ee446c30ab7a00b0b478316199e1')
    const addedDecoratorSources = "  'scripts/full-app-ui-decorator-keyboard.mjs', 'scripts/full-app-ui-decorator-keyboard.node.mjs',\n"
    assert.equal(lfSource.split(addedDecoratorSources).length - 1, 1)
    const originalSources = lfSource.replace(addedDecoratorSources, '')
    assert.equal(sha(originalSources), '2997fd8943dc91678c7544628912406eda03bc5255dc8a752ed529bcc7a39317')
    const currentOwnedSearch = "'scripts/full-app-ui-owned-search.node.mjs'"
    const originalOwnedSearch = "'scripts/full-app-ui-owned-search.test.mjs'"
    assert.equal(lfSource.split(currentOwnedSearch).length - 1, 1)
    assert.equal(lfSource.split(originalOwnedSearch).length - 1, 0)
    const canonical = originalSources.replace(currentOwnedSearch, originalOwnedSearch)
    assert.equal(sha(canonical.replace(/\r\n/g, '\n')), '60039c19b8b8c58a20d1ac42e2b066a18d7ce87c5bd21149da319d5504baf92b')
  } finally { f.cleanup() }
})

test('v3 C08 a new ordinary Array with the exact same sealed occurrences may reuse only its verified pages', () => {
  const f = populate(fixture(), { shots: 128 })
  try {
    const before = f.writer.statistics(), original = f.report.screenshots, refs = pages(f, 'screenshots')
    f.report.screenshots = [...original]; f.writer.save(); assert.deepEqual(pages(f, 'screenshots'), refs)
    assert.equal(f.writer.statistics().indexParts, before.indexParts)
    assert.equal(f.writer.statistics().indexRefCacheHits - before.indexRefCacheHits, 1)
    f.report.screenshots = original; f.writer.save(); roundtrip(f)
  } finally { f.cleanup() }
})

test('v3 C09 full page boundaries publish once and the remaining screenshot tail stays current', () => {
  const f = populate(fixture(), { shots: 127 })
  try {
    assert.equal(pages(f, 'screenshots').length, 0)
    const value = { filename: 'boundary-127.png', value: 1 }; f.report.screenshots.push(value); f.writer.save()
    assert.equal(pages(f, 'screenshots').length, 0)
    assert.equal(f.writer.sealStableJSON('screenshots', value), true); f.writer.save()
    assert.equal(pages(f, 'screenshots').length, 1)
    const tail = { filename: 'tail-128.png', value: 1 }; f.report.screenshots.push(tail); f.writer.save()
    tail.value = 2; f.writer.save(); assert.equal(read(f).body.screenshots[128].value, 2)
    assert.equal(f.writer.statistics().indexParts, 1); roundtrip(f)
  } finally { f.cleanup() }
})

test('v3 C10 identical receipt objects moved across ordinal and collection retain unique original payload contexts', () => {
  const f = populate(fixture(), { stable: { focus: 64 } })
  try {
    const original = f.report.fullAppUi.focus[0]
    f.report.fullAppUi.focus.reverse(); f.report.fullAppUi.popups = Array(64).fill(original); f.writer.save()
    const loaded = roundtrip(f), manifest = read(f)
    assert.equal(pages(f, 'fullAppUi.focus').length, 1); assert.equal(pages(f, 'fullAppUi.popups').length, 1)
    assert.equal(loaded.report.fullAppUi.focus[63].index, 0)
    const popup = nativeParse(fs.readFileSync(partPath(f, manifest.indexPages.pages.find(ref => ref.context.collection === 'fullAppUi.popups'))))
    assert.deepEqual(popup.value.map(entry => entry.ref.context), Array.from({ length: 64 }, (_, ordinal) => ({ collection: 'fullAppUi.popups', ordinal })))
    assert.equal(new Set(popup.value.map(entry => entry.ref.file)).size, 64)
  } finally { f.cleanup() }
})

for (const [name, mutate] of [
  ['scene reverse', values => values.reverse()],
  ['scene duplicate', values => { values[1] = values[0] }],
  ['scene removed', values => values.pop()],
]) test('v3 C11 paging cannot relax the original refusal of ' + name, () => {
  const f = populate(fixture(), { scenes: 32 })
  try {
    const before = fs.readFileSync(f.filename), count = f.writer.statistics().saves
    mutate(f.report.fullAppUi.scenes); assert.throws(() => f.writer.save())
    assert.deepEqual(fs.readFileSync(f.filename), before); assert.equal(f.writer.statistics().saves, count)
  } finally { f.cleanup() }
})

