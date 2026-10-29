import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {RECOVERY_SOURCES,RECOVERY_CHECKS,RECOVERY_IMAGES,RECOVERY_FEEDBACK,RECOVERY_REPORT,recoveryHash,validateRecoveryNativeReport,verifyRecoveryNativeReport} from './trash-recovery-desktop-evidence.mjs'
import {buildTrashRecoveryRunner} from './prepare-trash-recovery-verifier.mjs'
import {adaptRetained112,RETAINED_112} from './prepare-retained-local-modules-2f112.mjs'
// These deliberately synthetic refusal fixtures are not native execution evidence.
function fixture(){
 const r={"schemaVersion":1,"module":"2F.112","version":"4.245.0","productCommit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","verifierCommit":"cccccccccccccccccccccccccccccccccccccccc","platform":"win32","runnerEnvironment":"github-hosted","scope":"installed-default-profile","defaultProfile":true,"nativeAcceptance":true,"syntheticData":true,"realBackend":true,"complete":true,"cleanupComplete":true,"backendStopped":true,"storageDirectoriesRemoved":true,"bridgeOverridden":false,"timerAccelerated":false,"forcedFailureCleanup":false,"sourceFiles":{},"checks":[],"app":{"packaged":true,"version":"4.245.0"},"executableSHA256":"1111111111111111111111111111111111111111111111111111111111111111","asarSHA256":"2222222222222222222222222222222222222222222222222222222222222222","backendSHA256":"3333333333333333333333333333333333333333333333333333333333333333","crashes":[],"launches":[{"pid":100},{"pid":101},{"pid":102}],"exits":[{"pid":100,"code":0,"signal":null,"normal":true},{"pid":101,"code":0,"signal":null,"normal":true},{"pid":102,"code":0,"signal":null,"normal":true}],"exit":{"pid":102,"code":0,"signal":null,"normal":true},"installationCommands":[{"operation":"initial-install","code":0,"signal":null,"timedOut":false},{"operation":"same-version-install","code":0,"signal":null,"timedOut":false},{"operation":"uninstall","code":0,"signal":null,"timedOut":false},{"operation":"reinstall","code":0,"signal":null,"timedOut":false},{"operation":"final-uninstall","code":0,"signal":null,"timedOut":false}],"retention":[{"operation":"same-version-install","equal":true,"files":14,"digest":"4444444444444444444444444444444444444444444444444444444444444444"},{"operation":"uninstall","equal":true,"files":14,"digest":"4444444444444444444444444444444444444444444444444444444444444444"},{"operation":"reinstall","equal":true,"files":14,"digest":"4444444444444444444444444444444444444444444444444444444444444444"}],"feedback":{},"trustedMouseInput":true,"trustedKeyboardInput":true,"inventory":{"trashNotes":53,"trashFolders":2,"templateExcluded":true,"themeUnchanged":true,"typeFilterFolders":2},"pagination":{"pages":[50,1],"unique":51,"selectionRetained":true},"open":{"originalGuard":true,"freshRead":true,"accepted":true},"preview":{"cancelZeroPost":true,"selectionRetained":true},"batch":{"ids":["note0","note1"],"parentId":"source","posts":1,"oldOrderPreserved":true},"target":{"id":"note2","parentId":"destination","originalRefusedWithoutPost":true,"deletedParentRemains":true},"tree":{"ids":["tree","nested","note3"],"nestedId":"nested","leafId":"note3","parentId":"tree","allRestored":true,"descendantParentsPreserved":true},"refusals":{"ancestorSelectionZeroPost":true,"collisionZeroPost":true,"existingContentNotOverwritten":true},"quota":{"error":"QuotaExceededError","keys":20,"zeroPostWhileFull":true,"unchangedBeforeRetry":true,"explicitRetryAcknowledged":true},"conflict":{"backendRefused":true,"deletedStateUnchanged":true,"readonlyReconciliation":true,"notHistoricalReceipt":true,"cancelKeepsRecord":true,"explicitClear":true},"readFailure":{"networkInjection":true,"noPartial":true,"retryPassed":true},"readCancel":{"heldRead":true,"noPartial":true,"noLateAdoption":true},"corrupt":{"explicitTestInjection":true,"cancelPreserved":true,"clearConfirmed":true,"zeroPost":true},"viewport":{"width":704,"height":455,"horizontalOverflow":false,"footerVisible":true,"confirmationVisible":true},"lost":{"responseStatus":200,"injectedTransportFailure":true,"backendCommitted":true,"recordSurvivedRestart":true,"readonly":true,"postCount":1,"notHistoricalReceipt":true,"explicitClear":true},"catalog":{"restartedEqual":true,"reinstalledEqual":true,"revision":"6666666666666666666666666666666666666666666666666666666666666666","sha256":"5555555555555555555555555555555555555555555555555555555555555555","bytes":2000,"filename":"recovery112-catalog.json"},"retainedBodyObservation":{"method":"stopped-backend-readonly-sqlite","readOnly":true,"originalDatabaseOpened":false,"databaseFilesUnchanged":true,"observationLocation":"verified-private-copy","snapshotVerified":true,"snapshotRemoved":true,"normalRows":9,"trashRows":47,"databaseSHA256":"9999999999999999999999999999999999999999999999999999999999999999","snapshotFiles":{"data.db":{"bytes":8192,"sha256":"9999999999999999999999999999999999999999999999999999999999999999"},"data.db-wal":null,"data.db-shm":null},"hashes":{}},"notes":{"count":56,"hashes":{},"tagsEqual":true,"normalRows":9,"trashRows":47},"uiRequests":{"restorePosts":6,"bodyWrites":0,"unexpectedMutations":0},"restoredIds":["note0","note1","note2","tree","nested","note3","note4","note5"],"remainingTrashId":"note6","templateId":"note55","screenshots":[]}
 const sources=Object.fromEntries(RECOVERY_SOURCES.map(f=>[f,'a'.repeat(40)])),expected={product:r.productCommit,verifier:r.verifierCommit,sources};r.sourceFiles=sources;r.checks=[...RECOVERY_CHECKS];r.notes.hashes=Object.fromEntries(Array.from({length:56},(_,i)=>['note'+i,'7'.repeat(64)]));r.retainedBodyObservation.hashes={...r.notes.hashes};r.screenshots=RECOVERY_IMAGES.map(filename=>({filename,bytes:128,sha256:'0'.repeat(64)}));r.feedback=Object.fromEntries(RECOVERY_FEEDBACK.map(name=>[name,{text:'synthetic schema fixture',role:'status',top:100,bottom:122,left:20,right:650,areaTop:90,areaBottom:140,footerTop:150,width:704,height:455,hit:true,outsideScroll:true,statusText:name==='success'?'本机数据库已确认整批恢复':''}]));return{r,expected}}
