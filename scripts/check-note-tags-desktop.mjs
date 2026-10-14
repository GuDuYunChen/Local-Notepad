import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {desktopNote} from './desktop-save-fixture.mjs'
export async function verifyNoteTagsDesktop({evaluate,click,cdp,until,api,out,noteIDs}){
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'note-tags.json'),JSON.stringify(report,null,2)+'\n'),mark=n=>{report.checks.push(n);save()};save()
 const original=await Promise.all(noteIDs.map(id=>api('/api/files/'+id)))
 const originalTags=await Promise.all(noteIDs.map(id=>api('/api/files/'+id+'/tags')))
 const file=await api('/api/files',{method:'POST',body:JSON.stringify({title:'Note tags closure.md',content:desktopNote('标签验收','note-tags-original-body')})})
 const route='/api/note-tags/'+file.id,base='http://127.0.0.1:27121',faults=[];let detach=null,intercept=false,problem=null;const tasks=new Set()
 const text=()=>evaluate("document.querySelector('.note-tag-panel')?.innerText||''")
 const has=needle=>until(async()=>(await text()).includes(needle),'Tag result missing: '+needle,15000)
 const action=async(label,scope='.note-tags')=>{
  assert.equal(await evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)});if(a.length!==1||a[0].disabled)return false;const n=a[0];n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!n.contains(hit))return false;n.setAttribute('data-tag-click','');return true})()`),true,'Tag action unreachable: '+label)
  try{await click('[data-tag-click]')}finally{await evaluate("document.querySelector('[data-tag-click]')?.removeAttribute('data-tag-click')")}
 }
 const fill=async(label,value)=>{await click(`.note-tags input[aria-label="${label}"]`);for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:'a',windowsVirtualKeyCode:65,modifiers:2});await cdp.send('Input.insertText',{text:value})}
 try{
  await evaluate("window.dispatchEvent(new Event('library:refresh'))");await until(()=>evaluate(`!!document.querySelector('[data-file-id="${file.id}"]')`),'New tag fixture missing');await click(`[data-file-id="${file.id}"]`)
  await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('note-tags-original-body')"),'Tag note not loaded')
  if(!await evaluate("!!document.querySelector('.inspector-panel')"))await click('button[aria-label="笔记详情"]')
  await click('#inspector-tab-properties');await until(()=>evaluate("!!document.querySelector('.note-tags')"),'Tag entry missing');await action('管理标签');await has('已分配')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.note-tags')).display"),'block','Tag editor must not use legacy inline trigger layout')
  mark('properties-entry-reads-current-note-tags')
  await cdp.send('Network.setBlockedURLs',{urls:[base+route]});await action('重新读取标签');await has('本机服务请求失败');assert.ok(!(await text()).includes('暂无标签'));mark('failed-read-is-not-empty-success')
  await cdp.send('Network.setBlockedURLs',{urls:[]});await action('重新读取标签');await has('已分配');mark('explicit-read-retry-recovers')
  await fill('新标签名称','本地标签验收');await action('新建并分配');await has('标签已创建或复用');let snapshot=await api(route);const tag=snapshot.tags.find(t=>t.name==='本地标签验收');assert.ok(tag)
  assert.equal((await api('/api/files/'+file.id)).content,file.content);mark('atomic-create-and-attach-preserves-note-body')
  await fill('新标签名称','本地标签验收');await action('新建并分配');await until(()=>evaluate("document.querySelector('.note-tags input[aria-label=\"新标签名称\"]')?.value===''"),'Create did not settle')
  snapshot=await api(route);assert.equal(snapshot.available.filter(t=>t.name==='本地标签验收').length,1);assert.equal(snapshot.tags.filter(t=>t.id===tag.id).length,1);mark('existing-name-reused-without-duplicate')
  await click(`.note-tag-option[data-note-tag-id="${tag.id}"]`);await action('取消','.note-tags [role=dialog]');assert.ok((await api(route)).tags.some(t=>t.id===tag.id));mark('remove-cancel-has-no-side-effect')
  await click(`.note-tag-option[data-note-tag-id="${tag.id}"]`);await action('确认','.note-tags [role=dialog]');await has('已从当前笔记移除');snapshot=await api(route);assert.ok(!snapshot.tags.some(t=>t.id===tag.id));assert.ok(snapshot.available.some(t=>t.id===tag.id));mark('confirmed-removal-keeps-shared-label')
  await click('.editor-input[contenteditable="true"]');await cdp.send('Input.insertText',{text:' tag-draft-preserved '});await until(()=>evaluate("!!document.querySelector('.save-state')"),'Dirty draft absent')
  await click(`.note-tag-option[data-note-tag-id="${tag.id}"]`);await has('标签已添加到当前笔记');assert.equal((await api('/api/files/'+file.id)).content,file.content);assert.ok(await evaluate("document.querySelector('.editor-input').innerText.includes('tag-draft-preserved')"));mark('tag-assignment-does-not-save-or-replace-draft')
  await click('.editor-input[contenteditable="true"]');for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:'s',windowsVirtualKeyCode:83,modifiers:2})
  await until(async()=>(await api('/api/files/'+file.id)).content.includes('tag-draft-preserved'),'Original save did not persist draft');await until(()=>evaluate("!document.querySelector('.save-state')"),'Original save still pending');mark('original-editor-save-still-persists-body')
  detach=cdp.onEvent(event=>{if(event.method!=='Fetch.requestPaused')return;const {requestId,request,responseStatusCode}=event.params;const drop=request.url===base+route&&request.method==='POST'&&responseStatusCode===200;if(drop)faults.push({url:request.url,method:request.method,responseStatusCode});const task=cdp.send(drop?'Fetch.failRequest':'Fetch.continueRequest',drop?{requestId,errorReason:'Failed'}:{requestId}).catch(e=>{problem||=e}).finally(()=>tasks.delete(task));tasks.add(task)})
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:base+route,requestStage:'Response'}]});intercept=true
  await fill('新标签名称','回执丢失标签');await action('新建并分配');await has('标签操作未确认');assert.equal(faults.length,1);assert.ok((await api(route)).tags.some(t=>t.name==='回执丢失标签'));mark('committed-write-with-lost-response-retains-unconfirmed-state')
  await cdp.send('Fetch.disable');intercept=false;await Promise.all([...tasks]);detach();detach=null;if(problem)throw problem
  await action('核对当前标签');await has('不是原请求的历史回执');await action('结束这条操作记录');await action('确认','.note-tags [role=dialog]');await has('已结束本机操作记录');assert.equal(faults.length,1);report.failureInjection={exactPostResponseOnly:true,faults};mark('read-only-reconciliation-never-reposts-write')
  const bytes=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');const filename='note-tags-installed.png';writeFileSync(path.join(out,filename),bytes);report.screenshots.push({filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
  // A failed creation retains its input. Close must explicitly discard only that unsent name.
  await click('.note-tags button[aria-label="关闭标签管理"]');if(await evaluate("!!document.querySelector('.note-tags [role=dialog]')"))await action('确认','.note-tags [role=dialog]')
  await action('管理标签');assert.ok((await api(route)).tags.some(t=>t.name==='回执丢失标签'));mark('close-reopen-retains-persisted-tags')
  await click('button[aria-label="关闭详情"]');assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),original);assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id+'/tags'))),originalTags);mark('other-note-bodies-and-tag-associations-unchanged')
  report.complete=true;save()
 }catch(error){report.error=String(error.stack||error);save();throw error}
 finally{try{if(intercept)await cdp.send('Fetch.disable');await Promise.all([...tasks]);detach?.()}finally{await cdp.send('Network.setBlockedURLs',{urls:[]})}}
}
