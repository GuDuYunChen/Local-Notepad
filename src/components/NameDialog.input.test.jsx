import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import NameDialog from './NameDialog'
import UiThemeProvider from './ui/UiThemeProvider'
import { changeUiValue, setUiValue } from '~/test/uiControlDriver'

let host, root
const field = () => host.querySelector('.name-dialog-input')
const render = props => act(async () => root.render(<UiThemeProvider><NameDialog {...props}/></UiThemeProvider>))
const submit = () => act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
const cancel = () => host.querySelector('.modal-actions button[type="button"]')

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
})

it('keeps the editable stem and immutable extension in one real Ant Design field', async () => {
  const onConfirm = vi.fn(), onCancel = vi.fn()
  await render({ defaultName: '报告.final.md', isRename: true, onConfirm, onCancel })
  const input = field(), owner = input.closest('.ant-input-affix-wrapper'), extension = host.querySelector('.static-ext')
  expect(input.tagName).toBe('INPUT')
  expect(input.value).toBe('报告.final')
  expect(document.activeElement).toBe(input)
  expect(host.querySelector('label').htmlFor).toBe(input.id)
  expect(owner).not.toBeNull()
  expect(owner.contains(extension)).toBe(true)
  expect(extension.textContent).toBe('.md')
  expect(extension.matches('input, textarea, [contenteditable="true"]')).toBe(false)
  expect(host.querySelectorAll('input')).toHaveLength(1)
  expect(onConfirm).not.toHaveBeenCalled(); expect(onCancel).not.toHaveBeenCalled()
})

it('submits only the changed stem and preserves the extension through a rejected save and retry', async () => {
  let reject
  const onConfirm = vi.fn().mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail }))
    .mockResolvedValueOnce(undefined)
  const onCancel = vi.fn()
  await render({ defaultName: '原始.md', isRename: true, onConfirm, onCancel })
  const input = field()
  await changeUiValue(input, '  中文重命名  ')
  await submit()
  expect(onConfirm).toHaveBeenNthCalledWith(1, '中文重命名', '.md')
  expect(input.disabled).toBe(true); expect(cancel().disabled).toBe(true)
  await submit()
  await act(async () => {
    cancel().click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  expect(onConfirm).toHaveBeenCalledTimes(1); expect(onCancel).not.toHaveBeenCalled()
  await act(async () => reject(new Error('保存失败，请重试')))
  expect(host.querySelector('[role="alert"]').textContent).toBe('保存失败，请重试')
  expect(field()).toBe(input); expect(input.value).toBe('  中文重命名  ')
  expect(input.disabled).toBe(false); expect(cancel().disabled).toBe(false)
  expect(host.querySelector('.static-ext').textContent).toBe('.md')
  await submit()
  expect(onConfirm).toHaveBeenNthCalledWith(2, '中文重命名', '.md')
})

it('retains the native input and focus while an extension appears, disappears or the dialog mode changes', async () => {
  const callbacks = { onConfirm: vi.fn(), onCancel: vi.fn() }
  await render({ ...callbacks, defaultName: '无扩展名', isRename: true })
  const input = field()
  expect(input.value).toBe('无扩展名'); expect(document.activeElement).toBe(input)
  await render({ ...callbacks, defaultName: '日记.txt', isRename: true })
  expect(field()).toBe(input); expect(document.activeElement).toBe(input)
  expect(input.value).toBe('日记'); expect(host.querySelector('.static-ext').textContent).toBe('.txt')
  await render({ ...callbacks, defaultName: '新建名称', isRename: false })
  expect(field()).toBe(input); expect(document.activeElement).toBe(input)
  expect(input.value).toBe('新建名称')
  await submit()
  expect(callbacks.onConfirm).toHaveBeenCalledOnce()
  expect(callbacks.onConfirm).toHaveBeenCalledWith('新建名称')
})

it('keeps empty-name and custom validation on the native field without submitting an extension as a name', async () => {
  const onConfirm = vi.fn(), validate = vi.fn(value => value === '占用名称' ? '名称已存在' : '')
  await render({ defaultName: '笔记.md', isRename: true, onConfirm, onCancel: vi.fn(), validate })
  const input = field()
  await changeUiValue(input, '   '); await submit()
  expect(host.querySelector('[role="alert"]').textContent).toBe('请输入名称')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(validate).not.toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled()
  await changeUiValue(input, '占用名称'); await submit()
  expect(validate).toHaveBeenCalledOnce(); expect(validate).toHaveBeenCalledWith('占用名称')
  expect(host.querySelector('[role="alert"]').textContent).toBe('名称已存在')
  expect(onConfirm).not.toHaveBeenCalled()
  await changeUiValue(input, '可用名称')
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(input.getAttribute('aria-invalid')).toBe('false')
  expect(field()).toBe(input)
  await submit()
  expect(onConfirm).toHaveBeenCalledOnce(); expect(onConfirm).toHaveBeenCalledWith('可用名称', '.md')
})

it('preserves the existing create-format choice and submits its selected format separately', async () => {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  await render({ defaultName: '新笔记.md', showFormatSelect: true, onConfirm, onCancel: vi.fn() })
  const input = field()
  expect(input.value).toBe('新笔记')
  await act(async () => host.querySelector('.name-dialog-options-toggle').click())
  await setUiValue(host.querySelector('[role="combobox"]'), '.docx')
  await changeUiValue(input, '导出文档'); await submit()
  expect(field()).toBe(input)
  expect(onConfirm).toHaveBeenCalledOnce(); expect(onConfirm).toHaveBeenCalledWith('导出文档', '.docx')
})

it.each(['button', 'Escape', 'backdrop'])('cancels by %s without submitting the edited name', async method => {
  const onConfirm = vi.fn(), onCancel = vi.fn()
  await render({ defaultName: '原笔记.md', isRename: true, onConfirm, onCancel })
  await changeUiValue(field(), '未保存的中文名称')
  await act(async () => {
    if (method === 'button') cancel().click()
    else if (method === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    else host.querySelector('.modal-overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  expect(onCancel).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled()
})
