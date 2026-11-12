import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReferenceRefactorDialog from './ReferenceRefactorDialog'
import UiThemeProvider from './ui/UiThemeProvider'

const plan = {
  summary: { incomingReferences: 1, affectedFiles: 1, repairable: 1, broken: 0 },
  sources: [{ id: 'source-1', title: '引用来源.md', incomingReferences: 1 }],
}
let container, root, origin, callbacks
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
beforeEach(() => {
  origin = document.createElement('input')
  origin.value = '尚未提交的名称'
  document.body.appendChild(origin)
  origin.focus(); origin.setSelectionRange(2, 5, 'backward')
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  callbacks = { onCancel: vi.fn(), onConfirm: vi.fn(), onOpenSource: vi.fn() }
})
afterEach(async () => {
  await act(async () => { root.unmount(); await flush() })
  container.remove(); origin.remove(); vi.restoreAllMocks()
})
async function render(props = {}) {
  await act(async () => {
    root.render(<UiThemeProvider><ReferenceRefactorDialog mode="rename" targetTitle="原名.md" nextTitle="新名.md" plan={plan} {...callbacks} {...props}/></UiThemeProvider>)
    await flush()
  })
}
function tab(node, options = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...options })
  node.dispatchEvent(event)
  return event
}
const close = () => container.querySelector('[aria-label="关闭"]')
const confirm = () => container.querySelector('.reference-refactor-actions button:last-child')

describe('ReferenceRefactorDialog keyboard ownership', () => {
  it('focuses the review close control without committing the pending name or a reference action', async () => {
    await render()
    expect(document.activeElement).toBe(close())
    expect(origin.value).toBe('尚未提交的名称')
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled()
  })

  it('keeps Tab and Shift+Tab inside the review while leaving interior native traversal intact', async () => {
    await render()
    expect(tab(close()).defaultPrevented).toBe(false)
    close().focus()
    expect(tab(close(), { shiftKey: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(confirm())
    expect(tab(confirm()).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close())
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled()
  })

  it('recovers an outside Tab before an underlying editor can consume it', async () => {
    await render()
    const backgroundKey = vi.fn()
    origin.addEventListener('keydown', backgroundKey)
    origin.focus()
    expect(tab(origin).defaultPrevented).toBe(true)
    expect(backgroundKey).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(close())
    origin.removeEventListener('keydown', backgroundKey)
  })

  it('does not move focus on ordinary rerenders or take composition keystrokes', async () => {
    await render()
    const source = container.querySelector('.reference-refactor-source button')
    source.focus()
    await render({ nextTitle: '更正后的新名.md' })
    expect(document.activeElement).toBe(source)
    expect(tab(source, { isComposing: true }).defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(source)
    expect(tab(source, { keyCode: 229 }).defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(source)
  })

  it('keeps a busy review focusable without enabling or invoking its actions', async () => {
    await render({ busy: true })
    const dialog = container.querySelector('[role="dialog"]')
    expect(document.activeElement).toBe(dialog)
    expect([...dialog.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
    expect(tab(dialog).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(dialog)
    await render({ busy: false })
    expect(tab(dialog).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close())
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled()
  })

  it('restores the connected origin and its selection, then releases the Tab listener on close', async () => {
    await render()
    await render({ plan: null })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(origin)
    expect([origin.value, origin.selectionStart, origin.selectionEnd, origin.selectionDirection])
      .toEqual(['尚未提交的名称', 2, 5, 'backward'])
    expect(tab(origin).defaultPrevented).toBe(false)
  })
})
