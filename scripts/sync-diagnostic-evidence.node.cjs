const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { scenarios, validateEvidence } = require('./sync-diagnostic-evidence.cjs')
const commit = 'a'.repeat(40), bytes = Buffer.alloc(120)
Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes); bytes.writeUInt32BE(560,16); bytes.writeUInt32BE(681,20)
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
function good() { return { commit, complete:true, platform:'win32', realComponents:true, syntheticRecords:true, backendExercised:false, manualSelection:true, clipboardFailureHandled:true,
 scenes:scenarios.map(name=>({name,ready:true,networkCalls:0,privateLeak:false,overflow:0,textOverflow:0,previewChars:1200,areaVisible:true,ratios:[5,6,7],width:560,height:681,sha256})) } }
test('accepts only matching commit and complete five-scene evidence',()=>assert.equal(validateEvidence(good(),commit,()=>bytes),true))
test('a clean process exit cannot replace report completion or missing scenes',()=>{
 for(const change of [r=>r.complete=false,r=>r.scenes.pop(),r=>r.commit='b'.repeat(40),r=>r.manualSelection=false,r=>r.clipboardFailureHandled=false,r=>r.scenes[0].name='other']){
 const r=good();change(r);assert.throws(()=>validateEvidence(r,commit,()=>bytes)) }
})
test('rejects leaked, unreadable, inaccessible, partial or network-active scenes',()=>{
 for(const change of [s=>s.privateLeak=true,s=>s.networkCalls=1,s=>s.ratios=[4.49,7,8],s=>s.ratios=[NaN,7,8],s=>s.overflow=10,s=>s.areaVisible=false,s=>s.previewChars=9000,s=>s.ready=false]){
 const r=good();change(r.scenes[0]);assert.throws(()=>validateEvidence(r,commit,()=>bytes)) }
})
test('image hash, PNG signature and real dimensions must match',()=>{
 for(const image of [Buffer.from('bad'),Buffer.alloc(120),Buffer.from(bytes).fill(1,30,31)]) assert.throws(()=>validateEvidence(good(),commit,()=>image))
 const r=good();r.scenes[1].width=1000;assert.throws(()=>validateEvidence(r,commit,()=>bytes))
})
