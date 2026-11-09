const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { verifyGeometry, verifyFocus, verifyScenes, hasVisibleBoxShadow, HEIGHTS } = require('./check-ui-control-render.cjs')

function geometry() {
  return { viewport: { width: 704, height: 455 }, overflow: 0,
    controls: Object.entries(HEIGHTS).flatMap(([density, height], row) =>
      ['button', 'input', 'password', 'select'].map((kind, column) => ({ density, kind,
        context: density === 'compact' ? 'product-editor-toolbar' : 'standalone',
        height, width: 150, left: 16 + column * 166, right: 166 + column * 166, top: 40 + row * 90,
        ...(kind === 'password' ? { innerPadding: [0, 0, 0, 0], innerHeight: 22 } : {}) }))) }
}
function focus() {
  return { id: 'ordinary-password', focused: true, focusVisible: true,
    outlines: [{ owner: 'root', width: 2, color: 'rgb(80, 60, 160)' }], shadows: [], hit: true, inViewport: true }
}
test('accepts a complete aligned three-density measurement without mutating it', () => {
  const sample = geometry(), original = JSON.stringify(sample)
  verifyGeometry(sample); assert.equal(JSON.stringify(sample), original)
})
test('rejects the old second padding layer even if the outer height happens to match', () => {
  const sample = geometry(); sample.controls.find(control => control.kind === 'password').innerPadding = [9, 10, 9, 10]
  assert.throws(() => verifyGeometry(sample), /padded twice/)
})
test('rejects compact controls forced to the old toolbar or ordinary height', () => {
  for (const height of [32, 40]) {
    const sample = geometry(); sample.controls.find(control => control.density === 'compact' && control.kind === 'input').height = height
    assert.throws(() => verifyGeometry(sample), /expected 28px/)
  }
})
test('requires compact geometry to come from actual production editor toolbar descendants', () => {
  const sample = geometry(); sample.controls.find(control => control.density === 'compact').context = 'standalone'
  assert.throws(() => verifyGeometry(sample), /production editor toolbar context/)
})
test('rejects a missing control and duplicated control identities', () => {
  const missing = geometry(); missing.controls.pop(); assert.throws(() => verifyGeometry(missing))
  const duplicate = geometry(); duplicate.controls[3] = { ...duplicate.controls[0] }; assert.throws(() => verifyGeometry(duplicate), /Exact control matrix/)
})
test('rejects misalignment, horizontal clipping and nonfinite measurements', () => {
  for (const mutate of [sample => { sample.controls[0].top += 3 }, sample => { sample.controls[0].right = 900 }, sample => { sample.controls[0].height = NaN }]) {
    const sample = geometry(); mutate(sample); assert.throws(() => verifyGeometry(sample))
  }
})
test('accepts one visible root cue and rejects duplicate inner outlines or glow', () => {
  verifyFocus(focus())
  const duplicate = focus(); duplicate.outlines.push({ owner: 'input:1', width: 2 }); assert.throws(() => verifyFocus(duplicate), /exactly one/)
  const glow = focus(); glow.shadows.push({ owner: 'root', value: '0 0 0 2px blue' }); assert.throws(() => verifyFocus(glow), /duplicate focus glow/)
})
test('ignores only unpainted zero-extent or transparent shadows using the serialized page classifier', () => {
  const pageClassifier = vm.runInNewContext(`(${hasVisibleBoxShadow.toString()})`)
  for (const value of ['none', 'rgb(80, 60, 160) 0px 0px 0px 0px', '0 0 0 0px rgba(80, 60, 160, 0.5)',
    'rgba(80, 60, 160, 0) 0px 0px 0px 2px', '0px 1px 4px rgb(80 60 160 / 0%)',
    '0 0 2px 3px transparent', '0 0 2px #1230', '0 0 0 2px color(srgb 0.2 0.3 0.4 / 0)']) {
    assert.equal(hasVisibleBoxShadow(value), false, value)
    assert.equal(pageClassifier(value), false, value)
  }
})
test('still refuses nonzero offset, blur or spread and visible layers after transparent layers', () => {
  const pageClassifier = vm.runInNewContext(`(${hasVisibleBoxShadow.toString()})`)
  for (const value of ['0 0 0 2px blue', 'rgb(80, 60, 160) 0px 0px 0px 2px',
    '1px 0px rgb(80 60 160 / 1)', '0px -1px rgba(80, 60, 160, 0.01)', 'inset 0 0 2px black',
    '0 0 0 -2px black', 'rgba(0, 0, 0, 0) 0 0 0 2px, rgb(80, 60, 160) 0 0 0 2px',
    'rgb(80, 60, 160) 0 0 0 0, 0 0 2px #123f', 'unrecognized-shadow']) {
    assert.equal(hasVisibleBoxShadow(value), true, value)
    assert.equal(pageClassifier(value), true, value)
    const sample = focus(); sample.shadows.push({ owner: 'root', value })
    assert.throws(() => verifyFocus(sample), /duplicate focus glow/)
  }
})
test('refuses a focused but hidden, obscured or unpainted control', () => {
  for (const key of ['focused', 'focusVisible', 'hit', 'inViewport']) {
    const sample = focus(); sample[key] = false; assert.throws(() => verifyFocus(sample))
  }
  const sample = focus(); sample.outlines = []; assert.throws(() => verifyFocus(sample))
})
test('cannot report a partial scene list as successful native evidence', () => {
  assert.throws(() => verifyScenes([]), /every viewport/)
})
