const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto')
const {names, phases} = require('./sync-history-file-selection-evidence.cjs')
const {verifyRasterWitness} = require('./sync-clock-raster-evidence.cjs')
const outcomes = [[20,40,1,0],[0,0,1,0],[10,0,0,0],[20,40,0,0],[0,0,1,0],[0,0,0,0],[0,0,1,0],[20,40,1,0],[1,0,0,0]]
const kinds = [[31,30,0,0],[1,0,0,0],[0,10,0,0],[30,30,0,0],[1,0,0,0],[0,0,0,0],[1,0,0,0],[31,30,0,0],[1,0,0,0]]
function verifyFileSummaryScene(scene) {
  assert.ok(names.includes(scene.name)); assert.deepEqual(scene.summaryFrames.map(f=>f.phase),phases)
  scene.summaryFrames.forEach((f,i)=>{
    assert.deepEqual(f.outcomes,outcomes[i]);assert.deepEqual(f.kinds,kinds[i])
    const total=outcomes[i].reduce((n,x)=>n+x,0)
    assert.equal(f.kinds.reduce((n,x)=>n+x,0),total)
    assert.match(f.scope,new RegExp(`全部 ${total} 条匹配记录`));assert.match(f.scope,/不是当前页、本机历史/)
    const date=total?'2026-09-30T00:00:00.000Z':null
    assert.equal(f.earliest,date);assert.equal(f.latest,date)
    assert.match(f.coverage,new RegExp(`有时间记录 ${total} 条，时间缺失 0 条`))
    assert.equal(f.retained,i===6||i===7);assert.equal(f.composing,i===3)
    assert.equal(f.open,true);assert.equal(f.visible,true);assert.ok(f.overflow<=1)
    assert.ok(f.colors.length>=12&&f.colors.every(n=>Number.isFinite(n)&&n>=4.5))
    assert.equal(f.fileReads,i<6?1:i<8?2:3)
    for(const k of ['requests','mutations','networkRequests','navigationCalls','downloads','actionControls'])assert.equal(f[k],0)
    assert.equal(f.focusInside,true);assert.equal(f.liveHistoryUnchanged,true);assert.equal(f.guidanceUnchanged,true)
    assert.equal(f.rasterCode,names.indexOf(scene.name)*phases.length+i+65)
    assert.ok(f.stable>=2&&f.rasterSamples>=2)
  })
  return true
}
function verifyFileSummaryReport(dir,commit) {
  const r=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
  assert.match(commit,/^[a-f0-9]{40}$/);assert.equal(r.commit,commit);assert.equal(r.complete,true)
  assert.equal(r.actualFileReader,true);assert.equal(r.syntheticRecords,true)
  assert.deepEqual(r.scenes.map(s=>s.name),names)
  for(const s of r.scenes){verifyFileSummaryScene(s);for(const f of s.summaryFrames){
    assert.equal(f.png,s.name+'-summary-'+f.phase+'.png')
    const b=fs.readFileSync(path.join(dir,f.png));assert.equal(b.length,f.bytes)
    assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
    assert.equal(b.readUInt32BE(16),f.width);assert.equal(b.readUInt32BE(20),f.height)
    assert.equal(verifyRasterWitness(b,f.rasterCode),true)
  }}return r
}
module.exports={verifyFileSummaryScene,verifyFileSummaryReport}
