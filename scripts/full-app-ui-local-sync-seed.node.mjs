// Pure fixture/denial contracts only. This file never starts the application.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { prepareLocalSyncLabNotes, canonicalLocalSyncRecord, buildLocalSyncLabRows, seedLocalSyncLab, snapshotLocalSyncLab } from './full-app-ui-local-sync-seed.mjs'
import { classifyLocalSyncLabRequest, validateLocalSyncLabPlan } from './check-local-sync-lab-desktop.mjs'
import { buildConflictTextDiff, conflictDiffPage } from '../src/services/syncConflictDiff.mjs'
import { captureConflictReview } from '../src/services/syncConflictReview.mjs'

const product = process.env.FULL_APP_CONTRACT_PRODUCT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainSource = readFileSync(path.join(product, 'server/cmd/notepad-server/main.go'), 'utf8')
const engineSource = readFileSync(path.join(product, 'server/internal/syncengine/engine.go'), 'utf8')
const closed = { appExit: { pid: 12000, code: 0, signal: null, nativeClose: true,
  backendExit: { pid: 12001, source: 'Win32_Process', processes: [], portClosed: true, complete: true } },
  backendStopped: true, portClosed: true, backendProcessExited: true,
  backendProcess: { pid: 12001, parentPid: 12000, executable: 'C:\\pure-fixture\\resources\\bin\\notepad-server.exe', createdAt: '2026-11-09T12:00:00.000Z', source: 'Win32_Process' } }
const json = JSON.stringify
async function filesFixture() {
  const files = []
  await prepareLocalSyncLabNotes({ api: async (url, options) => {
    if (options?.method === 'POST') {
      assert.equal(url, '/api/files'); const body = JSON.parse(options.body)
      const file = { id: 'pure-note-' + String(files.length + 1).padStart(2, '0'), title: body.title, content: body.content,
        created_at: 1735689600, updated_at: 1735689600, is_folder: false, parent_id: '', sort_order: (files.length + 1) * 1000,
        is_deleted: false, deleted_at: 0, is_pinned: false }
      files.push(file); return structuredClone(file)
    }
    const found = files.find(file => url === '/api/files/' + file.id); assert.ok(found); return structuredClone(found)
  } })
  return files
}

function actualProductMigrations(db) {
  const schema = mainSource.match(/`(CREATE TABLE IF NOT EXISTS schema_migrations[^`]+)`/)[1]
  db.exec(schema)
  const part = mainSource.slice(mainSource.indexOf('migrations := []struct'), mainSource.indexOf('\n\tvar currentVersion'))
  const starts = [...part.matchAll(/\bversion:\s*(\d+)/g)]
  assert.deepEqual(starts.map(item => Number(item[1])), Array.from({ length: 14 }, (_, i) => i + 1))
  const constants = {}
  for (const file of ['server/internal/dao/research.go', 'server/internal/dao/editor_save.go']) {
    for (const match of readFileSync(path.join(product, file), 'utf8').matchAll(/const (\w+) = `([\s\S]*?)`/g)) constants[match[1]] = match[2]
  }
  for (const [index, start] of starts.entries()) {
    const chunk = part.slice(start.index, starts[index + 1]?.index ?? part.length)
    const tokens = [...chunk.matchAll(/`([^`]+)`|("(?:[^"\\]|\\.)*")|dao\.(ResearchRequestsSchema|EditorSavesSchema|EditorSavesIndex|EditorSavesDelete)/g)]
    assert.ok(tokens.length)
    for (const token of tokens) db.exec(token[1] ?? (token[2] ? JSON.parse(token[2]) : constants[token[3]]))
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(Number(start[1]), 1735689600)
  }
}

