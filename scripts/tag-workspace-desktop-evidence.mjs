import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
export const TAG_REPORT='tag-workspace-desktop.json'
export const tagHash=value=>createHash('sha256').update(value).digest('hex')
export const tagBlob=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex')
export const TAG_SOURCES=Object.freeze([
 'src/services/tagWorkspace.mjs','src/components/TagWorkspace.jsx','src/components/TagWorkspace.css','src/components/SettingsPanel.jsx',
 'src/hooks/useGuardedNoteOpener.js','src/App.jsx','server/internal/dao/tag_workspace.go','server/internal/controller/tag_workspace.go','server/internal/controller/tag.go',
 'scripts/tag-workspace-retained-bodies.mjs','scripts/tag-workspace-desktop-driver.mjs','scripts/tag-workspace-desktop-evidence.mjs','scripts/prepare-tag-workspace-verifier.mjs',
 'scripts/run-tag-workspace-desktop-generated.mjs','scripts/appearance-installer-core.mjs','scripts/desktop-window-session.mjs',
 'scripts/desktop-window-worker.ps1','scripts/desktop-window-target.mjs','scripts/local-export-directory-session.mjs','scripts/local-export-directory-worker.ps1',
])
export const TAG_CHECKS=Object.freeze([
 'settings-entry-preserves-note-and-theme','complete-counts-and-revision-pagination','original-guarded-note-navigation','create-confirmation-cancel',
 'invalid-input-refused','create-and-acknowledgment','search-and-unused-filter','rename-and-recolor-preserve-identity','transactional-merge-deduplicates-all-links',
 'delete-confirmation-preserves-notes','real-storage-quota-refuses-send-and-retries','stale-confirmation-close-and-read-only-reconciliation',
 'committed-response-loss-is-not-replayed','corrupt-record-requires-explicit-clear','minimum-window-feedback-and-confirmation',
 'normal-restart-restores-catalog','installation-retains-tags-and-journal-state','all-note-bodies-and-trash-preserved',
])
export const TAG_FEEDBACK=Object.freeze(['success','invalid','mergeConfirm','deleteConfirm','quota','conflict','reconciliation','corrupt','smallConfirm'])
export const TAG_IMAGES=Object.freeze(['tag106-catalog.png','tag106-merge.png','tag106-quota.png','tag106-conflict.png','tag106-reconciled.png','tag106-small.png','tag106-reinstalled.png'])
// The existing GetFileTags endpoint returns null for its nil empty slice.
// Only null or an actual tag array is accepted; malformed responses stay errors.
export function verifyRemovedFileTagsAbsent(tags, removedTagIds) {
 assert.ok(Array.isArray(removedTagIds)&&removedTagIds.length===2&&new Set(removedTagIds).size===2&&removedTagIds.every(id=>typeof id==='string'&&id.length>0),'Invalid removed tag identities')
 assert.ok(tags===null||Array.isArray(tags),'Unexpected file tags response')
 if(tags===null)return true
 for(const tag of tags){
  assert.ok(tag&&typeof tag==='object'&&!Array.isArray(tag)&&typeof tag.id==='string'&&tag.id.length>0,'Invalid file tag row')
  assert.equal(removedTagIds.includes(tag.id),false,'Removed tag links remain in API')
 }
 return true
}
export function validateTagWorkspaceNativeReport(r,{product,verifier,sources,native=true}={}) {
 assert.equal(native,true);for(const sha of [product,verifier])assert.match(sha||'',/^[a-f0-9]{40}$/)
 assert.equal(r.schemaVersion,1);assert.equal(r.module,'2F.106');assert.equal(r.version,'4.239.0')
 assert.equal(r.productCommit,product);assert.equal(r.verifierCommit,verifier)
 assert.equal(r.platform,'win32');assert.equal(r.runnerEnvironment,'github-hosted');assert.equal(r.scope,'installed-default-profile')
 for(const k of ['defaultProfile','nativeAcceptance','syntheticData','realBackend','complete','cleanupComplete','backendStopped','storageDirectoriesRemoved'])assert.equal(r[k],true,k)
 for(const k of ['bridgeOverridden','timerAccelerated','forcedFailureCleanup'])assert.equal(r[k],false,k)
 assert.equal(r.error,undefined);assert.equal(r.cleanupError,undefined)
 assert.deepEqual(Object.keys(sources||{}).sort(),[...TAG_SOURCES].sort());for(const sha of Object.values(sources))assert.match(sha,/^[a-f0-9]{40}$/)
 assert.deepEqual(r.sourceFiles,sources);assert.deepEqual(r.checks,TAG_CHECKS)
 assert.equal(r.app.packaged,true);assert.equal(r.app.version,r.version)
 for(const k of ['executableSHA256','asarSHA256','backendSHA256'])assert.match(r[k]||'',/^[a-f0-9]{64}$/)
 assert.deepEqual(r.crashes,[]);assert.equal(r.launches.length,3);assert.equal(r.exits.length,3);assert.equal(new Set(r.launches.map(x=>x.pid)).size,3)
 for(const [i,x] of r.launches.entries()){assert.ok(Number.isSafeInteger(x.pid)&&x.pid>0);assert.deepEqual(r.exits[i],{pid:x.pid,code:0,signal:null,normal:true})}
 assert.deepEqual(r.exit,r.exits.at(-1))
 assert.deepEqual(r.installationCommands.map(x=>x.operation),['initial-install','same-version-install','uninstall','reinstall','final-uninstall'])
 for(const x of r.installationCommands){assert.equal(x.code,0);assert.equal(x.signal,null);assert.equal(x.timedOut,false)}
 assert.deepEqual(r.retention.map(x=>x.operation),['same-version-install','uninstall','reinstall'])
 for(const x of r.retention){assert.equal(x.equal,true);assert.ok(x.files>0);assert.match(x.digest,/^[a-f0-9]{64}$/)}
 assert.deepEqual(Object.keys(r.feedback||{}).sort(),[...TAG_FEEDBACK].sort())
 for(const x of Object.values(r.feedback)){for(const k of ['top','bottom','left','right','areaTop','areaBottom','footerTop','width','height'])assert.ok(Number.isFinite(x[k]),k)
  assert.equal(x.hit,true);assert.equal(x.outsideScroll,true);assert.ok(x.top>=Math.max(0,x.areaTop)&&x.bottom>x.top&&x.bottom<=Math.min(x.height,x.areaBottom,x.footerTop));assert.ok(x.left>=0&&x.right>x.left&&x.right<=x.width);assert.ok(x.text);assert.ok(['status','alert','alertdialog','recovery'].includes(x.role))}
 assert.equal(r.trustedMouseInput,true);assert.equal(r.trustedKeyboardInput,true)
 assert.deepEqual(r.pagination,{normal:51,hidden:1,total:52,pages:[50,1],unique:51,hiddenExcluded:true})
 assert.equal(r.guardedOpen.freshRead,true);assert.equal(r.guardedOpen.accepted,true);assert.ok(r.guardedOpen.title)
 assert.ok(r.created.id&&r.created.name);assert.match(r.created.color,/^#[a-f0-9]{6}$/);assert.equal(r.created.total,0)
 assert.equal(r.renamed.countsPreserved,true);assert.match(r.renamed.color,/^#[a-f0-9]{6}$/);assert.ok(r.renamed.name)
 assert.equal(r.merge.sourceId,r.renamed.id);assert.notEqual(r.merge.sourceId,r.merge.targetId)
 for(const k of ['sourceRemoved','targetIdentityPreserved','cancelUnchanged'])assert.equal(r.merge[k],true)
 assert.deepEqual([r.merge.normal,r.merge.hidden,r.merge.total],[52,1,53]);assert.equal(r.delete.id,r.merge.targetId);assert.equal(r.delete.allLinksRemoved,true);assert.equal(r.delete.cancelUnchanged,true)
 assert.equal(r.quota.error,'QuotaExceededError');assert.ok(r.quota.keys>0);for(const k of ['zeroRequestsWhileFull','unchangedBeforeRetry','retryAcknowledged'])assert.equal(r.quota[k],true)
 for(const k of ['backendRefusedStaleSnapshot','originalMetadataPreserved','recordSurvivedClose','reconciliationReadOnly','cancelKeptRecord'])assert.equal(r.conflict[k],true)
 assert.equal(r.lostResponse.status,200);assert.equal(r.lostResponse.stage,'response');assert.equal(r.lostResponse.injectedTransportFailure,true)
 for(const k of ['backendCommitObserved','recordSurvivedClose','recordSurvivedRestart','reconciliationReadOnly','noHistoricReceiptClaim','explicitRecordEnd'])assert.equal(r.lostResponse[k],true)
 assert.equal(r.lostResponse.mutationPosts,1)
 assert.deepEqual(r.corruption,{explicitFixtureInjection:true,automaticOverwrite:false,cancelPreserved:true,explicitClear:true})
 assert.ok(r.viewport.width>0&&r.viewport.width<=720&&r.viewport.height>0&&r.viewport.height<=520);assert.equal(r.viewport.horizontalOverflow,false);assert.equal(r.viewport.footerReachable,true)
 assert.equal(r.catalog.restartedEqual,true);assert.equal(r.catalog.reinstalledEqual,true);assert.match(r.catalog.sha256,/^[a-f0-9]{64}$/)
 const observation=r.retainedBodyObservation
 assert.equal(observation?.method,'stopped-backend-readonly-sqlite');assert.equal(observation.readOnly,true)
 assert.equal(observation.databaseFilesUnchanged,true);assert.equal(observation.normalRows,52);assert.equal(observation.trashRows,1)
 assert.equal(observation.removedTagLinks,0);assert.equal(observation.removedTags,0);assert.match(observation.databaseSHA256,/^[a-f0-9]{64}$/)
 assert.equal(observation.originalDatabaseOpened,false);assert.equal(observation.observationLocation,'verified-private-copy')
 assert.equal(observation.snapshotVerified,true);assert.equal(observation.snapshotRemoved,true)
 assert.deepEqual(Object.keys(observation.snapshotFiles||{}).sort(),['data.db','data.db-shm','data.db-wal'])
 assert.equal(observation.snapshotFiles['data.db']?.sha256,observation.databaseSHA256)
 for(const [name,file] of Object.entries(observation.snapshotFiles)){if(name==='data.db')assert.ok(file);if(file!==null){assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>=0);assert.match(file.sha256,/^[a-f0-9]{64}$/)}}
 assert.deepEqual(observation.hashes,r.notes.hashes)
 assert.equal(r.notes.normalVerified,52);assert.equal(r.notes.trashVerified,1);assert.equal(r.notes.bodyWrites,0);assert.match(r.notes.before,/^[a-f0-9]{64}$/);assert.equal(r.notes.after,r.notes.before)
 assert.equal(Object.keys(r.notes.hashes).length,53);for(const sha of Object.values(r.notes.hashes))assert.match(sha,/^[a-f0-9]{64}$/)
 assert.deepEqual(r.screenshots.map(x=>x.filename),TAG_IMAGES);for(const x of r.screenshots){assert.ok(x.bytes>100);assert.match(x.sha256,/^[a-f0-9]{64}$/)}
 return true
}
export function verifyTagWorkspaceNativeReport(directory,expected){const r=JSON.parse(readFileSync(path.join(directory,TAG_REPORT),'utf8'));validateTagWorkspaceNativeReport(r,expected)
 for(const image of r.screenshots){const b=readFileSync(path.join(directory,image.filename));assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(b.length,image.bytes);assert.equal(tagHash(b),image.sha256)}return r}
