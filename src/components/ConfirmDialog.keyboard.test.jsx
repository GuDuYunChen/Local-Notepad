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
