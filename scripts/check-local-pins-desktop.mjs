import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {desktopNote} from './desktop-save-fixture.mjs'
export async function verifyLocalPinsDesktop({evaluate,click,cdp,until,api,out,noteIDs}) {
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'local-pins.json'),JSON.stringify(report,null,2)+'\n'),mark=n=>{report.checks.push(n);save()};save()
 const before=await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),base='http://127.0.0.1:27121'
 const file=await api('/api/files',{method:'POST',body:JSON.stringify({title:'置顶验收96常用.md',content:desktopNote('置顶验收','pin96-original-body')})})
 const route='/api/local-pins/'+file.id,fileRoute='/api/files/'+file.id
 const key=async(k,code,modifiers=0)=>{for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:k,windowsVirtualKeyCode:code,modifiers})}
 const text=()=>evaluate("document.querySelector('.pinned-workspace')?.innerText||''"),has=v=>until(async()=>(await text()).includes(v),'Pinned workspace result missing: '+v)
 const frame=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
 const action=async(label,scope='.pinned-workspace')=>{
  await frame()
  assert.equal(await evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)}||n.getAttribute('aria-label')===${JSON.stringify(label)});if(a.length!==1||a[0].disabled)return false;const n=a[0];n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!n.contains(hit))return false;n.setAttribute('data-pin-action','');return true})()`),true,'Pin action unreachable: '+label)
  try{await click('[data-pin-action]')}finally{await evaluate("document.querySelector('[data-pin-action]')?.removeAttribute('data-pin-action')")}
 }
 const menu=async()=>{
  await frame()
  const point=await evaluate(`(()=>{const n=document.querySelector('[data-file-id="${file.id}"]');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,...point,button:'right',clickCount:1})
  await until(()=>evaluate("!!document.querySelector('[role=menu]')"),'Original context menu absent')
 }
 const menuAction=async label=>{
  assert.equal(await evaluate(`(()=>{const n=[...document.querySelectorAll('[role=menuitem]')].find(n=>n.querySelector('.menu-item-label')?.textContent===${JSON.stringify(label)});if(!n)return false;n.setAttribute('data-pin-menu','');return true})()`),true)
  try{await click('[data-pin-menu]')}finally{await evaluate("document.querySelector('[data-pin-menu]')?.removeAttribute('data-pin-menu')")}
 }
 const query=async value=>{await click('.pinned-workspace input[aria-label="查找置顶笔记"]');await key('a',65,2);if(value)await cdp.send('Input.insertText',{text:value});else await key('Backspace',8);await until(()=>evaluate(`document.querySelector('.pinned-workspace input')?.value===${JSON.stringify(value)}`),'Pin query missing')}
 const all=async()=>{await click('.pinned-workspace select[aria-label="置顶显示范围"]');await key('End',35);await key('Enter',13);await until(()=>evaluate("document.querySelector('.pinned-workspace select').value==='all'"),'All notes view missing')}
 const panel=async()=>{await click('.workspace-sidebar-nav-item[aria-label="置顶笔记"]');await has('篇已置顶')}
 const clean=()=>until(()=>evaluate("!document.querySelector('.workspace-save-chip, .save-state')"),'Original editor not clean')
 let intercept=false,detach=null,faultError=null;const tasks=new Set(),faults=[]
 try{
  await evaluate("window.dispatchEvent(new Event('library:refresh'))");await until(()=>evaluate(`!!document.querySelector('[data-file-id="${file.id}"]')`),'Pin fixture not listed');await click(`[data-file-id="${file.id}"]`);await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('pin96-original-body')"),'Pin body missing');await clean()
  await menu();await menuAction('置顶');await until(async()=>(await api(route)).is_pinned===true,'Original pin failed');await until(()=>evaluate(`!!document.querySelector('[data-file-id="${file.id}"] .pin-icon')`),'Original list did not refresh pin');mark('original-context-pin-refreshes-list-after-confirmed-write')
  assert.equal((await api(fileRoute)).content,file.content);assert.equal((await api(fileRoute)).updated_at,file.updated_at);mark('pin-changes-neither-body-nor-edited-time')
  await menu();await menuAction('取消置顶');await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Unpin confirmation absent');await action('取消','.consumer-confirm-modal');assert.equal((await api(route)).is_pinned,true);mark('original-menu-unpin-cancel-is-no-write')
  await click('.editor-input[contenteditable="true"]');await key('End',35,2);await cdp.send('Input.insertText',{text:' pin96-unsaved-draft'});await until(()=>evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),'Pin draft not dirty')
  await menu();await menuAction('取消置顶');await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Unpin confirmation missing');await action('确认','.consumer-confirm-modal');await until(async()=>(await api(route)).is_pinned===false,'Unpin failed');assert.equal((await api(fileRoute)).content,file.content);assert.equal(await evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),true);mark('unpin-does-not-save-or-replace-unsaved-body')
  await click('.workspace-sidebar-nav-item[aria-label="置顶笔记"]');await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Original draft decision absent');await action('取消','.consumer-confirm-modal');assert.equal(await evaluate("!!document.querySelector('.pinned-workspace')"),false);assert.ok(await evaluate("document.querySelector('.editor-input').innerText.includes('pin96-unsaved-draft')"));mark('cancelled-workspace-entry-retains-original-draft')
  await click('.editor-input[contenteditable="true"]');await key('s',83,2);await until(async()=>(await api(fileRoute)).content.includes('pin96-unsaved-draft'),'Original save failed');await clean();mark('original-save-persists-body-after-pin-actions')
  await cdp.send('Network.setBlockedURLs',{urls:[base+'/api/local-pins']});await click('.workspace-sidebar-nav-item[aria-label="置顶笔记"]');await has('本机服务请求失败');assert.ok(!(await text()).includes('还没有置顶笔记'));await cdp.send('Network.setBlockedURLs',{urls:[]});await action('重新读取置顶笔记');await has('篇已置顶');mark('failed-list-read-is-not-empty-and-explicit-retry-recovers')
  await all();await query('置顶验收96');await has('1 个匹配结果');await click(`[data-pinned-note-id="${file.id}"]`);assert.equal(await evaluate("!!document.querySelector('.pinned-workspace')"),true);await action('置顶这篇笔记');await has('常用笔记列表已更新');assert.equal((await api(route)).is_pinned,true);mark('workspace-search-selection-and-pin-complete-without-opening')
  detach=cdp.onEvent(event=>{if(event.method!=='Fetch.requestPaused')return;const {requestId,request,responseStatusCode}=event.params;const drop=request.url===base+route&&request.method==='PUT'&&responseStatusCode===200;if(drop)faults.push({url:request.url,method:request.method,responseStatusCode});const task=cdp.send(drop?'Fetch.failRequest':'Fetch.continueRequest',drop?{requestId,errorReason:'Failed'}:{requestId}).catch(e=>{faultError||=e}).finally(()=>tasks.delete(task));tasks.add(task)})
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:base+route,requestStage:'Response'}]});intercept=true
  await action('取消这篇笔记置顶…');await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Workspace unpin confirmation absent');await action('确认','.consumer-confirm-modal');await has('置顶结果未确认');assert.equal((await api(route)).is_pinned,false);assert.equal(faults.length,1);assert.equal(await evaluate("!!localStorage.getItem('local-notepad.pending-pin.v1')"),true);mark('committed-pin-response-loss-keeps-durable-unconfirmed-record')
  await cdp.send('Fetch.disable');intercept=false;await Promise.all([...tasks]);detach();detach=null;if(faultError)throw faultError
  await action('核对当前置顶状态');await has('不是原请求的历史回执');await action('结束这条操作记录');await action('确认','.consumer-confirm-modal');await has('已结束本机置顶记录');assert.equal(faults.length,1);assert.equal(await evaluate("localStorage.getItem('local-notepad.pending-pin.v1')"),null);report.failureInjection={exactCommittedPutResponseOnly:true,faults};mark('read-only-reconciliation-and-explicit-ending-never-replay-put')
  await api(fileRoute,{method:'PUT',body:JSON.stringify({title:'置顶验收96更名.md'})});await action('打开选中笔记');await has('名称或置顶状态已变化');assert.equal(await evaluate("!!document.querySelector('.pinned-workspace')"),true);mark('stale-renamed-target-refused-without-navigation')
  await action('刷新列表');await has('篇已置顶');await query('置顶验收96');await has('1 个匹配结果');await click(`[data-pinned-note-id="${file.id}"]`)
  const data=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'),filename='local-pins-installed.png';writeFileSync(path.join(out,filename),data);report.screenshots.push({filename,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});save()
  await action('打开选中笔记');await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('pin96-unsaved-draft')"),'Fresh target not opened');assert.equal(await evaluate("!!document.querySelector('.pinned-workspace')"),false);mark('fresh-target-opens-through-original-guard-with-saved-body')
  await panel();await all();await query('置顶验收96');await has('1 个匹配结果');await action('返回笔记');await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('pin96-unsaved-draft')"),'Return lost current note');mark('close-reopen-retains-current-pin-state-and-note')
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before);mark('unrelated-note-bodies-metadata-and-pins-unchanged')
  report.complete=true;save()
 }catch(error){report.error=String(error.stack||error);save();throw error}
 finally{try{if(intercept)await cdp.send('Fetch.disable');await Promise.all([...tasks]);detach?.()}finally{await cdp.send('Network.setBlockedURLs',{urls:[]})}}
}
