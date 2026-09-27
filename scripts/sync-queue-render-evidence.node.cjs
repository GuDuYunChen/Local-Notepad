const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { verifyQueueReport, verifyQueueEvidence, requireCompletedRender, scenes, selectors } = require('./run-sync-conflict-queue-render.cjs')
const sha = 'a'.repeat(40)
const fixture = () => ({ complete: true, platform: 'win32', syntheticRecords: true, realComponents: true,
  backendExercised: false, navigationFocus: true, nativeSearch: true, writes: 0, commit: sha,
  reports: scenes.map(([name, width, count, label]) => ({ name, ready: true, stableSamples: 3, count, label,
    bounds: [20, width - 40, 600], viewport: [width,900], imageSize: [width,900], overflow: 0, writes: 0, activeMarkup: 0,
    colors: selectors.map(selector => ({ selector, finalColor: true, foreground: [36,34,42], background: [255,255,255], ratio: 15.7 })) })) })
function evidence(t, report = fixture()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-evidence-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(report))
  // Header/trailer fixture only, not a fake claim of decoded/native image pixels.
  for (const [name, width] of scenes) {
    const png = Buffer.alloc(45); Buffer.from('89504e470d0a1a0a','hex').copy(png)
    png.write('IHDR',12); png.writeUInt32BE(width,16); png.writeUInt32BE(900,20); png.write('IEND',37)
    fs.writeFileSync(path.join(dir,name+'.png'),png)
  }
  return dir
}
test('requires all five ordered scenarios and every successful receipt', t => {
  const dir = evidence(t), report = requireCompletedRender({status:0},dir,sha)
  assert.equal(report.reports.length,5)
})
test('the actual green #1247 incomplete artifact is rejected even after child exit zero', t => {
  const old = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/sync-queue-incomplete-report.json')))
  assert.equal(old.complete,false); assert.equal(old.reports.length,1)
  const dir=evidence(t,old)
  assert.throws(()=>requireCompletedRender({status:0},dir,null),/did not finish/)
})
test('complete flag cannot conceal missing or duplicate scenes', () => {
  for (const mutate of [r=>r.reports.pop(),r=>{r.reports[1]=r.reports[0]},r=>r.reports.reverse()]) {
    const r=fixture();mutate(r);assert.throws(()=>verifyQueueReport(r,sha))
  }
})
test('incomplete evidence from any of the five scenes is fatal', () => {
  for(let i=0;i<5;i++) for(const mutate of [r=>{r.ready=false},r=>{r.stableSamples=2},r=>{r.count++},r=>{r.label='wrong'},r=>{r.overflow=2}]) {
    const r=fixture();mutate(r.reports[i]);assert.throws(()=>verifyQueueReport(r,sha))
  }
})
test('missing low-contrast or not-final color probes are rejected', () => {
  for(let i=0;i<selectors.length;i++) for(const mutate of [c=>{c.finalColor=false},c=>{c.ratio=4.49},c=>{c.ratio=NaN},c=>{c.foreground=[]},c=>{c.selector='wrong'}]) {
    const r=fixture();mutate(r.reports[0].colors[i]);assert.throws(()=>verifyQueueReport(r,sha))
  }
  const r=fixture();r.reports[0].colors.pop();assert.throws(()=>verifyQueueReport(r,sha))
})
test('unverified focus search writes or wrong platform cannot pass', () => {
  for(const field of ['complete','realComponents','navigationFocus','nativeSearch','syntheticRecords']){
    const r=fixture();r[field]=false;assert.throws(()=>verifyQueueReport(r,sha))
  }
  for(const mutate of [r=>{r.writes=1},r=>{r.backendExercised=true},r=>{r.platform='linux'},r=>{r.reports[0].activeMarkup=1},r=>{r.reports[0].writes=1}]){
    const r=fixture();mutate(r);assert.throws(()=>verifyQueueReport(r,sha))
  }
})
test('stale commit cannot satisfy the current run', t => {
  const dir=evidence(t);assert.throws(()=>verifyQueueEvidence(dir,'b'.repeat(40)),/another commit/)
})
test('missing screenshot cannot be replaced by a successful JSON receipt', t => {
  for(const [name] of scenes){const dir=evidence(t);fs.unlinkSync(path.join(dir,name+'.png'));assert.throws(()=>verifyQueueEvidence(dir,sha))}
})
test('empty truncated or incorrectly sized screenshot is rejected', t => {
  for(const mutate of [b=>Buffer.alloc(0),b=>b.subarray(0,25),b=>{b.writeUInt32BE(1,16);return b},b=>{b.writeUInt32BE(1,20);return b},b=>{b.write('nope',37);return b}]){
    const dir=evidence(t),p=path.join(dir,'light-1180.png');fs.writeFileSync(p,mutate(fs.readFileSync(p)));assert.throws(()=>verifyQueueEvidence(dir,sha))
  }
})
test('malformed or missing JSON fails closed',t=>{
  const dir=evidence(t);fs.writeFileSync(path.join(dir,'checks.json'),'{');assert.throws(()=>verifyQueueEvidence(dir,sha))
  fs.unlinkSync(path.join(dir,'checks.json'));assert.throws(()=>verifyQueueEvidence(dir,sha))
})
test('child failure or timeout is not hidden by complete artifacts',t=>{
  const dir=evidence(t)
  for(const child of [null,{status:1},{status:null},{status:0,signal:'SIGTERM'},{status:0,error:new Error('timeout')}]) assert.throws(()=>requireCompletedRender(child,dir,sha),/process failed/)
})
test('report checks do not mutate caller evidence',()=>{
  const r=fixture(),before=JSON.stringify(r);verifyQueueReport(r,sha);assert.equal(JSON.stringify(r),before)
})

test('screen-clamped native windows are checked against actual viewport rather than requested size',()=>{
  const r=fixture();r.reports[0].viewport=[1008,681];r.reports[0].imageSize=[1008,681];r.reports[0].bounds=[37,862,1506.5]
  verifyQueueReport(r,sha)
  r.reports[0].imageSize=[1180,900];assert.throws(()=>verifyQueueReport(r,sha))
})
