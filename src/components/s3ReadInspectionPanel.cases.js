import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import S3ReadInspectionPanel from './S3ReadInspectionPanel.js'

// The same DOM contracts can run in Vitest/jsdom and an actual browser. No test
// library shim, native network or production lifecycle replacement is required.
const demand = (value, message) => { if (!value) throw new Error(message) }
const good = (bytes = 0) => ({ success: true, status: 200, code: 'OK', data: { outcome: 'readable', httpStatus: 200, acceptedBytes: bytes } })
const values = { endpoint: 'https://storage.example', bucket: 'sample-bucket', region: 'us-east-1', prefix: '研究/e\u0301', key: '中文/%2F/片段.json', accessKeyId: 'SYNTHETICID', secretAccessKey: 'TEST_SECRET/+=', sessionToken: 'TEST_TOKEN/+=' }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function fixture(invoke, check) {
  const oldBridge = Object.getOwnPropertyDescriptor(window, 'electronAPI'), oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const calls = [], host = document.createElement('div'); document.body.appendChild(host)
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { s3ProbeRead(payload) { calls.push(payload); return invoke(payload) } } })
  const root = createRoot(host)
  const button = name => [...host.querySelectorAll('button')].find(el => el.textContent === name)
  const click = async name => { const el = button(name); demand(el, 'Missing button ' + name); await act(async () => el.click()) }
  const input = name => host.querySelector('input[name="' + name + '"]')
  const fill = async (name, value) => act(async () => {
    const el = input(name); demand(el, 'Missing field ' + name)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const complete = async () => {
    await click('打开云端只读检查')
    for (const [key, value] of Object.entries(values)) await fill(key, value)
    await act(async () => host.querySelector('input[type="checkbox"]').click())
  }
  const state = () => host.querySelector('.s3-inspection-result')?.dataset.state
  try {
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(S3ReadInspectionPanel))))
    await check({ host, root, calls, button, click, input, fill, complete, state })
  } finally {
    await act(async () => root.unmount()); host.remove()
    if (oldBridge) Object.defineProperty(window, 'electronAPI', oldBridge); else delete window.electronAPI
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
  }
}
export function registerS3ReadInspectionPanelTests(test) {
  test('inspection panel opens without native I/O and focuses the first field', async () => fixture(() => good(), async f => {
    demand(f.calls.length === 0, 'Mount must not read'); await f.click('打开云端只读检查')
    demand(f.calls.length === 0, 'Open must not read'); demand(document.activeElement === f.input('endpoint'), 'First field must have focus')
    demand(f.input('secretAccessKey').type === 'password', 'Secret must be masked')
  }))
  test('invalid inspection form reports errors and never calls native', async () => fixture(() => good(), async f => {
    await f.click('打开云端只读检查'); await f.click('开始只读检查')
    demand(f.calls.length === 0, 'Invalid form called native'); demand(f.host.querySelector('[role="alert"]'), 'Missing error summary')
    demand(f.input('endpoint').getAttribute('aria-invalid') === 'true', 'Missing invalid field state')
  }))
  test('valid inspection payload preserves text and displays zero-byte success', async () => fixture(() => good(), async f => {
    await f.complete(); await f.click('开始只读检查'); demand(f.state() === 'readable', 'Success not shown')
    for (const [key, value] of Object.entries(values)) demand(f.calls[0][key] === value, 'Input changed: ' + key)
    demand(f.host.querySelector('.s3-inspection-metrics').textContent.includes('0 B'), 'Zero-byte result was omitted')
    demand(!f.host.textContent.includes('TEST_SECRET'), 'Secret leaked into result text')
  }))
  test('inspection stop retains the old slot, rejects late adoption and allows explicit retry', async () => {
    const d = deferred(); let calls = 0
    await fixture(() => ++calls === 1 ? d.promise : good(3), async f => {
      await f.complete(); await f.click('开始只读检查'); demand(f.state() === 'pending', 'No pending state')
      await f.click('停止采用'); await f.click('重新检查'); demand(f.calls.length === 1, 'Busy retry read again')
      demand(f.host.textContent.includes('上一次原生调用尚未返回'), 'Busy refusal not visible')
      await act(async () => d.resolve(good(88))); demand(f.state() === 'stopped', 'Late success adopted')
      await f.click('重新检查'); demand(f.state() === 'readable' && f.calls.length === 2, 'Explicit retry failed')
    })
  })
  test('inspection input A-B-A never restores an obsolete completed result', async () => fixture(() => good(9), async f => {
    await f.complete(); await f.click('开始只读检查'); await f.fill('key', 'B'); await f.fill('key', values.key)
    demand(f.calls.length === 1, 'Edit triggered I/O'); demand(!f.host.querySelector('.s3-inspection-metrics'), 'Old summary revived')
  }))
  test('inspection 403 gives no password verdict and supports manual recovery', async () => {
    let calls = 0
    await fixture(() => ++calls === 1 ? { success: false, status: 422, code: 'probe-not-readable', data: { outcome: 'access-denied', httpStatus: 403, acceptedBytes: 0 } } : good(), async f => {
      await f.complete(); await f.click('开始只读检查'); demand(f.state() === 'failed', '403 accepted')
      demand(f.host.textContent.includes('不能据此判断密码错误'), 'Incorrect permission explanation')
      await f.click('重新检查'); demand(f.state() === 'readable', 'Retry failed')
    })
  })
  test('inspection close restores focus only after the entry is enabled and drops credentials', async () => fixture(() => good(), async f => {
    await f.complete(); await f.click('关闭并清空'); demand(document.activeElement === f.button('打开云端只读检查'), 'Entry focus not restored')
    await f.click('打开云端只读检查')
    for (const key of Object.keys(values)) demand(f.input(key).value === '', 'Input survived close: ' + key)
    demand(f.calls.length === 0, 'Reopen triggered I/O')
  }))
  test('inspection clear during pending drops the input and consumes a late rejection', async () => {
    const d = deferred()
    await fixture(() => d.promise, async f => {
      await f.complete(); await f.click('开始只读检查'); await f.click('清空全部输入')
      for (const key of Object.keys(values)) demand(f.input(key).value === '', 'Input survived clear: ' + key)
      await act(async () => d.reject(Error('SYNTHETIC_SECRET')))
      demand(!f.host.querySelector('.s3-inspection-metrics'), 'Late failure produced a summary')
      demand(!f.host.textContent.includes('SYNTHETIC_SECRET'), 'Raw native exception leaked')
    })
  })
}
