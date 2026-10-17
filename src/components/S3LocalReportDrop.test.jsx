import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Viewer from './S3LocalOverviewFile.jsx'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'
import { parseLocalOverviewFile } from '../services/s3LocalOverviewFile.mjs'
let host, root, readers
const raw = () => JSON.stringify(reportFixture())
const file = (text = raw()) => new File([text], 'PRIVATE_filename.json', { type: 'application/json' })
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const state = () => host.querySelector('[data-local-file-state]').getAttribute('data-local-file-state')
const code = () => host.querySelector('[data-local-report-drop-status]').getAttribute('data-local-report-drop-status')
const render = child => act(async () => root.render(<StrictMode>{child || <Viewer />}</StrictMode>))
async function drag(type, transfer, selector = '[data-local-report-drop]') {
  let event
  await act(async () => {
    event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    host.querySelector(selector).dispatchEvent(event); await flush()
  })
  return event
}
const drop = files => drag('drop', { types: ['Files'], files })
const load = (index = readers.length - 1, text = raw()) => act(async () => {
  const reader = readers[index]; reader.result = new TextEncoder().encode(text).buffer; reader.onload?.(); await flush()
})
const clear = () => act(async () => { host.querySelector('[data-local-report-drop] button').click(); await flush() })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); readers = []
  vi.stubGlobal('FileReader', class {
    constructor() { readers.push(this) }
    readAsArrayBuffer(value) { this.file = value }
    abort() { this.aborted = true }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('report drop UI mounts without reads and retains labeled keyboard file controls', async () => {
  await render(); expect(readers).toHaveLength(0); expect(state()).toBe('idle')
  const zone = host.querySelector('[data-local-report-drop]')
  expect(document.getElementById(zone.getAttribute('aria-labelledby'))).not.toBeNull()
  expect(host.querySelector('input').getAttribute('aria-label')).toBe('选择统计 JSON 报告')
  expect(host.querySelector('button').type).toBe('button')
})
it('report drop UI hover never accesses protected files and nested leaves preserve its highlight', async () => {
  await render(); let reads = 0
  const transfer = { types: ['Files'], get files() { reads++; throw Error('PRIVATE') } }
  await drag('dragenter', transfer); await drag('dragenter', transfer, '[data-local-report-drop] strong')
  await drag('dragleave', transfer, '[data-local-report-drop] strong')
  expect(host.querySelector('[data-local-report-drop]').getAttribute('data-file-drag')).toBe('true')
  await drag('dragover', transfer); expect(transfer.dropEffect).toBe('copy')
  await drag('dragleave', transfer); expect(host.querySelector('[data-local-report-drop]').getAttribute('data-file-drag')).toBe('false')
  expect(reads).toBe(0); expect(readers).toHaveLength(0)
})
it('report drop UI reads one genuine file through the original validator without importing it', async () => {
  const parent = vi.fn(); await render(<div onDrop={parent}><Viewer /></div>)
  const value = file(), event = await drop([value]); expect(event.defaultPrevented).toBe(true); expect(parent).not.toHaveBeenCalled()
  expect(readers).toHaveLength(1); expect(readers[0].file).toBe(value); expect(state()).toBe('reading')
  await load(); expect(state()).toBe('ready'); expect(host.querySelectorAll('tbody tr')).toHaveLength(4)
  expect(host.textContent).toContain('来源和真实性未经验证'); expect(host.textContent).not.toContain('PRIVATE_filename')
})
it('report drop UI multiple-file refusal preserves current result and cannot reach parent import', async () => {
  const parent = vi.fn(); await render(<div onDrop={parent}><Viewer /></div>); await drop([file()]); await load()
  const previous = host.querySelector('[data-local-file-result]').textContent
  await drop([file(), file()]); expect(code()).toBe('drop-one-file'); expect(state()).toBe('ready')
  expect(host.querySelector('[data-local-file-result]').textContent).toBe(previous); expect(readers).toHaveLength(1); expect(parent).not.toHaveBeenCalled()
})
it('report drop UI text and folder refusals never read or navigate', async () => {
  await render(); const event = await drag('drop', { types: ['text/uri-list'], files: [], getData() { throw Error('PRIVATE_URL') } })
  expect(event.defaultPrevented).toBe(true); expect(code()).toBe('drop-file-required')
  await drag('drop', { files: [file()], items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }] })
  expect(code()).toBe('drop-directory'); expect(readers).toHaveLength(0)
  await clear(); expect(code()).toBe('')
})
it('report drop UI malformed and oversized files are not displayed as partial results', async () => {
  await render(); await drop([file()]); await load(); await drop([file('{')]); expect(host.querySelector('[data-local-file-result]')).toBeNull()
  await load(1, '{'); expect(state()).toBe('failed')
  await drop([file(' '.repeat(4097))]); expect(state()).toBe('failed'); expect(readers).toHaveLength(2)
  expect(host.querySelector('[data-local-file-result]')).toBeNull()
})
it('report drop UI replacement revokes late A-B-A reads without changing the original files', async () => {
  await render(); const a = file(); await drop([a]); const first = readers[0].onload
  await drop([file()]); await drop([a]); expect(readers).toHaveLength(3)
  readers[0].result = new TextEncoder().encode(raw()).buffer
  await act(async () => { first(); await flush() }); expect(state()).toBe('reading')
  expect(readers[0].aborted).toBe(true); expect(readers[1].aborted).toBe(true); await load(2); expect(state()).toBe('ready')
})
it('report drop UI stopping or unmounting revokes its queued completion', async () => {
  await render(); await drop([file()]); const late = readers[0].onload; await clear()
  readers[0].result = new TextEncoder().encode(raw()).buffer
  await act(async () => { late(); await flush() }); expect(state()).toBe('idle')
  await drop([file()]); const old = readers[1].onload
  await act(async () => root.render(null)); await render()
  readers[1].result = new TextEncoder().encode(raw()).buffer
  await act(async () => { old(); await flush() }); expect(state()).toBe('idle'); expect(readers[1].aborted).toBe(true)
})
it('report drop UI keeps the original five-second deadline and does not retry', async () => {
  vi.useFakeTimers(); await render(); await drop([file()]); const late = readers[0].onload
  await act(async () => { vi.advanceTimersByTime(5000); await flush() }); expect(state()).toBe('failed')
  readers[0].result = new TextEncoder().encode(raw()).buffer
  await act(async () => { late(); await flush() }); expect(state()).toBe('failed'); expect(readers).toHaveLength(1)
})
it('report drop UI accepted replacement removes an already confirmed comparison export', async () => {
  const local = parseLocalOverviewFile(raw()).summary; await render(<Viewer currentSummary={local} />)
  await drop([file()]); await load(); await act(async () => host.querySelector('[data-local-compare-start]').click())
  expect(host.querySelector('[data-local-compare-export-panel]')).not.toBeNull()
  await drop([file()]); expect(host.querySelector('[data-local-compare-export-panel]')).toBeNull()
  await load(); expect(host.querySelector('[data-local-compare-export-panel]')).toBeNull()
})
it('report drop UI rejected drops do not abort a previously accepted in-flight file', async () => {
  await render(); await drop([file()]); await drop([file(), file()])
  expect(code()).toBe('drop-one-file'); expect(readers[0].aborted).not.toBe(true)
  await load(); expect(state()).toBe('ready'); expect(readers).toHaveLength(1)
})
it('report drop UI does not fetch, persist, copy or invoke a native scan', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), save = vi.spyOn(Storage.prototype, 'setItem'), native = vi.fn()
  vi.stubGlobal('electronAPI', { s3LocalOverviewRead: native })
  await render(); await drop([file()]); await load(); await clear()
  expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled()
})
