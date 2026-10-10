import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Pair from './S3OfflineReportPair.jsx'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'

let host, root, readers, clicked, descriptors
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const rows = () => [...host.querySelectorAll('[data-offline-result] tbody tr')]
const filter = () => host.querySelector('[data-offline-differences]')
const click = selector => act(async () => { host.querySelector(selector).click(); await flush() })
const select = (side, values = [new File(['{}'], 'report.json')]) => act(async () => {
  const input = host.querySelector(`[data-offline-side=${side}] input`)
  Object.defineProperty(input, 'files', { configurable: true, value: values })
  input.dispatchEvent(new Event('change', { bubbles: true })); await flush()
})
const load = (index, value) => act(async () => {
  const reader = readers[index]
  reader.result = new TextEncoder().encode(JSON.stringify(value)).buffer; reader.onload?.(); await flush()
})
const changed = () => {
  const report = reportFixture()
  report.records++; report.recordBytes++; report.kinds[0].records++; report.kinds[0].recordBytes++
  return report
}
async function ready(equal = false) {
  await act(async () => {
    root.render(<StrictMode><Pair/></StrictMode>); await flush()
    const details = host.querySelector('details'); details.open = true; details.dispatchEvent(new Event('toggle')); await flush()
  })
  await select('a'); await select('b'); await load(0, reportFixture()); await load(1, equal ? reportFixture() : changed())
  await click('[data-offline-compare]')
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); readers = []
  vi.stubGlobal('FileReader', class {
    constructor() { readers.push(this) }
    readAsArrayBuffer(file) { this.file = file }
    abort() { this.aborted = true }
  })
  descriptors = ['createObjectURL', 'revokeObjectURL'].map(key => [key, Object.getOwnPropertyDescriptor(URL, key)])
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:filter-test') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount(); vi.runOnlyPendingTimers(); await flush() }); host.remove()
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(URL, key, descriptor); else delete URL[key]
  }
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('offline pair filter appears only after explicit comparison and defaults to twelve rows', async () => {
  await act(async () => root.render(<StrictMode><Pair/></StrictMode>))
  expect(filter()).toBeNull(); expect(readers).toHaveLength(0)
  await ready(); expect(filter().checked).toBe(false); expect(rows()).toHaveLength(12)
  expect(document.getElementById(filter().getAttribute('aria-controls'))).not.toBeNull()
  expect(document.getElementById(filter().getAttribute('aria-describedby')).textContent).toContain('12 / 12')
})
it('offline pair filter toggles exact rows without modifying the original values', async () => {
  await ready(); const original = rows().map(row => row.textContent)
  await click('[data-offline-differences]')
  expect(rows()).toHaveLength(4); expect(rows().every(row => row.cells[3].textContent === '+1')).toBe(true)
  expect(host.querySelector('[data-offline-filter]').textContent).toContain('4 / 12')
  await click('[data-offline-differences]'); expect(rows().map(row => row.textContent)).toEqual(original)
  expect(readers).toHaveLength(2); expect(clicked).not.toHaveBeenCalled()
})
it('offline pair filter zero results explain numeric equality without content claims', async () => {
  await ready(true); await click('[data-offline-differences]')
  expect(rows()).toHaveLength(0); expect(host.querySelector('[data-offline-no-differences]').textContent).toContain('不代表内容相同')
  expect(host.querySelector('[data-offline-filter]').textContent).toContain('0 / 12')
  expect(host.querySelectorAll('[data-offline-export-format]')).toHaveLength(3)
  await click('[data-offline-differences]'); expect(rows()).toHaveLength(12)
})
it('offline pair filter swapping revokes the filter and retains negative differences after reconfirmation', async () => {
  await ready(); await click('[data-offline-differences]'); await click('[data-offline-swap]')
  expect(filter()).toBeNull(); await click('[data-offline-compare]')
  expect(filter().checked).toBe(false); expect(rows()).toHaveLength(12)
  await click('[data-offline-differences]'); expect(rows()).toHaveLength(4)
  expect(rows().every(row => row.cells[3].textContent === '-1')).toBe(true)
})
it('offline pair filter source replacement or failure cannot revive a previous filter', async () => {
  await ready(); await click('[data-offline-differences]'); await select('a')
  expect(filter()).toBeNull(); expect(host.querySelector('[data-offline-export]')).toBeNull()
  await act(async () => { readers[2].onerror?.(); await flush() }); expect(filter()).toBeNull()
  await select('a'); await load(3, reportFixture()); await click('[data-offline-compare]')
  expect(filter().checked).toBe(false); expect(rows()).toHaveLength(12)
})
it('offline pair filter recompare of unchanged sources starts with all values', async () => {
  await ready(); await click('[data-offline-differences]'); await click('[data-offline-compare]')
  expect(filter().checked).toBe(false); expect(rows()).toHaveLength(12); expect(readers).toHaveLength(2)
})
it('offline pair filter picker cancellation and rejected multiselect preserve the confirmed view', async () => {
  await ready(); await click('[data-offline-differences]'); await select('a', [])
  expect(filter().checked).toBe(true); expect(rows()).toHaveLength(4)
  await select('b', [new File(['{}'], 'one.json'), new File(['{}'], 'two.json')])
  expect(filter().checked).toBe(true); expect(rows()).toHaveLength(4); expect(readers).toHaveLength(2)
})
it('offline pair filter clear and close remove the entire filtered confirmation', async () => {
  await ready(); await click('[data-offline-differences]'); await click('[data-offline-side=a] button')
  expect(filter()).toBeNull(); await select('a'); await load(2, reportFixture()); await click('[data-offline-compare]')
  expect(filter().checked).toBe(false); await click('[data-offline-differences]')
  await act(async () => { const d = host.querySelector('details'); d.open = false; d.dispatchEvent(new Event('toggle')); await flush() })
  expect(filter()).toBeNull(); expect(rows()).toHaveLength(0)
})
it('offline pair filter keeps export feedback and uses no extra file reads or network', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), storage = vi.spyOn(Storage.prototype, 'setItem')
  await ready(); await click('[data-offline-export-format=json]'); await click('[data-offline-differences]')
  expect(host.querySelector('[data-offline-export-status]').dataset.offlineExportStatus).toBe('requested')
  for (const format of ['csv', 'html']) await click(`[data-offline-export-format=${format}]`)
  expect(clicked).toHaveBeenCalledTimes(3); expect(rows()).toHaveLength(4); expect(readers).toHaveLength(2)
  expect(fetch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled()
})
it('offline pair filter remount cannot reuse a previous selection or confirmation', async () => {
  await ready(); await click('[data-offline-differences]')
  await act(async () => { root.render(null); await flush() })
  await act(async () => { root.render(<StrictMode><Pair/></StrictMode>); await flush() })
  expect(filter()).toBeNull(); expect(rows()).toHaveLength(0); expect(readers).toHaveLength(2)
})
it('offline pair filter does not submit a containing form', async () => {
  const submit = vi.fn(event => event.preventDefault())
  await act(async () => root.render(<form onSubmit={submit}><Pair/></form>))
  await select('a'); await select('b'); await load(0, reportFixture()); await load(1, changed())
  await click('[data-offline-compare]'); await click('[data-offline-differences]')
  expect(submit).not.toHaveBeenCalled(); expect(filter().type).toBe('checkbox')
})
