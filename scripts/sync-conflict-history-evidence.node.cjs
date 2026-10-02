const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),{createHash}=require('node:crypto')
const {verifyHistoryScene,verifyHistoryReport}=require('./sync-conflict-history-evidence.cjs')
const names=['history-light','history-dark','history-narrow'],phases=['unread','loaded','more','refresh-failed','stopped','empty']
function scene(name=names[0]){return{name,frames:phases.map((phase,i)=>({phase,
 ids:i===0||i===5?[]:i===1?['h3','h2']:['h3','h2','h1'],filter:i===5?'superseded':'all',
 requests:Array.from({length:i},()=>({method:'GET',path:'/api/sync/conflicts/history?filter=all&limit=25'})),
 mutations:0,networkRequests:0,navigationCalls:0,privateText:false,activeMarkup:0,currentGuidanceUnchanged:true,controlsVisible:true,focusInside:true,
 cancelledRead:i>=4,stableSamples:3,rasterSamples:2,rasterCode:names.indexOf(name)*6+i+1,overflow:0,
 colors:Array.from({length:4},()=>({final:true,ratio:7})),viewport:{width:560,height:681},
 feedback:['尚未读取','已读取 2 条记录','已读取 3 条记录','保留上次读取结果','没有取消同步任务','不代表当前没有未决冲突'][i],
 outcomes:'当时保留本机版本 / 重新绑定后失效；不代表已选边',iso:['2026-09-27T09:05:00.000Z','2026-09-27T09:06:40.000Z'],counts:['0','0']}))}}
function rejects(changes){for(const change of changes){const s=scene();change(s.frames[2],s);assert.throws(()=>verifyHistoryScene(s))}}
test('accepts all six bounded read-only history states in every layout',()=>names.forEach(n=>verifyHistoryScene(scene(n))))
test('rejects missing or misleading rows, states, request counts and scope',()=>rejects([
 f=>f.ids.push('open'),f=>f.filter='resolved',f=>f.feedback='全部历史已同步完成',f=>f.requests.pop(),f=>f.requests[0].method='POST',f=>f.requests[0].path='/api/sync/run',
 (f,s)=>s.frames[4].cancelledRead=false,(f,s)=>s.frames[5].feedback='没有任何未决冲突']))
test('rejects IO, private response text, lost focus, altered timestamps or hidden controls',()=>rejects([
 f=>f.mutations++,f=>f.networkRequests++,f=>f.navigationCalls++,f=>f.privateText=true,f=>f.activeMarkup++,f=>f.focusInside=false,f=>f.controlsVisible=false,
 f=>f.iso[0]='stale',f=>f.counts[0]='999',f=>f.currentGuidanceUnchanged=false,f=>f.colors[0].ratio=1,f=>f.overflow=2,f=>f.stableSamples=2]))
const crc=b=>{let v=0xffffffff;for(const n of b){v^=n;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0)}return(v^0xffffffff)>>>0}
function png(code){
 const chunk=(name,b)=>{const t=Buffer.from(name),size=Buffer.alloc(4),c=Buffer.alloc(4);size.writeUInt32BE(b.length);c.writeUInt32BE(crc(Buffer.concat([t,b])));return Buffer.concat([size,t,b,c])}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(560);ihdr.writeUInt32BE(681,4);ihdr[8]=8;ihdr[9]=2
 const pixels=Buffer.alloc((560*3+1)*681)
 for(let y=0;y<4;y++)for(let x=0;x<32;x++){const rgb=((code>>>(x/4|0))&1)?[221,238,255]:[17,34,51];for(let c=0;c<3;c++)pixels[y*(560*3+1)+1+x*3+c]=rgb[c]}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])
}
function files(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-evidence-')),commit='a'.repeat(40)
 const report={commit,platform:'win32',complete:true,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:names.map(scene)}
 for(const s of report.scenes)for(const f of s.frames){const b=png(f.rasterCode);f.png=s.name+'-'+f.phase+'.png';f.bytes=b.length;f.sha256=createHash('sha256').update(b).digest('hex');fs.writeFileSync(path.join(dir,f.png),b)}
 const save=()=>fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify(report));save()
 try{fn(dir,commit,report,save)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('requires all eighteen images and a complete exact-commit native report',()=>files((d,c,r,save)=>{
 assert.equal(verifyHistoryReport(d,c).scenes.length,3)
 for(const change of [r=>r.complete=false,r=>r.commit='b'.repeat(40),r=>r.realOverview=false,r=>r.platform='linux',r=>r.scenes.pop()]){
 const old=structuredClone(r);change(r);save();assert.throws(()=>verifyHistoryReport(d,c));Object.assign(r,old)}
}))
test('rejects absent, tampered and dimension-mismatched files',()=>{
 files((d,c,r)=>{fs.unlinkSync(path.join(d,r.scenes[0].frames[0].png));assert.throws(()=>verifyHistoryReport(d,c))})
 files((d,c,r)=>{fs.appendFileSync(path.join(d,r.scenes[0].frames[0].png),'changed');assert.throws(()=>verifyHistoryReport(d,c))})
 files((d,c,r,save)=>{r.scenes[0].frames[0].viewport.height++;save();assert.throws(()=>verifyHistoryReport(d,c))})
})
test('rejects a previous-phase PNG even with renewed file hashes and metadata',()=>files((d,c,r,save)=>{
 const f=r.scenes[0].frames[1],b=png(1);f.bytes=b.length;f.sha256=createHash('sha256').update(b).digest('hex');fs.writeFileSync(path.join(d,f.png),b);save()
 assert.throws(()=>verifyHistoryReport(d,c),/raster phase marker/)
}))
