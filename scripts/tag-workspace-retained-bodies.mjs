import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
const sha256 = value => createHash('sha256').update(value).digest('hex')
// Called only after the verifier's application and backend have exited.
// The trash LIST endpoint intentionally omits content; it is not a body witness.
export function observeRetainedTagBodies(directory, { files, removedTagIds }) {
  assert.ok(path.isAbsolute(directory), 'Expected the established absolute data directory')
  assert.equal(lstatSync(directory).isSymbolicLink(), false, 'Linked data directory refused')
  const root = realpathSync.native(directory)
  assert.equal(root.toLowerCase(), path.resolve(directory).toLowerCase(), 'Redirected data directory refused')
  assert.ok(Array.isArray(files) && files.length > 0 && files.length <= 100)
  assert.equal(new Set(files.map(file => file.id)).size, files.length, 'Duplicate expected notes')
  for (const file of files) {
    assert.ok(typeof file.id === 'string' && file.id.length > 0)
    assert.equal(typeof file.content, 'string')
    assert.ok(file.deleted === 0 || file.deleted === 1)
  }
  assert.ok(Array.isArray(removedTagIds) && removedTagIds.length === 2)
  assert.equal(new Set(removedTagIds).size, 2)
  for (const id of removedTagIds) assert.ok(typeof id === 'string' && id.length > 0)
  const database = path.join(root, 'data.db')
  assert.ok(existsSync(database), 'Actual retained database missing')
  const snapshot = (capture = null) => Object.fromEntries(['data.db', 'data.db-wal', 'data.db-shm'].map(name => {
    const file = path.join(root, name)
    if (!existsSync(file)) return [name, null]
    const stat = lstatSync(file)
    assert.equal(stat.isSymbolicLink(), false, 'Linked database refused')
    assert.equal(stat.isFile(), true)
    assert.equal(realpathSync.native(file).toLowerCase(), path.resolve(file).toLowerCase(), 'Redirected database refused')
    const bytes = readFileSync(file)
    if (capture) capture.set(name, bytes)
    return [name, { bytes: bytes.length, sha256: sha256(bytes) }]
  }))
  // SQLite can create WAL/SHM sidecars even for a read-only connection. Never
  // open the retained original. Read an exact private copy, including any WAL,
  // and independently recheck all original bytes before and after observation.
  assert.equal(existsSync(path.join(root, 'data.db-journal')), false, 'Unexpected rollback journal')
  const captured = new Map(), before = snapshot(captured), bodies = {}, hashes = {}
  const copy = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'tag106-readonly-copy-')))
  let db, copyVerified = false, copyRemoved = false
  try {
    for (const [name, bytes] of captured) {
      const destination = path.join(copy, name)
      writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 })
      const actual = readFileSync(destination)
      assert.equal(actual.length, before[name].bytes, 'Snapshot byte length changed')
      assert.equal(sha256(actual), before[name].sha256, 'Snapshot bytes changed')
    }
    assert.deepEqual(snapshot(), before, 'Retained database changed during capture')
    copyVerified = true
    db = new DatabaseSync(path.join(copy, 'data.db'), { readOnly: true, allowExtension: false, timeout: 2000 })
    const get = db.prepare('SELECT id, content, is_deleted FROM files WHERE id=?')
    const links = db.prepare('SELECT COUNT(*) AS n FROM file_tags WHERE tag_id=?')
    const tags = db.prepare('SELECT COUNT(*) AS n FROM tags WHERE id=?')
    for (const expected of files) {
      const row = get.get(expected.id)
      assert.ok(row, 'Retained note missing: ' + expected.id)
      assert.equal(row.id, expected.id)
      assert.equal(row.content, expected.content, 'Retained body changed: ' + expected.id)
      assert.equal(row.is_deleted, expected.deleted, 'Retained trash state changed: ' + expected.id)
      bodies[row.id] = row.content
      hashes[row.id] = sha256(row.content)
    }
    for (const id of removedTagIds) {
      assert.equal(links.get(id).n, 0, 'Removed tag links remain')
      assert.equal(tags.get(id).n, 0, 'Removed tag remains')
    }
  } finally {
    try { db?.close() } finally {
      try { rmSync(copy, { recursive: true, force: true }); copyRemoved = !existsSync(copy) }
      finally { assert.deepEqual(snapshot(), before, 'Read-only body observation changed database bytes') }
    }
  }
  return { bodies, evidence: { method: 'stopped-backend-readonly-sqlite', readOnly: true,
    databaseFilesUnchanged: true, originalDatabaseOpened: false,
    observationLocation: 'verified-private-copy', snapshotVerified: copyVerified,
    snapshotRemoved: copyRemoved, snapshotFiles: before, normalRows: files.filter(file => !file.deleted).length,
    trashRows: files.filter(file => file.deleted).length, removedTagLinks: 0, removedTags: 0,
    databaseSHA256: before['data.db'].sha256, hashes } }
}
