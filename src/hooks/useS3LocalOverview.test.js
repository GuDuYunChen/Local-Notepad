import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import useS3LocalOverview from './useS3LocalOverview.js'
import { localOverviewIntent, localOverviewSuccess } from '../../scripts/s3-local-overview-binding-cases.mjs'
const ok = () => ({ success: true, status: 200, code: 'OK', data: localOverviewSuccess().data })
const later = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
let host, root, current, native, previousBridge
function Harness({ revision = 0 }) {
  current = useS3LocalOverview(revision)
  return React.createElement('output', { 'data-local-overview-state': current.result.state },
    `${current.result.code}:${current.result.summary?.records ?? '-'}:${current.result.limitation}`)
}
const render = (revision = 0) => act(async () => root.render(React.createElement(StrictMode, null, React.createElement(Harness, { revision }))))
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  previousBridge = Object.getOwnPropertyDescriptor(window, 'electronAPI')
  native = vi.fn(async () => ok())
  Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: { s3LocalOverviewRead: native } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  if (previousBridge) Object.defineProperty(window, 'electronAPI', previousBridge)
  else delete window.electronAPI
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('S3 local overview hook survives StrictMode setup cleanup replay without implicit native I/O', async () => {
  await render(); expect(current.result.code).toBe('not-checked'); expect(native).not.toHaveBeenCalled()
  await act(async () => { await current.read(localOverviewIntent()) })
  expect(current.result.state).toBe('ready'); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 local overview hook commands and snapshots stay stable across an unchanged revision render', async () => {
  await render(2); const read = current.read, invalidate = current.invalidate, result = current.result
  await render(2); expect(current.read).toBe(read); expect(current.invalidate).toBe(invalidate); expect(current.result).toBe(result)
  expect(native).not.toHaveBeenCalled()
})
it('S3 local overview hook renders pending then validated counts without credentials or record content', async () => {
  const d = later(); native.mockReturnValue(d.promise); await render(); let pending
  await act(async () => { pending = current.read(localOverviewIntent()) })
  expect(host.firstChild.dataset.localOverviewState).toBe('pending')
  await act(async () => { d.resolve(ok()); await pending })
  expect(host.firstChild.dataset.localOverviewState).toBe('ready'); expect(current.result.summary.records).toBe(2)
  expect(Object.isFrozen(current.result.summary.kinds[0])).toBe(true)
  expect(host.textContent).not.toMatch(/PRIVATE_|AKIASYNTHETIC|synthetic\.invalid/)
})
it('S3 local overview hook duplicate read is offline and does not overwrite the pending display', async () => {
  const d = later(); native.mockReturnValue(d.promise); await render(); let pending, blocked, touched = 0
  await act(async () => {
    pending = current.read(localOverviewIntent())
    blocked = await current.read(new Proxy({}, { ownKeys() { touched++; return [] } }))
  })
  expect(blocked.code).toBe('session-busy'); expect(touched).toBe(0)
  expect(current.result.state).toBe('pending'); expect(native).toHaveBeenCalledTimes(1)
  await act(async () => { d.resolve(ok()); await pending }); expect(current.result.state).toBe('ready')
})
it('S3 local overview hook committed A-B-A changes suppress the outstanding result without replay', async () => {
  const d = later(); native.mockReturnValue(d.promise); await render(0); let pending
  await act(async () => { pending = current.read(localOverviewIntent()) })
  await render(1); await render(0)
  expect((await pending).code).toBe('wait-stopped')
  await act(async () => { d.resolve(ok()) }); await flush()
  expect(current.result.summary).toBeNull(); expect(native).toHaveBeenCalledTimes(1)
  native.mockResolvedValue(ok()); await act(async () => { await current.read(localOverviewIntent()) })
  expect(current.result.state).toBe('ready')
})
it('S3 local overview hook input-handler invalidation is synchronous before a deferred revision commit', async () => {
  const d = later(); native.mockReturnValue(d.promise); await render(); let pending
  await act(async () => { pending = current.read(localOverviewIntent()); current.invalidate() })
  expect((await pending).code).toBe('wait-stopped'); expect(current.result.summary).toBeNull()
  await act(async () => { d.resolve(ok()) }); await flush(); expect(current.result.summary).toBeNull()
})
it('S3 local overview hook changed committed revision clears a completed summary without fetching', async () => {
  await render(); await act(async () => { await current.read(localOverviewIntent()) })
  expect(current.result.state).toBe('ready')
  await render(1); expect(current.result.code).toBe('not-checked'); expect(current.result.summary).toBeNull()
  expect(native).toHaveBeenCalledTimes(1)
})
it('S3 local overview hook old read refuses before payload reflection and cannot replay after A-B-A', async () => {
  await render(0); const old = current.read; await render(1); await render(0)
  let touched = 0, out
  const hostile = new Proxy(localOverviewIntent(), { getPrototypeOf(target) { touched++; return Object.getPrototypeOf(target) } })
  await act(async () => { out = await old(hostile) })
  expect(out.code).toBe('stale-input'); expect(out.summary).toBeNull(); expect(touched).toBe(0)
  expect(native).not.toHaveBeenCalled(); expect(current.result.code).toBe('not-checked')
})
it('S3 local overview hook old invalidate cannot clear a new revision completed summary', async () => {
  await render(0); const old = current.invalidate; await render(1)
  await act(async () => { await current.read(localOverviewIntent()) }); const saved = current.result
  let out; await act(async () => { out = old() })
  expect(out.code).toBe('stale-input'); expect(current.result).toBe(saved); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 local overview hook old invalidate cannot stop a new revision pending request', async () => {
  const d = later(); native.mockReturnValue(d.promise); await render(0); const old = current.invalidate
  await render(1); let pending
  await act(async () => { pending = current.read(localOverviewIntent()); expect(old().code).toBe('stale-input') })
  expect(current.result.state).toBe('pending')
  await act(async () => { d.resolve(ok()); await pending }); expect(current.result.state).toBe('ready')
})
it('S3 local overview hook current same-revision explicit invalidation permits a deliberate recheck', async () => {
  await render(3); const read = current.read, invalidate = current.invalidate
  await act(async () => { await read(localOverviewIntent()); invalidate() })
  expect(current.result.code).toBe('not-checked')
  await act(async () => { await read(localOverviewIntent()) })
  expect(current.read).toBe(read); expect(current.result.state).toBe('ready'); expect(native).toHaveBeenCalledTimes(2)
})
for (const completion of ['resolve', 'reject']) it(`S3 local overview hook unmount rejects saved commands and late ${completion} cannot affect a fresh mount`, async () => {
  const d = later(); native.mockReturnValue(d.promise); await render()
  const oldRead = current.read, oldInvalidate = current.invalidate; let pending
  await act(async () => { pending = oldRead(localOverviewIntent()) })
  await act(async () => root.render(null)); expect((await pending).code).toBe('disposed')
  native.mockResolvedValue(ok()); await render(); await act(async () => { await current.read(localOverviewIntent()) })
  const saved = current.result
  expect((await oldRead(localOverviewIntent())).code).toBe('disposed'); expect(oldInvalidate().code).toBe('disposed')
  await act(async () => { d[completion](completion === 'resolve' ? ok() : Error('PRIVATE_LATE')) }); await flush()
  expect(current.result).toBe(saved); expect(native).toHaveBeenCalledTimes(2)
})
it('S3 local overview hook timeout updates the component but does not imply native cancellation or auto retry', async () => {
  vi.useFakeTimers(); const d = later(); native.mockReturnValue(d.promise); await render(); let pending, busy
  await act(async () => { pending = current.read(localOverviewIntent()) })
  await act(async () => { vi.advanceTimersByTime(10000) })
  expect((await pending).code).toBe('wait-timeout'); expect(current.result.code).toBe('wait-timeout')
  await act(async () => { busy = await current.read(localOverviewIntent()) })
  expect(busy.code).toBe('session-busy'); expect(native).toHaveBeenCalledTimes(1)
  await act(async () => { d.resolve(ok()) }); await flush(); expect(current.result.code).toBe('wait-timeout')
})
it('S3 local overview hook missing native method never falls back to browser fetch', async () => {
  delete window.electronAPI
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('unexpected fetch') })
  await render(); await act(async () => { await current.read(localOverviewIntent()) })
  expect(current.result.code).toBe('native-unavailable'); expect(fetch).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled()
})
it('S3 local overview hook invalid input and invalid statistics never display partial counts', async () => {
  await render()
  await act(async () => { await current.read({ readOnly: false }) })
  expect(current.result.code).toBe('invalid-input'); expect(native).not.toHaveBeenCalled()
  const raw = ok(); raw.data.records = 99; native.mockResolvedValue(raw)
  await act(async () => { await current.read(localOverviewIntent()) })
  expect(current.result.code).toBe('invalid-reply'); expect(current.result.summary).toBeNull()
})
it('S3 local overview hook service refusal remains fixed and old commands do not overwrite it', async () => {
  await render(0); const oldRead = current.read, oldInvalidate = current.invalidate; await render(1)
  native.mockResolvedValue({ success: false, status: 422, code: 'local-overview-not-available', data: null })
  await act(async () => { await current.read(localOverviewIntent()) }); const snapshot = current.result
  await act(async () => { await oldRead(localOverviewIntent()); oldInvalidate() })
  expect(current.result).toBe(snapshot); expect(snapshot.code).toBe('local-overview-not-available'); expect(snapshot.summary).toBeNull()
  expect(snapshot.limitation).toContain('不代表原子快照'); expect(host.textContent).not.toMatch(/PRIVATE_|AKIASYNTHETIC/)
})
it('S3 local overview hook an uncommitted suspended revision cannot authorize commands or revoke the visible one', async () => {
  const blocked = new Promise(() => {}), handles = new Map()
  function RevisionHarness({ revision, suspend }) {
    const value = useS3LocalOverview(revision); handles.set(revision, value)
    if (suspend) throw blocked
    return React.createElement('output', null, value.result.code)
  }
  const screen = (revision, suspend) => React.createElement(React.Suspense, { fallback: 'waiting' }, React.createElement(RevisionHarness, { revision, suspend }))
  await act(async () => root.render(screen(0, false)))
  const visible = handles.get(0).read
  await act(async () => { React.startTransition(() => root.render(screen(1, true))) })
  expect(handles.has(1)).toBe(true); expect(host.textContent).toBe('not-checked')
  let out; await act(async () => { out = await handles.get(1).read(localOverviewIntent()) })
  expect(out.code).toBe('stale-input'); expect(native).not.toHaveBeenCalled()
  await act(async () => { await visible(localOverviewIntent()) })
  expect(host.textContent).toBe('ready'); expect(native).toHaveBeenCalledTimes(1)
  await act(async () => root.render(screen(0, false))); expect(handles.get(0).read).toBe(visible)
})
