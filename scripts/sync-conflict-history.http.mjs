// Real migrated Go server + isolated SQLite fixture. No user workspace, remote
// credentials, browser mocks or production sync operations are used.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'test-results', 'sync-conflict-history-http')
mkdirSync(out, { recursive: true })
const scratch = mkdtempSync(path.join(tmpdir(), 'notepad-history-http-'))
const data = path.join(scratch, 'data'); mkdirSync(data)
const bin = path.join(scratch, process.platform === 'win32' ? 'server.exe' : 'server')
let child, db, childExited = Promise.resolve(), output = '', requests = 0
const report = { commit: process.env.GITHUB_SHA || '', platform: process.platform, complete: false, realGoServer: true, migratedSQLite: true, syntheticRecords: true, checks: [] }
const save = () => writeFileSync(path.join(out, 'checks.json'), JSON.stringify(report, null, 2))
const check = name => report.checks.push(name)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  save()
  const built = spawnSync('go', ['build', '-o', bin, './cmd/notepad-server'], {
    cwd: path.join(root, 'server'), env: { ...process.env, CGO_ENABLED: '0' }, encoding: 'utf8', timeout: 180000,
  })
  assert.equal(built.error, undefined, 'Go build could not start'); assert.equal(built.status, 0, built.stderr)
  const listener = createServer(); await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  child = spawn(bin, [], { cwd: scratch, env: { ...process.env, NOTEPAD_DATA: data, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  childExited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve) })
  child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-64000) })
  child.stderr.on('data', bytes => { output = (output + bytes.toString()).slice(-64000) })
  const base = 'http://127.0.0.1:' + port
  const get = async suffix => {
    requests++
    const res = await fetch(base + suffix, { method: 'GET', headers: { Origin: 'null' }, signal: AbortSignal.timeout(5000) })
    assert.equal(res.ok, true); return res.json()
  }
  let ready = false
  for (let i = 0; i < 150; i++) {
    try { if ((await get('/api/health')).code === 0) { ready = true; break } } catch { /* Startup only. */ }
    if (child.exitCode !== null) break
    await sleep(100)
  }
  assert.equal(ready, true, 'Server did not become healthy: ' + output)
  db = new DatabaseSync(path.join(data, 'data.db')); db.exec('PRAGMA busy_timeout=2000')
  const route = '/api/sync/conflicts/history'
  const initial = await get(route)
  assert.equal(initial.code, 0); assert.deepEqual(initial.data.items, []); assert.equal(initial.data.scope, 'local-workspace')
  check('real default route and explicit empty page')
  const title = '📘'.repeat(254) + '记'
  db.prepare('INSERT INTO files(id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned) VALUES(?,?,?,10,10,0,\'\',0,0,0,0)').run('history-note', title, 'PRIVATE_NOTE_BODY')
  const insert = db.prepare("INSERT INTO sync_conflicts(id,item_id,base_hash,local_hash,remote_hash,local_record,remote_record,created_at,status,resolution,resolved_at) VALUES(?,?,'PRIVATE_HASH','PRIVATE_HASH','PRIVATE_HASH','PRIVATE_BODY','PRIVATE_BODY',10,?,?,?)")
  for (let i = 0; i < 63; i++) insert.run(String(i).padStart(32, '0'), 'history-note', i % 3 === 0 ? 'superseded' : 'resolved', i === 1 ? 'PRIVATE_RESOLUTION' : i % 3 === 0 ? 'remote-rebind' : i % 2 ? 'local' : 'remote', 200)
  insert.run('still-open', 'history-note', 'open', '', 0)
  const snapshot = () => JSON.stringify(['files','sync_conflicts','sync_base','sync_state','settings'].map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()))
  const before = snapshot()
  const pages = [], ids = new Set(); let cursor = ''
  do {
    const result = await get(route + '?filter=all&limit=25' + (cursor ? '&before=' + encodeURIComponent(cursor) : ''))
    assert.equal(result.code, 0); const page = result.data; assert.ok(page.items.length <= 25)
    assert.equal(page.version, 1); assert.equal(page.filter, 'all'); assert.equal(page.scope, 'local-workspace')
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|local_record|remote_record|base_hash|remote_hash|local_hash|password|endpoint/)
    for (const row of page.items) { assert.equal(ids.has(row.id), false);ids.add(row.id);assert.equal(row.current_title, title) }
    pages.push(page.items.length); cursor = page.next_cursor
    assert.equal(page.has_more, cursor !== '')
  } while (cursor && pages.length < 10)
  assert.deepEqual(pages, [25,25,13]); assert.equal(ids.size, 63); assert.equal(ids.has('still-open'), false)
  check('63 tied-time records across three keyset pages, Unicode title and privacy projection')
  for (const [filter, count] of [['resolved',42],['superseded',21]]) {
    const result = await get(route + '?filter=' + filter + '&limit=50')
    assert.equal(result.code, 0);assert.equal(result.data.items.length, count);assert.ok(result.data.items.every(row => row.status === filter))
  }
  check('resolved and superseded filters including prior-target rebind outcomes')
  const first = (await get(route + '?limit=1')).data
  for (const suffix of ['?filter=open','?limit=0','?limit=51','?limit=1.5','?limit=bad','?before=PRIVATE_invalid', '?filter=superseded&before=' + first.next_cursor]) {
    const result = await get(route + suffix); assert.notEqual(result.code, 0);assert.equal(result.data, null);assert.equal(result.detail, undefined);assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|SELECT|sqlite|sync_conflicts/)
  }
  check('invalid filters, limits and cursors fail without database or private error text')
  assert.equal(snapshot(), before)
  check('all history reads leave notes, conflicts, bases, settings and sync state unchanged')
  // A new record above a previously captured cursor must not shift its next page.
  insert.run('new-history', 'history-note', 'resolved', 'local', 400)
  const next = (await get(route + '?limit=1&before=' + first.next_cursor)).data
  assert.equal(next.items[0].id, String(61).padStart(32, '0'))
  assert.equal((await get(route + '?limit=1')).data.items[0].id, 'new-history')
  check('newer insert does not shift older-page cursor; explicit refresh sees it')
  db.prepare("UPDATE sync_conflicts SET resolved_at='PRIVATE_INVALID_TIMESTAMP' WHERE id='new-history'").run()
  const corrupt = await get(route)
  assert.notEqual(corrupt.code,0);assert.equal(corrupt.data,null);assert.equal(corrupt.detail,undefined);assert.doesNotMatch(JSON.stringify(corrupt), /PRIVATE_|Scan|sqlite/)
  check('corrupt rows are errors, not partial or empty success')
  report.complete = true;report.getRequests = requests; report.databaseFingerprint = createHash('sha256').update(before).digest('hex');save()
  console.log(JSON.stringify(report))
} finally {
  db?.close()
  if (child && child.exitCode === null) { child.kill(); await Promise.race([childExited, sleep(4000)]); if (child.exitCode === null) { child.kill('SIGKILL'); await Promise.race([childExited, sleep(2000)]) } }
  if (!report.complete) writeFileSync(path.join(out, 'server-diagnostic.log'), output)
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
