const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const scenes = Object.freeze({ 'first-use': 'first-use', operations: 'operations', conflicts: 'conflicts', 'recovery-narrow': 'recovery' })
function verifyHelpNavigationScene(scene) {
  assert.ok(Object.hasOwn(scenes, scene.name))
  assert.equal(scene.retainedAfterUpdate, true)
  for (const [phase, sample] of [['before', scene.before], ['after', scene.after]]) {
    assert.equal(sample.requests, 0); assert.equal(sample.navigationCalls, 0)
    assert.equal(sample.otherOverviewOpen, false); assert.equal(sample.activeMarkup, 0)
    assert.ok(sample.stableSamples >= 3); assert.ok(Number.isFinite(sample.overflow) && sample.overflow <= 1)
    assert.ok(sample.colors.length >= 10 && sample.colors.every(c => c.final === true && Number.isFinite(c.ratio) && c.ratio >= 4.5))
    assert.equal(sample.helpOpen, phase === 'after')
    assert.deepEqual(sample.openTopics, phase === 'after' ? [scenes[scene.name]] : [])
    if (phase === 'after') assert.equal(sample.focusedTopic, scenes[scene.name])
    assert.equal(sample.readOnlyHelp, true)
    assert.doesNotMatch(JSON.stringify(sample), /NAV_PRIVATE/)
  }
}
function verifyHelpNavigationReport(directory, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/)
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'checks.json'), 'utf8'))
  assert.equal(report.commit, commit); assert.equal(report.platform, 'win32'); assert.equal(report.complete, true)
  assert.equal(report.realOverview, true); assert.equal(report.syntheticRecords, true); assert.equal(report.backendExercised, false)
  assert.deepEqual(report.scenes.map(s => s.name), Object.keys(scenes))
  for (const scene of report.scenes) {
    verifyHelpNavigationScene(scene)
    for (const phase of ['before', 'after']) {
      const sample = scene[phase]
      assert.equal(sample.png, `${scene.name}-${phase}.png`)
      const b = fs.readFileSync(path.join(directory, sample.png))
      assert.equal(b.length, sample.bytes); assert.equal(createHash('sha256').update(b).digest('hex'), sample.sha256)
      assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      assert.equal(b.readUInt32BE(16), scene.name === 'recovery-narrow' ? 560 : 1000)
      assert.equal(b.readUInt32BE(20), 900)
    }
  }
  return report
}
module.exports = { verifyHelpNavigationScene, verifyHelpNavigationReport }
