const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto')
const scenes=['shanghai-light','los-angeles-dark','kathmandu-narrow','unread-dark','timezone-unavailable']
const phases=['before','local','updated','restored']
const success='2024-11-03T08:30:00.000Z',read='2024-11-03T09:30:00.000Z',updatedRead='2024-11-03T09:31:00.000Z'
const localValues={
  'shanghai-light':['2024-11-03 16:30:00.000 GMT+08:00','2024-11-03 17:30:00.000 GMT+08:00','2024-11-03 17:31:00.000 GMT+08:00'],
  'los-angeles-dark':['2024-11-03 01:30:00.000 GMT-07:00','2024-11-03 01:30:00.000 GMT-08:00','2024-11-03 01:31:00.000 GMT-08:00'],
  'kathmandu-narrow':['2024-11-03 14:15:00.000 GMT+05:45','2024-11-03 15:15:00.000 GMT+05:45','2024-11-03 15:16:00.000 GMT+05:45'],
}
function verifyClockScene(scene){
  assert.ok(scenes.includes(scene.name));assert.equal(scene.zoneEmulated,true);assert.equal(scene.updateObserved,true)
  assert.equal(scene.choiceAndFocusRetained,true);assert.equal(scene.helpRetained,true)
  const unread=scene.name==='unread-dark',fallback=scene.name==='timezone-unavailable'
  for(const phase of phases){
    const s=scene[phase],local=phase==='local'||phase==='updated',updated=phase==='updated'||phase==='restored'
    assert.equal(s.requests,0);assert.equal(s.navigationCalls,0);assert.equal(s.otherUTC,true);assert.equal(s.privateText,false)
    assert.equal(s.selected,local?'local':'utc');assert.equal(s.fallback,local&&fallback)
    assert.equal(s.scopeText,true);assert.equal(s.controlsOnScreen,true);assert.equal(s.controlCount,2);assert.ok(s.stableSamples>=3)
    assert.ok(s.colors.length>=8&&s.colors.every(c=>c.final===true&&Number.isFinite(c.ratio)&&c.ratio>=4.5))
    assert.ok(Number.isFinite(s.overflow)&&s.overflow<=1)
    assert.equal(s.viewport.width,scene.name==='kathmandu-narrow'?560:1000)
    assert.ok(Number.isInteger(s.viewport.height)&&s.viewport.height>=600&&s.viewport.height<=900)
    assert.deepEqual(s.viewport,scene.before.viewport)
    if(unread){assert.deepEqual(s.values,[]);assert.deepEqual(s.counts,['未知','未知','尚无记录']);assert.match(s.provenance,/尚无可核实的读取结果/)}
    else{
      assert.deepEqual(s.values.map(t=>t.iso),[success,updated?updatedRead:read])
      const expected=local&&!fallback? [localValues[scene.name][0],localValues[scene.name][updated?2:1]] : [success,updated?updatedRead:read]
      assert.deepEqual(s.values.map(t=>t.text),expected)
      for(const time of s.values)assert.equal(time.title,'UTC：'+time.iso)
      assert.deepEqual(s.counts.slice(0,2),['0','0'])
      assert.equal(s.title,updated?'先核查写入结果':'先预演，再决定是否同步')
      assert.match(s.provenance,updated?/上次读取结果；刷新失败或状态待核实/:/已读取的状态快照/)
      if(updated)assert.match(s.recoveryNotice,/恢复保护阻断/)
    }
    if(local&&!fallback){
      const expected=scene.name==='unread-dark'?'Asia/Shanghai':scene.name==='shanghai-light'?'Asia/Shanghai':scene.name==='los-angeles-dark'?'America/Los_Angeles':null
      if(expected)assert.equal(s.zone,expected);else assert.match(s.zone,/^Asia\/(?:Katmandu|Kathmandu)$/)
    }else assert.equal(s.zone,'UTC')
  }
}
function verifyClockReport(dir,sha){
  assert.match(sha,/^[a-f0-9]{40}$/)
  const report=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
  assert.equal(report.commit,sha);assert.equal(report.platform,'win32');assert.equal(report.complete,true)
  assert.equal(report.realOverview,true);assert.equal(report.syntheticRecords,true);assert.equal(report.backendExercised,false)
  assert.deepEqual(report.scenes.map(s=>s.name),scenes)
  for(const scene of report.scenes){verifyClockScene(scene);for(const phase of phases){
    const s=scene[phase];assert.equal(s.png,scene.name+'-'+phase+'.png')
    const b=fs.readFileSync(path.join(dir,s.png));assert.equal(s.bytes,b.length);assert.equal(s.sha256,createHash('sha256').update(b).digest('hex'))
    assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(b.readUInt32BE(16),s.viewport.width);assert.equal(b.readUInt32BE(20),s.viewport.height)
  }}return report
}
module.exports={verifyClockScene,verifyClockReport}
