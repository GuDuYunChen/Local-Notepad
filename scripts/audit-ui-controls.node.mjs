import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspectJsx, inspectCss } from './audit-ui-controls.mjs'

test('counts actual JSX controls, not comments or strings', () => {
  const r = inspectJsx('const text = "<button>fake</button>"; /* <select /> */ const view = <><input /><button>OK</button><select><option>A</option></select><textarea /></>', 'sample.jsx')
  assert.deepEqual(r.controls.map(c => c.tag), ['input', 'button', 'select', 'textarea'])
})
test('distinguishes native elements, UI library aliases and local adapters', () => {
  const r = inspectJsx("import { Button as B, Input } from 'antd'; import { Select } from './ui/Controls'; const view = <><B /><Input.Password /><Select /><button /></>", 'sample.jsx')
  assert.deepEqual(r.controls.map(c => c.origin), ['library', 'library', 'shared-local', 'native'])
})
test('preserves special native semantics in inventory without marking every input defective', () => {
  const r = inspectJsx('<><input type="file" hidden /><input type="checkbox" /><input type="text" /></>', 'sample.jsx')
  assert.equal(r.controls[0].review.some(r => r.startsWith('native-semantics-exception')), true)
  assert.equal(r.controls[1].review.some(r => r.startsWith('native-semantics-exception')), true)
  assert.deepEqual(r.controls[2].review, [])
})
test('flags implicit submit only with an actual form ancestor', () => {
  const r = inspectJsx('<><button /><form><button /><button type="button" /></form></>', 'sample.jsx')
  assert.equal(r.controls[0].review.length, 0)
  assert.equal(r.controls[1].review.includes('implicit-form-submit; inspect-intent'), true)
  assert.equal(r.controls[2].review.length, 0)
})
test('does not export user/default field values or handler expressions', () => {
  const r = inspectJsx('<input type="password" defaultValue="DO_NOT_EXPORT" value={credentials.secret} onChange={saveSecret} aria-label="Password" />', 'sample.jsx')
  const text = JSON.stringify(r)
  assert.equal(text.includes('DO_NOT_EXPORT'), false)
  assert.equal(text.includes('credentials'), false)
  assert.equal(text.includes('saveSecret'), false)
  assert.equal(r.controls[0].ariaLabel, 'Password')
})
test('records programmatic native controls separately', () => {
  const r = inspectJsx("const i = document.createElement('input'); const b = React.createElement('button');", 'sample.js')
  assert.equal(r.controls.length, 0)
  assert.equal(r.programmatic.length, 2)
})
test('CSS focus and shadows are review candidates, not automatic failures', () => {
  const r = inspectCss('.panel input:focus { outline:2px solid red !important; box-shadow:0 0 0 3px pink } .panel { height:100% }', 'sample.css')
  assert.equal(r.rules.length, 2)
  assert.equal(r.rules[0].declarations[0].important, true)
  assert.equal(r.rules[0].review.some(r => r.startsWith('focus-layer-review')), true)
  assert.equal(r.rules[0].review.some(r => r.startsWith('shadow-purpose-review')), true)
})
test('rejects malformed source instead of silently claiming complete coverage', () => {
  assert.throws(() => inspectJsx('const bad = <input', 'bad.jsx'))
  assert.throws(() => inspectCss('.panel {', 'bad.css'))
})
