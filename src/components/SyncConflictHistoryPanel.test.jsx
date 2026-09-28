import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Panel from './SyncConflictHistoryPanel'
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs'
import { api } from '~/services/api'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
let host, root, previousAct
const select = () => host.querySelector('select')
const button = type => host.querySelector('[data-history-'+type+']')
const rows = () => host.querySelectorAll('[data-history-row]')
const feedback = () => host.querySelector('.sync-conflict-history-feedback').textContent
async function render() { await act(async () => root.render(<Panel/>)) }
async function click(node) { expect(node).toBeTruthy();await act(async()=>node.click()) }
async function choose(value) { await act(async()=>{select().value=value;select().dispatchEvent(new Event('change',{bubbles:true}))}) }
beforeEach(()=>{
  previousAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  api.mockReset();api.mockResolvedValue(historyPage());host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct})
it('mounting, opening or incoming renders do not read or write', async()=>{
  await render();const details=host.querySelector('details');expect(details.open).toBe(false)
  await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'))});await render()
  expect(api).not.toHaveBeenCalled();expect(feedback()).toContain('尚未读取')
})
it('explicit read preserves focus and renders only closed records with truthful outcomes', async()=>{
  api.mockResolvedValue(historyPage([historyRow(),historyRow('stale','superseded','remote-rebind',1790586500)]))
  await render();button('read').focus();await click(button('read'))
  expect(rows()).toHaveLength(2);expect(host.textContent).toContain('当时保留本机版本');expect(host.textContent).toContain('不代表已选边')
  expect(document.activeElement).toBe(button('read'));expect(api.mock.calls[0][1].method).toBe('GET')
})
it('reading more appends older records without reinterpreting loaded count as the total', async()=>{
  api.mockResolvedValueOnce(historyPage([historyRow('a')],'all','cursor2')).mockResolvedValueOnce(historyPage([historyRow('b','resolved','remote',1790586500)]))
  await render();await click(button('read'));await click(button('more'))
  expect(rows()).toHaveLength(2);expect(api.mock.calls[1][0]).toContain('before=cursor2');expect(button('more')).toBeNull();expect(feedback()).toContain('不代表全部历史')
})
it('failed refresh keeps previous rows and never shows raw server errors', async()=>{
  await render();await click(button('read'));api.mockRejectedValueOnce(Error('PRIVATE_PASSWORD'))
  await click(button('read'));expect(rows()).toHaveLength(1);expect(feedback()).toContain('保留上次读取结果');expect(host.textContent).not.toContain('PRIVATE_PASSWORD')
})
it('wrong-shape responses do not masquerade as an empty history', async()=>{
  api.mockResolvedValue({});await render();await click(button('read'));expect(rows()).toHaveLength(0)
  expect(feedback()).toContain('不把读取失败当作没有记录')
})
it('a filter change replaces results and cannot display an old request completing late', async()=>{
  let finish;api.mockImplementationOnce(()=>new Promise(r=>{finish=r})).mockResolvedValueOnce(historyPage([historyRow('s','superseded','unknown')],'superseded'))
  await render();await click(button('read'));const signal=api.mock.calls[0][1].signal;await choose('superseded')
  expect(signal.aborted).toBe(true);expect(rows()).toHaveLength(1)
  await act(async()=>finish(historyPage([historyRow('late')])));expect(host.textContent).not.toContain('note-late');expect(select().value).toBe('superseded')
})
it('failed different-filter reads clear incompatible rows instead of relabelling them', async()=>{
  await render();await click(button('read'));api.mockRejectedValueOnce(Error('PRIVATE'))
  await choose('superseded');expect(rows()).toHaveLength(0);expect(feedback()).toContain('尚无可核实')
})
it('stop ends the wait even if the loader ignores abort and prevents late rendering', async()=>{
  let finish;api.mockImplementation(()=>new Promise(r=>{finish=r}));await render();await click(button('read'));await click(button('stop'))
  expect(feedback()).toContain('没有取消同步任务');await act(async()=>finish(historyPage()))
  expect(rows()).toHaveLength(0);expect(feedback()).toContain('停止等待')
})
it('unmount cancels only its own request and a remount begins unread', async()=>{
  api.mockImplementation(()=>new Promise(()=>{}));await render();await click(button('read'));const signal=api.mock.calls[0][1].signal
  await act(async()=>root.unmount());expect(signal.aborted).toBe(true);root=createRoot(host);await render()
  expect(feedback()).toContain('尚未读取');expect(api).toHaveBeenCalledTimes(1)
})
it('markup-like titles and IDs stay plain text, not navigable or executable markup', async()=>{
  const row=historyRow();row.current_title='<img src=x onerror=alert(1)>';row.item_id='<script>PRIVATE_TEXT</script>'
  api.mockResolvedValue(historyPage([row]));await render();await click(button('read'))
  expect(host.querySelector('img,script,a,iframe')).toBeNull();expect(host.textContent).toContain(row.current_title)
})
it('overlapping next pages are refused while existing results remain intact', async()=>{
  api.mockResolvedValueOnce(historyPage([historyRow()],'all','next')).mockResolvedValueOnce(historyPage([historyRow()]))
  await render();await click(button('read'));await click(button('more'));expect(rows()).toHaveLength(1);expect(feedback()).toContain('上次读取结果')
})
it('empty history is separate from current unresolved conflicts', async()=>{
  api.mockResolvedValue(historyPage([]));await render();await click(button('read'))
  expect(feedback()).toContain('不代表当前没有未决冲突');expect(button('more')).toBeNull()
})

it('the last older-page action returns focus to its list instead of a removed button', async()=>{
  api.mockResolvedValueOnce(historyPage([historyRow('a')],'all','next')).mockResolvedValueOnce(historyPage([historyRow('b','resolved','remote',1790586000)]))
  await render();await act(async()=>{host.querySelector('details').open=true});await click(button('read'))
  button('more').focus();await click(button('more'));expect(button('more')).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('.sync-conflict-history-scroll'))
})
it('explicit stop returns focus to read without invoking it again', async()=>{
  api.mockImplementation(()=>new Promise(()=>{}));await render();await act(async()=>{host.querySelector('details').open=true})
  await click(button('read'));button('stop').focus();await click(button('stop'))
  expect(document.activeElement).toBe(button('read'));expect(api).toHaveBeenCalledTimes(1)
})
