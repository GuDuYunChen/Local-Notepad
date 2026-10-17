import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Viewer from './S3LocalOverviewFile.jsx'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'

let host, root, readers
const text = () => JSON.stringify(reportFixture())
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const render = () => act(async () => root.render(<StrictMode><Viewer /></StrictMode>))
const select = (raw = text()) => act(async () => {
  const input = host.querySelector('input')
  Object.defineProperty(input, 'files', { configurable: true, value: raw === null ? [] : [new File([raw], 'private-note-name.json')] })
  input.dispatchEvent(new Event('change', { bubbles: true })); await flush()
})
const load = (index = readers.length - 1, raw = text()) => act(async () => {
  const reader = readers[index]; reader.result = new TextEncoder().encode(raw).buffer; reader.onload?.(); await flush()
})
const clear = () => act(async () => { host.querySelector('button').click(); await flush() })
const state = () => host.querySelector('[data-local-file-state]').getAttribute('data-local-file-state')
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); readers = []
  vi.stubGlobal('FileReader', class {
    constructor() { readers.push(this); this.aborted = false }
    readAsArrayBuffer(file) { this.file = file }
    abort() { this.aborted = true }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('offline report view StrictMode mount does not read a file or scan a workspace', async () => {
  await render(); expect(readers.length).toBe(0); expect(state()).toBe('idle'); expect(host.querySelector('table')).toBeNull()
})
it('offline report view explicit selection renders four categories and file provenance', async () => {
  await render(); await select(); expect(state()).toBe('reading'); await load()
  expect(state()).toBe('ready'); expect(host.querySelectorAll('tbody tr').length).toBe(4)
  expect(host.textContent).toContain('不是当前工作区'); expect(host.textContent).toContain('来源和真实性未经验证')
  expect(host.textContent).not.toContain('private-note-name'); expect(host.querySelector('time').textContent).toBe('2026-10-09T12:00:00.000Z')
})
it('offline report view picker cancellation preserves a completed result', async () => {
  await render(); await select(); await load(); const before = host.textContent
  await select(null); expect(host.textContent).toBe(before); expect(readers.length).toBe(1)
})
it('offline report view replacement clears old statistics while reading and on failure', async () => {
  await render(); await select(); await load(); await select('{'); expect(host.querySelector('table')).toBeNull()
  await load(1, '{'); expect(state()).toBe('failed'); expect(host.querySelector('table')).toBeNull()
})
it('offline report view can reselect the same filename as a fresh operation', async () => {
  await render(); await select(); await load(); await select(); expect(readers.length).toBe(2); await load()
  expect(state()).toBe('ready'); expect(host.querySelector('input').value).toBe('')
})
it('offline report view A-B-A selections cannot revive a stale result', async () => {
  await render(); await select(); const first = readers[0].onload
  await select(); await select(); readers[0].result = new TextEncoder().encode(text()).buffer
  await act(async () => { first(); await flush() }); expect(state()).toBe('reading')
  expect(readers[0].aborted).toBe(true); expect(readers[1].aborted).toBe(true)
  await load(2); expect(state()).toBe('ready')
})
it('offline report view stop clears its view and discards an already queued load callback', async () => {
  await render(); await select(); const late = readers[0].onload; await clear()
  readers[0].result = new TextEncoder().encode(text()).buffer
  await act(async () => { late(); await flush() }); expect(state()).toBe('idle'); expect(host.querySelector('table')).toBeNull()
})
it('offline report view unmount aborts its reader and late completion cannot update a fresh mount', async () => {
  await render(); await select(); const late = readers[0].onload
  await act(async () => root.render(null)); await render()
  readers[0].result = new TextEncoder().encode(text()).buffer
  await act(async () => { late(); await flush() }); expect(state()).toBe('idle'); expect(readers[0].aborted).toBe(true)
})
it('offline report view oversized files are rejected before FileReader construction', async () => {
  await render(); await select(' '.repeat(4097)); expect(state()).toBe('failed'); expect(readers.length).toBe(0)
})
it('offline report view timeout aborts without retry and does not adopt a late load', async () => {
  vi.useFakeTimers(); await render(); await select(); const late = readers[0].onload
  await act(async () => { vi.advanceTimersByTime(5000); await flush() }); expect(state()).toBe('failed'); expect(host.textContent).toContain('超时')
  readers[0].result = new TextEncoder().encode(text()).buffer
  await act(async () => { late(); await flush() }); expect(state()).toBe('failed'); expect(readers.length).toBe(1)
})
it('offline report view never renders untrusted notices as HTML or instructions', async () => {
  const d = reportFixture(); d.notice = '<img src=x onerror=PRIVATE>PRIVATE_restore_now'
  const raw = JSON.stringify(d); await render(); await select(raw); await load(0, raw)
  expect(state()).toBe('ready'); expect(host.textContent).not.toContain('PRIVATE'); expect(host.querySelector('img')).toBeNull()
})
it('offline report view exposes labeled file controls, table headings and non-submit clearing', async () => {
  await render(); await select(); await load()
  const input = host.querySelector('input'); expect(input.getAttribute('aria-label')).toBe('选择统计 JSON 报告')
  expect(document.getElementById(input.getAttribute('aria-describedby'))).not.toBeNull()
  expect(host.querySelector('button').type).toBe('button'); expect(host.querySelectorAll('th[scope=row]').length).toBe(4)
  await clear(); expect(host.querySelector('table')).toBeNull()
})
it('offline report view does not fetch, copy, persist or use an IPC method', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('not allowed'))
  const save = vi.spyOn(Storage.prototype, 'setItem')
  await render(); await select(); await load(); await clear()
  expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
})
