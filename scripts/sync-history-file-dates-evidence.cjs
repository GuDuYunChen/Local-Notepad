const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const names=['file-dates-light','file-dates-dark','file-dates-narrow']
const phases=['draft','applied','invalid','missing','stale','cleared','replacement']
const expectedIDs=[['r25','r26','r27','r28','r29','r30'],['r26','r27'],['r26','r27'],['r29','r30'],['r29','r30'],Array.from({length:25},(_,i)=>'r'+i),['fresh']]
const expectedCounts=[[28,1,1,1],[1,1,0,0],[1,1,0,0],[1,0,1,0],[1,0,1,0],[28,1,1,1],[1,0,0,0]]
function verifyDateScene(scene){
 assert.ok(names.includes(scene.name));assert.deepEqual(scene.frames.map(f=>f.phase),phases)
 scene.frames.forEach((f,i)=>{
  assert.deepEqual(f.ids,expectedIDs[i]);assert.deepEqual(f.outcomes,expectedCounts[i]);assert.equal(f.total,i===6?1:31)
  assert.equal(f.dateOpen,true);assert.equal(f.pending,i===0||i===2);assert.equal(f.invalid,i===2)
  assert.equal(f.mode,i<3?'range':i<5?'missing':'all');assert.equal(f.stale,i===4||i===5)
  assert.equal(f.reads,i<4?1:i<6?2:3);assert.equal(f.requests,0);assert.equal(f.mutations,0);assert.equal(f.network,0)
  assert.equal(f.downloads,0);assert.equal(f.navigation,0);assert.equal(f.liveUnchanged,true);assert.equal(f.privateText,false)
  assert.ok(f.visible&&f.focusInside);assert.ok(f.overflow<=1);assert.ok(f.colors.length>=3&&f.colors.every(n=>n>=4.5))
  assert.ok(f.stable>=2&&f.samples>=2);assert.equal(f.code,names.indexOf(scene.name)*phases.length+i+1)
  if(i===1||i===2)assert.match(f.applied,/2026-09-30 至 2026-09-30/)
  if(i===3||i===4)assert.match(f.applied,/时间缺失/)
  if(i===0||i>=5)assert.equal(f.applied,'')
  assert.equal(f.filename,i===6?'replacement.json':'history.json')
  if(i===0)assert.match(f.page,/2 \/ 2/)
  if(i===5)assert.match(f.page,/1 \/ 2/)
  if([1,2,3,4,6].includes(i))assert.match(f.page,/1 \/ 1/)
 })
 return true
}
function verifyDateReport(directory,commit){
 assert.match(commit,/^[a-f0-9]{40}$/);const r=JSON.parse(fs.readFileSync(path.join(directory,'checks.json')))
 assert.equal(r.commit,commit);assert.equal(r.platform,'win32');assert.equal(r.complete,true)
 assert.equal(r.actualFileReader,true);assert.equal(r.syntheticRecords,true);assert.equal(r.sourceFilesUnchanged,true)
 assert.deepEqual(r.scenes.map(s=>s.name),names)
 for(const scene of r.scenes){verifyDateScene(scene);for(const f of scene.frames){
  assert.equal(f.png,scene.name+'-'+f.phase+'.png');const b=fs.readFileSync(path.join(directory,f.png))
  assert.equal(b.length,f.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
  assert.equal(b.readUInt32BE(16),f.width);assert.equal(b.readUInt32BE(20),f.height);assert.equal(verifyRasterWitness(b,f.code),true)
 }}return r
}
module.exports={names,phases,verifyDateScene,verifyDateReport}
