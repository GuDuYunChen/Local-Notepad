import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Pair from './S3OfflineReportPair.jsx'
import { readLocalOverviewFile } from '../services/s3LocalOverviewFile.mjs'
vi.mock('../services/s3LocalOverviewFile.mjs', async () => ({
  ...await vi.importActual('../services/s3LocalOverviewFile.mjs'), readLocalOverviewFile: vi.fn(),
}))
let host, root
const read = vi.mocked(readLocalOverviewFile)
const report = (files = 1, tags = 2, fileBytes = files * 64, tagBytes = tags * 64) => ({
  generatedAtUTC: '2026-10-01T00:00:00.000Z', source: 'untrusted-file',
  summary: { format: 'local-notepad-s3-local-candidate-overview', version: 1, read_only: true,
    observed_stable: true, complete_for_preview: false, records: files + tags,
    record_bytes: fileBytes + tagBytes, attachment_bytes: 0, base_items: 0,
    kinds: ['file','tag','file-tag','attachment'].map((kind,i) => ({ kind,
      records: [files,tags,0,0][i], record_bytes: [fileBytes,tagBytes,0,0][i] })) },
})
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve() }
const click = selector => act(async () => { host.querySelector(selector).click(); await flush() })
const choose = (side, value) => act(async () => {
  const input = host.querySelector(`[data-offline-side="${side}"] input[type=file]`)
  const file = new File(['x'], 'synthetic-report.json', { type: 'application/json' })
  if (value) read.mockResolvedValueOnce(value)
  Object.defineProperty(input, 'files', { configurable: true, value: value ? [file] : [] })
  input.dispatchEvent(new Event('change', { bubbles: true })); await flush()
})
const direction = value => act(async () => {
  const select=host.querySelector('[data-offline-direction]'); select.value=value
  select.dispatchEvent(new Event('change', { bubbles: true })); await flush()
})
const rows = () => [...host.querySelectorAll('[data-offline-result] tbody tr')]
const deltas = () => rows().map(row => Number(row.cells[3].textContent))
const compare = async (a=report(),b=report(2,1)) => {
  await choose('a',a);await choose('b',b);await click('[data-offline-compare]')
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);read.mockReset()
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async()=>{root.render(<StrictMode><Pair/></StrictMode>);await flush()})
  await act(async()=>{const details=host.querySelector('details');details.open=true;details.dispatchEvent(new Event('toggle'));await flush()})
})
afterEach(async () => {
  await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()
})
it('offline direction UI is absent until a comparison is explicitly confirmed',async()=>{
  expect(read).not.toHaveBeenCalled();expect(host.querySelector('[data-offline-direction]')).toBeNull()
  await choose('a',report());await choose('b',report(2,1))
  expect(rows()).toHaveLength(0);expect(host.querySelector('[data-offline-direction]')).toBeNull()
})
it('offline direction UI displays both signs independently and restores all twelve rows',async()=>{
  await compare();expect(rows()).toHaveLength(12);await click('[data-offline-differences]');expect(rows()).toHaveLength(4)
  await direction('increase');expect(deltas()).toEqual([1,64]);await direction('decrease');expect(deltas()).toEqual([-1,-64])
  await direction('all');expect(rows()).toHaveLength(4);await click('[data-offline-differences]');expect(rows()).toHaveLength(12)
  expect(host.querySelector('[data-offline-direction]')).toBeNull();expect(read).toHaveBeenCalledTimes(2)
})
it('offline direction UI does not hide opposing category changes when totals match',async()=>{
  await compare();expect(deltas().slice(0,4)).toEqual([0,0,0,0]);await click('[data-offline-differences]')
  await direction('increase');expect(rows().map(r=>r.dataset.offlineMetric)).toEqual(['file:records','file:bytes'])
  await direction('decrease');expect(rows().map(r=>r.dataset.offlineMetric)).toEqual(['tag:records','tag:bytes'])
})
it('offline direction UI includes byte-only changes',async()=>{
  await compare(report(1,2),report(1,2,80,112));await click('[data-offline-differences]')
  await direction('increase');expect(deltas()).toEqual([16]);await direction('decrease');expect(deltas()).toEqual([-16])
})
it('offline direction UI empty positive filter never claims the two reports are equal',async()=>{
  await compare(report(2,1),report(1,1));await click('[data-offline-differences]');await direction('increase')
  expect(rows()).toHaveLength(0);expect(host.textContent).toContain('没有增加的指标，不代表两份报告相同')
  expect(host.textContent).not.toContain('12 项统计数值相同');await direction('decrease');expect(rows()).toHaveLength(4)
})
it('offline direction UI equal observations keep the old all-differences explanation',async()=>{
  await compare(report(),report());await click('[data-offline-differences]')
  expect(host.textContent).toContain('12 项统计数值相同，不代表内容相同')
  await direction('decrease');expect(host.textContent).toContain('没有减少的指标')
})
it('offline direction UI switch off and on starts with both difference signs',async()=>{
  await compare();await click('[data-offline-differences]');await direction('decrease')
  await click('[data-offline-differences]');await click('[data-offline-differences]')
  expect(host.querySelector('[data-offline-direction]').value).toBe('all');expect(rows()).toHaveLength(4)
})
it('offline direction UI swap revokes the filter and requires explicit reverse comparison',async()=>{
  await compare();await click('[data-offline-differences]');await direction('increase');await click('[data-offline-swap]')
  expect(rows()).toHaveLength(0);expect(host.querySelector('[data-offline-direction]')).toBeNull()
  await click('[data-offline-compare]');expect(rows()).toHaveLength(12);expect(deltas().slice(4,8)).toEqual([-1,-64,1,64])
})
it('offline direction UI replacing A then restoring A never revives the old filter',async()=>{
  const a=report();await compare(a);await click('[data-offline-differences]');await direction('decrease')
  await choose('a',report(3,1));await choose('a',a);expect(rows()).toHaveLength(0)
  await click('[data-offline-compare]');expect(rows()).toHaveLength(12);expect(host.querySelector('[data-offline-differences]').checked).toBe(false)
})
it('offline direction UI cancelled file selection preserves confirmed direction',async()=>{
  await compare();await click('[data-offline-differences]');await direction('decrease');await choose('a',null)
  expect(host.querySelector('[data-offline-direction]').value).toBe('decrease');expect(deltas()).toEqual([-1,-64]);expect(read).toHaveBeenCalledTimes(2)
})
it('offline direction UI failed replacement removes old rows and direction',async()=>{
  await compare();await click('[data-offline-differences]');await direction('increase')
  read.mockRejectedValueOnce(Error('PRIVATE_READ'));await choose('a',report())
  expect(rows()).toHaveLength(0);expect(host.querySelector('[data-offline-direction]')).toBeNull();expect(host.textContent).not.toContain('PRIVATE_READ')
})
it('offline direction UI exposes a labelled native select and matching status controls',async()=>{
  await compare();await click('[data-offline-differences]');const select=host.querySelector('[data-offline-direction]')
  expect(select.closest('label').textContent).toContain('差异方向（B − A）')
  expect(document.getElementById(select.getAttribute('aria-controls'))).not.toBeNull()
  expect(document.getElementById(select.getAttribute('aria-describedby')).getAttribute('aria-live')).toBe('polite')
  expect([...select.options].map(o=>o.value)).toEqual(['all','increase','decrease'])
})
it('offline direction UI JSON export retains twelve metrics while only negatives are visible',async()=>{
  await compare();await click('[data-offline-differences]');await direction('decrease');expect(rows()).toHaveLength(2)
  vi.useFakeTimers();const blobs=[]
  vi.stubGlobal('Blob',class { constructor(parts){this.raw=parts.join('')} })
  const previousCreate=Object.getOwnPropertyDescriptor(URL,'createObjectURL'),previousRevoke=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL')
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(blob=>{blobs.push(blob);return 'blob:direction-test'})})
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
  try {
    await click('[data-offline-export-format=json]');const data=JSON.parse(blobs[0].raw)
    expect(data.metrics).toHaveLength(12);expect(data.metrics.filter(r=>r.delta===0)).toHaveLength(8)
    expect(data.metrics.filter(r=>r.delta>0)).toHaveLength(2);expect(data.direction).toBe('B-minus-A')
    expect(read).toHaveBeenCalledTimes(2);await act(async()=>{vi.advanceTimersByTime(1000);await flush()})
  } finally {
    if(previousCreate)Object.defineProperty(URL,'createObjectURL',previousCreate);else delete URL.createObjectURL
    if(previousRevoke)Object.defineProperty(URL,'revokeObjectURL',previousRevoke);else delete URL.revokeObjectURL
  }
})
it('offline direction UI clear then new comparison never restores old directional state',async()=>{
  await compare();await click('[data-offline-differences]');await direction('decrease');await click('[data-offline-reset]')
  expect(host.querySelector('[data-offline-direction]')).toBeNull();await compare();expect(rows()).toHaveLength(12)
})
