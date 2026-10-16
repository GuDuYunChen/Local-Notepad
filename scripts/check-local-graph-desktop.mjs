import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {desktopNote} from './desktop-save-fixture.mjs'

export async function verifyLocalGraphDesktop({evaluate,click,cdp,until,api,out,noteIDs}) {
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'local-graph.json'),JSON.stringify(report,null,2)+'\n'),mark=name=>{report.checks.push(name);save()};save()
 const before=await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),base='http://127.0.0.1:27121'
 const create=(title,token)=>api('/api/files',{method:'POST',body:JSON.stringify({title,content:desktopNote(title,token)})})
 const source=await create('图谱验收95来源.md','graph95-source-body'),target=await create('图谱验收95目标.md','graph95-target-body'),isolated=await create('图谱验收95独立.md','graph95-isolated-body')
 const key=async(k,code,modifiers=0)=>{for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:k,windowsVirtualKeyCode:code,modifiers})}
 const text=()=>evaluate("document.querySelector('.local-graph')?.innerText||''"),has=value=>until(async()=>(await text()).includes(value),'Graph result missing: '+value)
 const action=async(label,scope='.local-graph')=>{
  assert.equal(await evaluate(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)}||n.getAttribute('aria-label')===${JSON.stringify(label)});if(all.length!==1||all[0].disabled)return false;const n=all[0];n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!n.contains(hit))return false;n.setAttribute('data-graph-action','');return true})()`),true,'Graph action unreachable: '+label)
  try{await click('[data-graph-action]')}finally{await evaluate("document.querySelector('[data-graph-action]')?.removeAttribute('data-graph-action')")}
 }
 const query=async value=>{await click('.local-graph input');await key('a',65,2);if(value)await cdp.send('Input.insertText',{text:value});else await key('Backspace',8);await until(()=>evaluate(`document.querySelector('.local-graph input')?.value===${JSON.stringify(value)}`),'Graph query was not entered')}
 const openNote=async(file,token)=>{await evaluate("window.dispatchEvent(new Event('library:refresh'))");await until(()=>evaluate(`!!document.querySelector('[data-file-id="${file.id}"]')`),'Graph note absent in original list');await click(`[data-file-id="${file.id}"]`);await until(()=>evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(token)})`),'Graph fixture body not loaded')}
 const graph=async()=>{await click('.workspace-sidebar-nav-item[aria-label="知识图谱"]');await has('篇可用笔记')}
 try{
  await openNote(source,'graph95-source-body');await click('.editor-input[contenteditable="true"]');await key('End',35,2);await cdp.send('Input.insertText',{text:' [[图谱验收95目标'})
  await until(()=>evaluate("[...document.querySelectorAll('.wiki-link-menu-title')].some(n=>n.textContent==='图谱验收95目标.md')"),'Real Wiki menu did not find graph target')
  assert.equal(await evaluate("(()=>{const n=[...document.querySelectorAll('.wiki-link-menu-item')].find(n=>n.querySelector('.wiki-link-menu-title')?.textContent==='图谱验收95目标.md');if(!n)return false;n.setAttribute('data-graph-wiki','');return true})()"),true)
  try{await click('[data-graph-wiki]')}finally{await evaluate("document.querySelector('[data-graph-wiki]')?.removeAttribute('data-graph-wiki')")}
  await until(()=>evaluate("!document.querySelector('.wiki-link-menu')"),'Wiki menu remained open');await key('s',83,2)
  await until(()=>evaluate("!document.querySelector('.workspace-save-chip, .save-state')"),'Original Wiki save not acknowledged')
  await until(async()=>(await api('/api/local-graph')).edges.some(e=>e.source===source.id&&e.target===target.id),'Real saved reference absent from graph index');mark('real-wiki-insertion-and-original-save-create-directed-index')
  await click('.editor-input[contenteditable="true"]');await key('End',35,2);await cdp.send('Input.insertText',{text:' graph95-draft-guard'})
  await until(()=>evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),'Expected dirty source')
  await click('.workspace-sidebar-nav-item[aria-label="知识图谱"]');await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Original workspace draft decision missing')
  await action('取消','.consumer-confirm-modal');assert.equal(await evaluate("!!document.querySelector('.local-graph')"),false);assert.ok(await evaluate("document.querySelector('.editor-input').innerText.includes('graph95-draft-guard')"));mark('cancelled-graph-entry-preserves-current-draft')
  await click('.editor-input[contenteditable="true"]');await key('s',83,2);await until(async()=>(await api('/api/files/'+source.id)).content.includes('graph95-draft-guard'),'Original save failed');await until(()=>evaluate("!document.querySelector('.workspace-save-chip, .save-state')"),'Original save still pending')
  await cdp.send('Network.setBlockedURLs',{urls:[base+'/api/local-graph']});await click('.workspace-sidebar-nav-item[aria-label="知识图谱"]');await has('本机服务读取失败');assert.ok(!(await text()).includes('还没有可用笔记'));mark('failed-graph-read-is-not-empty-success')
  await cdp.send('Network.setBlockedURLs',{urls:[]});await action('重新读取图谱');await has('篇可用笔记');await query('图谱验收95');await has('3 个匹配结果')
  await until(()=>evaluate("document.querySelectorAll('.local-graph-node').length===3"),'Real graph canvas missing nodes');mark('explicit-retry-renders-linked-and-isolated-notes')
  await query('不存在的图谱95');await has('0 个匹配结果');await query('图谱验收95');await has('3 个匹配结果');mark('literal-search-empty-and-recovery-do-not-create-notes')
  await click(`[data-graph-note-id="${source.id}"]`);await has('引用了：图谱验收95目标.md');assert.equal(await evaluate("!!document.querySelector('.local-graph')"),true);mark('node-selection-shows-directed-relations-without-opening')
  const initial=await evaluate("document.querySelector('.local-graph-canvas svg>g').getAttribute('transform')");await action('放大图谱');assert.notEqual(await evaluate("document.querySelector('.local-graph-canvas svg>g').getAttribute('transform')"),initial);await action('重置视图');assert.equal(await evaluate("document.querySelector('.local-graph-canvas svg>g').getAttribute('transform')"),initial);mark('real-svg-zoom-and-fit-controls-work')
  await action('查看一跳关联');await has('2 个匹配结果');assert.equal(await evaluate(`!!document.querySelector('[data-graph-note-id="${isolated.id}"]')`),false);await action('清除筛选');await query('图谱验收95');await has('3 个匹配结果');mark('one-hop-focus-and-clear-return-complete-view')
  await click(`[data-graph-note-id="${target.id}"]`)
  await api('/api/files/'+target.id,{method:'PUT',body:JSON.stringify({title:'图谱验收95更名目标.md'})})
  await action('打开选中笔记');await has('已经更名');assert.equal(await evaluate("!!document.querySelector('.local-graph')"),true);mark('stale-renamed-target-refused-before-navigation')
  await action('刷新图谱');await has('篇可用笔记');await query('图谱验收95');await has('3 个匹配结果');await click(`[data-graph-note-id="${target.id}"]`);await has('图谱验收95更名目标.md')
  const bytes=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'),filename='local-graph-installed.png';writeFileSync(path.join(out,filename),bytes);report.screenshots.push({filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
  await action('打开选中笔记');await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('graph95-target-body')"),'Fresh graph target not opened');assert.equal(await evaluate("!!document.querySelector('.local-graph')"),false);mark('refresh-and-original-guard-open-current-target')
  await graph();await query('图谱验收95独立');await has('1 个匹配结果');await click(`[data-graph-note-id="${isolated.id}"]`);await has('暂无可用的引用关联');await action('返回笔记');await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('graph95-target-body')"),'Return from graph changed current note');mark('close-reopen-and-isolated-note-workflow-complete')
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before);assert.equal((await api('/api/files/'+target.id)).content,target.content);assert.equal((await api('/api/files/'+isolated.id)).content,isolated.content);mark('unrelated-bodies-and-metadata-remain-unchanged')
  report.complete=true;save()
 }catch(error){report.error=String(error.stack||error);save();throw error}
 finally{await cdp.send('Network.setBlockedURLs',{urls:[]})}
}
