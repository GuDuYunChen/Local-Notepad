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
it('StrictMode reads the preference but never saves or clears at mount', async () => {
  const write=vi.spyOn(localStorage,'setItem'),remove=vi.spyOn(localStorage,'removeItem')
  await render(<React.StrictMode><Overview {...input}/></React.StrictMode>)
  expect(utcButton().getAttribute('aria-pressed')).toBe('true')
  expect(clock.deviceSyncTimeZone).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled()
  expect(container.querySelector('[data-sync-clock-preference]').open).toBe(false)
})
it('temporary switching does not write; explicit remember stores only the mode',async()=>{
  await render();const write=vi.spyOn(localStorage,'setItem'),banner=guidance().textContent
  await click(localButton());expect(write).not.toHaveBeenCalled()
  await click(saveButton());expect(write).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledWith(KEY,'local')
  expect(guidance().textContent).toBe(banner);expect(error()).toBeNull();expect(api).not.toHaveBeenCalled();expect(navigate).not.toHaveBeenCalled()
})
it('reopening restores the mode but resolves the current device timezone again',async()=>{
  await render();await click(localButton());await click(saveButton());const iso=times().map(n=>n.dateTime)
  clock.deviceSyncTimeZone.mockReturnValue('America/Los_Angeles');await reopen()
  expect(localButton().getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.sync-clock-zone').textContent).toBe('America/Los_Angeles')
  expect(times().map(n=>n.dateTime)).toEqual(iso);expect(localStorage.getItem(KEY)).toBe('local')
})
it('a temporary change does not replace the remembered mode without explicit save',async()=>{
  localStorage.setItem(KEY,'local');await render();await click(utcButton());expect(localStorage.getItem(KEY)).toBe('local')
  await reopen();expect(localButton().getAttribute('aria-pressed')).toBe('true')
  await click(utcButton());await click(saveButton());await reopen();expect(utcButton().getAttribute('aria-pressed')).toBe('true')
})
it('clear affects only this preference, preserves current selection and defaults next mount to UTC',async()=>{
  localStorage.setItem('clock-test-other-key','keep');localStorage.setItem(KEY,'local');await render();await click(clearButton())
  expect(localStorage.getItem(KEY)).toBeNull();expect(localStorage.getItem('clock-test-other-key')).toBe('keep')
  expect(localButton().getAttribute('aria-pressed')).toBe('true');await reopen();expect(utcButton().getAttribute('aria-pressed')).toBe('true')
  localStorage.removeItem('clock-test-other-key')
})
it('invalid stored content is not rendered, executed or automatically deleted',async()=>{
  localStorage.setItem(KEY,'PRIVATE_<script>alert(1)</script>');const remove=vi.spyOn(localStorage,'removeItem')
  await render();expect(utcButton().getAttribute('aria-pressed')).toBe('true');expect(error().textContent).toContain('无法识别')
  expect(container.textContent).not.toContain('PRIVATE');expect(remove).not.toHaveBeenCalled();expect(container.querySelector('script,img')).toBeNull()
  await click(saveButton());expect(localStorage.getItem(KEY)).toBe('utc');expect(error()).toBeNull()
})
it('a throwing storage getter falls back without blocking local display or leaking errors',async()=>{
  vi.stubGlobal('localStorage', { getItem(){throw Error('PRIVATE_READ')},setItem(){throw Error('PRIVATE_WRITE')},removeItem(){throw Error('PRIVATE_CLEAR')} })
  await render();expect(error().textContent).toContain('无法读取');await click(localButton());await click(saveButton())
  expect(localButton().getAttribute('aria-pressed')).toBe('true');expect(error().textContent).toContain('未能确认时间偏好已保存')
  expect(container.textContent).not.toContain('PRIVATE');expect(api).not.toHaveBeenCalled()
})
it('failed save preserves the current mode and only an explicit retry can confirm saving',async()=>{
  await render();await click(localButton());const write=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw Error('PRIVATE')})
  await click(saveButton());expect(error().textContent).toContain('未能确认');expect(localButton().getAttribute('aria-pressed')).toBe('true')
  input.health.lastReadAt+=60000;await render();expect(write).toHaveBeenCalledTimes(1)
  write.mockRestore();await click(saveButton());expect(error()).toBeNull();expect(localStorage.getItem(KEY)).toBe('local')
})
it('failed clearing is not reported as successful and can be retried',async()=>{
  localStorage.setItem(KEY,'local');await render();const remove=vi.spyOn(localStorage,'removeItem').mockImplementation(()=>{throw Error('PRIVATE')})
  await click(clearButton());expect(error().textContent).toContain('未能确认时间偏好已清除');expect(localStorage.getItem(KEY)).toBe('local')
  remove.mockRestore();await click(clearButton());expect(error()).toBeNull();expect(localStorage.getItem(KEY)).toBeNull()
})
it('saved local mode with unavailable Intl keeps UTC visible and can still be cleared',async()=>{
  localStorage.setItem(KEY,'local');clock.deviceSyncTimeZone.mockReturnValue('');await render()
  expect(container.querySelector('.sync-clock-fallback')).not.toBeNull();expect(saveButton().disabled).toBe(true)
  for(const n of times())expect(n.textContent).toBe(n.dateTime)
  await click(clearButton());expect(localStorage.getItem(KEY)).toBeNull();expect(api).not.toHaveBeenCalled()
})
it('remembering never changes another mounted overview or closes help during snapshot updates',async()=>{
  await render(<><Overview {...input}/><Overview {...input}/></>);const panels=container.querySelectorAll('.sync-overview')
  await click(localButton(panels[0]));await click(saveButton(panels[0]));expect(utcButton(panels[1]).getAttribute('aria-pressed')).toBe('true')
  await render();await click(shortcut());const openHelp=help(),openTopic=topic('operations');await click(back())
  const write=vi.spyOn(localStorage,'setItem');input.health.failures=1;await render()
  expect(help()).toBe(openHelp);expect(openHelp.open).toBe(true);expect(openTopic.open).toBe(true);expect(write).not.toHaveBeenCalled()
})
it('saving and clearing a time preference preserves private drafts and preview protection',async()=>{
  await render(<Center/>);await act(async()=>{
    for(const [label,value] of [['WebDAV 端点','https://draft.test'],['WebDAV 密码','PRIVATE_DRAFT']]){
      const n=container.querySelector(`[aria-label="${label}"]`)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value)
      n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}))
    }await flush()
  })
  const count=api.mock.calls.length;await click(localButton());await click(saveButton());await click(clearButton())
  expect(api.mock.calls).toHaveLength(count);expect(container.querySelector('[aria-label="WebDAV 密码"]').value).toBe('PRIVATE_DRAFT')
  expect(button('预演同步').disabled).toBe(true);expect(localStorage.getItem(KEY)).toBeNull()
})
it('diagnostic snapshot and reviewed conflict consent are unchanged by remembering or clearing',async()=>{
  conflicts=[conflictFixture()];status.open_conflicts=1;status.last_status='conflicts';await render(<Center/>)
  await click(button('保留本机'));await click(container.querySelector('input[type="checkbox"]'));await click(button('生成诊断摘要'))
  const diagnostic=container.querySelector('textarea'),text=diagnostic.value,count=api.mock.calls.length
  await click(localButton());await click(saveButton());await click(clearButton())
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true);expect(container.querySelector('textarea')).toBe(diagnostic)
  expect(diagnostic.value).toBe(text);expect(api.mock.calls).toHaveLength(count)
})
it('a pending sync remains single and locked while the display preference is written',async()=>{
  pendingRun={};await render(<Center/>);await click(button('执行同步'));const count=api.mock.calls.length
  await click(localButton());await click(saveButton());await click(clearButton());expect(button('同步中…').disabled).toBe(true)
  expect(api.mock.calls).toHaveLength(count);expect(api.mock.calls.filter(([p])=>p==='/api/sync/run')).toHaveLength(1)
  await act(async()=>{pendingRun.finish({conflicts:0});await flush()})
})
