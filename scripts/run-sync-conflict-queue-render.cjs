// The Node parent verifies durable evidence even if Electron exits with code 0
// before finishing. This file is test tooling, never loaded by the application.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const scenes = Object.freeze([
  ['light-1180', 1180, 10, '匹配 25 / 当前列表 25 条 · 显示 1–10'],
  ['dark-1180', 1180, 10, '匹配 25 / 当前列表 25 条 · 显示 1–10'],
  ['dark-560', 560, 10, '匹配 25 / 当前列表 25 条 · 显示 1–10'],
  ['dark-560-last-page', 560, 5, '匹配 25 / 当前列表 25 条 · 显示 21–25'],
  ['dark-560-search', 560, 1, '匹配 1 / 当前列表 25 条 · 显示 1–1'],
].map(Object.freeze))
const selectors = ['.sync-conflict-heading>strong', '.sync-queue-hint', '.sync-queue-search',
  '.sync-queue-tools input', '.sync-queue-tools select', '.sync-queue-count', '.sync-queue-identifiers',
  '.sync-conflict-item>div>strong', '.sync-conflict-item>div>span']
const rgb = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
function verifyQueueReport(report, expectedCommit = null) {
  if (report?.complete !== true || report.platform !== 'win32' || report.syntheticRecords !== true ||
      report.realComponents !== true || report.backendExercised !== false || report.navigationFocus !== true ||
      report.nativeSearch !== true || report.writes !== 0) throw new Error('Queue rendering did not finish all required checks')
  if (expectedCommit && report.commit !== expectedCommit) throw new Error('Queue rendering evidence belongs to another commit')
  if (!Array.isArray(report.reports) || report.reports.length !== scenes.length) throw new Error('Queue render scenario coverage is incomplete')
  report.reports.forEach((r, i) => {
    const [name, width, count, label] = scenes[i]
    if (r?.name !== name || r.ready !== true || !Number.isInteger(r.stableSamples) || r.stableSamples < 3 ||
        r.count !== count || r.label !== label || r.writes !== 0 || r.activeMarkup !== 0 ||
        !Number.isFinite(r.overflow) || r.overflow > 1 || !Array.isArray(r.bounds) || r.bounds.length !== 3 ||
        !r.bounds.every(Number.isFinite) || r.bounds[0] < 0 || r.bounds[1] <= 0 ||
        !Array.isArray(r.viewport) || r.viewport.length !== 2 || !r.viewport.every(n => Number.isInteger(n) && n >= 320) ||
        r.viewport[0] > width || r.viewport[1] > 900 || r.bounds[0] + r.bounds[1] > r.viewport[0] || r.bounds[2] <= 0 ||
        !Array.isArray(r.imageSize) || r.imageSize.length !== 2 || !r.imageSize.every(n => Number.isInteger(n) && n >= 320 && n <= 4096) ||
        r.imageSize[0] / r.viewport[0] < 1 || r.imageSize[0] / r.viewport[0] > 4 ||
        Math.abs(r.imageSize[0] / r.viewport[0] - r.imageSize[1] / r.viewport[1]) > 0.02) throw new Error('Invalid queue render scenario: ' + name)
    if (!Array.isArray(r.colors) || r.colors.length !== selectors.length || r.colors.some((c, n) =>
      c?.selector !== selectors[n] || c.finalColor !== true || !rgb(c.foreground) || !rgb(c.background) ||
      !Number.isFinite(c.ratio) || c.ratio < 4.5)) throw new Error('Queue render contrast evidence is incomplete: ' + name)
  })
  return report
}
function verifyQueueEvidence(output, expectedCommit = null) {
  const report = verifyQueueReport(JSON.parse(fs.readFileSync(path.join(output, 'checks.json'), 'utf8')), expectedCommit)
  for (const {name, imageSize} of report.reports) {
    const file = path.join(output, name + '.png'), info = fs.lstatSync(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size < 40) throw new Error('Queue screenshot missing or invalid: ' + name)
    const bytes = fs.readFileSync(file)
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
        bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== imageSize[0] || bytes.readUInt32BE(20) !== imageSize[1] ||
        bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') throw new Error('Unexpected queue screenshot dimensions/format: ' + name)
  }
  return report
}
function requireCompletedRender(child, output, expectedCommit) {
  if (!child || child.error || child.signal || child.status !== 0) throw new Error('Queue renderer process failed: ' + (child?.error?.message || child?.signal || child?.status))
  return verifyQueueEvidence(output, expectedCommit)
}
function run() {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-results', 'sync-conflict-queue')
  // App-owned generated test output only: stale screenshots must not satisfy a new run.
  fs.rmSync(output, { recursive: true, force: true })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawnSync(require('electron'), [path.join(__dirname, 'check-sync-conflict-queue-render.cjs')],
    { cwd: root, env, stdio: 'inherit', timeout: 70000, windowsHide: true })
  const report = requireCompletedRender(child, output, process.env.GITHUB_SHA || null)
  console.log(JSON.stringify({ verified: true, commit: report.commit, scenarios: scenes.map(([name]) => name) }))
}
module.exports = { verifyQueueReport, verifyQueueEvidence, requireCompletedRender, scenes, selectors }
if (require.main === module) {
  try { run() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
