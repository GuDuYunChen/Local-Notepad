import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
export const TASK_REPORT='task-center-desktop.json'
export const taskHash=s=>createHash('sha256').update(s).digest('hex')
export const taskBlob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const TASK_SOURCES=Object.freeze(["src/services/taskCenter.mjs", "src/components/TaskCenter.jsx", "src/components/TaskCenter.css", "src/components/SettingsPanel.jsx", "src/hooks/useGuardedNoteOpener.js", "src/App.jsx", "src/components/TextEditor.jsx", "src/components/Editor/Editor.jsx", "src/components/Editor/Editor.css", "server/internal/tasklist/extract.go", "server/internal/dao/task_center.go", "server/internal/controller/task_center.go", "server/internal/controller/file.go", "scripts/task-center-desktop-driver.mjs", "scripts/task-center-desktop-evidence.mjs", "scripts/prepare-task-center-verifier.mjs", "scripts/run-task-center-desktop-generated.mjs", "scripts/tag-workspace-retained-bodies.mjs", "scripts/appearance-installer-core.mjs", "scripts/desktop-window-session.mjs", "scripts/desktop-window-worker.ps1", "scripts/desktop-window-target.mjs", "scripts/local-export-directory-session.mjs", "scripts/local-export-directory-worker.ps1"])
export const TASK_CHECKS=Object.freeze(["settings-entry-preserves-note-and-theme", "saved-checklist-scope-and-coverage", "same-snapshot-task-pagination", "status-search-sort-and-gap-navigation", "fresh-source-through-original-navigation-guard", "native-checkbox-original-save-and-acknowledged-body", "return-reload-observes-saved-completion", "export-confirmation-cancel-no-file", "actual-summary-download-omits-identities", "actual-explicit-task-excerpt-download", "failed-read-retry-without-partial-results", "cancelled-read-does-not-adopt-late-results", "external-change-refuses-stale-open-and-export", "minimum-window-feedback-and-confirmation", "restart-preserves-saved-task-state", "installation-retains-completion-and-source-data", "only-intended-editor-completion-changes-body"])
export const TASK_FEEDBACK=Object.freeze(['ready','exportConfirm','download','readFailure','cancel','stale','smallConfirm'])
export const TASK_IMAGES=Object.freeze(["task109-overview.png", "task109-editor-saved.png", "task109-revisited.png", "task109-export.png", "task109-error.png", "task109-stale.png", "task109-small.png", "task109-reinstalled.png"])
export function validateTaskNativeReport(r,{product,verifier,sources,native=true}={}){
 assert.equal(native,true);for(const s of [product,verifier])assert.match(s||'',/^[a-f0-9]{40}$/)
 assert.equal(r.schemaVersion,1);assert.equal(r.module,'2F.109');assert.equal(r.version,'4.242.0');assert.equal(r.productCommit,product);assert.equal(r.verifierCommit,verifier)
 assert.equal(r.platform,'win32');assert.equal(r.runnerEnvironment,'github-hosted');assert.equal(r.scope,'installed-default-profile')
 for(const k of ['defaultProfile','nativeAcceptance','syntheticData','realBackend','complete','cleanupComplete','backendStopped','storageDirectoriesRemoved'])assert.equal(r[k],true,k)
 for(const k of ['bridgeOverridden','timerAccelerated','forcedFailureCleanup'])assert.equal(r[k],false,k)
 assert.equal(r.error,undefined);assert.equal(r.cleanupError,undefined)
 assert.deepEqual(Object.keys(sources||{}).sort(),[...TASK_SOURCES].sort());for(const s of Object.values(sources))assert.match(s,/^[a-f0-9]{40}$/)
 assert.deepEqual(r.sourceFiles,sources);assert.deepEqual(r.checks,TASK_CHECKS)
 assert.equal(r.app.packaged,true);assert.equal(r.app.version,r.version)
 for(const k of ['executableSHA256','asarSHA256','backendSHA256'])assert.match(r[k]||'',/^[a-f0-9]{64}$/)
 assert.deepEqual(r.crashes,[]);assert.equal(r.launches.length,3);assert.equal(r.exits.length,3);assert.equal(new Set(r.launches.map(x=>x.pid)).size,3)
 for(const [i,x] of r.launches.entries()){assert.ok(Number.isSafeInteger(x.pid)&&x.pid>0);assert.deepEqual(r.exits[i],{pid:x.pid,code:0,signal:null,normal:true})}
 assert.deepEqual(r.exit,r.exits.at(-1));assert.deepEqual(r.installationCommands.map(x=>x.operation),['initial-install','same-version-install','uninstall','reinstall','final-uninstall'])
 for(const x of r.installationCommands){assert.equal(x.code,0);assert.equal(x.signal,null);assert.equal(x.timedOut,false)}
 assert.deepEqual(r.retention.map(x=>x.operation),['same-version-install','uninstall','reinstall'])
 for(const x of r.retention){assert.equal(x.equal,true);assert.ok(x.files>0);assert.match(x.digest,/^[a-f0-9]{64}$/)}
 assert.deepEqual(Object.keys(r.feedback||{}).sort(),[...TASK_FEEDBACK].sort())
 for(const x of Object.values(r.feedback)){for(const k of ['top','bottom','left','right','areaTop','areaBottom','footerTop','width','height'])assert.ok(Number.isFinite(x[k]),k);assert.equal(x.hit,true);assert.equal(x.outsideScroll,true);assert.ok(x.top>=Math.max(0,x.areaTop)&&x.bottom>x.top&&x.bottom<=Math.min(x.height,x.areaBottom,x.footerTop));assert.ok(x.left>=0&&x.right>x.left&&x.right<=x.width);assert.ok(x.text);assert.ok(['status','alert','alertdialog'].includes(x.role))}
 assert.equal(r.trustedMouseInput,true);assert.equal(r.trustedKeyboardInput,true)
 for(const [name,x]of Object.entries(r.feedback)){assert.equal(typeof x.statusText,'string');assert.ok(x.statusText.length<=4096);assert.equal(x.statusText.includes('待办已读取'),name==='ready');assert.equal(x.statusText.includes('已发起待办报告下载'),name==='download')}
 assert.deepEqual(r.inventory,{delta:{notes:4,with_tasks:2,unsupported:1,tasks:53,pending:52,done:1,folders:1,templates:1,trash:1},excludedTemplateAndTrash:true,codeAndQuoteExcluded:true,gapNotEmpty:true})
 assert.deepEqual(r.pagination.pages,[50,1]);assert.equal(r.pagination.unique,51);assert.match(r.pagination.query,/^TASK109 [a-f0-9]{8} item$/)
 assert.deepEqual(r.filters,{done:1,all:53,gapSources:1,sortedByTitle:true})
 assert.deepEqual(r.guardedOpen,{freshRead:true,accepted:true,originalGuard:true})
 const c=r.completion;assert.equal(c.method,'trusted-original-editor-checkbox');assert.equal(c.point.before,'false');assert.equal(c.point.hit,true);assert.equal(c.point.editable,true)
 for(const k of ['x','y','pseudoWidth'])assert.ok(Number.isFinite(c.point[k])&&c.point[k]>0)
 for(const k of ['originalSaveShortcut','editorClean','persisted','firstDone','other50StillPending','textUnchanged','bodyWriteObserved','returnedDone','revisionChanged'])assert.equal(c[k],true,k)
 assert.equal(typeof c.sourceId,'string');assert.ok(c.sourceId);assert.match(c.beforeSHA256,/^[a-f0-9]{64}$/);assert.match(c.afterSHA256,/^[a-f0-9]{64}$/);assert.notEqual(c.beforeSHA256,c.afterSHA256)
 assert.equal(r.exportCancelled,true);assert.equal(r.exports.length,2)
 for(const [i,e]of r.exports.entries()){assert.equal(e.filename,['task109-summary.json','task109-details.json'][i]);assert.equal(e.includeDetails,i===1);assert.equal(e.count,51);assert.ok(e.bytes>100&&e.bytes<1048576);assert.match(e.sha256,/^[a-f0-9]{64}$/)}
 assert.deepEqual(r.failure,{injectedNetworkFailure:true,partialDiscarded:true,retryComplete:true});assert.deepEqual(r.cancellation,{injectedHeldRead:true,partialDiscarded:true,lateResultNotAdopted:true});assert.deepEqual(r.stale,{explicitOriginalEventInjection:true,exportRefused:true,openRefused:true})
 assert.ok(r.viewport.width>0&&r.viewport.width<=720&&r.viewport.height>0&&r.viewport.height<=520);assert.equal(r.viewport.horizontalOverflow,false);assert.equal(r.viewport.footerReachable,true)
 assert.equal(r.catalog.restartedEqual,true);assert.equal(r.catalog.reinstalledEqual,true);assert.match(r.catalog.revision,/^[a-f0-9]{64}$/)
 const b=r.retainedBodyObservation;assert.equal(b.method,'stopped-backend-readonly-sqlite');assert.equal(b.readOnly,true);assert.equal(b.originalDatabaseOpened,false);assert.equal(b.databaseFilesUnchanged,true);assert.equal(b.observationLocation,'verified-private-copy');assert.equal(b.snapshotVerified,true);assert.equal(b.snapshotRemoved,true);assert.equal(b.normalRows,5);assert.equal(b.trashRows,1);assert.match(b.databaseSHA256,/^[a-f0-9]{64}$/)
 assert.deepEqual(Object.keys(b.snapshotFiles||{}).sort(),['data.db','data.db-shm','data.db-wal']);assert.equal(b.snapshotFiles['data.db']?.sha256,b.databaseSHA256);for(const[n,f]of Object.entries(b.snapshotFiles)){if(n==='data.db')assert.ok(f);if(f!==null){assert.ok(Number.isSafeInteger(f.bytes)&&f.bytes>=0);assert.match(f.sha256,/^[a-f0-9]{64}$/)}}
 assert.equal(r.notes.count,6);assert.equal(r.notes.unchangedOtherBodies,5);assert.equal(r.notes.otherBodyWrites,0);assert.ok(Number.isSafeInteger(r.notes.sourceBodyWrites)&&r.notes.sourceBodyWrites>0)
 assert.equal(r.notes.expected,r.notes.after);assert.match(r.notes.expected,/^[a-f0-9]{64}$/);assert.equal(Object.keys(r.notes.hashes).length,6);for(const h of Object.values(r.notes.hashes))assert.match(h,/^[a-f0-9]{64}$/);assert.deepEqual(b.hashes,r.notes.hashes);assert.equal(r.notes.hashes[c.sourceId],c.afterSHA256)
 assert.equal(r.uiRequests.centerMutations,0);assert.equal(r.uiRequests.unexpectedMutations,0);assert.ok(r.uiRequests.taskReads>=5)
 assert.deepEqual(r.screenshots.map(x=>x.filename),TASK_IMAGES);for(const x of r.screenshots){assert.ok(x.bytes>100);assert.match(x.sha256,/^[a-f0-9]{64}$/)}
 return true
}
export function verifyTaskNativeReport(directory,expected){
 const r=JSON.parse(readFileSync(path.join(directory,TASK_REPORT),'utf8'));validateTaskNativeReport(r,expected)
 for(const x of r.screenshots){const b=readFileSync(path.join(directory,x.filename));assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(b.length,x.bytes);assert.equal(taskHash(b),x.sha256)}
 for(const e of r.exports){const bytes=readFileSync(path.join(directory,e.filename));assert.equal(bytes.length,e.bytes);assert.equal(taskHash(bytes),e.sha256);const v=JSON.parse(bytes);assert.equal(v.format,'local-notepad-task-center');assert.equal(v.version,1);assert.equal(v.contains_task_text,e.includeDetails);assert.equal(v.revision,r.catalog.revision);assert.equal(v.selection.count,51);assert.equal(v.selection.filter,'all');assert.equal(v.selection.sort,'updated');assert.equal(v.scope,'saved-active-notes; checklist states, not a task completion history');assert.deepEqual(v.excludes,['unsaved drafts','templates','trash','code fences','quoted markdown']);if(e.includeDetails){assert.equal(v.selection.query,r.pagination.query);assert.equal(v.tasks.length,51);assert.equal(v.tasks.filter(t=>t.done).length,1);assert.equal(new Set(v.tasks.map(t=>t.ordinal)).size,51);for(const t of v.tasks){assert.equal(t.note_id,r.completion.sourceId);assert.ok(t.title);assert.ok(t.text.startsWith(r.pagination.query));assert.equal(typeof t.done,'boolean');assert.equal(Object.hasOwn(t,'content'),false);assert.equal(Object.hasOwn(t,'path'),false)}}else{assert.equal(Object.hasOwn(v,'tasks'),false);assert.equal(v.selection.query,'');assert.equal(v.selection.query_omitted,true);assert.equal(bytes.includes(Buffer.from(r.pagination.query)),false);assert.equal(bytes.includes(Buffer.from(r.completion.sourceId)),false)}}return r
}
