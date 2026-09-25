import React,{act}from'react'
import{createRoot}from'react-dom/client'
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest'
import SyncCenterPanel from'./SyncCenterPanel'
import{api}from'~/services/api'
vi.mock('~/services/api',()=>({api:vi.fn()}))
vi.mock('~/services/toast',()=>({toast:{success:vi.fn(),error:vi.fn()}}))
let container,root
const settings={sync_enabled:true,sync_provider:'local-lab',sync_endpoint:''}
const status={device_id:'device-a',provider:'local-lab',enabled:true,base_items:2,open_conflicts:0,last_status:'ok',last_error:''}
beforeEach(()=>{container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);window.electronAPI={openAppFolder:vi.fn().mockResolvedValue({success:true})};api.mockImplementation(async(path,init)=>{if(path==='/api/settings'&&!init)return settings;if(path==='/api/sync/status')return status;if(path==='/api/sync/conflicts')return[];if(path==='/api/sync/plan')return{uploads:1,downloads:2,conflicts:0,noops:3,needs_init:false};if(path==='/api/sync/run')return{plan:{uploads:1,downloads:0,conflicts:0,noops:2},conflicts:0};if(path==='/api/settings'&&init?.method==='PUT')return settings;return null})})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();delete window.electronAPI;vi.clearAllMocks()})
const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text)
async function render(){await act(async()=>{root.render(<SyncCenterPanel/>);await Promise.resolve();await Promise.resolve()})}
async function click(node){await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true}));await Promise.resolve();await Promise.resolve()})}
describe('SyncCenterPanel',()=>{
it('shows explicit lab scope and identity',async()=>{await render();expect(container.textContent).toContain('不把实验室伪装成正式云同步');expect(container.textContent).toContain('附件、标签尚未纳入');expect(container.textContent).toContain('device-a')})
it('previews without running',async()=>{await render();await click(button('预演同步'));expect(api).toHaveBeenCalledWith('/api/sync/plan',{method:'POST',body:'{}'});expect(container.textContent).toContain('上传 1 · 下载 2 · 冲突 0 · 无变化 3')})
it('runs only on explicit click',async()=>{await render();await click(button('执行同步'));expect(api).toHaveBeenCalledWith('/api/sync/run',{method:'POST',body:'{}'})})
it('requires conflict side selection',async()=>{api.mockImplementation(async(path)=>{if(path==='/api/settings')return settings;if(path==='/api/sync/status')return{...status,open_conflicts:1,last_status:'conflicts'};if(path==='/api/sync/conflicts')return[{id:'c1',item_id:'n1',local_record:{state:'present',file:{title:'本机标题'}},remote_record:{state:'present',file:{title:'远端标题'}}}];return null});await render();expect(container.textContent).toContain('不会自动覆盖');await click(button('保留本机'));expect(api).toHaveBeenCalledWith('/api/sync/conflicts/c1/resolve',{method:'POST',body:JSON.stringify({choice:'local'})})})
it('opens app-owned remote folder',async()=>{await render();await click(button('打开模拟远端'));expect(window.electronAPI.openAppFolder).toHaveBeenCalledWith('syncLab')})
})
