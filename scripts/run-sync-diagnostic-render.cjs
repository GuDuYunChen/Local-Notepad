const fs = require('node:fs')
const path = require('node:path')
const { spawnSync, execFileSync } = require('node:child_process')
const { validateEvidence } = require('./sync-diagnostic-evidence.cjs')
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'test-results/sync-diagnostic')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
fs.rmSync(dir, { recursive: true, force: true })
const env = { ...process.env, NOTEPAD_DIAGNOSTIC_COMMIT: commit }
delete env.ELECTRON_RUN_AS_NODE
const child = spawnSync(require('electron'), [path.join(__dirname, 'check-sync-diagnostic-render.cjs')],
  { cwd: root, env, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 })
if (child.error || child.signal || child.status !== 0) throw new Error('Diagnostic renderer failed: ' + (child.error?.message || child.signal || child.stderr))
const report = JSON.parse(fs.readFileSync(path.join(dir, 'checks.json'), 'utf8'))
validateEvidence(report, commit, filename => fs.readFileSync(path.join(dir, filename)))
console.log('Current-commit diagnostic report, five PNGs and fallback-selection checks validated.')
