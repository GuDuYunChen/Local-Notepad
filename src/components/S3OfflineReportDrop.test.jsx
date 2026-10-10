import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Pair from './S3OfflineReportPair.jsx'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'
let host, root, readers, contents
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const file = (text = JSON.stringify(reportFixture())) => {
  const value = new File([text], 'PRIVATE-report.json', { type: 'application/json' }); contents.set(value, text); return value
}
const zone = side => host.querySelector(`[data-offline-drop="${side}"]`)
const state = side => zone(side).querySelector('[data-offline-state]').getAttribute('data-offline-state')
const code = side => zone(side).querySelector('[data-offline-drop-status]').getAttribute('data-offline-drop-status')
const rows = () => [...host.querySelectorAll('[data-offline-result] tbody tr')]
const click = selector => act(async () => { host.querySelector(selector).click(); await flush() })
const render = async () => {
  await act(async () => root.render(<StrictMode><Pair /></StrictMode>))
  await act(async () => { host.querySelector('details').open = true; await flush() })
}
const drag = (side, type, data) => act(async () => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: data }); zone(side).dispatchEvent(event); await flush()
  expect(event.defaultPrevented).toBe(true)
})
const drop = (side, values) => drag(side, 'drop', { types: ['Files'], files: values })
const load = index => act(async () => {
  const reader = readers[index]; expect(contents.has(reader.file)).toBe(true)
  reader.result = new TextEncoder().encode(contents.get(reader.file)).buffer; reader.onload?.(); await flush()
})
const ready = async () => {
  await drop('a', [file()]); await drop('b', [file()]); await load(0); await load(1); await click('[data-offline-compare]')
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); readers = []; contents = new Map()
  vi.stubGlobal('FileReader', class { constructor() { readers.push(this) } readAsArrayBuffer(value) { this.file = value } abort() { this.aborted = true } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('offline pair drop zones preserve two labelled file inputs and perform no implicit read', async () => {
  await render(); expect(readers).toHaveLength(0); expect(host.querySelectorAll('input[type=file]')).toHaveLength(2)
  for (const side of ['a', 'b']) {
    expect(zone(side).getAttribute('role')).toBe('group')
    expect(document.getElementById(zone(side).getAttribute('aria-labelledby'))).not.toBeNull()
  }
})
it('offline pair native dropped files become independent sources and still require comparison', async () => {
  await render(); await drop('a', [file()]); await drop('b', [file()]); await load(1)
  expect(state('a')).toBe('reading'); expect(state('b')).toBe('ready'); expect(readers[0].aborted).not.toBe(true)
  await load(0); expect(rows()).toHaveLength(0); await click('[data-offline-compare]'); expect(rows()).toHaveLength(12)
  expect(host.textContent).not.toContain('PRIVATE-report')
})
it('offline pair multiple drop preserves both confirmed reports and filter state', async () => {
  await render(); await ready(); await click('[data-offline-differences]')
  const exportNode = host.querySelector('[data-offline-export]')
  await drop('a', [file(), file()]); expect(code('a')).toBe('drop-one-file')
  expect(state('a')).toBe('ready'); expect(state('b')).toBe('ready'); expect(readers).toHaveLength(2)
  expect(host.querySelector('[data-offline-differences]').checked).toBe(true); expect(host.querySelector('[data-offline-export]')).toBe(exportNode)
})
it('offline pair text hover replaces old refusal without reading text or losing the comparison', async () => {
  await render(); await ready(); await drop('a', [file(), file()])
  const data = { types: ['text/plain'], getData: vi.fn() }
  await drag('a', 'dragover', data); expect(code('a')).toBe('drop-file-required'); expect(data.dropEffect).toBe('none')
  expect(data.getData).not.toHaveBeenCalled(); expect(rows()).toHaveLength(12); expect(readers).toHaveLength(2)
})
it('offline pair directory drop cannot enumerate a directory or cancel a pending reader', async () => {
  await render(); await drop('b', [file()])
  const readEntries = vi.fn(), item = { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true, createReader: readEntries }) }
  await drag('b', 'drop', { types: ['Files'], files: [file()], items: [item] })
  expect(code('b')).toBe('drop-directory'); expect(state('b')).toBe('reading'); expect(readers).toHaveLength(1)
  expect(readers[0].aborted).not.toBe(true); expect(readEntries).not.toHaveBeenCalled(); await load(0)
})
it('offline pair accepted bad replacement invalidates only its side and all old exports', async () => {
  await render(); await ready(); await drop('a', [file('{')])
  expect(rows()).toHaveLength(0); expect(host.querySelector('[data-offline-export]')).toBeNull(); expect(state('b')).toBe('ready')
  await load(2); expect(state('a')).toBe('failed'); expect(state('b')).toBe('ready')
})
it('offline pair drop replacement does not revive an A-B-A late completion', async () => {
  await render(); const a = file(); await drop('a', [a]); const late = readers[0].onload
  await drop('a', [file()]); await drop('a', [a]); await act(async () => { late(); await flush() })
  expect(readers[0].aborted).toBe(true); expect(readers[1].aborted).toBe(true); expect(state('a')).toBe('reading')
  await load(2); expect(state('a')).toBe('ready'); expect(rows()).toHaveLength(0)
})
it('offline pair stop after a drop leaves the other side running', async () => {
  await render(); await drop('a', [file()]); await drop('b', [file()]); await click('[data-offline-side=a] button')
  expect(state('a')).toBe('idle'); expect(readers[0].aborted).toBe(true); expect(readers[1].aborted).not.toBe(true)
  await load(1); expect(state('b')).toBe('ready')
})
it('offline pair drop keeps the original five-second timeout without retries', async () => {
  vi.useFakeTimers(); await render(); await drop('a', [file()])
  await act(async () => { vi.advanceTimersByTime(5000); await flush() })
  expect(state('a')).toBe('failed'); expect(readers).toHaveLength(1); expect(readers[0].aborted).toBe(true)
})
it('offline pair unmount after drop revokes the saved callback', async () => {
  await render(); await drop('a', [file()]); const late = readers[0].onload
  await act(async () => root.render(null)); await render(); await act(async () => { late(); await flush() })
  expect(readers[0].aborted).toBe(true); expect(state('a')).toBe('idle')
})
it('offline pair dropped sources can still be swapped and cleared by the original controls', async () => {
  await render(); const b = reportFixture(); b.records++; b.recordBytes++; b.kinds[0].records++; b.kinds[0].recordBytes++
  await drop('a', [file()]); await drop('b', [file(JSON.stringify(b))]); await load(0); await load(1)
  await click('[data-offline-compare]'); expect(rows()[0].cells[3].textContent).toBe('+1')
  await click('[data-offline-swap]'); expect(rows()).toHaveLength(0); await click('[data-offline-compare]')
  expect(rows()[0].cells[3].textContent).toBe('-1'); await click('[data-offline-reset]'); expect(state('a')).toBe('idle'); expect(state('b')).toBe('idle')
})
it('offline pair side drops do not bubble into ordinary note import handlers', async () => {
  const outer = vi.fn(); await act(async () => root.render(<div onDrop={outer}><Pair /></div>))
  await drop('a', [file()]); expect(outer).not.toHaveBeenCalled(); expect(readers).toHaveLength(1); await load(0)
})
it('offline pair rejected drag resets highlight while preserving an already read report', async () => {
  await render(); await drop('a', [file()]); await load(0)
  await drag('a', 'dragenter', { types: ['Files'] }); expect(zone('a').getAttribute('data-offline-drag')).toBe('true')
  await drag('a', 'dragleave', { types: ['Files'] }); expect(zone('a').getAttribute('data-offline-drag')).toBe('false')
  expect(state('a')).toBe('ready'); expect(readers).toHaveLength(1)
})
