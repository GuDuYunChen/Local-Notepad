import React, { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UiButton } from './ControlKit'
import UiThemeProvider from './UiThemeProvider'
import WorkspaceSidebar from '../WorkspaceSidebar'
import { APP_ICON_DATA_URL } from '../../assets/appIconData'

let host, root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.unstubAllGlobals()
})
const render = children => act(async () => root.render(<UiThemeProvider>{children}</UiThemeProvider>))
const icon = <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" /></svg>

it.each(['icon-btn', 'icon-only'])('%s uses the official icon box while keeping the native ref and submit action', async className => {
  const ref = createRef(), click = vi.fn(), submit = vi.fn(event => event.preventDefault())
  await render(<form onSubmit={submit}><UiButton ref={ref} className={className} onClick={click} aria-label="Run action">{icon}</UiButton></form>)
  const button = host.querySelector('button')
  expect(ref.current).toBe(button)
  expect(button.type).toBe('submit')
  expect(button.classList.contains('ant-btn-icon-only')).toBe(true)
  expect(button.querySelector('.ant-btn-icon > svg')).not.toBeNull()
  expect(button.querySelector('.ant-btn-content')).toBeNull()
  await act(async () => button.click())
  expect(click).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledTimes(1)
})

it('keeps an explicit icon and its accompanying caption even on a legacy icon class', async () => {
  await render(<UiButton type="button" className="icon-btn" icon={icon}>Save changes</UiButton>)
  const button = host.querySelector('button')
  expect(button.querySelectorAll('svg')).toHaveLength(1)
  expect(button.textContent).toBe('Save changes')
  expect(button.classList.contains('ant-btn-icon-only')).toBe(false)
})

it('allows explicit multi-line content without changing ordinary actions or actual icon-only geometry', async () => {
  const ref = createRef(), click = vi.fn()
  await render(<>
    <UiButton type="button" layout="content" ref={ref} onClick={click} aria-pressed="true"><strong>Snapshot</strong><small>2026-11-10</small><span>Long note title</span></UiButton>
    <UiButton type="button">Ordinary action</UiButton>
    <UiButton type="button" layout="content" icon={icon} aria-label="Icon action" />
  </>)
  const buttons = [...host.querySelectorAll('button')]
  expect(buttons.map(button => button.dataset.uiLayout)).toEqual(['content', 'action', 'icon'])
  expect(ref.current).toBe(buttons[0]); expect(buttons[0].getAttribute('layout')).toBeNull()
  expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
  expect([...buttons[0].querySelectorAll('strong, small, span')].map(node => node.textContent)).toEqual(['Snapshot', '2026-11-10', 'Long note title'])
  await act(async () => buttons[0].click())
  expect(click).toHaveBeenCalledTimes(1)
})

it('does not infer icon-only from a substring, a single complex child, a numeric zero, or an explicitly empty icon', async () => {
  await render(<>
    <UiButton type="button" className="document-icon-btn-caption"><span><strong>Note</strong><small>Details</small></span></UiButton>
    <UiButton type="button" className="icon-only">{0}</UiButton>
    <UiButton type="button" className="icon-btn" icon={null}>Keep caption</UiButton>
  </>)
  const buttons = [...host.querySelectorAll('button')]
  expect(buttons.map(button => button.textContent)).toEqual(['NoteDetails', '0', 'Keep caption'])
  expect(buttons.every(button => !button.classList.contains('ant-btn-icon-only'))).toBe(true)
  expect(buttons[0].querySelector('strong').textContent).toBe('Note')
  expect(buttons[0].querySelector('small').textContent).toBe('Details')
})

it('retains disabled fieldset and first-legend behavior for icon actions', async () => {
  const allowed = vi.fn(), blocked = vi.fn()
  await render(<fieldset disabled><legend><UiButton type="button" className="icon-btn" onClick={allowed}>{icon}</UiButton></legend>
    <UiButton type="button" className="icon-only" onClick={blocked}>{icon}</UiButton></fieldset>)
  const buttons = [...host.querySelectorAll('button')]
  await act(async () => buttons.forEach(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))))
  expect(allowed).toHaveBeenCalledTimes(1); expect(blocked).not.toHaveBeenCalled()
})

it.each([false, true])('preserves actual sidebar actions and visible content when collapsed=%s', async collapsed => {
  const navigate = vi.fn(), toggle = vi.fn(), actions = vi.fn()
  await render(<WorkspaceSidebar activeWorkspace="notes" collapsed={collapsed} onChangeWorkspace={navigate}
    onToggleCollapsed={toggle} onOpenSearch={vi.fn()} onOpenLocalActions={actions} />)
  const brand = host.querySelector('[aria-label="返回笔记"]')
  expect(brand.querySelector('.ant-btn-icon img').getAttribute('src')).toBe(APP_ICON_DATA_URL)
  expect(brand.classList.contains('ant-btn-icon-only')).toBe(true)
  const side = host.querySelector(`[aria-label="${collapsed ? '展开侧边栏' : '折叠侧边栏'}"]`)
  expect(side.classList.contains('ant-btn-icon-only')).toBe(true)
  expect(side.textContent).toBe(collapsed ? '›' : '‹')
  const shortcut = host.querySelector('[aria-label="打开快捷操作"]')
  expect(shortcut.querySelectorAll('svg')).toHaveLength(1)
  expect(shortcut.classList.contains('ant-btn-icon-only')).toBe(collapsed)
  expect(shortcut.textContent).toBe(collapsed ? '' : '快捷操作')
  await act(async () => { brand.click(); side.click(); shortcut.click() })
  expect(navigate).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledWith('notes')
  expect(toggle).toHaveBeenCalledTimes(1); expect(actions).toHaveBeenCalledTimes(1)
})
