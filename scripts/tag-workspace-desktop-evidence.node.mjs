import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,realpathSync,symlinkSync,unlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {TAG_SOURCES,TAG_CHECKS,TAG_FEEDBACK,TAG_IMAGES,TAG_REPORT,tagHash,verifyRemovedFileTagsAbsent,validateTagWorkspaceNativeReport,verifyTagWorkspaceNativeReport} from './tag-workspace-desktop-evidence.mjs'
import {buildTagWorkspaceRunner} from './prepare-tag-workspace-verifier.mjs'
// Synthetic schema/refusal fixtures only, never evidence of Windows execution.
function fixture(){
 const sources=Object.fromEntries(TAG_SOURCES.map(x=>[x,'a'.repeat(40)])),expected={product:'b'.repeat(40),verifier:'c'.repeat(40),sources}
 const launches=[100,101,102].map(pid=>({pid})),exits=launches.map(({pid})=>({pid,code:0,signal:null,normal:true}))
 const r={schemaVersion:1,module:'2F.106',version:'4.239.0',productCommit:expected.product,verifierCommit:expected.verifier,platform:'win32',runnerEnvironment:'github-hosted',scope:'installed-default-profile',defaultProfile:true,nativeAcceptance:true,syntheticData:true,realBackend:true,bridgeOverridden:false,timerAccelerated:false,complete:true,cleanupComplete:true,forcedFailureCleanup:false,backendStopped:true,storageDirectoriesRemoved:true,sourceFiles:sources,checks:[...TAG_CHECKS],app:{packaged:true,version:'4.239.0'},executableSHA256:'1'.repeat(64),asarSHA256:'2'.repeat(64),backendSHA256:'3'.repeat(64),crashes:[],launches,exits,exit:exits[2],
 installationCommands:['initial-install','same-version-install','uninstall','reinstall','final-uninstall'].map(operation=>({operation,code:0,signal:null,timedOut:false})),retention:['same-version-install','uninstall','reinstall'].map(operation=>({operation,equal:true,files:10,digest:'4'.repeat(64)})),
 feedback:Object.fromEntries(TAG_FEEDBACK.map(n=>[n,{text:'schema fixture only',role:'alert',top:300,bottom:322,left:20,right:650,areaTop:290,areaBottom:340,footerTop:350,width:704,height:481,hit:true,outsideScroll:true}])),trustedMouseInput:true,trustedKeyboardInput:true,
 pagination:{normal:51,hidden:1,total:52,pages:[50,1],unique:51,hiddenExcluded:true},guardedOpen:{freshRead:true,accepted:true,title:'fixture'},created:{id:'unused',name:'Unused',color:'#7e5bef',total:0},renamed:{id:'source',name:'Renamed',color:'#315b8c',countsPreserved:true},merge:{sourceId:'source',targetId:'target',normal:52,hidden:1,total:53,sourceRemoved:true,targetIdentityPreserved:true,cancelUnchanged:true},delete:{id:'target',allLinksRemoved:true,cancelUnchanged:true},
 quota:{error:'QuotaExceededError',keys:10,zeroRequestsWhileFull:true,unchangedBeforeRetry:true,retryAcknowledged:true},conflict:{backendRefusedStaleSnapshot:true,originalMetadataPreserved:true,recordSurvivedClose:true,reconciliationReadOnly:true,cancelKeptRecord:true},lostResponse:{status:200,stage:'response',injectedTransportFailure:true,backendCommitObserved:true,recordSurvivedClose:true,recordSurvivedRestart:true,mutationPosts:1,reconciliationReadOnly:true,noHistoricReceiptClaim:true,explicitRecordEnd:true},corruption:{explicitFixtureInjection:true,automaticOverwrite:false,cancelPreserved:true,explicitClear:true},viewport:{width:704,height:481,horizontalOverflow:false,footerReachable:true},catalog:{sha256:'5'.repeat(64),restartedEqual:true,reinstalledEqual:true},notes:{normalVerified:52,trashVerified:1,bodyWrites:0,before:'6'.repeat(64),after:'6'.repeat(64),hashes:Object.fromEntries(Array.from({length:53},(_,i)=>['note'+i,'7'.repeat(64)]))},screenshots:TAG_IMAGES.map(filename=>({filename,bytes:128,sha256:'8'.repeat(64)}))}
 r.retainedBodyObservation={method:'stopped-backend-readonly-sqlite',readOnly:true,databaseFilesUnchanged:true,normalRows:52,trashRows:1,removedTagLinks:0,removedTags:0,databaseSHA256:'9'.repeat(64),hashes:{...r.notes.hashes},originalDatabaseOpened:false,observationLocation:'verified-private-copy',snapshotVerified:true,snapshotRemoved:true,snapshotFiles:{'data.db':{bytes:8192,sha256:'9'.repeat(64)},'data.db-wal':null,'data.db-shm':null}}
 return{r,expected}
}
test('complete synthetic schema accepted only as schema',()=>{const{r,expected}=fixture();assert.equal(validateTagWorkspaceNativeReport(r,expected),true)})
const bad={
 'retainedBodyObservation.originalDatabaseOpened':true,'retainedBodyObservation.observationLocation':'original','retainedBodyObservation.snapshotVerified':false,'retainedBodyObservation.snapshotRemoved':false,'retainedBodyObservation.snapshotFiles':{},
 'retainedBodyObservation':{},'retainedBodyObservation.method':'trash-list-metadata','retainedBodyObservation.readOnly':false,'retainedBodyObservation.databaseFilesUnchanged':false,'retainedBodyObservation.trashRows':0,'retainedBodyObservation.removedTagLinks':1,'retainedBodyObservation.hashes':{},
 'module':'old','version':'4.238.0','productCommit':'e'.repeat(40),'verifierCommit':'f'.repeat(40),'platform':'linux','runnerEnvironment':'self-hosted','scope':'fake',
 'defaultProfile':false,'nativeAcceptance':false,'syntheticData':false,'realBackend':false,'complete':false,'cleanupComplete':false,'backendStopped':false,'storageDirectoriesRemoved':false,
 'bridgeOverridden':true,'timerAccelerated':true,'forcedFailureCleanup':true,'error':{},'cleanupError':'bad','sourceFiles':{},'app.packaged':false,'app.version':'4.238.0','executableSHA256':'',
 'crashes':[{}],'launches.2.pid':100,'exits.0.code':1,'installationCommands.2.code':1,'installationCommands.0.timedOut':true,'retention.0.equal':false,'retention.1.files':0,
 'pagination.hidden':0,'pagination.unique':50,'pagination.hiddenExcluded':false,'pagination.pages':[50],'guardedOpen.freshRead':false,'guardedOpen.accepted':false,
 'renamed.countsPreserved':false,'merge.normal':53,'merge.sourceRemoved':false,'merge.targetIdentityPreserved':false,'merge.cancelUnchanged':false,'delete.cancelUnchanged':false,'delete.allLinksRemoved':false,
 'quota.error':'InjectedError','quota.keys':0,'quota.zeroRequestsWhileFull':false,'quota.unchangedBeforeRetry':false,'quota.retryAcknowledged':false,
 'conflict.backendRefusedStaleSnapshot':false,'conflict.originalMetadataPreserved':false,'conflict.recordSurvivedClose':false,'conflict.reconciliationReadOnly':false,'conflict.cancelKeptRecord':false,
 'lostResponse.stage':'request','lostResponse.status':0,'lostResponse.injectedTransportFailure':false,'lostResponse.backendCommitObserved':false,'lostResponse.recordSurvivedClose':false,'lostResponse.recordSurvivedRestart':false,'lostResponse.mutationPosts':2,'lostResponse.reconciliationReadOnly':false,'lostResponse.noHistoricReceiptClaim':false,'lostResponse.explicitRecordEnd':false,
 'corruption.explicitFixtureInjection':false,'corruption.automaticOverwrite':true,'corruption.cancelPreserved':false,'corruption.explicitClear':false,
 'viewport.width':1280,'viewport.horizontalOverflow':true,'viewport.footerReachable':false,'catalog.restartedEqual':false,'catalog.reinstalledEqual':false,
 'notes.normalVerified':51,'notes.trashVerified':0,'notes.bodyWrites':1,'notes.after':'0'.repeat(64),'notes.hashes':{},'trustedMouseInput':false,'trustedKeyboardInput':false,
 'screenshots.0.filename':'../escape.png','screenshots.0.bytes':0,'screenshots.0.sha256':'',
}
for(const[key,value]of Object.entries(bad))test('refuses '+key,()=>{const{r,expected}=fixture();const keys=key.split('.');let obj=r;for(const k of keys.slice(0,-1))obj=obj[k];obj[keys.at(-1)]=value;assert.throws(()=>validateTagWorkspaceNativeReport(r,expected))})
for(const name of TAG_CHECKS)test('refuses missing workflow '+name,()=>{const{r,expected}=fixture();r.checks=r.checks.filter(x=>x!==name);assert.throws(()=>validateTagWorkspaceNativeReport(r,expected))})
for(const name of TAG_FEEDBACK){test('refuses missing feedback '+name,()=>{const{r,expected}=fixture();delete r.feedback[name];assert.throws(()=>validateTagWorkspaceNativeReport(r,expected))});test('refuses clipped feedback '+name,()=>{const{r,expected}=fixture();r.feedback[name].bottom=500;assert.throws(()=>validateTagWorkspaceNativeReport(r,expected))})}
for(const[key,value]of [['hit',false],['outsideScroll',false],['left',-10],['top',NaN],['role','unknown']])test('refuses feedback '+key,()=>{const{r,expected}=fixture();r.feedback.success[key]=value;assert.throws(()=>validateTagWorkspaceNativeReport(r,expected))})
test('external source expectations are mandatory',()=>{const{r,expected}=fixture();assert.throws(()=>validateTagWorkspaceNativeReport(r,{}));assert.throws(()=>validateTagWorkspaceNativeReport(r,{...expected,native:false}));assert.throws(()=>validateTagWorkspaceNativeReport(r,{...expected,sources:{}}))})
test('verifies actual PNG bytes rather than screenshot paths alone',()=>{const dir=mkdtempSync(path.join(tmpdir(),'tag106-contract-'));try{const{r,expected}=fixture();const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(120)]);for(const item of r.screenshots){item.sha256=tagHash(png);writeFileSync(path.join(dir,item.filename),png)}writeFileSync(path.join(dir,TAG_REPORT),JSON.stringify(r));assert.equal(verifyTagWorkspaceNativeReport(dir,expected).complete,true);writeFileSync(path.join(dir,r.screenshots[1].filename),'wrong');assert.throws(()=>verifyTagWorkspaceNativeReport(dir,expected))}finally{rmSync(dir,{recursive:true,force:true})}})
test('refuses unreviewed runner templates',()=>{assert.throws(()=>buildTagWorkspaceRunner('arbitrary runner'));assert.throws(()=>buildTagWorkspaceRunner('4.237.0'))})
test('driver exercises native inputs, real quota, real response-stage failure and no body PUT',()=>{const s=readFileSync(new URL('./tag-workspace-desktop-driver.mjs',import.meta.url),'utf8');for(const p of [/Input\.dispatchKeyEvent/,/Input\.insertText/,/Fetch\.failRequest/,/requestStage:'Response'/,/QuotaExceededError/,/reinstallWithRetainedDraft\(\)/,/bodyWritesSince/,/resizeSmall\(\)/,/assert\.equal\(posts\.length,lossPosts\+1\)/])assert.match(s,p);assert.doesNotMatch(s,/window\.electronAPI\s*=|setInterval\s*=|setTimeout\s*=|Emulation\.setDeviceMetricsOverride|method:\s*['"]PUT['"]/)})

// Real temporary SQLite files, not synthetic native execution.
import { DatabaseSync } from 'node:sqlite'
import { observeRetainedTagBodies } from './tag-workspace-retained-bodies.mjs'
function bodyDatabase(check) {
 // Windows tmpdir may use an 8.3 alias. Canonicalize our newly created fixture,
 // never weaken the observer's independent linked/redirected-path refusal.
 const directory=realpathSync.native(mkdtempSync(path.join(tmpdir(),'tag106-bodies-'))),file=path.join(directory,'data.db')
 const db=new DatabaseSync(file)
 db.exec('CREATE TABLE files(id TEXT PRIMARY KEY,content TEXT,is_deleted INTEGER);CREATE TABLE tags(id TEXT PRIMARY KEY);CREATE TABLE file_tags(file_id TEXT,tag_id TEXT)')
 const expected={files:[{id:'normal',content:'normal body',deleted:0},{id:'trash',content:'retained hidden body',deleted:1}],removedTagIds:['merged-source','deleted-target']}
 const put=db.prepare('INSERT INTO files VALUES(?,?,?)')
 for(const row of expected.files)put.run(row.id,row.content,row.deleted)
 db.close()
 try { check(directory,file,expected) } finally { rmSync(directory,{recursive:true,force:true}) }
}
test('metadata-only trash list is not a body; read-only SQLite preserves actual hidden content',()=>bodyDatabase((directory,file,expected)=>{
 const before=readFileSync(file),db=new DatabaseSync(file,{readOnly:true})
 const metadata=db.prepare("SELECT id,'' AS content FROM files WHERE is_deleted=1").get();db.close()
 assert.equal(metadata.content,'');assert.notEqual(metadata.content,expected.files[1].content)
 const observed=observeRetainedTagBodies(directory,expected)
 assert.equal(observed.bodies.trash,'retained hidden body');assert.equal(observed.evidence.trashRows,1)
 assert.equal(observed.evidence.databaseFilesUnchanged,true);assert.deepEqual(readFileSync(file),before)
}))
for(const [name,[sql,reason]] of Object.entries({
 'changed hidden body':["UPDATE files SET content='' WHERE id='trash'",/Retained body changed: trash/],
 'removed hidden row':["DELETE FROM files WHERE id='trash'",/Retained note missing: trash/],
 'restored trash state':["UPDATE files SET is_deleted=0 WHERE id='trash'",/Retained trash state changed: trash/],
 'left hidden association':["INSERT INTO file_tags VALUES('trash','deleted-target')",/Removed tag links remain/],
 'left removed tag':["INSERT INTO tags VALUES('merged-source')",/Removed tag remains/],
 'changed normal body':["UPDATE files SET content='changed' WHERE id='normal'",/Retained body changed: normal/],
}))test('read-only observer rejects '+name,()=>bodyDatabase((directory,file,expected)=>{
 const db=new DatabaseSync(file);db.exec(sql);db.close();const before=readFileSync(file)
 assert.throws(()=>observeRetainedTagBodies(directory,expected),reason);assert.deepEqual(readFileSync(file),before)
}))
test('missing database is refused without creating one',()=>{
 const directory=realpathSync.native(mkdtempSync(path.join(tmpdir(),'tag106-missing-')))
 try{assert.throws(()=>observeRetainedTagBodies(directory,{files:[{id:'n',content:'x',deleted:0}],removedTagIds:['a','b']}),/Actual retained database missing/);assert.throws(()=>readFileSync(path.join(directory,'data.db')))}finally{rmSync(directory,{recursive:true,force:true})}
})
test('observer refuses duplicate expected rows instead of counting them twice',()=>bodyDatabase((directory,file,expected)=>{
 expected.files.push({...expected.files[0]});assert.throws(()=>observeRetainedTagBodies(directory,expected),/Duplicate expected notes/)
}))
test('canonical fixtures do not relax the linked-directory refusal',()=>bodyDatabase((directory,file,expected)=>{
 assert.equal(directory,realpathSync.native(directory))
 const link=directory+'-link',before=readFileSync(file)
 symlinkSync(directory,link,process.platform==='win32'?'junction':'dir')
 try{assert.throws(()=>observeRetainedTagBodies(link,expected),/Linked data directory refused/);assert.deepEqual(readFileSync(file),before)}finally{unlinkSync(link)}
}))
test('native runner closes owned app and backend before read-only evidence',()=>{
 const prepared=new URL('../test-results/installer-lifecycle/appearance-preparation/run-draft-durability-desktop.mjs.before.txt',import.meta.url)
 const original=readFileSync(existsSync(prepared)?prepared:new URL('./run-draft-durability-desktop.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n')
 const runner=buildTagWorkspaceRunner(original)
 assert.match(runner,/readRetainedTagBodies: async expected => \{\s*assert.equal\(alive\(app\), false/)
 assert.match(runner,/await stopped\(\)\s*return observeRetainedTagBodies\(data, expected\)/)
 const driver=readFileSync(new URL('./tag-workspace-desktop-driver.mjs',import.meta.url),'utf8')
 assert.match(driver,/await closeNormally\(\);report.exits.push\(\{\.\.\.report.exit\}\);save\(\)\s*const observed=await ctx.readRetainedTagBodies/)
 assert.doesNotMatch(driver,/assert.equal\(hidden.content|method:\s*['"]POST['"][^\n]*restore/)
})

for(const [name,tags] of [['nil-empty',null],['array-empty',[]],['unrelated',[{id:'other'}]]])test('file tag observation accepts '+name,()=>{
 assert.equal(verifyRemovedFileTagsAbsent(tags,['source','target']),true)
})
for(const [name,tags] of [['missing',undefined],['object',{}],['text',''],['number',0],['false',false],['null-row',[null]],['missing-id',[{}]],['empty-id',[{id:''}]],['number-id',[{id:1}]]])test('file tag observation refuses '+name,()=>{
 assert.throws(()=>verifyRemovedFileTagsAbsent(tags,['source','target']),/Unexpected file tags response|Invalid file tag row/)
})
for(const id of ['source','target'])test('file tag observation refuses retained '+id,()=>{
 assert.throws(()=>verifyRemovedFileTagsAbsent([{id}],['source','target']),/Removed tag links remain in API/)
})
test('file tag observation requires distinct removed identities',()=>{
 assert.throws(()=>verifyRemovedFileTagsAbsent(null,['source','source']),/Invalid removed tag identities/)
})

function originalDatabaseBytes(directory) {
 return Object.fromEntries(['data.db','data.db-wal','data.db-shm'].map(name=>{const f=path.join(directory,name);return[name,existsSync(f)?readFileSync(f):null]}))
}
test('read-only WAL observation does not create sidecars in the original profile',()=>bodyDatabase((directory,file,expected)=>{
 const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL');db.close()
 const before=originalDatabaseBytes(directory)
 assert.equal(before['data.db-wal'],null);assert.equal(before['data.db-shm'],null)
 const observed=observeRetainedTagBodies(directory,expected)
 assert.equal(observed.evidence.originalDatabaseOpened,false)
 assert.equal(observed.evidence.snapshotVerified,true);assert.equal(observed.evidence.snapshotRemoved,true)
 assert.equal(observed.evidence.observationLocation,'verified-private-copy')
 assert.deepEqual(originalDatabaseBytes(directory),before)
}))
test('private observation retains committed WAL content instead of reading only the main file',()=>bodyDatabase((directory,file,expected)=>{
 execFileSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec("PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;PRAGMA wal_checkpoint(TRUNCATE);UPDATE files SET content='committed WAL body' WHERE id='trash'");process.exit(0)`,file])
 const before=originalDatabaseBytes(directory)
 assert.ok(before['data.db-wal']?.length>32,'Fixture must actually retain committed WAL bytes')
 expected.files[1].content='committed WAL body'
 const observed=observeRetainedTagBodies(directory,expected)
 assert.equal(observed.bodies.trash,'committed WAL body')
 assert.equal(observed.evidence.snapshotFiles['data.db-wal'].sha256,tagHash(before['data.db-wal']))
 assert.deepEqual(originalDatabaseBytes(directory),before)
}))
test('WAL-backed changed hidden content still fails its body invariant',()=>bodyDatabase((directory,file,expected)=>{
 execFileSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec("PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;PRAGMA wal_checkpoint(TRUNCATE);UPDATE files SET content='unexpected WAL content' WHERE id='trash'");process.exit(0)`,file])
 const before=originalDatabaseBytes(directory);assert.ok(before['data.db-wal']?.length>32)
 assert.throws(()=>observeRetainedTagBodies(directory,expected),/Retained body changed: trash/)
 assert.deepEqual(originalDatabaseBytes(directory),before)
}))
test('an unhandled rollback journal is refused rather than silently omitted',()=>bodyDatabase((directory,file,expected)=>{
 writeFileSync(path.join(directory,'data.db-journal'),'fixture')
 const before=originalDatabaseBytes(directory)
 assert.throws(()=>observeRetainedTagBodies(directory,expected),/Unexpected rollback journal/)
 assert.deepEqual(originalDatabaseBytes(directory),before)
}))
