import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Report from './S3LocalOverviewReport.jsx'
import Panel from './S3LocalOverviewPanel.jsx'
import { localOverviewSuccess } from '../../scripts/s3-local-overview-binding-cases.mjs'
let host, root, write, native, clipboardDescriptor, bridgeDescriptor, createDescriptor, revokeDescriptor
const data = () => localOverviewSuccess().data
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve() }
const render = (summary, content) => act(async () => root.render(<StrictMode>{content || <Report summary={summary}/>}</StrictMode>))
const click = selector => act(async () => { host.querySelector(selector).click(); await flush() })
const status = () => host.querySelector('[data-local-report-status]')?.getAttribute('data-local-report-status')
const restore = (object, key, descriptor) => { if (descriptor) Object.defineProperty(object,key,descriptor); else delete object[key] }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');bridgeDescriptor=Object.getOwnPropertyDescriptor(window,'electronAPI')
  createDescriptor=Object.getOwnPropertyDescriptor(URL,'createObjectURL');revokeDescriptor=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL')
  write=vi.fn(async()=>{});native=vi.fn(async()=>localOverviewSuccess())
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:write}})
  Object.defineProperty(window,'electronAPI',{configurable:true,value:{s3LocalOverviewRead:native}})
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:owned-report')})
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{
  await act(async()=>root.unmount());host.remove()
  restore(navigator,'clipboard',clipboardDescriptor);restore(window,'electronAPI',bridgeDescriptor)
  restore(URL,'createObjectURL',createDescriptor);restore(URL,'revokeObjectURL',revokeDescriptor)
  vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()
})
it('inventory report UI mounts in StrictMode without reading, copying or downloading',async()=>{
  await render(data());expect(write).not.toHaveBeenCalled();expect(native).not.toHaveBeenCalled();expect(URL.createObjectURL).not.toHaveBeenCalled();expect(status()).toBe('')
})
it('inventory report UI copies only the existing statistics with truthful scope',async()=>{
  await render(data());await click('[data-local-report-copy]');expect(write).toHaveBeenCalledTimes(1)
  expect(write.mock.calls[0][0]).toContain('不是读取完成时间');expect(write.mock.calls[0][0]).toContain('不含正文、文件名、路径或凭据')
  expect(status()).toBe('copied');expect(native).not.toHaveBeenCalled()
})
it('inventory report UI rejects duplicate clicks before the React render commits',async()=>{
  const d=deferred();write.mockReturnValue(d.promise);await render(data())
  await act(async()=>{const b=host.querySelector('[data-local-report-copy]');b.click();b.click();await flush()})
  expect(write).toHaveBeenCalledTimes(1);expect(status()).toBe('copying')
  expect(host.querySelector('[data-local-report-download]').disabled).toBe(true)
  await act(async()=>{d.resolve();await flush()});expect(status()).toBe('copied')
})
it('inventory report UI never turns a rejected clipboard write into success or private error text',async()=>{
  write.mockRejectedValue(Error('PRIVATE_PERMISSION'));await render(data());await click('[data-local-report-copy]')
  expect(status()).toBe('copy-unconfirmed');expect(host.textContent).not.toContain('PRIVATE_PERMISSION')
})
it('inventory report UI cannot copy malformed partial statistics',async()=>{
  const s=data();s.records++;await render(s);await click('[data-local-report-copy]')
  expect(status()).toBe('invalid-report');expect(write).not.toHaveBeenCalled()
})
it('inventory report UI shows an export alternative when clipboard API is absent',async()=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});await render(data());await click('[data-local-report-copy]')
  expect(status()).toBe('copy-unconfirmed');expect(host.querySelector('[data-local-report-download]').disabled).toBe(false)
})
it('inventory report UI invalidates completed feedback across A-B-A but preserves ordinary rerenders',async()=>{
  const a=data(),b=data();await render(a);await click('[data-local-report-copy]');await render(a);expect(status()).toBe('copied')
  await render(b);await render(a);expect(status()).toBe('');expect(write).toHaveBeenCalledTimes(1)
})
it('inventory report UI ignores a late completion after A-B-A',async()=>{
  const d=deferred();write.mockReturnValue(d.promise);const a=data();await render(a);await click('[data-local-report-copy]')
  await render(data());await render(a);await act(async()=>{d.resolve();await flush()});expect(status()).toBe('')
})
it('inventory report UI keeps a pending clipboard slot across unmount and remount',async()=>{
  const d=deferred();write.mockReturnValueOnce(d.promise);await render(data());await click('[data-local-report-copy]')
  await act(async()=>root.render(null));await render(data());await click('[data-local-report-copy]')
  expect(status()).toBe('copy-busy');expect(write).toHaveBeenCalledTimes(1)
  await act(async()=>{d.resolve();await flush()});expect(status()).toBe('copy-busy')
  await click('[data-local-report-copy]');expect(status()).toBe('copied');expect(write).toHaveBeenCalledTimes(2)
})
it('inventory report UI timeout never cancels or repeats the OS operation and ignores late success',async()=>{
  vi.useFakeTimers();const d=deferred();write.mockReturnValue(d.promise);await render(data());await click('[data-local-report-copy]')
  await act(async()=>{vi.advanceTimersByTime(5000);await flush()});expect(status()).toBe('copy-timeout')
  await click('[data-local-report-copy]');expect(status()).toBe('copy-busy');expect(write).toHaveBeenCalledTimes(1)
  await act(async()=>{d.resolve();await flush()});expect(status()).toBe('copy-busy')
})
it('inventory report UI requests a bounded JSON download and does not claim a saved file',async()=>{
  vi.useFakeTimers();const clicked=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
  await render(data());await click('[data-local-report-download]')
  expect(clicked).toHaveBeenCalledTimes(1);expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  expect(status()).toBe('download-requested');expect(host.textContent).toContain('尚未确认落盘');expect(native).not.toHaveBeenCalled()
  expect(document.querySelector('a[download]')).toBeNull()
  await act(async()=>{vi.advanceTimersByTime(1000);await flush()});expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-report')
})
it('inventory report UI download failures retain statistics without leaking errors',async()=>{
  vi.useFakeTimers();vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{throw Error('PRIVATE_PATH')})
  await render(data());await click('[data-local-report-download]');expect(status()).toBe('download-failed');expect(host.textContent).not.toContain('PRIVATE_PATH')
  await act(async()=>{vi.advanceTimersByTime(1000);await flush()})
})
it('inventory report UI disables unavailable reports and its buttons do not submit forms',async()=>{
  await render(null);expect([...host.querySelectorAll('button')].every(b=>b.disabled)).toBe(true)
  const submit=vi.fn(e=>e.preventDefault());await render(null,<form onSubmit={submit}><Report summary={data()}/></form>)
  await click('[data-local-report-copy]');expect(submit).not.toHaveBeenCalled()
  const button=host.querySelector('[data-local-report-copy]');expect(document.getElementById(button.getAttribute('aria-describedby'))).not.toBeNull()
})
it('inventory report production panel exposes output only after explicit successful read and removes it while rereading',async()=>{
  await render(null,<Panel/>);expect(host.querySelector('[data-local-report]')).toBeNull();expect(native).not.toHaveBeenCalled()
  await click('[data-local-inventory] button');expect(host.querySelector('[data-local-report]')).not.toBeNull()
  await click('[data-local-report-copy]');expect(native).toHaveBeenCalledTimes(1)
  const d=deferred();native.mockReturnValue(d.promise);await click('[data-local-inventory] button');expect(host.querySelector('[data-local-report]')).toBeNull()
  await act(async()=>{d.resolve(localOverviewSuccess());await flush()});expect(status()).toBe('');expect(native).toHaveBeenCalledTimes(2)
})
