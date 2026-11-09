// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import S3ReadInspectionPanel from './S3ReadInspectionPanel.js'
import UiThemeProvider from './ui/UiThemeProvider'

let host, root, previousBridge, read
const button = label => [...host.querySelectorAll('button')].find(node => node.textContent === label)
const input = name => host.querySelector(`input[name="${name}"]`)
const click = async label => act(async () => button(label).click())
const type = async (name, value) => act(async () => {
  const node = input(name)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
  node.dispatchEvent(new Event('input', { bubbles: true }))
})
const mount = async () => act(async () => root.render(<React.StrictMode><UiThemeProvider><S3ReadInspectionPanel /></UiThemeProvider></React.StrictMode>))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  previousBridge = Object.getOwnPropertyDescriptor(window, 'electronAPI')
  read = vi.fn()
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { s3ProbeRead: read } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  if (previousBridge) Object.defineProperty(window, 'electronAPI', previousBridge)
  else delete window.electronAPI
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('the actual S3 panel uses shared official text, password and button controls while consent remains native', async () => {
  await mount()
  expect(button('打开云端只读检查').matches('.ant-btn[data-ui-control="button"]')).toBe(true)
  await click('打开云端只读检查')
  const fields = [...host.querySelectorAll('.s3-inspection-field input')]
  expect(fields).toHaveLength(9)
  for (const field of fields) {
    expect(field.matches('.ant-input')).toBe(true)
    expect(field.closest('[data-ui-control]')?.getAttribute('data-ui-control')).toBe(field.type === 'password' ? 'password' : 'input')
    expect(host.querySelector(`label[for="${field.id}"]`)).not.toBeNull()
  }
  expect(host.querySelectorAll('input[type="password"]')).toHaveLength(3)
  expect(host.querySelectorAll('.ant-input-password-icon')).toHaveLength(0)
  expect([...host.querySelectorAll('button')]).toHaveLength(4)
  expect([...host.querySelectorAll('button')].every(node => node.matches('.ant-btn[data-ui-control="button"]'))).toBe(true)
  expect(host.querySelector('input[type="checkbox"]').getAttribute('data-ui-native')).toBe('checkbox')
  expect(document.activeElement).toBe(input('endpoint'))
  expect(read).not.toHaveBeenCalled()
})

it('shared input refs, invalid-field focus and explicit clearing retain the same masked inputs without I/O', async () => {
  await mount(); await click('打开云端只读检查')
  const endpoint = input('endpoint'), secret = input('secretAccessKey')
  await type('key', '合成/中文/%2F/长对象键.json')
  await type('secretAccessKey', 'SYNTHETIC_ONLY_NO_REQUEST')
  expect(input('secretAccessKey')).toBe(secret)
  expect(secret.type).toBe('password')
  expect(host.textContent).not.toContain('SYNTHETIC_ONLY_NO_REQUEST')
  await click('开始只读检查')
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  expect(endpoint.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(endpoint)
  expect(input('secretAccessKey')).toBe(secret)
  await click('清空全部输入')
  expect(input('endpoint')).toBe(endpoint)
  expect(input('secretAccessKey')).toBe(secret)
  for (const field of host.querySelectorAll('.s3-inspection-field input')) expect(field.value).toBe(field.name === 'maxBytes' ? '1048576' : '')
  expect(document.activeElement).toBe(endpoint)
  expect(host.querySelector('input[type="checkbox"]').checked).toBe(false)
  expect(read).not.toHaveBeenCalled()
  await click('关闭并清空')
  expect(document.activeElement).toBe(button('打开云端只读检查'))
  await click('打开云端只读检查')
  expect(input('secretAccessKey').value).toBe('')
  expect(input('secretAccessKey').type).toBe('password')
  expect(host.querySelectorAll('.ant-input-password-icon')).toHaveLength(0)
  expect(read).not.toHaveBeenCalled()
})

it('unavailable native inspection stays disabled and never falls back to browser networking', async () => {
  delete window.electronAPI
  const fetch = vi.fn(() => { throw new Error('Unexpected browser network fallback') })
  vi.stubGlobal('fetch', fetch)
  await mount(); await click('打开云端只读检查')
  expect(button('开始只读检查').disabled).toBe(true)
  expect(host.textContent).toContain('当前环境没有原生检查通道')
  await type('endpoint', 'https://synthetic.invalid')
  await click('开始只读检查')
  await click('清空全部输入')
  expect(fetch).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})
