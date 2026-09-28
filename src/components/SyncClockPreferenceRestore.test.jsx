import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Overview from './SyncOverviewPanel'
import { SYNC_CLOCK_PREFERENCE_KEY as KEY } from '~/services/syncClockPreference.mjs'
import * as clock from '~/services/syncClock.mjs'
import Center from './SyncCenterPanel'
import { api } from '~/services/api'
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs'
import { conflictFixture } from '../../scripts/fixtures/sync-conflict-review.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./SyncActivityPanel', () => ({ default: () => null }))
let root, container, input, navigate, previousAct, settings, status, conflicts, pendingRun
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
const back = (scope = container) => scope.querySelector('[data-sync-help-return]')
const guidance = (scope = container) => scope.querySelector('[data-sync-guidance]')
const shortcut = (scope = container) => scope.querySelector('[data-sync-help-shortcut]')
const help = (scope = container) => scope.querySelector('[data-sync-help]')
const topic = key => help().querySelector(`[data-sync-help-topic="${key}"]`)
const button = text => [...container.querySelectorAll('button')].find(n => n.textContent === text)
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
async function render(element = <Overview {...input} onNavigate={navigate}/>) {
  await act(async () => { root.render(element); await flush() })
}
function assertTopic(key) {
  expect(help().open).toBe(true); expect(topic(key).open).toBe(true)
  expect(document.activeElement).toBe(topic(key).querySelector('summary'))
}
beforeEach(() => {
  localStorage.removeItem(KEY)
  previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  vi.spyOn(clock, 'deviceSyncTimeZone').mockReturnValue('Asia/Shanghai')
  input = overviewFixture(); navigate = vi.fn(() => true)
  settings = { ...input.settings, sync_endpoint: 'https://example.test', sync_username: 'alice' }
  status = { ...input.status, device_id: 'device-a', remote_store_id: 'store' }; conflicts = []; pendingRun = null
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  api.mockImplementation(async (path, init) => {
    const read = !init?.method || init.method === 'GET'
    if (path === '/api/settings' && read) return { ...settings }
    if (path === '/api/sync/status') return { ...status }
    if (path === '/api/sync/conflicts') return [...conflicts]
    if (path === '/api/sync/run') return pendingRun ? new Promise(resolve => { pendingRun.finish = resolve }) : { conflicts: 0 }
    if (path.endsWith('/resolve')) return null
    throw new Error('Unexpected endpoint: ' + path)
  })
})
afterEach(async () => {
  await act(async () => { root.unmount(); await flush() })
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.removeItem(KEY); vi.clearAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
})
const localButton = (scope=container) => [...scope.querySelectorAll('.sync-clock-button')].find(n=>n.textContent==='本机时区')
const utcButton = (scope=container) => [...scope.querySelectorAll('.sync-clock-button')].find(n=>n.textContent==='UTC')
const times = (scope=container) => [...scope.querySelectorAll('.sync-overview time')]

