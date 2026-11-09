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

test('finds actual React factories, named imports, destructuring and stable aliases separately from JSX', () => {
  const source = `import React from 'react'; import * as R from 'react';
    import { createElement as element } from 'react';
    const h = React.createElement, alias = h; const { createElement: make } = R;
    const jsx = <input type="file" />;
    React.createElement('button', { type: 'button' });
    element('input', { type: 'text', 'aria-label': 'Endpoint' });
    h('select', null); alias('textarea', null); make('input', { type: 'checkbox' });
    R.createElement('form', null, h('button', null));`
  const r = inspectJsx(source, 'factories.jsx')
  assert.deepEqual(r.controls.map(control => control.tag), ['input'])
  assert.deepEqual(r.createElementControls?.map(control => control.tag), ['button', 'input', 'select', 'textarea', 'input', 'button'])
  assert.equal(r.createElementControls[4].classification, 'native-semantics-exception')
  assert.equal(r.createElementControls[5].inForm, true)
  assert.ok(r.createElementControls[5].review.includes('implicit-form-submit; inspect-intent'))
  assert.equal(r.unresolvedCreateElementCalls.length, 0)
})

test('respects lexical shadowing and does not count DOM, non-React or unrelated APIs as React controls', () => {
  const source = `import React from 'react'; import { createElement as h } from 'react';
    import Other from 'other-library'; const make = React.createElement;
    function shadow(h, React) { h('button'); React.createElement('input'); }
    { const h = value => value; h('textarea'); }
    function local() { const make = unrelated; make('select'); }
    Other.createElement('button'); document.createElement('input');
    const text = "h('button')"; /* make('input') */
    make('button', { type: 'button' });`
  const r = inspectJsx(source, 'scope.js')
  assert.deepEqual(r.createElementControls?.map(control => control.tag), ['button'])
  assert.equal(r.unresolvedCreateElementCalls.length, 0)
  assert.equal(r.programmatic.some(control => control.tag === 'input'), true, 'Original broad programmatic review candidates remain')
})

test('identifies CommonJS React bindings without treating shadowed require as React', () => {
  const source = `const React = require('react'), h = React.createElement;
    const { createElement: make } = require('react');
    h('input', { type: 'file' }); make('textarea', null);
    function unrelated(require) { const R = require('react'); R.createElement('button'); }`
  const r = inspectJsx(source, 'common.cjs')
  assert.deepEqual(r.createElementControls?.map(control => control.tag), ['input', 'textarea'])
  assert.equal(r.createElementControls[0].classification, 'native-semantics-exception')
})

test('records conditional input types and never exports field values or handlers from factory props', () => {
  const source = `import React from 'react'; const h = React.createElement;
    const field = options => h('input', { type: options.secret ? 'password' : 'text',
      value: credentials.secret, defaultValue: 'DO_NOT_EXPORT', onChange: saveSecret,
      className: 's3-field', disabled: busy, ref: current, 'aria-label': 'S3 target' });
    h('input', { type: 'checkbox' }); h('input', { ...settings });`
  const r = inspectJsx(source, 'field.js')
  assert.equal(r.createElementControls?.length, 3)
  const first = r.createElementControls[0]
  assert.deepEqual(first.possibleTypes, ['password', 'text'])
  assert.equal(first.classification, 'ordinary-native')
  assert.equal(first.disabledProp, true); assert.equal(first.hasRef, true)
  assert.equal(first.ariaLabel, 'S3 target')
  assert.equal(r.createElementControls[2].type, '<dynamic>')
  assert.equal(r.createElementControls[2].classification, 'native-type-unresolved')
  for (const secret of ['DO_NOT_EXPORT', 'credentials', 'saveSecret']) assert.equal(JSON.stringify(r).includes(secret), false)
})

test('keeps migrated shared controls and UI library factory controls distinct from native elements', () => {
  const source = `import React from 'react'; import { UiInput, UiButton } from './ui/ControlKit';
    import { Input as LibraryInput } from 'antd'; import WeirdButton from './custom';
    const h = React.createElement;
    h(UiInput, { type: 'password' }); h(UiButton, { type: 'button' });
    h(LibraryInput.Password, {}); h(WeirdButton, {});`
  const r = inspectJsx(source, 'migrated.js')
  assert.deepEqual(r.createElementControls?.map(control => control.origin), ['shared-local', 'shared-local', 'library', 'custom-or-unresolved'])
  assert.deepEqual(r.createElementControls.map(control => control.tag), ['UiInput', 'UiButton', 'LibraryInput.Password', 'WeirdButton'])
})

test('unstable React aliases and dynamic element types remain explicit unresolved candidates', () => {
  const source = `import React from 'react'; let h = React.createElement; h = otherFactory;
    h('button', {}); React.createElement(dynamicTag, null);`
  const r = inspectJsx(source, 'uncertain.js')
  assert.equal(r.createElementControls?.length, 0)
  assert.deepEqual(r.unresolvedCreateElementCalls?.map(call => call.reason), ['reassigned-react-factory', 'dynamic-element-type'])
})

test('supports static computed factory names, namespace aliases and TypeScript wrappers', () => {
  const source = `import * as React from 'react'; const R = React;
    const h = (R['createElement'] as typeof React.createElement);
    const kind = 'textarea' as const; h(kind, {});
    const { createElement } = R; createElement('select', null);`
  const r = inspectJsx(source, 'aliases.ts')
  assert.deepEqual(r.createElementControls?.map(control => control.tag), ['textarea', 'select'])
})

test('counts a finite conditional choice between shared adapters once and keeps mixed choices unresolved', () => {
  const source = `import React from 'react'; import { UiPassword, UiInput } from './ui/ControlKit.jsx';
    const h = React.createElement;
    h(secret ? UiPassword : UiInput, { type: secret ? 'password' : 'text' });
    h(flag ? 'input' : UiInput, {});`
  const r = inspectJsx(source, 'conditional.js')
  assert.equal(r.createElementControls.length, 1)
  assert.equal(r.createElementControls[0].origin, 'shared-local')
  assert.deepEqual(r.createElementControls[0].elementAlternatives.map(choice => choice.tag), ['UiPassword', 'UiInput'])
  assert.equal(r.unresolvedCreateElementCalls.length, 1)
  assert.equal(r.unresolvedCreateElementCalls[0].reason, 'dynamic-element-type')
})
