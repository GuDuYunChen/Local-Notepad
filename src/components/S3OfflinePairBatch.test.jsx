import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Pair from './S3OfflineReportPair.jsx'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'
let host,root,readers,contents
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve()}
const file=(text=JSON.stringify(reportFixture()))=>{const f=new File([text],'PRIVATE.json',{type:'application/json'});contents.set(f,text);return f}
const changed=()=>{const r=reportFixture();r.records++;r.recordBytes++;r.kinds[0].records++;r.kinds[0].recordBytes++;return file(JSON.stringify(r))}
const state=side=>host.querySelector(`[data-offline-side=${side}] [data-offline-state]`).getAttribute('data-offline-state')
const rows=()=>[...host.querySelectorAll('[data-offline-result] tbody tr')]
const busy=()=>host.querySelector('[data-offline-batch-reading]')?.getAttribute('data-offline-batch-reading')==='true'
const click=selector=>act(async()=>{host.querySelector(selector).click();await flush()})
const render=async()=>{
  await act(async()=>root.render(<StrictMode><Pair/></StrictMode>))
  await act(async()=>{host.querySelector('[data-offline-pair]').open=true;await flush()})
  await click('[data-offline-batch-toggle]')
}
const select=(selector,files)=>act(async()=>{
  const input=host.querySelector(selector);Object.defineProperty(input,'files',{configurable:true,value:files})
  input.dispatchEvent(new Event('change',{bubbles:true}));await flush()
})
const batch=files=>select('[data-offline-batch-input]',files)
const load=index=>act(async()=>{const r=readers[index];expect(contents.has(r.file)).toBe(true);r.result=new TextEncoder().encode(contents.get(r.file)).buffer;r.onload?.();await flush()})
const ready=async()=>{await batch([file(),changed()]);await load(readers.length-2);await load(readers.length-1);await click('[data-offline-compare]')}
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);readers=[];contents=new Map()
  vi.stubGlobal('FileReader',class{constructor(){readers.push(this)}readAsArrayBuffer(f){this.file=f}abort(){this.aborted=true}})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('offline batch starts only on explicit multi-file selection with labelled retained side inputs',async()=>{
  await render();expect(readers).toHaveLength(0)
  expect(host.querySelector('[data-offline-batch-input]').multiple).toBe(true)
  expect(host.querySelectorAll('[data-offline-side] input[type=file]')).toHaveLength(2)
  for(const input of host.querySelectorAll('input[type=file]'))expect(host.querySelector(`label[for="${input.id}"]`)).not.toBeNull()
  expect(host.textContent).toContain('不代表时间先后')
})
it('offline batch adopts both reports together and requires explicit B-minus-A confirmation',async()=>{
  await render();await batch([file(),changed()]);expect(busy()).toBe(true)
  await load(1);expect(state('a')).toBe('idle');expect(state('b')).toBe('idle');expect(rows()).toHaveLength(0)
  expect(host.querySelector('[data-offline-compare]').disabled).toBe(true)
  await load(0);expect(busy()).toBe(false);expect(state('a')).toBe('ready');expect(state('b')).toBe('ready');expect(rows()).toHaveLength(0)
  await click('[data-offline-compare]');expect(rows()).toHaveLength(12);expect(rows()[0].cells[3].textContent).toBe('+1')
  expect(host.textContent).not.toContain('PRIVATE.json')
})
it('offline batch cancellation and wrong count preserve the confirmed view and filter',async()=>{
  await render();await ready();await click('[data-offline-differences]');const output=host.querySelector('[data-offline-export]')
  await batch([]);await batch([file()]);await batch([file(),file(),file()])
  expect(readers).toHaveLength(2);expect(host.querySelector('[data-offline-export]')).toBe(output)
  expect(host.querySelector('[data-offline-differences]').checked).toBe(true);expect(host.textContent).toContain('恰好选择两份')
})
it('offline batch rejects oversize on either side before reading or revoking old comparison',async()=>{
  await render();await ready();await batch([file(),file(' '.repeat(4097))])
  expect(readers).toHaveLength(2);expect(rows()).toHaveLength(12);expect(host.textContent).toContain('每份必须非空')
})
it('offline batch invalid content preserves the old complete pair but revokes its old confirmation',async()=>{
  await render();await ready();await batch([changed(),file('{')]);expect(rows()).toHaveLength(0)
  await load(3);expect(readers[2].aborted).toBe(true);expect(busy()).toBe(false)
  expect(state('a')).toBe('ready');expect(state('b')).toBe('ready');expect(host.textContent).toContain('未采用任何新报告')
  await click('[data-offline-compare]');expect(rows()[0].cells[3].textContent).toBe('+1')
})
it('offline batch stop cancels both readers and ignores late callbacks',async()=>{
  await render();await batch([file(),changed()]);const late=readers.map(r=>r.onload)
  await click('[data-offline-batch-stop]');expect(readers.every(r=>r.aborted)).toBe(true)
  await act(async()=>{late.forEach(fn=>fn());await flush()})
  expect(busy()).toBe(false);expect(state('a')).toBe('idle');expect(state('b')).toBe('idle');expect(rows()).toHaveLength(0)
})
it('offline batch replacing one side cancels pending batch without replacing the other side',async()=>{
  await render();await ready();await batch([changed(),changed()]);const late=readers.slice(2).map(r=>r.onload)
  await select('[data-offline-side=a] input',[changed()]);expect(readers[2].aborted).toBe(true);expect(readers[3].aborted).toBe(true)
  expect(state('b')).toBe('ready');await load(4)
  await act(async()=>{late.forEach(fn=>fn());await flush()});await click('[data-offline-compare]')
  expect(rows()[0].cells[3].textContent).toBe('0')
})
it('offline batch latest selection wins when a previous batch completes late',async()=>{
  await render();await batch([changed(),file()]);const late=readers.map(r=>r.onload)
  await batch([file(),changed()]);await load(2);await load(3)
  await act(async()=>{late.forEach(fn=>fn());await flush()});await click('[data-offline-compare]')
  expect(rows()[0].cells[3].textContent).toBe('+1');expect(readers[0].aborted).toBe(true)
})
it('offline batch replacing in-flight single reads cannot leave a permanently reading old side',async()=>{
  await render();await select('[data-offline-side=a] input',[file()]);await batch([file(),file('{')])
  expect(readers[0].aborted).toBe(true);await load(2)
  expect(state('a')).toBe('idle');expect(state('b')).toBe('idle');expect(busy()).toBe(false)
})
it('offline batch close and unmount revoke both reads without resurrecting old reports',async()=>{
  await render();await batch([file(),file()]);const late=readers.map(r=>r.onload)
  await act(async()=>{host.querySelector('[data-offline-pair]').open=false;host.querySelector('[data-offline-pair]').dispatchEvent(new Event('toggle'));await flush()})
  expect(readers.every(r=>r.aborted)).toBe(true);expect(host.querySelector('[data-offline-batch-input]')).toBeNull()
  await act(async()=>root.render(null));await render();await act(async()=>{late.forEach(fn=>fn());await flush()})
  expect(state('a')).toBe('idle');expect(state('b')).toBe('idle')
})
it('offline batch keeps the existing five-second per-file budget and does not retry',async()=>{
  vi.useFakeTimers();await render();await batch([file(),changed()]);await load(0)
  await act(async()=>{vi.advanceTimersByTime(5000);await flush()})
  expect(busy()).toBe(false);expect(readers).toHaveLength(2);expect(state('a')).toBe('idle');expect(state('b')).toBe('idle')
  expect(host.textContent).toContain('未采用任何新报告')
})
it('offline batch selection never calls native scan, network or clipboard and preserves all export formats',async()=>{
  const native=vi.fn(),fetch=vi.spyOn(globalThis,'fetch'),write=vi.fn()
  vi.stubGlobal('electronAPI',{s3LocalOverviewRead:native});vi.stubGlobal('navigator',{...navigator,clipboard:{writeText:write}})
  await render();await ready();await click('[data-offline-swap]');await click('[data-offline-compare]')
  expect(rows()[0].cells[3].textContent).toBe('-1');expect(host.querySelectorAll('[data-offline-export] button')).toHaveLength(3)
  expect(native).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled()
})
