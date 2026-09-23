import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readDatabaseBackupList, formatBackupDate, formatBackupSize, reviewBackupCoverage } from '../src/components/backupCenterUtils.js'

const session = () => ({ projectId: 'p1', entityId: 'e1', entityLabel: '关关',
  filters: { source: 'all', query: '', volumeId: null, page: 1 }, chapterId: 'c1',
  chapters: [{ id: 'c1', title: '第一章', ordinal: 1 }, { id: 'c2', title: '第二章', ordinal: 2 }],
  reviewedIds: ['c1'], annotations: { c2: { text: '需核对😀', needsChanges: true } } })
const shelf = data => ({ error: '', entries: [{ archive: { id: 'a1', savedAt: '2026-09-23T00:00:00.000Z', data } }] })
const backup = (path = 'b1', date = '2026-09-23T00:00:00.000Z') => ({ path, name: path + '.db', date, size: 1024 })

test('missing or unsuccessful bridge responses are not empty success', () => {
  for (const value of [null, undefined, {}, { success: false }, { success: true }, { success: true, backups: null }]) {
    assert.throws(() => readDatabaseBackupList(value))
  }
})
test('a successfully read empty database folder is distinct', () => {
  assert.deepEqual(readDatabaseBackupList({ success: true, backups: [] }), { backups: [], directory: '', latestPath: '' })
})
test('sorts backup timestamps rather than trusting IPC ordering or names', () => {
  const result = readDatabaseBackupList({ success: true, backups: [backup('z-old', '2026-09-21T00:00:00Z'), backup('a-new')] })
  assert.equal(result.latestPath, 'a-new'); assert.equal(result.backups[0].path, 'a-new')
})
test('unknown timestamps are never labeled latest', () => {
  assert.equal(readDatabaseBackupList({ success: true, backups: [backup('a', 'invalid')] }).latestPath, '')
})
test('invalid rows and duplicate paths fail as a whole instead of hiding missing data', () => {
  for (const rows of [[null], [12], [{}], [{ name: 'a' }], [backup(), backup()], [{ ...backup(), path: '' }]]) {
    assert.throws(() => readDatabaseBackupList({ success: true, backups: rows }))
  }
})
test('unknown sizes remain unknown and paths remain plain text', () => {
  const result = readDatabaseBackupList({ success: true, directory: '<img src=x>', backups: [{ ...backup(), size: -1, date: '' }] })
  assert.equal(result.directory, '<img src=x>'); assert.equal(result.backups[0].size, null)
})
test('formatters distinguish unknown values from zero-byte files', () => {
  for (const value of [null, undefined, '10', -1, Infinity, NaN]) assert.equal(formatBackupSize(value), '大小未知')
  assert.equal(formatBackupSize(0), '0 B'); assert.equal(formatBackupSize(1024), '1.0 KB')
  assert.equal(formatBackupSize(1024 ** 2), '1.0 MB'); assert.equal(formatBackupDate('bad'), '时间未知')
  assert.equal(formatBackupDate(null), '时间未知'); assert.notEqual(formatBackupDate('2026-09-23T00:00:00Z'), '时间未知')
})
test('database list validation neither mutates input nor retains mutable references', () => {
  const response = { success: true, backups: [backup()] }; const before = structuredClone(response)
  const result = readDatabaseBackupList(response); result.backups[0].name = 'modified'
  assert.deepEqual(response, before)
})
test('unavailable storage yields unknown counts, not zero', () => {
  for (const data of [null, {}, { entries: [], error: 'blocked' }]) {
    const result = reviewBackupCoverage(session(), data); assert.equal(result.state, 'unknown'); assert.equal(result.total, null)
  }
})
test('empty shelves report active work unsaved but inactive work separately', () => {
  const data = { error: '', entries: [] }
  assert.equal(reviewBackupCoverage(session(), data).state, 'unsaved')
  assert.equal(reviewBackupCoverage(null, data).state, 'inactive')
})
test('counts corrupt records against capacity without considering them saved proof', () => {
  const data = { error: '', entries: [{ archive: null }, { archive: null }] }
  const result = reviewBackupCoverage(session(), data)
  assert.equal(result.unreadable, 2); assert.equal(result.readable, 0); assert.equal(result.available, 38)
  assert.equal(result.state, 'unsaved')
})
test('exact archived metadata matches active records independent of runtime tokens', () => {
  const data = session(); const current = { ...data, id: 'runtime', content: 'must-not-save', returnRequest: {} }
  assert.equal(reviewBackupCoverage(current, shelf(data)).state, 'saved')
})
test('property order, reviewed set order and harmless empty annotations do not falsely warn', () => {
  const data = session(); data.annotations = {}; data.reviewedIds = ['c1', 'c2']
  const other = structuredClone(data); other.reviewedIds.reverse(); other.annotations.c1 = { needsChanges: false, text: '' }
  assert.equal(reviewBackupCoverage(other, shelf(data)).state, 'saved')
})
test('changed notes, flags, chapter positions and filters require a new snapshot', () => {
  for (const mutate of [d => { d.annotations.c2.text += ' ' }, d => { d.annotations.c2.needsChanges = false },
    d => { d.chapterId = 'c2' }, d => { d.filters.query = '第' }, d => { d.chapters.reverse() }, d => { d.reviewedIds = [] }]) {
    const data = session(); const other = structuredClone(data); mutate(other)
    assert.equal(reviewBackupCoverage(other, shelf(data)).state, 'unsaved')
  }
})
test('different projects or entities never satisfy a save match', () => {
  for (const field of ['projectId', 'entityId']) { const other = session(); other[field] = 'other'; assert.equal(reviewBackupCoverage(session(), shelf(other)).state, 'unsaved') }
})
test('a deleted matching snapshot no longer counts as saved', () => {
  assert.equal(reviewBackupCoverage(session(), shelf(session())).state, 'saved')
  assert.equal(reviewBackupCoverage(session(), { entries: [], error: '' }).state, 'unsaved')
})
test('chooses the latest matching save without confusing it with latest unrelated snapshot', () => {
  const data = shelf(session()); data.entries.push({ archive: { savedAt: '2026-09-24T00:00:00.000Z', data: session() } })
  const other = session(); other.chapterId = 'c2'; data.entries.push({ archive: { savedAt: '2026-09-25T00:00:00.000Z', data: other } })
  assert.equal(reviewBackupCoverage(session(), data).savedAt, '2026-09-24T00:00:00.000Z')
})
test('malformed current data yields unknown, never a false saved status', () => {
  assert.equal(reviewBackupCoverage({}, shelf(session())).state, 'unknown')
})
test('coverage checks do not mutate either active or stored metadata', () => {
  const active = session(), stored = shelf(session()), before = structuredClone({ active, stored })
  reviewBackupCoverage(active, stored); assert.deepEqual({ active, stored }, before)
})
test('full shelves report no available slots without implying automatic eviction', () => {
  const data = { entries: Array.from({ length: 40 }, () => ({ archive: null })), error: '' }
  assert.equal(reviewBackupCoverage(null, data).available, 0); assert.equal(data.entries.length, 40)
})
