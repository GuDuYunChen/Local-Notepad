// Lossless storage only. This module never decides whether UI/native evidence
// passes: the existing validators still consume the reconstructed JSON values.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const FULL_APP_STORAGE_FORMAT = 'local-notepad-full-app-ui-segmented'
const PART_FORMAT = FULL_APP_STORAGE_FORMAT + '-part'
const VERSION = 1
const EVENT_CHUNK = 1024
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.parse(JSON.stringify(value))
const encode = value => Buffer.from(JSON.stringify(value) + '\n', 'utf8')
const same = (a, b, message) => assert.deepEqual(a, b, message)
const identity = (scene, index) => json({ index, group: scene.group, routeId: scene.routeId,
  stateId: scene.stateId, theme: scene.theme, viewport: scene.viewport })
const binding = report => json({ productCommit: report.productCommit, productTree: report.productTree,
  verifierCommit: report.verifierCommit, group: report.group, runner: report.runner,
  sourceFiles: report.sourceFiles, startedAt: report.startedAt })
const samplePosition = sample => json({ phase: sample.phase, image: sample.image })
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}
function without(value, omitted) {
  const result = {}
  for (const key of Object.keys(value)) if (!omitted.includes(key)) {
    Object.defineProperty(result, key, { enumerable: true, configurable: true, writable: true, value: value[key] })
  }
  return result
}

// Hash arbitrary existing receipts/binaries without allocating a whole-file
// Buffer. Part readers below separately reject links and escaped part paths.
export function fullAppEvidenceFingerprint(filename) {
  const fd = openSync(filename, 'r'), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(256 * 1024)
  try {
    const before = fstatSync(fd)
    assert.ok(before.isFile(), 'Evidence fingerprint requires a regular file')
    let bytes = 0, count
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count)); bytes += count
    }
    const after = fstatSync(fd)
    same([after.size, after.mtimeMs, after.ctimeMs], [before.size, before.mtimeMs, before.ctimeMs], 'Evidence changed while hashing')
    assert.equal(bytes, before.size)
    return { filename: path.basename(filename), bytes, sha256: hash.digest('hex') }
  } finally { closeSync(fd) }
}

// A single cache can be shared by all five group readers. A scene has one
// metadata object and, only when requested, one genuine rawSamples Array.
// Event data also has at most one current group, never five retained arrays.
export function createFullAppEvidenceCache() {
  let sceneKey, sceneValue, eventKey, eventValue
  const counters = { sceneLoads: 0, eventLoads: 0 }
  return {
    scene(key, read) {
      if (sceneKey !== key || sceneValue === undefined) { sceneKey = key; sceneValue = undefined; sceneValue = read(); counters.sceneLoads++ }
      return sceneValue
    },
    events(key, read) {
      if (eventKey !== key || eventValue === undefined) { eventKey = key; eventValue = undefined; eventValue = read(); counters.eventLoads++ }
      return eventValue
    },
    clear() { sceneKey = sceneValue = eventKey = eventValue = undefined },
    state() { return { ...counters, retainedScenes: sceneValue ? 1 : 0, retainedEventGroups: eventValue ? 1 : 0 } },
  }
}

function partAccess(filename, owner) {
  const root = path.dirname(path.resolve(filename)), directory = path.basename(filename) + '.parts'
  const directoryPath = path.join(root, directory)
  const directoryStat = lstatSync(directoryPath)
  assert.ok(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'Evidence part directory must not be a link')
  const realDirectory = realpathSync(directoryPath)
  const reads = { rawParts: 0, rawBytes: 0, sceneParts: 0, sceneBytes: 0, eventsParts: 0, eventsBytes: 0 }
  const read = (ref, kind, context) => {
    assert.ok(plain(ref), 'Evidence part reference is required')
    assert.equal(ref.kind, kind); assert.match(ref.sha256 || '', /^[a-f0-9]{64}$/)
    assert.ok(Number.isSafeInteger(ref.bytes) && ref.bytes > 0)
    assert.equal(ref.file, directory + '/' + kind + '-' + ref.sha256 + '.json', 'Evidence part path escapes or aliases its owned directory')
    same(ref.context, context, 'Evidence part ordinal or source context differs')
    const target = path.join(root, ...ref.file.split('/')), stat = lstatSync(target)
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Evidence part must be one owned regular file, not an alias')
    assert.equal(path.dirname(realpathSync(target)), realDirectory, 'Evidence part escaped its owned directory')
    assert.equal(stat.size, ref.bytes, 'Evidence part was truncated or extended')
    const bytes = readFileSync(target)
    reads[kind + 'Parts']++; reads[kind + 'Bytes'] += bytes.length
    assert.equal(bytes.length, ref.bytes); assert.equal(sha(bytes), ref.sha256, 'Evidence part digest differs')
    const part = JSON.parse(bytes.toString('utf8'))
    assert.equal(part.format, PART_FORMAT); assert.equal(part.storageVersion, VERSION)
    assert.equal(part.owner, owner, 'Evidence part belongs to another run/source')
    assert.equal(part.kind, kind); same(part.context, context, 'Evidence part payload context differs')
    return part.value
  }
  return { read, directory, directoryPath, statistics: () => ({ ...reads }) }
}