const saveButton = (scope=container) => scope.querySelector('[data-sync-clock-save]')
const clearButton = (scope=container) => scope.querySelector('[data-sync-clock-clear]')
const error = () => container.querySelector('.sync-clock-preference-error')
async function reopen() { await render(null); await render() }
// 2F.21: restore always reads the current key, never the cached last observation.
const restoreButton = (scope=container) => scope.querySelector('[data-sync-clock-restore]')
const comparison = () => container.querySelector('[data-sync-clock-comparison]').textContent
it('distinguishes a temporary mode and restores without saving, clearing or navigating',async()=>{
  localStorage.setItem(KEY,'utc');await render();await click(localButton())
  expect(comparison()).toContain('仅为本次显示');expect(comparison()).toContain('已记住：UTC')
  const write=vi.spyOn(localStorage,'setItem'),remove=vi.spyOn(localStorage,'removeItem'),read=vi.spyOn(localStorage,'getItem')
  const iso=times().map(n=>n.dateTime),banner=guidance().textContent
  restoreButton().focus();await click(restoreButton())
  expect(utcButton().getAttribute('aria-pressed')).toBe('true');expect(read).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledWith(KEY)
  expect(write).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();expect(navigate).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(restoreButton());expect(times().map(n=>n.dateTime)).toEqual(iso);expect(guidance().textContent).toBe(banner)
})
it('uses another instance latest saved choice rather than this instance cached mode',async()=>{
  localStorage.setItem(KEY,'utc');await render(<><Overview {...input}/><Overview {...input}/></>)
  const panels=container.querySelectorAll('.sync-overview')
  await click(localButton(panels[1]));await click(saveButton(panels[1]))
  expect(utcButton(panels[0]).getAttribute('aria-pressed')).toBe('true')
  const write=vi.spyOn(localStorage,'setItem');await click(restoreButton(panels[0]))
  expect(localButton(panels[0]).getAttribute('aria-pressed')).toBe('true');expect(write).not.toHaveBeenCalled()
  expect(localButton(panels[1]).getAttribute('aria-pressed')).toBe('true')
})
it('an externally removed preference does not reset the active temporary display',async()=>{
  localStorage.setItem(KEY,'utc');await render();await click(localButton());localStorage.removeItem(KEY)
  const write=vi.spyOn(localStorage,'setItem'),remove=vi.spyOn(localStorage,'removeItem');await click(restoreButton())
  expect(localButton().getAttribute('aria-pressed')).toBe('true');expect(comparison()).toContain('未记住选择')
  expect(container.querySelector('.sync-clock-preference-receipt').textContent).toContain('没有已保存')
  expect(write).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled()
})
it('invalid external values preserve the active mode and are neither echoed nor deleted',async()=>{
  await render();await click(localButton());localStorage.setItem(KEY,'PRIVATE_<img src=x>')
  const remove=vi.spyOn(localStorage,'removeItem');await click(restoreButton())
  expect(localButton().getAttribute('aria-pressed')).toBe('true');expect(error().textContent).toContain('当前显示保持不变')
  expect(error().textContent).not.toContain('打开时已使用 UTC');expect(comparison()).toContain('尚未核实')
  expect(container.textContent).not.toContain('PRIVATE');expect(remove).not.toHaveBeenCalled()
})
it('failed readonly restore preserves selection and retries only after another explicit click',async()=>{
  await render();await click(localButton());localStorage.setItem(KEY,'utc')
  const read=vi.spyOn(localStorage,'getItem').mockImplementation(()=>{throw Error('PRIVATE_READ')})
  await click(restoreButton());expect(localButton().getAttribute('aria-pressed')).toBe('true')
  expect(error().textContent).toContain('未能读取');expect(container.textContent).not.toContain('PRIVATE_READ')
  input.health.lastReadAt+=60000;await render();expect(read).toHaveBeenCalledTimes(1)
  read.mockRestore();await click(restoreButton());expect(utcButton().getAttribute('aria-pressed')).toBe('true');expect(error()).toBeNull()
})
it('restoring local resolves the device timezone again but does not rewrite the mode',async()=>{
  localStorage.setItem(KEY,'local');await render();await click(utcButton());clock.deviceSyncTimeZone.mockReturnValue('Asia/Kathmandu')
  const write=vi.spyOn(localStorage,'setItem');await click(restoreButton())
  expect(container.querySelector('.sync-clock-zone').textContent).toBe('Asia/Kathmandu');expect(write).not.toHaveBeenCalled()
})
it('restored local with unavailable timezone explicitly falls back instead of claiming local success',async()=>{
  await render();localStorage.setItem(KEY,'local');clock.deviceSyncTimeZone.mockReturnValue('');await click(restoreButton())
  expect(container.querySelector('.sync-clock-fallback')).not.toBeNull();expect(comparison()).toContain('当前实际显示 UTC')
  expect(saveButton().disabled).toBe(true);for(const t of times())expect(t.textContent).toBe(t.dateTime)
  expect(localStorage.getItem(KEY)).toBe('local');expect(api).not.toHaveBeenCalled()
})
it('readback uncertainty after a completed write can be resolved without another write',async()=>{
  await render();await click(localButton());const read=vi.spyOn(localStorage,'getItem').mockImplementation(()=>{throw Error('READBACK')})
  await click(saveButton());expect(error()).not.toBeNull();read.mockRestore()
  const write=vi.spyOn(localStorage,'setItem');await click(restoreButton())
  expect(error()).toBeNull();expect(comparison()).toContain('一致');expect(write).not.toHaveBeenCalled()
})
it('readonly restore retains help nodes, open state and updated provenance',async()=>{
  await render();await click(shortcut());const h=help(),t=topic('operations');localStorage.setItem(KEY,'local')
  input.health.failures=1;await render();const banner=guidance().textContent;await click(restoreButton())
  expect(help()).toBe(h);expect(h.open).toBe(true);expect(topic('operations')).toBe(t);expect(t.open).toBe(true)
  expect(guidance().textContent).toBe(banner);expect(container.textContent).toContain('上次读取结果');expect(navigate).not.toHaveBeenCalled()
})
it('readonly restore preserves reviewed conflict consent and diagnostic text in the real center',async()=>{
  conflicts=[conflictFixture()];status.open_conflicts=1;status.last_status='conflicts';await render(<Center/>)
  await click(button('保留本机'));await click(container.querySelector('input[type="checkbox"]'));await click(button('生成诊断摘要'))
  const d=container.querySelector('textarea'),text=d.value,calls=api.mock.calls.length;localStorage.setItem(KEY,'local');await click(restoreButton())
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true);expect(d.value).toBe(text);expect(api.mock.calls).toHaveLength(calls)
})
it('readonly restore neither clears private drafts nor starts a second pending sync',async()=>{
  await render(<Center/>);await act(async()=>{
    const n=container.querySelector('[aria-label="WebDAV 密码"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'PRIVATE_RESTORE_DRAFT')
    n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));await flush()
  })
  let calls=api.mock.calls.length;localStorage.setItem(KEY,'local');await click(restoreButton())
  expect(container.querySelector('[aria-label="WebDAV 密码"]').value).toBe('PRIVATE_RESTORE_DRAFT');expect(api.mock.calls).toHaveLength(calls)
  await render(null);pendingRun={};await render(<Center/>);await click(button('执行同步'));calls=api.mock.calls.length
  await click(restoreButton());expect(button('同步中…').disabled).toBe(true);expect(api.mock.calls).toHaveLength(calls)
  await act(async()=>{pendingRun.finish({conflicts:0});await flush()})
})
