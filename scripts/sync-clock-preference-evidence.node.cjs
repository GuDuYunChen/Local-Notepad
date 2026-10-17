const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib')
const { createHash } = require('node:crypto')
const { verifyPreferenceScene, verifyPreferenceReport } = require('./sync-clock-preference-evidence.cjs')
const commit = 'a'.repeat(40), names = ['local-light', 'local-dark', 'local-narrow', 'blocked-storage']
function scene(name) {
  const blocked = name === 'blocked-storage', frame = () => ({ mode: 'utc', stored: blocked ? 'invalid' : null, open: false,
    error: blocked ? 'invalid' : '', mutations: [], requests: 0, navigationCalls: 0, otherKeyPreserved: true,
    privateText: false, otherUTC: true, iso: ['2024-11-03T08:30:00.000Z','2024-11-03T09:30:00.000Z'], guidance: 'fixed guidance', counts: ['0','0'],
    colors: Array.from({length:5},()=>({ratio:8,final:true})), viewport: {width:name==='local-narrow'?560:1000,height:681},
    overflow: 0, stableSamples: 3, controlsVisible: true, summaryVisible: true })
  const s = { name, before:frame(), saved:frame(), reloaded:frame(), final:frame(), reloadVerified:true, currentRetained:true, saveFocusRetained:true, clearFocusRetained:true }
  Object.assign(s.saved,{mode:'local',stored:blocked?'invalid':'local',open:true,mutations:[['set','local']],error:blocked?'save':''})
  Object.assign(s.reloaded,{mode:blocked?'utc':'local',stored:blocked?'invalid':'local'})
  Object.assign(s.final,{mode:blocked?'utc':'local',open:true,mutations:[['remove']],error:blocked?'clear':''})
  return s
}
// Valid-format synthetic PNGs exercise verifier structure, not UI rendering.
function png(width,height) {
  const crc = b => { let c=0xffffffff; for(const n of b){c^=n;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0 }
  const chunk=(name,body)=>{const type=Buffer.from(name),n=Buffer.alloc(4),check=Buffer.alloc(4);n.writeUInt32BE(body.length);check.writeUInt32BE(crc(Buffer.concat([type,body])));return Buffer.concat([n,type,body,check])}
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))])
}
function reportFixture(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clock-pref-evidence-')),r={commit,complete:true,platform:'win32',realOverview:true,syntheticRecords:true,backendExercised:false,scenes:names.map(scene)}
  const cache = new Map()
  for(const s of r.scenes)for(const phase of ['before','saved','reloaded','final']){
    const f=s[phase],width=f.viewport.width;if(!cache.has(width))cache.set(width,png(width,681));const b=cache.get(width)
    f.png=s.name+'-'+phase+'.png';f.bytes=b.length;f.sha256=createHash('sha256').update(b).digest('hex');fs.writeFileSync(path.join(dir,f.png),b)
  }
  const save=()=>fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify(r));save()
  try{fn(dir,r,save)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('accepts complete independent semantic records for success and storage failure',()=>{for(const n of names)verifyPreferenceScene(scene(n))})
test('rejects false persistence, automatic saving, lost selection and missing actual reload',()=>{
  for(const change of [s=>s.saved.stored=null,s=>s.before.mutations=[['set','utc']],s=>s.reloadVerified=false,s=>s.reloaded.mode='utc',s=>s.final.mode='utc',s=>s.currentRetained=false]){
    const s=scene('local-light');change(s);assert.throws(()=>verifyPreferenceScene(s))
  }
})
test('blocked storage cannot claim saved or cleared and must report each failure',()=>{
  for(const change of [s=>s.saved.error='',s=>s.saved.stored='local',s=>s.final.error='',s=>s.final.stored=null]){const s=scene('blocked-storage');change(s);assert.throws(()=>verifyPreferenceScene(s))}
})
test('rejects IO side effects, unrelated data loss, focus loss or another live instance following',()=>{
  for(const change of [s=>s.saved.requests=1,s=>s.saved.navigationCalls=1,s=>s.saved.otherKeyPreserved=false,s=>s.saved.privateText=true,s=>s.saveFocusRetained=false,s=>s.clearFocusRetained=false,s=>s.saved.otherUTC=false]){const s=scene('local-dark');change(s);assert.throws(()=>verifyPreferenceScene(s))}
})
test('rejects unreadable, hidden, unstable, overflowing or timestamp-changing frames',()=>{
  for(const change of [f=>f.colors[0].ratio=1,f=>f.colors[0].final=false,f=>f.controlsVisible=false,f=>f.summaryVisible=false,f=>f.stableSamples=2,f=>f.overflow=5,f=>f.iso=['wrong']]){const s=scene('local-narrow');change(s.saved);assert.throws(()=>verifyPreferenceScene(s))}
})
test('requires sixteen exact current-commit valid-format PNGs',()=>reportFixture(dir=>assert.equal(verifyPreferenceReport(dir,commit).scenes.length,4)))
test('rejects stale, partial or non-native reports even with valid PNGs',()=>{
  for(const change of [r=>r.complete=false,r=>r.commit='b'.repeat(40),r=>r.scenes.pop(),r=>r.platform='linux',r=>r.backendExercised=true])reportFixture((dir,r,save)=>{change(r);save();assert.throws(()=>verifyPreferenceReport(dir,commit))})
})
test('rejects absent, tampered or wrong-size images even with a renewed hash',()=>{
  reportFixture(dir=>{fs.rmSync(path.join(dir,'local-light-saved.png'));assert.throws(()=>verifyPreferenceReport(dir,commit))})
  reportFixture(dir=>{fs.appendFileSync(path.join(dir,'local-dark-saved.png'),'tamper');assert.throws(()=>verifyPreferenceReport(dir,commit))})
  reportFixture((dir,r,save)=>{const f=r.scenes[0].saved,b=png(999,681);fs.writeFileSync(path.join(dir,f.png),b);f.bytes=b.length;f.sha256=createHash('sha256').update(b).digest('hex');save();assert.throws(()=>verifyPreferenceReport(dir,commit))})
})
