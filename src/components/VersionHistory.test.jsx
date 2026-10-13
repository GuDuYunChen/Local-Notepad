import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import VersionHistory from './VersionHistory'
import { api } from '../services/api'
vi.mock('../services/api', () => ({ api: vi.fn() }))
const version = (patch = {}) => ({ id: 1, file_id: 'note-a', title: '旧标题.md', content: '旧正文🙂', created_at: 100, ...patch })
const settled = async () => act(async () => { for(let i=0;i<8;i++) await Promise.resolve() })
let host, root, current, bridge
beforeEach(() => {
 globalThis.IS_REACT_ACT_ENVIRONMENT=true; api.mockReset();api.mockResolvedValue([version()])
 current={id:'note-a',ready:true,generation:1,boundary:2,revision:3,content:'当前正文',saved:'当前正文',pending:false,uncertain:false}
 bridge={snapshot:()=>({...current}),restore:vi.fn(async v=>{current.content=v.content;current.saved=v.content;return{id:v.file_id,content:v.content,unchanged:false}}),saveCurrent:vi.fn(async()=>{current.saved=current.content})}
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete globalThis.IS_REACT_ACT_ENVIRONMENT;vi.restoreAllMocks()})
async function mount(id='note-a') {await act(async()=>root.render(<React.StrictMode><VersionHistory key={id} fileId={id} editor={bridge}/></React.StrictMode>));await settled()}
function button(text){return [...host.querySelectorAll('button')].find(n=>n.textContent===text)}
async function click(text){const n=button(text);expect(n,'Missing '+text).toBeTruthy();await act(async()=>n.click());await settled()}
async function confirm(){await click('恢复此快照正文');expect(host.querySelector('[role=dialog]')).toBeTruthy();await click('确认恢复正文')}
async function input(text){await act(async()=>{const n=host.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,text);n.dispatchEvent(new Event('input',{bubbles:true}))})}
test('empty Go nil slice is a successful empty history rather than an error',async()=>{api.mockResolvedValue(null);await mount();expect(host.textContent).toContain('暂无版本历史');expect(host.querySelector('[role=alert]')).toBeNull()})
test('transport and malformed rows never masquerade as empty history; explicit retry recovers',async()=>{
 api.mockRejectedValue(Error('PRIVATE'));await mount();expect(host.textContent).toContain('读取历史失败');expect(host.textContent).not.toContain('暂无版本历史');expect(host.textContent).not.toContain('PRIVATE')
 api.mockResolvedValue({});await click('重试读取历史');expect(host.textContent).toContain('格式不正确')
 api.mockResolvedValue([version()]);await click('重试读取历史');expect(host.textContent).toContain('历史快照 #1')
})
test('first snapshot is restorable and never mislabeled as current version',async()=>{await mount();expect(host.textContent).not.toContain('当前版本');expect(button('恢复此快照正文').disabled).toBe(false);expect(bridge.restore).not.toHaveBeenCalled()})
test('in-app confirmation can cancel with zero restore calls',async()=>{await mount();await click('恢复此快照正文');await click('取消');expect(bridge.restore).not.toHaveBeenCalled();expect(host.querySelector('[role=dialog]')).toBeNull()})
test('complete confirmation rereads exact snapshot then uses the editor bridge, not legacy POST',async()=>{
 await mount();const oldConfirm=vi.spyOn(window,'confirm').mockReturnValue(true);await confirm()
 expect(bridge.restore).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('已恢复并保存');expect(current.content).toBe('旧正文🙂')
 expect(api.mock.calls.every(([,init])=>!init.method)).toBe(true);expect(oldConfirm).not.toHaveBeenCalled()
})
test('stale or removed snapshot is rejected before editor adoption',async()=>{await mount();await click('恢复此快照正文');api.mockResolvedValue([version({content:'changed'})]);await click('确认恢复正文');expect(bridge.restore).not.toHaveBeenCalled();expect(host.textContent).toContain('快照已变化')})
test('unconfirmed original save leaves error visible and never automatically retries',async()=>{bridge.restore.mockRejectedValue(Error('unconfirmed'));await mount();await confirm();expect(bridge.restore).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('保存尚未确认');expect(host.textContent).not.toContain('已恢复并保存')})
test('unsaved draft blocks restoration and explicit save makes it available',async()=>{current.content='未保存草稿';await mount();expect(button('恢复此快照正文').disabled).toBe(true);await click('先保存当前笔记');expect(bridge.saveCurrent).toHaveBeenCalledTimes(1);expect(button('恢复此快照正文').disabled).toBe(false)})
test('a pending or conflicted editor never enables restoration',async()=>{current.uncertain=true;await mount();expect(button('恢复此快照正文').disabled).toBe(true);expect(button('先保存当前笔记')).toBeUndefined();expect(bridge.restore).not.toHaveBeenCalled()})
test('literal search and full preview pages retain the complete original restore payload',async()=>{const content='[ABC]'+('🙂'.repeat(8100));api.mockResolvedValue([version({content})]);await mount();await input('[ABC]');expect(host.textContent).toContain('显示 1 / 1');expect(host.textContent).toContain('8,105 字符');await click('下一段');expect(host.querySelector('pre').textContent.length).toBeGreaterThan(0);await confirm();expect(bridge.restore.mock.calls[0][0].content).toBe(content)})
test('composition does not apply a query until composition ends',async()=>{await mount();const n=host.querySelector('input');await act(async()=>n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await input('无匹配');expect(host.textContent).toContain('显示 1 / 1');await act(async()=>n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));expect(host.textContent).toContain('显示 0 / 1')})
test('late note-A history response cannot populate note-B panel',async()=>{let release;const pending=new Promise(r=>{release=r});api.mockReturnValue(pending);await mount();current.id='note-b';api.mockResolvedValue([version({id:2,file_id:'note-b',content:'B正文'})]);await mount('note-b');await act(async()=>release([version()]));expect(host.textContent).toContain('历史快照 #2');expect(host.textContent).not.toContain('历史快照 #1')})
test('closing while confirmation recheck waits prevents any restore',async()=>{await mount();await click('恢复此快照正文');let release;api.mockReturnValue(new Promise(r=>{release=r}));await act(async()=>button('确认恢复正文').click());await act(async()=>root.render(null));await act(async()=>release([version()]));expect(bridge.restore).not.toHaveBeenCalled()})
test('failed post-success refresh does not turn an acknowledged restoration into a failure',async()=>{await mount();bridge.restore.mockImplementation(async v=>{api.mockRejectedValue(Error('refresh failed'));return{id:v.file_id,content:v.content}});await confirm();expect(host.textContent).toContain('已恢复并保存');expect(host.textContent).toContain('读取历史失败');expect(bridge.restore).toHaveBeenCalledTimes(1)})

test('visible reference notification reserves measured scroll space and releases it when removed',async()=>{
 const banner=document.createElement('aside');banner.className='reference-maintenance-status';document.body.append(banner)
 const top=window.innerHeight-144
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){return this===banner?{left:0,right:300,top,bottom:top+60}:{left:0,right:320,top:0,bottom:600}})
 try{
  await mount();expect(host.querySelector('.version-history').style.getPropertyValue('--history-bottom-clearance')).toBe('160px')
  banner.remove();await act(async()=>{await Promise.resolve();await new Promise(r=>window.requestAnimationFrame(r))})
  expect(host.querySelector('.version-history').style.getPropertyValue('--history-bottom-clearance')).toBe('16px')
  expect(bridge.restore).not.toHaveBeenCalled()
 }finally{banner.remove()}
})
test('notifications outside the panel do not add an unnecessary large scroll gap',async()=>{
 const banner=document.createElement('aside');banner.className='reference-maintenance-status';document.body.append(banner)
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){return this===banner?{left:400,right:700,top:10,bottom:100}:{left:0,right:320,top:0,bottom:600}})
 try{await mount();expect(host.querySelector('.version-history').style.getPropertyValue('--history-bottom-clearance')).toBe('16px')}finally{banner.remove()}
})
