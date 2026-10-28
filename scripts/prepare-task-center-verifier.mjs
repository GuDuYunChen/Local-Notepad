import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {TASK_SOURCES,taskBlob} from './task-center-desktop-evidence.mjs'
export function buildTaskRunner(original){
 assert.equal(taskBlob(original),'e287b5a65a08de4c22db95d3234f459fc01b4889','Unreviewed attachment process owner')
 const changes=[
 [
  "AUDIT_REPORT as DRAFT_REPORT, AUDIT_SOURCES as DRAFT_SOURCES, auditHash as draftHash, auditBlob as draftBlob, verifyAuditNativeReport as verifyDraftDurabilityReport",
  "TASK_REPORT as DRAFT_REPORT, TASK_SOURCES as DRAFT_SOURCES, taskHash as draftHash, taskBlob as draftBlob, verifyTaskNativeReport as verifyDraftDurabilityReport"
 ],
 [
  "from './attachment-audit-desktop-evidence.mjs'",
  "from './task-center-desktop-evidence.mjs'"
 ],
 [
  "import { verifyAttachmentAuditDesktop as verifyDraftDurabilityDesktop } from './attachment-audit-desktop-driver.mjs'",
  "import { verifyTaskCenterDesktop as verifyDraftDurabilityDesktop } from './task-center-desktop-driver.mjs'"
 ],
 [
  "'attachment-audit108-'",
  "'task-center109-'"
 ],
 [
  "'test-results/installer-lifecycle/attachment-audit'",
  "'test-results/installer-lifecycle/task-center'"
 ],
 [
  "module: '2F.108'",
  "module: '2F.109'"
 ],
 [
  "pin.attachmentAuditSourceFiles",
  "pin.taskCenterSourceFiles"
 ],
 [
  "capture('audit108-failure.png')",
  "capture('task109-failure.png')"
 ]
]
 let value=original
 for(const[a,b]of changes){assert.equal(value.split(a).length,2,'Ambiguous replacement '+a);assert.equal(value.includes(b),false);value=value.replace(a,b)}
 let inverse=value;for(const[a,b]of [...changes].reverse()){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}assert.equal(inverse,original,'Original process/install policies changed');return value
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),read=f=>readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.equal(JSON.parse(read('package.json')).version,'4.242.0')
 const pin=JSON.parse(read('scripts/reading-mode-installer-pin.json')),binding=JSON.parse(read('scripts/appearance-product-binding.json'))
 assert.equal(binding.productHead,'754b97e696b4075038e288b92c4740a0142ec4a2');assert.equal(pin.currentSource.headSha,binding.productHead)
 for(const[f,sha]of Object.entries(binding.productionTrees))assert.equal(execFileSync('git',['rev-parse','HEAD:'+f],{cwd:root,encoding:'utf8'}).trim(),sha,'Unreviewed product '+f)
 const source=read('scripts/run-attachment-audit-desktop-generated.mjs'),runner=buildTaskRunner(source),out=path.join(root,'test-results/installer-lifecycle/task-center-preparation');mkdirSync(out,{recursive:true})
 for(const[f,v]of [['run-attachment-audit-desktop-generated.mjs.before.txt',source],['run-task-center-desktop-generated.mjs',runner]])writeFileSync(path.join(out,f),v,{flag:'wx'})
 writeFileSync(path.join(root,'scripts/run-task-center-desktop-generated.mjs'),runner,{flag:'wx'});execFileSync(process.execPath,['--check',path.join(root,'scripts/run-task-center-desktop-generated.mjs')])
 pin.taskCenterSourceFiles=Object.fromEntries(TASK_SOURCES.map(f=>[f,taskBlob(read(f))]));writeFileSync(path.join(root,'scripts/reading-mode-installer-pin.json'),JSON.stringify(pin,null,2)+'\n')
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,product:pin.product,productHead:binding.productHead,productTree:binding.productTree,sources:pin.taskCenterSourceFiles,productionChanged:false,originalProcessPoliciesPreserved:true,nativeAcceptanceClaimed:false},null,2)+'\n',{flag:'wx'})
}
