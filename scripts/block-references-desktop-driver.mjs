import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { refreshLocalExportLibrary } from './check-local-export-desktop.mjs'

export const BLOCK_REFERENCE_CHECKS = Object.freeze([
  'open-and-cancel-does-not-write', 'create-anchor-uses-original-save', 'copy-requires-saved-source',
  'preview-is-read-only', 'insert-reference-persists-target-and-anchor', 'dirty-navigation-cancel-keeps-draft',
  'explicit-save-and-source-navigation', 'embed-is-created-by-reviewed-insertion', 'saved-source-refresh-is-explicit',
  'renamed-source-uses-current-title', 'duplicate-block-identity-is-refused', 'deleted-source-clears-embed',
  'failed-read-has-explicit-retry', 'stopped-read-does-not-resurrect', 'reading-mode-keeps-embed-read-only',
  'reopen-retains-reference-identities', 'small-window-controls-remain-reachable', 'dark-theme-retains-readable-block-panel',
])
const q=JSON.stringify
export function blockReferenceFixture(text) {
  return JSON.stringify({root:{type:'root',version:1,format:'',indent:0,direction:null,children:[{type:'paragraph',version:1,format:'',indent:0,direction:null,children:[{type:'text',version:1,text,format:0,detail:0,mode:'normal',style:''}]}]}})
}
// At <=820px the existing sidebar is an overlay. A native resize does not
// select a note, so App's selection-triggered collapse has not run. Use the
// user's existing button once, only when hit-testing proves that overlay is
// covering the block entry. Never resize again or mutate application state.
export async function revealBlockReferenceEditor({evaluate,click,until}) {
  const observe=()=>evaluate(`(() => {
    const sidebar=document.querySelector('.workspace-sidebar')
    const entry=document.querySelector('.block-reference-entry button')
    const r=entry?.getBoundingClientRect()
    const hit=r&&r.width>0&&r.height>0?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null
    return {width:innerWidth,height:innerHeight,sidebarPresent:Boolean(sidebar),
      sidebarExpanded:Boolean(sidebar&&!sidebar.classList.contains('collapsed')),
      entryPresent:Boolean(entry),entryReachable:Boolean(hit&&entry.contains(hit)),
      blockedBySidebar:Boolean(hit&&sidebar?.contains(hit))}
  })()`)
  const before=await observe()
  assert.equal(before.sidebarPresent,true,'Block-reference sidebar is missing')
  assert.equal(before.entryPresent,true,'Block-reference entry is missing')
  let collapsedByClick=false
  if(before.width<=820&&before.sidebarExpanded&&before.blockedBySidebar){
    await click('.workspace-sidebar button[aria-label="折叠侧边栏"]')
    collapsedByClick=true
    await until(()=>evaluate("Boolean(document.querySelector('.workspace-sidebar.collapsed'))"),
      'Sidebar did not collapse after its native button was clicked')
  }
  const after=await until(async()=>{const value=await observe();return value.entryReachable&&value},
    'Block-reference entry is still occluded')
  assert.equal(after.width,before.width,'Entry recovery must not change window width')
  assert.equal(after.height,before.height,'Entry recovery must not change window height')
  return {before,after,collapsedByClick}
}
// A document ending with a read-only embed has a root boundary after it.
// Ctrl+End may place the caret there, which is not a writable paragraph.
// Select visible fixture text with ONE trusted native mouse pair. Measuring a
// DOM Range does not change the document selection or the application state.
export async function focusBlockReferenceParagraph({evaluate,cdp,until}, marker='BLOCK103 destination') {
  const before=await until(()=>evaluate(`(() => {
    const root=document.querySelector('.editor-input[contenteditable="true"]')
    if(!root)return null
    const paragraphs=[...root.children].filter(e=>e.tagName==='P'&&e.textContent.includes(${q(marker)}))
    if(paragraphs.length!==1)return {candidateCount:paragraphs.length}
    const paragraph=paragraphs[0],texts=[]
    const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT)
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      if(node.data.includes(${q(marker)})&&!node.parentElement.closest('.wiki-link,.block-reference-embed,[contenteditable="false"]'))texts.push(node)
    }
    if(texts.length!==1)return {candidateCount:texts.length}
    paragraph.scrollIntoView({block:'nearest'})
    const node=texts[0],offset=node.data.indexOf(${q(marker)}),range=document.createRange()
    range.setStart(node,offset);range.setEnd(node,offset+Math.min(8,${q(marker)}.length))
    const r=range.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y)
    if(!r.width||!r.height||x<0||y<0||x>=innerWidth||y>=innerHeight||!hit||!paragraph.contains(hit)||hit.closest('.wiki-link,.block-reference-embed,[contenteditable="false"]'))return null
    return {candidateCount:1,marker:${q(marker)},x,y,width:innerWidth,height:innerHeight}
  })()`),'Writable block-reference paragraph is missing or occluded')
  assert.equal(before.candidateCount,1,'Writable block-reference paragraph is ambiguous')
  for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,x:before.x,y:before.y,button:'left',clickCount:1})
  const after=await until(()=>evaluate(`(() => {
    const root=document.querySelector('.editor-input[contenteditable="true"]'),selection=getSelection()
    const node=selection?.anchorNode,element=node?.nodeType===Node.TEXT_NODE?node.parentElement:node
    const paragraph=element?.closest?.('p')
    const valid=Boolean(root&&selection?.isCollapsed&&node?.nodeType===Node.TEXT_NODE&&node.data.includes(${q(marker)})&&paragraph?.parentElement===root&&!element.closest('.wiki-link,.block-reference-embed,[contenteditable="false"]')&&(document.activeElement===root||root.contains(document.activeElement)))
    return valid?{marker:${q(marker)},collapsed:true,textNode:true,topLevelParagraph:true,editable:true,width:innerWidth,height:innerHeight}:null
  })()`),'Native click did not establish a writable paragraph caret')
  assert.equal(after.width,before.width,'Caret selection must not resize the window')
  assert.equal(after.height,before.height,'Caret selection must not resize the window')
  return {method:'native-text-click',before,after}
}
export async function verifyBlockReferencesDesktop({api,evaluate,click,cdp,until,capture,report,save,resizeSmall}) {
  const prefix='BLOCK103 '+randomUUID().slice(0,8)
  const source=await api('/api/files',{method:'POST',body:q({title:prefix+' Source.md',content:blockReferenceFixture('BLOCK103 source original')})})
  const destination=await api('/api/files',{method:'POST',body:q({title:prefix+' Destination.md',content:blockReferenceFixture('BLOCK103 destination')})})
  const sourceRoute='/api/files/'+encodeURIComponent(source.id), destinationRoute='/api/files/'+encodeURIComponent(destination.id)
  report.fixture={sourceId:source.id,destinationId:destination.id};save()
  const key=async(key,code,modifiers=0)=>{for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key,windowsVirtualKeyCode:code,modifiers})}
  const action=(text,selector='.block-reference-panel button')=>click({selector,text})
  const status=text=>until(()=>evaluate(`(document.querySelector('.block-reference-panel')?.innerText||document.querySelector('.block-reference-entry')?.innerText||'').includes(${q(text)})`),'Block reference status missing: '+text)
  const clean=()=>until(()=>evaluate("!document.querySelector('.workspace-save-chip.dirty,.save-state')"),'Original editor save was not confirmed')
  const mark=name=>{assert.equal(BLOCK_REFERENCE_CHECKS[report.checks.length],name);report.checks.push(name);save()}
  const open=async(file,needle)=>{
    const selector='[data-file-id='+q(file.id)+']'
    await refreshLocalExportLibrary({evaluate,click,until},selector,'Block-reference fixture not listed')
    await click(selector)
    await until(()=>evaluate(`document.querySelector('.workspace-title-button')?.textContent===${q(file.title)}&&document.querySelector('.editor-input')?.innerText.includes(${q(needle)})`),'Block reference note not opened')
    await clean()
  }
  const show=async(preserveCaret=false)=>{if(!preserveCaret){await click('.editor-input[contenteditable="true"]');await key('End',35,2)}await click({selector:'.block-reference-entry button',text:'块引用'});await until(()=>evaluate("Boolean(document.querySelector('.block-reference-panel'))"),'Block-reference entry did not open')}
  const address=async value=>{await click('.block-reference-panel input[placeholder]');await key('a',65,2);await cdp.send('Input.insertText',{text:value});
    const actual=await evaluate("document.querySelector('.block-reference-panel input[placeholder]').value");assert.equal(actual,value,'Actual native input differs from locator');
    report.locatorObservation=await evaluate("(()=>{const value=document.querySelector('.block-reference-panel input[placeholder]').value;const url=new URL(value);return {value,protocol:url.protocol,host:url.host,username:url.username,password:url.password,search:url.search,hash:url.hash,pathname:url.pathname}})()");save()
  }
  const inline='.editor-input .wiki-link[data-wiki-target-id='+q(source.id)+']'
  await open(source,'BLOCK103 source original');await show();await action('取消')
  assert.equal((await api(sourceRoute)).content,source.content);mark('open-and-cancel-does-not-write')
  await show();await action('为当前块创建引用');await status('块标识已加入当前草稿');await action('取消')
  await click('.editor-input[contenteditable="true"]');await key('s',83,2)
  const savedSource=await until(async()=>{const f=await api(sourceRoute);return f.content.includes('localBlockId')&&f},'Original save did not persist stable block ID')
  await clean();const blockId=JSON.parse(savedSource.content).root.children[0].$?.localBlockId;assert.match(blockId,/^b-[a-f0-9]{32}$/)
  mark('create-anchor-uses-original-save')
  await show();await action('核对保存并复制引用');await until(()=>evaluate("Boolean(document.querySelector('.block-reference-panel input[readonly]')?.value)"),'No saved block locator')
  const locator=await evaluate("document.querySelector('.block-reference-panel input[readonly]').value")
  assert.equal(locator,'notepad://block/'+encodeURIComponent(source.id)+'/'+blockId)
  assert.equal((await api(sourceRoute)).content,savedSource.content);report.fixture.blockId=blockId;report.fixture.locator=locator;mark('copy-requires-saved-source')
  await capture('block103-source-address.png');await action('取消')
  await open(destination,'BLOCK103 destination');await show();await address(locator);await action('读取来源块');await until(()=>evaluate("document.querySelector('.block-reference-preview pre')?.textContent==='BLOCK103 source original'"),'Block preview did not show saved body')
  assert.equal((await api(destinationRoute)).content,destination.content);assert.equal((await api(sourceRoute)).content,savedSource.content);mark('preview-is-read-only')
  await capture('block103-reviewed-insertion.png');await action('确认插入引用');await until(()=>evaluate(`Boolean(document.querySelector(${q(inline)}))`),'Reviewed inline block reference not inserted')
  await click('.editor-input[contenteditable="true"]');await key('s',83,2);await clean()
  const savedDestination=await api(destinationRoute);assert.ok(savedDestination.content.includes(blockId));assert.ok(savedDestination.content.includes(source.id));mark('insert-reference-persists-target-and-anchor')
  await key('End',35,2);await cdp.send('Input.insertText',{text:' BLOCK103 unsaved'});await click(inline)
  await until(()=>evaluate("Boolean(document.querySelector('.consumer-confirm-modal'))"),'Original draft decision missing')
  await action('取消','.consumer-confirm-modal button');assert.equal(await evaluate("document.querySelector('.workspace-title-button')?.textContent"),destination.title)
  assert.equal((await api(destinationRoute)).content,savedDestination.content);mark('dirty-navigation-cancel-keeps-draft')
  await click('.editor-input[contenteditable="true"]');await key('s',83,2);await clean();await click(inline)
  await until(()=>evaluate(`document.querySelector('.workspace-title-button')?.textContent===${q(source.title)}&&document.querySelector('.block-reference-entry')?.innerText.includes('已定位到来源块')`),'Block navigation did not reach exact saved block')
  mark('explicit-save-and-source-navigation');await capture('block103-exact-navigation.png')
  await open(destination,'BLOCK103 destination');await show();await address(locator);await action('读取来源块')
  await until(()=>evaluate("Boolean(document.querySelector('.block-reference-preview'))"),'Embed preview missing')
  await click('.block-reference-panel select');await key('ArrowDown',40);await key('Enter',13)
  await action('确认插入嵌入');await until(()=>evaluate("document.querySelector('.block-reference-embed pre')?.textContent==='BLOCK103 source original'"),'Inserted embed missing')
  await click('.editor-input[contenteditable="true"]');await key('s',83,2);await clean()
  const embeddedDestination=await api(destinationRoute);assert.ok(embeddedDestination.content.includes('"embedded":true'));mark('embed-is-created-by-reviewed-insertion');await capture('block103-embedded.png')
  const changed=JSON.parse(savedSource.content);changed.root.children[0].children[0].text='BLOCK103 source changed'
  await api(sourceRoute,{method:'PUT',body:q({content:q(changed)})})
  assert.equal(await evaluate("document.querySelector('.block-reference-embed pre')?.textContent"),'BLOCK103 source original')
  await action('刷新来源','.block-reference-embed button');await until(()=>evaluate("document.querySelector('.block-reference-embed pre')?.textContent==='BLOCK103 source changed'"),'Explicit embed refresh failed')
  assert.equal((await api(destinationRoute)).content,embeddedDestination.content);mark('saved-source-refresh-is-explicit')
  const renamed=await api(sourceRoute,{method:'PUT',body:q({title:prefix+' Renamed.md'})})
  await action('刷新来源','.block-reference-embed button');await until(()=>evaluate(`document.querySelector('.block-reference-embed header strong')?.textContent===${q(renamed.title)}`),'Embed used stale source title');mark('renamed-source-uses-current-title')
  changed.root.children.push(structuredClone(changed.root.children[0]));await api(sourceRoute,{method:'PUT',body:q({content:q(changed)})})
  await action('刷新来源','.block-reference-embed button');await until(()=>evaluate("document.querySelector('.block-reference-embed [role=alert]')?.textContent.includes('重复块标识')"),'Ambiguous source not refused');assert.equal(await evaluate("Boolean(document.querySelector('.block-reference-embed pre'))"),false);mark('duplicate-block-identity-is-refused')
  await api(sourceRoute,{method:'DELETE'});await action('刷新来源','.block-reference-embed button')
  await until(()=>evaluate("Boolean(document.querySelector('.block-reference-embed [role=alert]'))"),'Deleted source error missing');assert.equal(await evaluate("Boolean(document.querySelector('.block-reference-embed pre'))"),false);mark('deleted-source-clears-embed')
  // Restore only this test-owned fixture. No data from another test is touched.
  await api(sourceRoute+'/restore',{method:'POST'});await api(sourceRoute,{method:'PUT',body:q({content:savedSource.content})})
  await cdp.send('Network.setBlockedURLs',{urls:['http://127.0.0.1:27121'+sourceRoute]})
  await action('刷新来源','.block-reference-embed button');await until(()=>evaluate("Boolean(document.querySelector('.block-reference-embed [role=alert]'))"),'Read error missing');await cdp.send('Network.setBlockedURLs',{urls:[]})
  await action('刷新来源','.block-reference-embed button');await until(()=>evaluate("Boolean(document.querySelector('.block-reference-embed pre'))"),'Explicit retry failed');mark('failed-read-has-explicit-retry')
  const held=[];const detach=cdp.onEvent(event=>{if(event.method==='Fetch.requestPaused')held.push(event.params)})
  try{
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:27121'+sourceRoute,requestStage:'Response'}]})
    await action('刷新来源','.block-reference-embed button');await until(()=>held.length===1,'Real block response not held');assert.equal(held[0].request.method,'GET');assert.equal(held[0].responseStatusCode,200)
    await action('停止读取','.block-reference-embed button');await cdp.send('Fetch.disable');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    assert.equal(await evaluate("Boolean(document.querySelector('.block-reference-embed pre'))"),false);mark('stopped-read-does-not-resurrect')
  }finally{await cdp.send('Fetch.disable').catch(()=>{});detach()}
  await action('刷新来源','.block-reference-embed button');await until(()=>evaluate("Boolean(document.querySelector('.block-reference-embed pre'))"),'Post-stop recovery failed')
  await click('button.editor-mode-toggle[aria-label="切换到阅读模式"]');await until(()=>evaluate("document.querySelector('.editor-input')?.getAttribute('contenteditable')==='false'"),'Reading mode did not apply')
  assert.equal(await evaluate("document.querySelector('.block-reference-entry button')?.disabled"),true);await action('刷新来源','.block-reference-embed button');await until(()=>evaluate("Boolean(document.querySelector('.block-reference-embed pre'))"),'Readonly refresh failed');assert.equal((await api(destinationRoute)).content,embeddedDestination.content);mark('reading-mode-keeps-embed-read-only')
  await capture('block103-reading-mode.png')
  await cdp.send('Page.reload');await until(()=>evaluate("Boolean(document.querySelector('.workspace-sidebar'))"),'App reload failed')
  await open(destination,'BLOCK103 destination');await until(()=>evaluate("Boolean(document.querySelector('.block-reference-embed pre'))"),'Reopen lost embed')
  assert.equal((await api(destinationRoute)).content,embeddedDestination.content);assert.equal((await api(sourceRoute)).content,savedSource.content)
  assert.equal(await evaluate(`document.querySelectorAll(${q(inline)}).length`),1);mark('reopen-retains-reference-identities')
  if(report.localValidationOnly){report.layoutVerification='not-executed-native-windows-required';report.saved={source:await api(sourceRoute),destination:await api(destinationRoute)};save();return{sourceId:source.id,destinationId:destination.id,blockId}}
  // Resize the actual application window; no emulated metrics, DOM writes,
  // accelerated clocks or hidden layout overrides are used.
  await resizeSmall()
  await until(()=>evaluate('innerWidth <= 720 && innerWidth >= 640 && innerHeight >= 400'), 'Real small-window bounds did not settle')
  report.smallWindowEntry=await revealBlockReferenceEditor({evaluate,click,until});save()
  await click('button.editor-mode-toggle[aria-label="切换到编辑模式"]')
  report.smallWindowCaret=await focusBlockReferenceParagraph({evaluate,cdp,until});save()
  await show(true);await address(locator);await action('读取来源块');await until(()=>evaluate("Boolean(document.querySelector('.block-reference-preview pre'))"),'Small-window preview missing')
  report.smallViewport=await evaluate('({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1})')
  assert.equal(report.smallViewport.overflow,false)
  await capture('block103-small-window.png');await action('取消');mark('small-window-controls-remain-reachable')
  await click('.workspace-sidebar-more[aria-label="更多功能"]')
  if(await evaluate("document.documentElement.getAttribute('data-theme') !== 'dark'"))await click('.theme-toggle[aria-label="切换主题"]')
  await until(()=>evaluate("document.documentElement.getAttribute('data-theme') === 'dark'"),'Real theme switch did not settle')
  await click('.workspace-sidebar-more[aria-label="更多功能"]')
  report.darkWindowCaret=await focusBlockReferenceParagraph({evaluate,cdp,until});save()
  await show(true);await address(locator);await action('读取来源块');await until(()=>evaluate("Boolean(document.querySelector('.block-reference-preview pre'))"),'Dark preview missing')
  report.darkPanel=await evaluate("(()=>{const e=document.querySelector('.block-reference-panel'),s=getComputedStyle(e);const root=getComputedStyle(document.documentElement);return{theme:document.documentElement.getAttribute('data-theme'),color:s.color,background:s.backgroundColor,surface:root.getPropertyValue('--surface').trim(),ink:root.getPropertyValue('--ink').trim()}})()")
  assert.notEqual(report.darkPanel.color,report.darkPanel.background)
  await capture('block103-dark-theme.png');await action('取消');mark('dark-theme-retains-readable-block-panel')
  assert.equal((await api(destinationRoute)).content,embeddedDestination.content)
  report.saved={source:(await api(sourceRoute)),destination:await api(destinationRoute)};save()
  return {sourceId:source.id,destinationId:destination.id,blockId,destinationContent:embeddedDestination.content}
}
