import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Summary from './S3OfflinePairSummary.jsx'
import Export from './S3OfflinePairExport.jsx'
import Pair from './S3OfflineReportPair.jsx'
import { offlineExportFixture } from '../../scripts/s3-offline-pair-export-cases.mjs'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'
let host, root, readers
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const render = content => act(async () => { root.render(<StrictMode>{content}</StrictMode>); await flush() })
const click = selector => act(async () => { host.querySelector(selector).click(); await flush() })
const counts = () => [...host.querySelectorAll('[data-offline-summary-count]')].map(node => Number(node.textContent))
const comparison = () => offlineExportFixture().comparison
const mountPair = async () => {
  await render(<Pair />)
  await act(async () => { const details = host.querySelector('details'); details.open = true; details.dispatchEvent(new Event('toggle')); await flush() })
}
const readPair = async () => {
  const a = reportFixture(), b = structuredClone(a)
  b.records++; b.recordBytes++; b.kinds[0].records++; b.kinds[0].recordBytes++
  for (const [side, report] of [['a', a], ['b', b]]) await act(async () => {
    const input = host.querySelector(`[data-offline-side=${side}] input`), text = JSON.stringify(report)
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'PRIVATE.json')] })
    input.dispatchEvent(new Event('change', { bubbles: true })); await flush()
    const reader = readers.at(-1); reader.result = new TextEncoder().encode(text).buffer; reader.onload(); await flush()
  })
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); readers = []
  vi.stubGlobal('FileReader', class {
    constructor() { readers.push(this) }
    readAsArrayBuffer(file) { this.file = file }
    abort() { this.aborted = true }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount(); vi.runOnlyPendingTimers(); await flush() })
  host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('offline summary UI does not invent zero statistics before a comparison exists', async () => {
  await render(<Summary comparison={null} />); expect(host.querySelector('[data-offline-summary]')).toBeNull()
})
it('offline summary UI shows the complete direction distribution and both unit groups', async () => {
  await render(<Summary comparison={comparison()} />); expect(counts()).toEqual([4, 0, 8])
  expect(host.querySelector('[data-offline-summary-group=counts]').textContent).toContain('增加 2，减少 0，未变 4')
  expect(host.querySelector('[data-offline-summary-group=bytes]').textContent).toContain('增加 2，减少 0，未变 4')
  expect(host.textContent).toContain('不随筛选变化'); expect(host.textContent).toContain('不代表变化的笔记数')
  const section = host.querySelector('section'); expect(document.getElementById(section.getAttribute('aria-labelledby'))).not.toBeNull()
})
it('offline summary UI reports equal metric values without claiming equal content', async () => {
  const data = structuredClone(comparison()); data.rows.forEach(row => { row.b = row.a; row.delta = 0 }); data.changed = 0
  await render(<Summary comparison={data} />); expect(counts()).toEqual([0, 0, 12]); expect(host.textContent).toContain('数值相同不代表内容相同')
})
it('offline summary UI refuses partial statistics without leaking private values', async () => {
  const data = structuredClone(comparison()); data.rows[0].delta = 'PRIVATE'
  await render(<Summary comparison={data} />); expect(counts()).toEqual([])
  expect(host.querySelector('[data-offline-summary-invalid]')).not.toBeNull(); expect(host.textContent).not.toContain('PRIVATE')
})
it('offline summary UI updates immediately across A B A and missing comparisons', async () => {
  const a = comparison(), b = structuredClone(a); b.rows.forEach(row => { const old = row.a; row.a = row.b; row.b = old; row.delta = row.b - row.a })
  await render(<Summary comparison={a} />); expect(counts()).toEqual([4, 0, 8])
  await render(<Summary comparison={b} />); expect(counts()).toEqual([0, 4, 8])
  await render(<Summary comparison={a} />); expect(counts()).toEqual([4, 0, 8])
  await render(<Summary comparison={null} />); expect(counts()).toEqual([])
})
it('offline summary export integration keeps exactly three explicit download controls and does no I/O', async () => {
  const original = offlineExportFixture(), download = vi.fn(), prepare = vi.fn(original.prepare)
  await render(<Export output={{ comparison: original.comparison, download, prepare }} />)
  expect(counts()).toEqual([4, 0, 8]); expect(host.querySelectorAll('button')).toHaveLength(3)
  expect(download).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(readers).toHaveLength(0)
})
it('offline summary production pair requires both reads and explicit comparison', async () => {
  await mountPair(); expect(counts()).toEqual([]); await readPair(); expect(counts()).toEqual([])
  await click('[data-offline-compare]'); expect(counts()).toEqual([4, 0, 8]); expect(host.textContent).not.toContain('PRIVATE')
})
it('offline summary production pair stays complete while differences and direction hide table rows', async () => {
  await mountPair(); await readPair(); await click('[data-offline-compare]'); await click('[data-offline-differences]')
  expect(host.querySelectorAll('[data-offline-result] tbody tr')).toHaveLength(4); expect(counts()).toEqual([4, 0, 8])
  await act(async () => { const select = host.querySelector('[data-offline-direction]'); select.value = 'decrease'; select.dispatchEvent(new Event('change', { bubbles: true })); await flush() })
  expect(host.querySelectorAll('[data-offline-result] tbody tr')).toHaveLength(0); expect(counts()).toEqual([4, 0, 8])
  await click('[data-offline-differences]'); expect(host.querySelectorAll('[data-offline-result] tbody tr')).toHaveLength(12)
  expect(counts()).toEqual([4, 0, 8]); expect(readers).toHaveLength(2)
})
it('offline summary production pair swap revokes old overview and reconfirmation reverses counts', async () => {
  await mountPair(); await readPair(); await click('[data-offline-compare]'); await click('[data-offline-swap]')
  expect(counts()).toEqual([]); await click('[data-offline-compare]'); expect(counts()).toEqual([0, 4, 8])
  await click('[data-offline-reset]'); expect(counts()).toEqual([]); expect(readers).toHaveLength(2)
})
it('offline summary production pair preserves cancelled selection but removes overview on replacement failure', async () => {
  await mountPair(); await readPair(); await click('[data-offline-compare]')
  const input = host.querySelector('[data-offline-side=a] input')
  await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: [] }); input.dispatchEvent(new Event('change', { bubbles: true })); await flush() })
  expect(counts()).toEqual([4, 0, 8])
  await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: [new File(['{'], 'PRIVATE.json')] }); input.dispatchEvent(new Event('change', { bubbles: true })); await flush() })
  expect(counts()).toEqual([])
  await act(async () => { readers.at(-1).onerror(); await flush() }); expect(counts()).toEqual([])
})
