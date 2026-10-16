import assert from 'node:assert/strict'
// Extend the existing tested lifecycle; do not replace its body/save/exit policy.
export const GRAPH_CHECKS=Object.freeze(["real-wiki-insertion-and-original-save-create-directed-index","cancelled-graph-entry-preserves-current-draft","failed-graph-read-is-not-empty-success","explicit-retry-renders-linked-and-isolated-notes","literal-search-empty-and-recovery-do-not-create-notes","node-selection-shows-directed-relations-without-opening","real-svg-zoom-and-fit-controls-work","one-hop-focus-and-clear-return-complete-view","stale-renamed-target-refused-before-navigation","refresh-and-original-guard-open-current-target","close-reopen-and-isolated-note-workflow-complete","unrelated-bodies-and-metadata-remain-unchanged"])
export const OUTLINE_CHECKS=Object.freeze(["empty-document-keeps-entry-and-explains-no-headings","single-heading-shortcut-and-navigation-preserve-body","search-foreground-handoff-preserves-outline-and-body","literal-search-locates-the-exact-visible-section","return-restores-original-scroll-position","no-match-and-clear-query-recover-full-outline","search-navigation-reveals-folded-content-without-text-mutation","native-clipboard-contains-exact-current-heading-anchor","ambiguous-section-copy-is-refused-with-visible-explanation","outline-navigation-does-not-save-or-replace-unsaved-draft","original-save-persists-draft-after-outline-use","close-switch-reopen-has-no-stale-query-fold-or-document","unrelated-notes-and-metadata-remain-unchanged"])
export const SEARCH_CHECKS=Object.freeze(["ctrl-f-current-document-search-does-not-dirty-body","previous-next-real-controls-navigate-exact-matches","case-sensitive-option-and-genuine-no-match","whole-word-option-does-not-consume-partial-identifiers","bulk-replacement-cancel-preserves-body","confirmed-bulk-replacement-keeps-unicode-prefix-and-original-save-boundary","single-original-undo-restores-bulk-edit","original-redo-and-save-persist-replacement","single-replacement-leaves-other-occurrence","close-switch-and-reopen-read-saved-document-without-stale-panel","other-note-bodies-and-metadata-unchanged"])
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unexpected inherited source anchor');return s.replace(a,b)}
export function validateGraphPin(pin){
 for(const k of ['product','quickBlob','tagsBlob','templateBlob','backlinksBlob','searchBlob','outlineBlob','graphBlob'])assert.match(pin[k],/^[a-f0-9]{40}$/)
 for(const [which,version]of [['current','4.228.0'],['previous','4.227.1']]){
  assert.equal(pin[which].version,version);assert.ok(Number.isSafeInteger(pin[which].bytes)&&pin[which].bytes>0);assert.match(pin[which].sha256,/^[a-f0-9]{64}$/)
 }
 return true
}
export function extendGraphInstallation(prepared,pin){
 validateGraphPin(pin)
 assert.doesNotMatch(prepared.script,/verifyLocalGraphDesktop|localGraphSource|installed-app-local-graph-workflow/)
 assert.doesNotMatch(prepared.core,/installed-app-local-graph-workflow/)
 assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
 const prefix="import {verifyLocalGraphDesktop} from './check-local-graph-desktop.mjs'\n"
 const anchor='  await verifyDocumentOutlineDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})'
 const addition=anchor+`\n  await verifyLocalGraphDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})\n  report.localGraphSource={productCommit:PRODUCT_COMMIT,sha:'${pin.graphBlob}'};save()`
 const mark="mark('installed-app-document-outline-workflow')", nextMark=mark+";mark('installed-app-local-graph-workflow')"
 const check="'installed-app-document-outline-workflow',", nextCheck=check+" 'installed-app-local-graph-workflow',"
 const script=prefix+once(once(prepared.script,anchor,addition),mark,nextMark)
 const core=once(prepared.core,check,nextCheck)
 // Inverse proof: the old lifecycle bytes survive the one new module hook.
 assert.equal(once(once(script.slice(prefix.length),addition,anchor),nextMark,mark),prepared.script)
 assert.equal(once(core,nextCheck,check),prepared.core)
 return {core,script}
}
export function validateInstalledGraph(report,graph,outline,search,pin,verifier){
 validateGraphPin(pin);assert.match(verifier,/^[a-f0-9]{40}$/)
 assert.equal(report.productCommit,pin.product);assert.equal(report.verifierCommit,verifier)
 for(const k of ['complete','cleanupComplete','syntheticData','usedDefaultDataPath'])assert.equal(report[k],true)
 assert.equal(report.forceTerminated,false);assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted')
 assert.deepEqual(report.installers,{current:pin.current,previous:pin.previous})
 // Preserve every previous outline/search field check, under the new binary pins.
 for(const [name,detail,key,source,expected,shot] of [
  ['local-graph',graph,'localGraphSource',pin.graphBlob,GRAPH_CHECKS,'local-graph-installed.png'],
  ['document-outline',outline,'documentOutlineSource',pin.outlineBlob,OUTLINE_CHECKS,'document-outline-installed.png'],
  ['document-search',search,'documentSearchSource',pin.searchBlob,SEARCH_CHECKS,'document-search-installed.png'],
 ]){
  assert.deepEqual(report[key],{productCommit:pin.product,sha:source})
  assert.equal(report.checks.filter(s=>s==='installed-app-'+name+'-workflow').length,1)
  assert.equal(detail.commit,verifier)
  for(const k of ['complete','realPackagedApp','realBackend','syntheticData'])assert.equal(detail[k],true)
  assert.deepEqual(detail.checks,expected);assert.equal(detail.screenshots.length,1)
  const image=detail.screenshots[0];assert.equal(image.filename,shot);assert.ok(Number.isSafeInteger(image.bytes)&&image.bytes>0);assert.match(image.sha256,/^[a-f0-9]{64}$/)
 }
 return true
}
