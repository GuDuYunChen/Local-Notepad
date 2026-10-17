const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const names=['restore-light','restore-dark','restore-narrow']
const phases=['temporary','restored','external','empty','invalid','unavailable','recovered']
function verifyRestoreScene(scene){
  assert.ok(names.includes(scene.name));assert.deepEqual(scene.frames.map(f=>f.phase),phases)
  const expected=[['local','utc',''],['utc','utc',''],['local','local',''],['local',null,''],['local','invalid','invalid'],['local','invalid','read'],['utc','utc','']]
  for(const [i,f] of scene.frames.entries()){
    assert.equal(f.mode,expected[i][0]);assert.equal(f.stored,expected[i][1]);assert.equal(f.error,expected[i][2])
    assert.equal(f.rasterCode,1+names.indexOf(scene.name)*7+i);assert.ok(f.rasterSamples>=2)
    assert.equal(f.open,true);assert.equal(f.restoreVisible,true);assert.equal(f.actionsVisible,true)
    assert.deepEqual(f.mutations,[]);assert.equal(f.requests,0);assert.equal(f.navigationCalls,0)
    assert.equal(f.otherKeyPreserved,true);assert.equal(f.otherUTC,true);assert.equal(f.privateText,false)
    assert.deepEqual(f.iso,scene.frames[0].iso);assert.equal(f.iso.length,2)
    assert.equal(f.guidance,scene.frames[0].guidance);assert.deepEqual(f.counts,['0','0'])
    assert.equal(f.focusRetained,true);assert.ok(f.stableSamples>=3);assert.ok(f.overflow<=1)
    assert.ok(f.colors.length>=5&&f.colors.every(c=>c.final&&Number.isFinite(c.ratio)&&c.ratio>=4.5))
    assert.ok(f.viewport.width>=500&&f.viewport.height>=600)
    assert.equal(typeof f.comparison,'string');assert.equal(typeof f.receipt,'string')
  }
  assert.match(scene.frames[0].comparison,/仅为本次显示/)
  assert.match(scene.frames[1].comparison,/一致.*UTC/)
  assert.match(scene.frames[2].comparison,/一致.*本机时区/)
  assert.match(scene.frames[3].receipt,/没有已保存.*保持不变/)
  for(const i of [4,5]){assert.match(scene.frames[i].comparison,/尚未核实/);assert.equal(scene.frames[i].receipt,'')}
  assert.match(scene.frames[6].comparison,/一致.*UTC/)
}
function verifyRestoreReport(dir,commit){
  assert.match(commit,/^[a-f0-9]{40}$/);const r=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
  assert.equal(r.commit,commit);assert.equal(r.platform,'win32');assert.equal(r.complete,true)
  assert.equal(r.realOverview,true);assert.equal(r.syntheticRecords,true);assert.equal(r.backendExercised,false)
  assert.deepEqual(r.scenes.map(s=>s.name),names)
  for(const s of r.scenes){verifyRestoreScene(s);for(const f of s.frames){
    assert.equal(f.png,s.name+'-'+f.phase+'.png');const b=fs.readFileSync(path.join(dir,f.png))
    verifyRasterWitness(b,f.rasterCode)
    assert.equal(b.length,f.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
    assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    assert.equal(b.readUInt32BE(16),f.viewport.width);assert.equal(b.readUInt32BE(20),f.viewport.height)
  }}return r
}
module.exports={verifyRestoreScene,verifyRestoreReport}
