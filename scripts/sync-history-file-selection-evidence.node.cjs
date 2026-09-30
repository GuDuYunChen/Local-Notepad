const test=require('node:test'),assert=require('node:assert/strict')
const {phases,verifyFileSelectionScene}=require('./sync-history-file-selection-evidence.cjs')
function fixture() {
  const counts=[61,1,10,60,1,0,1,61,1], queries=['','abc','','xingtu','星图','missing','abc','','']
  const ids=[Array.from({length:25},(_,i)=>'r'+i),['r60'],Array.from({length:10},(_,i)=>'r'+(3+i*6)),Array.from({length:25},(_,i)=>'r'+(25+i)),['r60'],[],['r60'],Array.from({length:25},(_,i)=>'r'+i),['fresh']]
  return {name:'file-search-light',frames:phases.map((phase,i)=>({phase,ids:ids[i],query:queries[i],kind:i===2?'tag':'all',outcome:i===2?'local':'all',filename:i===8?'replacement.json':'history.json',
    matches:`当前匹配 ${counts[i]} 条 / 文件内共 ${i===8?1:61} 条`,scope:`文件内有 ${i===8?1:61} 条记录`,stale:i===6,composing:i===3,fileReads:i<6?1:i<8?2:3,
    requests:0,networkRequests:0,mutations:0,navigationCalls:0,downloads:0,liveHistoryUnchanged:true,guidanceUnchanged:true,activeMarkup:0,targetVisible:true,focusInside:true,focusQuery:true,overflow:0,colors:[7,7,7],
    rasterCode:i+1,stable:2,rasterSamples:2,scriptedCompositionEvents:0,prevDisabled:i===5,nextDisabled:i===5,
    page:i===5?'暂无可翻页':`第 ${i===3?2:1} / ${i===0||i===3||i===7?3:1} 页`,
    imeEvents:[{type:'compositionstart',trusted:true},{type:'compositionend',data:'星图',trusted:true}],
  }))}
}
test('accepts complete independent file-search scope and composition expectations',()=>assert.equal(verifyFileSelectionScene(fixture()),true))
for(const [name,change] of [
 ['search only page one',s=>s.frames[1].ids=[]],['wrong file total',s=>s.frames[1].matches='当前匹配 1 条 / 文件内共 1 条'],
 ['candidate applied early',s=>s.frames[3].ids=[]],['scripted IME claimed native',s=>s.frames[4].scriptedCompositionEvents++],
 ['untrusted composition',s=>s.frames[4].imeEvents[1].trusted=false],['implicit file reread',s=>s.frames[2].fileReads++],
 ['workspace query',s=>s.frames[2].requests++],['private persistence',s=>s.frames[2].mutations++],
 ['invalid replacement accepted',s=>s.frames[6].filename='bad.json'],['lost clear focus',s=>s.frames[7].focusQuery=false],
 ['fake empty page',s=>s.frames[5].page='第 1 / 0 页'],['new file hides contents',s=>s.frames[8].query='abc'],
 ['hidden control',s=>s.frames[1].targetVisible=false],['low contrast',s=>s.frames[1].colors[0]=2],
]) test('rejects '+name,()=>{const s=fixture();change(s);assert.throws(()=>verifyFileSelectionScene(s))})
