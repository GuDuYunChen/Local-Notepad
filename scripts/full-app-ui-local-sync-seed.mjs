// Verifier-owned, isolated fixture preparation. Never runs sync or a backend.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { desktopNote } from './desktop-save-fixture.mjs'

export const LOCAL_SYNC_LAB_COUNTS = Object.freeze({ notes: 21, open: 21, history: 26 })
export const LOCAL_SYNC_LAB_SOURCE_FILES = Object.freeze([
  'server/cmd/notepad-server/main.go', 'server/internal/backup/backup.go', 'server/internal/model/file.go',
  'server/internal/syncengine/engine.go', 'server/internal/syncengine/recovery_runner.go',
  'server/internal/syncengine/conflict_history.go', 'server/internal/syncjob/policy.go',
  'src/services/syncConflictReview.mjs', 'src/services/syncConflictQueue.mjs',
  'src/services/syncConflictHistory.mjs', 'src/services/syncConflictDiff.mjs', 'src/services/syncPlanView.mjs',
])
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.stringify(value)
const clone = value => structuredClone(value)
const quote = name => { assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/); return '"' + name + '"' }
const fields = ['id', 'title', 'content', 'created_at', 'updated_at', 'is_folder', 'parent_id', 'sort_order', 'is_deleted', 'deleted_at', 'is_pinned']
const columns = {
  files: ['id', 'title', 'content', 'created_at', 'updated_at', 'tags', 'is_folder', 'parent_id', 'sort_order', 'is_deleted', 'deleted_at', 'is_pinned'],
  settings: ['id', 'theme', 'editor_opts', 'sync_enabled', 'sync_endpoint', 'sync_provider', 'sync_username', 'sync_password', 'sync_auto_enabled', 'sync_interval_minutes'],
  sync_state: ['id', 'device_id', 'remote_store_id', 'remote_revision', 'last_sync_at', 'last_status', 'last_error'],
  sync_base: ['item_id', 'object_hash', 'synced_at'],
  sync_conflicts: ['id', 'item_id', 'base_hash', 'local_hash', 'remote_hash', 'local_record', 'remote_record', 'created_at', 'status', 'resolution', 'resolved_at'],
}
const conflictDDL = `CREATE TABLE sync_conflicts (id TEXT PRIMARY KEY,item_id TEXT NOT NULL,base_hash TEXT NOT NULL,local_hash TEXT NOT NULL,remote_hash TEXT NOT NULL,local_record TEXT NOT NULL,remote_record TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'open',resolution TEXT NOT NULL DEFAULT '',resolved_at INTEGER NOT NULL DEFAULT 0)`
const normalizeDDL = sql => sql.replace(/IF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, '').replace(/;$/, '').toLowerCase()
const numbers = ['created_at', 'updated_at', 'sort_order', 'deleted_at']
const flags = ['is_folder', 'is_deleted', 'is_pinned']

function filePayload(file) {
  assert.ok(file && typeof file === 'object' && !Array.isArray(file))
  for (const key of ['id', 'title', 'content', 'parent_id']) {
    assert.equal(typeof file[key], 'string', 'Typed file string required: ' + key)
    assert.equal(Buffer.from(file[key], 'utf8').toString('utf8'), file[key], 'File strings must have valid Unicode scalar values')
  }
  assert.match(file.id, /^[A-Za-z0-9_-]{1,128}$/)
  assert.ok(file.title.trim() && file.title.length <= 255 && file.content.length <= 256 * 1024)
  for (const key of numbers) assert.ok(Number.isSafeInteger(file[key]) && file[key] >= 0, 'Typed file integer required: ' + key)
  for (const key of flags) assert.equal(typeof file[key], 'boolean', 'Typed file boolean required: ' + key)
  assert.equal(file.is_folder, false); assert.equal(file.is_deleted, false); assert.equal(file.is_pinned, false)
  assert.equal(file.parent_id, ''); assert.equal(file.deleted_at, 0)
  return Object.fromEntries(fields.map(key => [key, file[key]]))
}

