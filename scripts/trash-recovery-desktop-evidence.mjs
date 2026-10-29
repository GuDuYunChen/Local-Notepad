import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
export const RECOVERY_REPORT='trash-recovery-desktop.json'
export const recoveryHash=value=>createHash('sha256').update(value).digest('hex')
export const recoveryBlob=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex')
export const RECOVERY_SOURCES=Object.freeze(['src/services/trashRecovery.mjs','src/components/TrashRecovery.jsx','src/components/TrashRecovery.css','src/components/SettingsPanel.jsx','src/hooks/useGuardedNoteOpener.js','src/components/TextEditor.jsx','src/services/editorSaveTransaction.mjs','src/services/editorDraftCache.js','src/services/editorQuit.mjs','server/internal/dao/trash_recovery.go','server/internal/controller/trash_recovery.go','server/internal/controller/file.go','scripts/trash-recovery-desktop-driver.mjs','scripts/trash-recovery-desktop-evidence.mjs','scripts/prepare-trash-recovery-verifier.mjs','scripts/run-trash-recovery-desktop-generated.mjs','scripts/tag-workspace-retained-bodies.mjs','scripts/appearance-installer-core.mjs','scripts/desktop-window-session.mjs','scripts/desktop-window-worker.ps1','scripts/desktop-window-target.mjs','scripts/local-export-directory-session.mjs','scripts/local-export-directory-worker.ps1'])
export const RECOVERY_CHECKS=Object.freeze(["settings-entry-and-complete-saved-trash", "same-snapshot-cross-page-selection", "frozen-batch-preview-cancel-without-write", "atomic-two-note-original-location-restore", "recovered-note-through-original-save-guard", "unavailable-original-parent-explicit-target", "whole-deleted-subtree-restored-together", "mixed-roots-and-name-collision-refused", "durable-intent-quota-refuses-send-and-retries", "stale-revision-refusal-and-readonly-reconciliation", "read-failure-explicit-retry-no-partial-data", "cancelled-read-does-not-adopt-late-results", "corrupt-intent-explicit-confirmed-clear", "minimum-window-preview-and-feedback-visible", "committed-response-loss-keeps-durable-intent", "restart-readonly-reconciliation-without-replay", "installation-retains-restored-state-and-data", "all-bodies-tags-and-other-records-preserved"])
export const RECOVERY_IMAGES=Object.freeze(["recovery112-overview.png", "recovery112-confirm.png", "recovery112-restored.png", "recovery112-target.png", "recovery112-refusal.png", "recovery112-quota.png", "recovery112-conflict.png", "recovery112-small.png", "recovery112-recovery.png", "recovery112-reinstalled.png"])
export const RECOVERY_FEEDBACK=Object.freeze(["ready", "confirm", "success", "refusal", "treeConfirm", "quota", "conflict", "cancel", "small", "recovery"])
const hash=value=>assert.match(value||'',/^[a-f0-9]{64}$/),sha=value=>assert.match(value||'',/^[a-f0-9]{40}$/)
export function validateRecoveryNativeReport(r,{product,verifier,sources,native=true}={}){
 assert.equal(native,true);sha(product);sha(verifier)
 assert.equal(r.schemaVersion,1);assert.equal(r.module,'2F.112');assert.equal(r.version,'4.245.0');assert.equal(r.productCommit,product);assert.equal(r.verifierCommit,verifier)
 assert.equal(r.platform,'win32');assert.equal(r.runnerEnvironment,'github-hosted');assert.equal(r.scope,'installed-default-profile')
 for(const key of ['defaultProfile','nativeAcceptance','syntheticData','realBackend','complete','cleanupComplete','backendStopped','storageDirectoriesRemoved','trustedMouseInput','trustedKeyboardInput'])assert.equal(r[key],true,key)
 for(const key of ['bridgeOverridden','timerAccelerated','forcedFailureCleanup'])assert.equal(r[key],false,key)
 assert.equal(r.error,undefined);assert.equal(r.cleanupError,undefined);assert.deepEqual(r.crashes,[])
 assert.deepEqual(Object.keys(sources||{}).sort(),[...RECOVERY_SOURCES].sort());for(const value of Object.values(sources))sha(value);assert.deepEqual(r.sourceFiles,sources)
 assert.deepEqual(r.checks,RECOVERY_CHECKS);assert.equal(r.app.packaged,true);assert.equal(r.app.version,r.version);for(const k of ['executableSHA256','asarSHA256','backendSHA256'])hash(r[k])
 assert.equal(r.launches.length,3);assert.equal(r.exits.length,3);assert.equal(new Set(r.launches.map(x=>x.pid)).size,3);for(const[i,x]of r.launches.entries()){assert.ok(Number.isSafeInteger(x.pid)&&x.pid>0);assert.deepEqual(r.exits[i],{pid:x.pid,code:0,signal:null,normal:true})}assert.deepEqual(r.exit,r.exits.at(-1))
 assert.deepEqual(r.installationCommands.map(x=>x.operation),['initial-install','same-version-install','uninstall','reinstall','final-uninstall']);for(const x of r.installationCommands){assert.equal(x.code,0);assert.equal(x.signal,null);assert.equal(x.timedOut,false)}
 assert.deepEqual(r.retention.map(x=>x.operation),['same-version-install','uninstall','reinstall']);for(const x of r.retention){assert.equal(x.equal,true);assert.ok(Number.isSafeInteger(x.files)&&x.files>0);hash(x.digest)}
 assert.deepEqual(r.inventory,{trashNotes:53,trashFolders:2,templateExcluded:true,themeUnchanged:true,typeFilterFolders:2})
 assert.deepEqual(r.pagination,{pages:[50,1],unique:51,selectionRetained:true});assert.deepEqual(r.open,{originalGuard:true,freshRead:true,accepted:true})
 assert.deepEqual(r.preview,{cancelZeroPost:true,selectionRetained:true});assert.equal(r.batch.ids.length,2);assert.equal(new Set(r.batch.ids).size,2);assert.ok(r.batch.parentId);assert.equal(r.batch.posts,1);assert.equal(r.batch.oldOrderPreserved,true)
 assert.ok(r.target.id);assert.ok(r.target.parentId);assert.equal(r.target.originalRefusedWithoutPost,true);assert.equal(r.target.deletedParentRemains,true)
 assert.equal(r.tree.ids.length,3);assert.equal(new Set(r.tree.ids).size,3);for(const k of ['nestedId','leafId','parentId'])assert.ok(r.tree[k]);assert.equal(r.tree.allRestored,true);assert.equal(r.tree.descendantParentsPreserved,true)
 assert.deepEqual(r.refusals,{ancestorSelectionZeroPost:true,collisionZeroPost:true,existingContentNotOverwritten:true})
 assert.equal(r.quota.error,'QuotaExceededError');assert.ok(r.quota.keys>0);assert.equal(r.quota.zeroPostWhileFull,true);assert.equal(r.quota.unchangedBeforeRetry,true);assert.equal(r.quota.explicitRetryAcknowledged,true)
 assert.deepEqual(r.conflict,{backendRefused:true,deletedStateUnchanged:true,readonlyReconciliation:true,notHistoricalReceipt:true,cancelKeepsRecord:true,explicitClear:true})
 assert.deepEqual(r.readFailure,{networkInjection:true,noPartial:true,retryPassed:true});assert.deepEqual(r.readCancel,{heldRead:true,noPartial:true,noLateAdoption:true})
 assert.deepEqual(r.corrupt,{explicitTestInjection:true,cancelPreserved:true,clearConfirmed:true,zeroPost:true})
 assert.ok(r.viewport.width>0&&r.viewport.width<=720&&r.viewport.height>0&&r.viewport.height<=520);assert.equal(r.viewport.horizontalOverflow,false);assert.equal(r.viewport.footerVisible,true);assert.equal(r.viewport.confirmationVisible,true)
 assert.deepEqual(r.lost,{responseStatus:200,injectedTransportFailure:true,backendCommitted:true,recordSurvivedRestart:true,readonly:true,postCount:1,notHistoricalReceipt:true,explicitClear:true})
 assert.equal(r.catalog.restartedEqual,true);assert.equal(r.catalog.reinstalledEqual,true);hash(r.catalog.revision);hash(r.catalog.sha256);assert.ok(r.catalog.bytes>100&&r.catalog.bytes<2097152);assert.equal(r.catalog.filename,'recovery112-catalog.json')
 assert.equal(r.uiRequests.restorePosts,6);assert.equal(r.uiRequests.bodyWrites,0);assert.equal(r.uiRequests.unexpectedMutations,0)
 assert.equal(r.restoredIds.length,8);assert.equal(new Set(r.restoredIds).size,8);assert.ok(r.remainingTrashId);assert.ok(r.templateId)
 assert.equal(r.notes.count,56);assert.equal(r.notes.normalRows,9);assert.equal(r.notes.trashRows,47);assert.equal(Object.keys(r.notes.hashes).length,56);for(const h of Object.values(r.notes.hashes))hash(h);assert.equal(r.notes.tagsEqual,true)
 const b=r.retainedBodyObservation;assert.equal(b.method,'stopped-backend-readonly-sqlite');assert.equal(b.readOnly,true);assert.equal(b.originalDatabaseOpened,false);assert.equal(b.databaseFilesUnchanged,true);assert.equal(b.observationLocation,'verified-private-copy');assert.equal(b.snapshotVerified,true);assert.equal(b.snapshotRemoved,true);assert.equal(b.normalRows,9);assert.equal(b.trashRows,47);hash(b.databaseSHA256);assert.deepEqual(b.hashes,r.notes.hashes)
 assert.deepEqual(Object.keys(b.snapshotFiles||{}).sort(),['data.db','data.db-shm','data.db-wal']);assert.equal(b.snapshotFiles['data.db']?.sha256,b.databaseSHA256);for(const[n,f]of Object.entries(b.snapshotFiles)){if(n==='data.db')assert.ok(f);if(f!==null){assert.ok(Number.isSafeInteger(f.bytes)&&f.bytes>=0);hash(f.sha256)}}
 assert.deepEqual(Object.keys(r.feedback||{}).sort(),[...RECOVERY_FEEDBACK].sort())
 for(const[name,x]of Object.entries(r.feedback)){for(const k of ['top','bottom','left','right','areaTop','areaBottom','footerTop','width','height'])assert.ok(Number.isFinite(x[k]),k);assert.equal(x.hit,true);assert.equal(x.outsideScroll,true);assert.ok(['status','alert','alertdialog'].includes(x.role));assert.ok(x.top>=Math.max(0,x.areaTop)&&x.bottom>x.top&&x.bottom<=Math.min(x.height,x.areaBottom,x.footerTop));assert.ok(x.left>=0&&x.right>x.left&&x.right<=x.width);assert.ok(typeof x.text==='string'&&x.text.length>0&&x.text.length<2048);assert.equal(typeof x.statusText,'string');assert.equal(x.statusText.includes('本机数据库已确认整批恢复'),name==='success')}
 assert.deepEqual(r.screenshots.map(x=>x.filename),RECOVERY_IMAGES);for(const x of r.screenshots){assert.ok(Number.isSafeInteger(x.bytes)&&x.bytes>100);hash(x.sha256)}return true
}
export function verifyRecoveryNativeReport(directory,expected){
 const r=JSON.parse(readFileSync(path.join(directory,RECOVERY_REPORT),'utf8'));validateRecoveryNativeReport(r,expected)
 for(const x of r.screenshots){const b=readFileSync(path.join(directory,x.filename));assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(b.length,x.bytes);assert.equal(recoveryHash(b),x.sha256)}
 const bytes=readFileSync(path.join(directory,r.catalog.filename));assert.equal(bytes.length,r.catalog.bytes);assert.equal(recoveryHash(bytes),r.catalog.sha256);const s=JSON.parse(bytes);assert.equal(s.complete,true);assert.equal(s.revision,r.catalog.revision);const byId=new Map(s.items.map(n=>[n.id,n]));assert.equal(byId.size,s.items.length)
 for(const id of r.restoredIds){assert.equal(byId.get(id)?.is_deleted,false);assert.equal(byId.get(id)?.deleted_at,0)}
 for(const id of r.batch.ids)assert.equal(byId.get(id)?.parent_id,r.batch.parentId)
 assert.equal(byId.get(r.target.id)?.parent_id,r.target.parentId);assert.equal(byId.get(r.tree.nestedId)?.parent_id,r.tree.parentId);assert.equal(byId.get(r.tree.leafId)?.parent_id,r.tree.nestedId)
 assert.equal(byId.get(r.remainingTrashId)?.is_deleted,true);assert.equal(byId.get(r.templateId)?.is_deleted,false)
 for(const id of Object.keys(r.notes.hashes))assert.ok(byId.has(id),'Retained source missing from catalog')
 return r
}
