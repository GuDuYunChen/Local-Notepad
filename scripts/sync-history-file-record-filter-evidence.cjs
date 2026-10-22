const assert = require('node:assert/strict')
const { verifyObjectFilterReport } = require('./sync-history-file-object-filter-evidence.cjs')
function verifyRecordFilterScene(scene) {
  assert.deepEqual(scene.recordFilterActions.map(a => a.action), ['apply','combined-empty','clear-record','clear-all'])
  const expected = [
    { ids:['r0'], count:1, query:'', itemID:'', recordID:'r0', filterVisible:true, focusRecord:true, focusQuery:false, page:/第 1 \/ 1 页/, outcomes:[1,0,0,0] },
    { ids:[], count:0, query:'笔记 1', itemID:'', recordID:'r0', filterVisible:true, focusRecord:false, focusQuery:true, page:'没有匹配记录，暂无可翻页内容', outcomes:[0,0,0,0] },
    { ids:['r1','r10','r11','r12','r13','r14','r15','r16','r17','r18','r19'], count:11, query:'笔记 1', itemID:'', recordID:'', filterVisible:false, focusRecord:false, focusQuery:true, page:/第 1 \/ 1 页/, outcomes:[11,0,0,0] },
    { ids:Array.from({length:25},(_,i)=>'r'+i), count:61, query:'', itemID:'', recordID:'', filterVisible:false, focusRecord:false, focusQuery:true, page:/第 1 \/ 3 页/, outcomes:[61,0,0,0] },
  ]
  scene.recordFilterActions.forEach((a,i)=>{
    const e=expected[i]
    assert.deepEqual(a.ids,e.ids);assert.match(a.matches,new RegExp(`当前匹配 ${e.count} 条 / 文件内共 61 条`))
    // The existing pagination component deliberately exposes no page at zero
    // matches. Require the exact empty status; do not accept fabricated 0/0,
    // 1/1, mixed messages, or a changed production component to satisfy a test.
    if(e.count===0)assert.equal(a.page,e.page)
    else assert.match(a.page,e.page)
    assert.equal(a.order,'file');assert.equal(a.query,e.query);assert.equal(a.itemID,e.itemID);assert.equal(a.recordID,e.recordID)
    assert.equal(a.filterVisible,e.filterVisible);assert.equal(a.focusRecord,e.focusRecord);assert.equal(a.focusQuery,e.focusQuery)
    assert.deepEqual(a.outcomes,e.outcomes);assert.equal(a.reads,1)
    for(const field of ['network','mutations','requests','navigation'])assert.equal(a[field],0)
    assert.ok(Number.isFinite(a.contrast)&&a.contrast>=4.5)
  })
  return true
}
function verifyRecordFilterReport(dir, commit) {
  const report=verifyObjectFilterReport(dir,commit)
  report.scenes.forEach(verifyRecordFilterScene)
  return report
}
module.exports={verifyRecordFilterScene,verifyRecordFilterReport}
