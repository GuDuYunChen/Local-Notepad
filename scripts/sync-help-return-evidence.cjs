const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const { verifyHelpNavigationScene } = require('./sync-help-navigation-evidence.cjs')
const names = ['first-use', 'operations', 'conflicts', 'recovery-narrow']
function verifyHelpReturnScene(scene) {
  // Retain the independent, already tested outward navigation checks.
  verifyHelpNavigationScene(scene)
  assert.equal(scene.before.returnVisible, false)
  assert.equal(scene.after.returnVisible, true)
  const footer=scene.footer
  assert.equal(footer.returnVisible,true); assert.equal(footer.returnOnScreen,true)
  assert.equal(footer.focusedTopic,scene.after.focusedTopic); assert.equal(footer.focusedGuidance,false)
  assert.equal(footer.helpOpen,true); assert.deepEqual(footer.openTopics,scene.after.openTopics)
  assert.equal(footer.requests,0); assert.equal(footer.navigationCalls,0); assert.equal(footer.otherOverviewOpen,false)
  assert.equal(footer.activeMarkup,0); assert.equal(footer.returnScopeText,true); assert.equal(footer.revision,'1')
  assert.deepEqual(footer.viewport,scene.after.viewport)
  assert.ok(footer.stableSamples>=3); assert.ok(Number.isFinite(footer.overflow) && footer.overflow<=1)
  assert.ok(footer.colors.length>=10 && footer.colors.every(c=>c.final===true && Number.isFinite(c.ratio) && c.ratio>=4.5))
  const result = scene.returned
  assert.equal(result.returnVisible, true); assert.equal(result.focusedGuidance, true)
  assert.equal(result.guidanceRole, 'region'); assert.equal(result.guidanceTag, 'DIV')
  assert.equal(result.guidanceNamed, true); assert.equal(result.focusedTopic, '')
  assert.equal(result.helpOpen, true); assert.deepEqual(result.openTopics, scene.after.openTopics)
  assert.deepEqual(result.viewport, scene.after.viewport)
  assert.equal(result.requests, 0); assert.equal(result.navigationCalls, 0)
  assert.equal(result.otherOverviewOpen, false); assert.equal(result.activeMarkup, 0)
  assert.equal(result.readOnlyHelp, true); assert.equal(result.returnScopeText, true)
  assert.equal(result.currentTitle, scene.name === 'recovery-narrow' ? '先核查写入结果' : '正在读取更新后的状态')
  assert.equal(result.revision, '1'); assert.equal(scene.retainedAfterReturn, true)
  assert.equal(scene.repeatReturnVerified, true)
  assert.equal(scene.disclosureVisibilityVerified, true)
  assert.ok(result.stableSamples >= 3); assert.ok(Number.isFinite(result.overflow) && result.overflow <= 1)
  assert.ok(result.colors.length >= 10 && result.colors.every(c=>c.final===true && Number.isFinite(c.ratio) && c.ratio>=4.5))
  assert.doesNotMatch(JSON.stringify(scene), /NAV_PRIVATE|RETURN_PRIVATE/)
}
function verifyHelpReturnReport(directory, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/)
  const report=JSON.parse(fs.readFileSync(path.join(directory,'checks.json'),'utf8'))
  assert.equal(report.commit,commit); assert.equal(report.platform,'win32'); assert.equal(report.complete,true)
  assert.equal(report.realOverview,true); assert.equal(report.syntheticRecords,true); assert.equal(report.backendExercised,false)
  assert.deepEqual(report.scenes.map(s=>s.name),names)
  for(const scene of report.scenes) {
    verifyHelpReturnScene(scene)
    for(const phase of ['before','after','footer','returned']) {
      const s=scene[phase]; assert.equal(s.png,`${scene.name}-${phase}.png`)
      const b=fs.readFileSync(path.join(directory,s.png))
      assert.equal(b.length,s.bytes); assert.equal(createHash('sha256').update(b).digest('hex'),s.sha256)
      assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
      assert.equal(b.readUInt32BE(16),s.viewport.width); assert.equal(b.readUInt32BE(20),s.viewport.height)
    }
  }
  return report
}
module.exports={verifyHelpReturnScene,verifyHelpReturnReport}