function sceneContext(slot) { return { scene: slot.identity } }
function rawContext(slot, index, position) { return { scene: slot.identity, sample: index, position } }
function validateSlot(slot, index) {
  assert.ok(plain(slot)); assert.equal(slot.index, index, 'Evidence scene order differs')
  assert.equal(slot.identity?.index, index)
  assert.ok(Array.isArray(slot.keys) && new Set(slot.keys).size === slot.keys.length)
  assert.ok(slot.keys.every(key => typeof key === 'string') && slot.keys.includes('rawSamples'))
  assert.ok(['active', 'sealed'].includes(slot.state))
  assert.ok(Number.isSafeInteger(slot.rawCount) && slot.rawCount >= 0)
}
function sceneValue(slot, access) {
  const value = slot.state === 'sealed' ? access.read(slot.part, 'scene', sceneContext(slot)) : slot.value
  assert.ok(plain(value) && plain(value.metadata) && Array.isArray(value.rawSamples))
  assert.equal(value.rawSamples.length, slot.rawCount, 'Evidence raw sample tail was omitted')
  same(identity(value.metadata, slot.index), slot.identity, 'Evidence scene metadata belongs to another scene')
  same([...Object.keys(value.metadata), 'rawSamples'], slot.keys, 'Evidence scene fields were omitted or reordered')
  if (slot.state === 'sealed') assert.equal(value.metadata.complete, true)
  return value
}
function rawValue(slot, ref, index, access) {
  assert.ok(plain(ref.position))
  const value = access.read(ref, 'raw', rawContext(slot, index, ref.position))
  assert.ok(plain(value)); same(samplePosition(value), ref.position, 'Evidence sample phase/image differs')
  return value
}
function makeScene(slot, access, cache, owner, target = {}) {
  const light = { ...slot.identity }
  delete light.index
  freeze(light)
  const load = () => cache.scene(owner + ':scene:' + slot.index, () => {
    const value = sceneValue(slot, access)
    return { metadata: freeze(value.metadata), refs: value.rawSamples, raw: undefined }
  })
  for (const key of Object.keys(target)) delete target[key]
  for (const key of slot.keys) Object.defineProperty(target, key, {
    enumerable: true, configurable: false,
    get: own(light, key) ? () => light[key] : key === 'rawSamples' ? () => {
      const value = load()
      value.raw ||= freeze(value.refs.map((ref, index) => rawValue(slot, ref, index, access)))
      return value.raw
    } : () => load().metadata[key],
  })
  return Object.freeze(target)
}

function validateEvents(descriptor, access, visit = () => {}) {
  assert.ok(plain(descriptor) && Array.isArray(descriptor.parts))
  assert.ok(Number.isSafeInteger(descriptor.length) && descriptor.length >= 0)
  let offset = 0
  for (const [index, ref] of descriptor.parts.entries()) {
    const count = Math.min(EVENT_CHUNK, descriptor.length - offset)
    assert.ok(count > 0)
    const context = { chunk: index, offset, count }
    visit(ref)
    const events = access.read(ref, 'events', context)
    assert.ok(Array.isArray(events)); assert.equal(events.length, count)
    offset += count
  }
  assert.equal(offset, descriptor.length, 'Evidence event tail was omitted')
}

