import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { APPEARANCE_SOURCES, APPEARANCE_CHECKS, APPEARANCE_FEEDBACK, APPEARANCE_IMAGES, APPEARANCE_REPORT, appearanceHash, validateAppearanceNativeReport, verifyAppearanceNativeReport } from './appearance-desktop-evidence.mjs'
import { adaptDraftVersion, buildAppearanceRunner, copyAppearanceInstallerCore } from './prepare-appearance-verifier.mjs'
// Schema/refusal fixtures ONLY. They cannot establish native execution.
function fixture() {
  const sources=Object.fromEntries(APPEARANCE_SOURCES.map(file=>[file,'a'.repeat(40)]))
  const expected={product:'b'.repeat(40),verifier:'c'.repeat(40),sources}
  const exits=[100,101,102].map(pid=>({pid,code:0,signal:null,normal:true}))
  const report={schemaVersion:1,module:'2F.105',version:'4.238.0',productCommit:expected.product,verifierCommit:expected.verifier,
    platform:'win32',runnerEnvironment:'github-hosted',scope:'installed-default-profile',defaultProfile:true,nativeAcceptance:true,
    syntheticData:true,realBackend:true,bridgeOverridden:false,timerAccelerated:false,complete:true,cleanupComplete:true,forcedFailureCleanup:false,
    sourceFiles:sources,checks:[...APPEARANCE_CHECKS],app:{packaged:true,version:'4.238.0'},executableSHA256:'1'.repeat(64),asarSHA256:'2'.repeat(64),backendSHA256:'3'.repeat(64),
    crashes:[],launches:[100,101,102].map(pid=>({pid})),exits,exit:exits[2],backendStopped:true,storageDirectoriesRemoved:true,
    installationCommands:['initial-install','same-version-install','uninstall','reinstall','final-uninstall'].map(operation=>({operation,code:0,signal:null,timedOut:false})),
    retention:['same-version-install','uninstall','reinstall'].map(operation=>({operation,equal:true,files:12,digest:'4'.repeat(64)})),
    feedback:Object.fromEntries(APPEARANCE_FEEDBACK.map(name=>[name,{text:'schema fixture only',role:'alert',top:100,bottom:122,left:20,right:650,areaTop:90,areaBottom:140,footerTop:150,viewportWidth:704,viewportHeight:455,hit:true,outsideScroll:true}])),
    trustedMouseInput:true,trustedKeyboardInput:true,quota:{error:'QuotaExceededError',keys:23,originalConfigurationPreserved:true,retryReadBack:true},
    externalChange:{method:'same-origin-frame-real-storage-event',previewRevoked:true,statusText:'有尚未应用的方案更改。',footerText:'仅本机配置',cancelPreviewDisabled:true},corruption:{explicitTestDataInjection:true,automaticOverwrite:false,explicitRepairReadBack:true},
    fileImport:{method:'DOM.setFileInputFiles-real-file',noWriteBeforeApply:true},fileExport:{format:'local-notepad-appearance',version:1,bytes:140,sha256:'5'.repeat(64)},
    configuration:{sha256:'6'.repeat(64),restartedRawEqual:true,reinstalledRawEqual:true},note:{bodyWrites:0,before:'7'.repeat(64),after:'7'.repeat(64)},
    viewport:{width:704,height:481,horizontalOverflow:false,footerReachable:true},screenshots:APPEARANCE_IMAGES.map(filename=>({filename,bytes:128,sha256:'8'.repeat(64)}))}
  return {report,expected}
}
test('complete synthetic schema is recognized, not evidence of native execution',()=>{const{report,expected}=fixture();assert.equal(validateAppearanceNativeReport(report,expected),true)})
const mutations={
  incomplete:r=>r.complete=false, cleanup:r=>r.cleanupComplete=false, forced:r=>r.forcedFailureCleanup=true,
  error:r=>r.error={}, cleanupError:r=>r.cleanupError='failure', product:r=>r.productCommit='d'.repeat(40), verifier:r=>r.verifierCommit='e'.repeat(40),
  linux:r=>r.platform='linux', selfHosted:r=>r.runnerEnvironment='self-hosted', customProfile:r=>r.defaultProfile=false,
  simulated:r=>r.nativeAcceptance=false, mockBackend:r=>r.realBackend=false, bridge:r=>r.bridgeOverridden=true, timers:r=>r.timerAccelerated=true,
  source:r=>r.sourceFiles={}, version:r=>r.version='4.237.0', unpackaged:r=>r.app.packaged=false, appVersion:r=>r.app.version='4.237.0',
  badExecutable:r=>r.executableSHA256='', crash:r=>r.crashes.push({}), reusedPid:r=>r.launches[2].pid=100,
  missingExit:r=>r.exits.pop(), failedExit:r=>r.exits[0].code=1, backendAlive:r=>r.backendStopped=false,
  leftData:r=>r.storageDirectoriesRemoved=false, missingInstall:r=>r.installationCommands.pop(), failedUninstall:r=>r.installationCommands[2].code=1,
  timedOut:r=>r.installationCommands[0].timedOut=true, missingRetention:r=>r.retention.pop(), alteredRetention:r=>r.retention[0].equal=false,
  emptyRetention:r=>r.retention[1].files=0, untrustedMouse:r=>r.trustedMouseInput=false, untrustedKey:r=>r.trustedKeyboardInput=false,
  fakeQuota:r=>r.quota.error='InjectedError', noQuota:r=>r.quota.keys=0, quotaOverwrite:r=>r.quota.originalConfigurationPreserved=false,
  noRetry:r=>r.quota.retryReadBack=false, artificialStorageEvent:r=>r.externalChange.method='dispatchEvent', previewRemains:r=>r.externalChange.previewRevoked=false,
  silentRepair:r=>r.corruption.automaticOverwrite=true, hiddenCorruption:r=>r.corruption.explicitTestDataInjection=false,
  fakeImport:r=>r.fileImport.method='direct-service-call', autoApply:r=>r.fileImport.noWriteBeforeApply=false,
  missingExport:r=>r.fileExport.bytes=0, wrongExport:r=>r.fileExport.format='arbitrary', oversizeExport:r=>r.fileExport.bytes=20000,
  restartLost:r=>r.configuration.restartedRawEqual=false, reinstallLost:r=>r.configuration.reinstalledRawEqual=false,
  bodyWritten:r=>r.note.bodyWrites=1, bodyChanged:r=>r.note.after='9'.repeat(64), largeWindow:r=>r.viewport.width=1280,
  overflow:r=>r.viewport.horizontalOverflow=true, unreachableFooter:r=>r.viewport.footerReachable=false,
  missingImage:r=>r.screenshots.pop(), traversal:r=>r.screenshots[0].filename='../outside.png', duplicateImage:r=>r.screenshots[1]=r.screenshots[0],
}
for(const [name,mutate] of Object.entries(mutations))test('refuses '+name,()=>{const{report,expected}=fixture();const r=structuredClone(report);mutate(r);assert.throws(()=>validateAppearanceNativeReport(r,expected))})
for(const check of APPEARANCE_CHECKS)test('refuses omitted workflow '+check,()=>{const{report,expected}=fixture();report.checks=report.checks.filter(item=>item!==check);assert.throws(()=>validateAppearanceNativeReport(report,expected))})
test('requires external identities and exact source roster',()=>{const{report,expected}=fixture();assert.throws(()=>validateAppearanceNativeReport(report,{}));assert.throws(()=>validateAppearanceNativeReport(report,{...expected,native:false}));assert.throws(()=>validateAppearanceNativeReport(report,{...expected,sources:{}}))})
test('revalidates exported bytes and each screenshot',()=>{
 const out=mkdtempSync(path.join(tmpdir(),'appearance105-contract-'))
 try{const{report,expected}=fixture();const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(120)])
 for(const image of report.screenshots){image.sha256=appearanceHash(png);writeFileSync(path.join(out,image.filename),png)}
 const exported=Buffer.from(JSON.stringify({format:'local-notepad-appearance',version:1,scheme:{name:'contract',lightAccent:'#176b4a',darkAccent:'#80d6ad'}}))
 report.fileExport.bytes=exported.length;report.fileExport.sha256=appearanceHash(exported);writeFileSync(path.join(out,'exported-theme.json'),exported)
 writeFileSync(path.join(out,APPEARANCE_REPORT),JSON.stringify(report));assert.equal(verifyAppearanceNativeReport(out,expected).complete,true)
 writeFileSync(path.join(out,'exported-theme.json'),'{}');assert.throws(()=>verifyAppearanceNativeReport(out,expected))
 writeFileSync(path.join(out,'exported-theme.json'),exported);writeFileSync(path.join(out,report.screenshots[0].filename),'bad');assert.throws(()=>verifyAppearanceNativeReport(out,expected))
 }finally{rmSync(out,{recursive:true,force:true})}
})
test('unreviewed retained templates cannot generate passing verifiers',()=>{assert.throws(()=>adaptDraftVersion('unknown',''));assert.throws(()=>adaptDraftVersion('run-draft-durability-desktop.mjs','4.237.0'));assert.throws(()=>buildAppearanceRunner('arbitrary code'))})
test('native driver observes real file operations and retained original lifecycle',()=>{
 const s=readFileSync(new URL('./appearance-desktop-driver.mjs',import.meta.url),'utf8')
 for(const pattern of [/Input\.dispatchKeyEvent/,/Input\.insertText/,/DOM\.setFileInputFiles/,/Page\.setDownloadBehavior/,/QuotaExceededError/,/reinstallWithRetainedDraft\(\)/,/bodyWritesSince/,/resizeSmall\(\)/])assert.match(s,pattern)
 assert.doesNotMatch(s,/window\.electronAPI\s*=|setInterval\s*=|setTimeout\s*=|Emulation\.setDeviceMetricsOverride/)
})

