const assert = require('node:assert/strict')
const { verifyIdentifierSelectionReport } = require('./sync-history-file-identifier-selection-evidence.cjs')
function verifyObjectFilterScene(scene) {
  assert.deepEqual(scene.objectFilterActions.map(a => a.action), ['apply','combined','clear-object','clear-all'])
  const expected = [
    { ids:['r0','r1','r2'], count:3, query:'', itemID:'same', filterVisible:true, focusObject:true, focusQuery:false, page:/第 1 \/ 1 页/, outcomes:[3,0,0,0] },
    { ids:['r1'], count:1, query:'笔记 1', itemID:'same', filterVisible:true, focusObject:false, focusQuery:true, page:/第 1 \/ 1 页/, outcomes:[1,0,0,0] },
    { ids:['r1','r10','r11','r12','r13','r14','r15','r16','r17','r18','r19'], count:11, query:'笔记 1', itemID:'', filterVisible:false, focusObject:false, focusQuery:true, page:/第 1 \/ 1 页/, outcomes:[11,0,0,0] },
    { ids:Array.from({length:25},(_,i)=>'r'+i), count:61, query:'', itemID:'', filterVisible:false, focusObject:false, focusQuery:true, page:/第 1 \/ 3 页/, outcomes:[61,0,0,0] },
  ]
  scene.objectFilterActions.forEach((a,i)=>{
    const e=expected[i]
    assert.deepEqual(a.ids,e.ids);assert.match(a.matches,new RegExp(`当前匹配 ${e.count} 条 / 文件内共 61 条`))
    assert.match(a.page,e.page);assert.equal(a.order,'file');assert.equal(a.query,e.query);assert.equal(a.itemID,e.itemID)
    assert.equal(a.filterVisible,e.filterVisible);assert.equal(a.focusObject,e.focusObject);assert.equal(a.focusQuery,e.focusQuery)
    assert.deepEqual(a.outcomes,e.outcomes);assert.equal(a.reads,1)
    for(const field of ['network','mutations','requests','navigation'])assert.equal(a[field],0)
    assert.ok(Number.isFinite(a.contrast)&&a.contrast>=4.5)
  })
  return true
}
function verifyObjectFilterReport(dir, commit) {
  const report=verifyIdentifierSelectionReport(dir,commit)
  report.scenes.forEach(verifyObjectFilterScene)
  return report
}
module.exports={verifyObjectFilterScene,verifyObjectFilterReport}
