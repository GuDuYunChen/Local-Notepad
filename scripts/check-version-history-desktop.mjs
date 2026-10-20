import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createEditorSaveAttempt, commitEditorSave } from '../src/services/editorSaveTransaction.mjs'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { desktopNote } from './desktop-save-fixture.mjs'

// Serialized into the owned renderer. These listeners only observe native
// input; they never cancel events, call handlers, or synthesize a DOM click.
function historyButtonObservation({ action, id, label, scope, point }) {
 const key = '__desktopHistoryButtonObservation'
 const describe = node => {
  if (!node) return null
  try {
   const r = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
   return { html:node.outerHTML?.slice(0, 2048) || '',
    bounds:r ? { left:r.left, top:r.top, right:r.right, bottom:r.bottom } : null }
  } catch (error) { return { descriptionError:String(error.message || error), bounds:null } }
 }
 let state = window[key]
 if (action === 'begin') {
  if (state) throw Error('Another history button observation is active')
  const matches = [...document.querySelectorAll(scope + ' button')].filter(node => node.textContent.trim() === label)
  state = { id, label, scope, target: matches.length === 1 ? matches[0] : null, events: [], point: null }
  state.listener = event => {
   try {
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    state.events.push({ type:event.type, isTrusted:event.isTrusted, button:event.button,
     x:event.clientX, y:event.clientY, timeStamp:event.timeStamp,
     targetMatches:event.target instanceof Node && !!state.target?.contains(event.target), hitMatches:!!state.target?.contains(hit),
     atExpectedPoint:!!state.point && event.clientX === state.point.x && event.clientY === state.point.y,
     target:describe(event.target), hit:describe(hit) })
   } catch (error) { state.events.push({ type:event.type, observationError:String(error.message || error) }) }
  }
  window[key] = state
  for (const type of ['mousedown','mouseup','click']) document.addEventListener(type, state.listener, { capture:true, passive:true })
 }
 if (action === 'cleanup' && !state) return { cleaned:true, events:[] }
 if (!state || state.id !== id) throw Error('History button observation identity changed')
 if (action === 'arm') state.point = point
 const matches = [...document.querySelectorAll(state.scope + ' button')].filter(node => node.textContent.trim() === state.label)
 if (action === 'scroll') {
  if (state.scrolled) throw Error('History button must not be scrolled again')
  if (matches.length === 1 && matches[0] === state.target && state.target.isConnected && !state.target.disabled) {
   state.target.scrollIntoView({ block:'center' }); state.scrolled = true
  }
 }
 const bounds = describe(state.target)?.bounds || null
 const at = point || (bounds && { x:Math.floor((bounds.left + bounds.right) / 2), y:Math.floor((bounds.top + bounds.bottom) / 2) })
 const inViewport = !!at && at.x >= 0 && at.y >= 0 && at.x < window.innerWidth && at.y < window.innerHeight
 const hit = at ? document.elementFromPoint(at.x, at.y) : null
 const result = { timeOrigin:performance.timeOrigin, observedAt:performance.now(),
  matchCount:matches.length, scrolled:state.scrolled === true, sameTarget:matches.length === 1 && matches[0] === state.target && state.target.isConnected,
  enabled:!!state.target && !state.target.disabled, bounds, point:at,
  exposed:inViewport && !!state.target?.contains(hit), target:describe(state.target), hit:describe(hit),
  active:describe(document.activeElement), banner:describe(document.querySelector('.reference-maintenance-status')),
  events:state.events.slice() }
 if (action === 'cleanup') {
  for (const type of ['mousedown','mouseup','click']) document.removeEventListener(type, state.listener, true)
  delete window[key]; result.cleaned = true
 }
 return result
}

