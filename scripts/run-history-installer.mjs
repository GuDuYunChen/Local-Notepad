// Extend the accepted installer verifier, never the installed application's code.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { assertHostedWindows, validateLifecycleReport } from './installer-lifecycle-core.mjs'
import { prepareShellVerifiedLifecycle, validateShortcutCompletion, replaceUnique, gitBlob } from './installer-shell-core.mjs'
import { HISTORY_PRODUCT, HISTORY_NATIVE_BLOB, validateInstalledHistory } from './history-installation-evidence.mjs'
assertHostedWindows(process.env,process.platform)
const out=path.resolve('test-results/installer-lifecycle');mkdirSync(out,{recursive:true})
const read=file=>readFileSync(new URL(file,import.meta.url),'utf8').replace(/\r\n/g,'\n')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const preparedFile=new URL('./check-windows-installer-lifecycle.history.mjs',import.meta.url)
if(process.argv[2]==='prepare') {
 const core=read('./installer-lifecycle-core.mjs')
 assert.equal(gitBlob(core),'e9c64b370582da9b21a8ea299ef40db01eb96b0a')
 assert.equal(gitBlob(read('./check-version-history-desktop.mjs')),HISTORY_NATIVE_BLOB)
 const original=read('./check-windows-installer-lifecycle.mjs')
 let prepared=prepareShellVerifiedLifecycle(original)
 prepared=replaceUnique(prepared,"which==='previous'","which==='previous' && RELEASES.previous.version==='4.218.0'")
 prepared=replaceUnique(prepared,'const ws=new WebSocket(url),pending=new Map();let next=0','const ws=new WebSocket(url),pending=new Map(),eventListeners=new Set();let next=0')
 prepared=replaceUnique(prepared,'catch{fail();return}const p=pending.get(m.id)','catch{fail();return}if(m.method)for(const listener of [...eventListeners])listener(m);const p=pending.get(m.id)')
 prepared=replaceUnique(prepared,'return {close:()=>ws.close(),send(method,params={})','return {close:()=>{eventListeners.clear();ws.close()},onEvent(listener){eventListeners.add(listener);return()=>eventListeners.delete(listener)},send(method,params={})')
 prepared=replaceUnique(prepared,'  await verifyTrashWorkspaceDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})',`  await verifyTrashWorkspaceDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})
  await verifyVersionHistoryDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})
  report.historySource={productCommit:PRODUCT_COMMIT,gitBlob:'${HISTORY_NATIVE_BLOB}',report:'version-history.json',testCodeOnly:true};save()`)
 prepared=replaceUnique(prepared,"  await closeApp();mark('installed-app-trash-workflow')","  await closeApp();mark('installed-app-trash-workflow');mark('installed-app-version-history-workflow')")
 prepared="import { verifyVersionHistoryDesktop } from './check-version-history-desktop.mjs'\n"+prepared
 let next=replaceUnique(core,"export const PRODUCT_COMMIT = '048a9ca0f70b32fed1afc0f162e297789c781747'",`export const PRODUCT_COMMIT = '${HISTORY_PRODUCT}'`)
 next=replaceUnique(next,"current: Object.freeze({ version: '4.219.1', bytes: 104200796,\n    sha256: 'cc7fdda96c42ab8993c5ada71a0e1462ef5c894035609d0216cb624995fb5e5e' })","current: Object.freeze({ version: '4.220.2', bytes: 104211389,\n    sha256: '6f2b6db12e9700571499c36f72290cc37af15120708add6d2eb4920c4157cd69' })")
 next=replaceUnique(next,"previous: Object.freeze({ version: '4.218.0', bytes: 104182839,\n    sha256: '0e585aad28c4569666d7ed29c927b6b3bd207571fd0e7b9400fb0fdc93c10909' })","previous: Object.freeze({ version: '4.219.1', bytes: 104200796,\n    sha256: 'cc7fdda96c42ab8993c5ada71a0e1462ef5c894035609d0216cb624995fb5e5e' })")
 next=replaceUnique(next,"'installed-app-trash-workflow',","'installed-app-trash-workflow', 'installed-app-version-history-workflow',")
 // All checks finish before the two owned verification files are written.
 assert.equal(existsSync(preparedFile),false)
 writeFileSync(path.join(out,'original-lifecycle-core.txt'),core,{flag:'wx'})
 writeFileSync(path.join(out,'original-lifecycle-verifier.txt'),original,{flag:'wx'})
 writeFileSync(new URL('./installer-lifecycle-core.mjs',import.meta.url),next)
 writeFileSync(preparedFile,prepared,{flag:'wx'})
 writeFileSync(path.join(out,'prepared-lifecycle-core.txt'),next,{flag:'wx'})
 writeFileSync(path.join(out,'prepared-lifecycle-verifier.txt'),prepared,{flag:'wx'})
 writeFileSync(path.join(out,'history-verifier-source.json'),JSON.stringify({productCommit:HISTORY_PRODUCT,verifierCommit:process.env.GITHUB_SHA,originalCore:gitBlob(core),preparedCore:gitBlob(next),originalVerifier:gitBlob(original),preparedVerifier:gitBlob(prepared),historyNative:HISTORY_NATIVE_BLOB,productionModified:false},null,2))
} else if(process.argv[2]==='run') {
 const reportFile=path.join(out,'installation.json')
 try {
  await import(preparedFile.href)
  const report=JSON.parse(readFileSync(reportFile,'utf8'))
  const history=JSON.parse(readFileSync(path.join(out,'version-history.json'),'utf8'))
  validateLifecycleReport(report);validateShortcutCompletion(report)
  validateInstalledHistory(report,history,process.env.GITHUB_SHA)
  for(const image of history.screenshots){const bytes=readFileSync(path.join(out,image.filename));assert.equal(bytes.length,image.bytes);assert.equal(sha(bytes),image.sha256)}
  writeFileSync(path.join(out,'history-installation-accepted.json'),JSON.stringify({complete:true,productCommit:HISTORY_PRODUCT,verifierCommit:process.env.GITHUB_SHA,installer:report.installers.current,historyChecks:history.checks,installationChecks:report.checks,screenshotsVerified:true,installationScope:'actual hosted Windows current-user silent NSIS'},null,2))
 } catch(error) {
  if(existsSync(reportFile)){const report=JSON.parse(readFileSync(reportFile,'utf8'));report.complete=false;report.error=String(error.stack||error);writeFileSync(reportFile,JSON.stringify(report,null,2))}
  throw error
 }
} else throw Error('Expected prepare or run')
