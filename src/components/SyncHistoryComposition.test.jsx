import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Panel from './SyncConflictHistoryPanel'
import { api } from '~/services/api'
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
let host, root, oldAct
const control = key => host.querySelector('[data-history-' + key + ']')
const ids = () => [...host.querySelectorAll('[data-history-row]')].map(row => row.querySelectorAll('code')[1].textContent)
const feedback = () => control('search-feedback').textContent
const rows = () => [
  { ...historyRow('one'), current_title: '星图 ＡＢＣ' },
  { ...historyRow('two', 'resolved', 'remote', 1790586500), current_title: '星图的另一册' },
]
async function input(value, composing = false) {
  await act(async () => {
    const node = control('query')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: composing ? 'insertCompositionText' : 'insertText', isComposing: composing }))
  })
}
async function composition(type, value) {
  await act(async () => {
    const node = control('query')
    if (value !== undefined) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: value || '' }))
  })
}
async function click(key) { await act(async () => control(key).click()) }
async function render() {
  await act(async () => root.render(<Panel/>))
  await act(async () => { host.querySelector('details').open = true })
}
async function read() { await render(); await click('read') }
beforeEach(() => {
  oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  api.mockReset(); api.mockResolvedValue(historyPage(rows()))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
})

it('keeps the committed query while Chinese candidate text is still composing', async () => {
  await read(); await input('abc'); expect(ids()).toEqual(['one'])
  await composition('compositionstart'); await input('xingtu', true)
  expect(control('query').value).toBe('xingtu')
  expect(ids()).toEqual(['one'])
  expect(feedback()).toContain('输入法文字尚未确认')
  expect(api).toHaveBeenCalledTimes(1)
})
it('does not truncate in-progress phonetic text at the 128-character boundary', async () => {
  await render(); const prefix = '文'.repeat(127)
  await input(prefix); await composition('compositionstart'); await input(prefix + 'zhong', true)
  expect(control('query').value).toBe(prefix + 'zhong')
  expect(api).not.toHaveBeenCalled()
})
it('commits the final Chinese text before applying the length limit and the filter', async () => {
  await read(); await input('abc'); await composition('compositionstart'); await input('xingtu', true)
  await composition('compositionend', '星图')
  expect(control('query').value).toBe('星图'); expect(ids()).toEqual(['one', 'two'])
  expect(feedback()).not.toContain('输入法文字尚未确认'); expect(api).toHaveBeenCalledTimes(1)
})
it('limits committed Unicode text without splitting a surrogate, not candidate text', async () => {
  await render(); const prefix = '🌱'.repeat(127)
  await input(prefix); await composition('compositionstart'); await input(prefix + '候选文字', true)
  expect(control('query').value).toBe(prefix + '候选文字')
  await composition('compositionend', prefix + '🌿多余')
  expect(control('query').value).toBe(prefix + '🌿'); expect([...control('query').value]).toHaveLength(128)
})
it('clearing during composition cannot be undone by a late compositionend event', async () => {
  await read(); await input('abc'); await composition('compositionstart'); await input('xingtu', true)
  control('clear').focus(); await click('clear')
  // Use a late event carrying old data, with the DOM correctly cleared by React.
  await act(async () => control('query').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '星图' })))
  expect(control('query').value).toBe(''); expect(ids()).toEqual(['one', 'two'])
  expect(feedback()).not.toContain('输入法文字尚未确认')
  expect(document.activeElement).toBe(control('query')); expect(api).toHaveBeenCalledTimes(1)
})
it('a fresh composition after clearing works without resurrecting the previous candidate', async () => {
  await read(); await input('abc'); await composition('compositionstart'); await input('xingtu', true); await click('clear')
  await composition('compositionstart'); await input('lingyi', true); await composition('compositionend', '另一')
  expect(control('query').value).toBe('另一'); expect(ids()).toEqual(['two'])
})
it('append while composing still uses the last committed query and preserves the candidate buffer', async () => {
  let finish
  api.mockResolvedValueOnce(historyPage(rows(), 'all', 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await read(); await input('abc'); await click('more'); await composition('compositionstart'); await input('xingtu', true)
  await act(async () => finish(historyPage([{ ...historyRow('three', 'resolved', 'local', 1790586400), current_title: 'ABC 新加载' }])))
  expect(control('query').value).toBe('xingtu'); expect(ids()).toEqual(['one', 'three'])
  expect(feedback()).toContain('已读取 3 条'); expect(api).toHaveBeenCalledTimes(2)
})
it('failed refresh during composition preserves both last committed selection and current input', async () => {
  await read(); await input('abc'); api.mockRejectedValueOnce(new Error('PRIVATE_ERROR'))
  await composition('compositionstart'); await input('xingtu', true); await click('read')
  expect(ids()).toEqual(['one']); expect(control('query').value).toBe('xingtu')
  expect(host.textContent).toContain('保留上次读取结果'); expect(host.textContent).not.toContain('PRIVATE_ERROR')
})
it('blur finalizes an outstanding composition when compositionend has not arrived', async () => {
  await read(); control('query').focus(); await input('abc')
  await composition('compositionstart'); await input('星图', true)
  await act(async () => control('kind').focus())
  expect(ids()).toEqual(['one', 'two']); expect(feedback()).not.toContain('输入法文字尚未确认')
  expect(api).toHaveBeenCalledTimes(1)
})
it('ordinary Latin input still filters immediately and gains no confirmation action', async () => {
  await read(); await input('abc'); expect(ids()).toEqual(['one'])
  await input(''); expect(ids()).toEqual(['one', 'two']); expect(api).toHaveBeenCalledTimes(1)
})
it('a remount does not preserve unfinished composition or add local persistence', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  await read(); await input('abc'); await composition('compositionstart'); await input('xingtu', true)
  await act(async () => root.unmount()); root = createRoot(host); await render()
  expect(control('query').value).toBe(''); expect(feedback()).toContain('尚未读取')
  expect(storage).not.toHaveBeenCalled(); expect(api).toHaveBeenCalledTimes(1)
})
it('cancelling a candidate restores the original committed search without reading', async () => {
  await read(); await input('abc'); await composition('compositionstart'); await input('xingtu', true)
  await composition('compositionend', 'abc'); await input('abc')
  expect(control('query').value).toBe('abc'); expect(ids()).toEqual(['one']); expect(api).toHaveBeenCalledTimes(1)
})
it('an isComposing input without compositionstart still protects the active candidate', async () => {
  await read(); await input('abc'); await input('xingtu', true)
  expect(ids()).toEqual(['one']); expect(control('query').value).toBe('xingtu')
  await composition('compositionend', '星图'); expect(ids()).toEqual(['one', 'two'])
})
it('a final noncomposing input after compositionend applies once without an extra request', async () => {
  await read(); await input('abc'); await composition('compositionstart'); await input('xingtu', true)
  await composition('compositionend', '星图'); await input('星图')
  expect(control('query').value).toBe('星图'); expect(ids()).toEqual(['one', 'two'])
  expect(feedback()).not.toContain('输入法文字尚未确认'); expect(api).toHaveBeenCalledTimes(1)
})
