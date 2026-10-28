import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
export const AUDIT_REPORT='attachment-audit-desktop.json'
export const auditHash=s=>createHash('sha256').update(s).digest('hex')
export const auditBlob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const AUDIT_SOURCES=Object.freeze([
 'src/services/attachmentAudit.mjs','src/components/AttachmentAudit.jsx','src/components/AttachmentAudit.css','src/components/SettingsPanel.jsx',
 'src/hooks/useGuardedNoteOpener.js','src/App.jsx','server/internal/dao/attachment_audit.go','server/internal/controller/attachment_audit.go','server/internal/controller/upload.go','server/cmd/notepad-server/main.go',
 'scripts/attachment-audit-desktop-driver.mjs','scripts/attachment-audit-desktop-evidence.mjs','scripts/prepare-attachment-audit-verifier.mjs','scripts/run-attachment-audit-desktop-generated.mjs',
 'scripts/tag-workspace-retained-bodies.mjs','scripts/appearance-installer-core.mjs','scripts/desktop-window-session.mjs','scripts/desktop-window-worker.ps1','scripts/desktop-window-target.mjs','scripts/local-export-directory-session.mjs','scripts/local-export-directory-worker.ps1',
])
export const AUDIT_CHECKS=Object.freeze(['settings-entry-preserves-note-and-theme','real-uploads-and-conservative-reference-inventory','same-snapshot-filename-pagination','source-pagination-includes-disabled-template-and-trash','coverage-gaps-have-source-locators','original-guarded-source-navigation','export-confirmation-cancel-no-file','actual-aggregate-download-omits-identities','actual-explicit-detail-download','failed-read-retry-without-partial-result','cancelled-read-does-not-adopt-late-result','external-change-refuses-stale-open-and-export','minimum-window-confirmation-is-visible','restart-preserves-audit-inputs','installation-retains-attachments-and-source-data','all-bodies-trash-and-attachments-unchanged'])
export const AUDIT_FEEDBACK=Object.freeze(['ready','exportConfirm','download','readFailure','cancel','stale','smallConfirm'])
export const AUDIT_IMAGES=Object.freeze(['audit108-overview.png','audit108-sources.png','audit108-export.png','audit108-error.png','audit108-stale.png','audit108-small.png','audit108-reinstalled.png'])
export function validateAuditNativeReport(r,{product,verifier,sources,native=true}={}){
 assert.equal(native,true);for(const s of [product,verifier])assert.match(s||'',/^[a-f0-9]{40}$/)
 assert.equal(r.schemaVersion,1);assert.equal(r.module,'2F.108');assert.equal(r.version,'4.241.0');assert.equal(r.productCommit,product);assert.equal(r.verifierCommit,verifier)
 assert.equal(r.platform,'win32');assert.equal(r.runnerEnvironment,'github-hosted');assert.equal(r.scope,'installed-default-profile')
 for(const k of ['defaultProfile','nativeAcceptance','syntheticData','realBackend','complete','cleanupComplete','backendStopped','storageDirectoriesRemoved'])assert.equal(r[k],true,k)
 for(const k of ['bridgeOverridden','timerAccelerated','forcedFailureCleanup'])assert.equal(r[k],false,k)
 assert.equal(r.error,undefined);assert.equal(r.cleanupError,undefined)
 assert.deepEqual(Object.keys(sources||{}).sort(),[...AUDIT_SOURCES].sort());for(const s of Object.values(sources))assert.match(s,/^[a-f0-9]{40}$/)
 assert.deepEqual(r.sourceFiles,sources);assert.deepEqual(r.checks,AUDIT_CHECKS)
 assert.equal(r.app.packaged,true);assert.equal(r.app.version,r.version)
 for(const k of ['executableSHA256','asarSHA256','backendSHA256'])assert.match(r[k]||'',/^[a-f0-9]{64}$/)
 assert.deepEqual(r.crashes,[]);assert.equal(r.launches.length,3);assert.equal(r.exits.length,3);assert.equal(new Set(r.launches.map(x=>x.pid)).size,3)
 for(const [i,x] of r.launches.entries()){assert.ok(Number.isSafeInteger(x.pid)&&x.pid>0);assert.deepEqual(r.exits[i],{pid:x.pid,code:0,signal:null,normal:true})}
 assert.deepEqual(r.exit,r.exits.at(-1));assert.deepEqual(r.installationCommands.map(x=>x.operation),['initial-install','same-version-install','uninstall','reinstall','final-uninstall'])
 for(const x of r.installationCommands){assert.equal(x.code,0);assert.equal(x.signal,null);assert.equal(x.timedOut,false)}
 assert.deepEqual(r.retention.map(x=>x.operation),['same-version-install','uninstall','reinstall'])
 for(const x of r.retention){assert.equal(x.equal,true);assert.ok(x.files>0);assert.match(x.digest,/^[a-f0-9]{64}$/)}
 assert.deepEqual(Object.keys(r.feedback||{}).sort(),[...AUDIT_FEEDBACK].sort())
 for(const x of Object.values(r.feedback)){for(const k of ['top','bottom','left','right','areaTop','areaBottom','footerTop','width','height'])assert.ok(Number.isFinite(x[k]),k);assert.equal(x.hit,true);assert.equal(x.outsideScroll,true);assert.ok(x.top>=Math.max(0,x.areaTop)&&x.bottom>x.top&&x.bottom<=Math.min(x.height,x.areaBottom,x.footerTop));assert.ok(x.left>=0&&x.right>x.left&&x.right<=x.width);assert.ok(x.text);assert.ok(['status','alert','alertdialog'].includes(x.role))}
 assert.equal(r.trustedMouseInput,true);assert.equal(r.trustedKeyboardInput,true)
 for(const [name,x]of Object.entries(r.feedback)){assert.equal(typeof x.statusText,'string');assert.ok(x.statusText.length<=4096);assert.equal(x.statusText.includes('附件检查完成'),name==='ready');assert.equal(x.statusText.includes('已发起报告下载'),name==='download')}
 assert.deepEqual(r.inventory,{filesDelta:2,missingDelta:51,unreferencedDelta:1,notesDelta:55,unparsedDelta:1,rejectedDelta:1,usedReferences:53,templateAndTrashIncluded:true,complete:true})
 assert.deepEqual(r.pagination.pages,[50,1]);assert.equal(r.pagination.unique,51);assert.match(r.pagination.query,/^audit108-[a-f0-9]{8}-$/)
 assert.deepEqual(r.sources,{pages:[50,3],unique:53,hiddenDisabled:2});assert.deepEqual(r.coverage,{gapSources:2,unparsedNotEmpty:true,unsafeURLNotAdopted:true})
 assert.deepEqual(r.guardedOpen,{freshRead:true,accepted:true});assert.equal(r.exportCancelled,true)
 assert.equal(r.exports.length,2)
 for(const[i,e]of r.exports.entries()){assert.equal(e.filename,['audit108-summary.json','audit108-details.json'][i]);assert.equal(e.includeDetails,i===1);assert.equal(e.count,51);assert.ok(e.bytes>100&&e.bytes<1048576);assert.match(e.sha256,/^[a-f0-9]{64}$/)}
 assert.deepEqual(r.failure,{injectedNetworkFailure:true,partialDiscarded:true,retryComplete:true});assert.deepEqual(r.cancellation,{injectedHeldRead:true,partialDiscarded:true,lateResultNotAdopted:true});assert.deepEqual(r.stale,{explicitOriginalEventInjection:true,exportRefused:true,openRefused:true})
 assert.ok(r.viewport.width>0&&r.viewport.width<=720&&r.viewport.height>0&&r.viewport.height<=520);assert.equal(r.viewport.horizontalOverflow,false);assert.equal(r.viewport.footerReachable,true)
 assert.equal(r.catalog.restartedEqual,true);assert.equal(r.catalog.reinstalledEqual,true);assert.match(r.catalog.revision,/^[a-f0-9]{64}$/)
 assert.equal(r.uploads.length,2);assert.equal(new Set(r.uploads.map(x=>x.name)).size,2);assert.equal(r.attachmentBytesRetained,true)
 for(const u of r.uploads){assert.match(u.name,/^[a-zA-Z0-9_.-]+$/);assert.equal(u.url,'/uploads/'+u.name);assert.ok(u.bytes>0&&u.bytes<4096);assert.match(u.sha256,/^[a-f0-9]{64}$/)}
 const b=r.retainedBodyObservation;assert.equal(b.method,'stopped-backend-readonly-sqlite');assert.equal(b.readOnly,true);assert.equal(b.originalDatabaseOpened,false);assert.equal(b.databaseFilesUnchanged,true);assert.equal(b.observationLocation,'verified-private-copy');assert.equal(b.snapshotVerified,true);assert.equal(b.snapshotRemoved,true);assert.equal(b.normalRows,54);assert.equal(b.trashRows,1);assert.match(b.databaseSHA256,/^[a-f0-9]{64}$/)
 assert.deepEqual(Object.keys(b.snapshotFiles||{}).sort(),['data.db','data.db-shm','data.db-wal']);assert.equal(b.snapshotFiles['data.db']?.sha256,b.databaseSHA256);for(const [n,f] of Object.entries(b.snapshotFiles)){if(n==='data.db')assert.ok(f);if(f!==null){assert.ok(Number.isSafeInteger(f.bytes)&&f.bytes>=0);assert.match(f.sha256,/^[a-f0-9]{64}$/)}}
 assert.equal(r.notes.count,55);assert.equal(r.notes.bodyWrites,0);assert.equal(r.notes.before,r.notes.after);assert.match(r.notes.before,/^[a-f0-9]{64}$/);assert.equal(Object.keys(r.notes.hashes).length,55);for(const h of Object.values(r.notes.hashes))assert.match(h,/^[a-f0-9]{64}$/);assert.deepEqual(b.hashes,r.notes.hashes)
 assert.equal(r.uiRequests.mutations,0);assert.ok(r.uiRequests.auditReads>=5)
 assert.deepEqual(r.screenshots.map(x=>x.filename),AUDIT_IMAGES);for(const x of r.screenshots){assert.ok(x.bytes>100);assert.match(x.sha256,/^[a-f0-9]{64}$/)}
 return true
}
export function verifyAuditNativeReport(directory,expected){const r=JSON.parse(readFileSync(path.join(directory,AUDIT_REPORT),'utf8'));validateAuditNativeReport(r,expected)
 for(const x of r.screenshots){const b=readFileSync(path.join(directory,x.filename));assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(b.length,x.bytes);assert.equal(auditHash(b),x.sha256)}
 for(const e of r.exports){const bytes=readFileSync(path.join(directory,e.filename));assert.equal(bytes.length,e.bytes);assert.equal(auditHash(bytes),e.sha256);const v=JSON.parse(bytes);assert.equal(v.format,'local-notepad-attachment-audit');assert.equal(v.version,1);assert.equal(v.contains_details,e.includeDetails);assert.equal(v.revision,r.catalog.revision);assert.equal(v.selection.count,51);assert.equal(v.scope,'saved active/template/trash text URL candidates and flat uploads metadata only');assert.deepEqual(v.limitations,['not content integrity or malware verification','unreferenced does not mean safe to delete','excludes drafts, history and external libraries','not atomic across SQLite and filesystem']);if(e.includeDetails){assert.equal(v.selection.query,r.pagination.query);assert.equal(v.items.length,51);assert.equal(v.notes.length,51);assert.equal(v.coverage_notes.length,2);for(const n of [...v.notes,...v.coverage_notes]){assert.equal(Object.hasOwn(n,'content'),false);assert.equal(Object.hasOwn(n,'path'),false);assert.ok(n.id&&n.title)}for(const i of v.items){assert.ok(i.name.startsWith(r.pagination.query));assert.equal(i.state,'missing');assert.equal(i.bytes,0);assert.equal(i.notes.length,1)}}else{for(const k of ['items','notes','coverage_notes'])assert.equal(Object.hasOwn(v,k),false);assert.equal(v.selection.query,'');assert.equal(bytes.includes(Buffer.from(r.pagination.query)),false);for(const u of r.uploads)assert.equal(bytes.includes(Buffer.from(u.name)),false)}}return r}
