import assert from 'node:assert/strict'
export const HISTORY_PRODUCT = '7b133bf6c717536c81b6a74e8afd8ed992dfb9ce'
export const HISTORY_NATIVE_BLOB = 'c9800f23c9f924d31edb1c7f7c7c4e1a1cf851a6'
export const HISTORY_INSTALLER = Object.freeze({version:'4.220.2',bytes:104211389,sha256:'6f2b6db12e9700571499c36f72290cc37af15120708add6d2eb4920c4157cd69'})
export const HISTORY_CHECKS = Object.freeze([
 'read-error-not-empty','real-history-read-and-correct-snapshot-label','cancel-confirmation-no-write',
 'first-snapshot-restores-through-real-save-and-retains-before-body','dirty-editor-refuses-restore',
 'explicit-original-editor-save-unblocks-history','failed-save-keeps-restored-draft-and-original-database',
 'original-save-retry-recovers-without-second-restore','note-switch-clears-old-selection-and-handles-null-list',
 'reopen-reads-restored-body-from-database','unrelated-fixture-notes-unchanged',
])
export function validateInstalledHistory(report, history, verifier) {
 assert.match(verifier, /^[a-f0-9]{40}$/)
 assert.equal(report.productCommit,HISTORY_PRODUCT);assert.equal(report.verifierCommit,verifier)
 assert.equal(report.complete,true);assert.equal(report.cleanupComplete,true)
 assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted')
 assert.equal(report.syntheticData,true);assert.equal(report.usedDefaultDataPath,true);assert.equal(report.forceTerminated,false)
 assert.deepEqual(report.installers.current,HISTORY_INSTALLER)
 assert.equal(report.installers.previous.version,'4.219.1')
 assert.equal(report.historySource.productCommit,HISTORY_PRODUCT)
 assert.equal(report.historySource.gitBlob,HISTORY_NATIVE_BLOB)
 assert.equal(report.historySource.report,'version-history.json')
 assert.equal(report.historySource.testCodeOnly,true)
 assert.equal(report.checks.filter(v=>v==='installed-app-version-history-workflow').length,1)
 assert.equal(history.commit,verifier);assert.equal(history.complete,true)
 for(const key of ['realPackagedApp','realBackend','syntheticData'])assert.equal(history[key],true)
 assert.deepEqual(history.checks,HISTORY_CHECKS)
 assert.equal(history.failureInjection.mode,'exact-PUT-only')
 const requests=history.failureInjection.requests
 assert.ok(Array.isArray(requests)&&requests.length>=2)
 const blocked=requests.filter(r=>r.blocked===true);assert.equal(blocked.length,1)
 assert.equal(blocked[0].method,'PUT');assert.match(blocked[0].url,/^http:\/\/127\.0\.0\.1:27121\/api\/files\/[A-Za-z0-9-]+$/)
 assert.ok(requests.some(r=>r.method==='GET'&&r.url===blocked[0].url+'/versions'&&r.blocked===false))
 assert.equal(history.screenshots.length,2)
 assert.deepEqual(history.screenshots.map(s=>s.filename),['version-history-restored.png','version-history-empty.png'])
 for(const image of history.screenshots){assert.ok(Number.isSafeInteger(image.bytes)&&image.bytes>0);assert.match(image.sha256,/^[a-f0-9]{64}$/)}
 return true
}
