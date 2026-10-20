import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, unlinkSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { selectDesktopMainWindow } from './desktop-window-target.mjs'
import { desktopNote } from './desktop-save-fixture.mjs'
import { createEditor } from 'lexical'
import { HeadingNode } from '@lexical/rich-text'
import { verifyDesktopSaveReport } from './desktop-save-evidence.mjs'
import { JSDOM } from 'jsdom'
import { clickHistoryButton, waitForHistoryExplicitSave, observeHistorySaveTraffic } from './check-version-history-desktop.mjs'

// Exercise the actual driver function without starting Electron or replacing
// its implementation with a fixture. Only the native/renderer I/O is synthetic.
function closeSnapshotContract(evaluate) {
 const source = readFileSync(new URL('./check-desktop-save.mjs', import.meta.url), 'utf8')
 const match = source.match(/async function closeSnapshot\(phase\) \{[\s\S]*?\n\}/)
 assert.ok(match, 'Actual closeSnapshot function must remain covered')
 const native = [{ pid: 2820, handle: 412, title: 'Observed mismatching caption', cls: '#32770',
  visible: true, childText: ['observed child text'], image: 'C:\\owned\\Notepad.exe' }]
 const receipt = { type: 'inspect', id: 149, pid: 2820, completed: true, elapsedMs: 120856.25 }
 const report = {}, saved = []
 const snapshot = runInNewContext('(' + match[0] + ')', {
  assert, structuredClone, child: { pid: 2820 }, report,
  windowSession: { inspect: async () => native, events: () => [receipt] },
  evaluate: () => evaluate({ native, receipt, report, saved }),
  saveReport: () => saved.push(JSON.parse(JSON.stringify(report))),
 })
 return { snapshot, native, receipt, report, saved }
}

test('closeSnapshot saves native observation and inspect receipt before reading renderer', async () => {
 const contract = closeSnapshotContract(({ native, receipt, saved }) => {
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].closeDiagnostics[0].native, native)
  assert.deepEqual(saved[0].closeDiagnostics[0].nativeRequest, receipt)
  return { title: 'actual renderer title' }
 })
 await contract.snapshot('before-close')
 assert.equal(contract.saved.at(-1).closeDiagnostics[0].renderer.title, 'actual renderer title')
})

test('closeSnapshot retains native mismatch and separately records a renderer timeout', async () => {
 const failure = new Error('renderer timed out while native dialog was open')
 const contract = closeSnapshotContract(() => { throw failure })
 await assert.rejects(contract.snapshot('failure'), error => error === failure)
 assert.ok(contract.saved.length >= 2, 'Native checkpoint must precede the renderer failure checkpoint')
 const observation = contract.saved.at(-1).closeDiagnostics[0]
 assert.deepEqual(observation.native, contract.native)
 assert.deepEqual(observation.nativeRequest, contract.receipt)
 assert.match(observation.rendererError, /renderer timed out while native dialog was open/)
 assert.equal(Object.hasOwn(observation, 'renderer'), false)
})

