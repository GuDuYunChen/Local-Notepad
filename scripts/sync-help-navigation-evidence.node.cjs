const test = require('node:test'), assert = require('node:assert/strict')
const { verifyHelpNavigationScene } = require('./sync-help-navigation-evidence.cjs')
function scene() {
  const base = { viewport: { width: 560, height: 681 }, requests: 0, navigationCalls: 0, otherOverviewOpen: false, activeMarkup: 0,
    stableSamples: 3, overflow: 0, colors: Array.from({ length: 10 }, () => ({ final: true, ratio: 7 })), readOnlyHelp: true }
  return { name: 'recovery-narrow', updateObserved: true, retainedAfterUpdate: true,
    before: { ...base, helpOpen: false, openTopics: [] },
    after: { ...base, helpOpen: true, openTopics: ['recovery'], focusedTopic: 'recovery' } }
}
test('accepts complete semantic scene metadata (not a PNG/render substitute)', () => assert.doesNotThrow(() => verifyHelpNavigationScene(scene())))
test('rejects unexercised, wrong or cross-instance navigation', () => {
  for (const change of [s=>s.after.helpOpen=false,s=>s.after.openTopics=['operations'],s=>s.after.focusedTopic='',s=>s.after.otherOverviewOpen=true,s=>s.retainedAfterUpdate=false]) {
    const s=scene();change(s);assert.throws(()=>verifyHelpNavigationScene(s))
  }
})
test('rejects side effects and omitted read-only boundaries', () => {
  for (const change of [s=>s.after.requests=1,s=>s.after.navigationCalls=1,s=>s.after.activeMarkup=1,s=>s.after.readOnlyHelp=false,s=>s.after.extra='NAV_PRIVATE']) {
    const s=scene();change(s);assert.throws(()=>verifyHelpNavigationScene(s))
  }
})
test('rejects unstable or unreadable evidence and initially auto-opened help', () => {
  for (const change of [s=>s.after.stableSamples=2,s=>s.after.overflow=8,s=>s.after.colors[0].ratio=2,s=>s.before.helpOpen=true]) {
    const s=scene();change(s);assert.throws(()=>verifyHelpNavigationScene(s))
  }
})

test('requires an observed committed snapshot update, not just elapsed time', () => {
  for (const value of [undefined, false]) {
    const s=scene();s.updateObserved=value;assert.throws(()=>verifyHelpNavigationScene(s))
  }
})

// Structural file fixtures are synthetic PNGs, not renderer test substitutes.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createHash } = require('node:crypto'), { deflateSync } = require('node:zlib')
const { verifyHelpNavigationReport } = require('./sync-help-navigation-evidence.cjs')
const commit = 'a'.repeat(40)
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
function withReport(height, run) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'help-navigation-evidence-'))
  const report={commit,platform:'win32',complete:true,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:[]}
  for(const [name,topic] of Object.entries({'first-use':'first-use',operations:'operations',conflicts:'conflicts','recovery-narrow':'recovery'})){
    const s=scene(),width=name==='recovery-narrow'?560:1000,b=png(width,height)
    s.name=name;s.after.openTopics=[topic];s.after.focusedTopic=topic
    for(const phase of ['before','after']){
      const sample=s[phase];sample.viewport={width,height};sample.png=name+'-'+phase+'.png';sample.bytes=b.length;sample.sha256=createHash('sha256').update(b).digest('hex')
      fs.writeFileSync(path.join(dir,sample.png),b)
    }
    report.scenes.push(s)
  }
  const save=()=>fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify(report));save()
  try{run(dir,report,save)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('complete files match the measured 681px or 900px viewport instead of an assumed height',()=>{
  for(const height of [681,900])withReport(height,dir=>assert.equal(verifyHelpNavigationReport(dir,commit).complete,true))
})
test('rejects absent, changed, too-small or PNG-mismatched viewport evidence',()=>{
  for(const change of [r=>delete r.scenes[0].after.viewport,r=>r.scenes[0].after.viewport.height=680,r=>r.scenes[0].before.viewport.height=r.scenes[0].after.viewport.height=680,r=>r.scenes[0].before.viewport.height=r.scenes[0].after.viewport.height=1,r=>r.scenes[0].after.viewport.width=560]){
    withReport(681,(dir,r,save)=>{change(r);save();assert.throws(()=>verifyHelpNavigationReport(dir,commit))})
  }
})
test('rejects missing or altered images and partial or stale reports regardless of process exit',()=>{
  withReport(681,dir=>{fs.rmSync(path.join(dir,'operations-after.png'));assert.throws(()=>verifyHelpNavigationReport(dir,commit))})
  withReport(681,dir=>{fs.appendFileSync(path.join(dir,'operations-after.png'),'altered');assert.throws(()=>verifyHelpNavigationReport(dir,commit))})
  for(const change of [r=>r.complete=false,r=>r.commit='b'.repeat(40),r=>r.scenes.pop()])withReport(681,(dir,r,save)=>{change(r);save();assert.throws(()=>verifyHelpNavigationReport(dir,commit))})
})
