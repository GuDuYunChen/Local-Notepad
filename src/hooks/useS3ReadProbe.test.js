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

it('S3 hook survives StrictMode setup-cleanup replay without an implicit read',async()=>{
  await render();expect(host.textContent).toBe('not-checked');expect(native).not.toHaveBeenCalled()
  let result;await act(async()=>{result=await current.read(input())})
  expect(result.state).toBe('readable');expect(host.textContent).toBe('readable');expect(native).toHaveBeenCalledTimes(1)
})
it('S3 hook exposes stable read and invalidate callbacks across an ordinary rerender',async()=>{
  await render();const read=current.read,invalidate=current.invalidate
  await render();expect(current.read).toBe(read);expect(current.invalidate).toBe(invalidate);expect(native).not.toHaveBeenCalled()
})
it('S3 hook publishes pending then a whitelisted result without rendering credentials',async()=>{
  const d=later();native.mockReturnValue(d.promise);await render();let first
  await act(async()=>{first=current.read(input())})
  expect(host.dataset.probeState).toBeUndefined();expect(host.firstChild.dataset.probeState).toBe('pending')
  await act(async()=>{d.resolve(ok());await first})
  expect(host.firstChild.dataset.probeState).toBe('readable');expect(host.textContent).not.toMatch(/PRIVATE_|synthetic|AKIA/)
  expect(Object.isFrozen(current.result)).toBe(true)
})
it('S3 hook duplicate invocation cannot replace a pending result or start a second native call',async()=>{
  const d=later();native.mockReturnValue(d.promise);await render();let first,second
  await act(async()=>{first=current.read(input());second=await current.read(input())})
  expect(second.code).toBe('session-busy');expect(host.textContent).toBe('checking');expect(native).toHaveBeenCalledTimes(1)
  await act(async()=>{d.resolve(ok());await first});expect(host.textContent).toBe('readable')
})
it('S3 hook committed revision changes invalidate A-B-A and never adopt the prior success',async()=>{
  const d=later();native.mockReturnValue(d.promise);await render(0);let first
  await act(async()=>{first=current.read(input())});await render(1);await render(2)
  expect((await first).code).toBe('wait-stopped');expect(host.textContent).toBe('wait-stopped')
  await act(async()=>{d.resolve(ok())});await drain();expect(host.textContent).toBe('wait-stopped')
  native.mockResolvedValue(ok());await act(async()=>{await current.read(input())});expect(host.textContent).toBe('readable')
})
it('S3 hook immediate invalidation does not wait for a later React commit',async()=>{
  const d=later();native.mockReturnValue(d.promise);await render();let first
  await act(async()=>{first=current.read(input());current.invalidate()})
  expect((await first).code).toBe('wait-stopped');expect(host.textContent).toBe('wait-stopped')
  await act(async()=>{d.reject(new Error('PRIVATE_SECRET'))});await drain();expect(host.textContent).toBe('wait-stopped')
})
it('S3 hook clears a completed summary on a new committed input revision without reading',async()=>{
  await render();await act(async()=>{await current.read(input())});expect(current.result.summary.acceptedBytes).toBe(13)
  await render(1);expect(current.result.summary).toBeNull();expect(host.textContent).toBe('not-checked');expect(native).toHaveBeenCalledTimes(1)
})
for(const mode of ['resolve','reject'])it(`S3 hook unmount suppresses late ${mode}, closes saved callbacks and allows a clean fresh mount`,async()=>{
  const d=later();native.mockReturnValue(d.promise);await render();const oldRead=current.read;let first
  await act(async()=>{first=oldRead(input())});await act(async()=>root.render(null))
  expect((await first).code).toBe('disposed');expect((await oldRead(input())).code).toBe('disposed')
  await render();expect(host.textContent).toBe('not-checked')
  await act(async()=>{d[mode](mode==='resolve'?ok():new Error('PRIVATE_SECRET'))});await drain()
  expect(host.textContent).toBe('not-checked');expect(native).toHaveBeenCalledTimes(1)
})
it('S3 hook waiting timeout is observable without native cancellation or an automatic retry',async()=>{
  vi.useFakeTimers();const d=later();native.mockReturnValue(d.promise);await render();let first
  await act(async()=>{first=current.read(input())});await act(async()=>{vi.advanceTimersByTime(10000)})
  expect((await first).code).toBe('wait-timeout');expect(host.textContent).toBe('wait-timeout')
  let result;await act(async()=>{result=await current.read(input())});expect(result.code).toBe('session-busy');expect(native).toHaveBeenCalledTimes(1)
  await act(async()=>{d.resolve(ok())});await drain();expect(host.textContent).toBe('wait-timeout')
})
it('S3 hook missing native capability returns an unavailable view and never falls back to fetch',async()=>{
  delete window.electronAPI;const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw new Error('unexpected fetch')})
  await render();await act(async()=>{await current.read(input())})
  expect(host.textContent).toBe('native-unavailable');expect(fetch).not.toHaveBeenCalled();expect(native).not.toHaveBeenCalled()
})
it('S3 hook preserves denied-object meaning and renders no raw service text',async()=>{
  native.mockResolvedValue({success:false,status:422,code:'probe-not-readable',data:{outcome:'access-denied',httpStatus:403,acceptedBytes:0}})
  await render();await act(async()=>{await current.read(input())})
  expect(current.result.message).toContain('不能据此判断密码错误');expect(current.result.limitation).toContain('不验证凭据有效性')
  expect(current.result.summary.acceptedBytes).toBe(0)
})
