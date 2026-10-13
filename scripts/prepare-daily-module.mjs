import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const base = '7b133bf6c717536c81b6a74e8afd8ed992dfb9ce'
const blob = s => createHash('sha1').update('blob ' + Buffer.byteLength(s) + '\0').update(s).digest('hex')
const hash = s => createHash('sha256').update(s).digest('hex')
const expected = {
  'server/internal/controller/file.go': 'b2b509a6ad0e471b9a50a19ffc695cabebae1d9c',
  'scripts/check-desktop-save.mjs': '94d902dcc3adb97dec526d497d29cc51aa8713d7',
  'AGENTS.md': '69968300594e82300cec21fc3eba7d54d9b9052a',
  'package.json': 'dc69149eddbd6f68947323133469779bde0e6466',
  'package-lock.json': '7b0755819a26ef1ad8d63ae2d7a630c83c492fd9',
}
const runtime = ['src/services/dailyNotes.mjs','src/components/DailyNotesPanel.jsx','src/components/DailyNotesPanel.css','src/components/DailyNotesPanel.test.jsx','src/services/dailyNotes.test.js','scripts/daily-notes-cases.mjs','scripts/daily-notes.node.mjs','server/internal/dao/daily.go','server/internal/dao/daily_test.go','scripts/check-daily-notes-desktop.mjs','docs/LOCAL_DAILY_NOTES_2F88.md']
const replace = (s, a, b) => { assert.equal(s.split(a).length, 2, 'Expected one reviewed range: ' + a.slice(0, 80)); return s.replace(a, b) }
if (process.argv[2] === 'apply') {
  const original = Object.fromEntries(Object.entries(expected).map(([file, sha]) => { const s = fs.readFileSync(file, 'utf8'); assert.equal(blob(s), sha, file); return [file, s] }))
  fs.mkdirSync('daily-evidence', { recursive: true })
  fs.writeFileSync('daily-evidence/controller-before.go.txt', original['server/internal/controller/file.go'])
  let s = original['server/internal/controller/file.go']
  s = replace(s, '\t"database/sql"\n', ''); s = replace(s, '\t"time"\n', '')
  s = replace(s, '\tgroup.GET("/files/daily/{date}", c.DailyNote)', '\tgroup.GET("/files/daily/{date}", c.DailyNote)\n\tgroup.POST("/files/daily/{date}", c.DailyNote)')
  const a = s.indexOf('func (c *FileController) DailyNote('), b = s.indexOf('\nfunc (c *FileController) ListTemplates', a)
  assert.ok(a > 0 && b > a)
  const old = s.slice(a, b); assert.ok(old.includes('date = time.Now().Format("2006-01-02")') && old.includes('err != sql.ErrNoRows') && old.includes('c.FileLogic.Create('))
  s = s.slice(0, a) + `func (c *FileController) DailyNote(r *ghttp.Request) {
\tr.Response.Header().Set("Cache-Control", "no-store")
\tdate := r.Get("date").String()
\tif !dao.ValidDailyDate(date) {
\t\twriteErr(r, 1005, "每日笔记日期无效，需使用真实的 YYYY-MM-DD 日期", nil)
\t\treturn
\t}
\tfile, created, err := c.FileLogic.FileDAO.OpenDaily(r.GetCtx(), date, r.Get("read_only").Bool())
\tif err != nil {
\t\twriteErrWithDetail(r, 1006, "打开每日笔记失败", err)
\t\treturn
\t}
\twriteOK(r, g.Map{"file": file, "created": created})
}
` + s.slice(b)
  fs.writeFileSync('server/internal/controller/file.go', s)
  s = original['scripts/check-desktop-save.mjs']
  const anchor = '  await verifyVersionHistoryDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })'
  s = "import { verifyDailyNotesDesktop } from './check-daily-notes-desktop.mjs'\n" + replace(s, anchor, anchor + '\n  await verifyDailyNotesDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })')
  fs.writeFileSync('scripts/check-desktop-save.mjs', s)
  const paragraphs = original['AGENTS.md'].split('\n\n'); assert.ok(paragraphs[1].startsWith('Current local module: 2F.87 / 4.220.2'))
  paragraphs[1] = 'Current local module: 2F.88 / 4.221.0 complete local daily notes. Read docs/LOCAL_DAILY_NOTES_2F88.md. Base 7b133bf /4.220.2 history and real installer lifecycle are accepted in PR #2 comment 6144573069. Do not repeat them. Finish calendar/root-date identity, complete/error reads, atomic get-or-create, original editor save/reopen, cancellation and uncertain-create reconciliation, full current-source Windows and package/installation validation before another local module. No cloud/multi-device development. The rejected workspace-export workflow is not used or retried.'
  fs.writeFileSync('AGENTS.md', paragraphs.join('\n\n'))
  execFileSync('npm', ['run', 'version:minor'], { stdio: 'inherit' })
  const previous = JSON.parse(original['package-lock.json']), current = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
  assert.equal(current.version, '4.221.0'); assert.equal(current.packages[''].version, '4.221.0')
  current.version = previous.version; current.packages[''].version = previous.packages[''].version; assert.deepEqual(current, previous)
  execFileSync('node', ['scripts/check-app-version.mjs', '--previous-version=4.220.2'], { stdio: 'inherit' })
  execFileSync('gofmt', ['-w', 'server/internal/dao/daily.go', 'server/internal/dao/daily_test.go'], { stdio: 'inherit' })
  execFileSync('git', ['diff', '--check'], { stdio: 'inherit' })
  fs.writeFileSync('daily-evidence/prepared.json', JSON.stringify({ base, original: expected, version: '4.221.0', runtime, testsExecuted: false }, null, 2))
} else if (process.argv[2] === 'publish') {
  assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad'); assert.equal(process.env.GITHUB_REF, 'refs/heads/ci/local-history-2f87')
  const records = []
  for (const file of [...Object.keys(expected), ...runtime]) {
    const content = fs.readFileSync(file, 'utf8')
    const response = await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ content, encoding: 'utf-8' }) })
    assert.equal(response.status, 201, 'Source blob publication failed: ' + file); const result = await response.json(); assert.equal(result.sha, blob(content))
    const target = path.join('daily-evidence/source', file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content)
    records.push({ path: file, sha: result.sha, bytes: Buffer.byteLength(content), sha256: hash(content) })
  }
  fs.writeFileSync('daily-evidence/objects.json', JSON.stringify({ base, verifier: process.env.GITHUB_SHA, productRefUpdated: false, records }, null, 2))
} else throw Error('Expected apply or publish')
