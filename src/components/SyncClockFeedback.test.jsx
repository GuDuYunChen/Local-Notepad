import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Overview from './SyncOverviewPanel'
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs'
import { SYNC_CLOCK_PREFERENCE_KEY as KEY } from '~/services/syncClockPreference.mjs'
import * as clock from '~/services/syncClock.mjs'
let root, host, input, previousAct, navigate
const feedback = (scope = host) => scope.querySelector('[data-sync-clock-feedback]')
const control = (action, scope = host) => scope.querySelector(`[data-sync-clock-${action}]`)
const local = () => [...host.querySelectorAll('.sync-clock-button')].find(n => n.textContent === '本机时区')
async function render(element = <Overview {...input} onNavigate={navigate}/>) {
  await act(async () => root.render(element))
}
async function click(node) { expect(node).toBeTruthy(); await act(async () => node.click()) }
beforeEach(() => {
  localStorage.removeItem(KEY)
  previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  input = overviewFixture(); navigate = vi.fn(() => true)
  vi.spyOn(clock, 'deviceSyncTimeZone').mockReturnValue('Asia/Shanghai')
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks()
  localStorage.removeItem(KEY); globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
})
it('mounts an empty polite atomic status region without reporting an unsolicited success', async () => {
  const write = vi.spyOn(localStorage, 'setItem'); await render()
  expect(feedback().textContent.trim()).toBe(''); expect(feedback().getAttribute('role')).toBe('status')
  expect(feedback().getAttribute('aria-live')).toBe('polite'); expect(feedback().getAttribute('aria-atomic')).toBe('true')
  for (const action of ['restore', 'save', 'clear']) expect(control(action).getAttribute('aria-controls')).toBe(feedback().id)
  expect(write).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
})
it('reports the confirmed saved mode without moving focus or changing original UTC instants', async () => {
  await render(); await click(local()); const node = feedback(), iso = [...host.querySelectorAll('time')].map(n => n.dateTime)
  control('save').focus(); await click(control('save'))
  expect(feedback()).toBe(node); expect(node.textContent).toContain('本次已回读确认：已记住本机时区')
  expect(localStorage.getItem(KEY)).toBe('local'); expect(document.activeElement).toBe(control('save'))
  expect([...host.querySelectorAll('time')].map(n => n.dateTime)).toEqual(iso); expect(navigate).not.toHaveBeenCalled()
})
it('repeated explicit saves replace the message inside the same region, never during snapshot updates', async () => {
  await render(); await click(control('save')); const region = feedback(), message = region.firstElementChild
  await click(control('save')); expect(feedback()).toBe(region); expect(region.firstElementChild).not.toBe(message)
  const repeated = region.firstElementChild; input.health.lastReadAt += 1000; await render()
  expect(feedback()).toBe(region); expect(region.firstElementChild).toBe(repeated)
})
it('verified clear reports its scope while retaining the active local display and unrelated storage', async () => {
  await render(); await click(local()); await click(control('save')); localStorage.setItem('clock-feedback-sentinel', 'keep')
  control('clear').focus(); await click(control('clear'))
  expect(feedback().textContent).toContain('本次已回读确认：时间偏好已清除')
  expect(local().getAttribute('aria-pressed')).toBe('true'); expect(localStorage.getItem(KEY)).toBeNull()
  expect(localStorage.getItem('clock-feedback-sentinel')).toBe('keep'); expect(document.activeElement).toBe(control('clear'))
  localStorage.removeItem('clock-feedback-sentinel')
})
for (const action of ['save', 'clear']) it(`does not turn a failed ${action} readback into a success message`, async () => {
  await render(); const node = feedback(); vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw Error('PRIVATE_READBACK') })
  await click(control(action)); expect(feedback()).toBe(node)
  expect(node.textContent).toContain('未能确认'); expect(node.textContent).not.toContain('本次已回读确认')
  expect(node.textContent).not.toContain('PRIVATE_READBACK'); expect(node.querySelector('.sync-clock-preference-error')).not.toBeNull()
})
it('repeated read failures refresh only the error message and never erase the selected mode', async () => {
  await render(); await click(local()); const node = feedback()
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw Error('PRIVATE_READ') })
  await click(control('restore')); const message = node.firstElementChild; await click(control('restore'))
  expect(feedback()).toBe(node); expect(node.firstElementChild).not.toBe(message)
  expect(local().getAttribute('aria-pressed')).toBe('true'); expect(node.textContent).toContain('当前显示保持不变')
})
it('read-only recovery replaces an uncertain save result without repeating the write', async () => {
  await render(); const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw Error('PRIVATE_READBACK') })
  await click(control('save')); read.mockRestore(); const write = vi.spyOn(localStorage, 'setItem')
  await click(control('restore')); expect(feedback().querySelector('.sync-clock-preference-error')).toBeNull()
  expect(feedback().textContent).toContain('已读取保存记录'); expect(write).not.toHaveBeenCalled()
})
it('a temporary display change clears the prior success but keeps the region and saved preference', async () => {
  await render(); await click(control('save')); const node = feedback(); await click(local())
  expect(feedback()).toBe(node); expect(node.textContent.trim()).toBe(''); expect(localStorage.getItem(KEY)).toBe('utc')
})
it('distinct instances have distinct controlled regions and do not echo each other actions', async () => {
  await render(<><Overview {...input}/><Overview {...input}/></>); const panels = host.querySelectorAll('.sync-overview')
  expect(feedback(panels[0]).id).not.toBe(feedback(panels[1]).id)
  await click(control('save', panels[0])); expect(feedback(panels[0]).textContent).toContain('本次已回读确认')
  expect(feedback(panels[1]).textContent.trim()).toBe('')
  expect(control('restore', panels[1]).getAttribute('aria-controls')).toBe(feedback(panels[1]).id)
})
it('unavailable local conversion keeps save disabled without fabricating a saved receipt', async () => {
  await render(); clock.deviceSyncTimeZone.mockReturnValue(''); await click(local()); await click(control('save'))
  expect(control('save').disabled).toBe(true); expect(feedback().textContent.trim()).toBe('')
  expect(localStorage.getItem(KEY)).toBeNull(); expect(host.querySelector('.sync-clock-fallback')).not.toBeNull()
})
it('a busy/stale risk banner and disclosure nodes remain intact across preference feedback', async () => {
  input.busy = true; input.health.failures = 1; input.status.last_status = 'review_required'; await render()
  const guidance = host.querySelector('[data-sync-guidance]'), help = host.querySelector('[data-sync-help]')
  const before = guidance.textContent; help.open = true
  await click(control('save')); await click(control('clear')); await click(control('restore'))
  expect(host.querySelector('[data-sync-guidance]')).toBe(guidance); expect(guidance.textContent).toBe(before)
  expect(host.querySelector('[data-sync-help]')).toBe(help); expect(help.open).toBe(true); expect(navigate).not.toHaveBeenCalled()
})
