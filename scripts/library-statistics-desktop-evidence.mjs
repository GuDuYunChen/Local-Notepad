import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
export const STATISTICS_REPORT='library-statistics-desktop.json'
export const statisticsHash=s=>createHash('sha256').update(s).digest('hex')
export const statisticsBlob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const STATISTICS_SOURCES=Object.freeze([
 'src/services/libraryStatistics.mjs','src/components/LibraryStatistics.jsx','src/components/LibraryStatistics.css','src/components/SettingsPanel.jsx',
 'src/hooks/useGuardedNoteOpener.js','src/App.jsx','server/internal/dao/library_statistics.go','server/internal/controller/library_statistics.go','server/internal/controller/file.go',
 'scripts/library-statistics-desktop-driver.mjs','scripts/library-statistics-desktop-evidence.mjs','scripts/prepare-library-statistics-verifier.mjs','scripts/run-library-statistics-desktop-generated.mjs',
 'scripts/tag-workspace-retained-bodies.mjs','scripts/appearance-installer-core.mjs','scripts/desktop-window-session.mjs','scripts/desktop-window-worker.ps1','scripts/desktop-window-target.mjs','scripts/local-export-directory-session.mjs','scripts/local-export-directory-worker.ps1',
])
export const STATISTICS_CHECKS=Object.freeze(['settings-entry-preserves-note-and-theme','complete-readonly-snapshot-and-explicit-exclusions','same-snapshot-query-and-pagination','filter-sort-and-unsupported-distinction','original-guarded-navigation','export-confirmation-cancel','actual-aggregate-download-omits-titles','actual-explicit-title-download','failed-read-has-visible-retry','cancelled-read-never-adopts-partial-result','external-refresh-invalidates-open-and-export','minimum-window-confirmation-and-feedback','normal-restart-preserves-statistics','installation-retains-source-data','all-fixture-bodies-and-trash-unchanged'])
export const STATISTICS_FEEDBACK=Object.freeze(['ready','exportConfirm','download','readFailure','cancel','stale','smallConfirm'])
export const STATISTICS_IMAGES=Object.freeze(['statistics107-overview.png','statistics107-export.png','statistics107-error.png','statistics107-stale.png','statistics107-small.png','statistics107-reinstalled.png'])
export function validateStatisticsNativeReport(r,{product,verifier,sources,native=true}={}){
 assert.equal(native,true);for(const s of [product,verifier])assert.match(s||'',/^[a-f0-9]{40}$/)
 assert.equal(r.schemaVersion,1);assert.equal(r.module,'2F.107');assert.equal(r.version,'4.240.0');assert.equal(r.productCommit,product);assert.equal(r.verifierCommit,verifier)
 assert.equal(r.platform,'win32');assert.equal(r.runnerEnvironment,'github-hosted');assert.equal(r.scope,'installed-default-profile')
 for(const k of ['defaultProfile','nativeAcceptance','syntheticData','realBackend','complete','cleanupComplete','backendStopped','storageDirectoriesRemoved'])assert.equal(r[k],true,k)
 for(const k of ['bridgeOverridden','timerAccelerated','forcedFailureCleanup'])assert.equal(r[k],false,k)
 assert.equal(r.error,undefined);assert.equal(r.cleanupError,undefined)
 assert.deepEqual(Object.keys(sources||{}).sort(),[...STATISTICS_SOURCES].sort());for(const s of Object.values(sources))assert.match(s,/^[a-f0-9]{40}$/)
 assert.deepEqual(r.sourceFiles,sources);assert.deepEqual(r.checks,STATISTICS_CHECKS)
 assert.equal(r.app.packaged,true);assert.equal(r.app.version,r.version)
 for(const k of ['executableSHA256','asarSHA256','backendSHA256'])assert.match(r[k]||'',/^[a-f0-9]{64}$/)
 assert.deepEqual(r.crashes,[]);assert.equal(r.launches.length,3);assert.equal(r.exits.length,3);assert.equal(new Set(r.launches.map(x=>x.pid)).size,3)
 for(const [i,x] of r.launches.entries()){assert.ok(Number.isSafeInteger(x.pid)&&x.pid>0);assert.deepEqual(r.exits[i],{pid:x.pid,code:0,signal:null,normal:true})}
 assert.deepEqual(r.exit,r.exits.at(-1));assert.deepEqual(r.installationCommands.map(x=>x.operation),['initial-install','same-version-install','uninstall','reinstall','final-uninstall'])
 for(const x of r.installationCommands){assert.equal(x.code,0);assert.equal(x.signal,null);assert.equal(x.timedOut,false)}
 assert.deepEqual(r.retention.map(x=>x.operation),['same-version-install','uninstall','reinstall'])
 for(const x of r.retention){assert.equal(x.equal,true);assert.ok(x.files>0);assert.match(x.digest,/^[a-f0-9]{64}$/)}
 assert.deepEqual(Object.keys(r.feedback||{}).sort(),[...STATISTICS_FEEDBACK].sort())
 for(const x of Object.values(r.feedback)){for(const k of ['top','bottom','left','right','areaTop','areaBottom','footerTop','width','height'])assert.ok(Number.isFinite(x[k]),k);assert.equal(x.hit,true);assert.equal(x.outsideScroll,true);assert.ok(x.top>=Math.max(0,x.areaTop)&&x.bottom>x.top&&x.bottom<=Math.min(x.height,x.areaBottom,x.footerTop));assert.ok(x.left>=0&&x.right>x.left&&x.right<=x.width);assert.ok(x.text);assert.ok(['status','alert','alertdialog'].includes(x.role))}
 assert.equal(r.trustedMouseInput,true);assert.equal(r.trustedKeyboardInput,true)
 const s=r.snapshot;for(const k of ['complete','unicodeVerified','excludedBodiesAbsent'])assert.equal(s[k],true);assert.equal(s.normalDelta,53);assert.equal(s.activityDays,30);assert.ok(Number.isSafeInteger(s.characters)&&s.characters>0);for(const k of ['folderDelta','templateDelta','trashDelta','taggedDelta','pinnedDelta','noTextDelta','unsupportedDelta'])assert.equal(s[k],1)
 assert.deepEqual(r.pagination.pages,[50,3]);assert.equal(r.pagination.unique,53);assert.ok(r.pagination.query)
 assert.deepEqual(r.filters,{untagged:52,pinned:1,noText:1,unsupported:1,titleSort:true,charactersSort:true});assert.deepEqual(r.guardedOpen,{freshRead:true,accepted:true})
 assert.equal(r.exports.length,2)
 for(const [i,e] of r.exports.entries()){assert.equal(e.filename,['statistics107-summary.json','statistics107-titles.json'][i]);assert.equal(e.includeTitles,i===1);assert.equal(e.count,53);assert.ok(e.bytes>100&&e.bytes<1048576);assert.match(e.sha256,/^[a-f0-9]{64}$/)}
 assert.deepEqual(r.failure,{injectedNetworkFailure:true,partialDiscarded:true,retryComplete:true});assert.deepEqual(r.cancellation,{injectedHeldRead:true,partialDiscarded:true,lateResultNotAdopted:true});assert.deepEqual(r.stale,{explicitOriginalEventInjection:true,exportRefused:true,openRefused:true})
 assert.ok(r.viewport.width>0&&r.viewport.width<=720&&r.viewport.height>0&&r.viewport.height<=520);assert.equal(r.viewport.horizontalOverflow,false);assert.equal(r.viewport.footerReachable,true)
 assert.equal(r.catalog.restartedEqual,true);assert.equal(r.catalog.reinstalledEqual,true);assert.match(r.catalog.revision,/^[a-f0-9]{64}$/)
 const b=r.retainedBodyObservation;assert.equal(b.method,'stopped-backend-readonly-sqlite');assert.equal(b.readOnly,true);assert.equal(b.originalDatabaseOpened,false);assert.equal(b.databaseFilesUnchanged,true);assert.equal(b.observationLocation,'verified-private-copy');assert.equal(b.snapshotVerified,true);assert.equal(b.snapshotRemoved,true);assert.equal(b.normalRows,54);assert.equal(b.trashRows,1);assert.match(b.databaseSHA256,/^[a-f0-9]{64}$/)
 assert.deepEqual(Object.keys(b.snapshotFiles||{}).sort(),['data.db','data.db-shm','data.db-wal']);assert.equal(b.snapshotFiles['data.db']?.sha256,b.databaseSHA256);for(const [n,f] of Object.entries(b.snapshotFiles)){if(n==='data.db')assert.ok(f);if(f!==null){assert.ok(Number.isSafeInteger(f.bytes)&&f.bytes>=0);assert.match(f.sha256,/^[a-f0-9]{64}$/)}}
 assert.equal(r.notes.count,55);assert.equal(r.notes.bodyWrites,0);assert.equal(r.notes.before,r.notes.after);assert.match(r.notes.before,/^[a-f0-9]{64}$/);assert.equal(Object.keys(r.notes.hashes).length,55);for(const h of Object.values(r.notes.hashes))assert.match(h,/^[a-f0-9]{64}$/);assert.deepEqual(b.hashes,r.notes.hashes)
 assert.equal(r.uiRequests.mutations,0);assert.ok(r.uiRequests.statisticsReads>=5)
 assert.deepEqual(r.screenshots.map(x=>x.filename),STATISTICS_IMAGES);for(const x of r.screenshots){assert.ok(x.bytes>100);assert.match(x.sha256,/^[a-f0-9]{64}$/)}
 return true
}
export function verifyStatisticsNativeReport(directory,expected){const r=JSON.parse(readFileSync(path.join(directory,STATISTICS_REPORT),'utf8'));validateStatisticsNativeReport(r,expected)
 for(const x of r.screenshots){const b=readFileSync(path.join(directory,x.filename));assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(b.length,x.bytes);assert.equal(statisticsHash(b),x.sha256)}
 for(const e of r.exports){const bytes=readFileSync(path.join(directory,e.filename));assert.equal(bytes.length,e.bytes);assert.equal(statisticsHash(bytes),e.sha256);const v=JSON.parse(bytes);assert.equal(v.format,'local-notepad-library-statistics');assert.equal(v.version,1);assert.equal(v.contains_titles,e.includeTitles);assert.equal(v.revision,r.catalog.revision);assert.equal(v.selection.count,53);assert.equal(v.scope,'saved-active-notes-only');assert.equal(v.activity.length,30);assert.ok(v.excludes.includes('unsaved drafts'));assert.equal(v.activity_metric,'creation and latest modification dates in UTC; not edit-event counts');if(e.includeTitles){assert.equal(v.selection.query,r.pagination.query);assert.equal(v.notes.length,53);for(const n of v.notes){assert.equal(Object.hasOwn(n,'content'),false);assert.equal(Object.hasOwn(n,'path'),false);assert.ok(n.title)}}else{assert.equal(Object.hasOwn(v,'notes'),false);assert.equal(v.selection.query,'');assert.equal(bytes.includes(Buffer.from(r.pagination.query)),false)}}return r}