// Go encoding/json preserves struct field order and escapes these five runes.
// The immutable product's Record/FilePayload types use exactly these fields.
export function canonicalLocalSyncRecord(file) {
  const payload = filePayload(file)
  const record = { format: 'local-notepad-sync-record', version: 1, kind: 'file', id: payload.id, state: 'present', file: payload }
  const text = json(record).replace(/[<>&\u2028\u2029]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'))
  return { record, text, sha256: sha(Buffer.from(text, 'utf8')) }
}

export async function prepareLocalSyncLabNotes({ api }) {
  assert.equal(typeof api, 'function')
  const files = []
  for (let index = 0; index < LOCAL_SYNC_LAB_COUNTS.notes; index++) {
    const title = `本机界面验收合成冲突 ${String(index + 1).padStart(2, '0')} —— 长标题与多行正文对照`
    const body = Array.from({ length: index === 0 ? 85 : 3 }, (_, line) => `共有段落 ${String(line + 1).padStart(2, '0')}：仅供隔离界面验收，不连接远端。`).join('\n')
    const content = desktopNote(title, body)
    const created = await api('/api/files', { method: 'POST', body: json({ title, content, parent_id: '' }) })
    assert.match(String(created?.id), /^[A-Za-z0-9_-]{1,128}$/)
    const file = await api('/api/files/' + encodeURIComponent(created.id))
    filePayload(file); assert.equal(file.content, content); assert.ok(file.title.startsWith(title))
    files.push(file)
  }
  assert.equal(new Set(files.map(file => file.id)).size, LOCAL_SYNC_LAB_COUNTS.notes)
  return files
}

export function buildLocalSyncLabRows(files) {
  assert.equal(files?.length, LOCAL_SYNC_LAB_COUNTS.notes)
  assert.equal(new Set(files.map(file => file.id)).size, files.length)
  const payloads = files.map(filePayload), rows = [], records = []
  for (const [index, file] of payloads.entries()) {
    const local = canonicalLocalSyncRecord(file), remoteFile = clone(file)
    const parsed = JSON.parse(file.content)
    assert.equal(parsed.root?.type, 'root'); assert.equal(parsed.root.children?.[1]?.type, 'paragraph')
    const textNode = parsed.root.children[1].children[0]
    assert.equal(textNode?.type, 'text'); assert.equal(typeof textNode.text, 'string')
    const lines = textNode.text.split('\n')
    // Two real separated change groups; the first has >60 diff rows, exposing
    // the existing diff paging controls without exceeding its computation cap.
    textNode.text = lines.map((line, position) => index === 0 && (position < 35 || position === 80) ? '合成另一端 ' + line : index !== 0 && position === 0 ? '合成另一端 ' + line : line).join('\n')
    remoteFile.content = json(parsed); remoteFile.title = '合成另一端 · ' + file.title
    const remote = canonicalLocalSyncRecord(remoteFile)
    assert.notEqual(local.sha256, remote.sha256)
    const row = { id: 'ui-lab-open-' + String(index + 1).padStart(2, '0'), item_id: file.id, base_hash: '',
      local_hash: local.sha256, remote_hash: remote.sha256, local_record: local.text, remote_record: remote.text,
      created_at: 1735689600 + index, status: 'open', resolution: '', resolved_at: 0 }
    rows.push(row); records.push({ itemID: file.id, local: local.sha256, remote: remote.sha256 })
  }
  for (let index = 0; index < LOCAL_SYNC_LAB_COUNTS.history; index++) {
    const original = rows[index % LOCAL_SYNC_LAB_COUNTS.open]
    rows.push({ ...original, id: 'ui-lab-history-' + String(index + 1).padStart(2, '0'), created_at: 1735600000 + index,
      status: index % 2 ? 'superseded' : 'resolved', resolution: index % 2 ? '' : index % 4 ? 'remote' : 'local', resolved_at: 1735601000 + index })
  }
  return { rows, records }
}

function ownPaths({ dataDir, ownedRoot }) {
  assert.equal(typeof dataDir, 'string'); assert.equal(typeof ownedRoot, 'string')
  const owned = path.resolve(ownedRoot), data = path.resolve(dataDir)
  // Windows realpathSync.native may use an 8.3 ancestor (RUNNER~1), even when
  // mkdtempSync returns the same real directory through its long name.
  // Compare canonical *identities*, not their differing lexical spellings.
  for (const entry of [owned, data]) { const info = lstatSync(entry); assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Owned directory must not be a link') }
  const actualOwned = realpathSync.native(owned), actualData = realpathSync.native(data)
  const temporaryRoot = realpathSync.native(path.resolve(tmpdir()))
  const relative = path.relative(temporaryRoot, actualOwned)
  assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Owned root must stay within the actual runner temporary directory')
  assert.equal(actualData, path.join(actualOwned, 'data'), 'Only the fresh runner-owned data child may be opened')
  const defaults = [path.join(homedir(), 'AppData/Roaming/Notepad'), path.join(homedir(), '.notepad'), path.join(homedir(), 'Library/Application Support/Notepad')]
  assert.ok(!defaults.some(item => path.resolve(item).toLowerCase() === data.toLowerCase()), 'Default user data is forbidden')
  const db = path.join(data, 'data.db'), remote = path.join(data, 'sync-lab-remote')
  for (const entry of [db, db + '-wal', db + '-shm']) if (existsSync(entry)) {
    const info = lstatSync(entry); assert.ok(info.isFile() && !info.isSymbolicLink(), 'SQLite input must be an owned ordinary file')
  }
  assert.ok(existsSync(db), 'Only a database already initialized by the actual product is allowed')
  assert.equal(existsSync(remote), false, 'The owned local-lab remote must remain absent')
  return { owned, data, db, remote }
}

function integrity(db) {
  const result = db.prepare('PRAGMA integrity_check').all()
  assert.deepEqual(result.map(row => Object.values(row)[0]), ['ok'], 'SQLite integrity check failed')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'SQLite foreign-key check failed')
}

function assertSchema(db) {
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version), Array.from({ length: 14 }, (_, i) => i + 1), 'Require the actual complete product schema14')
  for (const [table, expected] of Object.entries(columns)) {
    const actual = db.prepare('PRAGMA table_xinfo(' + quote(table) + ')').all()
    assert.deepEqual(actual.map(row => row.name), expected, 'Unexpected product table columns: ' + table)
    assert.ok(actual.every(row => row.hidden === 0), 'Unexpected hidden SQLite column')
  }
  const sql = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='sync_conflicts'").get()?.sql
  assert.equal(normalizeDDL(sql || ''), normalizeDDL(conflictDDL), 'Exact production conflict schema required')
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name IN ('sync_conflicts','settings','sync_state','sync_base')").all(), [], 'Unexpected fixture-table trigger')
  integrity(db)
}

