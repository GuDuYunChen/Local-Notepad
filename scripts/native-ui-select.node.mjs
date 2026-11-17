import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createNativeUiSelect } from './native-ui-select.mjs'

// Driver protocol contracts only. These synthetic DOMs do not claim native
// interaction or application acceptance; the actual Windows driver supplies CDP.
const selectMarkup = `<span data-ui-control="select" data-ui-value='"a"'>
  <div data-field><div class="ant-select-content">Alpha<input id="app-select-:r1:" role="combobox" aria-label="Category" aria-expanded="false" value=""></div></div>
</span><div role="listbox" id="own-list"><div role="option" id="own-a" aria-selected="true"><span data-ui-option-value="a">Alpha</span></div><div role="option" id="own-b" aria-selected="false"><span data-ui-option-value="b">Beta</span></div></div>
<div role="listbox" id="other-list"><div role="option" id="other-b"><span data-ui-option-value="b">Beta</span></div></div>`
function fixture(t, html = selectMarkup) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const { document } = dom.window, clicks = [], inputs = [], expressions = []
  const context = {
    evaluate: async source => { expressions.push(source); return dom.window.eval(source) },
    click: async selector => {
      const nodes = [...document.querySelectorAll(selector)]
      assert.equal(nodes.length, 1, 'Protocol click must identify one actual DOM node')
      const node = nodes[0]; clicks.push(node.id || node.getAttribute('data-ui-control'))
      const field = document.querySelector('[role="combobox"]')
      if (node.matches('[data-ui-control="select"]')) {
        field.setAttribute('aria-expanded', 'true'); field.setAttribute('aria-controls', 'own-list')
      } else {
        const chosen = node.querySelector('[data-ui-option-value]').getAttribute('data-ui-option-value')
        document.querySelector('[data-ui-control="select"]').setAttribute('data-ui-value', JSON.stringify(chosen))
        field.setAttribute('aria-expanded', 'false'); field.removeAttribute('aria-controls')
      }
    },
    cdp: { send: async (method, input) => { inputs.push({ method, ...input }) } },
    until: async (probe, label) => { for (let index = 0; index < 3; index++) { const result = await probe(); if (result) return result } throw Error(label) },
  }
  return { document, context, clicks, inputs, expressions }
}

test('shared Select uses only its linked popup and reads the committed value, not input search text', async t => {
  const f = fixture(t), select = createNativeUiSelect(f.context)
  assert.equal(await select.value('[data-field]'), 'a')
  const result = await select.choose('[data-field]', 'b')
  assert.equal(result.value, 'b'); assert.equal(result.expanded, false)
  assert.deepEqual(f.clicks, ['select', 'own-b']); assert.deepEqual(f.inputs, [])
  assert.equal(f.document.querySelector('[role="combobox"]').value, '')
  assert.equal(await select.value('[aria-label="Category"]'), 'b')
})

test('already expanded Select is not toggled closed before the real choice', async t => {
  const f = fixture(t), field = f.document.querySelector('[role="combobox"]')
  field.setAttribute('aria-expanded', 'true'); field.setAttribute('aria-controls', 'own-list')
  await createNativeUiSelect(f.context).choose('[data-field]', 'b')
  assert.deepEqual(f.clicks, ['own-b'])
})

test('a missing own popup cannot borrow another field’s identical choice', async t => {
  const f = fixture(t)
  f.document.getElementById('own-list').remove()
  await assert.rejects(createNativeUiSelect(f.context).choose('[data-field]', 'b'), /own real popup/)
  assert.deepEqual(f.clicks, ['select'])
})

test('disabled and duplicate popup choices are refused before option input', async t => {
  for (const duplicate of [false, true]) {
    const f = fixture(t), option = f.document.getElementById('own-b')
    if (duplicate) option.parentElement.append(option.cloneNode(true))
    else option.setAttribute('aria-disabled', 'true')
    await assert.rejects(createNativeUiSelect(f.context).choose('[data-field]', 'b'), duplicate ? /missing or ambiguous/ : /choice is disabled/)
    assert.deepEqual(f.clicks, ['select'])
  }
})

test('an unchanged application value fails instead of treating search text as selection', async t => {
  const f = fixture(t), originalClick = f.context.click
  f.context.click = async selector => {
    if (selector.startsWith('[data-ui-control=')) return originalClick(selector)
    f.clicks.push('uncommitted-option')
    const field = f.document.querySelector('[role="combobox"]')
    field.value = 'b'; field.setAttribute('aria-expanded', 'false')
  }
  await assert.rejects(createNativeUiSelect(f.context).choose('[data-field]', 'b'), /did not commit/)
  assert.deepEqual(f.clicks, ['select', 'uncommitted-option'])
})

test('disabled fields and unrelated comboboxes do not receive an interaction', async t => {
  const disabled = fixture(t)
  disabled.document.querySelector('[role="combobox"]').disabled = true
  await assert.rejects(createNativeUiSelect(disabled.context).choose('[data-field]', 'b'), /become enabled/)
  assert.deepEqual(disabled.clicks, [])
  const query = fixture(t, '<input role="combobox" aria-label="query" aria-expanded="true">')
  await assert.rejects(createNativeUiSelect(query.context).choose('[role="combobox"]', 'b'), /real native or shared Select/)
  assert.deepEqual(query.clicks, [])
})

test('genuine original native Select uses focused keyboard input and skips disabled options', async t => {
  const f = fixture(t, '<select aria-label="original"><option value="a">Alpha</option><option value="blocked" disabled>Disabled</option><option value="b">Beta</option></select>')
  const node = f.document.querySelector('select'), send = f.context.cdp.send
  f.context.cdp.send = async (method, input) => {
    await send(method, input)
    if (input.type === 'keyUp' && input.key === 'Enter') node.selectedIndex = 2
  }
  const after = await createNativeUiSelect(f.context).choose('select', 'b')
  assert.equal(after.kind, 'native'); assert.equal(after.value, 'b'); assert.equal(after.focused, true)
  assert.deepEqual(f.inputs.map(input => input.key), ['Home', 'Home', 'ArrowDown', 'ArrowDown', 'Enter', 'Enter'])
  assert.ok(f.inputs.every(input => input.method === 'Input.dispatchKeyEvent'))
  assert.deepEqual(f.clicks, [])
})

test('missing, ambiguous and multiple-value controls cannot be silently accepted', async t => {
  for (const html of ['', '<select></select><select></select>', '<select multiple><option value="b">Beta</option></select>']) {
    const f = fixture(t, html)
    await assert.rejects(createNativeUiSelect(f.context).choose('select', 'b'))
    assert.deepEqual(f.inputs, []); assert.deepEqual(f.clicks, [])
  }
})
