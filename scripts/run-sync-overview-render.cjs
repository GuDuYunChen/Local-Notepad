const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { verifyOverviewEvidence } = require('./sync-overview-evidence.cjs')
const root = path.resolve(__dirname, '..'), directory = path.join(root, 'test-results', 'sync-overview')
fs.rmSync(directory, { recursive: true, force: true })
const result = spawnSync(require('electron'), [path.join(root, 'scripts/check-sync-overview-render.cjs')], {
  cwd: root, env: process.env, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024,
})
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
assert.ifError(result.error); assert.equal(result.signal, null); assert.equal(result.status, 0)
verifyOverviewEvidence(directory, process.env.GITHUB_SHA)
console.log('Current-commit complete six-scene overview evidence verified independently of Electron exit code.')
