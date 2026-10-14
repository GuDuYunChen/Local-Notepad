import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import ToastViewport from './ToastViewport'
import { toast, TOAST_EVENT } from '../services/toast'
let host, root
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ToastViewport />))
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
for (const type of ['success', 'error', 'warning', 'loading']) {
  test('passive ' + type + ' notification retains text and accessible announcement', async () => {
    await act(async () => { toast[type]('模板提示 ' + type, 0) })
    const item = host.querySelector('.app-toast')
    expect(item.getAttribute('role')).toBe(type === 'error' ? 'alert' : 'status')
    expect(item.textContent).toContain('模板提示 ' + type)
    expect(host.querySelector('.toast-viewport').getAttribute('aria-live')).toBe('polite')
    expect(item.querySelector('button,a,input,[tabindex]')).toBeNull()
    expect(!!item.querySelector('.app-toast-loader')).toBe(type === 'loading')
  })
}
test('toast close handle still dismisses only its own passive notification', async () => {
  let close
  await act(async () => { close = toast.success('first', 0); toast.error('second', 0) })
  await act(async () => close())
  expect(host.textContent).not.toContain('first'); expect(host.textContent).toContain('second')
})
test('passive notification keeps its original expiry and does not disappear early', async () => {
  await act(async () => { toast.success('expires', 1) })
  await act(async () => vi.advanceTimersByTime(999)); expect(host.textContent).toContain('expires')
  await act(async () => vi.advanceTimersByTime(1)); expect(host.querySelector('.app-toast')).toBeNull()
})
test('updated persistent notification cancels the earlier timer', async () => {
  const show = duration => window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: {action:'show',toast:{id:'same',type:'loading',content:'working',duration}} }))
  await act(async () => show(500)); await act(async () => show(0))
  await act(async () => vi.advanceTimersByTime(1000))
  expect(host.querySelectorAll('.app-toast')).toHaveLength(1)
  expect(host.textContent).toContain('working')
})
test('passive toast CSS cannot intercept the underlying template controls', () => {
  const css = readFileSync(new NodeURL('../styles/redesign.css', import.meta.url), 'utf8')
  const item = css.split('\n.app-toast {')[1]?.split('\n}')[0]
  const viewport = css.split('\n.toast-viewport {')[1]?.split('\n}')[0]
  expect(item).toBeTruthy(); expect(viewport).toBeTruthy()
  expect(item).toMatch(/pointer-events:\s*none\s*;/)
  expect(item).not.toMatch(/pointer-events:\s*auto\s*;/)
  expect(viewport).toMatch(/pointer-events:\s*none\s*;/)
})
