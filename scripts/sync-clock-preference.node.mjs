import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SYNC_CLOCK_PREFERENCE_KEY as KEY, readSyncClockPreference as read, saveSyncClockPreference as save, clearSyncClockPreference as clear } from '../src/services/syncClockPreference.mjs'
function fixture(value = null) {
  const calls = [], map = new Map([['theme', 'dark']])
  if (value !== null) map.set(KEY, value)
  const storage = {
    getItem(key) { calls.push(['get', key]); return map.has(key) ? map.get(key) : null },
    setItem(key, value) { calls.push(['set', key, value]); map.set(key, value) },
    removeItem(key) { calls.push(['remove', key]); map.delete(key) },
  }
  return { calls, map, storage, resolve: () => storage }
}
for (const mode of ['utc', 'local']) test('reads only a remembered ' + mode + ' mode without writes', () => {
  const f = fixture(mode), v = read(f.resolve)
  assert.deepEqual(v, { mode, status: 'saved' }); assert.ok(Object.isFrozen(v)); assert.deepEqual(f.calls, [['get', KEY]])
})
for (const value of [null, '', 'UTC', 'Asia/Shanghai', '__proto__', 'constructor', 'PRIVATE_<script>', '{"mode":"local"}', 'x'.repeat(5000), false, 3, {}]) test('missing or invalid preference is not coerced: ' + String(value).slice(0, 25), () => {
  const f = fixture(value), v = read(f.resolve)
  assert.equal(v.mode, null); assert.equal(v.status, value === null ? 'empty' : 'invalid')
  assert.equal(f.calls.length, 1); assert.doesNotMatch(JSON.stringify(v), /PRIVATE|Asia\/|constructor|__proto__|<script>/)
})
test('storage access and getter exceptions are contained and private errors are not returned', () => {
  for (const resolve of [() => { throw new Error('PRIVATE') }, () => undefined, () => null, () => ({ get getItem() { throw new Error('PRIVATE') } })]) {
    assert.deepEqual(read(resolve), { mode: null, status: 'unavailable' })
    assert.equal(save('local', resolve), false); assert.equal(clear(resolve), false)
  }
})
test('invalid saves are refused before requesting storage or converting values', () => {
  let count = 0
  for (const value of [null, {}, false, 1, 'constructor', 'local ', { toString() { throw Error() } }]) assert.equal(save(value, () => { count++; throw Error() }), false)
  assert.equal(count, 0)
})
for (const mode of ['utc', 'local']) test('explicitly saves and verifies just the ' + mode + ' literal', () => {
  const f = fixture(); assert.equal(save(mode, f.resolve), true)
  assert.deepEqual(f.calls, [['set', KEY, mode], ['get', KEY]]); assert.equal(f.map.get('theme'), 'dark')
  assert.equal(f.map.size, 2); assert.deepEqual(read(f.resolve), { mode, status: 'saved' })
})
test('failed write or failed readback never reports saved', () => {
  for (const storage of [
    { setItem() { throw Error('PRIVATE') }, getItem() { return 'local' } },
    { setItem() {}, getItem() { return 'utc' } },
    { setItem() {}, getItem() { throw Error('PRIVATE') } },
  ]) assert.equal(save('local', () => storage), false)
})
test('clearing removes only this preference and leaves other storage intact', () => {
  const f = fixture('local'); assert.equal(clear(f.resolve), true)
  assert.deepEqual(f.calls, [['remove', KEY], ['get', KEY]]); assert.equal(f.map.get('theme'), 'dark'); assert.equal(f.map.size, 1)
  assert.equal(read(f.resolve).mode, null); assert.equal(clear(f.resolve), true)
})
test('failed removal or unverified removal never reports cleared', () => {
  for (const storage of [
    { removeItem() { throw Error('PRIVATE') }, getItem() { return null } },
    { removeItem() {}, getItem() { return 'local' } },
    { removeItem() {}, getItem() { throw Error('PRIVATE') } },
  ]) assert.equal(clear(() => storage), false)
})
test('reopening re-reads the current preference instead of a module cache', () => {
  const f = fixture(); assert.equal(read(f.resolve).mode, null)
  save('local', f.resolve); assert.equal(read(f.resolve).mode, 'local')
  save('utc', f.resolve); assert.equal(read(f.resolve).mode, 'utc')
  clear(f.resolve); assert.equal(read(f.resolve).mode, null)
})
test('no storage enumeration, global clearing, sync settings, credentials or IO', () => {
  const s = readFileSync(new URL('../src/services/syncClockPreference.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(s, /\.clear\(|\.key\(|JSON\.parse|\bfetch\(|electronAPI|sessionStorage|setInterval|setTimeout|sync_password|sync_endpoint|addEventListener/)
})
