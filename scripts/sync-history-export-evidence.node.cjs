const test=require('node:test'),assert=require('node:assert/strict')
const {verifyExportScene,phases}=require('./sync-history-export-evidence.cjs')
function fixture(){
  const downloads=Array.from({length:3},(_,i)=>({state:'completed',requestedFilename:'Local-Notepad-冲突历史-2026-09-30T00-00-00-000Z.json',filename:'export-light-'+i+'.json',json:{
    format:'local-notepad-conflict-history',version:1,
    scope:{type:'loaded-filtered-history',loadedCount:i===0?5:6,exportedCount:1,hasUnreadOlderRecords:i===0,currentRemoteStateVerified:false,sourceState:i===0?'ready':'error'},
    filters:{recordStatus:'all',objectType:'all',outcome:'all',textFilterApplied:true},notices:i?['最近读取失败']:[],
    records:[{id:'h5',itemID:'note-h5',kind:'file',currentTitle:'星图研究 ＡＢＣ',createdAtUTC:null,completedAtUTC:null,status:'resolved',resolution:'local',outcome:'当时保留本机版本'}],
  }}))
  return {name:'export-light',downloads,frames:phases.map((phase,i)=>({phase,requests:[0,1,1,3,3,3][i],downloads:[0,1,1,2,2,3][i],query:i===0?'':i===2?'PRIVATE_QUERY':'abc',
    ids:i===0||i===2?[]:['h5'],disabled:i===0||i===2,mutations:0,networkRequests:0,navigationCalls:0,controlsVisible:true,overflow:0,guidanceUnchanged:true,rasterCode:i+1,stable:2,rawErrorVisible:false,domDownloadLinks:0,
    feedback:i===4?'未能发起下载':i===0||i===2?'':'已请求下载 1 条；尚未确认落盘',
  }))}
}
test('accepts the explicitly downloaded subset and preserved stale provenance',()=>assert.equal(verifyExportScene(fixture()),true))
for(const [name,change] of [
  ['extra implicit page read',s=>s.frames[1].requests++],
  ['download dispatched while blocked',s=>s.frames[2].downloads++],
  ['unexpected persistence',s=>s.frames[3].mutations++],
  ['false filesystem acknowledgement',s=>s.frames[5].feedback='文件已保存成功'],
  ['cancelled download counted complete',s=>s.downloads[0].state='cancelled'],
  ['stale results described as fresh',s=>s.downloads[1].json.scope.sourceState='ready'],
  ['hidden record exported',s=>s.downloads[0].json.records.push({...s.downloads[0].json.records[0],id:'h4'})],
  ['body field escaped',s=>s.downloads[0].json.records[0].content='PRIVATE_BODY'],
  ['query retained in metadata',s=>s.downloads[0].json.filters.query='abc'],
])test('rejects '+name,()=>{const s=fixture();change(s);assert.throws(()=>verifyExportScene(s))})