test('complete synthetic report schema, not native execution',()=>{const{r,expected}=fixture();assert.equal(validateRecoveryNativeReport(r,expected),true)})
const mutations={
 "defaultProfile": false,
 "nativeAcceptance": false,
 "syntheticData": false,
 "realBackend": false,
 "complete": false,
 "cleanupComplete": false,
 "backendStopped": false,
 "storageDirectoriesRemoved": false,
 "bridgeOverridden": true,
 "timerAccelerated": true,
 "forcedFailureCleanup": true,
 "app.packaged": false,
 "exit.normal": false,
 "trustedMouseInput": false,
 "trustedKeyboardInput": false,
 "inventory.templateExcluded": false,
 "inventory.themeUnchanged": false,
 "pagination.selectionRetained": false,
 "open.originalGuard": false,
 "open.freshRead": false,
 "open.accepted": false,
 "preview.cancelZeroPost": false,
 "preview.selectionRetained": false,
 "batch.oldOrderPreserved": false,
 "target.originalRefusedWithoutPost": false,
 "target.deletedParentRemains": false,
 "tree.allRestored": false,
 "tree.descendantParentsPreserved": false,
 "refusals.ancestorSelectionZeroPost": false,
 "refusals.collisionZeroPost": false,
 "refusals.existingContentNotOverwritten": false,
 "quota.zeroPostWhileFull": false,
 "quota.unchangedBeforeRetry": false,
 "quota.explicitRetryAcknowledged": false,
 "conflict.backendRefused": false,
 "conflict.deletedStateUnchanged": false,
 "conflict.readonlyReconciliation": false,
 "conflict.notHistoricalReceipt": false,
 "conflict.cancelKeepsRecord": false,
 "conflict.explicitClear": false,
 "readFailure.networkInjection": false,
 "readFailure.noPartial": false,
 "readFailure.retryPassed": false,
 "readCancel.heldRead": false,
 "readCancel.noPartial": false,
 "readCancel.noLateAdoption": false,
 "corrupt.explicitTestInjection": false,
 "corrupt.cancelPreserved": false,
 "corrupt.clearConfirmed": false,
 "corrupt.zeroPost": false,
 "viewport.horizontalOverflow": true,
 "viewport.footerVisible": false,
 "viewport.confirmationVisible": false,
 "lost.injectedTransportFailure": false,
 "lost.backendCommitted": false,
 "lost.recordSurvivedRestart": false,
 "lost.readonly": false,
 "lost.notHistoricalReceipt": false,
 "lost.explicitClear": false,
 "catalog.restartedEqual": false,
 "catalog.reinstalledEqual": false,
 "retainedBodyObservation.readOnly": false,
 "retainedBodyObservation.originalDatabaseOpened": true,
 "retainedBodyObservation.databaseFilesUnchanged": false,
 "retainedBodyObservation.snapshotVerified": false,
 "retainedBodyObservation.snapshotRemoved": false,
 "notes.tagsEqual": false,
 "version": "4.244.0",
 "module": "old",
 "productCommit": "dddddddddddddddddddddddddddddddddddddddd",
 "verifierCommit": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
 "platform": "linux",
 "runnerEnvironment": "self-hosted",
 "scope": "custom",
 "error": {},
 "cleanupError": "bad",
 "sourceFiles": {},
 "app.version": "4.244.0",
 "executableSHA256": "",
 "asarSHA256": "",
 "backendSHA256": "",
 "crashes": [
  {}
 ],
 "launches.2.pid": 100,
 "exits.0.code": 1,
 "installationCommands.1.code": 1,
 "installationCommands.0.timedOut": true,
 "retention.0.equal": false,
 "retention.1.files": 0,
 "inventory.trashNotes": 52,
 "inventory.trashFolders": 1,
 "pagination.pages": [
  51
 ],
 "pagination.unique": 50,
 "batch.ids": [
  "x",
  "x"
 ],
 "batch.posts": 2,
 "batch.parentId": "",
 "target.id": "",
 "target.parentId": "",
 "tree.ids": [],
 "tree.parentId": "",
 "tree.nestedId": "",
 "tree.leafId": "",
 "quota.error": "simulated",
 "quota.keys": 0,
 "viewport.width": 1280,
 "viewport.height": 600,
 "lost.responseStatus": 500,
 "lost.postCount": 2,
 "catalog.revision": "",
 "catalog.filename": "../else.json",
 "catalog.bytes": 0,
 "retainedBodyObservation.observationLocation": "original",
 "retainedBodyObservation.method": "live-db",
 "retainedBodyObservation.snapshotFiles": {},
 "retainedBodyObservation.normalRows": 8,
 "retainedBodyObservation.trashRows": 0,
 "retainedBodyObservation.hashes": {},
 "notes.count": 55,
 "notes.normalRows": 8,
 "notes.trashRows": 0,
 "notes.hashes": {},
 "uiRequests.restorePosts": 7,
 "uiRequests.bodyWrites": 1,
 "uiRequests.unexpectedMutations": 1,
 "restoredIds": [],
 "remainingTrashId": "",
 "templateId": "",
 "screenshots.0.filename": "../escape.png",
 "screenshots.1.bytes": 0
}
for(const[key,value]of Object.entries(mutations))test('refuses '+key,()=>{const{r,expected}=fixture();const keys=key.split('.');let o=r;for(const k of keys.slice(0,-1))o=o[k];o[keys.at(-1)]=value;assert.throws(()=>validateRecoveryNativeReport(r,expected))})
for(const name of RECOVERY_CHECKS)test('refuses missing workflow '+name,()=>{const{r,expected}=fixture();r.checks=r.checks.filter(x=>x!==name);assert.throws(()=>validateRecoveryNativeReport(r,expected))})
for(const name of RECOVERY_FEEDBACK){for(const[k,v]of [['bottom',500],['hit',false],['outsideScroll',false],['statusText',undefined]])test('refuses '+name+' feedback '+k,()=>{const{r,expected}=fixture();r.feedback[name][k]=v;assert.throws(()=>validateRecoveryNativeReport(r,expected))});if(name!=='success')test('refuses stale success status '+name,()=>{const{r,expected}=fixture();r.feedback[name].statusText='本机数据库已确认整批恢复';assert.throws(()=>validateRecoveryNativeReport(r,expected))})}
for(const[k,v]of [['top',NaN],['left',-1],['right',900],['role','unknown']])test('refuses feedback '+k,()=>{const{r,expected}=fixture();r.feedback.ready[k]=v;assert.throws(()=>validateRecoveryNativeReport(r,expected))})
test('sources and native mode must be independently supplied',()=>{const{r,expected}=fixture();for(const x of [{},{...expected,native:false},{...expected,sources:{}}])assert.throws(()=>validateRecoveryNativeReport(r,x))})
test('changed process owner and unreviewed retained source refused',()=>{assert.throws(()=>buildTrashRecoveryRunner('arbitrary'));for(const f of Object.keys(RETAINED_112))assert.throws(()=>adaptRetained112(f,'4.243.0'));assert.throws(()=>adaptRetained112('unlisted',''))})
test('original input, actual quota, response-stage loss and read-only observations',()=>{const s=readFileSync(new URL('./trash-recovery-desktop-driver.mjs',import.meta.url),'utf8');for(const p of [/Input\.dispatchKeyEvent/,/Input\.insertText/,/QuotaExceededError/,/Fetch\.failRequest/,/requestStage:'Response'/,/Fetch\.continueRequest/,/reinstallWithRetainedDraft\(\)/,/readRetainedTagBodies/,/resizeSmall\(\)/,/assert\.deepEqual\(await snapshot\(\),beforeRestart\)/])assert.match(s,p);assert.doesNotMatch(s,/window\.electronAPI\s*=|setTimeout\s*=|setInterval\s*=|Emulation\.setDeviceMetricsOverride|UPDATE files|db\.exec/)})
test('preparer reads preceding process owner, not its own absent output',()=>{const s=readFileSync(new URL('./prepare-trash-recovery-verifier.mjs',import.meta.url),'utf8');assert.match(s,/source=read\('scripts\/run-folder-workspace-desktop-generated\.mjs'\)/);assert.doesNotMatch(s,/source=read\('scripts\/run-trash-recovery-desktop-generated\.mjs'\)/)})
test('actual file witnesses reject corrupt bytes, fabricated restored flag, changed parent and missing source',()=>{
 const out=mkdtempSync(path.join(tmpdir(),'recovery112-contract-'));try{const{r,expected}=fixture(),png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(120)]);for(const x of r.screenshots){x.sha256=recoveryHash(png);writeFileSync(path.join(out,x.filename),png)}
 const items=[...Object.keys(r.notes.hashes).map(id=>({id,title:id,parent_id:'source',is_deleted:!r.restoredIds.includes(id)&&id!==r.templateId,deleted_at:r.restoredIds.includes(id)?0:1})),{id:'tree',title:'tree',parent_id:'',is_deleted:false,deleted_at:0},{id:'nested',title:'nested',parent_id:'tree',is_deleted:false,deleted_at:0}];items.find(n=>n.id===r.target.id).parent_id=r.target.parentId;items.find(n=>n.id===r.tree.leafId).parent_id=r.tree.nestedId;const catalog={version:1,complete:true,revision:r.catalog.revision,items}
 const save=()=>{const b=Buffer.from(JSON.stringify(catalog));r.catalog.bytes=b.length;r.catalog.sha256=recoveryHash(b);writeFileSync(path.join(out,r.catalog.filename),b);writeFileSync(path.join(out,RECOVERY_REPORT),JSON.stringify(r))};save();assert.equal(verifyRecoveryNativeReport(out,expected).complete,true)
 const f=path.join(out,r.catalog.filename),original=readFileSync(f);writeFileSync(f,'{}');assert.throws(()=>verifyRecoveryNativeReport(out,expected));writeFileSync(f,original)
 const row=catalog.items.find(n=>n.id==='note0');row.is_deleted=true;save();assert.throws(()=>verifyRecoveryNativeReport(out,expected));row.is_deleted=false;row.parent_id='wrong';save();assert.throws(()=>verifyRecoveryNativeReport(out,expected));row.parent_id='source';catalog.items=catalog.items.filter(n=>n.id!=='note54');save();assert.throws(()=>verifyRecoveryNativeReport(out,expected));writeFileSync(path.join(out,r.screenshots[0].filename),'bad');assert.throws(()=>verifyRecoveryNativeReport(out,expected))
 }finally{rmSync(out,{recursive:true,force:true})}
})
