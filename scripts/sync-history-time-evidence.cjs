const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const names=['date-light','date-dark','date-narrow']
const phases=['loaded','draft','applied','invalid','appended','missing','stale','cleared','open-ended']
const expectedIDs=[['a','b','c','d','e','f'],['a','b','c','d','e','f'],['b','c'],['b','c'],['b','c'],['g'],['g'],['a','b','c','d','e','f','g'],['a','b','c']]
const range={mode:'range',from:'2026-10-01',to:'2026-10-01'}
function verifyTimeScene(scene){
 assert.ok(names.includes(scene.name));assert.deepEqual(scene.frames.map(f=>f.phase),phases)
 const outcomeCounts=[[2,2,1,1],[2,2,1,1],[1,0,1,0],[1,0,1,0],[1,0,1,0],[0,0,0,1],[0,0,0,1],[2,2,1,2],[1,1,1,0]]
 scene.frames.forEach((f,i)=>{
  assert.equal(f.open,true);assert.deepEqual(f.ids,expectedIDs[i]);assert.equal(f.requests.length,[1,1,1,1,2,2,3,3,3][i]);assert.equal(f.downloads,[0,0,1,1,1,2,2,2,3][i])
  assert.deepEqual(f.outcomes,outcomeCounts[i]);assert.equal(f.kinds.reduce((n,v)=>n+v,0),f.ids.length)
  assert.match(f.summaryScope,new RegExp(`当前显示的 ${f.ids.length} 条`));assert.match(f.summaryScope,/不是全部历史/)
  assert.equal(f.pending,i===1||i===3);assert.equal(!!f.error,i===3);if(i===3)assert.match(f.error,/起始日期不能晚于/)
  assert.equal(f.hasMore,i<4);assert.equal(f.controlsVisible,true);assert.equal(f.focusInside,true);assert.ok(f.overflow<=1)
  assert.equal(f.mutations,0);assert.equal(f.networkRequests,0);assert.equal(f.navigationCalls,0);assert.equal(f.guidanceUnchanged,true);assert.equal(f.privateText,false)
  assert.ok(f.colors.length>=3&&f.colors.every(c=>Number.isFinite(c)&&c>=4.5));assert.ok(f.stable>=2&&f.rasterSamples>=2)
  assert.equal(f.rasterCode,names.indexOf(scene.name)*phases.length+i+1)
  f.requests.forEach((r,n)=>assert.deepEqual(r,{path:'/api/sync/conflicts/history?filter=all&limit=25'+(n===1?'&before=date-next':''),method:'GET'}))
  if([2,3,4].includes(i))assert.match(f.applied,/2026-10-01 至 2026-10-01.*包含结束当日/)
  else if([5,6].includes(i))assert.match(f.applied,/仅.*时间缺失/)
  else if(i===8)assert.match(f.applied,/2026-10-01 至 不限结束/)
  else assert.equal(f.applied,'')
  if(i>=6)assert.match(f.provenance,/最近读取失败/)
 })
 assert.equal(scene.downloads.length,3)
 scene.downloads.forEach((d,i)=>{
  assert.equal(d.state,'completed');assert.equal(d.filename,scene.name+'-'+i+'.json');assert.equal(d.json.version,2)
  assert.equal(d.json.format,'local-notepad-conflict-history')
  assert.deepEqual(d.json.records.map(r=>r.id),[['b','c'],['g'],['a','b','c']][i])
  assert.deepEqual(d.json.filters,{recordStatus:'all',objectType:'all',outcome:'all',textFilterApplied:false,
   completedDateUTC:[range,{mode:'missing',from:'',to:''},{mode:'range',from:'2026-10-01',to:''}][i]})
  assert.equal(d.json.scope.loadedCount,i===0?6:7);assert.equal(d.json.scope.exportedCount,[2,1,3][i]);assert.equal(d.json.scope.hasUnreadOlderRecords,i===0)
  assert.equal(d.json.scope.sourceState,i===2?'error':'ready');assert.equal(d.json.scope.currentRemoteStateVerified,false)
  for(const r of d.json.records)assert.deepEqual(Object.keys(r),['id','itemID','kind','currentTitle','createdAtUTC','completedAtUTC','status','resolution','outcome'])
  assert.equal(JSON.stringify(d.json).includes('PRIVATE_'),false)
  if(i===1)assert.equal(d.json.records[0].completedAtUTC,null)
 })
 return true
}
function verifyTimeReport(dir,commit){
 assert.match(commit,/^[a-f0-9]{40}$/)
 const report=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
 assert.equal(report.commit,commit);assert.equal(report.platform,'win32');assert.equal(report.complete,true)
 assert.equal(report.realOverview,true);assert.equal(report.syntheticRecords,true);assert.equal(report.actualBrowserDownload,true)
 assert.deepEqual(report.scenes.map(s=>s.name),names)
 for(const s of report.scenes){verifyTimeScene(s)
  for(const f of s.frames){assert.equal(f.filename,s.name+'-'+f.phase+'.png');const b=fs.readFileSync(path.join(dir,f.filename))
   assert.equal(b.length,f.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
   assert.equal(b.readUInt32BE(16),f.width);assert.equal(b.readUInt32BE(20),f.height);assert.equal(verifyRasterWitness(b,f.rasterCode),true)
  }
  for(const d of s.downloads){const b=fs.readFileSync(path.join(dir,d.filename));assert.equal(b.length,d.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),d.sha256);assert.deepEqual(JSON.parse(b),d.json)}
 }
 return report
}
module.exports={names,phases,verifyTimeScene,verifyTimeReport}
