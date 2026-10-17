import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Panel from './SyncConflictHistoryPanel'
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs'
import { api } from '~/services/api'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
let host, root, oldAct
const button = name => host.querySelector('[data-history-'+name+']')
const displayed = () => [...host.querySelectorAll('[data-history-row]')]
const status = () => host.querySelector('[data-history-search-feedback]').textContent
const make = (id, kind='file', resolution='local', stamp=1790586600) => ({...historyRow(id,resolution==='remote-rebind'?'superseded':'resolved',resolution,stamp),kind})
const initial = () => [
 {...make('a'),current_title:'第一章 ＡＢＣ',item_id:'note-A'},
 {...make('b','file','remote',1790586500),current_title:'Cafe\u0301 🌱',item_id:'note-B'},
 {...make('c','attachment','remote-rebind',1790586400),current_title:'',item_id:'attachment-photo'},
 {...make('d','tag','unknown',1790586300),current_title:'',item_id:'tag-topic'},
]
async function render(){await act(async()=>root.render(<Panel/>));await act(async()=>{host.querySelector('details').open=true})}
async function click(node){expect(node).toBeTruthy();await act(async()=>{node.click();await Promise.resolve()})}
async function choose(name,value){await act(async()=>{const n=button(name);n.value=value;n.dispatchEvent(new Event('change',{bubbles:true}))})}
async function type(value){await act(async()=>{const n=button('query');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}))})}
async function read(){await render();await click(button('read'))}
beforeEach(()=>{
 oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 api.mockReset();api.mockResolvedValue(historyPage(initial()));host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct})
