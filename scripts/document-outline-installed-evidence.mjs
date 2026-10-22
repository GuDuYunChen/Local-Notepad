import assert from 'node:assert/strict'
import {replaceUnique} from './installer-shell-core.mjs'
import {prepareDocumentSearchInstallation,DOCUMENT_SEARCH_CHECKS} from './document-search-installed-evidence.mjs'
export const DOCUMENT_OUTLINE_CHECKS=Object.freeze(["empty-document-keeps-entry-and-explains-no-headings", "single-heading-shortcut-and-navigation-preserve-body", "search-foreground-handoff-preserves-outline-and-body", "literal-search-locates-the-exact-visible-section", "return-restores-original-scroll-position", "no-match-and-clear-query-recover-full-outline", "search-navigation-reveals-folded-content-without-text-mutation", "native-clipboard-contains-exact-current-heading-anchor", "ambiguous-section-copy-is-refused-with-visible-explanation", "outline-navigation-does-not-save-or-replace-unsaved-draft", "original-save-persists-draft-after-outline-use", "close-switch-reopen-has-no-stale-query-fold-or-document", "unrelated-notes-and-metadata-remain-unchanged"])
export function prepareOutlineInstallation(core,original,pin){
 assert.match(pin.outlineBlob,/^[a-f0-9]{40}$/)
 const result=prepareDocumentSearchInstallation(core,original,pin)
 result.script="import {verifyDocumentOutlineDesktop} from './check-document-outline-desktop.mjs'\n"+result.script
 const anchor='  await verifyDocumentSearchDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})'
 result.script=replaceUnique(result.script,anchor,anchor+`\n  await verifyDocumentOutlineDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})\n  report.documentOutlineSource={productCommit:PRODUCT_COMMIT,sha:'${pin.outlineBlob}'};save()`)
 result.script=replaceUnique(result.script,"mark('installed-app-document-search-workflow')","mark('installed-app-document-search-workflow');mark('installed-app-document-outline-workflow')")
 result.core=replaceUnique(result.core,"'installed-app-document-search-workflow',","'installed-app-document-search-workflow', 'installed-app-document-outline-workflow',")
 return result
}
export function validateInstalledOutline(report,outline,search,pin,verifier){
 for(const v of [pin.product,pin.outlineBlob,pin.searchBlob,verifier])assert.match(v,/^[a-f0-9]{40}$/)
 for(const[which,version]of [['current','4.227.1'],['previous','4.226.0']]){
  assert.equal(pin[which].version,version);assert.ok(Number.isSafeInteger(pin[which].bytes)&&pin[which].bytes>0);assert.match(pin[which].sha256,/^[a-f0-9]{64}$/)
 }
 assert.equal(report.productCommit,pin.product);assert.equal(report.verifierCommit,verifier)
 for(const k of ['complete','cleanupComplete','syntheticData','usedDefaultDataPath'])assert.equal(report[k],true)
 assert.equal(report.forceTerminated,false);assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted');assert.deepEqual(report.installers,{current:pin.current,previous:pin.previous})
 for(const[name,detail,source,checks,shot]of [
  ['document-outline',outline,pin.outlineBlob,DOCUMENT_OUTLINE_CHECKS,'document-outline-installed.png'],
  ['document-search',search,pin.searchBlob,DOCUMENT_SEARCH_CHECKS,'document-search-installed.png'],
 ]){
  const key=name==='document-outline'?'documentOutlineSource':'documentSearchSource'
  assert.deepEqual(report[key],{productCommit:pin.product,sha:source})
  assert.equal(report.checks.filter(s=>s==='installed-app-'+name+'-workflow').length,1)
  assert.equal(detail.commit,verifier)
  for(const k of ['complete','realPackagedApp','realBackend','syntheticData'])assert.equal(detail[k],true)
  assert.deepEqual(detail.checks,checks);assert.equal(detail.screenshots.length,1)
  const image=detail.screenshots[0];assert.equal(image.filename,shot);assert.ok(Number.isSafeInteger(image.bytes)&&image.bytes>0);assert.match(image.sha256,/^[a-f0-9]{64}$/)
 }
 return true
}
