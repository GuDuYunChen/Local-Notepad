const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const { verifyRasterWitness } = require('./sync-clock-raster-evidence.cjs')
const names = ['file-search-light', 'file-search-dark', 'file-search-narrow']
const phases = ['loaded', 'last-page-match', 'combined', 'candidate', 'committed', 'empty', 'stale', 'cleared', 'replaced']
function verifyFileSelectionScene(scene) {
  assert.ok(names.includes(scene.name)); assert.deepEqual(scene.frames.map(f => f.phase), phases)
  const expectedIds = [Array.from({length:25}, (_,i)=>'r'+i), ['r60'], Array.from({length:10},(_,i)=>'r'+(3+i*6)), Array.from({length:25},(_,i)=>'r'+(25+i)), ['r60'], [], ['r60'], Array.from({length:25},(_,i)=>'r'+i), ['fresh']]
  const queries = ['', 'abc', '', 'xingtu', '星图', 'missing', 'abc', '', '']
  const matched = [61,1,10,60,1,0,1,61,1]
  scene.frames.forEach((f,i) => {
    assert.deepEqual(f.ids, expectedIds[i]); assert.equal(f.query, queries[i])
    assert.equal(f.kind, i===2 ? 'tag' : 'all'); assert.equal(f.outcome, i===2 ? 'local' : 'all')
    assert.equal(f.filename, i===8 ? 'replacement.json' : 'history.json')
    assert.match(f.matches, new RegExp(`当前匹配 ${matched[i]} 条 / 文件内共 ${i===8?1:61} 条`))
    assert.match(f.scope, new RegExp(`文件内有 ${i===8?1:61} 条记录`))
    assert.equal(f.stale, i===6); assert.equal(f.composing, i===3)
    assert.equal(f.fileReads, i<6?1:i<8?2:3)
    assert.equal(f.requests,0); assert.equal(f.networkRequests,0); assert.equal(f.mutations,0); assert.equal(f.navigationCalls,0); assert.equal(f.downloads,0)
    assert.equal(f.liveHistoryUnchanged,true); assert.equal(f.guidanceUnchanged,true); assert.equal(f.activeMarkup,0)
    assert.ok(f.targetVisible); assert.ok(f.focusInside); assert.ok(f.overflow<=1)
    assert.ok(f.colors.length>=3 && f.colors.every(n=>Number.isFinite(n)&&n>=4.5))
    assert.equal(f.rasterCode,names.indexOf(scene.name)*phases.length+i+1); assert.ok(f.stable>=2 && f.rasterSamples>=2)
    assert.equal(f.scriptedCompositionEvents,0)
    if(i===5) { assert.ok(f.prevDisabled&&f.nextDisabled); assert.match(f.page,/暂无可翻页/); assert.ok(!f.page.includes('1 / 0')) }
    else assert.match(f.page,new RegExp(`第 ${i===3?2:1} / ${i===0||i===3||i===7?3:1} 页`))
    if(i===7) assert.ok(f.focusQuery)
  })
  const events=scene.frames[4].imeEvents
  assert.ok(events.some(e=>e.type==='compositionstart'&&e.trusted))
  assert.ok(events.some(e=>e.type==='compositionend'&&e.data==='星图'&&e.trusted))
  return true
}
function verifyFileSelectionReport(dir, commit) {
  assert.match(commit,/^[a-f0-9]{40}$/)
  const r=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
  assert.equal(r.commit,commit); assert.equal(r.complete,true); assert.equal(r.platform,'win32')
  assert.equal(r.actualFileReader,true); assert.equal(r.syntheticRecords,true); assert.equal(r.compositionDriver,'CDP native composition')
  assert.deepEqual(r.scenes.map(s=>s.name),names)
  for(const s of r.scenes) { verifyFileSelectionScene(s); for(const f of s.frames) {
    assert.equal(f.png,s.name+'-'+f.phase+'.png'); const b=fs.readFileSync(path.join(dir,f.png))
    assert.equal(b.length,f.bytes); assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
    assert.equal(b.readUInt32BE(16),f.width); assert.equal(b.readUInt32BE(20),f.height); assert.equal(verifyRasterWitness(b,f.rasterCode),true)
  }}
  return r
}
module.exports={names,phases,verifyFileSelectionScene,verifyFileSelectionReport}
