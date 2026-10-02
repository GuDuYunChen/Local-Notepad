const assert = require('node:assert/strict')
const { verifyFileDetailsReport } = require('./sync-history-file-details-evidence.cjs')
function verifyIdentifierSelectionScene(scene) {
  assert.deepEqual(scene.identifierSelections.map(a => a.action), ['object', 'record', 'collapse-cleared', 'page-cleared'])
  scene.identifierSelections.forEach((a, i) => {
    assert.equal(a.reads, 1)
    assert.equal(a.network, 0)
    assert.equal(a.mutations, 0)
    assert.equal(a.pageUnchanged, i !== 3)
    if (i === 3) assert.match(a.page, /第 2 \/ 3 页/)
    assert.equal(a.orderUnchanged, true)
    if (i < 2) {
      assert.equal(a.text, i === 0 ? 'same' : 'r0')
      assert.equal(a.kind, i === 0 ? 'object' : 'record')
      assert.equal(a.recordID, 'r0')
      assert.equal(a.rangeCount, 1)
      assert.equal(a.exactNode, true)
      assert.equal(a.focusRetained, true)
      assert.equal(a.visible, true)
      assert.ok(Number.isFinite(a.contrast) && a.contrast >= 4.5)
      assert.match(a.notice, /已选中.*手动复制/)
      assert.doesNotMatch(a.notice, /已复制/)
    } else {
      assert.equal(a.text, '')
      assert.equal(a.rangeCount, 0)
      assert.equal(a.notice, '')
    }
  })
  return true
}
function verifyIdentifierSelectionReport(dir, commit) {
  const report = verifyFileDetailsReport(dir, commit)
  report.scenes.forEach(verifyIdentifierSelectionScene)
  return report
}
module.exports = { verifyIdentifierSelectionScene, verifyIdentifierSelectionReport }
