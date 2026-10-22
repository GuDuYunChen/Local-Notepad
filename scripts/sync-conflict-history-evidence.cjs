const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const { verifyRasterWitness } = require('./sync-clock-raster-evidence.cjs')
const names = ['history-light','history-dark','history-narrow']
const phases = ['unread','loaded','more','refresh-failed','stopped','empty']
function verifyHistoryScene(scene) {
  assert.ok(names.includes(scene.name)); assert.deepEqual(scene.frames.map(f => f.phase), phases)
  for (const [i, f] of scene.frames.entries()) {
    const expected = i === 0 || i === 5 ? [] : i === 1 ? ['h3','h2'] : ['h3','h2','h1']
    assert.deepEqual(f.ids, expected); assert.equal(f.filter, i === 5 ? 'superseded' : 'all')
    assert.equal(f.requests.length, i); assert.ok(f.requests.every(r => r.method === 'GET' && r.path.startsWith('/api/sync/conflicts/history?')))
    assert.equal(f.mutations, 0); assert.equal(f.networkRequests, 0); assert.equal(f.navigationCalls, 0)
    assert.equal(f.privateText, false); assert.equal(f.activeMarkup, 0); assert.equal(f.currentGuidanceUnchanged, true)
    assert.equal(f.controlsVisible, true); assert.equal(f.focusInside, true); assert.equal(f.stableSamples >= 3, true)
    assert.equal(f.rasterCode, names.indexOf(scene.name) * 6 + i + 1); assert.equal(f.rasterSamples >= 2, true)
    assert.ok(Number.isFinite(f.overflow) && f.overflow <= 1)
    assert.ok(f.colors.length >= 4 && f.colors.every(c => c.final === true && Number.isFinite(c.ratio) && c.ratio >= 4.5))
    const words = ['尚未读取','已读取 2 条记录','已读取 3 条记录','保留上次读取结果','没有取消同步任务','不代表当前没有未决冲突'][i]
    assert.ok(f.feedback.includes(words), 'Wrong history feedback: ' + f.phase)
    if (i > 0 && i < 5) { assert.ok(f.outcomes.includes('当时保留本机版本')); assert.ok(f.outcomes.includes('重新绑定后失效；不代表已选边')) }
    if (i >= 4) assert.equal(f.cancelledRead, true)
    assert.deepEqual(f.iso, ['2026-09-27T09:05:00.000Z','2026-09-27T09:06:40.000Z'])
    assert.deepEqual(f.counts, ['0','0'])
  }
}
function verifyHistoryReport(directory, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/)
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'checks.json'), 'utf8'))
  assert.equal(report.commit, commit);assert.equal(report.platform, 'win32');assert.equal(report.complete, true)
  assert.equal(report.realOverview, true);assert.equal(report.syntheticRecords, true);assert.equal(report.backendExercised, false)
  assert.deepEqual(report.scenes.map(s => s.name), names)
  for (const scene of report.scenes) {
    verifyHistoryScene(scene)
    for (const f of scene.frames) {
      assert.equal(f.png, scene.name + '-' + f.phase + '.png')
      const b = fs.readFileSync(path.join(directory, f.png))
      assert.equal(b.length, f.bytes);assert.equal(createHash('sha256').update(b).digest('hex'), f.sha256)
      assert.equal(b.readUInt32BE(16), f.viewport.width);assert.equal(b.readUInt32BE(20), f.viewport.height)
      verifyRasterWitness(b, f.rasterCode)
    }
  }
  return report
}
module.exports = { verifyHistoryScene, verifyHistoryReport }