export async function clickHistoryButton({ evaluate, cdp, until, record, checkpoint }, label, scope = '.version-history') {
 Object.assign(record, { id:randomUUID(), label, scope, complete:false, preparation:{ count:0, stable:0, stableFrames:[] } })
 const observe = (action, point, frames = 0) => {
  let expression = `(${historyButtonObservation.toString()})(${JSON.stringify({ action, id:record.id, label, scope, point })})`
  for (let frame = 0; frame < frames; frame++) expression = `new Promise(resolve => requestAnimationFrame(() => resolve(${expression})))`
  return evaluate(expression)
 }
 const valid = observation => observation.sameTarget && observation.enabled && observation.exposed
 const nativeEvent = (event, type) => event?.type === type && event.isTrusted === true && event.button === 0 &&
  event.targetMatches === true && event.hitMatches === true && event.atExpectedPoint === true
 let failure, previousBounds
 try {
  record.initial = await observe('begin'); checkpoint()
  assert.equal(record.initial.sameTarget && record.initial.enabled, true, 'Missing enabled action ' + label)
  // Let the history panel's existing next-frame clearance measurement finish
  // before its single scroll; later occlusion is a refusal, not a second scroll.
  record.afterLayout = await observe('scroll', undefined, 2); checkpoint()
  assert.equal(record.afterLayout.sameTarget && record.afterLayout.enabled && record.afterLayout.scrolled, true, 'History button changed before its single scroll: ' + label)
  const settled = await until(async () => {
   const observation = await observe('measure', undefined, 1), preparation = record.preparation
   preparation.count++; preparation.first ||= observation; preparation.last = observation
   const bounds = JSON.stringify(observation.bounds)
   preparation.stable = valid(observation) ? (bounds === previousBounds ? preparation.stable + 1 : 1) : 0
   preparation.stableFrames = valid(observation) ? (bounds === previousBounds ? [...preparation.stableFrames, observation].slice(-3) : [observation]) : []
   previousBounds = bounds; checkpoint()
   if (!observation.sameTarget || !observation.enabled) return observation
   return preparation.stable >= 3 ? observation : false
  }, 'History action did not stabilize before native input: ' + label)
  assert.equal(valid(settled) && record.preparation.stable >= 3, true, 'History button changed before native press: ' + label)
  record.point = settled.point
  record.beforePress = await observe('arm', record.point)
  assert.equal(valid(record.beforePress), true, 'History button not exposed at native press: ' + label)
  assert.deepEqual(record.beforePress.bounds, settled.bounds, 'History button moved before native press: ' + label)
  record.pressRequested = true; checkpoint()
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', ...record.point, button:'left', clickCount:1 })
  record.pressAcknowledged = true
  record.beforeRelease = await observe('measure', record.point); checkpoint()
  assert.equal(valid(record.beforeRelease), true, 'History button changed or became covered before native release: ' + label)
  assert.equal(record.beforeRelease.events.length, 1, 'Unexpected input before history mouse release')
  assert.equal(nativeEvent(record.beforeRelease.events[0], 'mousedown'), true, 'History native mousedown was not observed on the original target')
  record.releaseRequested = true; checkpoint()
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...record.point, button:'left', clickCount:1 })
  record.releaseAcknowledged = true
  record.afterRelease = await observe('measure', record.point)
  assert.equal(record.afterRelease.events.length, 3, 'History native click sequence was not observed exactly once')
  for (const [index, type] of ['mousedown','mouseup','click'].entries())
   assert.equal(nativeEvent(record.afterRelease.events[index], type), true, 'History input receipt mismatch: ' + type)
  // Trusted input proves browser delivery, not a save handler or database PUT.
  record.complete = true
 } catch (error) { failure = error; record.error = String(error.stack || error); checkpoint() }
 finally {
  if (record.pressRequested && !record.releaseRequested) {
   try {
    // Cancel a held button outside the viewport instead of releasing onto a
    // replaced/covered control. Never repeat an activation whose input was sent.
    const point = { x:-1, y:-1 }
    record.cancelRelease = { point, before:await observe('measure', point), requested:false }
    assert.equal(record.cancelRelease.before.hit, null, 'History cancellation point must not hit a control')
    record.cancelRelease.requested = true; checkpoint()
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...point, button:'left', clickCount:1 })
    record.cancelRelease.acknowledged = true
   } catch (error) { record.cancelReleaseError = String(error.stack || error); failure ||= error }
  }
  try { record.cleanup = await observe('cleanup'); assert.equal(record.cleanup.cleaned, true) }
  catch (error) { record.cleanupError = String(error.stack || error); record.complete = false; failure ||= error }
  checkpoint()
 }
 if (failure) throw failure
 return record
}

