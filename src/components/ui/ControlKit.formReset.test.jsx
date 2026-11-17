import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UiButton, UiInput, UiPassword, UiTextarea } from './ControlKit'
import UiThemeProvider from './UiThemeProvider'

let host, root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.unstubAllGlobals()
})
const render = element => act(async () => root.render(<UiThemeProvider>{element}</UiThemeProvider>))
async function enterText(node, value) {
  const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
  await act(async () => {
    setter.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it('restores the original text, password and textarea defaults after an actual form reset and React rerender', async () => {
  const titleRef = React.createRef(), changes = [vi.fn(), vi.fn(), vi.fn()]
  function Fields() {
    const [resets, setResets] = useState(0)
    return <form onReset={() => setResets(n => n + 1)}>
      <UiInput name="title" ref={titleRef} defaultValue="original" onChange={changes[0]} />
      <UiPassword name="secret" defaultValue="private-default" onChange={changes[1]} />
      <UiTextarea name="notes" defaultValue="prior note" onChange={changes[2]} />
      <UiButton type="reset">Reset</UiButton><output>{resets}</output>
    </form>
  }
  await render(<Fields />)
  const form = host.querySelector('form'), before = [...form.querySelectorAll('input[name], textarea[name]')]
  expect(before.map(node => node.value)).toEqual(['original', 'private-default', 'prior note'])
  for (const [node, text] of before.map((node, index) => [node, ['edited', 'changed-secret', 'new note'][index]])) await enterText(node, text)
  expect(before.map(node => node.value)).toEqual(['edited', 'changed-secret', 'new note'])
  for (const change of changes) expect(change).toHaveBeenCalled()
  const counts = changes.map(change => change.mock.calls.length)
  await act(async () => { form.reset(); await Promise.resolve() })
  const after = [...form.querySelectorAll('input[name], textarea[name]')]
  expect(after.map(node => node.value)).toEqual(['original', 'private-default', 'prior note'])
  expect(Object.fromEntries(new FormData(form))).toEqual({ title: 'original', secret: 'private-default', notes: 'prior note' })
  expect(titleRef.current).toBe(after[0])
  expect(host.querySelector('output').textContent).toBe('1')
  expect(changes.map(change => change.mock.calls.length)).toEqual(counts)
})

it('does not override a cancelled native reset or trigger synthetic value-change callbacks', async () => {
  const onChange = vi.fn()
  function Fields() {
    const [resets, setResets] = useState(0)
    return <form onReset={event => { event.preventDefault(); setResets(n => n + 1) }}>
      <UiInput name="title" defaultValue="original" onChange={onChange} />
      <UiButton type="reset">Reset</UiButton><output>{resets}</output>
    </form>
  }
  await render(<Fields />)
  const form = host.querySelector('form'), field = form.querySelector('input[name="title"]')
  await enterText(field, 'edited')
  const count = onChange.mock.calls.length
  await act(async () => { form.reset(); await Promise.resolve() })
  expect(form.querySelector('input[name="title"]')).toBe(field)
  expect(field.value).toBe('edited')
  expect(host.querySelector('output').textContent).toBe('1')
  expect(onChange).toHaveBeenCalledTimes(count)
})

it('keeps a caller-controlled value and original input node under native form reset', async () => {
  function Fields() {
    const [resets, setResets] = useState(0)
    return <form onReset={() => setResets(n => n + 1)}>
      <UiInput value="controlled" readOnly name="title" />
      <UiButton type="reset">Reset</UiButton><output>{resets}</output>
    </form>
  }
  await render(<Fields />)
  const form = host.querySelector('form'), field = form.querySelector('input[name="title"]')
  await act(async () => { form.reset(); await Promise.resolve() })
  expect(form.querySelector('input[name="title"]')).toBe(field)
  expect(field.value).toBe('controlled')
  expect(host.querySelector('output').textContent).toBe('1')
})
