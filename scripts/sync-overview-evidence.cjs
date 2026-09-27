const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const names = ['light', 'dark', 'narrow', 'uncertain', 'unavailable', 'disabled']
function verifyOverviewEvidence(directory, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/)
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'checks.json'), 'utf8'))
  assert.equal(report.commit, commit); assert.equal(report.platform, 'win32'); assert.equal(report.complete, true)
  assert.equal(report.realComponents, true); assert.equal(report.syntheticRecords, true); assert.equal(report.backendExercised, false)
  assert.equal(report.nativeFocus, true); assert.equal(report.writes, 0)
  assert.deepEqual(report.scenes.map(scene => scene.name), names)
  for (const scene of report.scenes) {
    assert.ok(scene.stableSamples >= 3); assert.equal(scene.writes, 0); assert.equal(scene.activeMarkup, 0); assert.equal(scene.navCount, 5)
    assert.ok(Number.isFinite(scene.overflow) && scene.overflow <= 1)
    assert.ok(scene.colors.length >= 12 && scene.colors.every(color => color.final === true && Number.isFinite(color.ratio) && color.ratio >= 4.5))
    assert.equal(scene.png, scene.name + '.png')
    const bytes = fs.readFileSync(path.join(directory, scene.png))
    assert.equal(bytes.length, scene.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), scene.sha256)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(bytes.readUInt32BE(16), scene.viewport.width); assert.equal(bytes.readUInt32BE(20), scene.viewport.height)
  }
  return report
}
module.exports = { verifyOverviewEvidence }