const cell = value => typeof value === 'bigint' ? { integer: value.toString() } : value instanceof Uint8Array ? { blob: Buffer.from(value).toString('hex') } : value
function logicalSnapshot(db) {
  assertSchema(db)
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all().map(row => ({ ...row }))
  const tables = schema.filter(row => row.type === 'table').map(({ name }) => {
    const statement = db.prepare('SELECT * FROM ' + quote(name)); statement.setReadBigInts(true)
    const rows = statement.all().map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cell(value)])))
    assert.ok(rows.length <= 5000, 'Fresh fixture table exceeds bounded row budget')
    rows.sort((left, right) => json(left).localeCompare(json(right), 'en'))
    return { name, columns: db.prepare('PRAGMA table_xinfo(' + quote(name) + ')').all().map(row => ({ ...row })), rows }
  })
  return { schema, tables }
}

function uploadsSnapshot(data) {
  const root = path.join(data, 'uploads'), entries = []
  if (!existsSync(root)) return { exists: false, entries }
  const walk = directory => {
    const info = lstatSync(directory); assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Upload directory may not be linked')
    for (const name of readdirSync(directory).sort()) {
      const filename = path.join(directory, name), stat = lstatSync(filename)
      assert.equal(stat.isSymbolicLink(), false, 'Upload fixture may not contain links')
      const relative = path.relative(root, filename).split(path.sep).join('/')
      if (stat.isDirectory()) { entries.push({ relative, kind: 'directory' }); walk(filename) }
      else { assert.ok(stat.isFile()); entries.push({ relative, kind: 'file', bytes: stat.size, sha256: sha(readFileSync(filename)) }) }
    }
  }
  walk(root); return { exists: true, entries }
}

export function snapshotLocalSyncLab(options) {
  const { db: filename, data, remote } = ownPaths(options), db = new DatabaseSync(filename, { readOnly: true })
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA foreign_keys=ON')
    return { schemaVersion: 14, database: filename, logical: logicalSnapshot(db), uploads: uploadsSnapshot(data), remote: { path: remote, exists: false } }
  } finally { db.close() }
}

