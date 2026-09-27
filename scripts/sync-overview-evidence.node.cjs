const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createHash } = require('node:crypto')
const { verifyOverviewEvidence } = require('./sync-overview-evidence.cjs')
const sha = 'a'.repeat(40)
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-evidence-test-'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII=', 'base64')
  const report = { commit: sha, platform: 'win32', complete: true, realComponents: true, syntheticRecords: true, backendExercised: false, nativeFocus: true, writes: 0,
    scenes: ['light','dark','narrow','uncertain','unavailable','disabled','blocked-stale','backoff-busy','uncertain-refreshing','contradictory-busy','help-first-use','help-operations-dark','help-conflicts','help-recovery-narrow'].map(name => ({name, png:name+'.png', sha256:createHash('sha256').update(png).digest('hex'), bytes:png.length,
      viewport:{width:1,height:1}, colors:Array.from({length:12},()=>({final:true,ratio:8})), stableSamples:3, writes:0, activeMarkup:0, navCount:5, overflow:0})) }
  for (const scene of report.scenes) {
    const opened = { 'help-first-use': 'first-use', 'help-operations-dark': 'operations', 'help-conflicts': 'conflicts', 'help-recovery-narrow': 'recovery' }[scene.name]
    scene.help = { present: true, topicCount: 4, readOnly: true, open: !!opened, disclosureVerified: !!opened, openTopics: opened ? [opened] : [] }
    const extra = {
      'unavailable': ['尚无可核实的读取结果', '尚无可核实的状态', ''],
      'blocked-stale': ['上次读取结果；刷新失败或状态待核实', '当前保留的是上次读取结果', '恢复保护阻断；不证明保护已解除'],
      'backoff-busy': ['已读取的状态快照（非实时保证）', '正在等待操作结果', '预检暂缓；不会提前重跑同步'],
      'uncertain-refreshing': ['正在刷新；仍是上次读取结果', '先核查写入结果', ''],
      'contradictory-busy': ['上次读取结果；刷新失败或状态待核实', '正在等待操作结果', '恢复保护阻断；预检暂缓；不一致'],
    }[scene.name] || ['已读取的状态快照（非实时保证）', '合成测试标题', '']
    scene.readProvenance = '状态依据：' + extra[0]; scene.title = extra[1]; scene.recoveryNotice = extra[2]
  }
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

test('rejects swallowed recovery warnings despite successful layout and image checks', () => {
  for (const name of ['blocked-stale', 'backoff-busy', 'contradictory-busy']) fixture((dir,r,save) => {
    r.scenes.find(scene => scene.name === name).recoveryNotice = ''; save(); assert.throws(() => verifyOverviewEvidence(dir,sha))
  })
})
test('rejects absent or falsely fresh provenance under an uncertain-write headline', () => {
  for (const source of ['', '状态依据：已读取的状态快照（非实时保证）']) fixture((dir,r,save) => {
    r.scenes.find(scene => scene.name === 'uncertain-refreshing').readProvenance = source; save(); assert.throws(() => verifyOverviewEvidence(dir,sha))
  })
})

test('rejects missing help or a guide that does not state its read-only scope', () => {
  for (const change of [s=>delete s.help,s=>s.help.present=false,s=>s.help.readOnly=false,s=>s.help.topicCount=3]) fixture((dir,r,save)=> {
    change(r.scenes[0]); save(); assert.throws(()=>verifyOverviewEvidence(dir,sha))
  })
})
test('rejects missing native disclosures or the wrong topic even with intact PNGs', () => {
  for (const change of [s=>s.help.open=false,s=>s.help.disclosureVerified=false,s=>s.help.openTopics=['first-use','recovery']]) fixture((dir,r,save)=> {
    change(r.scenes.find(s=>s.name==='help-recovery-narrow')); save(); assert.throws(()=>verifyOverviewEvidence(dir,sha))
  })
})
