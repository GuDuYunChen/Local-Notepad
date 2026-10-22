const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { createHash } = require('node:crypto')
const { verifyRasterWitness } = require('./sync-clock-raster-evidence.cjs')
const names = ['keyboard-light', 'keyboard-dark', 'keyboard-narrow']
const phases = ['temporary', 'saved', 'repeated', 'cleared', 'restored', 'read-failed', 'recovered']
// These expectations are deliberately independent of the component and fixture.
const keys = [['Tab',false],[' ',false],['Tab',false],['Enter',false],['Tab',false],['Tab',false],['Enter',false],['Enter',false],['Tab',false],[' ',false],['Tab',true],['Enter',false],['Tab',true],['Enter',false],['Enter',false],['Enter',false]]
const keyCounts = [5,7,8,10,14,15,16]
const mutations = [['set','local'],['set','local'],['remove'],['set','local']]
const mutationCounts = [0,1,2,3,4,4,4]
function verifyKeyboardScene(scene) {
  assert.ok(names.includes(scene.name)); assert.deepEqual(scene.frames.map(f => f.phase), phases)
  for (const [i,f] of scene.frames.entries()) {
    assert.equal(f.mode, i === 6 ? 'utc' : 'local')
    assert.equal(f.stored, i === 0 || i === 6 ? 'utc' : i === 3 ? null : 'local')
    assert.equal(f.focusedAction, ['restore','save','save','clear','restore','restore','restore'][i])
    for (const key of ['liveStable','controlsLinked','focusOutline','feedbackVisible','open','actionsVisible','controlsVisible','summaryVisible','otherKeyPreserved','otherUTC']) assert.equal(f[key],true,key)
    assert.equal(f.liveRole,'status');assert.equal(f.livePolite,'polite');assert.equal(f.liveAtomic,'true')
    assert.equal(f.messageSerial,i);assert.equal(f.error,i===5?'read':'')
    if(i===0)assert.equal(f.feedback,'')
    else assert.ok(f.feedback.includes(i===1||i===2?'本次已回读确认：已记住本机时区':i===3?'本次已回读确认：时间偏好已清除':i===5?'未能读取已保存的时间偏好':'已读取保存记录'))
    if(i===5)assert.ok(!f.feedback.includes('本次已回读确认'))
    assert.deepEqual(f.trustedKeys,keys.slice(0,keyCounts[i]).map(([key,shift])=>({key,shift,trusted:true})))
    assert.deepEqual(f.mutations,mutations.slice(0,mutationCounts[i]));assert.equal(f.requests,0);assert.equal(f.navigationCalls,0);assert.equal(f.privateText,false)
    assert.deepEqual(f.iso,['2026-09-27T09:05:00.000Z','2026-09-27T09:06:40.000Z']);assert.deepEqual(f.counts,['0','0'])
    assert.equal(f.guidance,scene.frames[0].guidance)
    assert.equal(f.rasterCode,1+names.indexOf(scene.name)*7+i);assert.ok(f.rasterSamples>=2);assert.ok(f.stableSamples>=3)
    assert.ok(Number.isFinite(f.overflow)&&f.overflow<=1);assert.ok(f.colors.length>=5&&f.colors.every(c=>c.final===true&&Number.isFinite(c.ratio)&&c.ratio>=4.5))
  }
}
function verifyKeyboardReport(directory,commit) {
  assert.match(commit,/^[a-f0-9]{40}$/)
  const r=JSON.parse(fs.readFileSync(path.join(directory,'checks.json'),'utf8'))
  assert.equal(r.commit,commit);assert.equal(r.platform,'win32');assert.equal(r.complete,true)
  assert.equal(r.realOverview,true);assert.equal(r.nativeKeyboard,true);assert.equal(r.syntheticRecords,true);assert.equal(r.backendExercised,false)
  assert.deepEqual(r.scenes.map(s=>s.name),names)
  for(const s of r.scenes){verifyKeyboardScene(s);for(const f of s.frames){
    assert.equal(f.png,s.name+'-'+f.phase+'.png')
    const b=fs.readFileSync(path.join(directory,f.png));assert.equal(b.length,f.bytes)
    assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
    assert.equal(b.readUInt32BE(16),f.viewport.width);assert.equal(b.readUInt32BE(20),f.viewport.height)
    assert.equal(verifyRasterWitness(b,f.rasterCode),true)
  }}
  return r
}
module.exports={verifyKeyboardScene,verifyKeyboardReport}
