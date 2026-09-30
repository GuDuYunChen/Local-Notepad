const test=require('node:test'),assert=require('node:assert/strict')
const {phases,verifyHistorySearchScene}=require('./sync-history-search-evidence.cjs')
function fixture(){
 const queries=[['abc','file','local'],['abc','file','local'],['','attachment','superseded'],['晚章','all','all'],['晚章','all','all'],['abc','file','local'],['','all','all'],['xingtu','all','all'],['星图','all','all'],['文'.repeat(127)+'zhong','all','all'],['文'.repeat(127)+'中','all','all']]
 const ids=[[],['h5'],['h3'],[],['h0'],['h5'],['h5','h4','h3','h2','h1','h0'],['h5'],['h5','h4'],[],[]],counts=[0,1,1,1,2,3,3,3,3,3,3]
 const events=[{type:'compositionstart',data:'',trusted:true},{type:'compositionupdate',data:'xingtu',trusted:true},
  {type:'compositionend',data:'星图',trusted:true},{type:'compositionstart',data:'',trusted:true},
  {type:'compositionupdate',data:'zhong',trusted:true},{type:'compositionend',data:'中',trusted:true}]
 return {name:'search-light',frames:phases.map((phase,i)=>({phase,ids:ids[i],query:queries[i][0],kind:queries[i][1],outcome:queries[i][2],serverFilter:'all',
  mutations:0,networkRequests:0,navigationCalls:0,privateText:false,activeMarkup:0,controlsVisible:true,focusInside:true,currentGuidanceUnchanged:true,
  stableSamples:2,rasterSamples:2,imeEvents:events.slice(0,i<7?0:i===7?2:i===8?3:i===9?5:6),colors:[{ratio:7},{ratio:7},{ratio:7}],overflow:0,rasterCode:i+1,hasMore:i<4,focusQuery:true,
  searchFeedback:['尚未读取','当前显示 1 条 / 已读取 5 条','','更早记录尚未读取','当前显示 1 条 / 已读取 6 条','','当前显示 6 条 / 已读取 6 条','输入法文字尚未确认，当前显示 1 条 / 已读取 6 条','当前显示 2 条 / 已读取 6 条','输入法文字尚未确认','当前显示 0 条 / 已读取 6 条'][i],
  outcomes:i===2?'不代表已选边':'',readFeedback:i===5?'保留上次读取结果':'',
  requests:Array.from({length:counts[i]},(_,n)=>({path:'/api/sync/conflicts/history?filter=all&limit=25'+(n===1?'&before=older-page':''),method:'GET'}))
 }))}
}
test('accepts complete independent local-selection expectations',()=>assert.equal(verifyHistorySearchScene(fixture()),true))
for(const [name,alter] of [
 ['extra automatic read',r=>r.frames[3].requests.push(r.frames[3].requests[0])],
 ['query sent to server',r=>r.frames[1].requests[0].path+='&query=abc'],
 ['body write',r=>r.frames[1].requests[0].method='PUT'],
 ['private persistence',r=>r.frames[2].mutations=1],
 ['unfiltered results',r=>r.frames[1].ids.push('h4')],
 ['unread pages called empty history',r=>r.frames[3].searchFeedback='全部历史没有匹配'],
 ['lost query after append',r=>r.frames[4].query=''],
 ['hidden narrow controls',r=>r.frames[4].controlsVisible=false],
 ['insufficient contrast',r=>r.frames[4].colors[0].ratio=2],
 ['lost clear-button focus',r=>r.frames[6].focusQuery=false],
 ['missing phase',r=>r.frames.pop()],
 ['candidate used as committed filter',r=>r.frames[7].ids=[]],
 ['candidate truncated by limit',r=>r.frames[9].query='文'.repeat(127)+'z'],
 ['missing final Chinese commit',r=>r.frames[10].query='文'.repeat(127)+'z'],
 ['synthetic rather than native composition',r=>r.frames[7].imeEvents[0].trusted=false],
 ['missing composition observation',r=>r.frames[8].imeEvents=[]],
 ['unsettled screenshot',r=>r.frames[8].rasterSamples=1],
 ['unstable DOM',r=>r.frames[8].stableSamples=1],
])test('rejects '+name,()=>{const r=fixture();alter(r);assert.throws(()=>verifyHistorySearchScene(r))})
