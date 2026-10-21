import assert from 'node:assert/strict'
import { replaceUnique, gitBlob, prepareShellVerifiedLifecycle } from './installer-shell-core.mjs'
import { HISTORY_CHECKS } from './history-installation-evidence.mjs'
export const PRODUCT='d002c8870af32eee85c4730e2db1d240a93f118a'
export const DAILY_BLOB='d45b387fbc13feeb7ca34f7d28dfc101af9ecbd0'
export const HISTORY_BLOB='c9800f23c9f924d31edb1c7f7c7c4e1a1cf851a6'
export const CURRENT=Object.freeze({version:'4.221.1',bytes:104218653,sha256:'de069090d8013bbbcc8aa076d610909b99703f1372fce22ed713cad0bfeeab6a'})
export const PREVIOUS=Object.freeze({version:'4.220.2',bytes:104211389,sha256:'6f2b6db12e9700571499c36f72290cc37af15120708add6d2eb4920c4157cd69'})
export const DAILY_CHECKS=Object.freeze(['entry-and-calendar-browsing-do-not-create','one-root-date-created-and-opened','original-editor-save-persists-daily-body','reopen-retains-id-and-saved-body','parallel-open-does-not-duplicate-or-overwrite','invalid-calendar-date-refused-by-production-server','real-committed-create-with-lost-response-is-uncertain','read-only-reconciliation-finds-same-committed-note','workspace-can-close-and-reopen','original-fixture-notes-unchanged'])
export function prepareDailyInstallation(core,original){
 assert.equal(gitBlob(core),'e9c64b370582da9b21a8ea299ef40db01eb96b0a')
 let script=prepareShellVerifiedLifecycle(original)
 script=replaceUnique(script,"which==='previous'","which==='previous' && RELEASES.previous.version==='4.218.0'")
 script=replaceUnique(script,'const ws=new WebSocket(url),pending=new Map();let next=0','const ws=new WebSocket(url),pending=new Map(),eventListeners=new Set();let next=0')
 script=replaceUnique(script,'catch{fail();return}const p=pending.get(m.id)','catch{fail();return}if(m.method)for(const listener of [...eventListeners])listener(m);const p=pending.get(m.id)')
 script=replaceUnique(script,'return {close:()=>ws.close(),send(method,params={})','return {close:()=>{eventListeners.clear();ws.close()},onEvent(listener){eventListeners.add(listener);return()=>eventListeners.delete(listener)},send(method,params={})')
 script=replaceUnique(script,'  await verifyTrashWorkspaceDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})',`  await verifyTrashWorkspaceDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})
  await verifyVersionHistoryDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})
  await verifyDailyNotesDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})
  report.moduleSources={productCommit:PRODUCT_COMMIT,history:'${HISTORY_BLOB}',daily:'${DAILY_BLOB}',testCodeOnly:true};save()`)
 script=replaceUnique(script,"  await closeApp();mark('installed-app-trash-workflow')","  await closeApp();mark('installed-app-trash-workflow');mark('installed-app-version-history-workflow');mark('installed-app-daily-notes-workflow')")
 script="import { verifyVersionHistoryDesktop } from './check-version-history-desktop.mjs'\nimport { verifyDailyNotesDesktop } from './check-daily-notes-desktop.mjs'\n"+script
 let next=replaceUnique(core,"export const PRODUCT_COMMIT = '048a9ca0f70b32fed1afc0f162e297789c781747'",`export const PRODUCT_COMMIT = '${PRODUCT}'`)
 next=replaceUnique(next,"current: Object.freeze({ version: '4.219.1', bytes: 104200796,\n    sha256: 'cc7fdda96c42ab8993c5ada71a0e1462ef5c894035609d0216cb624995fb5e5e' })",`current: Object.freeze(${JSON.stringify(CURRENT)})`)
 next=replaceUnique(next,"previous: Object.freeze({ version: '4.218.0', bytes: 104182839,\n    sha256: '0e585aad28c4569666d7ed29c927b6b3bd207571fd0e7b9400fb0fdc93c10909' })",`previous: Object.freeze(${JSON.stringify(PREVIOUS)})`)
 next=replaceUnique(next,"'installed-app-trash-workflow',","'installed-app-trash-workflow', 'installed-app-version-history-workflow', 'installed-app-daily-notes-workflow',")
 return {core:next,script}
}
export function validateInstalledDaily(report,daily,history,verifier){
 assert.match(verifier,/^[a-f0-9]{40}$/)
 assert.equal(report.productCommit,PRODUCT);assert.equal(report.verifierCommit,verifier)
 assert.equal(report.complete,true);assert.equal(report.cleanupComplete,true);assert.equal(report.forceTerminated,false)
 assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted')
 assert.equal(report.syntheticData,true);assert.equal(report.usedDefaultDataPath,true)
 assert.deepEqual(report.installers.current,CURRENT);assert.deepEqual(report.installers.previous,PREVIOUS)
 assert.deepEqual(report.moduleSources,{productCommit:PRODUCT,history:HISTORY_BLOB,daily:DAILY_BLOB,testCodeOnly:true})
 for(const key of ['installed-app-version-history-workflow','installed-app-daily-notes-workflow'])assert.equal(report.checks.filter(v=>v===key).length,1)
 for(const module of [daily,history]){
  assert.equal(module.commit,verifier);assert.equal(module.complete,true)
  for(const key of ['realPackagedApp','realBackend','syntheticData'])assert.equal(module[key],true)
 }
 assert.deepEqual(daily.checks,DAILY_CHECKS);assert.deepEqual(history.checks,HISTORY_CHECKS)
 assert.equal(daily.failureInjection.exactPostResponseOnly,true)
 assert.deepEqual(daily.failureInjection.faults,[{url:'http://127.0.0.1:27121/api/files/daily/2097-02-21',method:'POST',responseStatusCode:200}])
 assert.equal(history.failureInjection.mode,'exact-PUT-only')
 const requests=history.failureInjection.requests,blocked=requests.filter(r=>r.blocked===true)
 assert.equal(blocked.length,1);assert.equal(blocked[0].method,'PUT')
 assert.match(blocked[0].url,/^http:\/\/127\.0\.0\.1:27121\/api\/files\/[A-Za-z0-9-]+$/)
 assert.ok(requests.some(r=>r.method==='GET'&&r.url===blocked[0].url+'/versions'&&r.blocked===false))
 assert.deepEqual(daily.screenshots.map(s=>s.filename),['daily-notes-installed.png'])
 assert.deepEqual(history.screenshots.map(s=>s.filename),['version-history-restored.png','version-history-empty.png'])
 for(const image of [...daily.screenshots,...history.screenshots]){assert.ok(Number.isSafeInteger(image.bytes)&&image.bytes>0);assert.match(image.sha256,/^[a-f0-9]{64}$/)}
 return true
}