// Legacy JSON is an explicit compatibility path. New segmented reports do not
// JSON.parse a combined raw report or retain all groups' raw/event payloads.
export function readFullAppEvidence(filename, { cache = createFullAppEvidenceCache(), accepted } = {}) {
  const stat = lstatSync(filename)
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Evidence manifest must be an owned regular file')
  const bytes = readFileSync(filename), fingerprint = { filename: path.basename(filename), bytes: bytes.length, sha256: sha(bytes) }
  const manifest = JSON.parse(bytes.toString('utf8'))
  if (manifest.format !== FULL_APP_STORAGE_FORMAT) {
    assert.ok(!String(manifest.format || '').startsWith(FULL_APP_STORAGE_FORMAT), 'Unsupported evidence storage format')
    const loaded = { report: manifest, fingerprint, storage: null }
    if (accepted) {
      assert.equal(accepted.complete, true); assert.equal(manifest.complete, true)
      same(accepted.report, fingerprint); assert.equal(accepted.storage, undefined, 'Legacy JSON cannot claim segmented parts')
    }
    return loaded
  }
  assert.equal(manifest.storageVersion, VERSION, 'Unsupported evidence storage version')
  assert.ok(Number.isSafeInteger(manifest.checkpoint) && manifest.checkpoint > 0)
  assert.match(manifest.storeID || '', /^[a-f0-9-]{36}$/)
  assert.ok(plain(manifest.body) && plain(manifest.binding))
  same(binding(manifest.body), manifest.binding, 'Evidence manifest source binding differs')
  assert.equal(manifest.owner, sha(encode({ storeID: manifest.storeID, binding: manifest.binding })), 'Evidence manifest owner differs')
  assert.ok(Array.isArray(manifest.scenes))
  assert.equal(manifest.sceneCount, manifest.scenes.length, 'Evidence scene tail was omitted')
  assert.equal(typeof manifest.scenesPresent, 'boolean')
  const access = partAccess(filename, manifest.owner), seen = new Set(), closure = createHash('sha256')
  let partBytes = 0, rawCount = 0
  const visit = ref => {
    assert.ok(plain(ref) && typeof ref.file === 'string')
    assert.equal(seen.has(ref.file), false, 'Duplicate or aliased evidence part')
    seen.add(ref.file); closure.update(encode(ref)); partBytes += ref.bytes
  }
  const report = manifest.body
  if (manifest.scenesPresent) {
    assert.ok(plain(report.fullAppUi) && !own(report.fullAppUi, 'scenes'))
    report.fullAppUi.scenes = manifest.scenes.map((slot, index) => {
      validateSlot(slot, index)
      if (slot.state === 'sealed') visit(slot.part)
      const value = sceneValue(slot, access)
      for (const [sample, ref] of value.rawSamples.entries()) { visit(ref); rawValue(slot, ref, sample, access); rawCount++ }
      return makeScene(slot, access, cache, manifest.owner + ':checkpoint:' + manifest.checkpoint)
    })
  } else assert.equal(manifest.scenes.length, 0)
  let eventCount = 0
  if (manifest.events !== null) {
    assert.ok(plain(report.fullAppUi) && !own(report.fullAppUi, 'events'))
    validateEvents(manifest.events, access, visit); eventCount = manifest.events.length
    Object.defineProperty(report.fullAppUi, 'events', { enumerable: true, configurable: false, get: () =>
      cache.events(manifest.owner + ':events:' + manifest.checkpoint, () => {
        const result = []
        for (const [index, ref] of manifest.events.parts.entries()) {
          const offset = index * EVENT_CHUNK, count = Math.min(EVENT_CHUNK, manifest.events.length - offset)
          result.push(...access.read(ref, 'events', { chunk: index, offset, count }))
        }
        assert.equal(result.length, manifest.events.length)
        return freeze(result)
      }) })
  }
  if (report.complete === true) {
    assert.equal(manifest.scenesPresent, true)
    assert.ok(manifest.scenes.every(slot => slot.state === 'sealed'), 'Complete evidence cannot contain an uncommitted active scene')
  }
  const loaded = { report, fingerprint, statistics: () => ({ reads: access.statistics(), cache: cache.state() }), storage: {
    format: FULL_APP_STORAGE_FORMAT, storageVersion: VERSION, owner: manifest.owner, checkpoint: manifest.checkpoint,
    manifest: fingerprint, parts: { count: seen.size, bytes: partBytes, sha256: closure.digest('hex') },
    scenes: manifest.scenes.length, rawSamples: rawCount, events: eventCount,
  } }
  if (accepted) {
    assert.equal(accepted.complete, true); assert.equal(report.complete, true)
    same(accepted.report, fingerprint, 'Accepted manifest bytes differ')
    same(accepted.storage, loaded.storage, 'Accepted evidence-part closure differs')
  }
  return loaded
}

