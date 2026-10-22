import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import TrashWorkspacePanel from './TrashWorkspacePanel.jsx'
import { createTrashWorkspace } from '../services/trashWorkspace.mjs'
const check = (ok, message) => { if (!ok) throw new Error(message) }
const row = id => ({ id, title: 'fixture ' + id, is_folder: false, is_deleted: true, parent_id: '', deleted_at: 1791760000, updated_at: 100 })
const tick = async () => { for (let i=0;i<16;i++) await Promise.resolve() }
async function fixture(run, mode = 'normal') {
  const host = document.createElement('div');document.body.appendChild(host)
  let rows = [row('a'),row('b')], reads = 0, writes = [], selectedMode = mode
  const store = createTrashWorkspace(async (route, init) => {
    if (!init.method) { reads++; if(selectedMode==='read-error') throw Error('fixture');return structuredClone(rows) }
    const id=route.split('/')[3];writes.push(id)
    if(selectedMode==='write-error')throw Error('同名冲突 private title')
    rows=rows.filter(r=>r.id!==id);return null
  })
  const root=createRoot(host),previous=globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const button = name => [...host.querySelectorAll('button')].find(n=>n.textContent===name)
  const click = async name => { const b=button(name);check(b&&!b.disabled,'Missing enabled action: '+name);await act(async()=>{b.click();await tick()}) }
  try {
    await act(async()=>{root.render(React.createElement(React.StrictMode,null,React.createElement(TrashWorkspacePanel,{store,onClose(){}})));await tick()})
    await run({host,store,click,button,mode:value=>{selectedMode=value},writes,reads:()=>reads})
  } finally { await act(async()=>root.unmount());host.remove();globalThis.IS_REACT_ACT_ENVIRONMENT=previous }
}
export function registerTrashWorkspaceDOMTests(test) {
  test('trash DOM StrictMode entry resolves to a real list',async()=>fixture(async f=>{
    check(f.host.querySelectorAll('[data-trash-id]').length===2,'Initial lifecycle left the list blank')
    check(f.writes.length===0,'Mount wrote data')
  }))
  test('trash DOM read failure is not empty success and can manually recover',async()=>fixture(async f=>{
    check(f.host.querySelector('[role=alert]'),'Missing read error');check(!f.host.textContent.includes('回收站是空的'),'False empty state')
    f.mode('normal');await f.click('重新读取');check(f.host.querySelectorAll('[data-trash-id]').length===2,'Recovery did not load rows')
  },'read-error'))
  test('trash DOM cancelled restore sends no mutation',async()=>fixture(async f=>{
    await f.click('恢复');check(f.host.querySelector('[role=dialog]'),'Missing confirmation');await f.click('取消');check(f.writes.length===0,'Cancelled action wrote')
  }))
  test('trash DOM restore completes with a persistent success receipt',async()=>fixture(async f=>{
    await f.click('恢复');await f.click('确认恢复');check(f.writes.length===1,'Wrong mutation count');check(f.host.querySelector('[data-status=succeeded]'),'Success receipt missing');check(f.host.querySelectorAll('[data-trash-id]').length===1,'List not refreshed')
  }))
  test('trash DOM deletion stays disabled without typed confirmation',async()=>fixture(async f=>{
    await f.click('永久删除');check(f.button('确认永久删除').disabled,'Deletion was not gated');await f.click('取消');check(f.writes.length===0,'Delete escaped confirmation')
  }))
  test('trash DOM failure stops batch and retains unfinished targets',async()=>fixture(async f=>{
    await act(async()=>f.host.querySelector('[aria-label="全选当前页"]').click());await f.click('恢复所选');await f.click('确认恢复')
    check(f.writes.length===1,'Failure did not stop batch');check(f.host.querySelector('[data-status=unconfirmed]'),'Missing unknown receipt');check(f.host.querySelector('[data-status=not-started]'),'Missing unstarted target')
  },'write-error'))
  test('trash DOM filtered no-match is distinct from empty recycle bin',async()=>fixture(async f=>{
    const input=f.host.querySelector('input[type=search]')
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'no match');input.dispatchEvent(new Event('input',{bubbles:true}))})
    check(f.host.textContent.includes('没有匹配的项目'),'Missing no-match explanation');check(!f.host.textContent.includes('回收站是空的'),'False empty on filter');check(f.writes.length===0,'Filtering wrote data')
  }))
  test('trash DOM repeated StrictMode mounts do not lose the load transition',async()=>{
    for(let i=0;i<20;i++)await fixture(async f=>check(f.host.querySelectorAll('[data-trash-id]').length===2,'Lost initial list at mount '+i))
  })

  test('trash DOM collapse keeps an unknown result readable without any replay',async()=>fixture(async f=>{
    await f.click('恢复');await f.click('确认恢复');const key=f.store.snapshot().report.key
    await f.click('收起记录');check(!f.host.querySelector('.trash-workspace-report'),'Current report did not collapse')
    const view=f.host.querySelector(`[aria-label="查看恢复记录 #${key}"]`);check(view,'Collapsed receipt is not reachable')
    await act(async()=>view.click());check(f.host.querySelector('[data-history-status=unconfirmed]'),'Unknown receipt was erased')
    check(f.writes.length===1,'Opening history replayed a request')
  },'write-error'))
  test('trash DOM later success cannot rewrite the earlier unknown receipt',async()=>fixture(async f=>{
    await f.click('恢复');await f.click('确认恢复');const key=f.store.snapshot().report.key
    f.mode('normal');await f.click('恢复');await f.click('确认恢复')
    check(f.host.querySelector('.trash-workspace-report [data-status=succeeded]'),'Latest success missing')
    await act(async()=>f.host.querySelector(`[aria-label="查看恢复记录 #${key}"]`).click())
    check(f.host.querySelector('[data-history-status=unconfirmed]'),'Earlier result silently became success')
    check(f.writes.length===2,'Unexpected write while reviewing history')
  },'write-error'))
  test('trash DOM removing unknown history requires a separate explicit acknowledgement',async()=>fixture(async f=>{
    await f.click('恢复');await f.click('确认恢复');const key=f.store.snapshot().report.key;await f.click('收起记录')
    await act(async()=>f.host.querySelector(`[aria-label="查看恢复记录 #${key}"]`).click());await f.click('移除此记录')
    check(f.button('确认移除记录').disabled,'Unknown history removal was not gated');await f.click('取消移除')
    check(f.store.snapshot().history.length===1,'Cancel discarded history');await f.click('移除此记录')
    await act(async()=>f.host.querySelector('[aria-label="理解未确认记录移除后不能找回"]').click());await f.click('确认移除记录')
    check(f.store.snapshot().history.length===0,'Explicit metadata removal failed');check(f.writes.length===1,'Metadata removal wrote to notes')
  },'write-error'))
  test('trash DOM historical record viewing makes no request and shows the session boundary',async()=>fixture(async f=>{
    await f.click('恢复');await f.click('确认恢复');const key=f.store.snapshot().report.key;await f.click('收起记录')
    const reads=f.reads();await act(async()=>f.host.querySelector(`[aria-label="查看恢复记录 #${key}"]`).click())
    check(f.reads()===reads&&f.writes.length===1,'History inspection contacted the service')
    check(f.host.querySelector('.trash-workspace-history').textContent.includes('重启后不保留'),'Session boundary is missing')
  },'write-error'))
}
