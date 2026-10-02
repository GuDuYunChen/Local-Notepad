const test=require('node:test'),assert=require('node:assert/strict')
const {phases,verifyPaginationScene}=require('./sync-history-file-pagination-evidence.cjs')
function fixture() {
  const range=(s,n)=>Array.from({length:n},(_,i)=>'r'+(s+i)), rows=[range(0,25),range(50,11),range(25,25),range(25,25),['r60'],[],range(0,25)]
  const page=[1,3,2,2,1,0,1],count=[61,61,61,61,1,0,61],draft=['1','3','2','99','1','','1']
  return {name:'pagination-light',frames:phases.map((phase,i)=>({phase,ids:rows[i],draft:draft[i],invalid:i===3,error:i===3?'页码须在 1 至 3 之间':'',matches:`当前匹配 ${count[i]} 条 / 文件内共 61 条`,outcomes:[count[i],0,0,0],
    reads:1,requests:0,network:0,mutations:0,downloads:0,navigation:0,liveUnchanged:true,sourceUnchanged:true,activeMarkup:0,visible:true,focusInside:true,focusJump:true,focusQuery:true,overflow:0,colors:[7,7,7],stable:2,samples:2,code:i+1,
    page:i===5?'没有匹配记录，暂无可翻页内容':`第 ${page[i]} / ${i===4?1:3} 页`,readOnly:i===5,
    disabled:{first:page[i]<=1,prev:page[i]<=1,last:i===5||i===4||page[i]===3,next:i===5||i===4||page[i]===3,jump:i===5},
  }))}
}
test('accepts exact file/page counts, non-mutating navigation and invalid-request refusal',()=>assert.equal(verifyPaginationScene(fixture()),true))
for(const [name,mutate] of [
  ['truncated final page',s=>s.frames[1].ids.pop()],['jump silently clamped',s=>s.frames[3].ids=['r60']],
  ['summary counts only current page',s=>s.frames[1].outcomes[0]=11],['extra file read',s=>s.frames[1].reads++],
  ['download',s=>s.frames[1].downloads++],['filter scope lost',s=>s.frames[4].matches='当前匹配 1 条 / 文件内共 1 条'],
  ['invalid error revived after clear',s=>s.frames[6].invalid=true],['unusable zero-match next',s=>s.frames[5].disabled.next=false],
  ['hidden navigation',s=>s.frames[2].visible=false],['focus stolen on jump',s=>s.frames[2].focusJump=false],
  ['low contrast',s=>s.frames[2].colors[0]=2],['missing frame',s=>s.frames.pop()],
]) test('rejects '+name,()=>{const s=fixture();mutate(s);assert.throws(()=>verifyPaginationScene(s))})
