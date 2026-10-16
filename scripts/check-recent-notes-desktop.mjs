import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {desktopNote} from './desktop-save-fixture.mjs'
export async function verifyRecentNotesDesktop({evaluate,click,cdp,until,api,out,noteIDs}) {
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'recent-notes.json'),JSON.stringify(report,null,2)+'\n'),mark=n=>{report.checks.push(n);save()};save()
 const original=await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),key='local-notepad.recent-notes.v1',base='http://127.0.0.1:27121'
 const a=await api('/api/files',{method:'POST',body:JSON.stringify({title:'最近访问97甲.md',content:desktopNote('访问验收甲','recent97-body-a')})})
 const b=await api('/api/files',{method:'POST',body:JSON.stringify({title:'最近访问97乙.md',content:desktopNote('访问验收乙','recent97-body-b')})})
 const keys=async(k,code,modifiers=0)=>{for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:k,windowsVirtualKeyCode:code,modifiers})}
 const state=()=>evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`)
 const text=()=>evaluate("document.querySelector('.recent-workspace')?.innerText||''"),has=t=>until(async()=>(await text()).includes(t),'Recent result missing: '+t)
 const clean=()=>until(()=>evaluate("!document.querySelector('.workspace-save-chip,.save-state')"),'Original editor not clean')
 const action=async(label,scope='.recent-workspace')=>{
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
  assert.equal(await evaluate(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)});if(all.length!==1||all[0].disabled)return false;const n=all[0];n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!n.contains(hit))return false;n.setAttribute('data-recent-action','');return true})()`),true,'Recent action unreachable: '+label)
  try{await click('[data-recent-action]')}finally{await evaluate("document.querySelector('[data-recent-action]')?.removeAttribute('data-recent-action')")}
 }
 const confirm=async label=>{await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Recent confirmation missing');await action(label,'.consumer-confirm-modal')}
 const listOpen=async(f,body)=>{await evaluate("window.dispatchEvent(new Event('library:refresh'))");await until(()=>evaluate(`!!document.querySelector('[data-file-id="${f.id}"]')`),'Recent fixture not listed');await click(`[data-file-id="${f.id}"]`);await until(()=>evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(body)})`),'Recent body not loaded');await clean()}
 const panel=async()=>{await click('.workspace-sidebar-nav-item[aria-label="最近访问"]');await has('条访问记录')}
 const query=async value=>{await click('.recent-workspace input');await until(()=>evaluate("document.activeElement===document.querySelector('.recent-workspace input')"),'Recent search focus absent');await keys('a',65,2);await cdp.send('Input.insertText',{text:value});await until(()=>evaluate(`document.querySelector('.recent-workspace input')?.value===${JSON.stringify(value)}`),'Recent query missing')}
 try{
  await listOpen(a,'recent97-body-a');await until(async()=>(await state())?.entries?.some(e=>e.id===a.id),'Visit A not recorded')
  assert.ok(!(JSON.stringify(await state())).includes('recent97-body-a'));mark('confirmed-note-entry-records-metadata-only')
  await listOpen(b,'recent97-body-b');await listOpen(a,'recent97-body-a');assert.equal((await state()).entries[0].id,a.id);assert.equal((await state()).entries.filter(e=>e.id===a.id).length,1);mark('revisit-is-first-without-duplicating-history')
  await click('.editor-input[contenteditable="true"]');await keys('End',35,2);await cdp.send('Input.insertText',{text:' recent97-draft'});await until(()=>evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),'Recent draft absent')
  const beforeCancel=await state();await click('.workspace-sidebar-nav-item[aria-label="最近访问"]');await confirm('取消');assert.equal(await evaluate("!!document.querySelector('.recent-workspace')"),false);assert.deepEqual(await state(),beforeCancel);assert.equal((await api('/api/files/'+a.id)).content,a.content);mark('cancelled-history-entry-retains-current-unsaved-draft')
  await click('.editor-input[contenteditable="true"]');await keys('s',83,2);await until(async()=>(await api('/api/files/'+a.id)).content.includes('recent97-draft'),'Original save failed');await clean();mark('original-editor-save-still-persists-body')
  await cdp.send('Page.reload');await until(()=>evaluate("!!document.querySelector('.workspace-sidebar-nav-item[aria-label=\"最近访问\"]')"),'App reload not ready');await panel();assert.ok((await state()).entries.some(e=>e.id===a.id));assert.ok((await state()).entries.some(e=>e.id===b.id));report.realRendererReload=true;mark('actual-renderer-reload-retains-local-history')
  await query('最近访问97');await click(`[data-recent-note-id="${b.id}"]`);assert.equal(await evaluate("!!document.querySelector('.recent-workspace')"),true);mark('search-and-selection-do-not-open-or-write-notes')
  await cdp.send('Network.setBlockedURLs',{urls:[base+'/api/files/'+b.id]});await action('重新打开笔记');await has('本机服务读取失败');assert.ok((await state()).entries.some(e=>e.id===b.id));mark('failed-latest-target-read-keeps-record-for-retry')
  await cdp.send('Network.setBlockedURLs',{urls:[]});await api('/api/files/'+b.id,{method:'PUT',body:JSON.stringify({title:'最近访问97更名.md'})});await action('重新打开笔记');await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('recent97-body-b')"),'Recent renamed target not opened');await clean();await until(async()=>(await state()).entries[0].title==='最近访问97更名.md','Fresh visit title not recorded');mark('renamed-target-opens-latest-body-through-original-guard')
  await panel();await query('最近访问97');await click(`[data-recent-note-id="${b.id}"]`)
  const shot=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'),filename='recent-notes-installed.png';writeFileSync(path.join(out,filename),shot);report.screenshots.push({filename,bytes:shot.length,sha256:createHash('sha256').update(shot).digest('hex')});save()
  await action('暂停记录…');await confirm('确认');await has('已暂停记录');const paused=await state();await action('返回笔记');await listOpen(a,'recent97-draft');assert.deepEqual(await state(),paused);mark('paused-history-does-not-record-subsequent-note-entry')
  await panel();await action('开启记录…');await confirm('确认');assert.deepEqual((await state()).entries,paused.entries);await action('返回笔记');await until(async()=>(await state()).entries[0].id===a.id,'Resumed visit absent');mark('resume-records-future-entry-without-backfilling')
  await panel();await query('最近访问97');await click(`[data-recent-note-id="${b.id}"]`);const beforeRemove=await api('/api/files/'+b.id);await action('仅移除这条历史…');await confirm('取消');assert.ok((await state()).entries.some(e=>e.id===b.id));await action('仅移除这条历史…');await confirm('确认');await has('原笔记没有删除');assert.ok(!(await state()).entries.some(e=>e.id===b.id));assert.deepEqual(await api('/api/files/'+b.id),beforeRemove);mark('remove-confirmation-changes-history-not-the-note')
  await action('清空访问历史…');await confirm('取消');assert.ok((await state()).entries.length>0);const bodies=await Promise.all([a.id,b.id].map(id=>api('/api/files/'+id)));await action('清空访问历史…');await confirm('确认');await has('访问历史已清空');assert.equal((await state()).entries.length,0);assert.deepEqual(await Promise.all([a.id,b.id].map(id=>api('/api/files/'+id))),bodies);mark('clear-cancel-and-confirm-never-delete-note-content')
  await evaluate(`localStorage.setItem(${JSON.stringify(key)},'broken-recent-fixture')`);await action('重新读取历史');await has('损坏');assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key)})`),'broken-recent-fixture');await action('重置损坏的访问记录…');await confirm('取消');assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key)})`),'broken-recent-fixture');await action('重置损坏的访问记录…');await confirm('确认');await has('已重置损坏记录');assert.equal((await state()).enabled,false);mark('corrupt-history-is-preserved-until-explicit-reset-and-pause')
  await action('返回笔记');await panel();assert.equal((await state()).enabled,false);assert.equal((await state()).entries.length,0);await action('开启记录…');await confirm('确认');await action('返回笔记');mark('close-and-reopen-retain-confirmed-recording-setting')
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),original);mark('unrelated-note-body-metadata-and-pins-unchanged')
  report.complete=true;save()
 }catch(e){report.error=String(e.stack||e);save();throw e}
 finally{await cdp.send('Network.setBlockedURLs',{urls:[]})}
}
