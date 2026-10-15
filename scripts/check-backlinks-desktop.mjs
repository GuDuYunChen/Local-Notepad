import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {desktopNote} from './desktop-save-fixture.mjs'
import {createEditorSaveAttempt,commitEditorSave} from '../src/services/editorSaveTransaction.mjs'
export async function verifyBacklinksDesktop({evaluate,click,cdp,until,api,out,noteIDs}){
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'backlinks.json'),JSON.stringify(report,null,2)+'\n'),mark=x=>{report.checks.push(x);save()};save()
 const before=await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),base='http://127.0.0.1:27121'
 const target=await api('/api/files',{method:'POST',body:JSON.stringify({title:'Backlink 本地目标.md',content:desktopNote('引用目标','backlink-target-body')})})
 const source=await api('/api/files',{method:'POST',body:JSON.stringify({title:'Backlink 本地来源.md',content:desktopNote('来源章节','backlink-source-body')})})
 const route='/api/files/'+target.id+'/backlink-sources'
 const key=async(k,code,modifiers=0)=>{for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:k,windowsVirtualKeyCode:code,modifiers})}
 const text=()=>evaluate("document.querySelector('.local-backlinks')?.innerText||''")
 const has=label=>until(async()=>(await text()).includes(label),'Backlink result missing: '+label,15000)
 const action=async(label,scope='.local-backlinks')=>{
  assert.equal(await evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)});if(nodes.length!==1||nodes[0].disabled)return false;const n=nodes[0];n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!n.contains(hit))return false;n.setAttribute('data-backlink-click','');return true})()`),true,'Backlink action unreachable: '+label)
  try{await click('[data-backlink-click]')}finally{await evaluate("document.querySelector('[data-backlink-click]')?.removeAttribute('data-backlink-click')")}
 }
 const screenshot=async filename=>{const image=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');writeFileSync(path.join(out,filename),image);report.screenshots.push({filename,bytes:image.length,sha256:createHash('sha256').update(image).digest('hex')});save()}
 const openNote=async(id,body)=>{
  await evaluate("window.dispatchEvent(new Event('library:refresh'))")
  await until(()=>evaluate(`!!document.querySelector('[data-file-id="${id}"]')`),'Backlink note not in original list');await click(`[data-file-id="${id}"]`)
  await until(()=>evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(body)})`),'Backlink note did not open')
 }
 const panel=async()=>{if(!await evaluate("!!document.querySelector('.inspector-panel')"))await click('button[aria-label="笔记详情"]');await click('#inspector-tab-backlinks')}
 try{
  await openNote(target.id,'backlink-target-body');await panel();await has('暂无已索引的反向链接');mark('genuine-empty-index-is-distinct')
  await click('button[aria-label="关闭详情"]');await openNote(source.id,'backlink-source-body')
  await click('.editor-input[contenteditable="true"]');await key('End',35,2);await cdp.send('Input.insertText',{text:' [[Backlink 本地目标'})
  await until(()=>evaluate("[...document.querySelectorAll('.wiki-link-menu-item')].some(n=>n.innerText.includes('Backlink 本地目标.md'))"),'Real Wiki selector did not find target')
  assert.equal(await evaluate("(()=>{const n=[...document.querySelectorAll('.wiki-link-menu-item')].find(n=>n.querySelector('.wiki-link-menu-title')?.textContent==='Backlink 本地目标.md');if(!n)return false;n.setAttribute('data-backlink-wiki','');return true})()"),true)
  try{await click('[data-backlink-wiki]')}finally{await evaluate("document.querySelector('[data-backlink-wiki]')?.removeAttribute('data-backlink-wiki')")}
  await until(()=>evaluate("!document.querySelector('.wiki-link-menu')"),'Wiki insertion not completed');await key('s',83,2)
  await until(async()=>JSON.parse((await api('/api/files/'+source.id)).content).root.children.some(n=>JSON.stringify(n).includes(target.id)),'Original editor did not save real Wiki link')
  await until(()=>evaluate("!document.querySelector('.workspace-save-chip, .save-state')"),'Source save not confirmed')
  await until(async()=>(await api(route)).sources.some(r=>r.source_id===source.id),'Saved link not indexed');mark('real-editor-wiki-insertion-and-save-build-index')
  await openNote(target.id,'backlink-target-body');await cdp.send('Network.setBlockedURLs',{urls:[base+route]});await panel();await has('本机服务请求失败');assert.ok(!(await text()).includes('暂无已索引'));mark('failed-index-read-never-pretends-empty')
  await cdp.send('Network.setBlockedURLs',{urls:[]});await action('重新读取来源');await has('已索引 1 个来源');await has('1 处引用');mark('explicit-retry-loads-real-source-and-section')
  await click('.local-backlinks input');await cdp.send('Input.insertText',{text:'没有这种来源'});await has('没有匹配的来源');await key('a',65,2);await cdp.send('Input.insertText',{text:'来源章节'})
  await until(()=>evaluate("document.querySelectorAll('.backlink-source-select').length===1"),'Section search failed');await click(`.backlink-source-select[data-backlink-source="${source.id}"]`);await has('定位引用章节');mark('literal-source-and-section-search-retains-preview')
  const prior=await api('/api/files/'+source.id),fresh=prior.content.replace('backlink-source-body','backlink-source-updated')
  assert.notEqual(fresh,prior.content);await commitEditorSave(api,createEditorSaveAttempt(source.id,prior.content,fresh))
  await action('打开来源笔记');await has('来源正文已变化');assert.ok(await evaluate("document.querySelector('.editor-input').innerText.includes('backlink-target-body')"));mark('changed-source-refused-before-switching')
  await action('刷新来源');await has('backlink-source-updated');mark('refresh-adopts-latest-saved-source');await screenshot('backlinks-preview.png')
  await click('.editor-input[contenteditable="true"]');await key('End',35,2);await cdp.send('Input.insertText',{text:' backlink-draft-guard'})
  await until(()=>evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),'Real unsaved indicator missing')
  await action('定位引用章节');await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Original save/discard guard missing')
  await action('取消','.consumer-confirm-modal');await has('当前草稿已保留');assert.ok(await evaluate("document.querySelector('.editor-input').innerText.includes('backlink-draft-guard')"));assert.equal((await api('/api/files/'+target.id)).content,target.content);mark('cancelled-open-preserves-current-draft-and-preview')
  await evaluate("window.__backlinkAnchorEvents=[];window.__backlinkAnchorListener=e=>window.__backlinkAnchorEvents.push(e.detail?.path);window.addEventListener('editor:open-heading-anchor',window.__backlinkAnchorListener)")
  await action('定位引用章节');await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Second save guard missing');await action('保存','.consumer-confirm-modal')
  await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('backlink-source-updated')"),'Verified source not opened')
  assert.ok((await api('/api/files/'+target.id)).content.includes('backlink-draft-guard'));assert.equal((await api('/api/files/'+source.id)).content,fresh)
  await until(()=>evaluate("window.__backlinkAnchorEvents.some(p=>JSON.stringify(p)===JSON.stringify(['来源章节']))"),'Original heading anchor was not requested');mark('original-save-then-source-open-and-heading-navigation')
  await openNote(target.id,'backlink-target-body');await until(()=>evaluate("!!document.querySelector('.local-backlinks .backlink-source-select')"),'Backlinks did not reload for target')
  await click(`.backlink-source-select[data-backlink-source="${source.id}"]`)
  await api('/api/files/'+source.id,{method:'DELETE'});await action('打开来源笔记');await has('目标或来源不存在或暂时无法读取');assert.ok(await evaluate("document.querySelector('.editor-input').innerText.includes('backlink-target-body')"));mark('trashed-source-cannot-be-opened-from-old-preview')
  await action('刷新来源');await until(async()=>{const s=await api(route);return s.sources.every(r=>!r.available)},'Unavailable source exposed as active')
  await until(()=>evaluate("!document.querySelector('.local-backlinks .backlink-detail button')"),'Unavailable source action retained');mark('unavailable-index-record-does-not-expose-body')
  await click('button[aria-label="关闭详情"]');await panel();await until(()=>evaluate("!!document.querySelector('.local-backlinks .backlink-summary') && !document.querySelector('.local-backlinks .backlink-detail button')"),'Backlinks close/reopen failed');mark('close-reopen-keeps-current-source-state')
  await screenshot('backlinks-installed.png')
  await click('button[aria-label="关闭详情"]');assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before);mark('unrelated-note-bodies-and-metadata-unchanged')
  report.complete=true;save()
 }catch(error){report.error=String(error.stack||error);save();throw error}
 finally{await cdp.send('Network.setBlockedURLs',{urls:[]});await evaluate("if(window.__backlinkAnchorListener)window.removeEventListener('editor:open-heading-anchor',window.__backlinkAnchorListener);delete window.__backlinkAnchorListener;delete window.__backlinkAnchorEvents")}
}
