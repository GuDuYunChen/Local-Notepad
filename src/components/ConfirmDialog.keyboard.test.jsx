import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog'

let host, root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

it('keeps native forward and reverse Tab focus on both visible confirmation actions', async () => {
  const cancel = vi.fn(), confirm = vi.fn(), onClose = vi.fn()
  await act(async () => root.render(<ConfirmDialog
    title="移到回收站?"
    message="是否移到回收站"
    onClose={onClose}
    actions={[{ label: '取消', onClick: cancel }, { label: '移到回收站', kind: 'danger', onClick: confirm }]}
  />))
  const buttons = [...host.querySelectorAll('.consumer-confirm-modal button')]
  expect(buttons).toHaveLength(2)
  const tab = (button, shiftKey = false) => {
    button.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, shiftKey })
    button.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  }
  tab(buttons[1]); expect(document.activeElement).toBe(buttons[0])
  tab(buttons[0]); expect(document.activeElement).toBe(buttons[1])
  tab(buttons[0], true); expect(document.activeElement).toBe(buttons[1])
  tab(buttons[1], true); expect(document.activeElement).toBe(buttons[0])
  expect(cancel).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => buttons[0].click())
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(confirm).not.toHaveBeenCalled()
})


it('keeps the nested confirmation Tab key out of a parent workspace focus trap', async () => {
  const parentKeyDown = vi.fn()
  await act(async () => root.render(
    <div onKeyDown={parentKeyDown}>
      <ConfirmDialog title="移到回收站?" message="确认" actions={[
        { label: '取消', onClick: vi.fn() },
        { label: '移到回收站', kind: 'danger', onClick: vi.fn() },
      ]} />
    </div>
  ))
  const buttons = [...host.querySelectorAll('.consumer-confirm-modal button')]
  buttons[1].focus()
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  buttons[1].dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(parentKeyDown).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(buttons[0])
})

it('does not Tab-focus disabled loading confirmation actions', async () => {
  await act(async () => root.render(<ConfirmDialog
    title="处理中"
    message="请稍候"
    actions={[{ label: '取消', onClick: vi.fn() }, { label: '确定', kind: 'primary', loading: true, onClick: vi.fn() }]}
  />))
  const buttons = [...host.querySelectorAll('.consumer-confirm-modal button')]
  expect(buttons).toHaveLength(2)
  expect(buttons.every(button => button.disabled)).toBe(true)
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  buttons[0].dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

it.each([
  ['native composition', { isComposing: true }],
  ['legacy composition', { keyCode: 229 }],
])('leaves %s Tab with the input method without moving focus or invoking an action', async (_label, options) => {
  const cancel = vi.fn(), confirm = vi.fn(), onClose = vi.fn()
  await act(async () => root.render(<ConfirmDialog
    title="保留输入状态" message="确认后继续" onClose={onClose} actions={[
      { label: '取消', onClick: cancel },
      { label: '确认', kind: 'primary', onClick: confirm },
    ]}
  />))
  const primary = host.querySelector('.consumer-confirm-modal button:last-of-type')
  primary.focus()
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...options })
  primary.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(primary)
  expect(cancel).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})
