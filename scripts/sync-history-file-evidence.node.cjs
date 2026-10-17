const test=require('node:test'),assert=require('node:assert/strict')
const {phases,verifyFileScene}=require('./sync-history-file-evidence.cjs')
function fixture(){return{name:'file-light',invalidUTF8Refused:true,oversizeRefused:true,frames:phases.map((phase,i)=>({
 phase,ids:i===1?Array.from({length:25},(_,n)=>'r'+n):i===2?Array.from({length:6},(_,n)=>'r'+(n+25)):i===3||i===4?['r0']:[],
 requests:0,mutations:0,networkRequests:0,navigationCalls:0,currentGuidanceUnchanged:true,liveRows:0,activeMarkup:0,targetVisible:true,focusInside:true,overflow:0,stable:2,rasterSamples:2,rasterCode:i+1,
 notice:i===0?'尚未选择文件':i===4?'文件不符合格式':i===5?'没有删除原文件':'格式检查通过',
 filename:i===1||i===2?'v1.json':i===3||i===4?'v2.json':'',scope:i<3?'31 条记录，31 条':'1 条记录，31 条',page:`第 ${i} / 2 页`,
 source:'读取失败',dates:'2026-09-30 至 2026-09-30',stale:i===4,focusChoose:i===5,colors:[7,7,7]
}))}}
test('accepts independently expected local file scope, page ranges and retained errors',()=>assert.equal(verifyFileScene(fixture()),true))
for(const [name,change] of [
 ['unexpected workspace read',s=>s.frames[1].requests++],
 ['data persistence',s=>s.frames[2].mutations++],
 ['upload attempt',s=>s.frames[2].networkRequests++],
 ['changed live history',s=>s.frames[1].liveRows=31],
 ['injected markup',s=>s.frames[1].activeMarkup++],
 ['wrong local page',s=>s.frames[2].ids[0]='r0'],
 ['stale file hidden',s=>s.frames[4].stale=false],
 ['file replaced on error',s=>s.frames[4].filename='invalid.json'],
 ['missing UTF8 rejection',s=>s.invalidUTF8Refused=false],
 ['hidden file control',s=>s.frames[1].targetVisible=false],
 ['poor contrast',s=>s.frames[1].colors[0]=2],
 ['missing frame',s=>s.frames.pop()],
])test('rejects '+name,()=>{const s=fixture();change(s);assert.throws(()=>verifyFileScene(s))})
