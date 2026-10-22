import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replaceNativeTextInput, replaceNativeFormulaInput, replaceNativeUrlInput,
  READING_CAPTION_SELECTOR, READING_FORMULA_SELECTOR, READING_EMBED_URL_SELECTOR } from './reading-mode-native-input.mjs'

const original = '原始图片说明', replacement = 'reading100-native-caption'
const snapshot = () => ({ selector: '.editor-image-caption-input', found: true, focused: true,
  tagName: 'INPUT', type: 'text', value: original, readOnly: false, disabled: false,
  selectionStart: 0, selectionEnd: original.length })

// Synthetic transport contracts only. They verify that a rejected native
// observation cannot issue insertText; they do not stand in for Windows input.
function transport(observations, options = {}) {
  const calls = [], contexts = []
  const context = {
    async click(selector) { calls.push(['click', selector]) },
    async settle() { calls.push(['settle']) },
    async evaluate(expression) {
      contexts.push(expression); calls.push(['observe'])
      assert.doesNotMatch(expression, /setSelectionRange|\.select\(|\.value\s*=(?!=)/, 'Observation may not mutate DOM value or selection')
      assert.ok(observations.length, 'Unexpected extra observation')
      return structuredClone(observations.shift())
    },
    cdp: { async send(method, params) {
      calls.push([method, { ...params }])
      if (options.failCommand === method) throw Error('Synthetic transport command failure')
    } },
    async onSelection(selection) { calls.push(['accepted-selection', structuredClone(selection)]) },
  }
  return { calls, contexts, context }
}
const replace = harness => replaceNativeTextInput(harness.context, READING_CAPTION_SELECTOR, original, replacement)
const insertions = harness => harness.calls.filter(call => call[0] === 'Input.insertText')

test('native replacement requires focus, End then Shift+Home, and complete read-back selection before one insertion', async () => {
  const before = { ...snapshot(), selectionStart: 3, selectionEnd: 3 }, selected = snapshot()
  const h = transport([before, selected])
  assert.deepEqual(await replace(h), selected)
  const keyEvents = h.calls.filter(call => call[0] === 'Input.dispatchKeyEvent').map(call => call[1])
  assert.deepEqual(keyEvents, [
    { type: 'rawKeyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35, modifiers: 0 },
    { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35, modifiers: 0 },
    { type: 'rawKeyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36, modifiers: 8 },
    { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36, modifiers: 8 },
  ])
  assert.equal(h.calls.filter(call => call[0] === 'observe').length, 2)
  assert.deepEqual(h.calls[0], ['click', READING_CAPTION_SELECTOR])
  assert.deepEqual(h.calls.at(-2), ['accepted-selection', selected])
  assert.deepEqual(h.calls.at(-1), ['Input.insertText', { text: replacement }])
  assert.equal(insertions(h).length, 1)
})

for (const phase of ['before-keyboard', 'before-insert']) for (const [name, mutate] of [
  ['missing input', s => s.found = false],
  ['another selector', s => s.selector = '.code-textarea'],
  ['another active element', s => s.focused = false],
  ['textarea instead of single-line input', s => s.tagName = 'TEXTAREA'],
  ['non-text input', s => s.type = 'number'],
  ['read-only input', s => s.readOnly = true],
  ['disabled input', s => s.disabled = true],
  ['unexpected original value', s => s.value = '原始图reading100-native-caption片说明'],
]) test('refuses ' + name + ' ' + phase + ' without inserting any text', async () => {
  const changed = snapshot(); mutate(changed)
  const h = transport(phase === 'before-keyboard' ? [changed] : [snapshot(), changed])
  await assert.rejects(replace(h), /Native text input precondition failed:.*observed=/s)
  assert.equal(insertions(h).length, 0)
  assert.equal(h.calls.filter(call => call[0] === 'accepted-selection').length, 0)
  if (phase === 'before-keyboard') assert.equal(h.calls.filter(call => call[0] === 'Input.dispatchKeyEvent').length, 0)
})

for (const [name, start, end] of [
  ['collapsed middle caret from the actual failed scenario', 3, 3],
  ['collapsed end caret', original.length, original.length],
  ['omitted prefix', 1, original.length],
  ['omitted suffix', 0, original.length - 1],
  ['absent native selection', null, null],
  ['string-coerced offsets', '0', String(original.length)],
  ['out-of-bounds range', 0, original.length + 1],
]) test('refuses ' + name + ' before insertText', async () => {
  const selected = { ...snapshot(), selectionStart: start, selectionEnd: end }
  const h = transport([snapshot(), selected])
  await assert.rejects(replace(h), /Native text input precondition failed:.*selectionStart.*selectionEnd/s)
  assert.equal(insertions(h).length, 0)
})

test('native keyboard transport failure cannot fall through to text insertion', async () => {
  const h = transport([snapshot()], { failCommand: 'Input.dispatchKeyEvent' })
  await assert.rejects(replace(h), /Synthetic transport command failure/)
  assert.equal(insertions(h).length, 0)
})
test('selection evidence write failure cannot fall through to text insertion', async () => {
  const h = transport([snapshot(), snapshot()])
  h.context.onSelection = async () => { throw Error('Synthetic evidence write failure') }
  await assert.rejects(replace(h), /Synthetic evidence write failure/)
  assert.equal(insertions(h).length, 0)
})
test('multi-line expected text is refused before keyboard navigation or insertion', async () => {
  const h = transport([{ ...snapshot(), value: 'first\nsecond' }])
  await assert.rejects(replaceNativeTextInput(h.context, READING_CAPTION_SELECTOR, 'first\nsecond', replacement), /single-line/)
  assert.equal(insertions(h).length, 0)
  assert.equal(h.calls.filter(call => call[0] === 'Input.dispatchKeyEvent').length, 0)
})

const formulaSnapshot = () => ({ ...snapshot(), selector: READING_FORMULA_SELECTOR,
  tagName: 'TEXTAREA', type: 'textarea', value: 'x^2', selectionStart: 0, selectionEnd: 3 })
test('formula replacement uses native selection with textarea focus and complete read-back before insertion', async () => {
  const h = transport([formulaSnapshot(), formulaSnapshot()])
  assert.deepEqual(await replaceNativeFormulaInput(h.context, 'x^2', 'y^3'), formulaSnapshot())
  assert.deepEqual(h.calls.filter(call => call[0] === 'Input.dispatchKeyEvent').map(call => [call[1].key, call[1].modifiers]), [
    ['End', 0], ['End', 0], ['Home', 8], ['Home', 8],
  ])
  assert.deepEqual(insertions(h), [['Input.insertText', { text: 'y^3' }]])
})
for (const [name, patch] of [
  ['lost textarea focus', { focused: false }], ['read-only formula', { readOnly: true }],
  ['formula prefix omitted', { selectionStart: 1 }], ['formula suffix omitted', { selectionEnd: 2 }],
]) test('formula replacement refuses ' + name + ' without inserting', async () => {
  const h = transport([formulaSnapshot(), { ...formulaSnapshot(), ...patch }])
  await assert.rejects(replaceNativeFormulaInput(h.context, 'x^2', 'y^3'))
  assert.equal(insertions(h).length, 0)
})

const previousURL = 'https://example.invalid/original', replacementURL = 'https://example.invalid/replacement'
const urlSnapshot = value => ({ ...snapshot(), selector: READING_EMBED_URL_SELECTOR,
  type: 'url', value, selectionStart: null, selectionEnd: null })
test('URL replacement proves native deletion reached an empty focused input before insertText', async () => {
  const h = transport([urlSnapshot(previousURL), urlSnapshot(''), urlSnapshot(replacementURL)])
  const observation = await replaceNativeUrlInput(h.context, previousURL, replacementURL)
  assert.equal(observation.cleared.value, '')
  assert.equal(observation.after.value, replacementURL)
  assert.deepEqual(h.calls.filter(call => call[0] === 'Input.dispatchKeyEvent').map(call => [call[1].key, call[1].modifiers]), [
    ['End', 0], ['End', 0], ['Home', 8], ['Home', 8], ['Backspace', 0], ['Backspace', 0],
  ])
  assert.equal(insertions(h).length, 1)
})
for (const [name, patch] of [
  ['partial URL deletion', { value: 'https://remaining-prefix' }],
  ['focus moved away from URL', { focused: false }],
  ['URL became read-only', { readOnly: true }],
  ['a text input masquerading as URL', { type: 'text' }],
]) test('URL replacement refuses ' + name + ' before insertion', async () => {
  const h = transport([urlSnapshot(previousURL), { ...urlSnapshot(''), ...patch }])
  await assert.rejects(replaceNativeUrlInput(h.context, previousURL, replacementURL))
  assert.equal(insertions(h).length, 0)
})
test('URL replacement cannot report success when the real value after insertion differs', async () => {
  const h = transport([urlSnapshot(previousURL), urlSnapshot(''), urlSnapshot('unexpected')])
  await assert.rejects(replaceNativeUrlInput(h.context, previousURL, replacementURL))
  assert.equal(insertions(h).length, 1)
})
