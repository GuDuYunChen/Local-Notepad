const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto')
const {verifyRasterWitness} = require('./sync-clock-raster-evidence.cjs')
const phases = ['unread-local', 'title-match', 'kind-outcome', 'unread-pages', 'appended-match', 'refresh-failed', 'cleared',
  'ime-candidate', 'ime-committed', 'ime-boundary', 'ime-boundary-committed']
const scenes = ['search-light', 'search-dark', 'search-narrow']
function verifyHistorySearchScene(scene) {
  assert.ok(scenes.includes(scene.name));assert.equal(scene.frames.length, phases.length)
  const expected = [[],['h5'],['h3'],[],['h0'],['h5'],['h5','h4','h3','h2','h1','h0'],['h5'],['h5','h4'],[],[]]
  const requestCounts = [0,1,1,1,2,3,3,3,3,3,3]
  scene.frames.forEach((f,i)=>{
    assert.equal(f.phase,phases[i]);assert.deepEqual(f.ids,expected[i]);assert.equal(f.requests.length,requestCounts[i])
    assert.equal(f.serverFilter,'all');assert.equal(f.mutations,0);assert.equal(f.networkRequests,0);assert.equal(f.navigationCalls,0)
    assert.equal(f.privateText,false);assert.equal(f.activeMarkup,0);assert.equal(f.controlsVisible,true);assert.equal(f.focusInside,true)
    assert.equal(f.currentGuidanceUnchanged,true);assert.ok(f.overflow<=1);assert.ok(f.colors.length>=3&&f.colors.every(c=>c.ratio>=4.5))
    assert.ok(f.stableSamples>=2);assert.ok(f.rasterSamples>=2)
    assert.equal(f.rasterCode,scenes.indexOf(scene.name)*phases.length+i+1)
    const wants=[['abc','file','local'],['abc','file','local'],['','attachment','superseded'],['晚章','all','all'],['晚章','all','all'],['abc','file','local'],['','all','all'],
      ['xingtu','all','all'],['星图','all','all'],['文'.repeat(127)+'zhong','all','all'],['文'.repeat(127)+'中','all','all']][i]
    assert.deepEqual([f.query,f.kind,f.outcome],wants)
    f.requests.forEach((r,n)=>{assert.equal(r.method,'GET');assert.equal(r.path,'/api/sync/conflicts/history?filter=all&limit=25'+(n===1?'&before=older-page':''))})
    assert.equal(f.scriptedCompositionEvents,0)
    assert.ok(Array.isArray(f.imeEvents))
    // Chromium's queued compositionend is observed with isTrusted=false in
    // Electron31; require trusted starts/updates, not a fabricated end flag.
    // Pair exact events with completed host-side CDP commands and reject all
    // JavaScript-dispatched composition events in the fixture.
    assert.ok(f.imeEvents.every(e=>e.type==='compositionend'?typeof e.trusted==='boolean':e.trusted===true))
    const commands=[
      {method:'Input.imeSetComposition',params:{text:'xingtu',selectionStart:6,selectionEnd:6,replacementStart:0,replacementEnd:3},completed:true},
      {method:'Input.insertText',params:{text:'星图'},completed:true},
      {method:'Input.imeSetComposition',params:{text:'zhong',selectionStart:5,selectionEnd:5,replacementStart:127,replacementEnd:127},completed:true},
      {method:'Input.insertText',params:{text:'中'},completed:true},
    ]
    assert.deepEqual(f.cdpCommands,commands.slice(0,i<7?0:i-6))
    const events=[['compositionstart','abc'],['compositionupdate','xingtu'],
      ['compositionupdate','星图'],['compositionend','星图'],['compositionstart',''],
      ['compositionupdate','zhong'],['compositionupdate','中'],['compositionend','中']]
    assert.deepEqual(f.imeEvents.map(e=>[e.type,e.data]),events.slice(0,i<7?0:i===7?2:i===8?4:i===9?6:8))
    if(i<7)assert.equal(f.imeEvents.length,0)
    else {
      assert.equal(f.focusQuery,true)
      assert.ok(f.imeEvents.some(e=>e.type==='compositionstart'))
      assert.ok(f.imeEvents.some(e=>e.type==='compositionupdate'&&e.data==='xingtu'))
      if(i>=8)assert.ok(f.imeEvents.some(e=>e.type==='compositionend'&&e.data==='星图'))
      if(i>=9)assert.ok(f.imeEvents.some(e=>e.type==='compositionupdate'&&e.data==='zhong'))
      if(i===10)assert.ok(f.imeEvents.some(e=>e.type==='compositionend'&&e.data==='中'))
      if(i===7||i===9)assert.match(f.searchFeedback,/输入法文字尚未确认/)
      else assert.doesNotMatch(f.searchFeedback,/输入法文字尚未确认/)
    }
  })
  assert.match(scene.frames[0].searchFeedback,/尚未读取/)
  assert.match(scene.frames[1].searchFeedback,/当前显示 1 条 \/ 已读取 5 条/)
  assert.match(scene.frames[2].outcomes,/不代表已选边/)
  assert.match(scene.frames[3].searchFeedback,/更早记录尚未读取/);assert.equal(scene.frames[3].hasMore,true)
  assert.match(scene.frames[4].searchFeedback,/当前显示 1 条 \/ 已读取 6 条/);assert.equal(scene.frames[4].hasMore,false)
  assert.match(scene.frames[5].readFeedback,/保留上次读取结果/);assert.equal(scene.frames[5].query,'abc')
  assert.match(scene.frames[6].searchFeedback,/当前显示 6 条 \/ 已读取 6 条/)
  assert.equal(scene.frames[6].focusQuery,true)
  assert.match(scene.frames[7].searchFeedback,/当前显示 1 条 \/ 已读取 6 条/)
  assert.match(scene.frames[8].searchFeedback,/当前显示 2 条 \/ 已读取 6 条/)
  assert.equal([...scene.frames[9].query].length,132)
  assert.equal([...scene.frames[10].query].length,128)
  return true
}
function verifyHistorySearchReport(dir,commit) {
  assert.match(commit,/^[a-f0-9]{40}$/)
  const report=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
  assert.equal(report.commit,commit);assert.equal(report.complete,true);assert.equal(report.realOverview,true)
  assert.equal(report.platform,'win32');assert.equal(report.compositionDriver,'CDP Input.imeSetComposition/Input.insertText')
  assert.equal(report.syntheticRecords,true);assert.equal(report.backendExercised,false)
  assert.deepEqual(report.scenes.map(s=>s.name),scenes)
  for(const scene of report.scenes){verifyHistorySearchScene(scene);for(const frame of scene.frames){
    assert.equal(frame.png,scene.name+'-'+frame.phase+'.png')
    const bytes=fs.readFileSync(path.join(dir,frame.png))
    assert.equal(bytes.length,frame.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),frame.sha256)
    assert.equal(bytes.readUInt32BE(16),frame.viewport.width);assert.equal(bytes.readUInt32BE(20),frame.viewport.height)
    assert.equal(verifyRasterWitness(bytes,frame.rasterCode),true)
  }}
  return report
}
module.exports={phases,scenes,verifyHistorySearchScene,verifyHistorySearchReport}
