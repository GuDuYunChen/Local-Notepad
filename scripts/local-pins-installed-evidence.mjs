import assert from 'node:assert/strict'
export const PIN_CHECKS=Object.freeze(['original-context-pin-refreshes-list-after-confirmed-write','pin-changes-neither-body-nor-edited-time','original-menu-unpin-cancel-is-no-write','unpin-does-not-save-or-replace-unsaved-body','cancelled-workspace-entry-retains-original-draft','original-save-persists-body-after-pin-actions','failed-list-read-is-not-empty-and-explicit-retry-recovers','workspace-search-selection-and-pin-complete-without-opening','committed-pin-response-loss-keeps-durable-unconfirmed-record','read-only-reconciliation-and-explicit-ending-never-replay-put','stale-renamed-target-refused-without-navigation','fresh-target-opens-through-original-guard-with-saved-body','close-reopen-retains-current-pin-state-and-note','unrelated-note-bodies-metadata-and-pins-unchanged'])
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unexpected inherited source anchor');return s.replace(a,b)}
export function validatePinsPin(pin){
 for(const k of ['product','quickBlob','tagsBlob','templateBlob','backlinksBlob','searchBlob','outlineBlob','graphBlob','pinsBlob'])assert.match(pin[k],/^[a-f0-9]{40}$/)
 for(const [which,version]of [['current','4.229.0'],['previous','4.228.0']]){
  assert.equal(pin[which].version,version);assert.ok(Number.isSafeInteger(pin[which].bytes)&&pin[which].bytes>0);assert.match(pin[which].sha256,/^[a-f0-9]{64}$/)
 }
 return true
}
export function extendPinsInstallation(prepared,pin){
 validatePinsPin(pin)
 assert.doesNotMatch(prepared.script,/verifyLocalPinsDesktop|localPinsSource|installed-app-local-pins-workflow/)
 assert.doesNotMatch(prepared.core,/installed-app-local-pins-workflow/)
 assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
 const prefix="import {verifyLocalPinsDesktop} from './check-local-pins-desktop.mjs'\n"
 const anchor='  await verifyLocalGraphDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})'
 const addition=anchor+`\n  await verifyLocalPinsDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})\n  report.localPinsSource={productCommit:PRODUCT_COMMIT,sha:'${pin.pinsBlob}'};save()`
 const mark="mark('installed-app-local-graph-workflow')",nextMark=mark+";mark('installed-app-local-pins-workflow')"
 const check="'installed-app-local-graph-workflow',",nextCheck=check+" 'installed-app-local-pins-workflow',"
 const script=prefix+once(once(prepared.script,anchor,addition),mark,nextMark),core=once(prepared.core,check,nextCheck)
 assert.equal(once(once(script.slice(prefix.length),addition,anchor),nextMark,mark),prepared.script)
 assert.equal(once(core,nextCheck,check),prepared.core)
 return {core,script}
}
export function validateInstalledPins(report,pins,pin,verifier){
 validatePinsPin(pin);assert.match(verifier,/^[a-f0-9]{40}$/)
 assert.equal(report.productCommit,pin.product);assert.equal(report.verifierCommit,verifier)
 for(const k of ['complete','cleanupComplete','syntheticData','usedDefaultDataPath'])assert.equal(report[k],true)
 assert.equal(report.forceTerminated,false);assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted')
 assert.deepEqual(report.installers,{current:pin.current,previous:pin.previous})
 assert.deepEqual(report.localPinsSource,{productCommit:pin.product,sha:pin.pinsBlob})
 assert.equal(report.checks.filter(s=>s==='installed-app-local-pins-workflow').length,1)
 assert.equal(pins.commit,verifier)
 for(const k of ['complete','realPackagedApp','realBackend','syntheticData'])assert.equal(pins[k],true)
 assert.deepEqual(pins.checks,PIN_CHECKS)
 assert.equal(pins.failureInjection.exactCommittedPutResponseOnly,true)
 assert.equal(pins.failureInjection.faults.length,1)
 const fault=pins.failureInjection.faults[0]
 assert.equal(fault.method,'PUT');assert.equal(fault.responseStatusCode,200)
 assert.match(fault.url,/^http:\/\/127\.0\.0\.1:27121\/api\/local-pins\/[a-f0-9-]{36}$/)
 assert.equal(pins.screenshots.length,1);const image=pins.screenshots[0]
 assert.equal(image.filename,'local-pins-installed.png');assert.ok(Number.isSafeInteger(image.bytes)&&image.bytes>0);assert.match(image.sha256,/^[a-f0-9]{64}$/)
 return true
}
