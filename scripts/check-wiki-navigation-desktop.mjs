import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { desktopNote } from './desktop-save-fixture.mjs'

export async function verifyWikiNavigationDesktop({ evaluate, click, cdp, until, api, out, noteIDs }) {
  const report = { complete:false, commit:process.env.GITHUB_SHA, realPackagedApp:true, realBackend:true, syntheticData:true, checks:[], screenshots:[] }
  const save = () => writeFileSync(path.join(out,'wiki-navigation.json'),JSON.stringify(report,null,2)+'\n')
  const mark = name => { report.checks.push(name); save() }; save()
  const originals = await Promise.all(noteIDs.map(id=>api('/api/files/'+id)))
  const source = await api('/api/files',{method:'POST',body:JSON.stringify({title:'引用导航98来源.md',content:desktopNote('引用导航98来源','wiki98-source-body')})})
  const target = await api('/api/files',{method:'POST',body:JSON.stringify({title:'引用导航98目标.md',content:desktopNote('目标章节98','wiki98-target-body')})})
  const route = '/api/files/'+target.id, url = 'http://127.0.0.1:27121'+route
  const link = `.wiki-link[data-wiki-target-id="${target.id}"]`
  const keys = async (key,code,modifiers=0) => { for(const type of ['rawKeyDown','keyUp']) await cdp.send('Input.dispatchKeyEvent',{type,key,windowsVirtualKeyCode:code,modifiers}) }
  const clean = () => until(()=>evaluate("!document.querySelector('.workspace-save-chip,.save-state')"),'Wiki workflow original editor not clean')
  const titleIs = title => evaluate(`document.querySelector('.workspace-title-button')?.textContent===${JSON.stringify(title)}`)
  const hasStatus = value => until(()=>evaluate(`(document.querySelector('.wiki-navigation-status')?.innerText||'').includes(${JSON.stringify(value)})`),'Wiki status absent: '+value)
  const action = async (label,scope='.wiki-navigation-status') => {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    assert.equal(await evaluate(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)}||n.getAttribute('aria-label')===${JSON.stringify(label)});if(all.length!==1||all[0].disabled)return false;const n=all[0];n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!n.contains(hit))return false;n.setAttribute('data-wiki-action','');return true})()`),true,'Wiki control unreachable: '+label)
    try { await click('[data-wiki-action]') } finally { await evaluate("document.querySelector('[data-wiki-action]')?.removeAttribute('data-wiki-action')") }
  }
  const open = async (file,body) => {
    await evaluate("window.dispatchEvent(new Event('library:refresh'))")
    await until(()=>evaluate(`!!document.querySelector('[data-file-id="${file.id}"]')`),'Wiki fixture not listed')
    await click(`[data-file-id="${file.id}"]`)
    await until(()=>evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(body)})`),'Wiki fixture not loaded')
    await clean()
  }
  let intercept=false, detach=null
  const held=[]
  try {
    await open(source,'wiki98-source-body')
    await click('.editor-input[contenteditable="true"]'); await keys('End',35,2)
    await cdp.send('Input.insertText',{text:' [[引用导航98目标.md#目标章节98'})
    await until(()=>evaluate("document.querySelectorAll('.wiki-link-menu [role=option]').length===1"),'Original Wiki section picker not ready')
    await click('.wiki-link-menu [role=option]')
    await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(link)})`),'Original Wiki node was not inserted')
    assert.equal(await evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),true)
    mark('original-wiki-picker-inserts-a-real-section-reference')

    const point=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(link)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
    await until(()=>evaluate("(document.querySelector('.wiki-link-preview')?.innerText||'').includes('wiki98-target-body')"),'Actual hover preview not loaded')
    assert.equal((await api('/api/files/'+source.id)).content,source.content)
    mark('hover-preview-reads-target-without-saving-source-draft')

    await click(link)
    await until(()=>evaluate("!!document.querySelector('.consumer-confirm-modal')"),'Original unsaved Wiki decision absent')
    await action('取消','.consumer-confirm-modal')
    assert.equal(await titleIs(source.title),true)
    assert.equal(await evaluate("!!document.querySelector('.workspace-save-chip.dirty')"),true)
    assert.equal((await api('/api/files/'+source.id)).content,source.content)
    mark('cancelled-link-opening-keeps-source-draft-and-database-body')

    await action('关闭引用导航提示')
    await click('.editor-input[contenteditable="true"]'); await keys('s',83,2)
    await until(async()=>(await api('/api/files/'+source.id)).content.includes('wiki-link'),'Original save did not persist reference')
    await clean(); const savedSource=await api('/api/files/'+source.id)
    mark('original-save-persists-the-inserted-wiki-reference')

    await cdp.send('Network.setBlockedURLs',{urls:[url]}); await click(link); await hasStatus('本机服务请求失败')
    assert.equal(await titleIs(source.title),true)
    mark('failed-target-read-keeps-source-and-exposes-explicit-retry')
    await cdp.send('Network.setBlockedURLs',{urls:[]}); await action('重试打开引用')
    await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('wiki98-target-body')"),'Retried Wiki target not opened')
    await until(()=>evaluate("(document.querySelector('.document-outline')?.innerText||document.body.innerText).includes('已定位')"),'Wiki section did not reach original outline navigation')
    await clean(); assert.equal(await titleIs(target.title),true)
    mark('retry-opens-latest-target-and-exact-section-through-original-guard')

    await open(source,'wiki98-source-body')
    await api(route,{method:'PUT',body:JSON.stringify({title:'引用导航98更名.md',content:desktopNote('目标章节98','wiki98-fresh-body')})})
    await click(link)
    await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('wiki98-fresh-body')"),'Renamed Wiki target was stale')
    assert.equal(await titleIs('引用导航98更名.md'),true); await clean()
    mark('renamed-target-uses-fresh-title-and-body-not-preview-cache')

    await open(source,'wiki98-source-body')
    const ambiguous=JSON.parse(desktopNote('目标章节98','wiki98-ambiguous-body'));ambiguous.root.children.push({...ambiguous.root.children[0]})
    await api(route,{method:'PUT',body:JSON.stringify({content:JSON.stringify(ambiguous)})})
    await click(link); await hasStatus('同名章节路径'); assert.equal(await titleIs(source.title),true)
    mark('duplicate-heading-path-refuses-to-choose-the-first-section')
    await action('仅打开笔记正文')
    await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('wiki98-ambiguous-body')"),'Explicit Wiki body fallback failed'); await clean()
    mark('explicit-body-only-fallback-opens-note-without-guessing-section')

    await open(source,'wiki98-source-body')
    await api(route,{method:'PUT',body:JSON.stringify({content:desktopNote('目标章节98','wiki98-fresh-body')})})
    detach=cdp.onEvent(event=>{if(event.method==='Fetch.requestPaused'){const {requestId,request,responseStatusCode}=event.params;held.push({requestId,url:request.url,method:request.method,responseStatusCode})}})
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:url,requestStage:'Response'}]});intercept=true
    await click(link); await until(()=>held.length===1,'Actual target response was not held')
    assert.equal(held[0].method,'GET');assert.equal(held[0].responseStatusCode,200)
    await action('停止打开引用'); await hasStatus('已停止打开')
    await cdp.send('Fetch.disable');intercept=false;detach();detach=null
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    assert.equal(await titleIs(source.title),true)
    report.delayedRead={realResponse:true,method:held[0].method,responseStatusCode:held[0].responseStatusCode,replayed:false}
    mark('stopped-real-response-cannot-navigate-after-it-is-released')

    await action('关闭引用导航提示');await click(link)
    await until(()=>evaluate("document.querySelector('.editor-input')?.innerText.includes('wiki98-fresh-body')"),'Fresh activation after stop failed');await clean()
    mark('new-explicit-activation-recovers-after-a-stopped-read')

    // The Wiki verification GET and the editor's later body GET are distinct.
    // Release the first real response unchanged, then hold the second until the
    // user has left the selected target. No body, callback or timer is replaced.
    await open(source,'wiki98-source-body')
    await evaluate(`(()=>{const events=[];const listener=event=>events.push({documentId:event.detail?.documentId,path:event.detail?.path});window.__wiki98AnchorProbe={events,listener};window.addEventListener('editor:open-heading-anchor',listener);return true})()`)
    const bodyReads=[]
    detach=cdp.onEvent(event=>{
      if(event.method==='Fetch.requestPaused'){
        const {requestId,request,responseStatusCode}=event.params
        bodyReads.push({requestId,url:request.url,method:request.method,responseStatusCode})
      }
    })
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:url,requestStage:'Response'}]});intercept=true
    await click(link);await until(()=>bodyReads.length===1,'Wiki verification response was not held')
    assert.equal(bodyReads[0].url,url);assert.equal(bodyReads[0].method,'GET');assert.equal(bodyReads[0].responseStatusCode,200)
    assert.equal(await titleIs(source.title),true)
    await cdp.send('Fetch.continueRequest',{requestId:bodyReads[0].requestId})
    await until(()=>bodyReads.length===2,'The selected target editor did not issue its own body GET')
    assert.equal(bodyReads[1].url,url);assert.equal(bodyReads[1].method,'GET');assert.equal(bodyReads[1].responseStatusCode,200)
    assert.notEqual(bodyReads[0].requestId,bodyReads[1].requestId)
    await until(()=>titleIs('引用导航98更名.md'),'Wiki did not select the target before the delayed editor load')
    assert.equal(await evaluate("!document.querySelector('.editor-input')&&[...document.querySelectorAll('.placeholder')].some(node=>node.textContent.includes('加载中'))"),true)
    assert.deepEqual(await evaluate('window.__wiki98AnchorProbe.events'),[])
    report.delayedBodyRead={verification:{method:bodyReads[0].method,responseStatusCode:bodyReads[0].responseStatusCode,continuedUnchanged:true},editor:{method:bodyReads[1].method,responseStatusCode:bodyReads[1].responseStatusCode},selectedBeforeBodyReady:true,replayed:false}
    mark('accepted-section-waits-for-the-real-editor-body-read')

    await open(source,'wiki98-source-body')
    await cdp.send('Fetch.disable');intercept=false;detach();detach=null
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    assert.equal(await titleIs(source.title),true)
    assert.deepEqual(await evaluate('window.__wiki98AnchorProbe.events'),[])
    await open({...target,title:'引用导航98更名.md'},'wiki98-fresh-body')
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    assert.equal(await titleIs('引用导航98更名.md'),true)
    assert.deepEqual(await evaluate('window.__wiki98AnchorProbe.events'),[])
    assert.equal(await evaluate("!!document.querySelector('.document-outline-panel')"),false)
    assert.equal((await api('/api/files/'+source.id)).content,savedSource.content)
    report.delayedBodyRead.ordinaryReopen={sourceRetained:true,targetLoaded:true,anchorEvents:0,outlineOpened:false}
    const returnImage=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'),returnFilename='wiki-navigation-body-return-installed.png'
    writeFileSync(path.join(out,returnFilename),returnImage);report.screenshots.push({filename:returnFilename,bytes:returnImage.length,sha256:createHash('sha256').update(returnImage).digest('hex')})
    mark('ordinary-target-reopen-cannot-revive-the-abandoned-section')
    await evaluate("(()=>{const probe=window.__wiki98AnchorProbe;if(probe)window.removeEventListener('editor:open-heading-anchor',probe.listener);delete window.__wiki98AnchorProbe;return true})()")

    await open(source,'wiki98-source-body')
    const removed=await api(route,{method:'PUT',body:JSON.stringify({is_deleted:true})})
    assert.equal(removed.is_deleted,true);await assert.rejects(()=>api(route))
    await click(link);await hasStatus('已删除')
    assert.equal(await titleIs(source.title),true)
    report.unavailableTarget={deletionConfirmed:true,readRejected:true,navigationRejected:true}
    mark('deleted-reference-refuses-navigation-without-removing-the-link')

    const image=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'),filename='wiki-navigation-installed.png'
    writeFileSync(path.join(out,filename),image);report.screenshots.push({filename,bytes:image.length,sha256:createHash('sha256').update(image).digest('hex')});save()
    await action('关闭引用导航提示');assert.equal(await evaluate("!!document.querySelector('.wiki-navigation-status')"),false)
    assert.equal((await api('/api/files/'+source.id)).content,savedSource.content)
    mark('closing-error-feedback-preserves-the-saved-source-and-reference')
    assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),originals)
    mark('unrelated-note-bodies-metadata-and-pins-remain-unchanged')
    report.complete=true;save()
  } catch(error) { report.error=String(error.stack||error);save();throw error }
  finally {
    try { if(intercept)await cdp.send('Fetch.disable') }
    finally {
      detach?.()
      try { await evaluate("(()=>{const probe=window.__wiki98AnchorProbe;if(probe)window.removeEventListener('editor:open-heading-anchor',probe.listener);delete window.__wiki98AnchorProbe;return true})()") }
      finally { await cdp.send('Network.setBlockedURLs',{urls:[]}) }
    }
  }
}
