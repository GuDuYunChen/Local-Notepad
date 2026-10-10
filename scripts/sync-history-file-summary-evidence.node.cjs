const test=require('node:test'),assert=require('node:assert/strict')
const {phases}=require('./sync-history-file-selection-evidence.cjs')
const {verifyFileSummaryScene}=require('./sync-history-file-summary-evidence.cjs')
function fixture(){
 const outcomes=[[20,40,1,0],[0,0,1,0],[10,0,0,0],[20,40,0,0],[0,0,1,0],[0,0,0,0],[0,0,1,0],[20,40,1,0],[1,0,0,0]]
 const kinds=[[31,30,0,0],[1,0,0,0],[0,10,0,0],[30,30,0,0],[1,0,0,0],[0,0,0,0],[1,0,0,0],[31,30,0,0],[1,0,0,0]]
 return {name:'file-search-light',summaryFrames:phases.map((phase,i)=>{
  const n=outcomes[i].reduce((a,b)=>a+b,0),date=n?'2026-09-30T00:00:00.000Z':null
  return {phase,outcomes:outcomes[i],kinds:kinds[i],scope:`全部 ${n} 条匹配记录，不是当前页、本机历史`,earliest:date,latest:date,
   coverage:`有时间记录 ${n} 条，时间缺失 0 条`,retained:i===6||i===7,composing:i===3,open:true,visible:true,overflow:0,colors:Array(12).fill(7),
   fileReads:i<6?1:i<8?2:3,requests:0,mutations:0,networkRequests:0,navigationCalls:0,downloads:0,actionControls:0,
   focusInside:true,liveHistoryUnchanged:true,guidanceUnchanged:true,rasterCode:i+65,stable:2,rasterSamples:2}
 })}
}
test('accepts all matched file records, retained provenance and original read counts',()=>assert.equal(verifyFileSummaryScene(fixture()),true))
for(const [label,change] of [
 ['page-only total',s=>s.summaryFrames[0].outcomes=[9,16,0,0]],
 ['superseded counted remote',s=>s.summaryFrames[1].outcomes=[0,1,0,0]],
 ['wrong object dimension',s=>s.summaryFrames[2].kinds=[10,0,0,0]],
 ['candidate applied early',s=>s.summaryFrames[3].outcomes=[0,0,0,0]],
 ['stale source hidden',s=>s.summaryFrames[7].retained=false],
 ['extra file read',s=>s.summaryFrames[2].fileReads++],
 ['extra storage write',s=>s.summaryFrames[2].mutations++],
 ['empty date fabricated',s=>s.summaryFrames[5].earliest='1970-01-01T00:00:00.000Z'],
 ['invisible summary',s=>s.summaryFrames[4].visible=false],
 ['insufficient contrast',s=>s.summaryFrames[4].colors[0]=2],
 ['missing screenshot stage',s=>s.summaryFrames.pop()],
])test('rejects '+label,()=>{const s=fixture();change(s);assert.throws(()=>verifyFileSummaryScene(s))})
