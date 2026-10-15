import assert from 'node:assert/strict'
import {replaceUnique} from './installer-shell-core.mjs'
import {prepareNoteTagInstallation} from './note-tags-installed-evidence.mjs'
export const BACKLINK_CHECKS=Object.freeze(["genuine-empty-index-is-distinct", "real-editor-wiki-insertion-and-save-build-index", "failed-index-read-never-pretends-empty", "explicit-retry-loads-real-source-and-section", "literal-source-and-section-search-retains-preview", "changed-source-refused-before-switching", "refresh-adopts-latest-saved-source", "cancelled-open-preserves-current-draft-and-preview", "original-save-then-source-open-and-heading-navigation", "trashed-source-cannot-be-opened-from-old-preview", "unavailable-index-record-does-not-expose-body", "close-reopen-keeps-current-source-state", "unrelated-note-bodies-and-metadata-unchanged"])
export function prepareBacklinkInstallation(core,original,pin){
 assert.match(pin.backlinksBlob,/^[a-f0-9]{40}$/)
 const prepared=prepareNoteTagInstallation(core,original,pin)
 prepared.script="import {verifyBacklinksDesktop} from './check-backlinks-desktop.mjs'\n"+prepared.script
 const anchor='  await verifyNoteTagsDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})'
 prepared.script=replaceUnique(prepared.script,anchor,anchor+`
  await verifyBacklinksDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})
  report.backlinksSource={productCommit:PRODUCT_COMMIT,sha:'${pin.backlinksBlob}'};save()`)
 prepared.script=replaceUnique(prepared.script,"mark('installed-app-note-tags-workflow')","mark('installed-app-note-tags-workflow');mark('installed-app-backlinks-workflow')")
 prepared.core=replaceUnique(prepared.core,"'installed-app-note-tags-workflow',","'installed-app-note-tags-workflow', 'installed-app-backlinks-workflow',")
 return prepared
}
export function validateInstalledBacklinks(report,backlinks,pin,verifier){
 for(const value of [pin.product,pin.backlinksBlob,verifier])assert.match(value,/^[a-f0-9]{40}$/)
 assert.equal(report.productCommit,pin.product);assert.equal(report.verifierCommit,verifier)
 for(const key of ['complete','cleanupComplete','syntheticData','usedDefaultDataPath'])assert.equal(report[key],true)
 assert.equal(report.forceTerminated,false);assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted')
 assert.deepEqual(report.installers,{current:pin.current,previous:pin.previous})
 assert.deepEqual(report.backlinksSource,{productCommit:pin.product,sha:pin.backlinksBlob})
 assert.equal(report.checks.filter(s=>s==='installed-app-backlinks-workflow').length,1)
 assert.equal(backlinks.commit,verifier)
 for(const key of ['complete','realPackagedApp','realBackend','syntheticData'])assert.equal(backlinks[key],true)
 assert.deepEqual(backlinks.checks,BACKLINK_CHECKS)
 assert.deepEqual(backlinks.screenshots.map(s=>s.filename),['backlinks-preview.png','backlinks-installed.png'])
 for(const s of backlinks.screenshots){assert.ok(Number.isSafeInteger(s.bytes)&&s.bytes>0);assert.match(s.sha256,/^[a-f0-9]{64}$/)}
 return true
}