export function seedLocalSyncLab({ dataDir, ownedRoot, bootstrapClosed, files }) {
  assert.equal(bootstrapClosed?.appExit?.code, 0, 'Bootstrap App must exit normally before fixture seeding')
  assert.equal(bootstrapClosed.appExit.signal, null); assert.equal(bootstrapClosed.appExit.nativeClose, true)
  assert.ok(Number.isInteger(bootstrapClosed.appExit.pid) && bootstrapClosed.appExit.pid > 0)
  assert.equal(bootstrapClosed.backendStopped, true); assert.equal(bootstrapClosed.portClosed, true)
  const backend = bootstrapClosed.backendProcess, exit = bootstrapClosed.appExit.backendExit
  assert.equal(bootstrapClosed.backendProcessExited, true, 'The exact owned backend must be proven exited before SQLite access')
  assert.ok(Number.isSafeInteger(backend?.pid) && backend.pid > 0 && backend.pid <= 0xffffffff)
  assert.notEqual(backend.pid, bootstrapClosed.appExit.pid); assert.equal(backend.parentPid, bootstrapClosed.appExit.pid)
  assert.equal(backend.source, 'Win32_Process'); assert.equal(typeof backend.createdAt, 'string'); assert.ok(backend.createdAt)
  assert.equal(typeof backend.executable, 'string'); assert.match(backend.executable, /(?:^|[\\/])notepad-server\.exe$/i)
  assert.equal(exit?.pid, backend.pid); assert.equal(exit.source, 'Win32_Process'); assert.deepEqual(exit.processes, [])
  assert.equal(exit.portClosed, true); assert.equal(exit.complete, true)
  const paths = ownPaths({ dataDir, ownedRoot }), built = buildLocalSyncLabRows(files)
  const before = snapshotLocalSyncLab({ dataDir, ownedRoot }), db = new DatabaseSync(paths.db)
  let inTransaction = false, expectedLogical
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE'); inTransaction = true; assertSchema(db)
    assert.deepEqual(logicalSnapshot(db), before.logical, 'Database changed after the closed bootstrap snapshot')
    const settings = db.prepare('SELECT * FROM settings').all(); assert.equal(settings.length, 1); assert.equal(settings[0].id, 1)
    for (const name of ['sync_enabled', 'sync_auto_enabled']) assert.ok(settings[0][name] === null || settings[0][name] === 0, 'Fresh profile must start with sync disabled')
    for (const name of ['sync_endpoint', 'sync_username', 'sync_password', 'sync_provider']) assert.ok(settings[0][name] === null || settings[0][name] === '', 'No preexisting sync configuration is permitted')
    const state = db.prepare('SELECT * FROM sync_state').all(); assert.equal(state.length, 1); assert.equal(state[0].id, 1)
    assert.match(state[0].device_id, /^[a-f0-9]{32}$/)
    assert.equal(state[0].remote_store_id, ''); assert.equal(state[0].remote_revision, ''); assert.equal(state[0].last_sync_at, 0)
    for (const table of ['sync_base', 'sync_conflicts', 'file_tags', 'tags', 'links', 'file_versions', 'research_note_requests', 'editor_save_ops']) assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ' + quote(table)).get().total, 0, 'Fresh isolated fixture table is not empty: ' + table)
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM files').get().total, files.length, 'Unowned notes found in the fixture database')
    for (const file of files) {
      const actual = db.prepare('SELECT ' + fields.map(quote).join(',') + ' FROM files WHERE id=?').get(file.id)
      assert.ok(actual, 'Owned note missing from actual DB')
      for (const flag of flags) { assert.ok(actual[flag] === 0 || actual[flag] === 1); actual[flag] = actual[flag] === 1 }
      assert.deepEqual({ ...actual }, filePayload(file), 'Actual DB note differs from actual API receipt')
    }
    const update = db.prepare("UPDATE settings SET sync_enabled=1,sync_provider='local-lab',sync_endpoint='',sync_username='',sync_password='',sync_auto_enabled=0,sync_interval_minutes=5 WHERE id=1").run()
    assert.equal(Number(update.changes), 1)
    const insert = db.prepare('INSERT INTO sync_conflicts(' + columns.sync_conflicts.map(quote).join(',') + ') VALUES(' + columns.sync_conflicts.map(() => '?').join(',') + ')')
    for (const row of built.rows) insert.run(...columns.sync_conflicts.map(key => row[key]))
    integrity(db)
    const expected = clone(before.logical)
    const oldSettings = expected.tables.find(table => table.name === 'settings').rows[0]
    Object.assign(oldSettings, { sync_enabled: { integer: '1' }, sync_provider: 'local-lab', sync_endpoint: '', sync_username: '', sync_password: '', sync_auto_enabled: { integer: '0' }, sync_interval_minutes: { integer: '5' } })
    expected.tables.find(table => table.name === 'sync_conflicts').rows = built.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number.isInteger(value) ? { integer: String(value) } : value]))).sort((a, b) => json(a).localeCompare(json(b), 'en'))
    const afterLogical = logicalSnapshot(db)
    assert.deepEqual(afterLogical, expected, 'Seeding changed data outside the exact settings fields and conflict rows')
    expectedLogical = expected
    assert.deepEqual(uploadsSnapshot(paths.data), before.uploads); assert.equal(existsSync(paths.remote), false)
    db.exec('COMMIT'); inTransaction = false
  } catch (error) { if (inTransaction) db.exec('ROLLBACK'); throw error } finally { db.close() }
  const after = snapshotLocalSyncLab({ dataDir, ownedRoot })
  assert.deepEqual(after.logical, expectedLogical, 'Committed fixture differs from its verified transaction')
  assert.deepEqual(after.uploads, before.uploads)
  return { schemaVersion: 1, provenance: 'verifier-owned typed synthetic history; no sync was executed', noteIDs: files.map(file => file.id), files: clone(files),
    expectedCounts: clone(LOCAL_SYNC_LAB_COUNTS), bootstrapClosed: clone(bootstrapClosed), records: built.records,
    settingsBefore: clone(before.logical.tables.find(table => table.name === 'settings').rows[0]),
    before, after, seedDigest: sha(json({ after, records: built.records })), complete: true }
}
