import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Panel from './SyncConflictHistoryPanel'
import { api } from '~/services/api'
import { requestHistoryDownload } from '~/services/syncHistoryExport.mjs'
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs'
vi.mock('~/services/api', () => ({api:vi.fn()}))
vi.mock('~/services/syncHistoryExport.mjs', async original => ({...await original(),requestHistoryDownload:vi.fn()}))
let host,root,oldAct
const control = name => host.querySelector('[data-history-'+name+']')
const message = () => control('export-feedback').textContent
const fixture = () => historyPage([
 {...historyRow('a'), current_title:'星图 ABC'},
 {...historyRow('b','resolved','remote',1790586500),current_title:'另一册'},
])
async function render(){await act(async()=>root.render(<Panel/>));await act(async()=>{host.querySelector('details').open=true})}
async function click(name){await act(async()=>{control(name).click();await Promise.resolve()})}
async function input(value,composing=false){await act(async()=>{
 const n=control('query');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value)
 n.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:composing}))
})}
async function read(){await render();await click('read')}
const captured = () => JSON.parse(requestHistoryDownload.mock.calls.at(-1)[0].raw)
beforeEach(()=>{
 oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 api.mockReset();api.mockResolvedValue(fixture());requestHistoryDownload.mockReset()
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct})
// Review regressions: an acknowledgement belongs to an action, not simply to
// condition values that might reappear after A -> B -> A navigation.
async function chooseLocal(name, value) {
  await act(async () => {
    const node = control(name); node.value = value
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
for (const [name, change, restore] of [
  ['text query', () => input('another'), () => input('abc')],
  ['object kind', () => chooseLocal('kind', 'tag'), () => chooseLocal('kind', 'all')],
  ['outcome', () => chooseLocal('outcome', 'remote'), () => chooseLocal('outcome', 'all')],
]) it('does not resurrect an old download message after returning to the same ' + name, async () => {
  await read(); await input('abc'); await click('export-button')
  expect(message()).toContain('已请求下载')
  await change(); expect(message()).toBe('')
  await restore(); expect(message()).toBe('')
  expect(requestHistoryDownload).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledTimes(1)
})
it('does not resurrect old failure feedback after changing and restoring a filter', async () => {
  requestHistoryDownload.mockImplementationOnce(() => { throw Error('PRIVATE_DISK') })
  await read(); await input('abc'); await click('export-button')
  expect(message()).toContain('未能发起下载')
  await input('different'); await input('abc')
  expect(message()).toBe(''); expect(requestHistoryDownload).toHaveBeenCalledTimes(1)
})
it('keeps download feedback cleared when candidate entry ends with the original query', async () => {
  await read(); await input('abc'); await click('export-button')
  await act(async () => control('query').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  expect(message()).toBe('')
  await input('xingtu', true)
  await act(async () => {
    const node = control('query')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, 'abc')
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
  })
  expect(control('query').value).toBe('abc')
  expect(message()).toBe(''); expect(requestHistoryDownload).toHaveBeenCalledTimes(1)
})
it('failed refresh retry cannot replay an earlier export acknowledgement of the retained snapshot', async () => {
  await read(); api.mockRejectedValueOnce(Error('PRIVATE_READ')); await click('read')
  await click('export-button'); expect(captured().scope.sourceState).toBe('error')
  expect(message()).toContain('已请求下载')
  let reject; api.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  await click('read'); expect(message()).toBe('')
  await act(async () => reject(Error('PRIVATE_READ_AGAIN')))
  expect(message()).toBe(''); expect(requestHistoryDownload).toHaveBeenCalledTimes(1)
  expect(host.querySelectorAll('[data-history-row]')).toHaveLength(2)
})
it('stopping a second read cannot replay the previous stopped-snapshot export acknowledgement', async () => {
  await read(); api.mockImplementationOnce(() => new Promise(() => {})); await click('read'); await click('stop')
  await click('export-button'); expect(message()).toContain('已请求下载')
  api.mockImplementationOnce(() => new Promise(() => {})); await click('read'); await click('stop')
  expect(message()).toBe(''); expect(requestHistoryDownload).toHaveBeenCalledTimes(1)
})
it('a normal parent rerender preserves feedback without reissuing a download', async () => {
  await read(); await click('export-button'); const previous = message()
  await act(async () => root.render(<Panel/>))
  expect(message()).toBe(previous); expect(requestHistoryDownload).toHaveBeenCalledTimes(1)
})
it('a new explicit export after a condition roundtrip acknowledges only that new action', async () => {
  await read(); await input('abc'); await click('export-button')
  await input('changed'); await input('abc'); await click('export-button')
  expect(message()).toContain('已请求下载 1 条'); expect(requestHistoryDownload).toHaveBeenCalledTimes(2)
  expect(captured().records.map(row => row.id)).toEqual(['a']); expect(api).toHaveBeenCalledTimes(1)
})
