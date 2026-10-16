import assert from 'node:assert/strict'
export const RECENT_CHECKS=Object.freeze(["confirmed-note-entry-records-metadata-only", "revisit-is-first-without-duplicating-history", "cancelled-history-entry-retains-current-unsaved-draft", "original-editor-save-still-persists-body", "actual-renderer-reload-retains-local-history", "search-and-selection-do-not-open-or-write-notes", "failed-latest-target-read-keeps-record-for-retry", "renamed-target-opens-latest-body-through-original-guard", "paused-history-does-not-record-subsequent-note-entry", "resume-records-future-entry-without-backfilling", "remove-confirmation-changes-history-not-the-note", "clear-cancel-and-confirm-never-delete-note-content", "corrupt-history-is-preserved-until-explicit-reset-and-pause", "close-and-reopen-retain-confirmed-recording-setting", "unrelated-note-body-metadata-and-pins-unchanged"])
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unexpected inherited source anchor');return s.replace(a,b)}
export function validateRecentPin(pin){
 for(const k of ['product','quickBlob','tagsBlob','templateBlob','backlinksBlob','searchBlob','outlineBlob','graphBlob','pinsBlob','recentBlob'])assert.match(pin[k],/^[a-f0-9]{40}$/)
 for(const [which,version]of [['current','4.230.1'],['previous','4.229.0']]){
  assert.equal(pin[which].version,version);assert.ok(Number.isSafeInteger(pin[which].bytes)&&pin[which].bytes>0);assert.match(pin[which].sha256,/^[a-f0-9]{64}$/)
 }
 return true
}
export function extendRecentInstallation(prepared,pin){
 validateRecentPin(pin)
 assert.doesNotMatch(prepared.script,/verifyRecentNotesDesktop|recentNotesSource|installed-app-recent-notes-workflow/)
 assert.doesNotMatch(prepared.core,/installed-app-recent-notes-workflow/)
 assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
 const prefix="import {verifyRecentNotesDesktop} from './check-recent-notes-desktop.mjs'\n"
 const anchor='  await verifyLocalPinsDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})'
 const addition=anchor+`\n  await verifyRecentNotesDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})\n  report.recentNotesSource={productCommit:PRODUCT_COMMIT,sha:'${pin.recentBlob}'};save()`
 const mark="mark('installed-app-local-pins-workflow')",nextMark=mark+";mark('installed-app-recent-notes-workflow')"
 const check="'installed-app-local-pins-workflow',",nextCheck=check+" 'installed-app-recent-notes-workflow',"
 const script=prefix+once(once(prepared.script,anchor,addition),mark,nextMark),core=once(prepared.core,check,nextCheck)
 assert.equal(once(once(script.slice(prefix.length),addition,anchor),nextMark,mark),prepared.script)
 assert.equal(once(core,nextCheck,check),prepared.core)
 return {core,script}
}
export function validateInstalledRecent(report,recent,pin,verifier){
 validateRecentPin(pin);assert.match(verifier,/^[a-f0-9]{40}$/)
 assert.equal(report.productCommit,pin.product);assert.equal(report.verifierCommit,verifier)
 for(const k of ['complete','cleanupComplete','syntheticData','usedDefaultDataPath'])assert.equal(report[k],true)
 assert.equal(report.forceTerminated,false);assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted')
 assert.deepEqual(report.installers,{current:pin.current,previous:pin.previous})
 assert.deepEqual(report.recentNotesSource,{productCommit:pin.product,sha:pin.recentBlob})
 assert.equal(report.checks.filter(s=>s==='installed-app-recent-notes-workflow').length,1)
 assert.equal(recent.commit,verifier)
 for(const k of ['complete','realPackagedApp','realBackend','syntheticData'])assert.equal(recent[k],true)
 assert.deepEqual(recent.checks,RECENT_CHECKS)
 assert.equal(recent.realRendererReload,true)
 assert.equal(recent.screenshots.length,1);const image=recent.screenshots[0]
 assert.equal(image.filename,'recent-notes-installed.png');assert.ok(Number.isSafeInteger(image.bytes)&&image.bytes>0);assert.match(image.sha256,/^[a-f0-9]{64}$/)
 return true
}
