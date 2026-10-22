const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const { verifyRasterWitness } = require('./sync-clock-raster-evidence.cjs')
const names = ['order-light', 'order-dark', 'order-narrow']
const phases = ['file', 'oldest', 'created', 'page-two', 'filtered', 'empty', 'restored']
function verifyOrderScene(scene) {
  assert.ok(names.includes(scene.name)); assert.deepEqual(scene.frames.map(f => f.phase), phases)
  const range = (from, count, step = 1) => Array.from({ length: count }, (_, i) => 'r' + (from + i * step))
  const expected = [range(0,25), range(59,25,-1), range(0,25), range(25,25), ['r60'], [], range(0,25)]
  const orders = ['file','completed-asc','created-asc','created-asc','created-asc','created-asc','file']
  const drafts = ['1','1','1','2','1','','1'], matches = [61,61,61,61,1,0,61]
  scene.frames.forEach((f, i) => {
    assert.deepEqual(f.ids, expected[i]); assert.equal(f.order, orders[i]); assert.equal(f.draft, drafts[i]); assert.equal(f.invalid,false); assert.equal(f.error,'')
    assert.match(f.matches,new RegExp(`当前匹配 ${matches[i]} 条 / 文件内共 61 条`))
    assert.deepEqual(f.outcomes,i===4?[1,0,0,0]:i===5?[0,0,0,0]:[61,0,0,0])
    for (const field of ['requests','network','mutations','downloads','navigation','activeMarkup']) assert.equal(f[field],0)
    assert.equal(f.reads,1); assert.equal(f.liveUnchanged,true); assert.equal(f.sourceUnchanged,true)
    assert.equal(f.visible,true); assert.equal(f.focusInside,true); assert.ok(Number.isFinite(f.overflow)&&f.overflow<=1)
    assert.ok(f.colors.length>=3 && f.colors.every(v=>Number.isFinite(v)&&v>=4.5))
    assert.ok(f.stable>=2&&f.samples>=2); assert.equal(f.code,names.indexOf(scene.name)*phases.length+i+1)
    assert.equal(f.width,scene.name==='order-narrow'?560:1000); assert.equal(f.height,900)
    if(i===5) {
      assert.match(f.page,/暂无可翻页/); assert.equal(f.readOnly,true); assert.deepEqual(f.disabled,{first:true,prev:true,next:true,last:true,jump:true})
    } else {
      const page=i===3?2:1,total=i===4?1:3
      assert.match(f.page,new RegExp(`第 ${page} / ${total} 页`)); assert.equal(f.readOnly,false)
      assert.deepEqual(f.disabled,{first:page===1,prev:page===1,next:page===total,last:page===total,jump:false})
    }
    if([1,2,6].includes(i)) assert.equal(f.focusOrder,true)
    if(i===3) assert.equal(f.focusJump,true)
  })
  return true
}
function verifyOrderReport(dir, commit) {
  assert.match(commit,/^[a-f0-9]{40}$/)
  const report=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
  assert.equal(report.commit,commit); assert.equal(report.platform,'win32'); assert.equal(report.complete,true)
  assert.equal(report.actualFileReader,true); assert.equal(report.syntheticRecords,true); assert.equal(report.sourceFilesUnchanged,true)
  assert.deepEqual(report.scenes.map(s=>s.name),names)
  for(const scene of report.scenes) {
    verifyOrderScene(scene)
    for(const f of scene.frames) {
      assert.equal(f.png,scene.name+'-'+f.phase+'.png')
      const b=fs.readFileSync(path.join(dir,f.png)); assert.equal(b.length,f.bytes); assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
      assert.equal(b.readUInt32BE(16),f.width); assert.equal(b.readUInt32BE(20),f.height); assert.equal(verifyRasterWitness(b,f.code),true)
    }
  }
  return report
}
module.exports={names,phases,verifyOrderScene,verifyOrderReport}
