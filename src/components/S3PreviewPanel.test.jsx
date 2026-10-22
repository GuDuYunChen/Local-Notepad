import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import S3PreviewPanel from './S3PreviewPanel.jsx'
import { previewPayload, previewSuccess } from '../../scripts/s3-preview-bridge-cases.mjs'

const ok = () => ({ success: true, status: 200, code: 'OK', data: previewSuccess().data })
const later = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
let host, root, native, priorBridge, input
const render = (props = {}) => act(async () => root.render(React.createElement(StrictMode, null,
  React.createElement(S3PreviewPanel, { request: input, ...props }))))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const click = text => act(async () => button(text).click())
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const noSecrets = () => expect(host.innerHTML).not.toMatch(/PRIVATE_|AKIASYNTHETIC|synthetic\.invalid|secretAccessKey|localRecords/)
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  priorBridge = Object.getOwnPropertyDescriptor(window, 'electronAPI')
  native = vi.fn(async () => ok()); input = previewPayload()
  Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: { s3PreviewRead: native } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  if (priorBridge) Object.defineProperty(window, 'electronAPI', priorBridge)
  else delete window.electronAPI
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('S3 preview panel StrictMode mounting is offline and does not inspect request properties', async () => {
  let reads = 0
  const request = new Proxy({}, { ownKeys() { reads++; throw Error('PRIVATE_INPUT') } })
  await render({ request }); expect(reads).toBe(0); expect(native).not.toHaveBeenCalled()
  expect(host.textContent).toContain('尚未进行只读预览'); noSecrets()
})
it('S3 preview panel without an input cannot request or scan for one', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('unexpected HTTP') })
  await render({ request: null }); expect(button('预览差异').disabled).toBe(true)
  await click('预览差异'); expect(native).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  expect(host.querySelector('table')).toBeNull(); expect(host.textContent).toContain('尚未提供完整的只读比较输入')
})
it('S3 preview panel explicit click sends one request and repeated pending click stays offline', async () => {
  const d = later(); native.mockReturnValue(d.promise); await render(); await click('预览差异')
  expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0][0]).toEqual(input)
  expect(button('正在预览').disabled).toBe(true); await click('正在预览'); expect(native).toHaveBeenCalledTimes(1)
  expect(host.querySelector('table')).toBeNull(); expect(host.querySelector('[role=status]').textContent).toContain('正在等待')
  await act(async () => d.resolve(ok())); await flush()
  expect(host.querySelector('table')).not.toBeNull(); noSecrets()
})
it('S3 preview panel presents all four validated kinds without identities or credential fields', async () => {
  await render(); await click('预览差异')
  expect([...host.querySelectorAll('tbody th')].map(n => n.textContent)).toEqual(['笔记与文件夹', '标签', '文件—标签关系', '附件元数据'])
  expect(host.querySelectorAll('dl dd')).toHaveLength(5); expect(host.querySelectorAll('tbody td')).toHaveLength(20)
  expect(host.textContent).toContain('附件这里只展示元数据统计'); noSecrets()
})
it('S3 preview panel conflicts stay prominent even when the request succeeds', async () => {
  await render(); await click('预览差异')
  expect(host.querySelector('[role=status] strong').textContent).toBe('有候选冲突，需要人工审阅')
  expect(host.textContent).toContain('不会覆盖、合并或删除任何数据')
  expect(host.querySelectorAll('button')).toHaveLength(1)
  expect(host.textContent).toContain('不代表同步完成')
})
it('S3 preview panel verified zero counts are not described as an empty bucket or deletion consent', async () => {
  const raw = ok()
  for (const key of Object.keys(raw.data.counts)) raw.data.counts[key] = 0
  for (const row of raw.data.kinds) for (const key of Object.keys(row.counts)) row.counts[key] = 0
  native.mockResolvedValue(raw); await render(); await click('预览差异')
  expect([...host.querySelectorAll('dl dd')].every(n => n.textContent === '0')).toBe(true)
  expect(host.textContent).toContain('不代表远端为空'); expect(host.textContent).toContain('不是初始化或删除本地数据的许可')
})
it('S3 preview panel invalid statistics show a fixed refusal rather than partial counts', async () => {
  const raw = ok(); raw.data.counts.conflicts = 99; native.mockResolvedValue(raw)
  await render(); await click('预览差异'); expect(host.querySelector('table')).toBeNull()
  expect(host.querySelector('dl')).toBeNull(); expect(host.textContent).toContain('未采纳其中的数据'); noSecrets()
})
it('S3 preview panel invalid input fails locally without native I/O', async () => {
  await render({ request: { readOnly: false } }); await click('预览差异')
  expect(native).not.toHaveBeenCalled(); expect(host.textContent).toContain('未调用原生桥'); expect(host.querySelector('table')).toBeNull()
})
it('S3 preview panel absent native method never uses browser fetch', async () => {
  delete window.electronAPI
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('unexpected fetch') })
  await render(); await click('预览差异'); expect(fetch).not.toHaveBeenCalled()
  expect(host.textContent).toContain('不会改走浏览器网络请求'); expect(host.querySelector('table')).toBeNull()
})
it('S3 preview panel native error text never becomes visible content', async () => {
  native.mockRejectedValue(Error('PRIVATE_NATIVE_DETAILS')); await render(); await click('预览差异')
  expect(host.textContent).toContain('本次预览未完成'); noSecrets(); expect(host.querySelector('table')).toBeNull()
})
it('S3 preview panel service refusal cannot be mistaken for valid credentials or empty success', async () => {
  native.mockResolvedValue({ success: false, status: 422, code: 'preview-not-available', data: null })
  await render(); await click('预览差异'); expect(host.querySelector('table')).toBeNull()
  expect(host.textContent).toContain('不会推断凭据或权限'); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 preview panel stopping adoption hides a late success without dispatching cancellation or retries', async () => {
  const d = later(); native.mockReturnValue(d.promise); await render(); await click('预览差异'); await click('停止采用')
  expect(host.textContent).toContain('不证明原生读取已经取消或结束')
  await act(async () => d.resolve(ok())); await flush(); expect(host.querySelector('table')).toBeNull()
  expect(native).toHaveBeenCalledTimes(1); noSecrets()
})
it('S3 preview panel timeout permits an explicit attempt but cannot bypass native ownership', async () => {
  vi.useFakeTimers(); const d = later(); native.mockReturnValue(d.promise); await render(); await click('预览差异')
  await act(async () => vi.advanceTimersByTime(10000)); expect(host.textContent).toContain('等待预览超时')
  await click('预览差异'); expect(native).toHaveBeenCalledTimes(1); expect(host.querySelector('table')).toBeNull()
  await act(async () => d.resolve(ok())); await flush(); expect(host.querySelector('table')).toBeNull()
  native.mockResolvedValue(ok()); await click('预览差异'); expect(native).toHaveBeenCalledTimes(2)
  expect(host.querySelector('table')).not.toBeNull()
})
it('S3 preview panel replacing a request object clears old counts even at the same revision', async () => {
  await render(); await click('预览差异'); expect(host.querySelector('table')).not.toBeNull()
  input = previewPayload(); input.connection.prefix = 'changed'
  await render(); expect(host.querySelector('table')).toBeNull(); expect(native).toHaveBeenCalledTimes(1)
  await click('预览差异'); expect(native).toHaveBeenCalledTimes(2); expect(native.mock.calls[1][0].connection.prefix).toBe('changed')
})
it('S3 preview panel committed revision changes invalidate an otherwise identical request reference', async () => {
  await render({ revision: 1 }); await click('预览差异'); await render({ revision: 2 })
  expect(host.querySelector('table')).toBeNull(); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 preview panel A-B-A revisions never revive an outstanding result', async () => {
  const d = later(); native.mockReturnValue(d.promise); await render({ revision: 1 }); await click('预览差异')
  await render({ revision: 2 }); await render({ revision: 1 }); await act(async () => d.resolve(ok())); await flush()
  expect(host.querySelector('table')).toBeNull(); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 preview panel disabling invalidates counts and reenabling never auto-previews', async () => {
  await render(); await click('预览差异'); await render({ disabled: true })
  expect(button('预览差异').disabled).toBe(true); expect(host.querySelector('table')).toBeNull()
  await render({ disabled: false }); expect(native).toHaveBeenCalledTimes(1); expect(host.querySelector('table')).toBeNull()
})
it('S3 preview panel removing input hides previous counts and disables further reads', async () => {
  await render(); await click('预览差异'); await render({ request: null })
  expect(host.querySelector('table')).toBeNull(); expect(button('预览差异').disabled).toBe(true); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 preview panel unchanged props rerender retains the verified view without a new call', async () => {
  await render(); await click('预览差异'); const before = host.textContent
  await render(); expect(host.textContent).toBe(before); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 preview panel unmount and fresh mount isolate late completion', async () => {
  const d = later(); native.mockReturnValue(d.promise); await render(); await click('预览差异')
  await act(async () => root.render(null)); await render(); await act(async () => d.resolve(ok())); await flush()
  expect(host.querySelector('table')).toBeNull(); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 preview panel labels remain unique across instances and point at real DOM nodes', async () => {
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(S3PreviewPanel), React.createElement(S3PreviewPanel))))
  const sections = [...host.querySelectorAll('section')], ids = sections.map(s => s.getAttribute('aria-labelledby'))
  expect(new Set(ids).size).toBe(2)
  for (const s of sections) {
    expect(document.getElementById(s.getAttribute('aria-labelledby')).textContent).toBe('S3 只读预览')
    expect(document.getElementById(s.getAttribute('aria-describedby')).textContent).toContain('不代表同步完成')
  }
  expect(native).not.toHaveBeenCalled()
})
it('S3 preview panel controls cannot submit an enclosing settings form', async () => {
  const submit = vi.fn(e => e.preventDefault())
  await act(async () => root.render(React.createElement('form', { onSubmit: submit }, React.createElement(S3PreviewPanel, { request: input }))))
  expect([...host.querySelectorAll('button')].every(b => b.type === 'button')).toBe(true)
  await click('预览差异'); expect(submit).not.toHaveBeenCalled(); expect(native).toHaveBeenCalledTimes(1)
})
it('S3 preview panel table is captioned with column and row headers and keyboard scroll access', async () => {
  await render(); await click('预览差异')
  expect(host.querySelector('caption').textContent).toBe('对象类型与候选数量')
  expect(host.querySelectorAll('thead th[scope=col]')).toHaveLength(6)
  expect(host.querySelectorAll('tbody th[scope=row]')).toHaveLength(4)
  const region = host.querySelector('[role=region]'); expect(region.tabIndex).toBe(0)
  region.focus(); expect(document.activeElement).toBe(region)
  expect(host.querySelector('[role=status]').getAttribute('aria-live')).toBe('polite')
})
it('S3 preview panel CSS contains narrow-layout scrolling and focus treatment without fixed light-only text', () => {
  const css = readFileSync('src/components/S3PreviewPanel.css', 'utf8')
  expect(css).toContain('overflow-x: auto'); expect(css).toContain('@media (max-width: 620px)')
  expect(css).toContain(':focus-visible'); expect(css).toContain('color: var(--ink, var(--fg))')
  expect(css).not.toMatch(/color:\s*(?:white|black|#[\da-f]+)/i)
})
