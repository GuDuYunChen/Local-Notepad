import React,{act}from'react'
import{createRoot}from'react-dom/client'
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest'
import SyncCenterPanel from'./SyncCenterPanel'
import{api}from'~/services/api'
vi.mock('~/services/api',()=>({api:vi.fn()}))
vi.mock('~/services/toast',()=>({toast:{success:vi.fn(),error:vi.fn()}}))
let container,root
const settings={sync_enabled:true,sync_provider:'local-lab',sync_endpoint:'',sync_username:'',sync_password_set:false,sync_auto_enabled:false,sync_interval_minutes:5}
const status={device_id:'device-a',provider:'local-lab',enabled:true,base_items:2,open_conflicts:0,last_status:'ok',last_error:''}
beforeEach(()=>{container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);window.confirm=vi.fn(()=>true);window.electronAPI={openAppFolder:vi.fn().mockResolvedValue({success:true})};api.mockImplementation(async(path,init)=>{if(path==='/api/settings'&&!init)return settings;if(path==='/api/sync/status')return status;if(path==='/api/sync/conflicts')return[];if(path==='/api/sync/plan')return{uploads:1,downloads:2,conflicts:0,noops:3,needs_init:false};if(path==='/api/sync/run')return{plan:{uploads:1,downloads:0,conflicts:0,noops:2},conflicts:0};if(path==='/api/sync/rebind')return{...status,base_items:0,open_conflicts:0,remote_store_id:'',remote_revision:'',last_status:'rebound'};if(path==='/api/settings'&&init?.method==='PUT')return settings;return null})})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();delete window.electronAPI;vi.clearAllMocks()})
const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text)
async function render(){await act(async()=>{root.render(<SyncCenterPanel/>);await Promise.resolve();await Promise.resolve()})}
async function click(node){await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true}));await Promise.resolve();await Promise.resolve()})}
async function input(label,value){const node=container.querySelector('[aria-label="'+label+'"]');await act(async()=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve()})}
describe('SyncCenterPanel',()=>{
it('shows shared local-first scope and identity',async()=>{await render();expect(container.textContent).toContain('WebDAV 只替换传输层');expect(container.textContent).toContain('笔记、文件夹、标签、标签关联和附件');expect(container.textContent).toContain('device-a')})
it('previews without running',async()=>{await render();await click(button('预演同步'));expect(api).toHaveBeenCalledWith('/api/sync/plan',{method:'POST',body:'{}'});expect(container.textContent).toContain('上传 1 · 下载 2 · 冲突 0 · 无变化 3')})
it('runs only on explicit click',async()=>{await render();await click(button('执行同步'));expect(api).toHaveBeenCalledWith('/api/sync/run',{method:'POST',body:'{}'})})
it('requires conflict side selection',async()=>{api.mockImplementation(async(path)=>{if(path==='/api/settings')return settings;if(path==='/api/sync/status')return{...status,open_conflicts:1,last_status:'conflicts'};if(path==='/api/sync/conflicts')return[{id:'c1',item_id:'n1',local_record:{state:'present',file:{title:'本机标题'}},remote_record:{state:'present',file:{title:'远端标题'}}}];return null});await render();expect(container.textContent).toContain('不会自动覆盖');await click(button('保留本机'));expect(api).toHaveBeenCalledWith('/api/sync/conflicts/c1/resolve',{method:'POST',body:JSON.stringify({choice:'local'})})})
it('opens app-owned remote folder only for local lab',async()=>{await render();await click(button('打开模拟远端'));expect(window.electronAPI.openAppFolder).toHaveBeenCalledWith('syncLab')})
it('shows readable attachment conflict labels',async()=>{api.mockImplementation(async(path)=>{if(path==='/api/settings')return settings;if(path==='/api/sync/status')return{...status,open_conflicts:1,last_status:'conflicts'};if(path==='/api/sync/conflicts')return[{id:'a1',item_id:'attachment:00',local_record:{kind:'attachment',state:'present',attachment:{name:'资料.pdf'}},remote_record:{kind:'attachment',state:'purged'}}];return null});await render();expect(container.textContent).toContain('资料.pdf');expect(container.textContent).toContain('已永久删除')})
it('saves WebDAV endpoint username and a newly entered password explicitly',async()=>{await render();await input('WebDAV 端点','https://dav.example.test/notepad');await input('WebDAV 用户名','alice');await input('WebDAV 密码','secret');await click(button('保存并启用 WebDAV'));const call=api.mock.calls.find(([path,init])=>path==='/api/settings'&&init?.method==='PUT'&&JSON.parse(init.body).sync_provider==='webdav');expect(JSON.parse(call[1].body)).toEqual({sync_enabled:true,sync_provider:'webdav',sync_endpoint:'https://dav.example.test/notepad',sync_username:'alice',sync_password:'secret'})})
it('does not send an empty password over an already configured WebDAV secret',async()=>{api.mockImplementation(async(path,init)=>{if(path==='/api/settings'&&!init)return{...settings,sync_enabled:true,sync_provider:'webdav',sync_endpoint:'https://dav.example.test/notepad',sync_username:'alice',sync_password_set:true};if(path==='/api/sync/status')return{...status,provider:'webdav'};if(path==='/api/sync/conflicts')return[];if(path==='/api/settings'&&init?.method==='PUT')return{};return null});await render();await click(button('保存 WebDAV 设置'));const call=api.mock.calls.find(([path,init])=>path==='/api/settings'&&init?.method==='PUT');expect(JSON.parse(call[1].body)).not.toHaveProperty('sync_password');expect(container.textContent).toContain('留空保持不变')})
it('rebinds remote metadata only after explicit confirmation',async()=>{await render();expect(button('重新绑定远端')).toBeTruthy();await click(button('重新绑定远端'));expect(window.confirm).toHaveBeenCalledTimes(1);expect(api).toHaveBeenCalledWith('/api/sync/rebind',{method:'POST',body:'{}'});expect(container.textContent).not.toContain('重新绑定远端')})
})

it('configures automatic WebDAV sync without replacing manual controls',async()=>{
  api.mockImplementation(async(path,init)=>{
    if(path==='/api/settings'&&!init)return{...settings,sync_provider:'webdav',sync_endpoint:'https://dav.example.test/notepad',sync_username:'alice',sync_password_set:true}
    if(path==='/api/sync/status')return{...status,provider:'webdav'}
    if(path==='/api/sync/conflicts')return[]
    if(path==='/api/settings'&&init?.method==='PUT')return{}
    return null
  })
  await render()
  expect(button('开启自动同步')).toBeTruthy()
  await click(button('开启自动同步'))
  const call=api.mock.calls.find(([path,init])=>path==='/api/settings'&&init?.method==='PUT')
  expect(JSON.parse(call[1].body)).toEqual({sync_auto_enabled:true,sync_interval_minutes:5})
  expect(button('预演同步')).toBeTruthy()
  expect(button('执行同步')).toBeTruthy()
})
