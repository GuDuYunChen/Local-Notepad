const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {createHash}=require('node:crypto'),{deflateSync}=require('node:zlib'),{verifyClockScene,verifyClockReport}=require('./sync-clock-evidence.cjs')
const commit='a'.repeat(40),names=['shanghai-light','los-angeles-dark','kathmandu-narrow','unread-dark','timezone-unavailable'],phases=['before','local','updated','restored']
function scene(name='shanghai-light'){
  const unread=name==='unread-dark',bad=name==='timezone-unavailable'
  const r={name,zoneEmulated:true,updateObserved:true,choiceAndFocusRetained:true,helpRetained:true}
  for(const phase of phases){
    const local=['local','updated'].includes(phase),updated=['updated','restored'].includes(phase)
    const iso=['2024-11-03T08:30:00.000Z',updated?'2024-11-03T09:31:00.000Z':'2024-11-03T09:30:00.000Z']
    const minute=updated?'31':'30'
    const text=name==='los-angeles-dark'?['2024-11-03 01:30:00.000 GMT-07:00',`2024-11-03 01:${minute}:00.000 GMT-08:00`]:name==='kathmandu-narrow'?['2024-11-03 14:15:00.000 GMT+05:45',`2024-11-03 15:${updated?'16':'15'}:00.000 GMT+05:45`]:['2024-11-03 16:30:00.000 GMT+08:00',`2024-11-03 17:${minute}:00.000 GMT+08:00`]
    r[phase]={selected:local?'local':'utc',zone:!local||bad?'UTC':name==='los-angeles-dark'?'America/Los_Angeles':name==='kathmandu-narrow'?'Asia/Katmandu':'Asia/Shanghai',fallback:local&&bad,
      values:unread?[]:iso.map((value,i)=>({iso:value,title:'UTC：'+value,text:local&&!bad?text[i]:value})),counts:unread?['未知','未知','尚无记录']:['0','0','timestamp'],
      title:updated?'先核查写入结果':'先预演，再决定是否同步',provenance:unread?'尚无可核实的读取结果':updated?'上次读取结果；刷新失败或状态待核实':'已读取的状态快照',recoveryNotice:updated?'恢复保护阻断':'',
      requests:0,navigationCalls:0,otherUTC:true,privateText:false,scopeText:true,controlsOnScreen:true,controlCount:2,stableSamples:3,overflow:0,
      colors:Array.from({length:8},()=>({final:true,ratio:7})),viewport:{width:name==='kathmandu-narrow'?560:1000,height:681}}
  }return r
}
test('accepts all five independent conversion scenarios',()=>{for(const n of names)assert.doesNotThrow(()=>verifyClockScene(scene(n)))})
test('rejects wrong offsets, stale instants, altered UTC originals and false freshness',()=>{
  for(const change of [s=>s.local.values[0].text='wrong offset',s=>s.updated.values[1].iso=s.before.values[1].iso,s=>s.local.values[0].title='local only',s=>s.updated.provenance='已读取的状态快照',s=>s.updated.recoveryNotice='']){
    const s=scene();change(s);assert.throws(()=>verifyClockScene(s))
  }
})
test('rejects side effects and missing focus, choice, help or instance isolation',()=>{
  for(const change of [s=>s.local.requests=1,s=>s.updated.navigationCalls=1,s=>s.local.otherUTC=false,s=>s.updateObserved=false,s=>s.choiceAndFocusRetained=false,s=>s.helpRetained=false,s=>s.local.privateText=true,s=>s.zoneEmulated=false]){
    const s=scene();change(s);assert.throws(()=>verifyClockScene(s))
  }
})
test('rejects unknown-to-epoch conversion and falsely successful timezone fallback',()=>{
  const unread=scene('unread-dark');unread.local.values=[{iso:'1970-01-01T00:00:00.000Z'}];assert.throws(()=>verifyClockScene(unread))
  const bad=scene('timezone-unavailable');bad.local.fallback=false;assert.throws(()=>verifyClockScene(bad))
})
test('rejects hidden controls, low contrast, unstable frames, changed viewport and overflow',()=>{
  for(const change of [s=>s.local.controlsOnScreen=false,s=>s.local.scopeText=false,s=>s.local.colors[0].ratio=2,s=>s.local.colors[0].final=false,s=>s.local.stableSamples=1,s=>s.local.overflow=10,s=>s.local.viewport.height=900]){
    const s=scene();change(s);assert.throws(()=>verifyClockScene(s))
  }
})
function png(width, height) {
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]), length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    let crc = 0xffffffff
    for (const byte of body) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, body, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=6
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))])
}
function withReport(run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clock-evidence-')),r={commit,platform:'win32',complete:true,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:names.map(scene)}
  for(const s of r.scenes){const b=png(s.before.viewport.width,681);for(const phase of phases){Object.assign(s[phase],{png:s.name+'-'+phase+'.png',bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});fs.writeFileSync(path.join(dir,s[phase].png),b)}}
  const save=()=>fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify(r));save();try{run(dir,r,save)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('requires all twenty exact current-commit images',()=>withReport(dir=>assert.equal(verifyClockReport(dir,commit).scenes.length,5)))
test('rejects partial, stale, non-native or tampered evidence',()=>{
  for(const change of [r=>r.commit='b'.repeat(40),r=>r.complete=false,r=>r.platform='linux',r=>r.scenes.pop(),r=>r.scenes[0].local.png='../other.png'])withReport((dir,r,save)=>{change(r);save();assert.throws(()=>verifyClockReport(dir,commit))})
  withReport(dir=>{fs.rmSync(path.join(dir,'los-angeles-dark-local.png'));assert.throws(()=>verifyClockReport(dir,commit))})
  withReport(dir=>{fs.appendFileSync(path.join(dir,'unread-dark-before.png'),'tampered');assert.throws(()=>verifyClockReport(dir,commit))})
})
test('rejects dimension mismatches even with an updated PNG hash',()=>withReport((dir,r,save)=>{
  const s=r.scenes[0].local,b=png(1000,900);fs.writeFileSync(path.join(dir,s.png),b);s.bytes=b.length;s.sha256=createHash('sha256').update(b).digest('hex');save();assert.throws(()=>verifyClockReport(dir,commit))
}))