test('appearance freezes the exact original installer helper before inherited preparation',()=>{
 const core=readFileSync(new URL('./installer-lifecycle-core.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n')
 assert.equal(copyAppearanceInstallerCore(core),core)
 assert.ok(APPEARANCE_SOURCES.includes('scripts/appearance-installer-core.mjs'))
 assert.equal(APPEARANCE_SOURCES.includes('scripts/installer-lifecycle-core.mjs'),false)
})
test('a changed shared installer core is rejected rather than repinned',()=>{
 const core=readFileSync(new URL('./installer-lifecycle-core.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n')
 assert.throws(()=>copyAppearanceInstallerCore(core+'\n'))
 assert.throws(()=>copyAppearanceInstallerCore(core.replace('assertHostedWindows','weakenedGuard')))
})

for (const name of APPEARANCE_FEEDBACK) {
  test('refuses missing visible feedback '+name,()=>{const {report,expected}=fixture();delete report.feedback[name];assert.throws(()=>validateAppearanceNativeReport(report,expected))})
  test('refuses feedback clipped by its scroll area '+name,()=>{const {report,expected}=fixture();report.feedback[name].bottom=200;assert.throws(()=>validateAppearanceNativeReport(report,expected))})
}
for (const [key,value] of [['hit',false],['outsideScroll',false],['top',NaN],['right',900],['role','unknown']]) test('refuses feedback '+key,()=>{const {report,expected}=fixture();report.feedback.saved[key]=value;assert.throws(()=>validateAppearanceNativeReport(report,expected))})

for (const [key,value] of [['statusText','正在预览，尚未保存。'],['footerText','预览中 · 未保存'],['cancelPreviewDisabled',false]]) test('refuses contradictory stopped-preview '+key,()=>{const {report,expected}=fixture();report.externalChange[key]=value;assert.throws(()=>validateAppearanceNativeReport(report,expected))})
test('refuses missing stopped-preview observations rather than inferring them from colors',()=>{
 for(const key of ['statusText','footerText','cancelPreviewDisabled']){const {report,expected}=fixture();delete report.externalChange[key];assert.throws(()=>validateAppearanceNativeReport(report,expected))}
})
