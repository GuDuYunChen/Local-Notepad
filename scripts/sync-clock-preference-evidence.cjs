const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const names = ['local-light', 'local-dark', 'local-narrow', 'blocked-storage']
const phases = ['before', 'saved', 'reloaded', 'final']
function verifyPreferenceScene(scene) {
  assert.ok(names.includes(scene.name)); const blocked = scene.name === 'blocked-storage'
  assert.equal(scene.reloadVerified, true); assert.equal(scene.currentRetained, true)
  assert.equal(scene.saveFocusRetained, true); assert.equal(scene.clearFocusRetained, true)
  for (const phase of phases) {
    const f = scene[phase]
    assert.ok(f); assert.equal(f.requests, 0); assert.equal(f.navigationCalls, 0)
    assert.equal(f.privateText, false); assert.equal(f.otherKeyPreserved, true)
    assert.equal(f.controlsVisible, true); assert.equal(f.summaryVisible, true); assert.ok(f.stableSamples >= 3)
    assert.ok(Number.isFinite(f.overflow) && f.overflow <= 1)
    assert.ok(f.colors.length >= 5 && f.colors.every(c => c.final === true && Number.isFinite(c.ratio) && c.ratio >= 4.5))
    assert.equal(f.viewport.width, scene.name === 'local-narrow' ? 560 : 1000)
    assert.ok(Number.isInteger(f.viewport.height) && f.viewport.height >= 600 && f.viewport.height <= 900)
    assert.deepEqual(f.viewport, scene.before.viewport)
    assert.deepEqual(f.iso, scene.before.iso); assert.equal(f.iso.length, 2)
    assert.equal(f.guidance, scene.before.guidance); assert.deepEqual(f.counts, scene.before.counts)
  }
  assert.deepEqual(scene.before.mutations, []); assert.equal(scene.before.mode, 'utc'); assert.equal(scene.before.open, false)
  assert.equal(scene.saved.mode, 'local'); assert.equal(scene.saved.open, true); assert.equal(scene.saved.otherUTC, true)
  assert.deepEqual(scene.saved.mutations, [['set', 'local']])
  assert.equal(scene.saved.stored, blocked ? 'invalid' : 'local')
  assert.equal(scene.saved.error, blocked ? 'save' : '')
  assert.equal(scene.reloaded.mode, blocked ? 'utc' : 'local'); assert.deepEqual(scene.reloaded.mutations, [])
  assert.equal(scene.reloaded.open, false); assert.equal(scene.reloaded.stored, blocked ? 'invalid' : 'local')
  assert.equal(scene.final.mode, scene.reloaded.mode); assert.equal(scene.final.open, true)
  assert.deepEqual(scene.final.mutations, [['remove']])
  assert.equal(scene.final.stored, blocked ? 'invalid' : null); assert.equal(scene.final.error, blocked ? 'clear' : '')
  assert.equal(scene.before.error, blocked ? 'invalid' : ''); assert.equal(scene.reloaded.error, blocked ? 'invalid' : '')
}
function verifyPreferenceReport(directory, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/)
  const r = JSON.parse(fs.readFileSync(path.join(directory, 'checks.json'), 'utf8'))
  assert.equal(r.commit, commit); assert.equal(r.complete, true); assert.equal(r.platform, 'win32')
  assert.equal(r.realOverview, true); assert.equal(r.syntheticRecords, true); assert.equal(r.backendExercised, false)
  assert.deepEqual(r.scenes.map(s => s.name), names)
  for (const s of r.scenes) {
    verifyPreferenceScene(s)
    for (const phase of phases) {
      const f = s[phase]; assert.equal(f.png, s.name + '-' + phase + '.png')
      const b = fs.readFileSync(path.join(directory, f.png))
      assert.equal(b.length, f.bytes); assert.equal(createHash('sha256').update(b).digest('hex'), f.sha256)
      assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      assert.equal(b.readUInt32BE(16), f.viewport.width); assert.equal(b.readUInt32BE(20), f.viewport.height)
    }
  }
  return r
}
module.exports = { verifyPreferenceScene, verifyPreferenceReport }
