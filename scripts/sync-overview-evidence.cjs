const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const names = ['light', 'dark', 'narrow', 'uncertain', 'unavailable', 'disabled', 'blocked-stale', 'backoff-busy', 'uncertain-refreshing', 'contradictory-busy', 'help-first-use', 'help-operations-dark', 'help-conflicts', 'help-recovery-narrow']
// Independent visible-text expectations: never use the implementation's model
// to decide what evidence should contain.
function verifyOverviewSceneText(scene) {
  assert.ok(names.includes(scene.name))
  // Presence and native disclosure evidence are independent of screenshot hashes.
  assert.equal(scene.help?.present, true); assert.equal(scene.help.topicCount, 4); assert.equal(scene.help.readOnly, true)
  const opened = { 'help-first-use': 'first-use', 'help-operations-dark': 'operations', 'help-conflicts': 'conflicts', 'help-recovery-narrow': 'recovery' }[scene.name]
  assert.equal(scene.help.open, !!opened); assert.equal(scene.help.disclosureVerified, !!opened)
  assert.deepEqual(scene.help.openTopics, opened ? [opened] : [])
  const source = scene.name === 'unavailable' ? '尚无可核实的读取结果'
    : ['blocked-stale', 'contradictory-busy'].includes(scene.name) ? '上次读取结果；刷新失败或状态待核实'
      : scene.name === 'uncertain-refreshing' ? '正在刷新；仍是上次读取结果' : '已读取的状态快照（非实时保证）'
  assert.equal(typeof scene.readProvenance, 'string'); assert.ok(scene.readProvenance.startsWith('状态依据：' + source))
  assert.equal(typeof scene.recoveryNotice, 'string')
  const expected = {
    'blocked-stale': ['当前保留的是上次读取结果', '恢复保护阻断', '不证明保护已解除'],
    'backoff-busy': ['正在等待操作结果', '预检暂缓', '不会提前重跑同步'],
    'uncertain-refreshing': ['先核查写入结果'],
    'contradictory-busy': ['正在等待操作结果', '恢复保护阻断', '预检暂缓', '不一致'],
  }[scene.name]
  if (expected) {
    assert.equal(scene.title, expected[0])
    for (const warning of expected.slice(1)) assert.ok(scene.recoveryNotice.includes(warning), 'Missing warning: ' + warning)
  } else assert.equal(scene.recoveryNotice, '')
  assert.doesNotMatch(scene.readProvenance + scene.recoveryNotice, /SYNTHETIC_PRIVATE_ERROR/)
}
function verifyOverviewEvidence(directory, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/)
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'checks.json'), 'utf8'))
  assert.equal(report.commit, commit); assert.equal(report.platform, 'win32'); assert.equal(report.complete, true)
  assert.equal(report.realComponents, true); assert.equal(report.syntheticRecords, true); assert.equal(report.backendExercised, false)
  assert.equal(report.nativeFocus, true); assert.equal(report.writes, 0)
  assert.deepEqual(report.scenes.map(scene => scene.name), names)
  for (const scene of report.scenes) {
    verifyOverviewSceneText(scene)
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
module.exports = { verifyOverviewEvidence, verifyOverviewSceneText }
