const test=require('node:test'),assert=require('node:assert/strict')
const {names,phases,verifyOrderScene}=require('./sync-history-file-order-evidence.cjs')
function fixture(name=names[0]) {
 const range=(a,n,step=1)=>Array.from({length:n},(_,i)=>'r'+(a+i*step))
 const ids=[range(0,25),range(59,25,-1),range(0,25),range(25,25),['r60'],[],range(0,25)]
 return {name,frames:phases.map((phase,i)=>({phase,ids:ids[i],order:['file','completed-asc','created-asc','created-asc','created-asc','created-asc','file'][i],
  draft:['1','1','1','2','1','','1'][i],invalid:false,error:'',matches:`当前匹配 ${i===4?1:i===5?0:61} 条 / 文件内共 61 条`,outcomes:i===4?[1,0,0,0]:i===5?[0,0,0,0]:[61,0,0,0],
  requests:0,network:0,mutations:0,downloads:0,navigation:0,activeMarkup:0,reads:1,liveUnchanged:true,sourceUnchanged:true,
  visible:true,focusInside:true,overflow:0,colors:[4.8,5,6],stable:2,samples:2,code:names.indexOf(name)*phases.length+i+1,width:name==='order-narrow'?560:1000,height:900,
  page:i===5?'没有匹配记录，暂无可翻页内容':`第 ${i===3?2:1} / ${i===4?1:3} 页`,readOnly:i===5,
  disabled:i===5?{first:true,prev:true,next:true,last:true,jump:true}:{first:i!==3,prev:i!==3,next:i===4,last:i===4,jump:false},focusOrder:[1,2,6].includes(i),focusJump:i===3}))}
}
for(const name of names)test('accept complete synthetic contract '+name,()=>assert.equal(verifyOrderScene(fixture(name)),true))
for(const [name,mutate]of[
 ['wrong order',s=>s.frames[1].order='file'],['only first-page sorting',s=>s.frames[1].ids[0]='r24'],
 ['lost missing row',s=>s.frames[4].ids=[]],['stale jump error',s=>s.frames[1].invalid=true],
 ['extra file read',s=>s.frames[1].reads=2],['network request',s=>s.frames[1].network=1],['write',s=>s.frames[1].mutations=1],
 ['changed live history',s=>s.frames[1].liveUnchanged=false],['changed metadata',s=>s.frames[1].sourceUnchanged=false],
 ['wrong total',s=>s.frames[1].matches='当前匹配 25 条 / 文件内共 61 条'],['hidden controls',s=>s.frames[1].visible=false],
 ['low contrast',s=>s.frames[1].colors=[4.49,5,6]],['unstable raster',s=>s.frames[1].samples=1],
 ['wrong pixel phase',s=>s.frames[1].code=99],['missing frame',s=>s.frames.pop()],['lost focus',s=>s.frames[1].focusOrder=false],
 ['wrong window',s=>s.frames[1].width=560],['false empty-page navigation',s=>s.frames[5].disabled.jump=false],
 ['missing empty-page control evidence',s=>s.frames[5].disabled={}],
])test('reject '+name,()=>{const scene=fixture();mutate(scene);assert.throws(()=>verifyOrderScene(scene))})
