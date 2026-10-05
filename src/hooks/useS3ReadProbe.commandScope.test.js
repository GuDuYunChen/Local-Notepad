import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import useS3ReadProbe from './useS3ReadProbe.js'

const input = () => ({ endpoint: 'https://synthetic.invalid', bucket: 'synthetic-bucket', region: 'us-east-1',
  key: '目录/e\u0301.json', accessKeyId: 'AKIASYNTHETIC', secretAccessKey: 'PRIVATE_SECRET', maxBytes: 256, readOnly: true })
const ok = () => ({ success: true, status: 200, code: 'OK', data: { outcome: 'readable', httpStatus: 200, acceptedBytes: 13 } })
const later = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return {promise,resolve,reject} }
let host, root, current, native, previousBridge
function Harness({ revision = 0 }) {
  current=useS3ReadProbe(revision)
  return React.createElement('output', {'data-probe-state':current.result.state}, current.result.code)
}
const render = (revision=0) => act(async()=>root.render(React.createElement(StrictMode,null,React.createElement(Harness,{revision}))))
const drain = () => act(async()=>{await Promise.resolve();await Promise.resolve()})
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  previousBridge=Object.getOwnPropertyDescriptor(window,'electronAPI')
  native=vi.fn(()=>Promise.resolve(ok()))
  Object.defineProperty(window,'electronAPI',{configurable:true,writable:true,value:{s3ProbeRead:native}})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{
  await act(async()=>root.unmount());host.remove()
  if(previousBridge)Object.defineProperty(window,'electronAPI',previousBridge);else delete window.electronAPI
  vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()
})



// Saved event handlers belong to their committed input revision, not merely to
// the component's binding. These regressions use real React/ReactDOM above.
it('S3 hook refuses an old revision read before input reflection or native invocation', async () => {
  await render(0); const oldRead = current.read
  await render(1); let inspected = 0
  const hostile = new Proxy(input(), { getPrototypeOf(target) { inspected++; return Object.getPrototypeOf(target) } })
  let result; await act(async () => { result = await oldRead(hostile) })
  expect(result.code).toBe('stale-input'); expect(result.summary).toBeNull()
  expect(result.serviceStatus).toBe(0); expect(Object.isFrozen(result)).toBe(true)
  expect(inspected).toBe(0); expect(native).not.toHaveBeenCalled()
  expect(host.textContent).toBe('not-checked')
})
it('S3 hook A-B-A revision reuse cannot revive a saved read callback', async () => {
  await render(0); const oldRead = current.read
  await render(1); await render(0)
  let result; await act(async () => { result = await oldRead(input()) })
  expect(result.code).toBe('stale-input'); expect(native).not.toHaveBeenCalled()
  await act(async () => { result = await current.read(input()) })
  expect(result.state).toBe('readable'); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 hook old invalidation cannot clear a newer revision completed summary', async () => {
  await render(0); const oldInvalidate = current.invalidate
  await render(1); await act(async () => { await current.read(input()) })
  const snapshot = current.result; let refusal
  await act(async () => { refusal = oldInvalidate() })
  expect(refusal.code).toBe('stale-input'); expect(refusal.summary).toBeNull()
  expect(current.result).toBe(snapshot); expect(host.textContent).toBe('readable')
  expect(native).toHaveBeenCalledTimes(1)
})
it('S3 hook old invalidation cannot cancel a newer revision pending read', async () => {
  const d = later(); native.mockReturnValue(d.promise)
  await render(0); const oldInvalidate = current.invalidate
  await render(1); let pending
  await act(async () => { pending = current.read(input()); oldInvalidate() })
  expect(host.textContent).toBe('checking'); expect(native).toHaveBeenCalledTimes(1)
  let result; await act(async () => { d.resolve(ok()); result = await pending })
  expect(result.state).toBe('readable'); expect(host.textContent).toBe('readable')
})
it('S3 hook a completed old revision cannot replay a request through its saved handler', async () => {
  await render(0); const oldRead = current.read
  await act(async () => { await oldRead(input()) }); await render(1)
  let result; await act(async () => { result = await oldRead(input()) })
  expect(result.code).toBe('stale-input'); expect(native).toHaveBeenCalledTimes(1)
  expect(host.textContent).toBe('not-checked')
})
it('S3 hook changes both command capabilities only when the rendered revision changes', async () => {
  await render(0); const oldRead = current.read, oldInvalidate = current.invalidate
  await render(1); expect(current.read).not.toBe(oldRead); expect(current.invalidate).not.toBe(oldInvalidate)
  const read = current.read, invalidate = current.invalidate
  await render(1); expect(current.read).toBe(read); expect(current.invalidate).toBe(invalidate)
  expect(native).not.toHaveBeenCalled()
})
it('S3 hook explicit current invalidation without a revision change still allows a fresh explicit read', async () => {
  await render(3); const read = current.read, invalidate = current.invalidate
  await act(async () => { await read(input()); invalidate() })
  expect(host.textContent).toBe('not-checked')
  await act(async () => { await read(input()) })
  expect(host.textContent).toBe('readable'); expect(native).toHaveBeenCalledTimes(2)
})
it('S3 hook callbacks from an unmounted lifetime remain closed after a fresh mount', async () => {
  await render(0); const oldRead = current.read, oldInvalidate = current.invalidate
  await act(async () => root.render(null)); await render(0)
  await act(async () => { await current.read(input()) }); const snapshot = current.result
  let readResult, invalidateResult
  await act(async () => { readResult = await oldRead(input()); invalidateResult = oldInvalidate() })
  expect(readResult.code).toBe('disposed'); expect(invalidateResult.code).toBe('disposed')
  expect(current.result).toBe(snapshot); expect(native).toHaveBeenCalledTimes(1)
})