export async function waitForHistoryExplicitSave({ api, until, record, checkpoint }, noteID) {
 assert.match(noteID, /^[A-Za-z0-9-]+$/)
 Object.assign(record, { noteID, route:'/api/files/' + noteID, complete:false, samples:0, startedAt:new Date().toISOString() })
 try {
  await until(async () => {
   const sample = { startedAt:new Date().toISOString() }
   try {
    sample.file = await api(record.route)
    sample.matches = sample.file.content.includes('current-unsaved-history-guard')
    return sample.matches
   } catch (error) { sample.error = String(error.stack || error); throw error }
   finally {
    sample.finishedAt = new Date().toISOString(); record.samples++
    record.first ||= sample; record.last = sample; checkpoint()
   }
  }, 'Explicit save failed')
  record.complete = true
 } catch (error) { record.error = String(error.stack || error); throw error }
 finally { record.finishedAt = new Date().toISOString(); checkpoint() }
}

export function observeHistorySaveTraffic(cdp, record, noteID) {
 assert.match(noteID, /^[A-Za-z0-9-]+$/)
 const target = 'http://127.0.0.1:27121/api/files/' + noteID, byRequest = new Map()
 Object.assign(record, { target, method:'PUT', startedAt:new Date().toISOString(), requests:[], detached:false })
 let closed = false
 const detach = cdp.onEvent(({ method, params }) => {
  if (closed || !method?.startsWith('Network.') || !params) return
  if (method === 'Network.requestWillBeSent') {
   const request = params.request
   if (request?.method !== 'PUT' || request.url !== target) return
   const observed = { requestId:params.requestId, timestamp:params.timestamp, wallTime:params.wallTime,
    request:{ method:request.method, url:request.url, hasPostData:request.hasPostData === true,
     postDataPresent:typeof request.postData === 'string', ...(typeof request.postData === 'string' ? { postData:request.postData } : {}) } }
   record.requests.push(observed); byRequest.set(params.requestId, observed)
  } else {
   const observed = byRequest.get(params.requestId)
   if (!observed) return
   if (method === 'Network.responseReceived') observed.response = { requestId:params.requestId, timestamp:params.timestamp,
    url:params.response?.url, status:params.response?.status, statusText:params.response?.statusText, mimeType:params.response?.mimeType }
   if (method === 'Network.loadingFinished') observed.finished = { requestId:params.requestId, timestamp:params.timestamp, encodedDataLength:params.encodedDataLength }
   if (method === 'Network.loadingFailed') observed.failed = { requestId:params.requestId, timestamp:params.timestamp,
    errorText:params.errorText, canceled:params.canceled === true, blockedReason:params.blockedReason }
  }
 })
 return { close() {
  if (closed) return
  closed = true; detach(); record.detached = true; record.finishedAt = new Date().toISOString()
 } }
}