it('typing or choosing local filters before the explicit first read causes zero network requests',async()=>{
 await render();await type('第一章');await choose('kind','file');await choose('outcome','local')
 await act(async()=>button('query').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})))
 expect(api).not.toHaveBeenCalled();expect(status()).toContain('尚未读取');expect(displayed()).toHaveLength(0)
 await click(button('read'));expect(displayed()).toHaveLength(1);expect(status()).toContain('当前显示 1 条 / 已读取 4 条')
})
it('searches current title and exact identifier fields locally with Unicode folding',async()=>{
 await read();await type(' abc ');expect(displayed()).toHaveLength(1);expect(displayed()[0].textContent).toContain('第一章')
 await type('café');expect(displayed()).toHaveLength(1);expect(displayed()[0].textContent).toContain('🌱')
 await type('NOTE-A');expect(displayed()).toHaveLength(1);await type('c');expect(displayed().length).toBeGreaterThan(0)
 expect(api).toHaveBeenCalledTimes(1)
})
it('combines title, object kind and outcome without replacing the fetched collection',async()=>{
 await read();await type('note');await choose('kind','file');await choose('outcome','remote')
 expect(displayed()).toHaveLength(1);expect(displayed()[0].textContent).toContain('当时采用远端版本');expect(status()).toContain('已读取 4 条')
 await choose('outcome','superseded');expect(displayed()).toHaveLength(0);expect(api).toHaveBeenCalledTimes(1)
})
it('invalidation and unknown history outcomes are not labelled as selected versions',async()=>{
 await read();await choose('outcome','superseded');expect(displayed()).toHaveLength(1);expect(displayed()[0].textContent).toContain('不代表已选边')
 await choose('outcome','unknown');expect(displayed()).toHaveLength(1);expect(displayed()[0].textContent).toContain('处理方式未核实')
})
it('zero matches never claim the unread pages contain nothing and never auto-fetch them',async()=>{
 api.mockResolvedValue(historyPage(initial(),'all','next-page'));await read();await type('more-title')
 expect(displayed()).toHaveLength(0);expect(status()).toContain('更早记录尚未读取');expect(button('more')).toBeTruthy();expect(api).toHaveBeenCalledTimes(1)
 api.mockResolvedValueOnce(historyPage([{...make('older','file','remote',1790586200),current_title:'more-title'}]))
 await click(button('more'));expect(displayed()).toHaveLength(1);expect(button('query').value).toBe('more-title');expect(status()).toContain('已读取 5 条')
 expect(api.mock.calls[1][0]).toContain('before=next-page');expect(api.mock.calls[1][0]).not.toContain('more-title')
})
it('last-page completion leaves a focusable results region even when local filtering hides every row',async()=>{
 api.mockResolvedValueOnce(historyPage(initial(),'all','next-page')).mockResolvedValueOnce(historyPage([make('older','file','remote',1790586200)]))
 await read();await type('no-match');button('more').focus();await click(button('more'))
 expect(displayed()).toHaveLength(0);expect(button('more')).toBeNull();expect(document.activeElement).toBe(host.querySelector('.sync-conflict-history-scroll'))
 expect(status()).toContain('本次已读取记录中没有匹配项')
})
it('filtering during a pending page does not pull focus away from the search input at completion',async()=>{
 let done;api.mockResolvedValueOnce(historyPage(initial(),'all','next-page')).mockImplementationOnce(()=>new Promise(r=>{done=r}))
 await read();button('more').focus();await click(button('more'));button('query').focus();await type('no-match')
 await act(async()=>done(historyPage([make('older','file','remote',1790586200)])))
 expect(document.activeElement).toBe(button('query'));expect(button('more')).toBeNull();expect(api).toHaveBeenCalledTimes(2)
})
it('clearing local filters returns keyboard focus and never changes the server record type',async()=>{
 api.mockResolvedValue(historyPage([make('c','attachment','remote-rebind')],'superseded'))
 await render();await act(async()=>{const n=host.querySelector('select');n.value='superseded';n.dispatchEvent(new Event('change',{bubbles:true}))})
 await type('zzz');await choose('kind','tag');await choose('outcome','unknown')
 button('clear').focus();await click(button('clear'))
 expect(host.querySelector('select').value).toBe('superseded');expect(displayed()).toHaveLength(1);expect(document.activeElement).toBe(button('query'));expect(api).toHaveBeenCalledTimes(1)
})
it('a failed refresh preserves fetched rows and local filters without exposing server text',async()=>{
 await read();await choose('outcome','remote');await type('café');api.mockRejectedValueOnce(Error('PRIVATE_SERVER_PASSWORD'))
 await click(button('read'));expect(displayed()).toHaveLength(1);expect(host.textContent).toContain('保留上次读取结果')
 expect(button('query').value).toBe('café');expect(button('outcome').value).toBe('remote');expect(host.textContent).not.toContain('PRIVATE_SERVER_PASSWORD')
})
it('a later successful refresh still applies local choices to the replacement snapshot',async()=>{
 await read();await choose('kind','attachment');api.mockResolvedValueOnce(historyPage([make('new','file','remote')]))
 await click(button('read'));expect(displayed()).toHaveLength(0);expect(status()).toContain('已读取 1 条');expect(button('kind').value).toBe('attachment')
})
it('late old-filter responses cannot reintroduce matching but wrong-scope rows',async()=>{
 let done;api.mockImplementationOnce(()=>new Promise(r=>{done=r})).mockResolvedValueOnce(historyPage([make('c','attachment','remote-rebind')],'superseded'))
 await render();await click(button('read'));await type('note-a')
 await act(async()=>{const n=host.querySelector('select');n.value='superseded';n.dispatchEvent(new Event('change',{bubbles:true}))})
 await act(async()=>done(historyPage(initial())))
 expect(displayed()).toHaveLength(0);expect(status()).toContain('已读取 1 条');expect(button('query').value).toBe('note-a')
})
it('stopped reads preserve local filters and ignore late results without any new request',async()=>{
 let done;await read();api.mockImplementationOnce(()=>new Promise(r=>{done=r}));await click(button('read'))
 await type('note-a');await click(button('stop'));await act(async()=>done(historyPage([make('unwanted')])))
 expect(displayed()).toHaveLength(1);expect(displayed()[0].textContent).toContain('第一章');expect(host.textContent).toContain('停止等待');expect(api).toHaveBeenCalledTimes(2)
})
it('a remount begins with empty local criteria and does not persist private searches',async()=>{
 const write=vi.spyOn(Storage.prototype,'setItem');await read();await type('私人标题');await choose('kind','tag')
 await act(async()=>root.unmount());root=createRoot(host);await render()
 expect(button('query').value).toBe('');expect(button('kind').value).toBe('all');expect(status()).toContain('尚未读取');expect(write).not.toHaveBeenCalled();expect(api).toHaveBeenCalledTimes(1)
})
it('search treats markup and regex text literally and never searches unprojected private fields',async()=>{
 const row={...make('x'),current_title:'<script>alert(1)</script>',secret:'UNPROJECTED_SECRET'}
 api.mockResolvedValue(historyPage([row]));await read();await type('<script>');expect(displayed()).toHaveLength(1)
 expect(host.querySelector('script,img,a,iframe')).toBeNull();await type('UNPROJECTED_SECRET');expect(displayed()).toHaveLength(0)
 await type('.*');expect(displayed()).toHaveLength(0);expect(api).toHaveBeenCalledTimes(1)
})
it('limits long Unicode input without a broken final surrogate or network activity',async()=>{
 await render();await type('🌱'.repeat(140));expect(button('query').value).toBe('🌱'.repeat(128));expect(api).not.toHaveBeenCalled()
})
it('empty loaded history remains distinct from a filtered loaded collection',async()=>{
 api.mockResolvedValue(historyPage([]));await read();expect(status()).toContain('当前显示 0 条 / 已读取 0 条')
 expect(host.textContent).toContain('不代表当前没有未决冲突');await type('missing');expect(status()).toContain('本次已读取记录中没有匹配项')
 expect(host.textContent).not.toContain('全部历史没有')
})
