import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {desktopNote} from './desktop-save-fixture.mjs'
import {createEditorSaveAttempt,commitEditorSave} from '../src/services/editorSaveTransaction.mjs'
export async function verifyQuickSwitcherDesktop({evaluate,click,cdp,until,api,out,noteIDs}) {
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'quick-switcher.json'),JSON.stringify(report,null,2)+'\n'),mark=x=>{report.checks.push(x);save()};save()
 const before=await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),base='http://127.0.0.1:27121'
 const a=await api('/api/files',{method:'POST',body:JSON.stringify({title:'Quick 原始笔记.md',content:desktopNote('Quick source','quick-source-body')})})
 const b=await api('/api/files',{method:'POST',body:JSON.stringify({title:'Quick 特定目标.md',content:desktopNote('Quick target','quick-old-body')})})
 const key=async(k,code,modifiers=0)=>{for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:k,windowsVirtualKeyCode:code,modifiers})}
 const text=()=>evaluate("document.querySelector('.quick-switcher')?.innerText||''")
 const has=label=>until(async()=>(await text()).includes(label),'Quick result missing: '+label,15000)
 const action=async(label,scope='.quick-switcher')=>{
  assert.equal(await evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(n=>n.textContent.trim()===${JSON.stringify(label)});if(!n||n.disabled)return false;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!h||!n.contains(h))return false;n.setAttribute('data-quick-click','');return true})()`),true,'Quick action unreachable: '+label)
  try{await click('[data-quick-click]')}finally{await evaluate("document.querySelector('[data-quick-click]')?.removeAttribute('data-quick-click')")}
 }
 const open=async()=>{await key('k',75,2);await until(()=>evaluate("!!document.querySelector('.quick-switcher input')"),'Ctrl+K did not open quick search')}
 const query=async value=>{await click('.quick-switcher input');await key('a',65,2);await cdp.send('Input.insertText',{text:value})}
 const find=async value=>{await query(value);await until(()=>evaluate(`!!document.querySelector('.quick-switcher [role=option]:enabled') && document.querySelector('.quick-switcher-results')?.innerText.includes(${JSON.stringify(value)})`),'Search result not found')}
 const screenshot=async()=>{const bytes=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');const filename='quick-switcher-installed.png';writeFileSync(path.join(out,filename),bytes);report.screenshots.push({filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()}
 try {
  await evaluate("window.dispatchEvent(new Event('library:refresh'))")
  await until(()=>evaluate(`!!document.querySelector('[data-file-id="${a.id}"]')`),'Fixture missing from original file list')
  await click(`[data-file-id="${a.id}"]`);await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('quick-source-body')"),'Source note did not open')
  await cdp.send('Network.setBlockedURLs',{urls:[base+'/api/files?size=200']});await open();await has('快速搜索未完成');assert.ok(!(await text()).includes('还没有可打开'));mark('failed-read-is-not-empty')
  await cdp.send('Network.setBlockedURLs',{urls:[]});await action('重试快速搜索');await has('Quick 特定目标');mark('ctrl-k-entry-and-explicit-read-retry')
  await find('Quick 特定目标');await screenshot()
  const fresh=desktopNote('Quick target','quick-fresh-body');await commitEditorSave(api,createEditorSaveAttempt(b.id,b.content,fresh))
  await key('Enter',13);await until(()=>evaluate("!document.querySelector('.quick-switcher') && document.querySelector('.editor-input')?.innerText.includes('quick-fresh-body')"),'Fresh result did not open through App');mark('enter-opens-fresh-body-not-list-snapshot')
  await click('.editor-input[contenteditable="true"]');await key('End',35,2);await cdp.send('Input.insertText',{text:' quick-unsaved-guard'})
  await open();await find('Quick 原始笔记');await key('Enter',13)
  await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Original draft guard missing')
  await action('取消','.consumer-confirm-modal');await has('当前草稿保持不变')
  assert.equal(await evaluate("document.querySelector('.workspace-save-chip')?.innerText.includes('未保存')"),true)
  assert.equal((await api('/api/files/'+b.id)).content,fresh);mark('cancel-original-draft-dialog-preserves-query-and-draft')
  await key('Escape',27);await until(()=>evaluate("!document.querySelector('.quick-switcher')"),'Escape did not close palette')
  await click('.editor-input[contenteditable="true"]');await key('s',83,2)
  await until(async()=>(await api('/api/files/'+b.id)).content.includes('quick-unsaved-guard'),'Original editor save failed');await until(()=>evaluate("!document.querySelector('.save-state')"),'Save remains pending');mark('escape-and-original-editor-save-remain-functional')
  await open();await find('Quick 原始笔记');await cdp.send('Network.setBlockedURLs',{urls:[base+'/api/files/'+a.id]});await key('Enter',13);await has('笔记未打开')
  assert.equal(await evaluate("document.querySelector('.editor-input')?.innerText.includes('quick-unsaved-guard')"),true);mark('failed-live-target-does-not-leave-current-note')
  await cdp.send('Network.setBlockedURLs',{urls:[]});await action('刷新快速结果');await until(()=>evaluate("!!document.querySelector('.quick-switcher [role=option]:enabled')"),'Target retry unavailable');await click('.quick-switcher [role=option]:enabled')
  await until(()=>evaluate("!document.querySelector('.quick-switcher') && document.querySelector('.editor-input')?.innerText.includes('quick-source-body')"),'Retry did not open source');mark('target-failure-manual-refresh-and-open')
  await open();await query('QUICK-NO-MATCH-872a');await has('没有找到匹配的笔记');mark('genuine-empty-search-remains-distinct')
  await find('Quick 特定目标');await action('完整检索与筛选');await until(()=>evaluate("!!document.querySelector('[aria-label=\"全局检索结果\"]') && !document.querySelector('.quick-switcher')"),'Full search handoff failed')
  await click('button[aria-label="关闭全局检索"]');mark('full-search-handoff-and-close')
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before);assert.equal((await api('/api/files/'+a.id)).content,a.content);mark('unrelated-and-unedited-notes-unchanged')
  report.complete=true;save()
 }catch(error){report.error=String(error.stack||error);save();throw error}
 finally {await cdp.send('Network.setBlockedURLs',{urls:[]})}
}