it('S3 hook a suspended uncommitted revision cannot authorize its commands or revoke the committed revision', async () => {
  const blocked = new Promise(() => {}), handles = new Map()
  function RevisionHarness({ revision, suspend }) {
    const value = useS3ReadProbe(revision); handles.set(revision, value)
    if (suspend) throw blocked
    return React.createElement('output', null, value.result.code)
  }
  const screen = (revision, suspend) => React.createElement(React.Suspense, { fallback: 'waiting' },
    React.createElement(RevisionHarness, { revision, suspend }))
  await act(async () => root.render(screen(0, false)))
  const committedRead = handles.get(0).read
  await act(async () => { React.startTransition(() => root.render(screen(1, true))) })
  expect(handles.has(1)).toBe(true); expect(host.textContent).toBe('not-checked')
  let refusal
  await act(async () => { refusal = await handles.get(1).read(input()) })
  expect(refusal.code).toBe('stale-input'); expect(native).not.toHaveBeenCalled()
  await act(async () => { await committedRead(input()) })
  expect(native).toHaveBeenCalledTimes(1); expect(host.textContent).toBe('readable')
  await act(async () => root.render(screen(0, false)))
  expect(handles.get(0).read).toBe(committedRead)
})
it('S3 hook stale commands leave a new revision denial classification untouched', async () => {
  await render(0); const oldRead = current.read, oldInvalidate = current.invalidate
  await render(1)
  native.mockResolvedValue({ success: false, status: 422, code: 'probe-not-readable',
    data: { outcome: 'access-denied', httpStatus: 403, acceptedBytes: 0 } })
  await act(async () => { await current.read(input()) }); const snapshot = current.result
  await act(async () => { await oldRead(input()); oldInvalidate() })
  expect(current.result).toBe(snapshot); expect(current.result.code).toBe('access-denied')
  expect(native).toHaveBeenCalledTimes(1); expect(host.textContent).not.toMatch(/PRIVATE_|synthetic|AKIA/)
})
