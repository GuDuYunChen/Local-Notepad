// Lossless storage only. This module never decides whether UI/native evidence
// passes: the existing validators still consume the reconstructed JSON values.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { types as stableJSONTypes } from 'node:util'

export const FULL_APP_STORAGE_FORMAT = 'local-notepad-full-app-ui-segmented'
const PART_FORMAT = FULL_APP_STORAGE_FORMAT + '-part'
const VERSION = 1
const EVENT_CHUNK = 1024
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const nativeJSONStringify = JSON.stringify
const nativeJSONStringifyEligible = typeof nativeJSONStringify === 'function' && !stableJSONTypes.isProxy(nativeJSONStringify) &&
  Function.prototype.toString.call(nativeJSONStringify) === 'function stringify() { [native code] }'
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

function partAccess(filename, owner, withStable = false) {
  const root = path.dirname(path.resolve(filename)), directory = path.basename(filename) + '.parts'
  const directoryPath = path.join(root, directory)
  const directoryStat = lstatSync(directoryPath)
  assert.ok(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'Evidence part directory must not be a link')
  const realDirectory = realpathSync(directoryPath)
  const reads = { rawParts: 0, rawBytes: 0, sceneParts: 0, sceneBytes: 0, eventsParts: 0, eventsBytes: 0 }
  if (withStable) Object.assign(reads, { stableParts: 0, stableBytes: 0 })
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
    if (kind === 'stable') {
      stableReceiptKeys(part, ['format', 'storageVersion', 'owner', 'kind', 'context', 'value'], 'Stable receipt part')
      assert.ok(part.value !== null && typeof part.value === 'object', 'Stable receipt part must retain its original object value')
    }
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
  if (manifest.storageVersion === 2) validateStableReceiptDescriptor(manifest)
  else assert.equal(manifest.storageVersion, VERSION, 'Unsupported evidence storage version')
  assert.ok(Number.isSafeInteger(manifest.checkpoint) && manifest.checkpoint > 0)
  assert.match(manifest.storeID || '', /^[a-f0-9-]{36}$/)
  assert.ok(plain(manifest.body) && plain(manifest.binding))
  same(binding(manifest.body), manifest.binding, 'Evidence manifest source binding differs')
  assert.equal(manifest.owner, sha(encode({ storeID: manifest.storeID, binding: manifest.binding })), 'Evidence manifest owner differs')
  assert.ok(Array.isArray(manifest.scenes))
  assert.equal(manifest.sceneCount, manifest.scenes.length, 'Evidence scene tail was omitted')
  assert.equal(typeof manifest.scenesPresent, 'boolean')
  const access = partAccess(filename, manifest.owner, manifest.storageVersion === 2), seen = new Set(), closure = createHash('sha256')
  let partBytes = 0, rawCount = 0
  const visit = ref => {
    assert.ok(plain(ref) && typeof ref.file === 'string')
    assert.equal(seen.has(ref.file), false, 'Duplicate or aliased evidence part')
    seen.add(ref.file); closure.update(encode(ref)); partBytes += ref.bytes
  }
  const report = manifest.body
  if (manifest.storageVersion === 2) restoreStableReceipts(manifest, access, visit)
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
    format: FULL_APP_STORAGE_FORMAT, storageVersion: manifest.storageVersion, owner: manifest.owner, checkpoint: manifest.checkpoint,
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

export function createFullAppEvidenceWriter(filename, report, options) {
  const storageVersion = stableReceiptWriterVersion(options)
  assert.ok(plain(report)); assert.equal(existsSync(filename), false, 'Refusing an existing evidence report')
  const root = path.dirname(path.resolve(filename)), directory = path.basename(filename) + '.parts'
  assert.ok(lstatSync(root).isDirectory())
  const directoryPath = path.join(root, directory)
  mkdirSync(directoryPath) // Exclusive owned namespace; never mix previous runs.
  const stableJSON = createFullAppStableJSONEncoder(report)
  const storeID = randomUUID(), bound = binding(report)
  stableJSON.privateProtocolSafe()
  const owner = sha(encode({ storeID, binding: bound }))
  stableJSON.cachePrivateDescriptor(bound)
  const access = partAccess(filename, owner, storageVersion === 2), cache = createFullAppEvidenceCache(), entries = [], byScene = new WeakMap(), written = new Set()
  const counters = { rawParts: 0, rawBytes: 0, sceneParts: 0, sceneBytes: 0, eventParts: 0, eventBytes: 0, partBytes: 0, checkpointBytes: 0, saves: 0, seals: 0 }
  if (storageVersion === 2) Object.assign(counters, { stableParts: 0, stableBytes: 0, stableReferences: 0, stableRefCacheHits: 0, v2Saves: 0, nativeFallbackSaves: 0 })
  const stableParts = storageVersion === 2 ? createStableReceiptProjection(writePart, counters, stableJSON) : null
  let checkpoint = 0
  function writePart(kind, context, value, { fragment } = {}) {
    stableJSON.privateProtocolSafe()
    const bytes = fragment ? Buffer.concat([
      Buffer.from(JSON.stringify({ format: PART_FORMAT, storageVersion: VERSION, owner, kind, context }).slice(0, -1) + ',"value":'),
      fragment, Buffer.from('}\n'),
    ]) : encode({ format: PART_FORMAT, storageVersion: VERSION, owner, kind, context, value })
    const digest = sha(bytes), file = directory + '/' + kind + '-' + digest + '.json'
    const ref = { file, kind, bytes: bytes.length, sha256: digest, context }
    if (!written.has(file)) {
      writeFileSync(path.join(root, ...file.split('/')), bytes, { flag: 'wx' })
      written.add(file); counters.partBytes += bytes.length
      if (kind === 'raw') { counters.rawParts++; counters.rawBytes += bytes.length }
      else if (kind === 'scene') { counters.sceneParts++; counters.sceneBytes += bytes.length }
      else if (kind === 'stable') { counters.stableParts++; counters.stableBytes += bytes.length }
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
    stableJSON.privateProtocolSafe()
    const publication = stableJSON.prepareManifest(prepare(), stableParts), bytes = publication.bytes
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
    publication.commit()
    if (storageVersion === 2) counters[publication.storageVersion === 2 ? 'v2Saves' : 'nativeFallbackSaves']++
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
    stableJSON.cachePrivateDescriptor(entry.sealed)
    try { save() } catch (error) { entry.sealed = null; throw error }
    // No producer mutates a successfully returned scene. Keep the same object
    // identity but release its bulky values only after its checkpoint commits.
    makeScene(entry.sealed, access, cache, owner, scene)
    entry.raw = entry.objects = null; cache.clear(); counters.seals++
  }
  return {
    save, appendRaw, sealScene, sealStableJSON: stableJSON.sealStableJSON,
    receipt() {
      assert.equal(report.complete, true, 'An incomplete report cannot claim storage acceptance')
      assert.ok(entries.every(entry => entry.sealed), 'Every successful scene must be sealed before acceptance')
      const loaded = readFullAppEvidence(filename)
      assert.equal(loaded.report.complete, true); assert.equal(loaded.storage.owner, owner)
      const current = prepare(); current.checkpoint = checkpoint
      stableJSON.privateProtocolSafe()
      if (loaded.storage.storageVersion === 2) comparePublishedStableReceipt(filename, current, loaded)
      else assert.equal(sha(encode(current)), loaded.fingerprint.sha256, 'Live evidence changed after its last complete checkpoint')
      return loaded.storage
    },
    statistics() { return { ...counters, reads: access.statistics(), cache: cache.state(), stableJSON: stableJSON.statistics(), activeScenes: entries.filter(entry => !entry.sealed).length } },
  }
}

// Explicitly published immutable receipts may reuse their original compact JSON.
// Every checkpoint and the final full native encoding/hash check remain intact.
const STABLE_JSON_COLLECTIONS = ['screenshots', 'fullAppUi.focus', 'fullAppUi.popups', 'fullAppUi.optionPointerPreparations']
const stableJSONAt = (root, route) => route.split('.').reduce((value, key) => value?.[key], root)

// No getter or toJSON is invoked. Return the exact original object graph, not a
// detached clone. Aliases are kept; cycles and custom/proxy objects are ineligible.
function stableJSONNodes(value, active = new Set(), seen = new Set(), result = [], trusted = null) {
  if (value === null || ['undefined', 'boolean', 'number', 'string'].includes(typeof value)) return result
  if (typeof value !== 'object' || stableJSONTypes.isProxy(value) || active.has(value)) return null
  if (trusted?.has(value) || seen.has(value)) return result
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value)
  if (proto !== (array ? Array.prototype : Object.prototype) && !(proto === null && !array)) return null
  if ('toJSON' in value) return null
  const keys = Object.keys(value), ownKeys = Reflect.ownKeys(value)
  if (array) {
    // Only dense own enumerable data indices. Native Get for holes, inherited
    // indices, hidden indices or extra properties is left to original stringify.
    if (keys.length !== value.length || ownKeys.length !== value.length + 1) return null
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null
    }
  } else if (ownKeys.length !== keys.length) return null
  active.add(value)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !stableJSONNodes(descriptor.value, active, seen, result, trusted)) return null
  }
  active.delete(value); seen.add(value); result.push(value)
  return result
}

