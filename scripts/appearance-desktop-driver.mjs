import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { refreshLocalExportLibrary } from './check-local-export-desktop.mjs'
import { blockReferenceFixture } from './block-references-desktop-driver.mjs'
import { APPEARANCE_CHECKS, appearanceHash } from './appearance-desktop-evidence.mjs'
const q = JSON.stringify, KEY = 'localNotepad.appearance.v1'
export async function verifyAppearanceDesktop(context) {
  const { api, evaluate, click, until, capture, report, save, cdp, start, closeNormally, reinstallWithRetainedDraft, ownedRoot, outputDirectory, resizeSmall } = context
  report.checks = []; report.exits = []; report.feedback = {}
  const mark = name => { assert.equal(name, APPEARANCE_CHECKS[report.checks.length]); report.checks.push(name); save() }
  const stored = () => evaluate(`localStorage.getItem(${q(KEY)})`)
  const accent = () => evaluate("document.documentElement.style.getPropertyValue('--clay')")
  const mode = () => evaluate("document.documentElement.getAttribute('data-theme')")
  const action = (text, selector = '.appearance-center button') => click({ selector, text })
  const key = async (key, code, modifiers = 0) => { for (const type of ['rawKeyDown','keyUp']) await cdp().send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code, modifiers }) }
  const field = async (label, text) => {
    const selector = '.appearance-center input[aria-label=' + q(label) + ']'
    await click(selector); await key('a',65,2); await cdp().send('Input.insertText',{text})
    assert.equal(await evaluate(`document.querySelector(${q(selector)}).value`), text)
  }
  const waitText = text => until(() => evaluate(`document.querySelector('.appearance-center')?.innerText.includes(${q(text)})`), 'Appearance feedback absent: ' + text)
  const feedback = async (name, text, role = 'alert') => {
    const observed = await until(() => evaluate(`(()=>{const n=[...document.querySelectorAll('.appearance-feedback-area [role='+${q(role)}+']')].find(e=>e.textContent.includes(${q(text)}));if(!n)return null;const b=n.getBoundingClientRect(),a=n.closest('.appearance-feedback-area').getBoundingClientRect(),f=document.querySelector('.appearance-footer').getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);const value={text:${q(text)},role:${q(role)},top:b.top,bottom:b.bottom,left:b.left,right:b.right,areaTop:a.top,areaBottom:a.bottom,footerTop:f.top,viewportWidth:innerWidth,viewportHeight:innerHeight,hit:n.contains(hit),outsideScroll:!n.closest('.appearance-scroll')};return b.width>0&&b.height>0&&value.hit&&value.outsideScroll&&b.top>=Math.max(0,a.top)&&b.bottom<=Math.min(innerHeight,a.bottom,f.top)&&b.left>=0&&b.right<=innerWidth?value:null})()`), 'Feedback is not visibly reachable without scrolling: ' + text)
    report.feedback[name] = observed; save()
  }
  const settings = async () => {
    if (!await evaluate("Boolean(document.querySelector('.settings-panel'))")) {
      await click('button[aria-label="更多功能"]'); await click({selector:'.workspace-sidebar-more-menu button',text:'设置'})
    }
    await until(() => evaluate("Boolean(document.querySelector('.settings-panel'))"),'Settings did not open')
  }
  const open = async () => { await settings(); await action('管理主题方案','.settings-panel button'); await until(() => evaluate("Boolean(document.querySelector('.appearance-center'))"),'Appearance entry did not open') }
  const close = async () => { await click('[data-appearance-close]'); await until(() => evaluate("!document.querySelector('.appearance-center')"),'Clean appearance dialog did not close') }
  const scheme = async index => { await click(`.appearance-schemes button:nth-child(${index})`) }
  const create = async name => { await scheme(2); await action('复制为自定义方案'); await field('方案名称',name) }
  const apply = async () => { await action('应用并保存'); await waitText('已写入本机配置并读回确认'); await feedback('saved', '已写入本机配置并读回确认', 'status'); const raw = await stored(); assert.ok(raw); return raw }
  const installInputObservation = () => evaluate("window.__appearance105Inputs={mouse:false,keyboard:false};document.addEventListener('pointerdown',e=>{if(e.isTrusted)window.__appearance105Inputs.mouse=true},{capture:true});document.addEventListener('input',e=>{if(e.isTrusted)window.__appearance105Inputs.keyboard=true},{capture:true});true")
  const importFile = async file => {
    const document = await cdp().send('DOM.getDocument')
    const input = await cdp().send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'.appearance-center input[type="file"]'})
    assert.ok(input.nodeId > 0); await cdp().send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[file]})
  }
  await start(); await installInputObservation()
  const body = blockReferenceFixture('APPEARANCE105 unchanged note ' + randomUUID())
  const note = await api('/api/files',{method:'POST',body:q({title:'APPEARANCE105 验收.md',content:body})})
  const noteRoute = '/api/files/' + encodeURIComponent(note.id)
  const selector = '[data-file-id=' + q(note.id) + ']'
  await refreshLocalExportLibrary({evaluate,click,until},selector,'Synthetic unchanged note missing')
  await click(selector); await until(() => evaluate("Boolean(document.querySelector('.editor-input'))"),'Original editor did not open')
  const requestIndex = context.requestCount(); const initialMode = await mode()
  await click('button[aria-label="更多功能"]'); assert.equal(await mode(),initialMode)
  await click({selector:'.workspace-sidebar-more-menu button',text:'设置'}); assert.equal(await mode(),initialMode)
  if(await mode() !== 'light') await click('.settings-panel button[aria-label="切换主题"]')
  await until(async () => await mode() === 'light','Original light mode not applied')
  await open(); assert.equal(await stored(),null)
  mark('settings-entry-and-more-preserve-mode')
  await create('Windows 主题105')
  await field('浅色强调色','#ffffff'); await waitText('对比度不足'); await feedback('invalidColor','对比度不足')
  assert.equal(await evaluate("document.querySelector('.appearance-apply').disabled"),true); assert.equal(await stored(),null)
  await field('浅色强调色','#176b4a'); mark('invalid-color-refused')
  const originalAccent = await accent()
  await action('预览当前方案'); assert.equal(await accent(),'#176b4a'); assert.equal(await stored(),null)
  await capture('appearance105-light-preview.png')
  await action('取消预览'); assert.equal(await accent(),originalAccent); assert.equal(await stored(),null); mark('preview-cancel-does-not-save')
  await click('[data-appearance-close]'); await action('继续编辑','.appearance-confirm button')
  assert.equal(await evaluate("document.querySelector('input[aria-label=\"方案名称\"]').value"),'Windows 主题105')
  await click('[data-appearance-close]'); await action('确认','.appearance-confirm button')
  await until(() => evaluate("!document.querySelector('.appearance-center')"),'Discard did not close dialog')
  assert.equal(await stored(),null); mark('dirty-close-confirmation')
  await open(); await create('Windows 主题105'); let raw = await apply()
  let config = JSON.parse(raw).value; assert.equal(config.schemes.length,1); assert.equal(config.schemes[0].name,'Windows 主题105'); assert.equal(await accent(),'#176b4a'); mark('apply-and-readback')
  await close(); await click('.settings-panel button[aria-label="切换主题"]'); await until(async () => await mode() === 'dark' && await accent() === '#80d6ad','Original dark mode did not repaint accent')
  await open(); await capture('appearance105-dark.png'); mark('original-dark-toggle')
  const downloads = path.join(ownedRoot,'appearance-downloads'); mkdirSync(downloads)
  await cdp().send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await action('导出当前方案')
  const exportedPath = await until(() => { const names = readdirSync(downloads).filter(name => name === 'local-notepad-theme.json'); return names.length === 1 && path.join(downloads,names[0]) },'Actual theme download missing')
  const bytes = readFileSync(exportedPath), exported = JSON.parse(bytes)
  assert.deepEqual(exported,{format:'local-notepad-appearance',version:1,scheme:{name:'Windows 主题105',lightAccent:'#176b4a',darkAccent:'#80d6ad'}})
  writeFileSync(path.join(outputDirectory,'exported-theme.json'),bytes,{flag:'wx'})
  report.fileExport={format:exported.format,version:exported.version,bytes:bytes.length,sha256:appearanceHash(bytes)}; mark('actual-file-export')
  const bad = path.join(ownedRoot,'invalid-theme.json'); writeFileSync(bad,'{"wrong":true}')
  await importFile(bad); await waitText('结构不受支持'); await feedback('importError','结构不受支持'); assert.equal(await stored(),raw); mark('invalid-file-refused')
  await importFile(exportedPath); await waitText('主题已导入为待应用方案'); assert.equal(await stored(),raw)
  report.fileImport={method:'DOM.setFileInputFiles-real-file',noWriteBeforeApply:true}; mark('actual-file-import-is-pending')
  raw=await apply(); assert.equal(JSON.parse(raw).value.schemes.length,2)
  await action('删除方案'); await action('继续编辑','.appearance-confirm button'); assert.equal(await stored(),raw)
  await action('删除方案'); await action('确认','.appearance-confirm button'); assert.equal(await stored(),raw)
  raw=await apply(); assert.equal(JSON.parse(raw).value.schemes.length,1); mark('delete-cancel-and-apply')
  await action('恢复默认方案'); await action('继续编辑','.appearance-confirm button'); assert.equal(await stored(),raw)
  await action('恢复默认方案'); await action('确认','.appearance-confirm button'); assert.equal(await stored(),raw)
  raw=await apply(); assert.deepEqual(JSON.parse(raw).value,{version:1,activeId:'default',schemes:[]}); mark('reset-cancel-and-apply')
  await create('保留主题105'); raw=await apply()
  const quota = await evaluate(`(()=>{const keys=[];let error=null;for(const size of [262144,4096,64,1]){for(let count=0;count<400;count++){const key='appearance105:quota:'+keys.length;try{localStorage.setItem(key,'q'.repeat(size));keys.push(key)}catch(e){if(e.name!=='QuotaExceededError')throw e;error=e.name;break}}}window.__appearance105Quota=keys;return{keys:keys.length,error}})()`)
  assert.equal(quota.error,'QuotaExceededError'); assert.ok(quota.keys>0)
  await field('方案名称','Quota retry xxxxxxxxxxxxxxxxxxxx'); await action('应用并保存'); await waitText('未能写入本机')
  assert.equal(await stored(),raw); await feedback('quotaError','未能写入本机'); await capture('appearance105-quota-error.png')
  await evaluate("window.__appearance105Quota.forEach(key=>localStorage.removeItem(key));delete window.__appearance105Quota;true")
  raw=await apply(); report.quota={...quota,originalConfigurationPreserved:true,retryReadBack:true}; mark('real-quota-failure-and-retry')
  await field('方案名称','尚未应用的编辑'); await action('预览当前方案')
  const external=JSON.parse(raw);external.revision='native-external-105';external.value.activeId='ocean'
  const externalRaw=JSON.stringify(external)
  await evaluate(`(()=>{const frame=document.createElement('iframe');frame.id='appearance105-external';frame.hidden=true;document.body.append(frame);frame.contentWindow.localStorage.setItem(${q(KEY)},${q(externalRaw)});return true})()`)
  await waitText('外部配置已变化'); assert.equal(await evaluate("document.querySelector('.appearance-apply').disabled"),true)
  await until(async () => await accent() === '#88c9ff','External storage did not revoke preview')
  await feedback('externalChange','外部配置已变化')
  const previewState = await evaluate(`(()=>{const panel=document.querySelector('.appearance-center');return{statusText:panel?.querySelector('[role="status"]')?.textContent,footerText:panel?.querySelector('.appearance-footer > span')?.textContent,cancelPreviewDisabled:[...panel.querySelectorAll('button')].find(button=>button.textContent==='取消预览')?.disabled}})()`)
  report.externalChange={method:'same-origin-frame-real-storage-event',previewRevoked:true,...previewState}; save()
  await capture('appearance105-external-change.png')
  assert.equal(typeof previewState.statusText,'string'); assert.ok(previewState.statusText.length>0)
  assert.doesNotMatch(previewState.statusText,/正在预览/)
  assert.equal(previewState.footerText,'仅本机配置'); assert.equal(previewState.cancelPreviewDisabled,true)
  await action('重新载入'); await action('确认','.appearance-confirm button'); assert.equal(await stored(),externalRaw)
  await evaluate("document.querySelector('#appearance105-external').remove();true"); mark('external-context-invalidates-preview')
  await close(); await evaluate(`localStorage.setItem(${q(KEY)},'{');true`); await open(); await waitText('配置损坏'); await feedback('corruptStorage','配置损坏')
  assert.equal(await stored(),'{'); await action('确认修复配置'); await action('确认','.appearance-confirm button'); await scheme(2); raw=await apply()
  report.corruption={explicitTestDataInjection:true,automaticOverwrite:false,explicitRepairReadBack:true}; mark('corrupt-storage-explicit-repair')
  await action('复制为自定义方案'); await field('方案名称','保留主题105'); raw=await apply()
  await resizeSmall(); await action('预览当前方案'); await action('取消预览'); await feedback('minimumWindowStatus','预览已取消','status')
  report.viewport=await evaluate(`(()=>{const d=document.querySelector('.appearance-center'),f=d.querySelector('.appearance-footer'),b=f.getBoundingClientRect();return{width:innerWidth,height:innerHeight,horizontalOverflow:d.scrollWidth>d.clientWidth+1,footerReachable:b.top>=0&&b.bottom<=innerHeight}})()`)
  assert.equal(report.viewport.horizontalOverflow,false); assert.equal(report.viewport.footerReachable,true)
  await capture('appearance105-small.png'); mark('minimum-native-window')
  const observations=await evaluate('window.__appearance105Inputs');report.trustedMouseInput=observations.mouse;report.trustedKeyboardInput=observations.keyboard
  await close(); await closeNormally(); report.exits.push({...report.exit})
  await start(); assert.equal(await stored(),raw); await until(async()=>await accent()==='#80d6ad','Restart lost appearance colors')
  report.configuration={sha256:appearanceHash(raw),restartedRawEqual:true,reinstalledRawEqual:false}; mark('normal-restart-restores')
  await closeNormally(); report.exits.push({...report.exit}); await reinstallWithRetainedDraft()
  await start(); assert.equal(await stored(),raw); await until(async()=>await accent()==='#80d6ad','Reinstall lost appearance colors')
  report.configuration.reinstalledRawEqual=true; await open(); await capture('appearance105-reinstalled.png'); mark('installation-retains-appearance')
  const saved=await api(noteRoute); assert.equal(saved.content,body)
  report.note={id:note.id,before:appearanceHash(body),after:appearanceHash(saved.content),bodyWrites:context.bodyWritesSince(requestIndex,note.id)}
  assert.equal(report.note.bodyWrites,0); mark('note-body-unchanged')
  await close(); await closeNormally(); report.exits.push({...report.exit}); save()
}
