const test=require('node:test'),assert=require('node:assert/strict')
const {phases,verifySummaryScene}=require('./sync-history-summary-evidence.cjs')
function fixture(){
 const iso=n=>n===null?null:new Date(n*1000).toISOString(),counts=[5,1,6,6,0,1]
 return {name:'summary-light',frames:phases.map((phase,i)=>({phase,open:true,rows:counts[i],scope:`当前显示的 ${counts[i]} 条，不是全部历史`,
 outcomes:[[2,1,1,1],[1,0,0,0],[2,2,1,1],[2,2,1,1],[0,0,0,0],[0,1,0,0]][i],kinds:[[2,1,1,1],[1,0,0,0],[3,1,1,1],[3,1,1,1],[0,0,0,0],[1,0,0,0]][i],
 earliest:iso([1790586200,1790586600,1790586100,1790586100,null,null][i]),latest:iso(i<4?1790586600:null),unread:i<2,
 coverage:`有时间记录 ${i===5?0:counts[i]} 条，时间缺失 ${i===5?1:0} 条`,provenance:i===3||i===4?'最近读取失败':'',noTime:i===4?'没有匹配':i===5?'没有已知':'',
 requests:Array.from({length:[1,1,2,3,3,4][i]},(_,n)=>({method:'GET',path:'/api/sync/conflicts/history?filter=all&limit=25'+(n===1?'&before=older-page':'')})),
 privateText:false,mutations:0,networkRequests:0,navigationCalls:0,summaryActionControls:0,guidanceUnchanged:true,visible:true,focusInside:true,overflow:0,colors:Array(12).fill(7),stable:2,rasterSamples:2,rasterCode:i+1,
 }))}
}
test('accepts complete independently expected summary scopes across all six states',()=>assert.equal(verifySummaryScene(fixture()),true))
for(const [label,change] of [
 ['double counting',s=>s.frames[0].outcomes[0]++],['wrong kind',s=>s.frames[2].kinds=[2,2,1,1]],
 ['invented missing time',s=>s.frames[5].earliest='1970-01-01T00:00:00.000Z'],['stale state hidden',s=>s.frames[3].provenance=''],
 ['all-history claim',s=>s.frames[0].scope='全部历史5条'],['implicit page load',s=>s.frames[1].requests.push(s.frames[1].requests[0])],
 ['hidden controls',s=>s.frames[2].visible=false],['new write',s=>s.frames[2].mutations++],
 ['low contrast',s=>s.frames[2].colors[0]=1],['missing frame',s=>s.frames.pop()],
])test('rejects '+label,()=>{const s=fixture();change(s);assert.throws(()=>verifySummaryScene(s))})
