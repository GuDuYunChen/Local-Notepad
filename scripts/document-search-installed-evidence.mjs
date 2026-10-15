import assert from 'node:assert/strict'
import {replaceUnique} from './installer-shell-core.mjs'
import {prepareBacklinkInstallation} from './backlinks-installed-evidence.mjs'
export const DOCUMENT_SEARCH_CHECKS=Object.freeze(["ctrl-f-current-document-search-does-not-dirty-body", "previous-next-real-controls-navigate-exact-matches", "case-sensitive-option-and-genuine-no-match", "whole-word-option-does-not-consume-partial-identifiers", "bulk-replacement-cancel-preserves-body", "confirmed-bulk-replacement-keeps-unicode-prefix-and-original-save-boundary", "single-original-undo-restores-bulk-edit", "original-redo-and-save-persist-replacement", "single-replacement-leaves-other-occurrence", "close-switch-and-reopen-read-saved-document-without-stale-panel", "other-note-bodies-and-metadata-unchanged"])
export function prepareDocumentSearchInstallation(core,original,pin){
 assert.match(pin.searchBlob,/^[a-f0-9]{40}$/)
 const prepared=prepareBacklinkInstallation(core,original,pin)
 prepared.script="import {verifyDocumentSearchDesktop} from './check-document-search-desktop.mjs'\n"+prepared.script
 const anchor='  await verifyBacklinksDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})'
 prepared.script=replaceUnique(prepared.script,anchor,anchor+`
  await verifyDocumentSearchDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})
  report.documentSearchSource={productCommit:PRODUCT_COMMIT,sha:'${pin.searchBlob}'};save()`)
 prepared.script=replaceUnique(prepared.script,"mark('installed-app-backlinks-workflow')","mark('installed-app-backlinks-workflow');mark('installed-app-document-search-workflow')")
 prepared.core=replaceUnique(prepared.core,"'installed-app-backlinks-workflow',","'installed-app-backlinks-workflow', 'installed-app-document-search-workflow',")
 return prepared
}
export function validateInstalledDocumentSearch(report,search,pin,verifier){
 for(const value of [pin.product,pin.searchBlob,verifier])assert.match(value,/^[a-f0-9]{40}$/)
 for(const [which,version] of [['current','4.226.0'],['previous','4.225.0']]){
  assert.equal(pin[which].version,version);assert.ok(Number.isSafeInteger(pin[which].bytes)&&pin[which].bytes>0);assert.match(pin[which].sha256,/^[a-f0-9]{64}$/)
 }
 assert.equal(report.productCommit,pin.product);assert.equal(report.verifierCommit,verifier)
 for(const key of ['complete','cleanupComplete','syntheticData','usedDefaultDataPath'])assert.equal(report[key],true)
 assert.equal(report.forceTerminated,false);assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted')
 assert.deepEqual(report.installers,{current:pin.current,previous:pin.previous})
 assert.deepEqual(report.documentSearchSource,{productCommit:pin.product,sha:pin.searchBlob})
 assert.equal(report.checks.filter(s=>s==='installed-app-document-search-workflow').length,1)
 assert.equal(search.commit,verifier)
 for(const key of ['complete','realPackagedApp','realBackend','syntheticData'])assert.equal(search[key],true)
 assert.deepEqual(search.checks,DOCUMENT_SEARCH_CHECKS)
 assert.equal(search.screenshots.length,1);const shot=search.screenshots[0]
 assert.equal(shot.filename,'document-search-installed.png');assert.ok(Number.isSafeInteger(shot.bytes)&&shot.bytes>0);assert.match(shot.sha256,/^[a-f0-9]{64}$/)
 return true
}
