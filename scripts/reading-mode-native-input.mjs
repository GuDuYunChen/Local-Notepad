import assert from 'node:assert/strict'

export const READING_CAPTION_SELECTOR = '.editor-image-caption-input'

export function assertNativeTextInputReady(snapshot, selector, expectedValue) {
  assert.ok(snapshot && typeof snapshot === 'object', 'Native input observation is missing')
  assert.ok(typeof expectedValue === 'string' && expectedValue.length > 0 && !/[\r\n]/.test(expectedValue), 'Native replacement requires nonempty single-line text')
  assert.equal(snapshot.selector, selector)
  assert.equal(snapshot.found, true, 'Native replacement input is missing')
  assert.equal(snapshot.focused, true, 'Native replacement input does not own focus')
  assert.equal(snapshot.tagName, 'INPUT', 'Native replacement requires a single-line input')
  assert.equal(snapshot.type, 'text')
  assert.equal(snapshot.readOnly, false, 'Native replacement input is read-only')
  assert.equal(snapshot.disabled, false, 'Native replacement input is disabled')
  assert.equal(snapshot.value, expectedValue, 'Native input changed before the intended replacement')
  return true
}

export function assertFullNativeTextSelection(snapshot, selector, expectedValue) {
  assertNativeTextInputReady(snapshot, selector, expectedValue)
  assert.equal(snapshot.selectionStart, 0, 'Native replacement did not select the start of the input')
  assert.equal(snapshot.selectionEnd, expectedValue.length, 'Native replacement did not select the complete input')
  return true
}

// Input.insertText replaces only the current native selection. Ctrl+A can be
// intercepted by an enclosing editor, so use native line navigation and read
// back the exact focused control and full selection before sending any text.
// Runtime evaluation only reads DOM properties; it never sets value or selection.
export async function replaceNativeTextInput(context, selector, expectedValue, replacement) {
  const { evaluate, click, cdp, settle, onSelection } = context
  assert.ok(typeof replacement === 'string' && replacement.length > 0 && !/[\r\n]/.test(replacement))
  const observe = () => evaluate(`(()=>{
    const selector=${JSON.stringify(selector)},node=document.querySelector(selector);
    return {selector,found:!!node,focused:!!node&&document.activeElement===node,
      tagName:node?.tagName,type:node?.type,value:node?.value,
      readOnly:node?.readOnly,disabled:node?.disabled,
      selectionStart:node?.selectionStart,selectionEnd:node?.selectionEnd};
  })()`)
  const key = async (name, code, modifiers = 0) => {
    const params = { key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers }
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, ...params })
  }
  const requireObservation = (snapshot, validation) => {
    try { validation(snapshot, selector, expectedValue) }
    catch (error) {
      throw new Error('Native text input precondition failed: ' + error.message + '; observed=' + JSON.stringify(snapshot), { cause: error })
    }
  }
  await click(selector); await settle()
  requireObservation(await observe(), assertNativeTextInputReady)
  await key('End', 35)
  await key('Home', 36, 8)
  await settle()
  const selection = await observe()
  requireObservation(selection, assertFullNativeTextSelection)
  if (onSelection) await onSelection(selection)
  await cdp.send('Input.insertText', { text: replacement })
  return selection
}
