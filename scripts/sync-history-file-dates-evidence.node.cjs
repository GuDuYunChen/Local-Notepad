const test=require('node:test'),assert=require('node:assert/strict')
const {phases,verifyDateScene}=require('./sync-history-file-dates-evidence.cjs')
function fixture(){return{name:'file-dates-light',frames:phases.map((phase,i)=>({phase,
 ids:[['r25','r26','r27','r28','r29','r30'],['r26','r27'],['r26','r27'],['r29','r30'],['r29','r30'],Array.from({length:25},(_,n)=>'r'+n),['fresh']][i],
 outcomes:[[28,1,1,1],[1,1,0,0],[1,1,0,0],[1,0,1,0],[1,0,1,0],[28,1,1,1],[1,0,0,0]][i],
 total:i===6?1:31,dateOpen:true,pending:i===0||i===2,invalid:i===2,mode:i<3?'range':i<5?'missing':'all',stale:i===4||i===5,
 reads:i<4?1:i<6?2:3,requests:0,mutations:0,network:0,downloads:0,navigation:0,liveUnchanged:true,privateText:false,visible:true,focusInside:true,overflow:0,colors:[7,7,7],stable:2,samples:2,code:i+1,
 applied:i===1||i===2?'2026-09-30 至 2026-09-30':i===3||i===4?'时间缺失':'',filename:i===6?'replacement.json':'history.json',page:i===0?'2 / 2':i===5?'1 / 2':'1 / 1'
}))}}
test('accepts exact date intersection and retained provenance in all seven phases',()=>assert.equal(verifyDateScene(fixture()),true))
for(const [label,alter] of [
 ['draft applied early',s=>s.frames[0].ids=['r26','r27']],['end-day truncated',s=>s.frames[1].ids=['r26']],
 ['invalid intent replaces results',s=>s.frames[2].applied='2026-10-02 至 2026-09-30'],['summary counts only current page',s=>s.frames[0].outcomes=[3,1,1,1]],
 ['hidden stale state',s=>s.frames[4].stale=false],['clear erases stale origin',s=>s.frames[5].stale=false],
 ['extra file IO',s=>s.frames[2].reads++],['low contrast',s=>s.frames[1].colors[0]=2],
 ['replacement inherits dates',s=>s.frames[6].mode='missing'],['wrong file scope',s=>s.frames[1].total=2],
])test('rejects '+label,()=>{const s=fixture();alter(s);assert.throws(()=>verifyDateScene(s))})