// Part of the ORIGINAL packaged Windows application run. Only owned fixture
// notes and browser request blocking are used; App/preload/Go/SQLite stay real.
export async function beginHistoryWriteFailure(cdp, target) {
 const parsed = new URL(target)
 assert.equal(parsed.origin, 'http://127.0.0.1:27121')
 assert.match(parsed.pathname, /^\/api\/files\/[A-Za-z0-9-]+$/)
 assert.equal(parsed.search, ''); assert.equal(parsed.hash, '')
 assert.equal(typeof cdp.onEvent, 'function')
 const observed = [], pending = new Set()
 let active = true, closed = false, failure = null
 const detach = cdp.onEvent(message => {
  if (message.method !== 'Fetch.requestPaused') return
  const {requestId, request} = message.params
  const blocked = active && request.method === 'PUT' && request.url === target
  observed.push({method: request.method, url: request.url, blocked})
  const task = Promise.resolve().then(() => cdp.send(blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest',
   blocked ? {requestId, errorReason: 'Failed'} : {requestId})).catch(error => { failure ||= error }).finally(() => pending.delete(task))
  pending.add(task)
 })
 try { await cdp.send('Fetch.enable', {patterns: [{urlPattern: target + '*', requestStage: 'Request'}]}) }
 catch (error) { active = false; detach(); throw error }
 return {observed, async close() {
  if (closed) return
  closed = true; active = false
  try { await cdp.send('Fetch.disable'); await Promise.all([...pending]); if (failure) throw failure }
  finally { detach() }
 }}
}

export async function verifyVersionHistoryDesktop({ evaluate, click, cdp, until, api, out, noteIDs }) {
 let writeFailure = null
 const report={complete:false,commit:process.env.GITHUB_SHA,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[],screenshots:[]}
 const save=()=>writeFileSync(path.join(out,'version-history.json'),JSON.stringify(report,null,2)+'\n')
 const mark=name=>{report.checks.push(name);save()};save()
 const original=await Promise.all(noteIDs.map(id=>api('/api/files/'+id)))
 const first=desktopNote('历史第一版','first-history-body'),second=desktopNote('历史第二版','second-history-body'),latest=desktopNote('当前正文','latest-history-body')
 const file=await api('/api/files',{method:'POST',body:JSON.stringify({title:'History closure.md',content:first})})
 const route='/api/files/'+file.id,versionsRoute=route+'/versions',base='http://127.0.0.1:27121'
 const write=(expected,content)=>commitEditorSave(api,createEditorSaveAttempt(file.id,expected,content))
 const button=async(label,scope='.version-history')=>{
  const record = {}; (report.nativeButtons ||= []).push(record)
  await clickHistoryButton({ evaluate, cdp, until, record, checkpoint:save }, label, scope)
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
  report.explicitSave = { noteID:file.id, complete:false, transport:{} }
  const saveTraffic = observeHistorySaveTraffic(cdp, report.explicitSave.transport, file.id);save()
  try {
   await button('先保存当前笔记');await waitForHistoryExplicitSave({ api, until, record:report.explicitSave, checkpoint:save }, file.id)
  } finally { saveTraffic.close();save() }
  await until(()=>evaluate("document.querySelector('.version-restore-action')?.disabled===false"),'History remained blocked after save');mark('explicit-original-editor-save-unblocks-history')
  await click(`.version-select-action[data-version-id="${seeded[1].id}"]`)
  writeFailure=await beginHistoryWriteFailure(cdp,base+route);await restore();await waitText('保存尚未确认')
  assert.ok((await api(route)).content.includes('current-unsaved-history-guard'))
  assert.equal(await evaluate("document.querySelector('.editor-input')?.innerText.includes('first-history-body')"),true)
  assert.equal(await evaluate("!!document.querySelector('.save-state.error')"),true);mark('failed-save-keeps-restored-draft-and-original-database')
  assert.equal(writeFailure.observed.filter(r=>r.blocked).length,1,'Expected exactly one failed write')
  assert.ok(writeFailure.observed.some(r=>r.method==='GET' && r.url===base+versionsRoute && !r.blocked),'Version preflight was not allowed through')
  report.failureInjection={mode:'exact-PUT-only',requests:writeFailure.observed};save()
  await writeFailure.close();writeFailure=null
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
 finally{try{await writeFailure?.close()}finally{await cdp.send('Network.setBlockedURLs',{urls:[]})}}
}
