// @vitest-environment jsdom
import React, { act, createRef, StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Input from 'antd/es/input'
import { UiInput, UiPassword, UiSelect, UiTextarea } from './ControlKit'
import UiThemeProvider from './UiThemeProvider'
import { setUiValue } from '~/test/uiControlDriver'

let host, root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // jsdom has no layout/ResizeObserver; form semantics use the real controls
  // without asserting layout or replacing their value/event implementation.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
})
const variants = [
  { label: 'Input', Component: UiInput, Official: Input, tag: 'input', type: 'text' },
  { label: 'Password', Component: UiPassword, Official: Input.Password, tag: 'input', type: 'password' },
  { label: 'TextArea', Component: UiTextarea, Official: Input.TextArea, tag: 'textarea' }
]
const mount = async children => act(async () => root.render(<StrictMode><UiThemeProvider>{children}</UiThemeProvider></StrictMode>))
async function edit(node, value) {
  await act(async () => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function pair({ Component, tag: Native, type }, props, changed, refs, form) {
  return <>
    <Native {...props} type={type} name="native" form={form} ref={refs.native} onChange={changed.native}/>
    <Component {...props} name="shared" form={form} ref={refs.shared} onChange={changed.shared}/>
  </>
}
const newPair = () => ({ changed: { native: vi.fn(), shared: vi.fn() }, refs: { native: createRef(), shared: createRef() } })
const values = refs => [refs.native.current.value, refs.shared.current.value]
const finishScheduledWork = () => act(async () => vi.runOnlyPendingTimersAsync())

it.each(variants)('$label restores the native default synchronously without change events or replacing its node', async variant => {
  const { changed, refs } = newPair()
  const view = () => <form>{pair(variant, { defaultValue: 'original' }, changed, refs)}<button type="reset">Reset</button></form>
  await mount(view())
  const form = host.querySelector('form'), nodes = { native: refs.native.current, shared: refs.shared.current }
  await edit(nodes.native, 'edited'); await edit(nodes.shared, 'edited')
  expect(values(refs)).toEqual(['edited', 'edited'])
  for (const key of ['native', 'shared']) {
    expect(changed[key]).toHaveBeenCalledOnce()
    expect(changed[key].mock.calls[0][0].nativeEvent.target).toBe(nodes[key])
    expect(changed[key].mock.calls[0][0].target.value).toBe('edited')
    expect(changed[key].mock.calls[0][0].nativeEvent.type).toBe('input')
  }
  let immediate
  await act(async () => { form.reset(); immediate = { values: values(refs), defaults: [refs.native.current.defaultValue, refs.shared.current.defaultValue], data: Object.fromEntries(new FormData(form)) } })
  expect(immediate).toEqual({ values: ['original', 'original'], defaults: ['original', 'original'], data: { native: 'original', shared: 'original' } })
  expect(values(refs)).toEqual(['original', 'original'])
  await mount(view())
  expect(values(refs)).toEqual(['original', 'original'])
  expect(refs.native.current).toBe(nodes.native); expect(refs.shared.current).toBe(nodes.shared)
  expect(changed.native).toHaveBeenCalledOnce(); expect(changed.shared).toHaveBeenCalledOnce()
  await edit(nodes.native, 'second'); await edit(nodes.shared, 'second')
  await act(async () => form.querySelector('button').click())
  expect(values(refs)).toEqual(['original', 'original'])
  expect(changed.native).toHaveBeenCalledTimes(2); expect(changed.shared).toHaveBeenCalledTimes(2)
})

it.each(variants)('$label preserves edits when reset is cancelled by a later bubbling listener', async variant => {
  const { changed, refs } = newPair(), reset = vi.fn(event => event.preventDefault())
  const view = () => <div onReset={reset}><form>{pair(variant, { defaultValue: 'original' }, changed, refs)}</form></div>
  await mount(view())
  await edit(refs.native.current, 'edited'); await edit(refs.shared.current, 'edited')
  const form = host.querySelector('form'), node = refs.shared.current
  let immediate
  await act(async () => { form.reset(); immediate = Object.fromEntries(new FormData(form)) })
  expect(reset).toHaveBeenCalledOnce(); expect(immediate).toEqual({ native: 'edited', shared: 'edited' })
  expect(values(refs)).toEqual(['edited', 'edited'])
  await mount(view())
  expect(values(refs)).toEqual(['edited', 'edited']); expect(refs.shared.current).toBe(node)
  expect(changed.native).toHaveBeenCalledOnce(); expect(changed.shared).toHaveBeenCalledOnce()
})

it.each(variants)('$label updates the next reset default without replacing a dirty current value', async variant => {
  const { changed, refs } = newPair()
  const view = defaultValue => <form>{pair(variant, { defaultValue }, changed, refs)}</form>
  await mount(view('original'))
  await edit(refs.native.current, 'edited'); await edit(refs.shared.current, 'edited')
  const node = refs.shared.current
  await mount(view('next default'))
  expect(values(refs)).toEqual(['edited', 'edited'])
  let immediate
  await act(async () => { host.querySelector('form').reset(); immediate = values(refs) })
  expect(immediate).toEqual(['next default', 'next default'])
  expect(values(refs)).toEqual(['next default', 'next default']); expect(refs.shared.current).toBe(node)
  expect(changed.native).toHaveBeenCalledOnce(); expect(changed.shared).toHaveBeenCalledOnce()
})

it.each(variants)('$label follows the actual external form owner and leaves other forms alone', async variant => {
  const { changed, refs } = newPair()
  const view = owner => <><form id="first"/><form id="second"/>{pair(variant, { defaultValue: 'original' }, changed, refs, owner)}</>
  await mount(view('first'))
  await edit(refs.native.current, 'edited'); await edit(refs.shared.current, 'edited')
  const node = refs.shared.current
  await mount(view('second'))
  await act(async () => host.querySelector('#first').reset())
  expect(values(refs)).toEqual(['edited', 'edited'])
  let immediate
  await act(async () => { const form = host.querySelector('#second'); form.reset(); immediate = Object.fromEntries(new FormData(form)) })
  expect(immediate).toEqual({ native: 'original', shared: 'original' })
  expect(values(refs)).toEqual(['original', 'original']); expect(refs.shared.current).toBe(node)
})

it.each(variants)('$label keeps its controlled value on reset and emits no synthetic change', async variant => {
  const { changed, refs } = newPair()
  await mount(<form>{pair(variant, { value: 'controlled' }, changed, refs)}</form>)
  if (variant.label === 'Password') {
    await vi.waitFor(() => expect(refs.shared.current.hasAttribute('value')).toBe(false))
  }
  const node = refs.shared.current
  let immediate
  await act(async () => { const form = host.querySelector('form'); form.reset(); immediate = Object.fromEntries(new FormData(form)) })
  expect(immediate).toEqual({ native: 'controlled', shared: 'controlled' })
  expect(values(refs)).toEqual(['controlled', 'controlled']); expect(refs.shared.current).toBe(node)
  expect(changed.native).not.toHaveBeenCalled(); expect(changed.shared).not.toHaveBeenCalled()
})

it.each(variants)('$label keeps the accepted reset through the real parent onReset rerender', async variant => {
  vi.useFakeTimers()
  const { changed, refs } = newPair()
  function Fixture() {
    const [resets, setResets] = useState(0), [renders, setRenders] = useState(0)
    return <><form onReset={() => flushSync(() => setResets(count => count + 1))}>
      {pair(variant, { defaultValue: 'original' }, changed, refs)}
      <button type="button" onClick={() => setRenders(count => count + 1)}>Render</button>
    </form><output>{resets}:{renders}</output></>
  }
  await mount(<Fixture/>); await finishScheduledWork()
  await edit(refs.native.current, 'edited'); await edit(refs.shared.current, 'edited')
  const node = refs.shared.current, form = host.querySelector('form')
  let immediate
  await act(async () => { form.reset(); immediate = Object.fromEntries(new FormData(form)) })
  expect(immediate).toEqual({ native: 'original', shared: 'original' })
  await finishScheduledWork(); await act(async () => host.querySelector('button').click())
  expect(host.querySelector('output').textContent).toBe('1:1')
  expect(values(refs)).toEqual(['original', 'original']); expect(refs.shared.current).toBe(node)
  expect(changed.native).toHaveBeenCalledOnce(); expect(changed.shared).toHaveBeenCalledOnce()
})

it.each([false, true])('Password preserves value-attribute cleanup after reset (controlled=%s)', async controlled => {
  vi.useFakeTimers()
  const ref = createRef(), changed = vi.fn(), valueProps = controlled ? { value: 'controlled' } : { defaultValue: 'original' }
  await mount(<form><UiPassword name="password" ref={ref} {...valueProps} onChange={changed}/></form>)
  await finishScheduledWork()
  expect(ref.current.hasAttribute('value')).toBe(false)
  if (!controlled) { await edit(ref.current, 'edited'); await finishScheduledWork() }
  const node = ref.current, expected = controlled ? 'controlled' : 'original'
  let immediate
  await act(async () => { const form = host.querySelector('form'); form.reset(); immediate = new FormData(form).get('password') })
  expect(immediate).toBe(expected)
  await finishScheduledWork()
  expect(ref.current.value).toBe(expected); expect(ref.current.hasAttribute('value')).toBe(false)
  expect(ref.current).toBe(node); expect(changed).toHaveBeenCalledTimes(controlled ? 0 : 1)
})

it.each(variants)('$label does not let an earlier reset task overwrite a subsequent input event', async variant => {
  vi.useFakeTimers()
  const { changed, refs } = newPair()
  await mount(<form>{pair(variant, { defaultValue: 'original' }, changed, refs)}</form>)
  await finishScheduledWork()
  await edit(refs.native.current, 'edited'); await edit(refs.shared.current, 'edited')
  await act(async () => host.querySelector('form').reset())
  await edit(refs.native.current, 'after reset'); await edit(refs.shared.current, 'after reset')
  await finishScheduledWork()
  expect(values(refs)).toEqual(['after reset', 'after reset'])
  expect(changed.native).toHaveBeenCalledTimes(2); expect(changed.shared).toHaveBeenCalledTimes(2)
})

it.each(variants)('$label matches native defaults after reset, a new default, and a cancelled second reset', async variant => {
  vi.useFakeTimers()
  const { changed, refs } = newPair()
  const view = (defaultValue, cancel) => <div onReset={cancel ? event => event.preventDefault() : undefined}>
    <form>{pair(variant, { defaultValue }, changed, refs)}</form>
  </div>
  await mount(view('original', false)); await finishScheduledWork()
  await edit(refs.native.current, 'edited'); await edit(refs.shared.current, 'edited')
  await act(async () => host.querySelector('form').reset()); await finishScheduledWork()
  await mount(view('next default', true))
  expect(refs.shared.current.value).toBe(refs.native.current.value)
  const before = values(refs)
  let immediate
  await act(async () => { host.querySelector('form').reset(); immediate = values(refs) })
  expect(immediate).toEqual(before)
  await finishScheduledWork(); expect(values(refs)).toEqual(before)
})

it.each(variants)('$label retains a successful reset followed by a cancelled reset in the same task', async variant => {
  vi.useFakeTimers()
  const { changed, refs } = newPair()
  let resets = 0
  const view = () => <form onReset={event => { if (++resets === 2) event.preventDefault() }}>
    {pair(variant, { defaultValue: 'original' }, changed, refs)}
  </form>
  await mount(view()); await finishScheduledWork()
  await edit(refs.native.current, 'edited'); await edit(refs.shared.current, 'edited')
  let immediate
  await act(async () => { const form = host.querySelector('form'); form.reset(); form.reset(); immediate = values(refs) })
  expect(immediate).toEqual(['original', 'original'])
  await finishScheduledWork(); await mount(view())
  expect(values(refs)).toEqual(['original', 'original'])
  expect(changed.native).toHaveBeenCalledOnce(); expect(changed.shared).toHaveBeenCalledOnce()
})

it('cancels reset completion work on unmount and preserves native fallback controls', async () => {
  vi.useFakeTimers()
  const text = createRef(), checkbox = createRef()
  await mount(<form><UiInput ref={text} defaultValue="original"/><UiInput ref={checkbox} type="checkbox" defaultChecked/></form>)
  await finishScheduledWork(); await edit(text.current, 'edited')
  // Finish the pre-reset edit's native select notifications (rc-input copies
  // selection into its event target). No work is advanced after reset/unmount.
  await finishScheduledWork()
  await act(async () => checkbox.current.click())
  expect(checkbox.current.checked).toBe(false); expect(checkbox.current.getAttribute('data-ui-native')).toBe('checkbox')
  await act(async () => host.querySelector('form').reset())
  expect(text.current.value).toBe('original'); expect(checkbox.current.checked).toBe(true)
  await act(async () => root.unmount()); root = null
  expect(text.current).toBe(null); expect(checkbox.current).toBe(null); expect(vi.getTimerCount()).toBe(0)
})

it('keeps password visibility, focus ownership and native node identity through reset', async () => {
  vi.useFakeTimers()
  const shared = createRef(), native = createRef(), sharedFocus = vi.fn(), nativeFocus = vi.fn()
  function Fixture() {
    const [visible, setVisible] = useState(false)
    return <form>
      <input ref={native} type={visible ? 'text' : 'password'} defaultValue="original" onFocus={nativeFocus}/>
      <button type="button" onClick={() => setVisible(value => !value)}>Native visibility</button>
      <UiPassword ref={shared} defaultValue="original" onFocus={sharedFocus}/>
    </form>
  }
  await mount(<Fixture/>); await finishScheduledWork()
  await act(async () => { native.current.focus(); shared.current.focus() })
  await act(async () => { host.querySelector('button').click(); host.querySelector('.ant-input-password-icon').click() })
  const original = shared.current
  expect(native.current.type).toBe('text'); expect(shared.current.type).toBe('text')
  expect(document.activeElement).toBe(original)
  await act(async () => host.querySelector('form').reset()); await finishScheduledWork()
  expect(shared.current).toBe(original); expect(document.activeElement).toBe(original)
  expect(native.current.type).toBe('text'); expect(shared.current.type).toBe('text')
  expect(nativeFocus).toHaveBeenCalledOnce(); expect(sharedFocus).toHaveBeenCalledOnce()
})

it('keeps special input types on their native path when the same wrapper changes type', async () => {
  const ref = createRef()
  await mount(<UiInput ref={ref} type="text" defaultValue="original"/>)
  await edit(ref.current, 'edited')
  await mount(<UiInput ref={ref} type="checkbox" defaultChecked/>)
  expect(ref.current.type).toBe('checkbox'); expect(ref.current.checked).toBe(true)
  expect(ref.current.getAttribute('data-ui-native')).toBe('checkbox')
  await mount(<UiInput ref={ref} type="text" defaultValue="original"/>)
  expect(ref.current.type).toBe('text'); expect(ref.current.value).toBe('original')
})

it('uses the real official Input, Password and TextArea implementations in the native reset comparison', async () => {
  const receipts = []
  for (const { label, Official, tag: Native, type } of variants) {
    await mount(<form><Native type={type} name="native" defaultValue="original"/><Official name="official" defaultValue="original"/></form>)
    const form = host.querySelector('form'), native = form.elements.namedItem('native'), official = form.elements.namedItem('official')
    await edit(native, 'edited'); await edit(official, 'edited')
    await act(async () => form.reset())
    receipts.push({ label, nativeValue: native.value, officialValue: official.value, officialDefault: official.defaultValue })
    expect(native.value).toBe('original')
    expect(official.className).toContain('ant-input')
  }
  console.info('Official native reset comparison:', JSON.stringify(receipts))
})

it('does not reset an uncontrolled Select when the real form reset is cancelled', async () => {
  const changed = vi.fn(), ref = createRef(), cancel = vi.fn(event => event.preventDefault())
  await mount(<div onReset={cancel}><form>
    <select name="native" defaultValue="a"><option value="a">Alpha</option><option value="b">Beta</option></select>
    <UiSelect ref={ref} name="shared" defaultValue="a" options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} onChange={changed}/>
  </form></div>)
  const form = host.querySelector('form'), native = form.querySelector('select')
  native.value = 'b'; await setUiValue(host.querySelector('[role="combobox"]'), 'b')
  await act(async () => form.reset())
  expect(cancel).toHaveBeenCalledOnce(); expect(native.value).toBe('b'); expect(ref.current.value).toBe('b')
  expect(Object.fromEntries(new FormData(form))).toEqual({ native: 'b', shared: 'b' })
  expect(changed).toHaveBeenCalledOnce()
})
