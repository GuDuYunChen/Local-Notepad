import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {desktopNote} from './desktop-save-fixture.mjs'
export async function verifyDocumentSearchDesktop({evaluate,click,cdp,until,api,out,noteIDs}){
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'document-search.json'),JSON.stringify(report,null,2)+'\n'),mark=x=>{report.checks.push(x);save()};save()
 const before=await Promise.all(noteIDs.map(id=>api('/api/files/'+id)))
 const file=await api('/api/files',{method:'POST',body:JSON.stringify({title:'Document search closure.md',content:desktopNote('文内查找验收','İx find93alpha find93alpha tail')})})
 const route='/api/files/'+file.id
 const key=async(k,code,modifiers=0)=>{for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:k,windowsVirtualKeyCode:code,modifiers})}
 const panelText=()=>evaluate("document.querySelector('.document-search')?.innerText||''")
 const has=label=>until(async()=>(await panelText()).includes(label),'Document search result missing: '+label)
 const fill=async(label,value)=>{
  const selector='.document-search input[aria-label="'+label+'"]'
  await click(selector)
  assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`),true,'Search field did not receive focus: '+label)
  await key('a',65,2);await cdp.send('Input.insertText',{text:value})
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`),'Search field value not committed: '+label)
 }
 const shortcutReady=async()=>{
  // React mounts the input before SearchPlugin's scheduled autofocus. Let that
  // renderer work finish before choosing another input; no second click or delay.
  const focused=await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(document.activeElement===document.querySelector('.document-search input[aria-label=\"查找内容\"]')))))")
  assert.equal(focused,true,'Search shortcut autofocus did not settle on its query field')
 }
 const action=async(label,scope='.document-search')=>{
  assert.equal(await evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)}||n.getAttribute('aria-label')===${JSON.stringify(label)});if(nodes.length!==1||nodes[0].disabled)return false;const n=nodes[0];n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!n.contains(hit))return false;n.setAttribute('data-search-click','');return true})()`),true,'Search action not reachable: '+label)
  try{await click('[data-search-click]')}finally{await evaluate("document.querySelector('[data-search-click]')?.removeAttribute('data-search-click')")}
 }
 const openNote=async(id,body)=>{await evaluate("window.dispatchEvent(new Event('library:refresh'))");await until(()=>evaluate(`!!document.querySelector('[data-file-id="${id}"]')`),'Search fixture absent');await click(`[data-file-id="${id}"]`);await until(()=>evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(body)})`),'Search note body absent')}
 const persist=async expected=>{await click('.editor-input[contenteditable="true"]');await key('s',83,2);await until(async()=>(await api(route)).content.includes(expected),'Original save did not persist replacement');await until(()=>evaluate("!document.querySelector('.workspace-save-chip, .save-state')"),'Save not acknowledged')}
 try{
  await openNote(file.id,'find93alpha');await until(()=>evaluate("!document.querySelector('.workspace-save-chip, .save-state')"),'Seeded document not clean')
  await key('f',70,2);await until(()=>evaluate("!!document.querySelector('.document-search input')"),'Ctrl+F did not open');await shortcutReady();await fill('查找内容','find93alpha');await has('1/2')
  assert.equal((await api(route)).content,file.content);assert.equal(await evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),false);mark('ctrl-f-current-document-search-does-not-dirty-body')
  await action('下一个匹配');await has('2/2');await action('上一个匹配');await has('1/2');mark('previous-next-real-controls-navigate-exact-matches')
  await fill('查找内容','FIND93ALPHA');await has('1/2');await action('区分大小写');await has('未找到匹配');await action('区分大小写');await has('1/2');mark('case-sensitive-option-and-genuine-no-match')
  await fill('查找内容','find93');await has('1/2');await action('整词');await has('未找到匹配');await action('整词');await fill('查找内容','find93alpha');await has('1/2');mark('whole-word-option-does-not-consume-partial-identifiers')
  await key('h',72,2);await until(()=>evaluate("!!document.querySelector('.document-search input[aria-label=\"替换内容\"]')"),'Ctrl+H did not expose replacement');await shortcutReady();await fill('替换内容','find93beta');assert.equal(await evaluate("document.querySelector('.document-search input[aria-label=\"查找内容\"]').value"),'find93alpha')
  await action('全部替换…');await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Bulk confirmation missing');await action('取消','.consumer-confirm-modal');assert.equal((await api(route)).content,file.content);assert.ok(await evaluate("document.querySelector('.editor-input').innerText.includes('İx find93alpha find93alpha')"));mark('bulk-replacement-cancel-preserves-body')
  await action('全部替换…');await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Second confirmation missing');await action('确认全部替换','.consumer-confirm-modal');await has('当前草稿替换 2 处');assert.ok(await evaluate("document.querySelector('.editor-input').innerText.includes('İx find93beta find93beta')"));assert.equal((await api(route)).content,file.content);mark('confirmed-bulk-replacement-keeps-unicode-prefix-and-original-save-boundary')
  await action('关闭文内查找');await click('.editor-input[contenteditable="true"]');await key('z',90,2);await until(()=>evaluate("document.querySelector('.editor-input').innerText.includes('İx find93alpha find93alpha')"),'Original undo did not restore entire replacement');mark('single-original-undo-restores-bulk-edit')
  await key('z',90,10);await until(()=>evaluate("document.querySelector('.editor-input').innerText.includes('İx find93beta find93beta')"),'Original redo failed');await persist('find93beta');assert.ok(!(await api(route)).content.includes('find93alpha'));mark('original-redo-and-save-persist-replacement')
  await key('h',72,2);await until(()=>evaluate("!!document.querySelector('.document-search')"),'Find reopen failed');await shortcutReady();await fill('查找内容','find93beta');await fill('替换内容','find93delta');await has('1/2');await action('替换当前');await has('当前草稿替换 1 处');assert.ok(await evaluate("document.querySelector('.editor-input').innerText.includes('İx find93delta find93beta')"));mark('single-replacement-leaves-other-occurrence')
  const bytes=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'),filename='document-search-installed.png';writeFileSync(path.join(out,filename),bytes);report.screenshots.push({filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
  await action('关闭文内查找');await persist('find93delta')
  await openNote(noteIDs[0],JSON.parse(before[0].content).root.children[0].children?.[0]?.text||'')
  assert.equal(await evaluate("!!document.querySelector('.document-search')"),false)
  await openNote(file.id,'find93delta');assert.ok((await api(route)).content.includes('find93beta'));mark('close-switch-and-reopen-read-saved-document-without-stale-panel')
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before);mark('other-note-bodies-and-metadata-unchanged')
  report.complete=true;save()
 }catch(error){report.error=String(error.stack||error);save();throw error}
}
