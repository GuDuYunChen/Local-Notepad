import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { refreshLocalExportLibrary } from './check-local-export-desktop.mjs'
import { blockReferenceFixture } from './block-references-desktop-driver.mjs'
import { TAG_CHECKS, tagHash } from './tag-workspace-desktop-evidence.mjs'
const q=JSON.stringify, KEY='local-notepad.tag-workspace.v1'
export async function verifyTagWorkspaceDesktop(ctx) {
  const {api,evaluate,click,until,capture,report,save,start,closeNormally,reinstallWithRetainedDraft,resizeSmall}=ctx
  report.checks=[];report.feedback={};report.exits=[]
  const phase=value=>{report.phase=value;save()}
  const mark=name=>{assert.equal(name,TAG_CHECKS[report.checks.length]);report.checks.push(name);save()}
  const key=async(key,code,modifiers=0)=>{for(const type of ['rawKeyDown','keyUp'])await ctx.cdp().send('Input.dispatchKeyEvent',{type,key,windowsVirtualKeyCode:code,modifiers})}
  const action=(text,selector='.tag-workspace button')=>click({selector,text})
  const field=async(label,value)=>{const selector='.tag-workspace input[aria-label='+q(label)+']';await click(selector);await key('a',65,2);await key('Backspace',8);if(value)await ctx.cdp().send('Input.insertText',{text:value});assert.equal(await evaluate(`document.querySelector(${q(selector)}).value`),value)}
  const waitText=text=>until(()=>evaluate(`document.querySelector('.tag-workspace')?.textContent.includes(${q(text)})`),'Missing tag feedback: '+text)
  const snapshot=()=>api('/api/tag-workspace')
  const journal=()=>evaluate(`localStorage.getItem(${q(KEY)})`)
  const settings=async()=>{if(!await evaluate("Boolean(document.querySelector('.settings-panel'))")){await click('button[aria-label="更多功能"]');await click({selector:'.workspace-sidebar-more-menu button',text:'设置'})}await until(()=>evaluate("Boolean(document.querySelector('.settings-panel'))"),'Settings not ready')}
  const open=async()=>{await settings();await action('打开标签工作台','.settings-panel button');await until(()=>evaluate("Boolean(document.querySelector('.tag-workspace-columns'))"),'Tag workspace not ready')}
  const close=async()=>{await click('button[aria-label="关闭标签工作台"]');if(await evaluate("Boolean(document.querySelector('.tag-workspace-confirm'))"))await action('确认','.tag-workspace-confirm button');await until(()=>evaluate("!document.querySelector('.tag-workspace')"),'Tag workspace did not close')}
  const select=async id=>{await click('[data-workspace-tag='+q(id)+']');await until(()=>evaluate(`document.querySelector('[data-workspace-tag='+${q(q(id))}+']')?.getAttribute('aria-pressed')==='true'&&document.querySelectorAll('.tag-workspace-notes button').length>0||document.querySelector('[data-workspace-tag='+${q(q(id))}+']')?.getAttribute('aria-pressed')==='true'&&document.querySelector('.tag-workspace-detail')?.textContent.includes('尚未关联普通笔记')`),'Tag selection/page not ready')}
  const feedback=async(name,text,role='alert')=>{
    const selector=role==='recovery'?'.tag-workspace-feedback .tag-workspace-recovery':'.tag-workspace-feedback [role='+role+']'
    const v=await until(()=>evaluate(`(()=>{const n=[...document.querySelectorAll(${q(selector)})].find(n=>n.textContent.includes(${q(text)}));if(!n)return null;const b=n.getBoundingClientRect(),a=n.closest('.tag-workspace-feedback').getBoundingClientRect(),f=document.querySelector('.tag-workspace footer').getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return b.width>0&&b.height>0&&b.top>=Math.max(0,a.top)&&b.bottom<=Math.min(innerHeight,a.bottom,f.top)&&b.left>=0&&b.right<=innerWidth&&n.contains(hit)?{text:${q(text)},role:${q(role)},top:b.top,bottom:b.bottom,left:b.left,right:b.right,areaTop:a.top,areaBottom:a.bottom,footerTop:f.top,width:innerWidth,height:innerHeight,hit:true,outsideScroll:!n.closest('.tag-workspace-scroll')}:null})()`),'Tag feedback is outside visible action area: '+text)
    report.feedback[name]=v;save()
  }
  const confirm=()=>action('确认','.tag-workspace-confirm button')
  const cancel=()=>action('取消','.tag-workspace-confirm button')
  const success=async()=>{await waitText('本机数据库已确认标签修改');assert.equal(await journal(),null);await feedback('success','本机数据库已确认标签修改','status')}
  const create=async name=>{await field('工作台标签名称',name);await action('创建标签');await confirm();await success();const value=(await snapshot()).tags.find(t=>t.name===name);assert.ok(value);return value}
  const revision=async()=> (await snapshot()).revision
  const namesuffix=randomUUID().slice(0,8), name=stem=>`TAG106 ${stem} ${namesuffix}`
  phase('launch-and-fixtures');await start()
  const posts=[],reads=[];let interceptFailure=null,responseFault=null
  const observeNetwork=()=>ctx.cdp().onEvent(event=>{if(event.method==='Network.requestWillBeSent'){const r=event.params.request,p=new URL(r.url).pathname;if(r.method==='POST'&&p==='/api/tag-workspace/changes')posts.push(r.postData||'');if(r.method==='GET'&&p.startsWith('/api/files/'))reads.push(p)}})
  observeNetwork()
  await evaluate("window.__tag106Input={mouse:false,keyboard:false};document.addEventListener('pointerdown',e=>{if(e.isTrusted)window.__tag106Input.mouse=true},{capture:true});document.addEventListener('input',e=>{if(e.isTrusted)window.__tag106Input.keyboard=true},{capture:true});true")
  const source=await api('/api/tags',{method:'POST',body:q({name:name('源'),color:'#176b4a'})}),target=await api('/api/tags',{method:'POST',body:q({name:name('目标'),color:'#365f91'})})
  const notes=[],originalBodies={}
  for(let i=0;i<53;i++){
    const note=await api('/api/files',{method:'POST',body:q({title:name('笔记'+String(i).padStart(2,'0'))+'.md',content:blockReferenceFixture('TAG106 unchanged body '+i+' '+namesuffix)})});notes.push(note);originalBodies[note.id]=(await api('/api/files/'+encodeURIComponent(note.id))).content
    if(i<51||i===52)await api('/api/files/'+note.id+'/tags',{method:'POST',body:q({file_id:note.id,tag_id:source.id})})
    if(i<2||i===51)await api('/api/files/'+note.id+'/tags',{method:'POST',body:q({file_id:note.id,tag_id:target.id})})
  }
  await api('/api/files/'+notes[52].id,{method:'DELETE'})
  const first=notes[0],selector='[data-file-id='+q(first.id)+']'
  await refreshLocalExportLibrary({evaluate,click,until},selector,'Tag fixture note missing');await click(selector)
  await until(()=>evaluate(`document.querySelector('.workspace-title-button')?.textContent===${q(first.title)}`),'Original note did not open')
  const index=ctx.requestCount(),mode=await evaluate("document.documentElement.getAttribute('data-theme')")
  await open();assert.equal(await evaluate("document.documentElement.getAttribute('data-theme')"),mode);assert.equal(await journal(),null);mark('settings-entry-preserves-note-and-theme')
  phase('catalog-pagination');await select(source.id)
  const initial=(await snapshot()).tags.find(t=>t.id===source.id);assert.deepEqual([initial.active_count,initial.hidden_count,initial.total_count],[51,1,52])
  await until(()=>evaluate("document.querySelectorAll('.tag-workspace-notes button').length===50"),'First page not complete')
  const firstPage=await evaluate("[...document.querySelectorAll('.tag-workspace-notes button')].map(n=>n.textContent)")
  await action('下一页');await until(()=>evaluate("document.querySelectorAll('.tag-workspace-notes button').length===1"),'Second page not complete')
  const secondPage=await evaluate("[...document.querySelectorAll('.tag-workspace-notes button')].map(n=>n.textContent)")
  assert.equal(new Set([...firstPage,...secondPage]).size,51);assert.equal([...firstPage,...secondPage].includes(notes[52].title),false)
  report.pagination={normal:51,hidden:1,total:52,pages:[firstPage.length,secondPage.length],unique:51,hiddenExcluded:true};await capture('tag106-catalog.png');mark('complete-counts-and-revision-pagination')
  const navigationReads=reads.length,navigationId=notes.find(n=>n.title===secondPage[0]).id;await action(secondPage[0],'.tag-workspace-notes button');await until(()=>evaluate("!document.querySelector('.tag-workspace')"),'Guarded open not accepted');await until(()=>evaluate(`document.querySelector('.workspace-title-button')?.textContent===${q(secondPage[0])}`),'Original navigation did not select note');report.guardedOpen={freshRead:reads.slice(navigationReads).includes('/api/files/'+navigationId),title:secondPage[0],accepted:true};assert.equal(report.guardedOpen.freshRead,true);mark('original-guarded-note-navigation')
  await open();await field('工作台标签名称',name('取消'));await action('创建标签');const beforeCancel=await revision(),beforePosts=posts.length;await cancel();assert.equal(await revision(),beforeCancel);assert.equal(posts.length,beforePosts);assert.equal(await journal(),null);mark('create-confirmation-cancel')
  await field('工作台标签颜色','#zzzzzz');await action('创建标签');await waitText('颜色');await feedback('invalid','颜色');assert.equal(posts.length,beforePosts);assert.equal(await revision(),beforeCancel);await field('工作台标签颜色','#7e5bef');mark('invalid-input-refused')
  const unused=await create(name('未使用'));report.created={id:unused.id,name:unused.name,color:unused.color,total:unused.total_count};assert.equal(unused.total_count,0);mark('create-and-acknowledgment')
  await field('工作台查找标签',unused.name);assert.equal(await evaluate("document.querySelectorAll('[data-workspace-tag]').length"),1);await click('.tag-workspace-filter input[type="checkbox"]');assert.equal(await evaluate("document.querySelectorAll('[data-workspace-tag]').length"),1);await field('工作台查找标签','');assert.equal(await evaluate(`Boolean(document.querySelector('[data-workspace-tag='+${q(q(source.id))}+']'))`),false);await click('.tag-workspace-filter input[type="checkbox"]');mark('search-and-unused-filter')
  await select(source.id);await action('编辑名称与颜色');await field('工作台标签名称',name('已重命名'));await field('工作台标签颜色','#315b8c');await action('保存标签修改');await confirm();await success()
  const renamed=(await snapshot()).tags.find(t=>t.id===source.id);assert.equal(renamed.name,name('已重命名'));assert.equal(renamed.color,'#315b8c');assert.deepEqual([renamed.active_count,renamed.hidden_count,renamed.total_count],[51,1,52]);report.renamed={id:source.id,name:renamed.name,color:renamed.color,countsPreserved:true};mark('rename-and-recolor-preserve-identity')
  phase('merge-delete');await select(source.id)
  const option=await evaluate(`[...document.querySelector('select[aria-label="合并目标标签"]').options].findIndex(n=>n.value===${q(target.id)})`);assert.ok(option>0)
  await click('select[aria-label="合并目标标签"]');await key('Home',36);for(let i=0;i<option;i++)await key('ArrowDown',40);await key('Enter',13)
  assert.equal(await evaluate("document.querySelector('select[aria-label=\"合并目标标签\"]').value"),target.id)
  const beforeMerge=await revision();await action('合并标签');await feedback('mergeConfirm','不删除任何笔记','alertdialog');await capture('tag106-merge.png');await cancel();assert.equal(await revision(),beforeMerge)
  await action('合并标签');await confirm();await success();const merged=await snapshot();assert.equal(merged.tags.some(t=>t.id===source.id),false);const t=merged.tags.find(t=>t.id===target.id)
  assert.deepEqual([t.active_count,t.hidden_count,t.total_count],[52,1,53]);assert.equal(t.name,target.name);assert.equal(t.color,target.color);report.merge={sourceId:source.id,targetId:target.id,normal:52,hidden:1,total:53,sourceRemoved:true,targetIdentityPreserved:true,cancelUnchanged:true};mark('transactional-merge-deduplicates-all-links')
  await select(target.id);const beforeDelete=await revision();await action('删除标签');await feedback('deleteConfirm','笔记本身和正文保留','alertdialog');await cancel();assert.equal(await revision(),beforeDelete)
  await action('删除标签');await confirm();await success();assert.equal((await snapshot()).tags.some(t=>t.id===target.id),false);report.delete={id:target.id,allLinksRemoved:true,cancelUnchanged:true};mark('delete-confirmation-preserves-notes')
  phase('quota-and-retry');await field('工作台标签名称',name('配额重试'))
  const quota=await evaluate(`(()=>{const keys=[];let error='';for(const size of [262144,4096,64,1])for(let i=0;i<400;i++){const k='tag106:quota:'+keys.length;try{localStorage.setItem(k,'q'.repeat(size));keys.push(k)}catch(e){if(e.name!=='QuotaExceededError')throw e;error=e.name;break}}window.__tag106Quota=keys;return{keys:keys.length,error}})()`);assert.equal(quota.error,'QuotaExceededError');assert.ok(quota.keys>0)
  const quotaPosts=posts.length,quotaBefore=await revision();await action('创建标签');await confirm();await waitText('尚未发送标签修改');await feedback('quota','尚未发送标签修改');await capture('tag106-quota.png');assert.equal(posts.length,quotaPosts);assert.equal(await revision(),quotaBefore)
  await evaluate("window.__tag106Quota.forEach(k=>localStorage.removeItem(k));delete window.__tag106Quota;true");await action('创建标签');await confirm();await success();report.quota={...quota,zeroRequestsWhileFull:posts.length===quotaPosts+1,unchangedBeforeRetry:true,retryAcknowledged:true};mark('real-storage-quota-refuses-send-and-retries')
  phase('stale-confirmation');await select(unused.id);await action('编辑名称与颜色');await field('工作台标签名称',name('过时修改'));await action('保存标签修改')
  await api('/api/tags',{method:'POST',body:q({name:name('并发变化'),color:'#176b4a'})});const conflictPosts=posts.length;await confirm();await waitText('标签修改结果未确认');await feedback('conflict','标签修改结果未确认');await capture('tag106-conflict.png')
  assert.equal((await snapshot()).tags.find(t=>t.id===unused.id).name,unused.name);assert.equal(posts.length,conflictPosts+1);const conflictRecord=await journal();assert.ok(conflictRecord);await close();await open();assert.equal(await journal(),conflictRecord);assert.equal(posts.length,conflictPosts+1)
  await action('核对当前标签库');await waitText('当前标签状态与原目标不同');assert.equal(posts.length,conflictPosts+1);await action('结束待核对记录');await cancel();assert.equal(await journal(),conflictRecord);await action('结束待核对记录');await confirm();assert.equal(await journal(),null)
  report.conflict={backendRefusedStaleSnapshot:true,originalMetadataPreserved:true,recordSurvivedClose:true,reconciliationReadOnly:true,cancelKeptRecord:true};mark('stale-confirmation-close-and-read-only-reconciliation')
  phase('committed-response-loss');const connection=ctx.cdp(),lostName=name('回执丢失')
  connection.onEvent(event=>{if(event.method==='Fetch.requestPaused'){responseFault={status:event.params.responseStatusCode,stage:'response',injectedTransportFailure:true};connection.send('Fetch.failRequest',{requestId:event.params.requestId,errorReason:'Aborted'}).catch(error=>{interceptFailure=error})}})
  await connection.send('Fetch.enable',{patterns:[{urlPattern:'*/api/tag-workspace/changes',requestStage:'Response'}]})
  const lossPosts=posts.length;await field('工作台标签名称',lostName);await action('创建标签');await confirm();await waitText('标签修改结果未确认');await connection.send('Fetch.disable');assert.equal(interceptFailure,null);assert.equal(responseFault?.status,200)
  const committed=(await snapshot()).tags.find(t=>t.name===lostName);assert.ok(committed);const lossRecord=await journal();assert.ok(lossRecord);const pendingCatalog=await snapshot();await close();const firstInputs=await evaluate('window.__tag106Input');report.trustedMouseInput=firstInputs.mouse;report.trustedKeyboardInput=firstInputs.keyboard;await closeNormally();report.exits.push({...report.exit});await start();observeNetwork();assert.equal(await journal(),lossRecord);assert.deepEqual(await snapshot(),pendingCatalog);report.catalog={sha256:tagHash(JSON.stringify(pendingCatalog)),restartedEqual:true,reinstalledEqual:false};await open();await action('核对当前标签库');await waitText('这不是原请求的历史回执');await feedback('reconciliation','这不是原请求的历史回执','status');await capture('tag106-reconciled.png');assert.equal(posts.length,lossPosts+1);assert.equal(await journal(),lossRecord);await action('结束待核对记录');await confirm();assert.equal(await journal(),null)
  report.lostResponse={...responseFault,backendCommitObserved:true,recordSurvivedClose:true,recordSurvivedRestart:true,mutationPosts:posts.length-lossPosts,reconciliationReadOnly:true,noHistoricReceiptClaim:true,explicitRecordEnd:true};mark('committed-response-loss-is-not-replayed')
  phase('corrupt-record');await close();await evaluate(`localStorage.setItem(${q(KEY)},'{');true`);await open();await waitText('操作记录损坏');await feedback('corrupt','操作记录损坏','recovery');assert.equal(await journal(),'{');await action('清除损坏记录');await cancel();assert.equal(await journal(),'{');await action('清除损坏记录');await confirm();assert.equal(await journal(),null)
  report.corruption={explicitFixtureInjection:true,automaticOverwrite:false,cancelPreserved:true,explicitClear:true};mark('corrupt-record-requires-explicit-clear')
  await resizeSmall();await select(unused.id);await action('删除标签');await feedback('smallConfirm','笔记本身和正文保留','alertdialog')
  report.viewport=await evaluate("(()=>{const p=document.querySelector('.tag-workspace'),f=p.querySelector('footer').getBoundingClientRect();return{width:innerWidth,height:innerHeight,horizontalOverflow:p.scrollWidth>p.clientWidth+1,footerReachable:f.top>=0&&f.bottom<=innerHeight}})()");assert.equal(report.viewport.horizontalOverflow,false);assert.equal(report.viewport.footerReachable,true);await capture('tag106-small.png');await cancel();mark('minimum-window-feedback-and-confirmation')
  const retained=await snapshot();assert.equal(tagHash(JSON.stringify(retained)),report.catalog.sha256);assert.equal(report.catalog.restartedEqual,true);assert.equal(await journal(),null);await close();mark('normal-restart-restores-catalog')
  await closeNormally();report.exits.push({...report.exit});await reinstallWithRetainedDraft();phase('reinstall');await start();assert.deepEqual(await snapshot(),retained);assert.equal(await journal(),null);report.catalog.reinstalledEqual=true;await open();await select(unused.id);await capture('tag106-reinstalled.png');await close();mark('installation-retains-tags-and-journal-state')
  const normalBodies={};for(const note of notes.slice(0,52)){const current=await api('/api/files/'+note.id);assert.equal(current.content,originalBodies[note.id]);normalBodies[note.id]=tagHash(current.content)}
  const trash=await api('/api/files/trash'),hidden=trash.find(n=>n.id===notes[52].id);assert.ok(hidden);/* Trash list is metadata-only; actual body is checked from stopped read-only SQLite below. */assert.equal((await api('/api/files/'+hidden.id+'/tags')).some(t=>t.id===source.id||t.id===target.id),false)
  const bodyWrites=notes.reduce((count,n)=>count+ctx.bodyWritesSince(index,n.id),0);assert.equal(bodyWrites,0)
  await closeNormally();report.exits.push({...report.exit});save()
  const observed=await ctx.readRetainedTagBodies({files:notes.map(note=>({id:note.id,content:originalBodies[note.id],deleted:note.id===hidden.id?1:0})),removedTagIds:[source.id,target.id]})
  for(const [id,hash] of Object.entries(normalBodies))assert.equal(observed.evidence.hashes[id],hash)
  report.retainedBodyObservation=observed.evidence
  report.notes={normalVerified:52,trashVerified:1,bodyWrites,before:tagHash(JSON.stringify(originalBodies)),after:tagHash(JSON.stringify(observed.bodies)),hashes:observed.evidence.hashes};assert.equal(report.notes.before,report.notes.after);mark('all-note-bodies-and-trash-preserved');save()
}
