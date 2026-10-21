import assert from 'node:assert/strict'
import {replaceUnique} from './installer-shell-core.mjs'
import {prepareTemplateInstallation} from './template-installed-evidence.mjs'
export const QUICK_CHECKS=Object.freeze(['failed-read-is-not-empty','ctrl-k-entry-and-explicit-read-retry','enter-opens-fresh-body-not-list-snapshot','cancel-original-draft-dialog-preserves-query-and-draft','escape-and-original-editor-save-remain-functional','failed-live-target-does-not-leave-current-note','target-failure-manual-refresh-and-open','genuine-empty-search-remains-distinct','full-search-handoff-and-close','unrelated-and-unedited-notes-unchanged'])
export function prepareQuickInstallation(core,original,quickBlob){
 assert.match(quickBlob,/^[0-9a-f]{40}$/)
 const prepared=prepareTemplateInstallation(core,original)
 prepared.script="import { verifyQuickSwitcherDesktop } from './check-quick-switcher-desktop.mjs'\n"+prepared.script
 prepared.script=replaceUnique(prepared.script,'  await verifyTemplateLibraryDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})',`  await verifyTemplateLibraryDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})\n  await verifyQuickSwitcherDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})\n  report.quickSource={productCommit:PRODUCT_COMMIT,sha:'${quickBlob}'};save()`)
 prepared.script=replaceUnique(prepared.script,"mark('installed-app-template-library-workflow')","mark('installed-app-template-library-workflow');mark('installed-app-quick-switcher-workflow')")
 prepared.core=replaceUnique(prepared.core,"'installed-app-template-library-workflow',","'installed-app-template-library-workflow', 'installed-app-quick-switcher-workflow',")
 return prepared
}
export function validateInstalledQuick(report,quick,pin,verifier){
 assert.match(pin.product,/^[0-9a-f]{40}$/);assert.match(pin.quickBlob,/^[0-9a-f]{40}$/);assert.match(verifier,/^[0-9a-f]{40}$/)
 assert.equal(report.productCommit,pin.product);assert.equal(report.verifierCommit,verifier)
 assert.equal(report.complete,true);assert.equal(report.cleanupComplete,true);assert.equal(report.forceTerminated,false)
 assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted');assert.equal(report.syntheticData,true)
 assert.deepEqual(report.installers.current,pin.current);assert.deepEqual(report.installers.previous,pin.previous)
 assert.deepEqual(report.quickSource,{productCommit:pin.product,sha:pin.quickBlob})
 assert.equal(report.checks.filter(s=>s==='installed-app-quick-switcher-workflow').length,1)
 assert.equal(quick.commit,verifier)
 for(const key of ['complete','realPackagedApp','realBackend','syntheticData'])assert.equal(quick[key],true)
 assert.deepEqual(quick.checks,QUICK_CHECKS)
 assert.equal(quick.screenshots.length,1);const s=quick.screenshots[0]
 assert.equal(s.filename,'quick-switcher-installed.png');assert.ok(Number.isSafeInteger(s.bytes)&&s.bytes>0);assert.match(s.sha256,/^[0-9a-f]{64}$/)
 return true
}
