const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const { verifyRasterWitness } = require('./sync-clock-raster-evidence.cjs')
const names = ['pagination-light', 'pagination-dark', 'pagination-narrow']
const phases = ['first', 'last', 'jumped', 'invalid', 'filtered', 'empty', 'cleared']
function verifyPaginationScene(scene) {
  assert.ok(names.includes(scene.name)); assert.deepEqual(scene.frames.map(f => f.phase), phases)
  const range = (from, count) => Array.from({ length: count }, (_, i) => 'r' + (from + i))
  const expected = [range(0,25), range(50,11), range(25,25), range(25,25), ['r60'], [], range(0,25)]
  const pages = [1,3,2,2,1,0,1], drafts = ['1','3','2','99','1','','1'], matches = [61,61,61,61,1,0,61]
  scene.frames.forEach((f, i) => {
    assert.deepEqual(f.ids, expected[i]); assert.equal(f.draft, drafts[i]); assert.equal(f.invalid, i === 3)
    assert.match(f.matches, new RegExp(`当前匹配 ${matches[i]} 条 / 文件内共 61 条`))
    assert.deepEqual(f.outcomes, i === 4 ? [1,0,0,0] : i === 5 ? [0,0,0,0] : [61,0,0,0])
    assert.equal(f.reads,1); assert.equal(f.requests,0); assert.equal(f.network,0); assert.equal(f.mutations,0); assert.equal(f.downloads,0); assert.equal(f.navigation,0)
    assert.equal(f.liveUnchanged,true); assert.equal(f.sourceUnchanged,true); assert.equal(f.activeMarkup,0)
    assert.equal(f.visible,true); assert.equal(f.focusInside,true); assert.ok(f.overflow<=1)
    assert.ok(f.colors.length>=3 && f.colors.every(v => Number.isFinite(v) && v>=4.5))
    assert.ok(f.stable>=2 && f.samples>=2); assert.equal(f.code,names.indexOf(scene.name)*phases.length+i+1)
    const total = i === 4 ? 1 : 3
    if (i===5) {
      assert.match(f.page,/暂无可翻页/); assert.equal(f.readOnly,true); assert.ok(Object.values(f.disabled).every(Boolean))
    } else {
      assert.match(f.page,new RegExp(`第 ${pages[i]} / ${total} 页`)); assert.equal(f.readOnly,false)
      assert.equal(f.disabled.first,pages[i]===1); assert.equal(f.disabled.prev,pages[i]===1)
      assert.equal(f.disabled.last,pages[i]===total); assert.equal(f.disabled.next,pages[i]===total); assert.equal(f.disabled.jump,false)
    }
    if(i===2||i===3) assert.equal(f.focusJump,true)
    if(i===3) assert.match(f.error,/1 至 3/)
    if(i===6) assert.equal(f.focusQuery,true)
  })
  return true
}
function verifyPaginationReport(dir, commit) {
  assert.match(commit,/^[a-f0-9]{40}$/)
  const report=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
  assert.equal(report.commit,commit); assert.equal(report.platform,'win32'); assert.equal(report.complete,true)
  assert.equal(report.actualFileReader,true); assert.equal(report.syntheticRecords,true); assert.equal(report.sourceFilesUnchanged,true)
  assert.deepEqual(report.scenes.map(s=>s.name),names)
  for(const scene of report.scenes) {
    verifyPaginationScene(scene)
    for(const f of scene.frames) {
      assert.equal(f.png,scene.name+'-'+f.phase+'.png')
      const b=fs.readFileSync(path.join(dir,f.png)); assert.equal(b.length,f.bytes); assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256)
      assert.equal(b.readUInt32BE(16),f.width); assert.equal(b.readUInt32BE(20),f.height); assert.equal(verifyRasterWitness(b,f.code),true)
    }
  }
  return report
}
module.exports={names,phases,verifyPaginationScene,verifyPaginationReport}
