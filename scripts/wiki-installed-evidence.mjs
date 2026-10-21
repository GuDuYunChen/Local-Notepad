import assert from 'node:assert/strict'
export const WIKI_CHECKS=Object.freeze(["original-wiki-picker-inserts-a-real-section-reference","hover-preview-reads-target-without-saving-source-draft","cancelled-link-opening-keeps-source-draft-and-database-body","original-save-persists-the-inserted-wiki-reference","failed-target-read-keeps-source-and-exposes-explicit-retry","retry-opens-latest-target-and-exact-section-through-original-guard","renamed-target-uses-fresh-title-and-body-not-preview-cache","duplicate-heading-path-refuses-to-choose-the-first-section","explicit-body-only-fallback-opens-note-without-guessing-section","stopped-real-response-cannot-navigate-after-it-is-released","new-explicit-activation-recovers-after-a-stopped-read","accepted-section-waits-for-the-real-editor-body-read","ordinary-target-reopen-cannot-revive-the-abandoned-section","deleted-reference-refuses-navigation-without-removing-the-link","closing-error-feedback-preserves-the-saved-source-and-reference","unrelated-note-bodies-metadata-and-pins-remain-unchanged"])
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unexpected inherited source anchor');return s.replace(a,b)}
export function validateWikiPin(pin){
 for(const k of ['product','quickBlob','tagsBlob','templateBlob','backlinksBlob','searchBlob','outlineBlob','graphBlob','pinsBlob','recentBlob','wikiBlob'])assert.match(pin[k],/^[a-f0-9]{40}$/)
 for(const[which,version]of [['current','4.231.2'],['previous','4.230.1']]){
  assert.equal(pin[which].version,version);assert.ok(Number.isSafeInteger(pin[which].bytes)&&pin[which].bytes>0);assert.match(pin[which].sha256,/^[a-f0-9]{64}$/)
 }
 return true
}
export function extendWikiInstallation(prepared,pin){
 validateWikiPin(pin)
 assert.doesNotMatch(prepared.script,/verifyWikiNavigationDesktop|wikiNavigationSource|installed-app-wiki-navigation-workflow/)
 assert.doesNotMatch(prepared.core,/installed-app-wiki-navigation-workflow/)
 assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
 const prefix="import {verifyWikiNavigationDesktop} from './check-wiki-navigation-desktop.mjs'\n"
 const anchor='  await verifyRecentNotesDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})'
 const addition=anchor+`\n  await verifyWikiNavigationDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})\n  report.wikiNavigationSource={productCommit:PRODUCT_COMMIT,sha:'${pin.wikiBlob}'};save()`
 const mark="mark('installed-app-recent-notes-workflow')",nextMark=mark+";mark('installed-app-wiki-navigation-workflow')"
 const check="'installed-app-recent-notes-workflow',",nextCheck=check+" 'installed-app-wiki-navigation-workflow',"
 const script=prefix+once(once(prepared.script,anchor,addition),mark,nextMark),core=once(prepared.core,check,nextCheck)
 assert.equal(once(once(script.slice(prefix.length),addition,anchor),nextMark,mark),prepared.script)
 assert.equal(once(core,nextCheck,check),prepared.core)
 return {core,script}
}
export function validateInstalledWiki(report,wiki,pin,verifier){
 validateWikiPin(pin);assert.match(verifier,/^[a-f0-9]{40}$/)
 assert.equal(report.productCommit,pin.product);assert.equal(report.verifierCommit,verifier)
 for(const k of ['complete','cleanupComplete','syntheticData','usedDefaultDataPath'])assert.equal(report[k],true)
 assert.equal(report.forceTerminated,false);assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted')
 assert.deepEqual(report.installers,{current:pin.current,previous:pin.previous})
 assert.deepEqual(report.wikiNavigationSource,{productCommit:pin.product,sha:pin.wikiBlob})
 assert.equal(report.checks.filter(s=>s==='installed-app-wiki-navigation-workflow').length,1)
 assert.equal(wiki.commit,verifier)
 for(const k of ['complete','realPackagedApp','realBackend','syntheticData'])assert.equal(wiki[k],true)
 assert.deepEqual(wiki.checks,WIKI_CHECKS)
 assert.deepEqual(wiki.delayedRead,{realResponse:true,method:'GET',responseStatusCode:200,replayed:false})
 assert.deepEqual(wiki.delayedBodyRead,{verification:{method:'GET',responseStatusCode:200,continuedUnchanged:true},editor:{method:'GET',responseStatusCode:200},selectedBeforeBodyReady:true,replayed:false,ordinaryReopen:{sourceRetained:true,targetLoaded:true,anchorEvents:0,outlineOpened:false}})
 assert.deepEqual(wiki.unavailableTarget,{deletionConfirmed:true,readRejected:true,navigationRejected:true})
 assert.deepEqual(wiki.screenshots.map(image=>image.filename),['wiki-navigation-body-return-installed.png','wiki-navigation-installed.png'])
 for(const image of wiki.screenshots){assert.ok(Number.isSafeInteger(image.bytes)&&image.bytes>0);assert.match(image.sha256,/^[a-f0-9]{64}$/)}
 return true
}
