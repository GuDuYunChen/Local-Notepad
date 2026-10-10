import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Viewer from './S3LocalOverviewFile.jsx'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'

let host, root, readers
const raw = () => JSON.stringify(reportFixture())
const file = () => new File([raw()], 'isolated-report.json', { type: 'application/json' })
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const code = () => host.querySelector('[data-local-report-drop-status]').getAttribute('data-local-report-drop-status')
const state = () => host.querySelector('[data-local-file-state]').getAttribute('data-local-file-state')
async function send(type, transfer) {
  let event
  await act(async () => {
    event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    host.querySelector('[data-local-report-drop]').dispatchEvent(event); await flush()
  })
  return event
}
const render = parent => act(async () => root.render(<StrictMode><div onDragEnter={parent} onDragOver={parent} onDrop={parent}><Viewer /></div></StrictMode>))
const load = () => act(async () => {
  readers[0].result = new TextEncoder().encode(raw()).buffer; readers[0].onload(); await flush()
})
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); readers = []
  vi.stubGlobal('FileReader', class {
    constructor() { readers.push(this) }
    readAsArrayBuffer(value) { this.file = value }
    abort() { this.aborted = true }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('report hover UI replaces an old refusal for text without a drop event or changing the report', async () => {
  const parent = vi.fn(); await render(parent)
  await send('drop', { types: ['Files'], files: [file()] }); await load()
  const previous = host.querySelector('[data-local-file-result]').textContent
  await send('drop', { types: ['Files'], files: [file(), file()] }); expect(code()).toBe('drop-one-file')
  const transfer = { types: ['text/plain'], get files() { throw Error('protected files') }, getData() { throw Error('private text') } }
  const entered = await send('dragenter', transfer)
  expect(entered.defaultPrevented).toBe(true); expect(code()).toBe('drop-file-required')
  await send('dragover', transfer); expect(transfer.dropEffect).toBe('none')
  // Chromium can end this forbidden drag with dragleave and no drop at all.
  await send('dragleave', transfer)
  expect(state()).toBe('ready'); expect(host.querySelector('[data-local-file-result]').textContent).toBe(previous)
  expect(code()).toBe('drop-file-required'); expect(readers).toHaveLength(1); expect(parent).not.toHaveBeenCalled()
})

it('report hover UI rejects a link during an existing read without cancelling or restarting it', async () => {
  const parent = vi.fn(); await render(parent)
  await send('drop', { types: ['Files'], files: [file()] }); expect(state()).toBe('reading')
  const transfer = { types: ['text/uri-list'], get files() { throw Error('protected files') }, getData() { throw Error('private URL') } }
  await send('dragover', transfer)
  expect(transfer.dropEffect).toBe('none'); expect(code()).toBe('drop-file-required')
  expect(readers).toHaveLength(1); expect(readers[0].aborted).not.toBe(true); expect(state()).toBe('reading')
  await load(); expect(state()).toBe('ready'); expect(parent).not.toHaveBeenCalled()
})
