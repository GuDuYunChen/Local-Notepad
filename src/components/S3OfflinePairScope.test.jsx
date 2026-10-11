import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Pair from './S3OfflineReportPair.jsx'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'
let host, root, readers
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const click = selector => act(async () => { host.querySelector(selector).click(); await flush() })
const change = (selector, value) => act(async () => {
  const select = host.querySelector(selector); select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true })); await flush()
})
const rows = () => [...host.querySelectorAll('[data-offline-result] tbody tr')]
const summary = () => [...host.querySelectorAll('[data-offline-summary-count]')].map(n => Number(n.textContent))
const mount = async () => {
  await act(async () => { root.render(<StrictMode><Pair /></StrictMode>); await flush() })
  await act(async () => { const d = host.querySelector('details'); d.open = true; d.dispatchEvent(new Event('toggle')); await flush() })
}
const choose = (side, files) => act(async () => {
  const input = host.querySelector(`[data-offline-side=${side}] input`)
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  input.dispatchEvent(new Event('change', { bubbles: true })); await flush()
})
const readPair = async () => {
  const a = reportFixture(), b = structuredClone(a)
  b.records++; b.recordBytes++; b.kinds[0].records++; b.kinds[0].recordBytes++
  for (const [side, report] of [['a', a], ['b', b]]) {
    const text = JSON.stringify(report); await choose(side, [new File([text], 'PRIVATE.json')])
    await act(async () => { const r = readers.at(-1); r.result = new TextEncoder().encode(text).buffer; r.onload(); await flush() })
  }
}
const start = async () => { await mount(); await readPair(); await click('[data-offline-compare]'); await click('[data-offline-differences]') }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); readers = []
  vi.stubGlobal('FileReader', class { constructor() { readers.push(this) } readAsArrayBuffer(file) { this.file = file } abort() { this.aborted = true } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount(); vi.runOnlyPendingTimers(); await flush() })
  host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('offline scope UI requires confirmed comparison and enabled difference filtering', async () => {
  await mount(); expect(host.querySelector('[data-offline-scope]')).toBeNull()
  await readPair(); expect(host.querySelector('[data-offline-scope]')).toBeNull()
  await click('[data-offline-compare]'); expect(rows()).toHaveLength(12); expect(host.querySelector('[data-offline-scope]')).toBeNull()
  await click('[data-offline-differences]'); expect(host.querySelector('[data-offline-scope]').value).toBe('all')
})
it('offline scope UI offers exactly three labelled native options and valid control references', async () => {
  await start(); const select = host.querySelector('[data-offline-scope]')
  expect([...select.options].map(n => n.value)).toEqual(['all', 'counts', 'bytes'])
  expect(select.closest('label').textContent).toContain('差异指标类型')
  for (const attr of ['aria-controls', 'aria-describedby']) expect(document.getElementById(select.getAttribute(attr))).not.toBeNull()
})
it('offline scope UI selects quantity differences without capacity rows', async () => {
  await start(); await change('[data-offline-scope]', 'counts')
  expect(rows()).toHaveLength(2); expect(rows().every(row => row.cells[4].textContent === '项')).toBe(true)
  expect(host.querySelector('caption').textContent).toContain('数量')
})
it('offline scope UI selects capacity differences without quantity rows', async () => {
  await start(); await change('[data-offline-scope]', 'bytes')
  expect(rows()).toHaveLength(2); expect(rows().every(row => row.cells[4].textContent === 'B')).toBe(true)
  expect(host.querySelector('caption').textContent).toContain('容量')
})
it('offline scope UI composes direction and type and does not call an empty scope equal reports', async () => {
  await start(); await change('[data-offline-scope]', 'counts'); await change('[data-offline-direction]', 'decrease')
  expect(rows()).toHaveLength(0); expect(host.querySelector('[data-offline-no-differences]').textContent).toContain('不代表两份报告相同')
  expect(host.querySelector('[data-offline-no-differences]').textContent).not.toContain('12 项统计数值相同')
  await change('[data-offline-direction]', 'increase'); expect(rows()).toHaveLength(2)
})
it('offline scope UI changing types preserves the selected direction', async () => {
  await start(); await change('[data-offline-direction]', 'increase'); await change('[data-offline-scope]', 'bytes')
  expect(host.querySelector('[data-offline-direction]').value).toBe('increase'); expect(rows()).toHaveLength(2)
  await change('[data-offline-scope]', 'all'); expect(rows()).toHaveLength(4)
})
it('offline scope UI disabling differences restores all twelve and does not revive the old type', async () => {
  await start(); await change('[data-offline-scope]', 'counts'); await click('[data-offline-differences]')
  expect(rows()).toHaveLength(12); expect(host.querySelector('[data-offline-scope]')).toBeNull()
  await click('[data-offline-differences]'); expect(host.querySelector('[data-offline-scope]').value).toBe('all'); expect(rows()).toHaveLength(4)
})
it('offline scope UI leaves complete overview and existing readers unchanged', async () => {
  await start(); expect(summary()).toEqual([4, 0, 8])
  for (const scope of ['counts', 'bytes', 'all']) { await change('[data-offline-scope]', scope); expect(summary()).toEqual([4, 0, 8]) }
  expect(readers).toHaveLength(2); expect(host.textContent).not.toContain('PRIVATE')
})
it('offline scope UI preserves picker cancellation but removes stale scope on replacement failure', async () => {
  await start(); await change('[data-offline-scope]', 'bytes'); await choose('a', [])
  expect(host.querySelector('[data-offline-scope]').value).toBe('bytes')
  await choose('a', [new File(['{'], 'PRIVATE.json')]); expect(host.querySelector('[data-offline-scope]')).toBeNull()
  await act(async () => { readers.at(-1).onerror(); await flush() }); expect(rows()).toHaveLength(0)
})
it('offline scope UI swap revokes old scope and new confirmation starts unfiltered', async () => {
  await start(); await change('[data-offline-scope]', 'counts'); await click('[data-offline-swap]')
  expect(host.querySelector('[data-offline-scope]')).toBeNull(); await click('[data-offline-compare]'); expect(rows()).toHaveLength(12)
  await click('[data-offline-differences]'); expect(host.querySelector('[data-offline-scope]').value).toBe('all')
  await change('[data-offline-direction]', 'decrease'); expect(rows()).toHaveLength(4)
})
it('offline scope UI reconfirmation and close clear old filters even with the same reports', async () => {
  await start(); await change('[data-offline-scope]', 'bytes'); await click('[data-offline-compare]')
  expect(rows()).toHaveLength(12); await click('[data-offline-differences]'); expect(host.querySelector('[data-offline-scope]').value).toBe('all')
  await act(async () => { const d = host.querySelector('details'); d.open = false; d.dispatchEvent(new Event('toggle')); await flush() })
  expect(rows()).toHaveLength(0); expect(host.querySelector('[data-offline-scope]')).toBeNull()
})
it('offline scope UI downloads all twelve metrics in every format while only two rows are visible', async () => {
  await start(); await change('[data-offline-scope]', 'counts'); expect(rows()).toHaveLength(2)
  const blobs = []; vi.stubGlobal('URL', { createObjectURL: vi.fn(blob => { blobs.push(blob); return 'blob:owned' }), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  for (const format of ['json', 'csv', 'html']) await click(`[data-offline-export-format=${format}]`)
  expect(blobs).toHaveLength(3)
  const contents = await Promise.all(blobs.map(b => b.text()))
  expect(JSON.parse(contents[0]).metrics).toHaveLength(12)
  expect(contents[1].trimEnd().split('\r\n')).toHaveLength(13)
  expect([...contents[2].matchAll(/<tr data-offline-metric=/g)]).toHaveLength(12)
  expect(readers).toHaveLength(2); expect(summary()).toEqual([4, 0, 8])
})
