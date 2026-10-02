const assert = require('node:assert/strict')
const { verifyOrderReport } = require('./sync-history-file-order-evidence.cjs')
const phases = ['file','oldest','created','page-two','filtered','empty','restored']
const actions = [['single',1],['expand',25],['collapse',0],['created-expand',25],['filtered-expand',1],['empty-expand',0],['empty-collapse',0],['restored-expand',25],['restored-collapse',0]]
function verifyFileDetailsScene(scene) {
  assert.deepEqual(scene.frames.map(f=>f.phase),phases)
  scene.frames.forEach((f,i)=>{
    assert.equal(f.identifiersCount,[25,25,25,25,1,0,25][i])
    assert.equal(f.identifiersOpen,[0,0,25,0,1,0,0][i])
    assert.equal(f.detailsToolsVisible,true)
    assert.deepEqual(f.detailsDisabled,{expand:i===5,collapse:i===5})
    assert.match(f.detailsScope,new RegExp(`只展开或收起本页 ${f.identifiersCount} 条记录`))
  })
  assert.deepEqual(scene.detailsActions.map(a=>[a.action,a.open]),actions)
  scene.detailsActions.forEach(a=>{assert.equal(a.focusRetained,true);assert.equal(a.pageUnchanged,true);assert.equal(a.orderUnchanged,true);assert.equal(a.reads,1)})
  return true
}
function verifyFileDetailsReport(dir,commit) {
  const report=verifyOrderReport(dir,commit)
  report.scenes.forEach(verifyFileDetailsScene)
  return report
}
module.exports={verifyFileDetailsScene,verifyFileDetailsReport}
