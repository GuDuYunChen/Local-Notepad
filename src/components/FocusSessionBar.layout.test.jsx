import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import FocusSessionBar from './FocusSessionBar'
import { createFocusSession } from './focusSessionUtils'
import UiThemeProvider from './ui/UiThemeProvider'

let host, root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('focus mode offers a separate exit action without ending the current session', async () => {
  const onToggleFocus = vi.fn(), onEnd = vi.fn()
  const session = createFocusSession({
    projectId: 'owned-project',
    noteId: 'owned-note',
    noteTitle: '仍在写作.md',
    durationMinutes: 25,
    startedAt: Date.now(),
  })
  const render = focused => act(async () => {
    root.render(<UiThemeProvider><FocusSessionBar session={session}
      currentWords={0} focused={focused}
      onToggleFocus={onToggleFocus} onEnd={onEnd}/></UiThemeProvider>)
  })
  await render(true)
  let buttons = [...host.querySelectorAll('.focus-session-actions button')]
  expect(buttons).toHaveLength(2)
  expect(buttons.every(button => !button.disabled)).toBe(true)
  expect(buttons.map(button => button.textContent.trim())).toEqual(['显示界面', '结束 Session'])
  await act(async () => buttons[0].click())
  expect(onToggleFocus).toHaveBeenCalledTimes(1)
  expect(onEnd).not.toHaveBeenCalled()

  await render(false)
  buttons = [...host.querySelectorAll('.focus-session-actions button')]
  expect(buttons.map(button => button.textContent.trim())).toEqual(['继续专注', '结束 Session'])
  await act(async () => buttons[1].click())
  expect(onEnd).toHaveBeenCalledTimes(1)
  expect(onEnd).toHaveBeenCalledWith('manual')
})

test('compact session CSS does not hide its only return-to-interface action', () => {
  const css = readFileSync(process.cwd() + '/src/components/FocusSessionBar.css', 'utf8')
  const compact = css.slice(css.indexOf('@media (max-width: 760px)'))
  expect(compact).toContain('.focus-session-actions button')
  expect(compact).not.toMatch(/\.focus-session-actions\s+button:first-child\s*\{[^}]*display\s*:\s*none/i)
  expect(compact).toMatch(/\.focus-session-actions button\s*\{[^}]*min-width:\s*0/i)
  expect(compact).toContain('@media (max-width: 480px)')
  expect(compact).toMatch(/\.focus-session-stat\s*\{\s*display:\s*none;/)
})
