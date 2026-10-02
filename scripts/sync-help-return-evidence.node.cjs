const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {createHash}=require('node:crypto'),{deflateSync}=require('node:zlib')
const {verifyHelpReturnScene,verifyHelpReturnReport}=require('./sync-help-return-evidence.cjs')
const commit='a'.repeat(40)
function scene(name='recovery-narrow') {
  const key=name==='recovery-narrow'?'recovery':name
  const sample=()=>({viewport:{width:name==='recovery-narrow'?560:1000,height:681}, requests:0,navigationCalls:0,otherOverviewOpen:false,activeMarkup:0,stableSamples:3,overflow:0,colors:Array.from({length:10},()=>({final:true,ratio:7})),readOnlyHelp:true})
  const currentTitle=name==='recovery-narrow'?'先核查写入结果':'正在读取更新后的状态'
  return {name,updateObserved:true,retainedAfterUpdate:true,retainedAfterReturn:true,repeatReturnVerified:true,disclosureVisibilityVerified:true,
    before:{...sample(),helpOpen:false,openTopics:[],returnVisible:false},
    after:{...sample(),helpOpen:true,openTopics:[key],focusedTopic:key,returnVisible:true},
    footer:{...sample(),helpOpen:true,openTopics:[key],focusedTopic:key,focusedGuidance:false,returnVisible:true,returnOnScreen:true,returnScopeText:true,revision:'1'},
    returned:{...sample(),helpOpen:true,openTopics:[key],focusedTopic:'',returnVisible:true,focusedGuidance:true,guidanceRole:'region',guidanceTag:'DIV',guidanceNamed:true,returnScopeText:true,currentTitle,revision:'1'}}
}
test('accepts complete return metadata for each of the four existing topics',()=>{
 for(const name of ['first-use','operations','conflicts','recovery-narrow'])assert.doesNotThrow(()=>verifyHelpReturnScene(scene(name)))
})
test('rejects an executable, unnamed or unfocused return destination',()=>{
 for(const change of [s=>s.returned.focusedGuidance=false,s=>s.returned.guidanceTag='BUTTON',s=>s.returned.guidanceRole='button',s=>s.returned.guidanceNamed=false,s=>s.returned.focusedTopic='recovery']){
  const s=scene();change(s);assert.throws(()=>verifyHelpReturnScene(s))
 }
})
test('rejects stale snapshot replay, closed help, changed topics and cross-instance return',()=>{
 for(const change of [s=>s.returned.revision='0',s=>s.returned.currentTitle='旧提示',s=>s.returned.helpOpen=false,s=>s.returned.openTopics=[],s=>s.returned.otherOverviewOpen=true,s=>s.retainedAfterReturn=false,s=>s.repeatReturnVerified=false]){
  const s=scene();change(s);assert.throws(()=>verifyHelpReturnScene(s))
 }
})
test('rejects side effects, hidden footer, missing scope text and private content',()=>{
 for(const change of [s=>s.returned.requests=1,s=>s.returned.navigationCalls=1,s=>s.returned.activeMarkup=1,s=>s.before.returnVisible=true,s=>s.footer.returnOnScreen=false,s=>s.disclosureVisibilityVerified=false,s=>s.returned.returnScopeText=false,s=>s.returned.extra='RETURN_PRIVATE']){
  const s=scene();change(s);assert.throws(()=>verifyHelpReturnScene(s))
 }
})
test('rejects unreadable, unstable and overflowed return evidence',()=>{
 for(const change of [s=>s.footer.colors[0].ratio=1,s=>s.returned.colors[0].final=false,s=>s.returned.stableSamples=1,s=>s.footer.overflow=10,s=>s.returned.overflow=NaN,s=>s.returned.viewport.height=900]){
  const s=scene();change(s);assert.throws(()=>verifyHelpReturnScene(s))
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
function withReport(run) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'help-return-evidence-'))
 const r={commit,platform:'win32',complete:true,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:['first-use','operations','conflicts','recovery-narrow'].map(n=>scene(n))}
 for(const s of r.scenes){const b=png(s.before.viewport.width,681);for(const phase of ['before','after','footer','returned']){
  Object.assign(s[phase],{png:`${s.name}-${phase}.png`,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});fs.writeFileSync(path.join(dir,s[phase].png),b)
 }}
 const save=()=>fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify(r));save()
 try{run(dir,r,save)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('complete report requires sixteen exact current-commit PNGs',()=>withReport(dir=>assert.equal(verifyHelpReturnReport(dir,commit).scenes.length,4)))
test('refuses missing, tampered or differently sized return/footer images',()=>{
 withReport(dir=>{fs.rmSync(path.join(dir,'operations-footer.png'));assert.throws(()=>verifyHelpReturnReport(dir,commit))})
 withReport(dir=>{fs.appendFileSync(path.join(dir,'operations-returned.png'),'tampered');assert.throws(()=>verifyHelpReturnReport(dir,commit))})
 withReport((dir,r,save)=>{const s=r.scenes[0].returned,b=png(1000,900);fs.writeFileSync(path.join(dir,s.png),b);s.bytes=b.length;s.sha256=createHash('sha256').update(b).digest('hex');save();assert.throws(()=>verifyHelpReturnReport(dir,commit))})
})
test('refuses partial scenes, stale commits, missing files metadata and non-native reports',()=>{
 for(const change of [r=>r.complete=false,r=>r.commit='b'.repeat(40),r=>r.scenes.pop(),r=>r.platform='linux',r=>delete r.scenes[0].returned,r=>r.scenes[0].footer.png='../other.png']){
  withReport((dir,r,save)=>{change(r);save();assert.throws(()=>verifyHelpReturnReport(dir,commit))})
 }
})
