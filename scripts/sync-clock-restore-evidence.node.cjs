const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),{createHash}=require('node:crypto')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const {verifyRestoreScene,verifyRestoreReport}=require('./sync-clock-restore-evidence.cjs')
function scene(name='restore-light'){
  const phases=['temporary','restored','external','empty','invalid','unavailable','recovered']
  const states=[['local','utc',''],['utc','utc',''],['local','local',''],['local',null,''],['local','invalid','invalid'],['local','invalid','read'],['utc','utc','']]
  return {name,frames:phases.map((phase,i)=>({rasterCode:1+['restore-light','restore-dark','restore-narrow'].indexOf(name)*7+i,rasterSamples:2,phase,mode:states[i][0],stored:states[i][1],error:states[i][2],open:true,restoreVisible:true,actionsVisible:true,
    mutations:[],requests:0,navigationCalls:0,otherKeyPreserved:true,otherUTC:true,privateText:false,
    iso:['2026-09-27T09:05:00.000Z','2026-09-27T09:06:40.000Z'],guidance:'unchanged',counts:['0','0'],focusRetained:true,
    stableSamples:3,overflow:0,colors:Array.from({length:8},()=>({final:true,ratio:7})),viewport:{width:560,height:681},
    comparison:i===0?'当前仅为本次显示':i===1||i===6?'一致：UTC':i===2?'一致：本机时区':i===3?'未记住选择':'尚未核实',
    receipt:i===3?'没有已保存的时间偏好，当前显示保持不变。':i===4||i===5?'':'已读取保存记录'}))}
}
test('accepts all seven explicitly observed restore outcomes',()=>{for(const name of ['restore-light','restore-dark','restore-narrow'])verifyRestoreScene(scene(name))})
test('rejects stale cached preferences, absent scenarios and incorrect mode changes',()=>{
  for(const change of [s=>s.frames.pop(),s=>s.frames[2].mode='utc',s=>s.frames[3].mode='utc',s=>s.frames[5].error='',s=>s.frames[6].mode='local']){
    const s=scene();change(s);assert.throws(()=>verifyRestoreScene(s))
  }
})
test('rejects IO, unrelated changes, focus loss and falsely successful reads',()=>{
  for(const change of [f=>f.mutations.push(['set','utc']),f=>f.requests++,f=>f.navigationCalls++,f=>f.otherUTC=false,f=>f.otherKeyPreserved=false,
    f=>f.privateText=true,f=>f.focusRetained=false,f=>f.iso[0]='wrong',f=>f.guidance='changed',f=>f.counts[0]='7']){
    const s=scene();change(s.frames[1]);assert.throws(()=>verifyRestoreScene(s))
  }
})
test('rejects hidden action buttons, unstable frames and unreadable colors',()=>{
  for(const change of [f=>f.restoreVisible=false,f=>f.actionsVisible=false,f=>f.colors[0].ratio=1,f=>f.colors[0].final=false,f=>f.stableSamples=2,f=>f.overflow=15]){
    const s=scene();change(s.frames[1]);assert.throws(()=>verifyRestoreScene(s))
  }
})
// Small valid generated PNGs; these exercise evidence validation, not rendering.
const crc=b=>{let v=0xffffffff;for(const n of b){v^=n;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0)}return (v^0xffffffff)>>>0}
function png(code=1){
  const chunk=(name,b)=>{const t=Buffer.from(name),size=Buffer.alloc(4),c=Buffer.alloc(4);size.writeUInt32BE(b.length);c.writeUInt32BE(crc(Buffer.concat([t,b])));return Buffer.concat([size,t,b,c])}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(560);ihdr.writeUInt32BE(681,4);ihdr[8]=8;ihdr[9]=2
  const pixels=Buffer.alloc((560*3+1)*681)
  for(let y=0;y<4;y++)for(let x=0;x<32;x++){const rgb=((code>>>(x/4|0))&1)?[221,238,255]:[17,34,51];for(let c=0;c<3;c++)pixels[y*(560*3+1)+1+x*3+c]=rgb[c]}
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])
}
function files(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clock-restore-evidence-')),commit='a'.repeat(40)
  const r={commit,platform:'win32',complete:true,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:['restore-light','restore-dark','restore-narrow'].map(scene)}
  for(const s of r.scenes)for(const f of s.frames){const bytes=png(f.rasterCode);f.png=s.name+'-'+f.phase+'.png';f.bytes=bytes.length;f.sha256=createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(path.join(dir,f.png),bytes)}
  const save=()=>fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify(r));save()
  try{fn(dir,commit,r,save)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('requires twenty-one current-commit PNGs and complete native reports',()=>files((dir,commit,r,save)=>{
  assert.equal(verifyRestoreReport(dir,commit).scenes.length,3)
  for(const change of [r=>r.complete=false,r=>r.commit='b'.repeat(40),r=>r.realOverview=false,r=>r.platform='linux']){
    const original=structuredClone(r);change(r);save();assert.throws(()=>verifyRestoreReport(dir,commit));Object.assign(r,original)
  }
}))
test('rejects absent, modified and wrongly sized images',()=>{
  files((dir,c,r,save)=>{fs.unlinkSync(path.join(dir,r.scenes[0].frames[0].png));assert.throws(()=>verifyRestoreReport(dir,c))})
  files((dir,c,r,save)=>{fs.appendFileSync(path.join(dir,r.scenes[0].frames[0].png),'bad');assert.throws(()=>verifyRestoreReport(dir,c))})
  files((dir,c,r,save)=>{r.scenes[0].frames[0].viewport.width=561;save();assert.throws(()=>verifyRestoreReport(dir,c))})
})

test('raster verifier rejects a previous phase even when PNG hashes are renewed',()=>files((dir,c,r,save)=>{
  const f=r.scenes[0].frames[1],b=png(1);fs.writeFileSync(path.join(dir,f.png),b);f.bytes=b.length;f.sha256=createHash('sha256').update(b).digest('hex');save()
  assert.throws(()=>verifyRestoreReport(dir,c),/raster phase marker/)
}))
test('raster proof is required and no phase can borrow another phase code',()=>{
  assert.equal(verifyRasterWitness(png(21),21),true);assert.throws(()=>verifyRasterWitness(png(20),21))
  for(const change of [f=>delete f.rasterSamples,f=>f.rasterSamples=1,f=>f.rasterCode=3]){const s=scene();change(s.frames[0]);assert.throws(()=>verifyRestoreScene(s))}
})