async function databaseFixture(callback) {
  const ownedRoot = mkdtempSync(path.join(tmpdir(), 'local-sync-pure-')), dataDir = path.join(ownedRoot, 'data')
  mkdirSync(dataDir); mkdirSync(path.join(dataDir, 'uploads'))
  const files = await filesFixture(), db = new DatabaseSync(path.join(dataDir, 'data.db'))
  try {
    db.exec('PRAGMA foreign_keys=ON'); actualProductMigrations(db)
    const insert = db.prepare('INSERT INTO files(id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    for (const file of files) insert.run(file.id, file.title, file.content, file.created_at, file.updated_at, 0, '', file.sort_order, 0, 0, 0)
  } finally { db.close() }
  try { return await callback({ ownedRoot, dataDir, files, bootstrapClosed: structuredClone(closed) }) }
  finally { rmSync(ownedRoot, { recursive: true, force: true }) }
}
const mutateDB = (fixture, sql) => { const db = new DatabaseSync(path.join(fixture.dataDir, 'data.db')); try { db.exec(sql) } finally { db.close() } }

test('typed local seed changes only declared settings cells and 47 owned conflict rows in real product schema', async () => {
  await databaseFixture(fixture => {
    const receipt = seedLocalSyncLab(fixture)
    assert.equal(receipt.complete, true); assert.deepEqual(receipt.expectedCounts, { notes: 21, open: 21, history: 26 })
    assert.equal(receipt.after.logical.tables.find(table => table.name === 'sync_conflicts').rows.length, 47)
    assert.deepEqual(snapshotLocalSyncLab(fixture), receipt.after)
    assert.deepEqual(receipt.after.uploads, receipt.before.uploads); assert.equal(receipt.after.remote.exists, false)
    assert.throws(() => seedLocalSyncLab(fixture), /sync disabled|configuration/)
    assert.deepEqual(snapshotLocalSyncLab(fixture), receipt.after, 'Refused reseed must not alter data')
  })
})

test('a missing or abnormal actual shutdown refuses seeding before SQLite writes', async () => {
  await databaseFixture(fixture => {
    const before = snapshotLocalSyncLab(fixture)
    for (const modify of [value => { value.bootstrapClosed = null }, value => { value.bootstrapClosed.appExit.code = 1 },
      value => { value.bootstrapClosed.appExit.signal = 'SIGTERM' }, value => { value.bootstrapClosed.appExit.nativeClose = false },
      value => { value.bootstrapClosed.backendStopped = false }, value => { value.bootstrapClosed.portClosed = false },
      value => { value.bootstrapClosed.backendProcess.parentPid = 999 }, value => { value.bootstrapClosed.backendProcessExited = false },
      value => { value.bootstrapClosed.appExit.backendExit.pid = 999 }, value => { value.bootstrapClosed.appExit.backendExit.processes = [{ pid: 12001 }] },
      value => { value.bootstrapClosed.appExit.backendExit.portClosed = false }]) {
      const input = structuredClone(fixture); modify(input); assert.throws(() => seedLocalSyncLab(input))
      assert.deepEqual(snapshotLocalSyncLab(fixture), before)
    }
  })
})

test('owned path and absent remote checks refuse aliases and preexisting local stores', async () => {
  await databaseFixture(fixture => {
    assert.throws(() => snapshotLocalSyncLab({ ...fixture, dataDir: fixture.ownedRoot }), /fresh runner-owned/)
    mkdirSync(path.join(fixture.ownedRoot, 'elsewhere')); symlinkSync(fixture.dataDir, path.join(fixture.ownedRoot, 'elsewhere/data'), 'junction')
    assert.throws(() => snapshotLocalSyncLab({ dataDir: path.join(fixture.ownedRoot, 'elsewhere/data'), ownedRoot: path.join(fixture.ownedRoot, 'elsewhere') }), /link/)
    mkdirSync(path.join(fixture.dataDir, 'sync-lab-remote'))
    assert.throws(() => seedLocalSyncLab(fixture), /remain absent/)
  })
})

test('schema drift and unexpected trigger are rejected without altering the owned database', async () => {
  for (const sql of ['DELETE FROM schema_migrations WHERE version=14', 'ALTER TABLE sync_conflicts ADD COLUMN unexpected TEXT',
    "CREATE TRIGGER unexpected_seed_side_effect AFTER INSERT ON sync_conflicts BEGIN UPDATE files SET title='changed'; END"]) {
    await databaseFixture(fixture => {
      mutateDB(fixture, sql)
      const bytes = readFileSync(path.join(fixture.dataDir, 'data.db'))
      assert.throws(() => seedLocalSyncLab(fixture), /schema14|columns|trigger/)
      assert.deepEqual(readFileSync(path.join(fixture.dataDir, 'data.db')), bytes)
    })
  }
})

test('existing credentials, sync metadata or unowned data cannot enter the seeded fixture', async () => {
  for (const sql of ["UPDATE settings SET sync_password='fixture-secret'", "UPDATE sync_state SET remote_store_id='existing-store'",
    "INSERT INTO tags(id,name) VALUES('unowned','unowned')"]) {
    await databaseFixture(fixture => {
      mutateDB(fixture, sql); const before = snapshotLocalSyncLab(fixture)
      assert.throws(() => seedLocalSyncLab(fixture))
      assert.deepEqual(snapshotLocalSyncLab(fixture), before)
    })
  }
})

test('a forged API note or boolean type mismatch cannot alter real database notes', async () => {
  await databaseFixture(fixture => {
    const before = snapshotLocalSyncLab(fixture)
    for (const change of [file => { file.content += 'forged' }, file => { file.title += 'forged' }, file => { file.is_folder = 0 },
      file => { file.id = '../outside' }, file => { file.updated_at = Number.MAX_SAFE_INTEGER + 1 }, file => { file.title = '\ud800' }]) {
      const input = structuredClone(fixture); change(input.files[0]); assert.throws(() => seedLocalSyncLab(input))
      assert.deepEqual(snapshotLocalSyncLab(fixture), before)
    }
  })
})

test('synthetic conflict records are accepted by actual production review/diff readers with real groups and paging', async () => {
  const files = await filesFixture(), { rows } = buildLocalSyncLabRows(files), row = rows[0]
  const review = captureConflictReview({ ...row, local_record: JSON.parse(row.local_record), remote_record: JSON.parse(row.remote_record) }, '["real-owned-device","local-lab","","",""]')
  const diff = buildConflictTextDiff(review)
  assert.equal(diff.state, 'different'); assert.equal(diff.groups.length, 2)
  assert.equal(conflictDiffPage(diff, 0, 1).pages, 2)
  assert.equal(conflictDiffPage(diff, 0, 2).page, 2)
  assert.equal(conflictDiffPage(diff, 1, 1).pages, 1)
  assert.equal(rows.filter(item => item.status === 'open').length, 21)
  assert.equal(rows.filter(item => item.status !== 'open').length, 26)
})

test('canonical record bytes match actual product Go structs including HTML, Unicode and line escaping', async () => {
  const file = (await filesFixture())[0]; file.title = '合成 <tag> & 标题\u2028\u2029 😀'; file.content = 'quoted " text\n<&>\t\\'
  const expected = canonicalLocalSyncRecord(file), directory = mkdtempSync(path.join(tmpdir(), 'local-sync-go-record-'))
  try {
    const types = ['FilePayload', 'TagPayload', 'FileTagPayload', 'AttachmentPayload', 'Record'].map(name => {
      const match = engineSource.match(new RegExp('type ' + name + ' struct \\{[\\s\\S]*?\\n\\}'))
      assert.ok(match, 'Immutable product Go record declaration required: ' + name); return match[0]
    }).join('\n')
    const source = 'package main\nimport("encoding/json";"os")\n' + types + '\nfunc main(){var r Record;if err:=json.NewDecoder(os.Stdin).Decode(&r);err!=nil{panic(err)};b,e:=json.Marshal(r);if e!=nil{panic(e)};os.Stdout.Write(b)}\n'
    const filename = path.join(directory, 'record.go'); writeFileSync(filename, source)
    const go = process.env.FULL_APP_CONTRACT_GO || 'go'
    const result = spawnSync(go, ['run', filename], { cwd: directory, input: json(expected.record), encoding: 'utf8', timeout: 60000,
      env: { ...process.env, GOTOOLCHAIN: 'local', GO111MODULE: 'off' } })
    assert.equal(result.status, 0, result.stderr || String(result.error)); assert.equal(result.stdout, expected.text)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('local-lab network policy allows only its exact read paths, empty plan and theme-only save', () => {
  const request = (pathname, method = 'GET', postData) => ({ url: 'http://127.0.0.1:27121' + pathname, method, postData })
  assert.equal(classifyLocalSyncLabRequest(request('/api/sync/status')), 'read')
  assert.equal(classifyLocalSyncLabRequest(request('/api/sync/conflicts/history?filter=all&limit=25')), 'read')
  assert.equal(classifyLocalSyncLabRequest(request('/api/sync/plan', 'POST', '{}')), 'plan')
  assert.equal(classifyLocalSyncLabRequest(request('/api/settings', 'PUT', '{"theme":"dark"}')), 'theme')
  for (const input of [request('/api/sync/run', 'POST', '{}'), request('/api/sync/check', 'POST', '{}'), request('/api/sync/rebind', 'POST', '{}'),
    request('/api/sync/conflicts/a/resolve', 'POST', '{"side":"local"}'), request('/api/sync/auto', 'POST', '{}'),
    request('/api/sync/plan', 'POST', '{"initialize":true}'), request('/api/sync/plan', 'POST', '[]'), request('/api/sync/plan', 'POST', '1'),
    request('/api/sync/plan', 'POST', 'true'), request('/api/sync/plan', 'POST', 'null'), request('/api/sync/plan?x=1', 'POST', '{}'),
    request('/api/settings', 'PUT', '{"theme":"dark","sync_enabled":true}'), request('/api/files/a', 'DELETE'),
    { url: 'https://example.invalid/', method: 'GET' }, request('/api/s3/inspect')]) assert.throws(() => classifyLocalSyncLabRequest(input), /refuses/)
})

test('a plan with another object, digest or write direction cannot qualify as the real empty-remote preview', async () => {
  const files = await filesFixture(), built = buildLocalSyncLabRows(files)
  const seed = { noteIDs: files.map(file => file.id), records: built.records }
  const raw = { store_id: '', generation: 0, revision: '', needs_init: true, uploads: 21, downloads: 0, conflicts: 0, noops: 0,
    items: built.records.map(record => ({ id: record.itemID, action: 'upload', base_hash: '', local_hash: record.local, remote_hash: '' })) }
  assert.equal(validateLocalSyncLabPlan(raw, seed).detailState, 'complete')
  for (const change of [value => { value.items[0].id = 'other' }, value => { value.items[0].local_hash = 'a'.repeat(64) },
    value => { value.items[0].remote_hash = 'b'.repeat(64) }, value => { value.needs_init = false },
    value => { value.uploads = 20; value.downloads = 1; value.items[0].action = 'download' }]) {
    const bad = structuredClone(raw); change(bad); assert.throws(() => validateLocalSyncLabPlan(bad, seed))
  }
})
