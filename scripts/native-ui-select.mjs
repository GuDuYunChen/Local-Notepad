import assert from 'node:assert/strict'

// Native acceptance tooling only. Read the real rendered control; never assign
// a Select value, replace a component or invoke its React callbacks.
export function inspectNativeUiSelect(selector) {
  const matches = [...document.querySelectorAll(selector)]
  if (matches.length !== 1) return { count: matches.length }
  const element = matches[0]
  if (element.tagName === 'SELECT') {
    return { count: 1, kind: 'native', value: element.value, multiple: element.multiple,
      disabled: element.matches(':disabled'), focused: document.activeElement === element,
      options: [...element.options].map(option => ({ value: option.value,
        disabled: option.disabled || Boolean(option.closest('optgroup')?.disabled) })) }
  }
  const host = element.closest('[data-ui-control="select"]')
  const fields = host ? [...host.querySelectorAll('[role="combobox"]')] : []
  if (fields.length !== 1 || !fields[0].id || !host.hasAttribute('data-ui-value')) {
    return { count: 1, kind: 'unsupported' }
  }
  const field = fields[0], value = JSON.parse(host.getAttribute('data-ui-value'))
  const popupId = field.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  const popupReady = Boolean(popup?.getAttribute('role') === 'listbox')
  const options = popupReady ? [...popup.querySelectorAll('[role="option"]')].map(option => {
    const labels = [...option.querySelectorAll('[data-ui-option-value]')]
    return { id: option.id, value: labels.length === 1 ? labels[0].getAttribute('data-ui-option-value') : null,
      disabled: option.getAttribute('aria-disabled') === 'true', selected: option.getAttribute('aria-selected') === 'true' }
  }) : []
  return { count: 1, kind: 'shared', value, multiple: Array.isArray(value),
    disabled: field.disabled || field.getAttribute('aria-disabled') === 'true',
    focused: document.activeElement === field, expanded: field.getAttribute('aria-expanded') === 'true',
    inputId: field.id, popupId, popupReady, options }
}

export function createNativeUiSelect({ evaluate, click, cdp, until }) {
  for (const [name, fn] of Object.entries({ evaluate, click, until })) assert.equal(typeof fn, 'function', name + ' is required')
  assert.equal(typeof cdp?.send, 'function', 'Native CDP input is required')
  const inspect = selector => evaluate(`(${inspectNativeUiSelect.toString()})(${JSON.stringify(selector)})`)
  const requireControl = (state, selector) => {
    assert.equal(state?.count, 1, 'Select missing or ambiguous: ' + selector)
    assert.ok(state.kind === 'native' || state.kind === 'shared', 'Expected a real native or shared Select: ' + selector)
    return state
  }
  const value = async selector => requireControl(await inspect(selector), selector).value
  const key = async (key, code) => {
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code })
  }
  const choose = async (selector, requested) => {
    assert.equal(typeof requested, 'string', 'Select choice must be an exact string value')
    const before = await until(async () => {
      const state = await inspect(selector)
      if (state.count === 0) return false
      requireControl(state, selector)
      return !state.disabled && state
    }, 'Select did not become enabled: ' + selector)
    assert.equal(before.multiple, false, 'Native acceptance choice requires a single-value Select')
    if (before.kind === 'native') {
      const enabled = before.options.filter(option => !option.disabled)
      const choices = enabled.filter(option => option.value === requested)
      assert.equal(choices.length, 1, 'Requested enabled native choice missing or ambiguous: ' + requested)
      // This compatibility path is only for an actual HTMLSelectElement in an
      // original historical installer. The current shared control never uses it.
      await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (node?.tagName !== 'SELECT') throw Error('Native Select changed'); node.focus({preventScroll:true}); return document.activeElement === node })()`)
      assert.equal((await inspect(selector)).focused, true, 'Original native Select did not receive focus')
      await key('Home', 36)
      for (let index = 0; index < enabled.indexOf(choices[0]); index++) await key('ArrowDown', 40)
      await key('Enter', 13)
    } else {
      const host = '[data-ui-control="select"]:has([role="combobox"][id=' + JSON.stringify(before.inputId) + '])'
      if (!before.expanded) await click(host)
      const opened = await until(async () => {
        const state = requireControl(await inspect(selector), selector)
        return state.kind === 'shared' && !state.disabled && state.expanded && state.popupReady && state
      }, 'Select did not open its own real popup: ' + selector)
      const choices = opened.options.filter(option => option.value === requested)
      assert.equal(choices.length, 1, 'Requested popup choice missing or ambiguous: ' + requested)
      const option = choices[0]
      assert.equal(option.disabled, false, 'Requested popup choice is disabled: ' + requested)
      assert.ok(option.id, 'Real popup choice has no ARIA identity')
      // Scope the trusted click to the listbox linked by this combobox. Another
      // field's same-label option, retained hidden popup or search text cannot win.
      const optionSelector = '[role="listbox"][id=' + JSON.stringify(opened.popupId) + '] [role="option"][id=' + JSON.stringify(option.id) + ']'
      await click(optionSelector)
    }
    return until(async () => {
      const after = requireControl(await inspect(selector), selector)
      return after.kind === before.kind && !after.disabled && after.value === requested &&
        (after.kind === 'native' || !after.expanded) && after
    }, 'Original Select did not commit the requested value: ' + selector)
  }
  return { inspect, value, choose }
}
