import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Pair from './S3OfflineReportPair.jsx'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'
let host, root, readers
const raw = () => JSON.stringify(reportFixture())
const file = text => new File([text ?? raw()], 'PRIVATE_name.json', { type: 'application/json' })
const flush = async () => { for (let i=0;i<10;i++) await Promise.resolve() }
const state = side => host.querySelector(`[data-offline-side=${side}] [data-offline-state]`).getAttribute('data-offline-state')
const rows = () => [...host.querySelectorAll('[data-offline-result] tbody tr')]
const click = selector => act(async () => { host.querySelector(selector).click(); await flush() })
const render = async () => { await act(async () => { root.render(<StrictMode><Pair /></StrictMode>); await flush() }); await act(async () => { host.querySelector('details').open = true; await flush() }) }
const select = (side, values = [file()]) => act(async () => {
  const input = host.querySelector(`[data-offline-side=${side}] input`)
  Object.defineProperty(input, 'files', { configurable: true, value: values })
  input.dispatchEvent(new Event('change', { bubbles: true })); await flush()
})
const load = (index, text=raw()) => act(async () => { const r=readers[index];r.result=new TextEncoder().encode(text).buffer;r.onload?.();await flush() })
const ready = async () => { await select('a');await select('b');await load(0);await load(1) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);readers=[]
  vi.stubGlobal('FileReader',class{constructor(){readers.push(this)}readAsArrayBuffer(value){this.file=value}abort(){this.aborted=true}})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('offline pair UI mounts without reading and labels both native file controls',async()=>{
  await render();expect(readers).toHaveLength(0);expect(host.querySelector('[data-offline-compare]').disabled).toBe(true)
  expect(host.querySelectorAll('input[type=file]')).toHaveLength(2)
  for(const input of host.querySelectorAll('input'))expect(host.querySelector(`label[for="${input.id}"]`)).not.toBeNull()
  expect(host.textContent).toContain('无需读取本地统计');expect(rows()).toHaveLength(0)
})
it('offline pair UI requires two complete files and an explicit compare click',async()=>{
  await render();await ready();expect(rows()).toHaveLength(0);await click('[data-offline-compare]')
  expect(rows()).toHaveLength(12);expect(rows().every(r=>r.cells[3].textContent==='0')).toBe(true)
  expect(host.textContent).toContain('0 / 12');expect(host.textContent).not.toContain('PRIVATE_name')
})
it('offline pair UI keeps independently pending reads and does not auto compare',async()=>{
  await render();await select('a');await select('b');await load(1)
  expect(state('a')).toBe('reading');expect(state('b')).toBe('ready');expect(host.querySelector('[data-offline-compare]').disabled).toBe(true)
  await load(0);expect(state('b')).toBe('ready');expect(rows()).toHaveLength(0)
})
it('offline pair UI clears confirmation before accepted replacement or malformed data',async()=>{
  await render();await ready();await click('[data-offline-compare]');await select('a',[file('{')])
  expect(rows()).toHaveLength(0);expect(state('a')).toBe('reading');await load(2,'{');expect(state('a')).toBe('failed')
  expect(state('b')).toBe('ready');expect(host.querySelector('[data-offline-compare]').disabled).toBe(true)
})
it('offline pair UI cancelling the picker preserves a confirmed view',async()=>{
  await render();await ready();await click('[data-offline-compare]');const text=host.querySelector('[data-offline-result]').textContent
  await select('a',[]);expect(host.querySelector('[data-offline-result]').textContent).toBe(text);expect(readers).toHaveLength(2)
})
it('offline pair UI rejects multiple file selection without silently choosing the first',async()=>{
  await render();await ready();await click('[data-offline-compare]');await select('b',[file(),file()])
  expect(readers).toHaveLength(2);expect(rows()).toHaveLength(12);expect(host.textContent).toContain('每侧只能选择一份报告')
})
it('offline pair UI swapping revokes confirmation and reverses the fixed B minus A direction',async()=>{
  const b=reportFixture();b.records++;b.recordBytes++;b.kinds[0].records++;b.kinds[0].recordBytes++
  await render();await select('a');await select('b');await load(0);await load(1,JSON.stringify(b));await click('[data-offline-compare]')
  expect(rows()[0].cells[3].textContent).toBe('+1');await click('[data-offline-swap]');expect(rows()).toHaveLength(0)
  await click('[data-offline-compare]');expect(rows()[0].cells[3].textContent).toBe('-1');expect(readers).toHaveLength(2)
})
it('offline pair UI clearing one report preserves the other and prevents stale output',async()=>{
  await render();await ready();await click('[data-offline-compare]');await click('[data-offline-side=a] button')
  expect(state('a')).toBe('idle');expect(state('b')).toBe('ready');expect(rows()).toHaveLength(0)
})
it('offline pair UI ignores a saved completion after A-B-A replacement',async()=>{
  await render();const a=file();await select('a',[a]);const late=readers[0].onload;await select('a');await select('a',[a])
  readers[0].result=new TextEncoder().encode(raw()).buffer;await act(async()=>{late();await flush()})
  expect(state('a')).toBe('reading');expect(readers[0].aborted).toBe(true);expect(readers[1].aborted).toBe(true)
  await load(2);expect(state('a')).toBe('ready');expect(rows()).toHaveLength(0)
})
it('offline pair UI stops both readers and rejects queued callbacks on clear',async()=>{
  await render();await select('a');await select('b');const late=readers[0].onload;await click('[data-offline-reset]')
  readers[0].result=new TextEncoder().encode(raw()).buffer;await act(async()=>{late();await flush()})
  expect(state('a')).toBe('idle');expect(state('b')).toBe('idle');expect(readers.every(r=>r.aborted)).toBe(true)
})
it('offline pair UI keeps the five-second timeout and never retries',async()=>{
  vi.useFakeTimers();await render();await select('a');await act(async()=>{vi.advanceTimersByTime(5000);await flush()})
  expect(state('a')).toBe('failed');expect(readers).toHaveLength(1);expect(readers[0].aborted).toBe(true);expect(rows()).toHaveLength(0)
})
it('offline pair UI unmount revokes old tasks before a fresh mount',async()=>{
  await render();await select('a');const late=readers[0].onload
  await act(async()=>root.render(null));await render();readers[0].result=new TextEncoder().encode(raw()).buffer
  await act(async()=>{late();await flush()});expect(state('a')).toBe('idle');expect(readers[0].aborted).toBe(true)
})
it('offline pair UI closing the panel clears selections and comparison without reading',async()=>{
  await render();await ready();await click('[data-offline-compare]')
  await act(async()=>{const d=host.querySelector('details');d.open=false;d.dispatchEvent(new Event('toggle'));await flush()})
  expect(state('a')).toBe('idle');expect(state('b')).toBe('idle');expect(rows()).toHaveLength(0);expect(readers).toHaveLength(2)
})
it('offline pair UI cannot leak drop events into ordinary note imports',async()=>{
  const parent=vi.fn();await act(async()=>root.render(<div onDrop={parent}><Pair/></div>))
  let event;await act(async()=>{event=new Event('drop',{bubbles:true,cancelable:true});host.querySelector('[data-offline-pair]').dispatchEvent(event);await flush()})
  expect(event.defaultPrevented).toBe(true);expect(parent).not.toHaveBeenCalled();expect(readers).toHaveLength(0)
})
it('offline pair UI neither scans nor persists when files are compared',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch'),storage=vi.spyOn(Storage.prototype,'setItem'),native=vi.fn()
  const old=Object.getOwnPropertyDescriptor(window,'electronAPI');Object.defineProperty(window,'electronAPI',{configurable:true,value:{s3LocalOverviewRead:native}})
  try{await render();await ready();await click('[data-offline-compare]');expect(fetch).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();expect(native).not.toHaveBeenCalled()}
  finally{if(old)Object.defineProperty(window,'electronAPI',old);else delete window.electronAPI}
})
