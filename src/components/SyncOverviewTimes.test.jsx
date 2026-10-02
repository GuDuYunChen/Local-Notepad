import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Overview from './SyncOverviewPanel'
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
  container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
})
const localButton = (scope=container) => [...scope.querySelectorAll('.sync-clock-button')].find(n=>n.textContent==='本机时区')
const utcButton = (scope=container) => [...scope.querySelectorAll('.sync-clock-button')].find(n=>n.textContent==='UTC')
const times = (scope=container) => [...scope.querySelectorAll('.sync-overview time')]
it('keeps UTC as the initial display with canonical semantic time values',async()=>{
  await render(<React.StrictMode><Overview {...input}/></React.StrictMode>)
  expect(utcButton().getAttribute('aria-pressed')).toBe('true');expect(clock.deviceSyncTimeZone).not.toHaveBeenCalled()
  for(const time of times())expect(time.textContent).toBe(time.dateTime)
  expect(times()).toHaveLength(2);expect(help().open).toBe(false);expect(api).not.toHaveBeenCalled()
})
it('changes only timestamp presentation and can return to exact UTC',async()=>{
  await render();const banner=guidance().textContent,iso=times().map(n=>n.dateTime)
  await click(localButton());expect(localButton().getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.sync-clock-zone').textContent).toBe('Asia/Shanghai')
  for(const n of times()){expect(n.textContent).toContain('GMT+08:00');expect(n.title).toContain(n.dateTime)}
  expect(times().map(n=>n.dateTime)).toEqual(iso);expect(guidance().textContent).toBe(banner)
  await click(utcButton());expect(times().map(n=>n.textContent)).toEqual(iso)
  expect(navigate).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled()
})
it('preserves local selection and focused control when the parent snapshot changes',async()=>{
  await render();await click(localButton());const control=localButton();control.focus()
  input.health.lastReadAt+=60000;input.health.failures=1;input.status.last_status='review_required';input.status.recovery.mode='blocked'
  await render();expect(localButton()).toBe(control);expect(document.activeElement).toBe(control)
  expect(localButton().getAttribute('aria-pressed')).toBe('true');expect(container.textContent).toContain('先核查写入结果')
  expect(container.textContent).toContain('状态依据：上次读取结果');expect(container.textContent).toContain('恢复保护阻断')
  expect(times()[1].dateTime).toBe(new Date(input.health.lastReadAt).toISOString())
  expect(clock.deviceSyncTimeZone).toHaveBeenCalledTimes(1);expect(navigate).not.toHaveBeenCalled()
})
it('two mounted overviews have independent modes',async()=>{
  await render(<><Overview {...input}/><Overview {...input}/></>);const panels=container.querySelectorAll('.sync-overview')
  await click(localButton(panels[1]));expect(utcButton(panels[0]).getAttribute('aria-pressed')).toBe('true')
  expect(localButton(panels[1]).getAttribute('aria-pressed')).toBe('true');expect(api).not.toHaveBeenCalled()
})
it('unread facts stay unknown and absent after selecting local time',async()=>{
  input.health.lastReadAt=0;await render();await click(localButton())
  expect(container.querySelectorAll('dd')[0].textContent).toBe('未知');expect(container.querySelectorAll('dd')[2].textContent).toBe('尚无记录')
  expect(times()).toHaveLength(0);expect(container.textContent).toContain('尚无可核实的读取结果')
})
it('unsupported local zone keeps exact UTC with an explicit fallback and no raw error',async()=>{
  clock.deviceSyncTimeZone.mockReturnValue('PRIVATE_<script>');await render();const iso=times().map(n=>n.dateTime)
  await click(localButton());expect(container.textContent).toContain('本机时区显示不可用，已保留 UTC 时间')
  expect(times().map(n=>n.textContent)).toEqual(iso);expect(container.textContent).not.toContain('PRIVATE')
  await click(utcButton());expect(container.querySelector('.sync-clock-fallback')).toBeNull();expect(api).not.toHaveBeenCalled()
})
it('help navigation and return do not reset the selected time display',async()=>{
  await render();await click(localButton());await click(shortcut());assertTopic('operations');await click(back())
  expect(document.activeElement).toBe(guidance());expect(localButton().getAttribute('aria-pressed')).toBe('true')
  expect(topic('operations').open).toBe(true);expect(api).not.toHaveBeenCalled()
})
it('time conversion does not save unsaved credentials or release draft protection',async()=>{
  await render(<Center/>);await act(async()=>{
    for(const [label,value] of [['WebDAV 端点','https://unsaved.test'],['WebDAV 密码','PRIVATE_DRAFT']]){
      const n=container.querySelector(`[aria-label="${label}"]`)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value)
      n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}))
    }await flush()
  })
  const count=api.mock.calls.length;await click(localButton());await click(utcButton())
  expect(api.mock.calls).toHaveLength(count);expect(container.querySelector('[aria-label="WebDAV 密码"]').value).toBe('PRIVATE_DRAFT')
  expect(button('预演同步').disabled).toBe(true);expect(container.querySelector('.sync-overview').textContent).not.toContain('PRIVATE_DRAFT')
})
it('diagnostic text remains byte-for-byte UTC based while the overview changes',async()=>{
  await render(<Center/>);await click(button('生成诊断摘要'));const n=container.querySelector('textarea'),text=n.value,count=api.mock.calls.length
  await click(localButton());expect(container.querySelector('textarea')).toBe(n);expect(n.value).toBe(text);expect(api.mock.calls).toHaveLength(count)
})
it('changing time display preserves conflict consent and never resolves automatically',async()=>{
  conflicts=[conflictFixture()];status.open_conflicts=1;status.last_status='conflicts'
  await render(<Center/>);await click(button('保留本机'));await click(container.querySelector('input[type="checkbox"]'))
  const preview=container.querySelector('[aria-label="本机正文预览"]'),count=api.mock.calls.length
  await click(localButton());expect(container.querySelector('input[type="checkbox"]').checked).toBe(true)
  expect(container.querySelector('[aria-label="本机正文预览"]')).toBe(preview);expect(api.mock.calls).toHaveLength(count)
})
it('a pending write remains single and locked while switching time modes',async()=>{
  pendingRun={};await render(<Center/>);await click(button('执行同步'));const count=api.mock.calls.length
  await click(localButton());await click(utcButton());expect(button('同步中…').disabled).toBe(true);expect(api.mock.calls).toHaveLength(count)
  expect(api.mock.calls.filter(([p])=>p==='/api/sync/run')).toHaveLength(1)
  await act(async()=>{pendingRun.finish({conflicts:0});await flush()})
})
