const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createHash } = require('node:crypto')
const { verifyOverviewEvidence } = require('./sync-overview-evidence.cjs')
const sha = 'a'.repeat(40)
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-evidence-test-'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII=', 'base64')
  const report = { commit: sha, platform: 'win32', complete: true, realComponents: true, syntheticRecords: true, backendExercised: false, nativeFocus: true, writes: 0,
    scenes: ['light','dark','narrow','uncertain','unavailable','disabled'].map(name => ({name, png:name+'.png', sha256:createHash('sha256').update(png).digest('hex'), bytes:png.length,
      viewport:{width:1,height:1}, colors:Array.from({length:12},()=>({final:true,ratio:8})), stableSamples:3, writes:0, activeMarkup:0, navCount:5, overflow:0})) }
  const save = () => fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(report))
  for (const scene of report.scenes) fs.writeFileSync(path.join(dir, scene.png), png)
  save(); try { fn(dir, report, save) } finally { fs.rmSync(dir, { recursive:true, force:true }) }
}
test('accepts only complete current-commit evidence', () => fixture(dir => assert.equal(verifyOverviewEvidence(dir,sha).complete,true)))
test('rejects partial, stale or missing scenes even after a zero process exit', () => {
  for (const change of [r=>r.complete=false,r=>r.commit='b'.repeat(40),r=>r.scenes.pop(),r=>r.nativeFocus=false]) fixture((dir,r,save)=>{change(r);save();assert.throws(()=>verifyOverviewEvidence(dir,sha))})
})
test('rejects low contrast, unstable frames, side effects or overflows', () => {
  for (const change of [r=>r.scenes[0].colors[0].ratio=1.1,r=>r.scenes[0].stableSamples=2,r=>r.scenes[0].writes=1,r=>r.scenes[0].activeMarkup=1,r=>r.scenes[0].overflow=10]) fixture((dir,r,save)=>{change(r);save();assert.throws(()=>verifyOverviewEvidence(dir,sha))})
})
test('rejects missing, tampered or dimension-mismatched image files', () => {
  fixture(dir=>{fs.rmSync(path.join(dir,'narrow.png'));assert.throws(()=>verifyOverviewEvidence(dir,sha))})
  fixture((dir,r,save)=>{r.scenes[0].viewport.width=2;save();assert.throws(()=>verifyOverviewEvidence(dir,sha))})
  fixture(dir=>{fs.appendFileSync(path.join(dir,'dark.png'),'tampered');assert.throws(()=>verifyOverviewEvidence(dir,sha))})
})
