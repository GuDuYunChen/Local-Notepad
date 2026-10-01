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

// Exercise the actual driver helper without Electron or user data. These are
// fault-injected contract tests, not native Windows screenshots.
const { establishNativeViewport, VIEWPORT_PROBE, MAX_OBSERVATIONS } = require('./native-test-viewport.cjs')
function windowDouble({initial=[1000,681],clamped=false,rendererAt,failRead,hangRead=false,destroyed=false}={}) {
 let size=initial.slice(), reads=0
 const resize=[]
 const win={isDestroyed:()=>destroyed,getContentSize:()=>size.slice(),setContentSize:(w,h)=>{resize.push([w,h]);if(!clamped)size=[w,h]},
  webContents:{executeJavaScript:async code=>{assert.equal(code,VIEWPORT_PROBE);reads++;if(failRead)throw Error('fixture error');if(hangRead)return new Promise(()=>{});return rendererAt?rendererAt(reads,size):{width:size[0],height:size[1]}}}}
 return {win,resize,get reads(){return reads}}
}
const fast={intervalMs:1,readTimeoutMs:30}
test('establishes the requested 900px client area after a constructor was clamped to 681px',async()=>{
 const stub=windowDouble(),result=await establishNativeViewport(stub.win,1000,900,fast)
 assert.deepEqual(stub.resize,[[1000,900]]);assert.deepEqual(result.initial,{width:1000,height:681})
 assert.deepEqual(result.content,{width:1000,height:900});assert.deepEqual(result.renderer,{width:1000,height:900})
 assert.equal(result.resizeRequests,1);assert.equal(result.observations,2);assert.equal(result.consecutiveMatches,2)
})
test('establishes the exact narrow client size without turning it into a wide window',async()=>{
 const stub=windowDouble({initial:[560,681]}),result=await establishNativeViewport(stub.win,560,900,fast)
 assert.deepEqual(stub.resize,[[560,900]]);assert.deepEqual(result.content,{width:560,height:900})
})
test('already exact size still needs two independent native/renderer observations',async()=>{
 const stub=windowDouble({initial:[1000,900]}),result=await establishNativeViewport(stub.win,1000,900,fast)
 assert.equal(stub.reads,2);assert.equal(result.observations,2);assert.equal(stub.resize.length,1)
})
test('a late renderer resize is observed without replaying the native resize',async()=>{
 const stub=windowDouble({rendererAt:(n)=>({width:1000,height:n<3?681:900})})
 const result=await establishNativeViewport(stub.win,1000,900,fast)
 assert.equal(result.observations,4);assert.equal(stub.resize.length,1)
})
test('a transient exact sample is not a stable viewport',async()=>{
 const stub=windowDouble({rendererAt:(n)=>({width:1000,height:n===2?681:900})})
 assert.equal((await establishNativeViewport(stub.win,1000,900,fast)).observations,4)
})
test('persistent native clamping fails after a fixed observation budget, with no retry',async()=>{
 const stub=windowDouble({clamped:true})
 await assert.rejects(establishNativeViewport(stub.win,1000,900,fast),/did not settle at 1000x900; content=1000x681/)
 assert.equal(stub.reads,MAX_OBSERVATIONS);assert.deepEqual(stub.resize,[[1000,900]])
})
test('native success cannot conceal a renderer that still has the wrong height',async()=>{
 const stub=windowDouble({rendererAt:()=>({width:1000,height:681})})
 await assert.rejects(establishNativeViewport(stub.win,1000,900,fast),/renderer=1000x681/)
 assert.equal(stub.resize.length,1)
})
test('wrong renderer width is rejected even when height is correct',async()=>{
 const stub=windowDouble({rendererAt:()=>({width:999,height:900})})
 await assert.rejects(establishNativeViewport(stub.win,1000,900,fast),/renderer=999x900/)
})
test('native read failure stops instead of substituting requested dimensions',async()=>{
 const stub=windowDouble({failRead:true})
 await assert.rejects(establishNativeViewport(stub.win,1000,900,fast),/renderer read failed/)
 assert.equal(stub.reads,1);assert.equal(stub.resize.length,1)
})
test('a renderer that never responds has a bounded failure without extra reads',async()=>{
 const stub=windowDouble({hangRead:true})
 await assert.rejects(establishNativeViewport(stub.win,1000,900,fast),/renderer read timed out/)
 assert.equal(stub.reads,1)
})
test('destroyed windows never receive a resize or renderer read',async()=>{
 const stub=windowDouble({destroyed:true})
 await assert.rejects(establishNativeViewport(stub.win,1000,900,fast),/destroyed/)
 assert.equal(stub.reads,0);assert.deepEqual(stub.resize,[])
})
test('destroyed-after-resize stops before a file can be selected',async()=>{
 const stub=windowDouble();let calls=0;stub.win.isDestroyed=()=>++calls>1
 await assert.rejects(establishNativeViewport(stub.win,1000,900,fast),/destroyed/)
 assert.equal(stub.reads,0);assert.equal(stub.resize.length,1)
})
for(const args of [[0,900,fast],[1000,'900',fast],[1000,900,{intervalMs:0}],[1000,900,{readTimeoutMs:1001}]])
 test('invalid native viewport contract '+JSON.stringify(args),async()=>{
  const stub=windowDouble();await assert.rejects(establishNativeViewport(stub.win,...args),/invalid/);assert.deepEqual(stub.resize,[])
 })
test('evidence continues to reject the original 681px height instead of weakening the 900px gate',()=>{
 const scene=fixture();for(const f of scene.frames)f.height=681
 assert.throws(()=>verifyOrderScene(scene),/681 !== 900/)
})
test('native ordering driver establishes viewport after load and before any file interaction',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'check-sync-history-file-order.cjs'),'utf8')
 const setup=source.indexOf('scene.viewport=await establishNativeViewport(win,width,900)')
 assert.ok(setup>source.indexOf('await win.loadFile('));assert.ok(setup<source.indexOf("await choose('history.json')"))
 assert.equal((source.match(/await establishNativeViewport\(/g)||[]).length,1)
})
