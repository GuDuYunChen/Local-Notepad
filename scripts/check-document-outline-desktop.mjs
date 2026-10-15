import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {createEditor,$getRoot,$createParagraphNode,$createTextNode} from 'lexical'
import {HeadingNode,$createHeadingNode} from '@lexical/rich-text'
function documentBody(rows) {
 const editor=createEditor({namespace:'outline-native-fixture',nodes:[HeadingNode],onError:e=>{throw e}})
 editor.update(()=>{$getRoot().clear();for(const[tag,text]of rows)$getRoot().append((tag==='p'?$createParagraphNode():$createHeadingNode(tag)).append($createTextNode(text)))},{discrete:true})
 return JSON.stringify(editor.getEditorState().toJSON())
}
export async function verifyDocumentOutlineDesktop({evaluate,click,cdp,until,api,out,noteIDs}) {
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'document-outline.json'),JSON.stringify(report,null,2)+'\n'),mark=name=>{report.checks.push(name);save()};save()
 const before=await Promise.all(noteIDs.map(id=>api('/api/files/'+id)))
 const make=async(title,rows)=>api('/api/files',{method:'POST',body:JSON.stringify({title,content:documentBody(rows)})})
 const empty=await make('Outline empty.md',[['p','outline94-empty-body']])
 const single=await make('Outline single.md',[['h1','唯一标题94'],['p','outline94-single-body']])
 const rows=[['h1','大纲卷一94'],['p','outline94-original-body']]
 for(let i=0;i<15;i++)rows.push(['p','正文段落 '+i+' '+('内容 '.repeat(40))])
 rows.push(['h2','目标章节94'],['p','outline94-target-body'],['h2','重复章节94'],['p','duplicate-first'],['h2','重复章节94'],['p','duplicate-second'],['h1','大纲卷二94'],['p','outline94-end-body'])
 for(let i=0;i<15;i++)rows.push(['p','尾部 '+i+' '+('补充正文 '.repeat(40))])
 const multi=await make('Outline navigation.md',rows)
 const key=async(k,code,modifiers=0)=>{for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:k,windowsVirtualKeyCode:code,modifiers})}
 const text=()=>evaluate("document.querySelector('.local-outline .document-outline-panel')?.innerText||''")
 const has=needle=>until(async()=>(await text()).includes(needle),'Outline result missing: '+needle)
 const action=async(label,scope='.local-outline')=>{
  assert.equal(await evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)}||n.getAttribute('aria-label')===${JSON.stringify(label)});if(a.length!==1||a[0].disabled)return false;const n=a[0];n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!n.contains(hit))return false;n.setAttribute('data-outline-click','');return true})()`),true,'Outline action unreachable: '+label)
  try{await click('[data-outline-click]')}finally{await evaluate("document.querySelector('[data-outline-click]')?.removeAttribute('data-outline-click')")}
 }
 const query=async value=>{await click('.local-outline input[aria-label="查找章节"]');await key('a',65,2);if(value)await cdp.send('Input.insertText',{text:value});else await key('Backspace',8)}
 const openNote=async(file,body)=>{await evaluate("window.dispatchEvent(new Event('library:refresh'))");await until(()=>evaluate(`!!document.querySelector('[data-file-id="${file.id}"]')`),'Outline note not listed');await click(`[data-file-id="${file.id}"]`);await until(()=>evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(body)})`),'Outline body not loaded');await until(()=>evaluate("!document.querySelector('.workspace-save-chip, .save-state')"),'Outline note not clean')}
 try {
  await openNote(empty,'outline94-empty-body');await action('文档目录');await has('当前正文没有标题');mark('empty-document-keeps-entry-and-explains-no-headings')
  await action('关闭文档目录');await openNote(single,'outline94-single-body');await key('O',79,10);await has('唯一标题94');await action('唯一标题94','.document-outline-list');await has('已定位：唯一标题94');assert.equal((await api('/api/files/'+single.id)).content,single.content);mark('single-heading-shortcut-and-navigation-preserve-body')
  await key('f',70,2)
  await until(()=>evaluate("!!document.querySelector('.document-search') && !document.querySelector('.local-outline.open')"),'Search must own foreground without outline covering it')
  assert.equal(await evaluate("Number(getComputedStyle(document.querySelector('.local-outline')).zIndex)<Number(getComputedStyle(document.querySelector('.document-search')).zIndex)"),true)
  assert.equal((await api('/api/files/'+single.id)).content,single.content)
  await action('关闭文内查找','.document-search');await action('文档目录');await has('唯一标题94')
  mark('search-foreground-handoff-preserves-outline-and-body')
  await action('关闭文档目录');await openNote(multi,'outline94-original-body');await action('文档目录');await has('5 个标题')
  const origin=await evaluate("document.querySelector('.editor-container').scrollTop")
  await query('目标章节94');await has('显示 1 / 5');await action('目标章节94','.document-outline-list');await has('已定位：目标章节94')
  const actual=await evaluate("(()=>{const el=[...document.querySelectorAll('.editor-input h2')].find(n=>n.textContent==='目标章节94'),box=document.querySelector('.editor-container');return{heading:el.getBoundingClientRect().top,viewport:box.getBoundingClientRect().top,scroll:box.scrollTop}})()")
  assert.ok(actual.scroll>origin&&Math.abs(actual.heading-actual.viewport-24)<4);mark('literal-search-locates-the-exact-visible-section')
  await action('返回');await has('已返回跳转前的位置');assert.ok(Math.abs(await evaluate("document.querySelector('.editor-container').scrollTop")-origin)<2);mark('return-restores-original-scroll-position')
  await query('无匹配94');await has('没有匹配的章节');await query('');await has('显示 5 / 5');mark('no-match-and-clear-query-recover-full-outline')
  await action('折叠章节：大纲卷一94');await has('显示 2 / 5');assert.equal(await evaluate("getComputedStyle(document.querySelector('.editor-input h2')).display"),'none')
  await query('目标章节94');await action('目标章节94','.document-outline-list');await has('已定位：目标章节94');assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.editor-input h2')).display"),'none');mark('search-navigation-reveals-folded-content-without-text-mutation')
  await query('');await action('复制章节锚点：大纲卷一94');await has('章节锚点已复制')
  const clipboard=await cdp.send('Runtime.evaluate',{expression:'navigator.clipboard.readText()',awaitPromise:true,returnByValue:true})
  assert.equal(clipboard.result?.value,'#heading/'+encodeURIComponent('大纲卷一94'));mark('native-clipboard-contains-exact-current-heading-anchor')
  await query('重复章节94');await has('显示 2 / 5')
  const copyLabel='复制章节锚点：重复章节94';await evaluate(`document.querySelectorAll('.local-outline .document-outline-anchor')[0].setAttribute('data-duplicate-anchor','')`);try{await click('[data-duplicate-anchor]')}finally{await evaluate("document.querySelector('[data-duplicate-anchor]')?.removeAttribute('data-duplicate-anchor')")}
  await has('同名歧义');assert.equal((await api('/api/files/'+multi.id)).content,multi.content);mark('ambiguous-section-copy-is-refused-with-visible-explanation')
  await action('关闭文档目录');await click('.editor-input[contenteditable="true"]');await key('Home',36,2);await cdp.send('Input.insertText',{text:'outline94-draft '})
  await until(()=>evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),'Outline draft not marked dirty')
  await action('文档目录');await query('目标章节94');await action('目标章节94','.document-outline-list');await has('已定位：目标章节94')
  assert.equal((await api('/api/files/'+multi.id)).content,multi.content);assert.equal(await evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),true);mark('outline-navigation-does-not-save-or-replace-unsaved-draft')
  const bytes=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'),filename='document-outline-installed.png';writeFileSync(path.join(out,filename),bytes);report.screenshots.push({filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
  await action('关闭文档目录');await click('.editor-input[contenteditable="true"]');await key('s',83,2);await until(async()=>(await api('/api/files/'+multi.id)).content.includes('outline94-draft'),'Original save failed');await until(()=>evaluate("!document.querySelector('.workspace-save-chip, .save-state')"),'Original save not acknowledged');mark('original-save-persists-draft-after-outline-use')
  await openNote(single,'outline94-single-body');assert.equal(await evaluate("!!document.querySelector('.local-outline .document-outline-panel')"),false)
  await action('文档目录');await has('显示 1 / 1');assert.equal(await evaluate("document.querySelector('.local-outline input').value"),'');await action('关闭文档目录');await openNote(multi,'outline94-draft');mark('close-switch-reopen-has-no-stale-query-fold-or-document')
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before);mark('unrelated-notes-and-metadata-remain-unchanged')
  report.complete=true;save()
 }catch(e){report.error=String(e.stack||e);save();throw e}
}
