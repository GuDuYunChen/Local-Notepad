import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

export async function verifyTemplateLibraryDesktop({evaluate,click,cdp,until,api,out,noteIDs}){
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'template-library.json'),JSON.stringify(report,null,2)+'\n'),mark=x=>{report.checks.push(x);save()};save()
 const before=await Promise.all(noteIDs.map(id=>api('/api/files/'+id)))
 const base='http://127.0.0.1:27121',faults=[],pending=new Set();let detach,intercept=false,interceptionError
 const action=async(label,scope='.template-library')=>{
  assert.equal(await evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!n||n.disabled)return false;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!h||!n.contains(h))return false;n.setAttribute('data-template-click','');return true})()`),true,'Template action not reachable: '+label)
  try{await click('[data-template-click]')}finally{await evaluate("document.querySelector('[data-template-click]')?.removeAttribute('data-template-click')")}
 }
 const key=async(k,code,modifiers=2)=>{for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:k,windowsVirtualKeyCode:code,modifiers})}
 const fill=async(label,value)=>{const selector='.template-library [aria-label="'+label+'"]';await click(selector);await key('a',65);await cdp.send('Input.insertText',{text:value});assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),value)}
 const hasText=text=>until(()=>evaluate(`document.querySelector('.template-library')?.innerText.includes(${JSON.stringify(text)})`),'Template result missing: '+text,15000)
 const open=async()=>{await key('n',78);await until(()=>evaluate("!!document.querySelector('.template-selector')"),'Template entry missing');await action('管理我的模板','.template-selector');await until(()=>evaluate("!!document.querySelector('.template-library')"),'Template library missing');await hasText('本机操作记录')}
 const library=()=>api('/api/template-library')
 const row=async title=>{assert.equal(await evaluate(`(()=>{const n=[...document.querySelectorAll('.template-library-index li')].find(n=>n.querySelector('strong')?.textContent===${JSON.stringify(title)});if(!n)return false;n.setAttribute('data-owned-template','');return true})()`),true);return '[data-owned-template]'}
 const releaseRow=()=>evaluate("document.querySelector('[data-owned-template]')?.removeAttribute('data-owned-template')")
 const screenshot=async()=>{const b=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');writeFileSync(path.join(out,'template-library-installed.png'),b);report.screenshots.push({filename:'template-library-installed.png',bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});save()}
 try{
  const denied=await fetch(base+'/api/templates/'+noteIDs[0],{method:'DELETE',headers:{Origin:'null'},signal:AbortSignal.timeout(4000)});assert.notEqual((await denied.json()).code,0);assert.deepEqual(await api('/api/files/'+noteIDs[0]),before[0]);mark('legacy-template-delete-refuses-ordinary-note')
  await cdp.send('Network.setBlockedURLs',{urls:[base+'/api/template-library']});await open();await hasText('不能据此判断为空');mark('read-failure-is-not-empty')
  await cdp.send('Network.setBlockedURLs',{urls:[]});await action('刷新模板库');await until(()=>evaluate("!document.querySelector('.template-library-index [role=alert]') && !document.querySelector('.template-library-index [role=status]')"),'Template refresh failed')
  await action('新建模板');await fill('模板名称','本地模板验收');await fill('模板正文','模板原文\ntemplate-original-body');await action('保存模板');await hasText('创建回执已确认')
  let record=(await library()).items.find(x=>x.title==='本地模板验收');assert.ok(record?.id);const id=record.id;mark('template-created-and-persisted')
  let scope=await row('本地模板验收');await action('编辑',scope);await releaseRow();await fill('模板正文','修订模板\ntemplate-revised-body');await action('保存模板');await hasText('模板修改已确认')
  record=(await library()).items.find(x=>x.id===id);assert.ok(record.content.includes('template-revised-body'));mark('template-edited-through-exact-original-snapshot')
  scope=await row('本地模板验收');await click(scope+' .template-library-row');await releaseRow();await fill('新笔记名称','模板验收复制.md');await action('从预览创建文本笔记');await hasText('创建回执已确认');await action('打开已创建的笔记')
  await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('template-revised-body') && !document.querySelector('.template-library')"),'Created template note not opened')
  await until(()=>evaluate("!document.querySelector('.save-state')"),'Canonical template copy starts dirty')
  const copies=await api('/api/files?q='+encodeURIComponent('模板验收复制.md')+'&page=1&size=200'),copy=copies.find(x=>x.title==='模板验收复制.md');assert.ok(copy?.id);assert.notEqual(copy.id,id);mark('separate-canonical-copy-opens-without-dirty-normalization')
  await click('.editor-input[contenteditable="true"]');await key('End',35);await cdp.send('Input.insertText',{text:' template-copy-edited'});await key('s',83)
  await until(async()=>(await api('/api/files/'+copy.id)).content.includes('template-copy-edited'),'Original editor failed to save template copy');await until(()=>evaluate("!document.querySelector('.save-state')"),'Template copy save pending');assert.equal((await library()).items.find(x=>x.id===id).content,record.content);mark('copy-edit-save-does-not-modify-template')
  await open();await hasText('本地模板验收');scope=await row('本地模板验收');await action('移除模板',scope);await releaseRow();await action('取消','.template-library [role=dialog]');assert.equal((await library()).items.find(x=>x.id===id).archived,false)
  scope=await row('本地模板验收');await action('移除模板',scope);await releaseRow();await action('确认移除模板','.template-library [role=dialog]');await until(async()=>(await library()).items.find(x=>x.id===id)?.archived===true,'Template archive failed');await hasText('模板修改已确认');mark('archive-confirmation-does-not-remove-created-notes')
  await click('.template-library-check input');scope=await row('本地模板验收');await action('恢复模板',scope);await releaseRow();await action('确认恢复模板','.template-library [role=dialog]');await until(async()=>(await library()).items.find(x=>x.id===id)?.archived===false,'Template restore failed');await hasText('模板修改已确认');await click('.template-library-check input');mark('archived-template-restored')
  scope=await row('本地模板验收');await click(scope+' .template-library-row');await releaseRow();await fill('新笔记名称','模板回执丢失.md')
  detach=cdp.onEvent(m=>{if(m.method!=='Fetch.requestPaused')return;const {requestId,request,responseStatusCode}=m.params;let body;try{body=JSON.parse(request.postData||'{}')}catch{}
   const drop=request.method==='POST'&&body?.kind==='note'&&body?.title==='模板回执丢失.md'&&responseStatusCode===200;if(drop)faults.push({url:request.url,method:request.method,responseStatusCode})
   const task=cdp.send(drop?'Fetch.failRequest':'Fetch.continueRequest',drop?{requestId,errorReason:'Failed'}:{requestId}).catch(e=>{interceptionError ||= e}).finally(()=>pending.delete(task));pending.add(task)})
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:base+'/api/template-library/requests/*',requestStage:'Response'}]});intercept=true
  await action('从预览创建文本笔记');await hasText('操作尚未确认');const lost=(await api('/api/files?q='+encodeURIComponent('模板回执丢失.md')+'&page=1&size=200')).filter(x=>x.title==='模板回执丢失.md');assert.equal(lost.length,1);assert.equal(faults.length,1)
  await cdp.send('Fetch.disable');intercept=false;await Promise.all([...pending]);detach();detach=null;if(interceptionError)throw interceptionError;mark('real-post-commit-response-loss-retains-recovery-record')
  assert.equal(await evaluate("(()=>{const n=[...document.querySelectorAll('.template-library-records article')].find(n=>n.textContent.includes('模板回执丢失.md'));if(!n)return false;n.setAttribute('data-lost-template-record','');return true})()"),true)
  await action('核对操作结果','[data-lost-template-record]');await hasText('创建回执已确认');await action('打开已创建的笔记');await until(()=>evaluate("!document.querySelector('.template-library') && document.querySelector('.editor-input')?.innerText.includes('template-revised-body')"),'Lost copy not recovered')
  assert.equal((await api('/api/files?q='+encodeURIComponent('模板回执丢失.md')+'&page=1&size=200')).filter(x=>x.title==='模板回执丢失.md').length,1);report.failureInjection={exactCommittedNotePostOnly:true,faults};mark('read-only-reconciliation-opens-same-copy-without-reposting')
  await open();await hasText('本地模板验收')
  await evaluate("window.dispatchEvent(new CustomEvent('local-notepad:toast',{detail:{action:'show',toast:{id:'template-passive-hit-test',type:'success',content:'模板通知保持可见',duration:0}}}))")
  await until(()=>evaluate("[...document.querySelectorAll('.app-toast-content')].some(n=>n.textContent==='模板通知保持可见')"),'Real passive notification missing')
  assert.equal(await evaluate("[...document.querySelectorAll('.app-toast')].every(n=>getComputedStyle(n).pointerEvents==='none')"),true,'Passive toast must not intercept input')
  await screenshot();await action('返回模板选择')
  assert.equal(await evaluate("!!document.querySelector('.template-selector') && [...document.querySelectorAll('.app-toast-content')].some(n=>n.textContent==='模板通知保持可见')"),true,'Return must complete without hiding notification')
  report.passiveToast={realViewport:true,remainedVisible:true,originalMouseHitTest:true};mark('visible-passive-toast-does-not-block-template-return')
  await click('.template-selector-header button[aria-label="关闭"]');mark('library-can-close-and-reopen')
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before);mark('original-notes-unchanged')
  report.complete=true;save()
 }catch(e){report.error=String(e.stack||e);save();throw e}
 finally{await evaluate("window.dispatchEvent(new CustomEvent('local-notepad:toast',{detail:{action:'close',id:'template-passive-hit-test'}}))");if(intercept)await cdp.send('Fetch.disable');await Promise.all([...pending]);detach?.();await cdp.send('Network.setBlockedURLs',{urls:[]})}
}