export function createFullAppEvidenceWriter(filename, report) {
  assert.ok(plain(report)); assert.equal(existsSync(filename), false, 'Refusing an existing evidence report')
  const root = path.dirname(path.resolve(filename)), directory = path.basename(filename) + '.parts'
  assert.ok(lstatSync(root).isDirectory())
  const directoryPath = path.join(root, directory)
  mkdirSync(directoryPath) // Exclusive owned namespace; never mix previous runs.
  const storeID = randomUUID(), bound = binding(report), owner = sha(encode({ storeID, binding: bound }))
  const access = partAccess(filename, owner), cache = createFullAppEvidenceCache(), entries = [], byScene = new WeakMap(), written = new Set()
  const counters = { rawParts: 0, rawBytes: 0, sceneParts: 0, sceneBytes: 0, eventParts: 0, eventBytes: 0, partBytes: 0, checkpointBytes: 0, saves: 0, seals: 0 }
  let checkpoint = 0
  function writePart(kind, context, value) {
    const bytes = encode({ format: PART_FORMAT, storageVersion: VERSION, owner, kind, context, value })
    const digest = sha(bytes), file = directory + '/' + kind + '-' + digest + '.json'
    const ref = { file, kind, bytes: bytes.length, sha256: digest, context }
    if (!written.has(file)) {
      writeFileSync(path.join(root, ...file.split('/')), bytes, { flag: 'wx' })
      written.add(file); counters.partBytes += bytes.length
      if (kind === 'raw') { counters.rawParts++; counters.rawBytes += bytes.length }
      else if (kind === 'scene') { counters.sceneParts++; counters.sceneBytes += bytes.length }
      else { counters.eventParts++; counters.eventBytes += bytes.length }
    }
    return ref
  }
  function entryFor(scene, index) {
    let entry = byScene.get(scene)
    if (!entry) {
      assert.equal(index, entries.length, 'Evidence scenes must retain their original order')
      assert.ok(plain(scene) && Array.isArray(scene.rawSamples))
      entry = { scene, index, identity: identity(scene, index), raw: [], objects: [], sealed: null }
      entries.push(entry); byScene.set(scene, entry)
    }
    assert.equal(entry.index, index); same(identity(scene, index), entry.identity, 'Evidence scene identity changed')
    if (entry.sealed) return entry
    assert.ok(Array.isArray(scene.rawSamples) && scene.rawSamples.length >= entry.raw.length, 'Evidence raw sample prefix was removed')
    for (let i = 0; i < entry.raw.length; i++) assert.equal(scene.rawSamples[i], entry.objects[i], 'Evidence raw sample prefix was replaced or reordered')
    for (let i = entry.raw.length; i < scene.rawSamples.length; i++) {
      // JSON-domain snapshot owns its nested values; mutable page/aggregate
      // objects cannot later alter an already acknowledged observation.
      const sample = freeze(json(scene.rawSamples[i])), position = samplePosition(sample)
      const ref = writePart('raw', rawContext(entry, i, position), sample)
      ref.position = position
      scene.rawSamples[i] = sample; entry.objects.push(sample); entry.raw.push(ref)
    }
    return entry
  }
  function activeSlot(entry) {
    const metadata = json(without(entry.scene, ['rawSamples']))
    return { index: entry.index, identity: entry.identity, state: 'active', rawCount: entry.raw.length, keys: [...Object.keys(metadata), 'rawSamples'],
      value: { metadata, rawSamples: entry.raw } }
  }
  function prepare() {
    same(binding(report), bound, 'Evidence report changed its source/run binding')
    const body = without(report, ['fullAppUi'])
    let scenes = [], scenesPresent = false, events = null
    if (own(report, 'fullAppUi')) {
      const ui = report.fullAppUi
      if (plain(ui)) {
        body.fullAppUi = without(ui, ['scenes', 'events'])
        if (own(ui, 'scenes')) {
          assert.ok(Array.isArray(ui.scenes)); assert.ok(ui.scenes.length >= entries.length)
          scenesPresent = true
          scenes = ui.scenes.map((scene, index) => {
            if (entries[index]) assert.equal(scene, entries[index].scene, 'Evidence scene was removed or reordered')
            const entry = entryFor(scene, index)
            return entry.sealed || activeSlot(entry)
          })
        } else assert.equal(entries.length, 0)
        if (own(ui, 'events')) {
          if (Array.isArray(ui.events)) {
            events = { length: ui.events.length, parts: [] }
            for (let offset = 0; offset < ui.events.length; offset += EVENT_CHUNK) {
              const count = Math.min(EVENT_CHUNK, ui.events.length - offset)
              events.parts.push(writePart('events', { chunk: events.parts.length, offset, count }, ui.events.slice(offset, offset + count)))
            }
          } else body.fullAppUi.events = ui.events
        }
      } else body.fullAppUi = ui
    } else assert.equal(entries.length, 0)
    return { format: FULL_APP_STORAGE_FORMAT, storageVersion: VERSION, storeID, owner, binding: bound,
      checkpoint: checkpoint + 1, body, scenesPresent, sceneCount: scenes.length, scenes, events }
  }
  function save() {
    const bytes = encode(prepare())
    if (checkpoint === 0) writeFileSync(filename, bytes, { flag: 'wx' })
    else {
      // A failed write leaves the previous whole manifest. Unreferenced parts
      // are diagnostics only. Never overwrite an unexpected staging path.
      const temporary = filename + '.next'
      let ownedTemporary = false
      try {
        const fd = openSync(temporary, 'wx'); ownedTemporary = true
        try { writeFileSync(fd, bytes) } finally { closeSync(fd) }
        renameSync(temporary, filename); ownedTemporary = false
      } finally { if (ownedTemporary && existsSync(temporary)) unlinkSync(temporary) }
    }
    checkpoint++; counters.saves++; counters.checkpointBytes += bytes.length
  }
  function appendRaw(scene, sample) {
    const index = report.fullAppUi?.scenes.indexOf(scene)
    assert.ok(Number.isInteger(index) && index >= 0)
    const entry = entryFor(scene, index); assert.equal(entry.sealed, null, 'Cannot append after scene completion')
    scene.rawSamples.push(sample); entryFor(scene, index)
  }
  function sealScene(scene) {
    const index = report.fullAppUi?.scenes.indexOf(scene)
    assert.ok(Number.isInteger(index) && index >= 0)
    const entry = entryFor(scene, index)
    assert.equal(entry.sealed, null); assert.equal(scene.complete, true)
    assert.equal(scene.geometry?.valid, true); same(scene.geometry.failures, [])
    assert.ok(Object.isExtensible(scene) && Object.values(Object.getOwnPropertyDescriptors(scene)).every(value => value.configurable))
    const slot = activeSlot(entry), part = writePart('scene', sceneContext(slot), slot.value)
    entry.sealed = { index: slot.index, identity: slot.identity, state: 'sealed', rawCount: slot.rawCount, keys: slot.keys, part }
    try { save() } catch (error) { entry.sealed = null; throw error }
    // No producer mutates a successfully returned scene. Keep the same object
    // identity but release its bulky values only after its checkpoint commits.
    makeScene(entry.sealed, access, cache, owner, scene)
    entry.raw = entry.objects = null; cache.clear(); counters.seals++
  }
  return {
    save, appendRaw, sealScene,
    receipt() {
      assert.equal(report.complete, true, 'An incomplete report cannot claim storage acceptance')
      assert.ok(entries.every(entry => entry.sealed), 'Every successful scene must be sealed before acceptance')
      const loaded = readFullAppEvidence(filename)
      assert.equal(loaded.report.complete, true); assert.equal(loaded.storage.owner, owner)
      const current = prepare(); current.checkpoint = checkpoint
      assert.equal(sha(encode(current)), loaded.fingerprint.sha256, 'Live evidence changed after its last complete checkpoint')
      return loaded.storage
    },
    statistics() { return { ...counters, reads: access.statistics(), cache: cache.state(), activeScenes: entries.filter(entry => !entry.sealed).length } },
  }
}
