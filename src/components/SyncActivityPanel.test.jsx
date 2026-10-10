import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '~/services/api'
import SyncActivityPanel from './SyncActivityPanel'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
const active = { active: true, id: 'a'.repeat(32), kind: 'sync', phase: 'preflight', started_at: 1700000000, cancel_requested: false }
let container,root,state,settled,originalConfirm
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve() }
const button = text => [...container.querySelectorAll('button')].find(x=>x.textContent===text)
async function render(props={}) { await act(async()=>{root.render(<SyncActivityPanel onSettled={settled} {...props}/>);await flush()}) }
async function click(node) { await act(async()=>{node.click();await flush()}) }
async function tick(ms) { await act(async()=>{await vi.advanceTimersByTimeAsync(ms);await flush()}) }
beforeEach(()=>{
 vi.useFakeTimers();state={...active};settled=vi.fn();originalConfirm=window.confirm;window.confirm=vi.fn(()=>true)
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)
 api.mockReset();api.mockImplementation(async(path)=>path==='/api/sync/activity'?state:{id:active.id,accepted:true,reason:'requested'})
})
afterEach(async()=>{await act(async()=>{root.unmount();await flush()});container.remove();vi.useRealTimers();window.confirm=originalConfirm;vi.clearAllMocks()})
describe('SyncActivityPanel',()=>{
 it('keeps cancellation available while parent has a long operation',async()=>{
  await render({wakeKey:'run'});expect(button('取消当前任务').disabled).toBe(false)
  await click(button('取消当前任务'))
  expect(api).toHaveBeenCalledWith('/api/sync/cancel',expect.objectContaining({method:'POST',body:JSON.stringify({id:active.id})}))
  expect(button('正在取消…').disabled).toBe(true)
  expect(container.textContent).toContain('不表示写入已撤销')
 })
 it('requires confirmation and does not send on decline',async()=>{
  window.confirm.mockReturnValue(false);await render();await click(button('取消当前任务'))
  expect(api.mock.calls.filter(([p])=>p==='/api/sync/cancel')).toHaveLength(0)
 })
 it('refreshes recovery only after observing actual task completion',async()=>{
  await render();await click(button('取消当前任务'));expect(settled).not.toHaveBeenCalled()
  state={active:false};await tick(1000);expect(settled).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain('原任务已结束');expect(button('取消当前任务')).toBeUndefined()
 })
 it('cannot relabel or cancel a successor when an old cancellation reply arrives',async()=>{
  let reply;api.mockImplementation(async p=>p==='/api/sync/activity'?state:new Promise(resolve=>{reply=resolve}))
  await render();await click(button('取消当前任务'))
  state={...active,id:'b'.repeat(32)};await tick(1000)
  await act(async()=>{reply({id:active.id,accepted:true,reason:'requested'});await flush()})
  expect(button('取消当前任务').disabled).toBe(false)
  expect(api.mock.calls.filter(([p])=>p==='/api/sync/cancel')).toHaveLength(1)
  expect(JSON.parse(api.mock.calls.find(([p])=>p==='/api/sync/cancel')[1].body).id).toBe(active.id)
 })
 it('does not infer completion from a failed activity read',async()=>{
  await render();api.mockImplementation(async()=>{throw new Error('offline')});await tick(1000)
  expect(container.textContent).toContain('上次读取结果');expect(settled).not.toHaveBeenCalled()
  expect(button('取消当前任务').disabled).toBe(true)
 })
 it('does not re-enable a cancelled task from a stale read',async()=>{
  await render();await click(button('取消当前任务'));await tick(1000)
  expect(state.cancel_requested).toBe(false);expect(button('正在取消…').disabled).toBe(true)
 })
 it('times out cancel delivery without automatic mutation retry',async()=>{
  api.mockImplementation(async p=>p==='/api/sync/activity'?state:new Promise(()=>{}))
  await render();await click(button('取消当前任务'));await tick(5001)
  expect(container.textContent).toContain('取消结果尚未确认')
  expect(api.mock.calls.filter(([p])=>p==='/api/sync/cancel')).toHaveLength(1)
 })
 it('stops monitoring and aborts only pending HTTP requests when unmounted',async()=>{
  let signal;api.mockImplementation(async(p,init)=>{signal=init.signal;return new Promise(()=>{})})
  await render();await act(async()=>{root.unmount();await flush()})
  expect(signal.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0)
  expect(api.mock.calls.some(([p])=>p==='/api/sync/cancel')).toBe(false)
  root=createRoot(container)
 })
 it('clears cancellation wait timers on unmount even when an API ignores abort',async()=>{
  api.mockImplementation(async p=>p==='/api/sync/activity'?state:new Promise(()=>{}))
  await render();await click(button('取消当前任务'))
  await act(async()=>{root.unmount();await flush()})
  expect(vi.getTimerCount()).toBe(0);root=createRoot(container)
 })
})
