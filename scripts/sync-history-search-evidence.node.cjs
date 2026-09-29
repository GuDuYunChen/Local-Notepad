const test=require('node:test'),assert=require('node:assert/strict')
const {phases,verifyHistorySearchScene}=require('./sync-history-search-evidence.cjs')
function fixture(){
 const queries=[['abc','file','local'],['abc','file','local'],['','attachment','superseded'],['晚章','all','all'],['晚章','all','all'],['abc','file','local'],['','all','all']]
 const ids=[[],['h5'],['h3'],[],['h0'],['h5'],['h5','h4','h3','h2','h1','h0']],counts=[0,1,1,1,2,3,3]
 return {name:'search-light',frames:phases.map((phase,i)=>({phase,ids:ids[i],query:queries[i][0],kind:queries[i][1],outcome:queries[i][2],serverFilter:'all',
  mutations:0,networkRequests:0,navigationCalls:0,privateText:false,activeMarkup:0,controlsVisible:true,focusInside:true,currentGuidanceUnchanged:true,
  colors:[{ratio:7},{ratio:7},{ratio:7}],overflow:0,rasterCode:i+1,hasMore:i<4,focusQuery:true,
  searchFeedback:['尚未读取','当前显示 1 条 / 已读取 5 条','','更早记录尚未读取','当前显示 1 条 / 已读取 6 条','','当前显示 6 条 / 已读取 6 条'][i],
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
])test('rejects '+name,()=>{const r=fixture();alter(r);assert.throws(()=>verifyHistorySearchScene(r))})
