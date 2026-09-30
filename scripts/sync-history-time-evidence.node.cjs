const test=require('node:test'),assert=require('node:assert/strict')
const {phases,verifyTimeScene}=require('./sync-history-time-evidence.cjs')
const ids=[['a','b','c','d','e','f'],['a','b','c','d','e','f'],['b','c'],['b','c'],['b','c'],['g'],['g'],['a','b','c','d','e','f','g'],['a','b','c']]
function fixture(){
 const name='date-light',ranges=[{mode:'range',from:'2026-10-01',to:'2026-10-01'},{mode:'missing',from:'',to:''},{mode:'range',from:'2026-10-01',to:''}]
 return {name,frames:phases.map((phase,i)=>({phase,open:true,ids:ids[i],requests:Array.from({length:[1,1,1,1,2,2,3,3,3][i]},(_,n)=>({path:'/api/sync/conflicts/history?filter=all&limit=25'+(n===1?'&before=date-next':''),method:'GET'})),downloads:[0,0,1,1,1,2,2,2,3][i],
  outcomes:[[2,2,1,1],[2,2,1,1],[1,0,1,0],[1,0,1,0],[1,0,1,0],[0,0,0,1],[0,0,0,1],[2,2,1,2],[1,1,1,0]][i],kinds:[ids[i].length,0,0,0],summaryScope:`当前显示的 ${ids[i].length} 条，不是全部历史`,pending:i===1||i===3,error:i===3?'起始日期不能晚于结束日期':'',hasMore:i<4,
  controlsVisible:true,focusInside:true,overflow:0,mutations:0,networkRequests:0,navigationCalls:0,guidanceUnchanged:true,privateText:false,colors:[7,7,7],stable:2,rasterSamples:2,rasterCode:i+1,
  applied:[2,3,4].includes(i)?'2026-10-01 至 2026-10-01，包含结束当日':[5,6].includes(i)?'仅处理时间缺失':i===8?'2026-10-01 至 不限结束':'',provenance:i>=6?'最近读取失败':'',
 })),downloads:ranges.map((completedDateUTC,i)=>({state:'completed',filename:name+'-'+i+'.json',json:{version:2,format:'local-notepad-conflict-history',
  filters:{recordStatus:'all',objectType:'all',outcome:'all',textFilterApplied:false,completedDateUTC},
  scope:{loadedCount:i===0?6:7,exportedCount:[2,1,3][i],hasUnreadOlderRecords:i===0,sourceState:i===2?'error':'ready',currentRemoteStateVerified:false},
  records:[['b','c'],['g'],['a','b','c']][i].map(id=>({id,itemID:'note-'+id,kind:'file',currentTitle:'星图',createdAtUTC:null,completedAtUTC:i===1?null:'2026-10-01T00:00:00.000Z',status:'resolved',resolution:'local',outcome:'当时保留本机版本'}))
 }}))}
}
test('accepts complete independently specified date scopes and actual-download metadata',()=>assert.equal(verifyTimeScene(fixture()),true))
for(const [name,change] of [
 ['off-by-one boundary row',s=>s.frames[2].ids=['a','b']],
 ['unapplied draft changed results',s=>s.frames[1].ids=['b','c']],
 ['invalid range replaced the old result',s=>s.frames[3].ids=[]],
 ['implicit read',s=>s.frames[2].requests.push(s.frames[2].requests[0])],
 ['wrong applied date in the file',s=>s.downloads[0].json.filters.completedDateUTC.to='2026-10-02'],
 ['v1 claimed for a dated export',s=>s.downloads[0].json.version=1],
 ['missing time changed into epoch',s=>s.downloads[1].json.records[0].completedAtUTC='1970-01-01T00:00:00.000Z'],
 ['hidden overflow',s=>s.frames[2].controlsVisible=false],
 ['stale snapshot called fresh',s=>s.downloads[2].json.scope.sourceState='ready'],
 ['low contrast',s=>s.frames[2].colors[0]=1],
 ['unexpected data persistence',s=>s.frames[2].mutations++],
 ['incomplete scene sequence',s=>s.frames.pop()],
])test('rejects '+name,()=>{const s=fixture();change(s);assert.throws(()=>verifyTimeScene(s))})