function createFullAppStableJSONEncoder(report) {
  const sealed = new WeakMap()
  let privateDescriptors = new WeakMap(), privateSafe = nativeJSONStringifyEligible
  let published = new WeakMap(), lastPublishedManifest = null, publicationEligible = false
  const bytes = value => Buffer.from(value, 'utf8')
  const marks = Object.fromEntries(['{', '}', '[', ']', ',', '\n'].map(value => [value, bytes(value)]))
  const metrics = { sealedObjects: 0, sealedGraphNodes: 0, cachedHits: 0, ordinaryEncodes: 0, arrayFallbacks: 0,
    privateDescriptorEncodes: 0, privateDescriptorHits: 0, eligibleArrayReuses: 0 }
  const disablePrivate = () => { privateSafe = false; privateDescriptors = new WeakMap() }
  const privateProtocolSafe = () => {
    // Native hooks or an observing stringify wrapper can retain private objects.
    // Removing the hook later cannot prove those references did not escape.
    if (privateSafe && (JSON.stringify !== nativeJSONStringify || 'toJSON' in Object.prototype || 'toJSON' in Array.prototype)) disablePrivate()
    return privateSafe
  }
  privateProtocolSafe()
  const privateFragment = value => {
    const fragment = privateProtocolSafe() && value && typeof value === 'object' ? privateDescriptors.get(value) : undefined
    if (fragment) metrics.privateDescriptorHits++
    return fragment
  }
  const cachePrivateDescriptor = value => {
    // Only writer-owned bindings/envelopes call this capability. Their ordinary
    // graphs never change in the writer; do not freeze or clone caller objects.
    if (!privateProtocolSafe() || privateDescriptors.has(value) || !stableJSONNodes(value)) return
    privateDescriptors.set(value, bytes(JSON.stringify(value))); metrics.privateDescriptorEncodes++
  }
  const ordinary = value => value && typeof value === 'object' && !Array.isArray(value) && !stableJSONTypes.isProxy(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !('toJSON' in value) &&
    Object.keys(value).every(key => 'value' in Object.getOwnPropertyDescriptor(value, key))
  return {
    statistics: () => ({ ...metrics, privateCacheDisabled: !privateSafe }),
    privateProtocolSafe, cachePrivateDescriptor,
    sealStableJSON(collection, value, { protectedObjects = [] } = {}) {
      assert.ok(Array.isArray(protectedObjects), 'Stable JSON protected owners must be an Array')
      assert.ok(STABLE_JSON_COLLECTIONS.includes(collection), 'Unregistered producer collection')
      assert.ok(value && typeof value === 'object', 'Explicit sealed receipt must be an object')
      assert.ok(lastPublishedManifest && stableJSONAt(report, collection)?.includes(value), 'Sealed value is not the original published collection object')
      const nodes = stableJSONNodes(value)
      if (!nodes) return false // Still writable/fully encoded: unsupported shapes are never guessed immutable.
      if (!publicationEligible) return false // Whole native fallback must remain a non-disruptive optimization opt-out.
      const last = published.get(value)
      assert.ok(last, 'Explicit sealing requires successful publication of this exact object')
      const protectedNow = new Set([...protectedObjects, report, report.fullAppUi, report.fullAppUi?.scenes,
        report.fullAppUi?.events, report.runner, report.sourceFiles,
        ...STABLE_JSON_COLLECTIONS.map(name => stableJSONAt(report, name))])
      assert.ok(!nodes.some(node => protectedNow.has(node)), 'Refusing to freeze an active external owner')
      const encoded = bytes(JSON.stringify(value) ?? 'null')
      assert.deepEqual(encoded, last, 'Value changed since its last successful publication')
      // All fallible eligibility/publication checks precede the first freeze.
      // Only inert ordinary non-proxy nodes remain; no clone replaces the value.
      for (const node of nodes) Object.freeze(node)
      sealed.set(value, encoded); metrics.sealedObjects++; metrics.sealedGraphNodes += nodes.length
      return true
    },
    prepareManifest(manifest, stableParts = null) {
      const nextPublished = new WeakMap(), chunks = []
      privateProtocolSafe()
      const trusted = { has: value => sealed.has(value) || privateSafe && privateDescriptors.has(value) }
      const eligibleNodes = ordinary(manifest) && !('toJSON' in Object.prototype) && !('toJSON' in Array.prototype)
        ? stableJSONNodes(manifest, new Set(), new Set(), [], trusted) : null
      // A changed global JSON protocol must not be hidden by cached inert data.
      if (!eligibleNodes) {
        disablePrivate()
        const encoded = encode(manifest)
        return { bytes: encoded, commit() { published = nextPublished; lastPublishedManifest = manifest; publicationEligible = false } }
      }
      // Qualify the original manifest before projecting any sealed value. A
      // native protocol fallback above remains the original whole v1 encoding.
      const projection = stableParts?.(manifest)
      // This proof belongs to this synchronous encoding only. Mutable arrays
      // and values are checked again at every save, including order/shape.
      const eligible = new Set(eligibleNodes)
      function arrayFragments(value, collection) {
        const reuse = Array.isArray(value) && privateProtocolSafe() && eligible.has(value)
        if (reuse) metrics.eligibleArrayReuses++
        else {
          if (!Array.isArray(value) || stableJSONTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || 'toJSON' in value) return null
          const keys = Object.keys(value)
          if (keys.length !== value.length || Reflect.ownKeys(value).length !== value.length + 1 ||
              keys.some(key => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) return null
        }
        const encoded = []
        for (let index = 0; index < value.length; index++) {
          const descriptor = reuse ? null : Object.getOwnPropertyDescriptor(value, String(index))
          if (!reuse && (!descriptor || !descriptor.enumerable || !('value' in descriptor))) return null
          const item = reuse ? value[index] : descriptor.value
          const cached = item && typeof item === 'object' ? sealed.get(item) : undefined
          let fragment = cached
          if (fragment) metrics.cachedHits++
          else {
            if (!reuse && !stableJSONNodes(item)) return null
            fragment = bytes(JSON.stringify(item) ?? 'null'); metrics.ordinaryEncodes++
          }
          if (item && typeof item === 'object') nextPublished.set(item, fragment)
          encoded.push(projection && cached && STABLE_RECEIPT_COLLECTIONS.includes(collection)
            ? projection.fragment(collection, index, item, fragment) : fragment)
        }
        return encoded
      }
      function sceneFragments(value) {
        if (!privateProtocolSafe() || !eligible.has(value)) return null
        return value.map(item => privateFragment(item) || bytes(JSON.stringify(item) ?? 'null'))
      }
      function object(value, currentPath) {
        chunks.push(marks['{']); let count = 0
        for (const key of Object.keys(value)) {
          const route = currentPath ? currentPath + '.' + key : key
          const item = route === 'stableReceipts' && projection ? projection.finishDescriptor() : value[key]
          const selected = route.startsWith('body.') && STABLE_JSON_COLLECTIONS.includes(route.slice(5)), nested = ['body', 'body.fullAppUi'].includes(route) && ordinary(item)
          const array = selected ? arrayFragments(item, route.slice(5)) : route === 'scenes' ? sceneFragments(item) : null
          if (selected && !array) metrics.arrayFallbacks++
          const cached = !nested && !array ? privateFragment(item) : null
          const encoded = !nested && !array && !cached ? JSON.stringify({ [key]: item }).slice(1, -1) : null
          if (encoded === '') continue
          if (count++) chunks.push(marks[','])
          if (array) {
            chunks.push(bytes(JSON.stringify(key) + ':'), marks['['])
            for (let index = 0; index < array.length; index++) {
              if (index) chunks.push(marks[','])
              chunks.push(array[index])
            }
            chunks.push(marks[']'])
          } else if (cached) {
            chunks.push(bytes(JSON.stringify(key) + ':'), cached)
          } else if (nested) {
            chunks.push(bytes(JSON.stringify(key) + ':')); object(item, route)
          } else chunks.push(bytes(encoded))
        }
        chunks.push(marks['}'])
      }
      object(projection?.manifest || manifest, ''); chunks.push(marks['\n'])
      const encoded = Buffer.concat(chunks)
      // A real writer must call this only after its original atomic save succeeds.
      return { bytes: encoded, storageVersion: projection ? 2 : VERSION,
        commit() { projection?.commit(); published = nextPublished; lastPublishedManifest = manifest; publicationEligible = true } }
    },
  }
}

// Explicit opt-in v2 is a compatible format extension, not a change to default
// v1 or to the semantic validators. Only these three producer capabilities can
// offload data. Original screenshots, mutable values and failures stay inline.
const STABLE_RECEIPT_COLLECTIONS = ['fullAppUi.focus', 'fullAppUi.popups', 'fullAppUi.optionPointerPreparations']
const STABLE_RECEIPT_FORMAT = FULL_APP_STORAGE_FORMAT + '-sealed-receipts'
function stableReceiptWriterVersion(options) {
  if (options === undefined) return VERSION
  stableReceiptKeys(options, ['storageVersion'], 'Evidence writer options')
  assert.ok([VERSION, 2].includes(options.storageVersion), 'Unsupported evidence storage version')
  return options.storageVersion
}
function stableReceiptKeys(value, keys, label) {
  assert.ok(plain(value), label + ' must be an object')
  same(Object.keys(value), keys, label + ' fields differ')
}
function validateStableReceiptDescriptor(manifest) {
  assert.ok(plain(manifest.stableReceipts), 'A v2 receipt descriptor is required')
  stableReceiptKeys(manifest.stableReceipts, ['format', 'schemaVersion', 'collections'], 'Stable receipt descriptor')
  assert.equal(manifest.stableReceipts.format, STABLE_RECEIPT_FORMAT, 'Stable receipt descriptor format differs')
  assert.equal(manifest.stableReceipts.schemaVersion, 1, 'Stable receipt descriptor version differs')
  assert.ok(Array.isArray(manifest.stableReceipts.collections), 'Stable receipt collections are required')
  assert.equal(manifest.stableReceipts.collections.length, STABLE_RECEIPT_COLLECTIONS.length, 'Stable receipt collection roster differs')
}
function restoreStableReceipts(manifest, access, visit) {
  const ui = own(manifest.body, 'fullAppUi') ? manifest.body.fullAppUi : undefined
  for (const [order, collection] of STABLE_RECEIPT_COLLECTIONS.entries()) {
    const descriptor = manifest.stableReceipts.collections[order], key = collection.slice('fullAppUi.'.length)
    assert.ok(plain(descriptor), 'Stable receipt collection descriptor is required')
    assert.equal(descriptor.path, collection, 'Stable receipt collection order or path differs')
    const present = plain(ui) && own(ui, key), value = present ? ui[key] : undefined
    if (descriptor.state === 'absent') {
      stableReceiptKeys(descriptor, ['path', 'state'], 'Absent stable receipt collection')
      assert.equal(present, false, 'Absent receipt collection has inline data')
    } else if (descriptor.state === 'inline') {
      stableReceiptKeys(descriptor, ['path', 'state'], 'Inline stable receipt collection')
      assert.ok(present && !Array.isArray(value), 'Inline receipt collection type differs')
    } else {
      assert.equal(descriptor.state, 'array', 'Unknown stable receipt collection state')
      stableReceiptKeys(descriptor, ['path', 'state', 'length', 'entries'], 'Array stable receipt collection')
      assert.ok(present && Array.isArray(value), 'Stable receipt collection Array is required')
      assert.ok(Number.isSafeInteger(descriptor.length) && descriptor.length >= 0, 'Stable receipt collection length is invalid')
      assert.equal(descriptor.length, value.length, 'Stable receipt collection length differs')
      assert.ok(Array.isArray(descriptor.entries), 'Stable receipt ordinal entries are required')
      assert.equal(descriptor.entries.length, descriptor.length, 'Stable receipt entry length differs')
      for (const [index, entry] of descriptor.entries.entries()) {
        assert.ok(plain(entry), 'Stable receipt ordinal entry is required')
        assert.equal(entry.index, index, 'Stable receipt ordinal differs')
        if (entry.mode === 'inline') stableReceiptKeys(entry, ['index', 'mode'], 'Inline stable receipt entry')
        else {
          assert.equal(entry.mode, 'part', 'Unknown stable receipt entry mode')
          stableReceiptKeys(entry, ['index', 'mode', 'ref'], 'Stable receipt part entry')
          stableReceiptKeys(entry.ref, ['file', 'kind', 'bytes', 'sha256', 'context'], 'Stable receipt reference')
          stableReceiptKeys(entry.ref.context, ['collection', 'ordinal'], 'Stable receipt context')
          assert.equal(value[index], null, 'Stable receipt part placeholder must be null')
          visit(entry.ref)
          value[index] = access.read(entry.ref, 'stable', { collection, ordinal: index })
        }
      }
    }
  }
}
function createStableReceiptProjection(writePart, counters, stableJSON) {
  const refs = new WeakMap(), placeholder = Buffer.from('null'), inlineEntries = []
  let previousDescriptor = null
  return manifest => {
    const pending = []
    const collections = STABLE_RECEIPT_COLLECTIONS.map(collection => {
      const ui = own(manifest.body, 'fullAppUi') ? manifest.body.fullAppUi : undefined
      const key = collection.slice('fullAppUi.'.length), value = plain(ui) && own(ui, key) ? ui[key] : undefined
      if (value === undefined) return { path: collection, state: 'absent' }
      if (!Array.isArray(value)) return { path: collection, state: 'inline' }
      return { path: collection, state: 'array', length: value.length,
        entries: value.map((_, index) => stableJSON.privateProtocolSafe()
          ? inlineEntries[index] ||= { index, mode: 'inline' } : { index, mode: 'inline' }) }
    })
    let descriptor = { format: STABLE_RECEIPT_FORMAT, schemaVersion: 1, collections }
    return {
      manifest: { ...manifest, storageVersion: 2,
        stableReceipts: descriptor },
      fragment(collection, ordinal, value, fragment) {
        const contexts = refs.get(value)
        const contextKey = collection + ':' + ordinal
        let entry = contexts?.get(contextKey)
        counters.stableReferences++; if (entry) counters.stableRefCacheHits++
        if (!entry) {
          const ref = writePart('stable', { collection, ordinal }, value, { fragment })
          entry = { index: ordinal, mode: 'part', ref }
          pending.push({ value, contextKey, entry })
        }
        collections[STABLE_RECEIPT_COLLECTIONS.indexOf(collection)].entries[ordinal] = stableJSON.privateProtocolSafe()
          ? entry : { index: ordinal, mode: 'part', ref: entry.ref }
        return placeholder
      },
      finishDescriptor() {
        if (stableJSON.privateProtocolSafe()) {
          const unchanged = previousDescriptor && collections.every((current, index) => {
            const previous = previousDescriptor.collections[index]
            return current.path === previous.path && current.state === previous.state &&
              (current.state !== 'array' || current.length === previous.length && current.entries.every((entry, ordinal) => entry === previous.entries[ordinal]))
          })
          if (unchanged) descriptor = previousDescriptor
          else stableJSON.cachePrivateDescriptor(descriptor)
        }
        return descriptor
      },
      commit() {
        for (const { value, contextKey, entry } of pending) {
          let contexts = refs.get(value)
          if (!contexts) { contexts = new Map(); refs.set(value, contexts) }
          contexts.set(contextKey, entry)
        }
        previousDescriptor = stableJSON.privateProtocolSafe() ? descriptor : null
      },
    }
  }
}

function comparePublishedStableReceipt(filename, current, loaded) {
  // The caller already verified the actual manifest and every referenced part.
  // Re-read exactly those manifest bytes, then restore only its published v2
  // slots. A newly granted private seal is not a new checkpoint or business edit.
  const bytes = readFileSync(filename)
  assert.equal(bytes.length, loaded.fingerprint.bytes, 'Evidence changed while reading its published representation')
  assert.equal(sha(bytes), loaded.fingerprint.sha256, 'Evidence changed while reading its published representation')
  const committed = JSON.parse(bytes.toString('utf8'))
  validateStableReceiptDescriptor(committed)
  restoreStableReceipts(committed, partAccess(filename, committed.owner, true), () => {})
  committed.storageVersion = VERSION
  delete committed.stableReceipts
  // Exactly one fresh native encoding of live values. Do not stringify the
  // parsed committed copy: a later global toJSON must not receive extra calls.
  const live = JSON.parse(encode(current).toString('utf8'))
  const message = 'Live evidence changed after its last complete checkpoint'
  same(live, committed, message)
  const order = (actual, expected) => {
    if (expected !== null && typeof expected === 'object') {
      same(Object.keys(actual), Object.keys(expected), message)
      for (const key of Object.keys(expected)) order(actual[key], expected[key])
    }
  }
  order(live, committed)
}

