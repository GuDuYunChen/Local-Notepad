import assert from 'node:assert/strict'
import {replaceUnique} from './installer-shell-core.mjs'
import {prepareQuickInstallation} from './quick-installed-evidence.mjs'
export const NOTE_TAG_CHECKS=Object.freeze(['properties-entry-reads-current-note-tags','failed-read-is-not-empty-success','explicit-read-retry-recovers','atomic-create-and-attach-preserves-note-body','existing-name-reused-without-duplicate','remove-cancel-has-no-side-effect','confirmed-removal-keeps-shared-label','tag-assignment-does-not-save-or-replace-draft','original-editor-save-still-persists-body','committed-write-with-lost-response-retains-unconfirmed-state','read-only-reconciliation-never-reposts-write','close-reopen-retains-persisted-tags','other-note-bodies-and-tag-associations-unchanged'])
export function prepareNoteTagInstallation(core,original,pin){
 assert.match(pin.tagsBlob,/^[a-f0-9]{40}$/)
 const prepared=prepareQuickInstallation(core,original,pin.quickBlob)
 prepared.script="import {verifyNoteTagsDesktop} from './check-note-tags-desktop.mjs'\n"+prepared.script
 const anchor='  await verifyQuickSwitcherDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})'
 prepared.script=replaceUnique(prepared.script,anchor,anchor+`\n  await verifyNoteTagsDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})\n  report.noteTagsSource={productCommit:PRODUCT_COMMIT,sha:'${pin.tagsBlob}'};save()`)
 prepared.script=replaceUnique(prepared.script,"mark('installed-app-quick-switcher-workflow')","mark('installed-app-quick-switcher-workflow');mark('installed-app-note-tags-workflow')")
 prepared.core=replaceUnique(prepared.core,"'installed-app-quick-switcher-workflow',","'installed-app-quick-switcher-workflow', 'installed-app-note-tags-workflow',")
 return prepared
}
export function validateInstalledNoteTags(report,tags,pin,verifier){
 for(const value of [pin.product,pin.tagsBlob,verifier])assert.match(value,/^[a-f0-9]{40}$/)
 assert.equal(report.productCommit,pin.product);assert.equal(report.verifierCommit,verifier)
 for(const key of ['complete','cleanupComplete','syntheticData','usedDefaultDataPath'])assert.equal(report[key],true)
 assert.equal(report.forceTerminated,false);assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted')
 assert.deepEqual(report.installers,{current:pin.current,previous:pin.previous})
 assert.deepEqual(report.noteTagsSource,{productCommit:pin.product,sha:pin.tagsBlob})
 assert.equal(report.checks.filter(s=>s==='installed-app-note-tags-workflow').length,1)
 assert.equal(tags.commit,verifier)
 for(const key of ['complete','realPackagedApp','realBackend','syntheticData'])assert.equal(tags[key],true)
 assert.deepEqual(tags.checks,NOTE_TAG_CHECKS)
 assert.equal(tags.failureInjection.exactPostResponseOnly,true)
 const faults=tags.failureInjection.faults;assert.equal(faults.length,1)
 assert.equal(faults[0].method,'POST');assert.equal(faults[0].responseStatusCode,200)
 assert.match(faults[0].url,/^http:\/\/127\.0\.0\.1:27121\/api\/note-tags\/[a-f0-9-]{36}$/)
 assert.equal(tags.screenshots.length,1);const shot=tags.screenshots[0]
 assert.equal(shot.filename,'note-tags-installed.png');assert.ok(Number.isSafeInteger(shot.bytes)&&shot.bytes>0);assert.match(shot.sha256,/^[a-f0-9]{64}$/)
 return true
}
