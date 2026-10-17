import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Pair from './S3OfflineReportPair.jsx'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'
let host, root, readers, contents
const flush = async () => { for (let i=0;i<16;i++) await Promise.resolve() }
const file = (text=JSON.stringify(reportFixture())) => {
  const f=new File([text],'PRIVATE.json',{type:'application/json'});contents.set(f,text);return f
}
const changed = () => { const r=reportFixture();r.records++;r.recordBytes++;r.kinds[0].records++;r.kinds[0].recordBytes++;return file(JSON.stringify(r)) }
const click = selector => act(async()=>{host.querySelector(selector).click();await flush()})
const state = side => host.querySelector(`[data-offline-side=${side}] [data-offline-state]`).getAttribute('data-offline-state')
const rows = () => [...host.querySelectorAll('[data-offline-result] tbody tr')]
const render = async () => {
  await act(async()=>root.render(<StrictMode><Pair/></StrictMode>))
  await act(async()=>{host.querySelector('[data-offline-pair]').open=true;await flush()})
  await click('[data-offline-batch-toggle]')
}
const send = async (kind,files,types=['Files'],items) => {
  const event=new Event(kind,{bubbles:true,cancelable:true})
  Object.defineProperty(event,'dataTransfer',{value:{files,types,items}})
  await act(async()=>{host.querySelector('[data-offline-batch-drop-label]').dispatchEvent(event);await flush()})
  return event
}
const load = index => act(async()=>{const r=readers[index];expect(contents.has(r.file)).toBe(true);r.result=new TextEncoder().encode(contents.get(r.file)).buffer;r.onload?.();await flush()})
const ready = async () => { await send('drop',[file(),changed()]);await load(readers.length-2);await load(readers.length-1);await click('[data-offline-compare]') }
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);readers=[];contents=new Map()
  vi.stubGlobal('FileReader',class{constructor(){readers.push(this)}readAsArrayBuffer(f){this.file=f}abort(){this.aborted=true}})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('batch drop panel is labelled, keeps all original picker inputs and never reads on mount',async()=>{
  await render();expect(readers).toHaveLength(0)
  expect(host.querySelectorAll('[data-offline-side] input[type=file]')).toHaveLength(2)
  expect(host.querySelector('[data-offline-batch-input]').multiple).toBe(true)
  const zone=host.querySelector('[data-offline-batch-drop]');expect(document.getElementById(zone.getAttribute('aria-labelledby'))).not.toBeNull()
  expect(host.textContent).toContain('按拖放返回顺序');expect(host.textContent).toContain('不代表时间先后')
})
it('batch drop waits for both validated reports and explicit comparison in native order',async()=>{
  await render();const a=file(),b=changed();await send('drop',[a,b]);expect(readers.map(r=>r.file)).toEqual([a,b])
  await load(1);expect(state('a')).toBe('idle');expect(state('b')).toBe('idle');expect(rows()).toHaveLength(0)
  await load(0);expect(state('a')).toBe('ready');expect(state('b')).toBe('ready');expect(rows()).toHaveLength(0)
  await click('[data-offline-compare]');expect(rows()).toHaveLength(12);expect(rows()[0].cells[3].textContent).toBe('+1')
  expect(host.textContent).not.toContain('PRIVATE.json')
})
it('batch drop invalid counts, size and directory preserve confirmation, filter and exports',async()=>{
  await render();await ready();await click('[data-offline-differences]');const output=host.querySelector('[data-offline-export]')
  await send('drop',[file()]);await send('drop',[file(),file(),file()]);await send('drop',[file(),file(' '.repeat(4097))])
  await send('drop',[file(),file()],['Files'],[{kind:'file',webkitGetAsEntry:()=>({isDirectory:true})}])
  expect(readers).toHaveLength(2);expect(host.querySelector('[data-offline-export]')).toBe(output)
  expect(host.querySelector('[data-offline-differences]').checked).toBe(true);expect(rows()).toHaveLength(4)
})
it('batch drop text hover immediately supersedes old refusal without reading or clearing',async()=>{
  await render();await ready();await send('drop',[file()]);await send('dragover',[],['text/plain'])
  expect(host.querySelector('[data-offline-batch-drop-status]').getAttribute('data-offline-batch-drop-status')).toBe('batch-file-required')
  expect(rows()).toHaveLength(12);expect(readers).toHaveLength(2)
})
it('batch drop rejected payload leaves both pending readers intact',async()=>{
  await render();await send('drop',[file(),changed()]);await send('drop',[file()])
  expect(readers).toHaveLength(2);expect(readers.every(r=>!r.aborted)).toBe(true)
  await load(0);await load(1);expect(state('a')).toBe('ready');expect(state('b')).toBe('ready')
})
it('batch drop prevents default navigation and parent note-import handlers',async()=>{
  await render();const parent=vi.fn();document.body.addEventListener('drop',parent)
  try{const e=await send('drop',[file(),changed()]);expect(e.defaultPrevented).toBe(true);expect(parent).not.toHaveBeenCalled()}
  finally{document.body.removeEventListener('drop',parent)}
})
it('batch drop malformed second report adopts neither new report and preserves prior pair',async()=>{
  await render();await ready();await send('drop',[changed(),file('{')]);expect(rows()).toHaveLength(0)
  await load(3);expect(readers[2].aborted).toBe(true);expect(state('a')).toBe('ready');expect(state('b')).toBe('ready')
  expect(host.textContent).toContain('未采用任何新报告');await click('[data-offline-compare]');expect(rows()[0].cells[3].textContent).toBe('+1')
})
it('batch drop replacement cancels the old batch and cannot revive its late completion',async()=>{
  await render();await send('drop',[file(),changed()]);const late=readers.map(r=>r.onload)
  await send('drop',[changed(),file()]);expect(readers.slice(0,2).every(r=>r.aborted)).toBe(true)
  await load(2);await load(3);await act(async()=>{late.forEach(fn=>fn());await flush()})
  await click('[data-offline-compare]');expect(rows()[0].cells[3].textContent).toBe('-1')
})
it('batch drop stop cancels both and does not adopt captured late callbacks',async()=>{
  await render();await send('drop',[file(),changed()]);const late=readers.map(r=>r.onload)
  await click('[data-offline-batch-stop]');expect(readers.every(r=>r.aborted)).toBe(true)
  await act(async()=>{late.forEach(fn=>fn());await flush()});expect(state('a')).toBe('idle');expect(state('b')).toBe('idle')
})
it('batch drop hiding and reopening resets feedback and revokes a pending batch',async()=>{
  await render();await send('drop',[file(),changed()]);const late=readers.map(r=>r.onload)
  await click('[data-offline-batch-toggle]');expect(host.querySelector('[data-offline-batch-drop]')).toBeNull()
  expect(readers.every(r=>r.aborted)).toBe(true);await click('[data-offline-batch-toggle]')
  await act(async()=>{late.forEach(fn=>fn());await flush()});expect(rows()).toHaveLength(0)
  expect(host.querySelector('[data-offline-batch-drop-status]').textContent).toBe('')
})
it('batch drop unmount detaches its reader lifetime without implicit retries',async()=>{
  await render();await send('drop',[file(),changed()]);const late=readers.map(r=>r.onload)
  await act(async()=>root.render(null));expect(readers.every(r=>r.aborted)).toBe(true)
  await act(async()=>{late.forEach(fn=>fn());await flush()});expect(readers).toHaveLength(2)
})
