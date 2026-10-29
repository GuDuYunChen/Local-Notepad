import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {RECOVERY_SOURCES,recoveryBlob} from './trash-recovery-desktop-evidence.mjs'
export function buildTrashRecoveryRunner(original){
 assert.equal(recoveryBlob(original),'e17f7b044eac4aeb62cdc9f5a86e6796b9ed9db3','Unreviewed folder workspace process owner')
 const changes=[
 [
  "FOLDER_REPORT as DRAFT_REPORT, FOLDER_SOURCES as DRAFT_SOURCES, folderHash as draftHash, folderBlob as draftBlob, verifyFolderNativeReport as verifyDraftDurabilityReport",
  "RECOVERY_REPORT as DRAFT_REPORT, RECOVERY_SOURCES as DRAFT_SOURCES, recoveryHash as draftHash, recoveryBlob as draftBlob, verifyRecoveryNativeReport as verifyDraftDurabilityReport"
 ],
 [
  "from './folder-workspace-desktop-evidence.mjs'",
  "from './trash-recovery-desktop-evidence.mjs'"
 ],
 [
  "import { verifyFolderWorkspaceDesktop as verifyDraftDurabilityDesktop } from './folder-workspace-desktop-driver.mjs'",
  "import { verifyTrashRecoveryDesktop as verifyDraftDurabilityDesktop } from './trash-recovery-desktop-driver.mjs'"
 ],
 [
  "'folder-workspace111-'",
  "'trash-recovery112-'"
 ],
 [
  "'test-results/installer-lifecycle/folder-workspace'",
  "'test-results/installer-lifecycle/trash-recovery'"
 ],
 [
  "module: '2F.111'",
  "module: '2F.112'"
 ],
 [
  "pin.folderWorkspaceSourceFiles",
  "pin.trashRecoverySourceFiles"
 ],
 [
  "capture('folder111-failure.png')",
  "capture('recovery112-failure.png')"
 ]
]

 let next=original;for(const[a,b]of changes){assert.equal(next.split(a).length,2);assert.equal(next.includes(b),false);next=next.replace(a,b)}
 let inverse=next;for(const[a,b]of [...changes].reverse()){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}assert.equal(inverse,original,'Original process/install policies changed');assert.equal(recoveryBlob(next),'54c8261fab56d118805dafcdfb8f5c771f4a4cbf');return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),read=f=>readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.equal(JSON.parse(read('package.json')).version,'4.245.0')
 const pin=JSON.parse(read('scripts/reading-mode-installer-pin.json')),binding=JSON.parse(read('scripts/appearance-product-binding.json'))
 assert.equal(binding.productHead,'cdba631a2fda83353a946f45b31d0639f11e4fd8');assert.equal(pin.currentSource.headSha,binding.productHead)
 for(const[f,sha]of Object.entries(binding.productionTrees))assert.equal(execFileSync('git',['rev-parse','HEAD:'+f],{cwd:root,encoding:'utf8'}).trim(),sha,'Unreviewed product '+f)
 const source=read('scripts/run-folder-workspace-desktop-generated.mjs'),runner=buildTrashRecoveryRunner(source),out=path.join(root,'test-results/installer-lifecycle/trash-recovery-preparation');mkdirSync(out,{recursive:true})
 for(const[f,v]of [['run-folder-workspace-desktop-generated.mjs.before.txt',source],['run-trash-recovery-desktop-generated.mjs',runner]])writeFileSync(path.join(out,f),v,{flag:'wx'})
 writeFileSync(path.join(root,'scripts/run-trash-recovery-desktop-generated.mjs'),runner,{flag:'wx'});execFileSync(process.execPath,['--check',path.join(root,'scripts/run-trash-recovery-desktop-generated.mjs')])
 pin.trashRecoverySourceFiles=Object.fromEntries(RECOVERY_SOURCES.map(f=>[f,recoveryBlob(read(f))]));writeFileSync(path.join(root,'scripts/reading-mode-installer-pin.json'),JSON.stringify(pin,null,2)+'\n')
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,product:pin.product,productHead:binding.productHead,productTree:binding.productTree,sources:pin.trashRecoverySourceFiles,productionChanged:false,originalProcessPoliciesPreserved:true,nativeAcceptanceClaimed:false},null,2)+'\n',{flag:'wx'})
}
