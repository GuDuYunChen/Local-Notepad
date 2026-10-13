import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createEditorSaveAttempt, commitEditorSave } from '../src/services/editorSaveTransaction.mjs'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { desktopNote } from './desktop-save-fixture.mjs'

// Part of the ORIGINAL packaged Windows application run. Only owned fixture
// notes and browser request blocking are used; App/preload/Go/SQLite stay real.
export async function verifyVersionHistoryDesktop({ evaluate, click, cdp, until, api, out, noteIDs }) {
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'version-history.json'),JSON.stringify(report,null,2)+'\n')
 const mark=name=>{report.checks.push(name);save()};save()
 const original=await Promise.all(noteIDs.map(id=>api('/api/files/'+id)))
 const first=desktopNote('历史第一版','first-history-body'),second=desktopNote('历史第二版','second-history-body'),latest=desktopNote('当前正文','latest-history-body')
 const file=await api('/api/files',{method:'POST',body:JSON.stringify({title:'History closure.md',content:first})})
 const route='/api/files/'+file.id,versionsRoute=route+'/versions',base='http://127.0.0.1:27121'
 const write=(expected,content)=>commitEditorSave(api,createEditorSaveAttempt(file.id,expected,content))
 const button=async(label,scope='.version-history')=>{
  assert.equal(await evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)});if(a.length!==1||a[0].disabled)return false;a[0].setAttribute('data-history-click','');return true})()`),true,'Missing enabled action '+label)
  try{await click('[data-history-click]')}finally{await evaluate("document.querySelector('[data-history-click]')?.removeAttribute('data-history-click')")}
 }
 const text=()=>evaluate("document.querySelector('.version-history')?.innerText||''")
 const waitText=value=>until(async()=>(await text()).includes(value),'Missing history result: '+value,15000)
 const screenshot=async name=>{
  const bytes=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');writeFileSync(path.join(out,name),bytes)
  report.screenshots.push({filename:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
 }
 const open=async id=>{
  await evaluate("window.dispatchEvent(new Event('library:refresh'))")
  await until(()=>evaluate(`!!document.querySelector('[data-file-id="${id}"]')`),'History test note missing');await click(`[data-file-id="${id}"]`)
 }
 const restore=async()=>{await button('恢复此快照正文');await until(()=>evaluate("!!document.querySelector('.version-history [role=dialog]')"),'History confirmation missing');await button('确认恢复正文','.version-history [role=dialog]')}
 try{
  await write(first,second);await write(second,latest)
  const seeded=await api(versionsRoute);assert.equal(seeded.length,2);assert.equal(seeded[0].content,second)
  await open(file.id);await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('latest-history-body')"),'Latest body not loaded')
  if(!await evaluate("!!document.querySelector('.inspector-panel')"))await click('button[aria-label="笔记详情"]')
  await cdp.send('Network.setBlockedURLs',{urls:[base+versionsRoute]})
  await click('#inspector-tab-history');await waitText('读取历史失败');assert.ok(!(await text()).includes('暂无版本历史'));mark('read-error-not-empty')
  await cdp.send('Network.setBlockedURLs',{urls:[]});await button('重试读取历史');await waitText('历史快照 #'+seeded[0].id)
  assert.ok(!(await text()).includes('当前版本'));mark('real-history-read-and-correct-snapshot-label')
  await button('恢复此快照正文');await button('取消','.version-history [role=dialog]');assert.equal((await api(route)).content,latest);mark('cancel-confirmation-no-write')
  await restore();await waitText('历史正文已恢复并保存')
  assert.equal((await api(route)).content,second);assert.equal((await api(route)).title,file.title)
  const after=await api(versionsRoute);assert.ok(after.some(v=>v.content===latest),'Missing atomic before-snapshot')
  await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('second-history-body')"),'Restored body not rendered')
  mark('first-snapshot-restores-through-real-save-and-retains-before-body')
  await screenshot('version-history-restored.png')
  await click('.editor-input[contenteditable="true"]')
  for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:'End',windowsVirtualKeyCode:35,modifiers:2})
  await cdp.send('Input.insertText',{text:' current-unsaved-history-guard'})
  await waitText('有未保存修改');assert.equal(await evaluate("document.querySelector('.version-restore-action').disabled"),true);mark('dirty-editor-refuses-restore')
  await button('先保存当前笔记');await until(async()=>(await api(route)).content.includes('current-unsaved-history-guard'),'Explicit save failed')
  await until(()=>evaluate("document.querySelector('.version-restore-action')?.disabled===false"),'History remained blocked after save');mark('explicit-original-editor-save-unblocks-history')
  await click(`.version-select-action[data-version-id="${seeded[1].id}"]`)
  await cdp.send('Network.setBlockedURLs',{urls:[base+route]});await restore();await waitText('保存尚未确认')
  assert.ok((await api(route)).content.includes('current-unsaved-history-guard'))
  assert.equal(await evaluate("document.querySelector('.editor-input')?.innerText.includes('first-history-body')"),true)
  assert.equal(await evaluate("!!document.querySelector('.save-state.error')"),true);mark('failed-save-keeps-restored-draft-and-original-database')
  await cdp.send('Network.setBlockedURLs',{urls:[]});await click('.status-retry-btn')
  await until(async()=>(await api(route)).content===first,'Original saved-receipt retry failed')
  await until(()=>evaluate("!document.querySelector('.save-state')"),'Original retry remained pending');mark('original-save-retry-recovers-without-second-restore')
  const empty=await api('/api/files',{method:'POST',body:JSON.stringify({title:'History empty.md',content:desktopNote('无历史','history-empty-body')})})
  await open(empty.id);await waitText('暂无版本历史');assert.ok(!(await text()).includes('历史快照 #'+seeded[0].id));mark('note-switch-clears-old-selection-and-handles-null-list')
  await screenshot('version-history-empty.png')
  await open(file.id);await waitText('历史快照 #')
  assert.equal((await api(route)).content,first);mark('reopen-reads-restored-body-from-database')
  await click('button[aria-label="关闭详情"]')
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),original);mark('unrelated-fixture-notes-unchanged')
  report.complete=true;save()
 }catch(error){report.error=String(error.stack||error);save();throw error}
 finally{await cdp.send('Network.setBlockedURLs',{urls:[]})}
}
