const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto')
const {verifyRasterWitness} = require('./sync-clock-raster-evidence.cjs')
const phases = ['loaded','filtered','appended','stale','empty','timeless']
const names = ['summary-light','summary-dark','summary-narrow']
const iso = n => n === null ? null : new Date(n * 1000).toISOString()
function verifySummaryScene(scene) {
 assert.ok(names.includes(scene.name));assert.deepEqual(scene.frames.map(f=>f.phase),phases)
 const counts = [5,1,6,6,0,1]
 const outcomes = [[2,1,1,1],[1,0,0,0],[2,2,1,1],[2,2,1,1],[0,0,0,0],[0,1,0,0]]
 const kinds = [[2,1,1,1],[1,0,0,0],[3,1,1,1],[3,1,1,1],[0,0,0,0],[1,0,0,0]]
 const earliest = [1790586200,1790586600,1790586100,1790586100,null,null]
 const latest = [1790586600,1790586600,1790586600,1790586600,null,null]
 scene.frames.forEach((f,i)=>{
  assert.equal(f.open,true);assert.equal(f.requests.length,[1,1,2,3,3,4][i]);assert.equal(f.rows,counts[i])
  assert.deepEqual(f.outcomes,outcomes[i]);assert.deepEqual(f.kinds,kinds[i])
  assert.equal(f.outcomes.reduce((a,b)=>a+b,0),f.rows);assert.equal(f.kinds.reduce((a,b)=>a+b,0),f.rows)
  assert.match(f.scope,new RegExp(`当前显示的 ${counts[i]} 条`));assert.match(f.scope,/不是全部历史/)
  assert.equal(f.earliest,iso(earliest[i]));assert.equal(f.latest,iso(latest[i]));assert.equal(f.unread,i<2)
  assert.match(f.coverage,new RegExp(`有时间记录 ${i===5?0:counts[i]} 条，时间缺失 ${i===5?1:0} 条`))
  if(i===3||i===4)assert.match(f.provenance,/最近读取失败/);else assert.equal(f.provenance,'')
  assert.equal(f.privateText,false);assert.equal(f.mutations,0);assert.equal(f.networkRequests,0);assert.equal(f.navigationCalls,0)
  assert.equal(f.summaryActionControls,0);assert.equal(f.guidanceUnchanged,true)
  assert.equal(f.visible,true);assert.equal(f.focusInside,true);assert.ok(f.overflow<=1)
  assert.ok(f.colors.length>=12&&f.colors.every(c=>Number.isFinite(c)&&c>=4.5))
  assert.ok(f.stable>=2);assert.ok(f.rasterSamples>=2);assert.equal(f.rasterCode,names.indexOf(scene.name)*phases.length+i+1)
  f.requests.forEach((r,n)=>{assert.equal(r.method,'GET');assert.equal(r.path,'/api/sync/conflicts/history?filter=all&limit=25'+(n===1?'&before=older-page':''))})
 })
 assert.match(scene.frames[4].noTime,/没有匹配/);assert.match(scene.frames[5].noTime,/没有已知/)
 return true
}
function verifySummaryReport(dir,commit) {
 assert.match(commit,/^[a-f0-9]{40}$/)
 const report=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
 assert.equal(report.commit,commit);assert.equal(report.platform,'win32');assert.equal(report.complete,true)
 assert.equal(report.realOverview,true);assert.equal(report.syntheticRecords,true);assert.equal(report.backendExercised,false)
 assert.deepEqual(report.scenes.map(s=>s.name),names)
 for(const scene of report.scenes){verifySummaryScene(scene);for(const f of scene.frames){
  assert.equal(f.filename,scene.name+'-'+f.phase+'.png')
  const b=fs.readFileSync(path.join(dir,f.filename));assert.equal(b.length,f.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
  assert.equal(b.readUInt32BE(16),f.width);assert.equal(b.readUInt32BE(20),f.height);assert.equal(verifyRasterWitness(b,f.rasterCode),true)
 }}
 return report
}
module.exports={phases,names,verifySummaryScene,verifySummaryReport}