const sha = 'a'.repeat(40)
const crc = b => { let n = 0xffffffff; for (const x of b) { n ^= x; for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0) } return (n^0xffffffff)>>>0 }
function png() {
 const chunk = (name, data) => {
  const type=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])))
  return Buffer.concat([len,type,data,sum])
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(1000);header.writeUInt32BE(720,4);header[8]=8;header[9]=2
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((3000+1)*720))),chunk('IEND',Buffer.alloc(0))])
}
function fixture(fn) {
 const dir=mkdtempSync(path.join(tmpdir(),'desktop-evidence-')),bytes=png()
 const report={commit:sha,platform:'win32',complete:true,realPackagedApp:true,realLexical:true,realPreloadAndQuit:true,
  realBackend:true,syntheticData:true,timerAccelerated:false,dirtyBeforeClose:true,noForcedBackendWarning:true,processIDs:[100,200],
  exits:[100,200].map(pid=>({pid,code:0,signal:null,nativeClose:true})),
  appSHA256:'b'.repeat(64),asarSHA256:'c'.repeat(64),backendSHA256:'d'.repeat(64),finalBodySHA256:'e'.repeat(64),
  checks:[
   'production preload connected for process 100',
   'native Ctrl+S saved actual heading and body without reference confirmation',
   'real library switch and reopen retain saved Lexical content',
   'real unaccelerated 30-second autosave persisted a changed heading',
   'real failed browser PUT retains draft, actual retry saves it',
   'WM_CLOSE with dirty Lexical body completed real quit gate and backend shutdown',
   'production preload connected for process 200',
   'real packaged reading mode blocks input, preserves unsaved draft and saves after return',
   'fresh-profile packaged restart reads latest body from real database and closes cleanly'],
  screenshots:[['manual-saved','manual-native-4189'],['automatic-saved','automatic-native-4189'],
   ['failure-retains-draft','recovered-after-block'],['retry-saved','recovered-after-block'],
   ['restarted-fresh-profile','native-close-latest'],['reading-mode','reading-mode-unsaved-draft']].map(([n,text])=>({filename:n+'.png',text,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))}
 report.windowHelper={stoppedCleanly:true,events:[
  {type:'spawn',pid:800,elapsedMs:0},{type:'ready',pid:800,elapsedMs:100},
  ...['inspect','close','inspect','close'].map((type,i)=>({type,id:i+1,pid:i<2?100:200,completed:true,elapsedMs:200+i*100})),
  {type:'disposed',clean:true,elapsedMs:900},
 ]}
 report.closeTargets=[100,200].map((pid,i)=>({pid,handle:i+300,visible:true,title:'记事本 · Local-Notepad',cls:'Chrome_WidgetWin_1',childText:['Chrome Legacy Window']}))
 report.closeDiagnostics=report.closeTargets.map(t=>({phase:'before-close',pid:t.pid,native:[t],renderer:{title:t.title}}))
 for(const s of report.screenshots)writeFileSync(path.join(dir,s.filename),bytes)
 const save=()=>writeFileSync(path.join(dir,'checks.json'),JSON.stringify(report));save()
 try{fn(dir,report,save)}finally{rmSync(dir,{recursive:true,force:true})}
}
test('accepts complete current-commit report with all native checks and PNGs',()=>fixture(dir=>assert.equal(verifyDesktopSaveReport(dir,sha).complete,true)))
for(const [label,change] of [
 ['wrong native window',r=>r.closeTargets[1]={...r.closeTargets[1],handle:999}],
 ['wrong commit',r=>r.commit='f'.repeat(40)],['incomplete run',r=>r.complete=false],
 ['replaced Lexical input',r=>r.realLexical=false],['accelerated autosave',r=>r.timerAccelerated=true],
 ['already saved before close',r=>r.dirtyBeforeClose=false],['forced backend warning',r=>r.noForcedBackendWarning=false],
 ['missing actual restart',r=>r.processIDs.pop()],['forced process termination',r=>r.exits[0].signal='SIGKILL'],
 ['missing quit check',r=>r.checks.splice(5,1)],['missing reading mode check',r=>r.checks.splice(7,1)],['wrong visible marker',r=>r.screenshots[5].text='old body'],
])test('rejects '+label,()=>fixture((dir,r,save)=>{change(r);save();assert.throws(()=>verifyDesktopSaveReport(dir,sha))}))
test('rejects missing or modified screenshot even when run reports success',()=>{
 fixture((dir,r)=>{unlinkSync(path.join(dir,r.screenshots[0].filename));assert.throws(()=>verifyDesktopSaveReport(dir,sha))})
 fixture((dir,r)=>{writeFileSync(path.join(dir,r.screenshots[0].filename),'bad');assert.throws(()=>verifyDesktopSaveReport(dir,sha))})
})

test('synthetic seed uses actual canonical Lexical serialization without a load-time edit',()=>{
 const text=desktopNote('原始标题','original body'),editor=createEditor({nodes:[HeadingNode],onError(e){throw e}})
 const roundtrip=editor.parseEditorState(text)
 assert.equal(JSON.stringify(roundtrip.toJSON()),text)
})

const main={pid:100,handle:400,title:'记事本 · Local-Notepad',cls:'Chrome_WidgetWin_1',visible:true,childText:['Chrome Legacy Window']}
test('selects the actual renderer window rather than an earlier visible untitled helper',()=>{
 const helper={...main,handle:300,title:'',childText:[]}
 assert.equal(selectDesktopMainWindow([helper,main],100,main.title),main)
})
test('refuses another process, missing title, absent renderer child and ambiguous windows',()=>{
 for(const windows of [[{...main,pid:200}],[{...main,title:''}],[{...main,childText:[]}],[main,{...main,handle:500}],[]]){
  assert.throws(()=>selectDesktopMainWindow(windows,100,main.title))
 }
})
test('refuses hidden or malformed native window identities without posting a close',()=>{
 for(const change of [{visible:false},{handle:0},{handle:'400'},{cls:'Other'}]){
  assert.throws(()=>selectDesktopMainWindow([{...main,...change}],100,main.title))
 }
})

for (const [label, change] of [
 ['helper startup repeated', r => r.windowHelper.events.splice(3, 0, r.windowHelper.events[0])],
 ['native close not acknowledged', r => r.windowHelper.events[3].completed = false],
 ['helper receipt belongs to another app', r => r.windowHelper.events[3].pid = 999],
 ['helper not stopped', r => r.windowHelper.stoppedCleanly = false],
]) test('rejects ' + label, () => fixture((dir, report, save) => {
 change(report); save(); assert.throws(() => verifyDesktopSaveReport(dir, sha))
}))

function insertReadingQuitTrace(report) {
 const events = ['inspect', 'close', 'inspect', 'dismiss-unapplied', 'inspect']
  .map(type => ({ type, pid: report.processIDs[1], completed: true }))
 report.windowHelper.events.splice(4, 0, ...events)
 for (const [index, event] of report.windowHelper.events.entries()) {
  event.elapsedMs = index * 100
  if (index >= 2 && index < report.windowHelper.events.length - 1) event.id = index - 1
 }
 report.readingMode = { nativeQuitHelperEvents: structuredClone(events) }
}
test('complete reading refusal is an exact contiguous helper trace between both original successful closes', () => fixture((dir, report, save) => {
 insertReadingQuitTrace(report); save()
 assert.equal(verifyDesktopSaveReport(dir, sha).complete, true)
 assert.equal(report.exits.length, 2); assert.equal(report.closeTargets.length, 2); assert.equal(report.checks.length, 9)
}))
for (const [name, mutate] of [
 ['missing reading trace', r => delete r.readingMode.nativeQuitHelperEvents],
 ['deleted refusal receipt', r => r.windowHelper.events.splice(5, 1)],
 ['unexplained extra inspection', r => r.windowHelper.events.splice(5, 0, { ...r.windowHelper.events[4] })],
 ['repeated refusal close', r => r.windowHelper.events[6].type = 'close'],
 ['wrong linked event order', r => r.readingMode.nativeQuitHelperEvents.reverse()],
 ['another process in refusal', r => r.windowHelper.events[5].pid = 999],
 ['noncontiguous global request IDs', r => r.windowHelper.events.at(-2).id++],
 ['lost first successful close', r => r.windowHelper.events.splice(3, 1)],
 ['lost final successful close', r => r.windowHelper.events.splice(-2, 1)],
 ['restarted helper for refusal', r => r.windowHelper.events.splice(4, 0, { type: 'ready', pid: 801, elapsedMs: 400 })],
 ['clock moved backwards', r => r.windowHelper.events.at(-1).elapsedMs = 0],
 ['refusal counted as successful process exit', r => r.exits.push({ pid: 200, code: 0, signal: null, nativeClose: true })],
]) test('refuses combined native trace ' + name, () => fixture((dir, report, save) => {
 insertReadingQuitTrace(report); mutate(report); save(); assert.throws(() => verifyDesktopSaveReport(dir, sha))
}))

// The serialized production observer executes in real DOM nodes. Geometry,
// animation-frame delivery and CDP input are explicit Node I/O fixtures, not
// claims of Chromium rendering, browser trust, an App handler or a database PUT.
function historyButtonContract(options = {}) {
 const dom = new JSDOM('<!doctype html><section class="version-history"><button class="btn">先保存当前笔记</button></section><aside class="reference-maintenance-status">引用待处理</aside>',
  { runScripts:'outside-only', pretendToBeVisual:true })
 const { window } = dom, { document } = window, original = document.querySelector('button'), banner = document.querySelector('aside')
 const rect = { left:40, top:120, right:200, bottom:160 }, commands = [], saved = [], listeners = new Map()
 let covered = options.initial === 'covered', paints = 0, scrolls = 0, scrollFrame, pressed, activations = 0, foreignActivations = 0
 if (options.initial === 'disabled') original.disabled = true
 if (options.initial === 'duplicate') original.after(original.cloneNode(true))
 const current = () => document.querySelector('.version-history button')
 const change = kind => {
  if (kind === 'replace') original.replaceWith(original.cloneNode(true))
  if (kind === 'cover') covered = true
  if (kind === 'move-within-point') { rect.left += 2; rect.right += 2 }
 }
 window.Element.prototype.getBoundingClientRect = function () {
  const r = this.matches('button') || this === banner && covered ? rect : { left:0, top:0, right:560, bottom:900 }
  return { ...r, x:r.left, y:r.top, width:r.right-r.left, height:r.bottom-r.top }
 }
 window.Element.prototype.scrollIntoView = function () {
  assert.equal(this, original); scrollFrame = paints; scrolls++
  if (options.overlayOnSecondScroll && scrolls === 2) covered = true
 }
 document.elementFromPoint = (x, y) => {
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null
  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return covered ? banner : current()
  return document.body
 }
 window.requestAnimationFrame = callback => {
  paints++
  if (options.moveDuringPrepare && paints === 3) { rect.top = 100; rect.bottom = 140 }
  callback(paints * 16); return paints
 }
 const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
 document.addEventListener = (type, callback, settings) => {
  if (['mousedown','mouseup','click'].includes(type)) listeners.set(type, callback)
  add(type, callback, settings)
 }
 document.removeEventListener = (type, callback, settings) => {
  if (listeners.get(type) === callback) listeners.delete(type)
  remove(type, callback, settings)
 }
 const emit = (type, params, target, isTrusted = true) => {
  for (const [observedType, listener] of listeners) if (observedType === type)
   listener({ type, target, isTrusted, button:0, clientX:params.x, clientY:params.y, timeStamp:paints * 16 })
 }
 const evaluate = async expression => {
  if (expression.includes('"action":"arm"')) change(options.beforeArm)
  const value = await window.eval(expression)
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
 }
 const cdp = { async send(method, params) {
  assert.equal(method, 'Input.dispatchMouseEvent'); commands.push(structuredClone(params))
  const hit = document.elementFromPoint(params.x, params.y)
  if (params.type === 'mousePressed') {
   pressed = hit; emit('mousedown', params, hit); change(options.afterPress)
   if (options.pressError) throw Error('press transport outcome unknown')
  } else if (params.type === 'mouseReleased') {
   emit('mouseup', params, hit)
   if (hit && hit === pressed && options.clickMode !== 'missing') {
    if (options.clickMode === 'untrusted') hit.dispatchEvent(new window.MouseEvent('click', { bubbles:true, clientX:params.x, clientY:params.y, button:0 }))
    else if (options.clickMode === 'document-target') emit('click', params, document)
    else {
     emit('click', params, hit)
     if (hit === original) activations++; else foreignActivations++
     if (options.removeAfterClick) original.remove()
    }
   }
   pressed = null
  } else assert.fail('Unexpected native input type')
 } }
 const until = async (...args) => {
  assert.equal(args.length, 2, 'Retain the driver default budget instead of injecting a longer timeout')
  let last
  for (let index = 0; index < 8; index++) {
   try { const value = await args[0](); if (value) return value } catch (error) { last = error }
  }
  throw Error(args[1] + (last ? ': ' + last.message : ''))
 }
 const record = {}, checkpoint = () => saved.push(structuredClone(record))
 return { record, saved, commands, evaluate, cdp, until, checkpoint, window,
  run:() => clickHistoryButton({ evaluate, cdp, until, record, checkpoint }, '先保存当前笔记'),
  get scrolls() { return scrolls }, get scrollFrame() { return scrollFrame },
  get activations() { return activations }, get foreignActivations() { return foreignActivations },
  get listeners() { return listeners.size }, dispose:() => window.close() }
}

test('history native button waits for existing layout before its one scroll and preserves three stable frames and one trusted click', async () => {
 for (const options of [{ moveDuringPrepare:true }, { afterPress:'move-within-point' }, { removeAfterClick:true }]) {
  const h = historyButtonContract(options)
  try {
   await h.run()
   assert.equal(h.scrolls, 1); assert.equal(h.scrollFrame, 2)
   assert.equal(h.record.preparation.stableFrames.length, 3)
   assert.ok(h.record.preparation.stableFrames.every(frame => frame.sameTarget && frame.enabled && frame.exposed))
   assert.deepEqual(h.record.point, { x:120, y:options.moveDuringPrepare ? 120 : 140 })
   assert.deepEqual(h.commands, ['mousePressed','mouseReleased'].map(type => ({ type, ...h.record.point, button:'left', clickCount:1 })))
   assert.deepEqual(h.record.afterRelease.events.map(event => event.type), ['mousedown','mouseup','click'])
   assert.equal(h.record.complete, true); assert.equal(h.activations, 1); assert.equal(h.foreignActivations, 0)
   if (options.removeAfterClick) assert.equal(h.record.afterRelease.sameTarget, false)
   assert.equal(h.listeners, 0); assert.equal(Object.hasOwn(h.window, '__desktopHistoryButtonObservation'), false)
  } finally { h.dispose() }
 }
})

test('history native button refuses ambiguity, disabled state, replacement and covered final coordinates before any press', async () => {
 for (const options of [{ initial:'duplicate' }, { initial:'disabled' }, { initial:'covered' }, { beforeArm:'replace' }, { beforeArm:'cover' }]) {
  const h = historyButtonContract(options)
  try {
   await assert.rejects(h.run())
   assert.deepEqual(h.commands, []); assert.equal(h.activations, 0); assert.equal(h.record.complete, false)
   assert.ok(h.record.error); assert.equal(h.listeners, 0); assert.equal(h.record.cleanup.cleaned, true)
   if (options.beforeArm) assert.equal(h.record.beforePress.sameTarget && h.record.beforePress.exposed, false)
  } finally { h.dispose() }
 }
})

test('history native button never releases onto a replaced or covered target and never repeats an uncertain press', async () => {
 for (const options of [{ afterPress:'replace' }, { afterPress:'cover' }, { pressError:true }]) {
  const h = historyButtonContract(options)
  try {
   await assert.rejects(h.run())
   assert.deepEqual(h.commands.map(command => command.type), ['mousePressed','mouseReleased'])
   assert.deepEqual(h.commands[1], { type:'mouseReleased', x:-1, y:-1, button:'left', clickCount:1 })
   assert.equal(h.record.cancelRelease.before.hit, null); assert.equal(h.record.cancelRelease.acknowledged, true)
   assert.equal(h.activations, 0); assert.equal(h.foreignActivations, 0); assert.equal(h.listeners, 0)
   assert.equal(h.record.releaseRequested, undefined); assert.equal(h.record.complete, false)
  } finally { h.dispose() }
 }
})

test('history native button refuses absent or untrusted click receipts and describes a non-element event target without throwing into the renderer', async () => {
 for (const clickMode of ['missing','untrusted','document-target']) {
  const h = historyButtonContract({ clickMode })
  try {
   await assert.rejects(h.run())
   assert.equal(h.commands.length, 2); assert.equal(h.record.complete, false); assert.equal(h.record.cancelRelease, undefined)
   assert.equal(h.listeners, 0); assert.equal(h.record.cleanup.cleaned, true)
   if (clickMode === 'untrusted') assert.equal(h.record.afterRelease.events.at(-1).isTrusted, false)
   if (clickMode === 'document-target') {
    assert.equal(h.record.afterRelease.events.at(-1).targetMatches, false)
    assert.equal(h.record.afterRelease.events.at(-1).target.bounds, null)
    assert.equal(h.record.afterRelease.events.at(-1).observationError, undefined)
   }
  } finally { h.dispose() }
 }
})

// Original 003054a helper body, retained only as a negative I/O witness. The
// shared click function below is read from the unchanged actual driver.
const legacyHistoryButtonSource = "async(label,scope='.version-history')=>{\n  assert.equal(await evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].filter(n=>n.textContent.trim()===${JSON.stringify(label)});if(a.length!==1||a[0].disabled)return false;a[0].scrollIntoView({block:'center'});const r=a[0].getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!a[0].contains(hit))return false;a[0].setAttribute('data-history-click','');return true})()`),true,'Missing enabled action '+label)\n  try{await click('[data-history-click]')}finally{await evaluate(\"document.querySelector('[data-history-click]')?.removeAttribute('data-history-click')\")}\n }"
test('original history double measurement loses its verified hit when a banner appears at the second scroll', async () => {
 const h = historyButtonContract({ overlayOnSecondScroll:true })
 try {
  const source = readFileSync(new URL('./check-desktop-save.mjs', import.meta.url), 'utf8')
  const body = source.match(/async function click\(selector\) \{[\s\S]*?\n\}/)
  assert.ok(body)
  const click = runInNewContext('(' + body[0] + ')', { assert, evaluate:h.evaluate, cdp:h.cdp })
  const oldButton = runInNewContext('(' + legacyHistoryButtonSource + ')', { assert, evaluate:h.evaluate, click })
  await oldButton('先保存当前笔记')
  assert.equal(h.scrolls, 2); assert.equal(h.activations, 0); assert.equal(h.foreignActivations, 1)
  assert.equal(h.commands.length, 2, 'The old driver returns without observing the wrong native click')
 } finally { h.dispose() }
})

test('history explicit save keeps the original marker predicate and default budget while retaining first and last real GET or error', async () => {
 for (const final of [{ id:'history-owned', content:'raw🙂\ncurrent-unsaved-history-guard\u0000tail' }, { id:'history-owned', content:'old exact body' }, Error('last GET failed')]) {
  const record = {}, saved = [], calls = [], first = { id:'history-owned', content:'first unchanged body' }, sequence = [first, Error('middle GET failed'), final]
  const api = async route => { calls.push(route); const value = sequence.shift(); if (value instanceof Error) throw value; return value }
  const until = async (...args) => {
   assert.equal(args.length, 2); assert.equal(args[1], 'Explicit save failed')
   let last
   for (let index=0; index<3; index++) { try { if (await args[0]()) return true } catch (error) { last=error } }
   throw Error(args[1] + (last ? ': ' + last.message : ''))
  }
  const task = waitForHistoryExplicitSave({ api, until, record, checkpoint:() => saved.push(structuredClone(record)) }, 'history-owned')
  const success = !(final instanceof Error) && final.content.includes('current-unsaved-history-guard')
  if (success) await task; else await assert.rejects(task, /Explicit save failed/)
  assert.deepEqual(calls, ['/api/files/history-owned','/api/files/history-owned','/api/files/history-owned'])
  assert.deepEqual(record.first.file, first); assert.equal(record.samples, 3); assert.equal(record.complete, success)
  if (final instanceof Error) assert.match(record.last.error, /last GET failed/)
  else assert.deepEqual(record.last.file, final)
  assert.ok(saved.some(snapshot => snapshot.last?.error?.includes('middle GET failed')))
  assert.ok(record.finishedAt)
 }
})

test('history save traffic observes only exact-note PUT identity and records missing postData without changing network or replaying input', () => {
 let listener, detached = 0, sends = 0
 const cdp = { onEvent:fn => { listener=fn; return () => { detached++; listener=null } }, send:() => { sends++; assert.fail('Passive history observer must not send protocol commands') } }
 const record = {}, observation = observeHistorySaveTraffic(cdp, record, 'history-owned'), target = 'http://127.0.0.1:27121/api/files/history-owned'
 const emit = (method, params) => listener?.({ method, params })
 for (const [id, method, url] of [['get','GET',target],['foreign','PUT',target+'-other'],['query','PUT',target+'?x=1']])
  emit('Network.requestWillBeSent', { requestId:id, request:{ method, url, postData:'ignored' } })
 const body = '{"content":"raw🙂\\nbody","expected_content":"second-history-body","save_request_id":"original-token"}'
 emit('Network.requestWillBeSent', { requestId:'owned-1', timestamp:1, request:{ method:'PUT', url:target, hasPostData:true, postData:body } })
 emit('Network.responseReceived', { requestId:'owned-1', timestamp:2, response:{ url:target, status:200, mimeType:'application/json' } })
 emit('Network.loadingFinished', { requestId:'owned-1', timestamp:3, encodedDataLength:410 })
 emit('Network.requestWillBeSent', { requestId:'owned-2', timestamp:4, request:{ method:'PUT', url:target, hasPostData:true } })
 emit('Network.loadingFailed', { requestId:'owned-2', timestamp:5, errorText:'net::ERR_FAILED', canceled:false })
 observation.close(); observation.close()
 emit('Network.requestWillBeSent', { requestId:'after-close', request:{ method:'PUT', url:target } })
 assert.equal(record.requests.length, 2); assert.equal(record.requests[0].request.postData, body)
 assert.equal(record.requests[0].response.requestId, 'owned-1'); assert.equal(record.requests[0].response.status, 200)
 assert.equal(record.requests[0].finished.requestId, 'owned-1')
 assert.equal(record.requests[1].request.postDataPresent, false); assert.equal(Object.hasOwn(record.requests[1].request, 'postData'), false)
 assert.equal(record.requests[1].failed.errorText, 'net::ERR_FAILED')
 assert.equal(detached, 1); assert.equal(sends, 0); assert.equal(record.detached, true)
})
