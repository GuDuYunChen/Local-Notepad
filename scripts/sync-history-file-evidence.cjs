const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const names=['file-light','file-dark','file-narrow'],phases=['unread','version1','page2','version2','invalid','cleared']
function verifyFileScene(scene){
 assert.ok(names.includes(scene.name));assert.deepEqual(scene.frames.map(f=>f.phase),phases)
 scene.frames.forEach((f,i)=>{
  const expected=i===1?Array.from({length:25},(_,n)=>'r'+n):i===2?Array.from({length:6},(_,n)=>'r'+(25+n)):i===3||i===4?['r0']:[]
  assert.deepEqual(f.ids,expected);assert.equal(f.requests,0);assert.equal(f.mutations,0);assert.equal(f.networkRequests,0);assert.equal(f.navigationCalls,0)
  assert.equal(f.currentGuidanceUnchanged,true);assert.equal(f.liveRows,0);assert.equal(f.activeMarkup,0)
  assert.equal(f.targetVisible,true);assert.equal(f.focusInside,true);assert.ok(f.overflow<=1)
  assert.ok(f.colors.length>=2&&f.colors.every(c=>Number.isFinite(c)&&c>=4.5))
  assert.ok(f.stable>=2&&f.rasterSamples>=2);assert.equal(f.rasterCode,names.indexOf(scene.name)*phases.length+i+1)
  if(i===0)assert.match(f.notice,/尚未选择/)
  if(i===1||i===2){assert.equal(f.filename,'v1.json');assert.match(f.scope,/31 条记录.*31 条/);assert.match(f.page,new RegExp(`第 ${i} / 2 页`))}
  if(i===3||i===4){assert.equal(f.filename,'v2.json');assert.match(f.scope,/1 条记录.*31 条/);assert.match(f.source,/读取失败/);assert.match(f.dates,/2026-09-30 至 2026-09-30/)}
  if(i===4){assert.equal(f.stale,true);assert.match(f.notice,/不符合/)}
  else assert.equal(f.stale,false)
  if(i===5){assert.match(f.notice,/没有删除原文件/);assert.equal(f.focusChoose,true)}
 })
 assert.equal(scene.invalidUTF8Refused,true);assert.equal(scene.oversizeRefused,true)
 return true
}
function verifyFileReport(dir,commit){
 const r=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
 assert.match(commit,/^[a-f0-9]{40}$/);assert.equal(r.commit,commit);assert.equal(r.platform,'win32');assert.equal(r.complete,true)
 assert.equal(r.actualFileReader,true);assert.equal(r.syntheticRecords,true);assert.deepEqual(r.scenes.map(s=>s.name),names)
 assert.equal(r.downloadedExportCompatibility.length,18)
 for(const d of r.downloadedExportCompatibility){assert.ok([1,2].includes(d.version));assert.ok(d.records>0);assert.match(d.sha256,/^[a-f0-9]{64}$/)}
 for(const s of r.scenes){verifyFileScene(s);for(const f of s.frames){
  assert.equal(f.png,s.name+'-'+f.phase+'.png');const b=fs.readFileSync(path.join(dir,f.png))
  assert.equal(b.length,f.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
  assert.equal(b.readUInt32BE(16),f.width);assert.equal(b.readUInt32BE(20),f.height);assert.equal(verifyRasterWitness(b,f.rasterCode),true)
 }}return r
}
module.exports={names,phases,verifyFileScene,verifyFileReport}
