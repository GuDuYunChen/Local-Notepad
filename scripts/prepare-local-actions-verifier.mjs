import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {ACTIONS_SOURCES,actionsBlob} from './local-actions-desktop-evidence.mjs'
export function buildLocalActionsRunner(original){
 assert.equal(actionsBlob(original),'38cd45cfa9908015d6b40eafd2ee8cd51b1f8cda','Unreviewed task process owner')
 const changes=[
 [
  "TASK_REPORT as DRAFT_REPORT, TASK_SOURCES as DRAFT_SOURCES, taskHash as draftHash, taskBlob as draftBlob, verifyTaskNativeReport as verifyDraftDurabilityReport",
  "ACTIONS_REPORT as DRAFT_REPORT, ACTIONS_SOURCES as DRAFT_SOURCES, actionsHash as draftHash, actionsBlob as draftBlob, verifyActionsNativeReport as verifyDraftDurabilityReport"
 ],
 [
  "from './task-center-desktop-evidence.mjs'",
  "from './local-actions-desktop-evidence.mjs'"
 ],
 [
  "import { verifyTaskCenterDesktop as verifyDraftDurabilityDesktop } from './task-center-desktop-driver.mjs'",
  "import { verifyLocalActionsDesktop as verifyDraftDurabilityDesktop } from './local-actions-desktop-driver.mjs'"
 ],
 [
  "'task-center109-'",
  "'local-actions110-'"
 ],
 [
  "'test-results/installer-lifecycle/task-center'",
  "'test-results/installer-lifecycle/local-actions'"
 ],
 [
  "module: '2F.109'",
  "module: '2F.110'"
 ],
 [
  "pin.taskCenterSourceFiles",
  "pin.localActionsSourceFiles"
 ],
 [
  "capture('task109-failure.png')",
  "capture('actions110-failure.png')"
 ]
]
 let next=original;for(const[a,b]of changes){assert.equal(next.split(a).length,2);assert.equal(next.includes(b),false);next=next.replace(a,b)}
 let inverse=next;for(const[a,b]of [...changes].reverse()){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}assert.equal(inverse,original,'Original process/install policies changed');assert.equal(actionsBlob(next),'fd6db6c06f463622429c4a590f7a2126df089f2a');return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),read=f=>readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.equal(JSON.parse(read('package.json')).version,'4.243.0')
 const pin=JSON.parse(read('scripts/reading-mode-installer-pin.json')),binding=JSON.parse(read('scripts/appearance-product-binding.json'))
 assert.equal(binding.productHead,'1e6742fe7032b17bbc6688605ce4a8c18c254967');assert.equal(pin.currentSource.headSha,binding.productHead)
 for(const[f,sha]of Object.entries(binding.productionTrees))assert.equal(execFileSync('git',['rev-parse','HEAD:'+f],{cwd:root,encoding:'utf8'}).trim(),sha,'Unreviewed product '+f)
 const source=read('scripts/run-task-center-desktop-generated.mjs'),runner=buildLocalActionsRunner(source),out=path.join(root,'test-results/installer-lifecycle/local-actions-preparation');mkdirSync(out,{recursive:true})
 for(const[f,v]of [['run-task-center-desktop-generated.mjs.before.txt',source],['run-local-actions-desktop-generated.mjs',runner]])writeFileSync(path.join(out,f),v,{flag:'wx'})
 writeFileSync(path.join(root,'scripts/run-local-actions-desktop-generated.mjs'),runner,{flag:'wx'});execFileSync(process.execPath,['--check',path.join(root,'scripts/run-local-actions-desktop-generated.mjs')])
 pin.localActionsSourceFiles=Object.fromEntries(ACTIONS_SOURCES.map(f=>[f,actionsBlob(read(f))]));writeFileSync(path.join(root,'scripts/reading-mode-installer-pin.json'),JSON.stringify(pin,null,2)+'\n')
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,product:pin.product,productHead:binding.productHead,productTree:binding.productTree,sources:pin.localActionsSourceFiles,productionChanged:false,originalProcessPoliciesPreserved:true,nativeAcceptanceClaimed:false},null,2)+'\n',{flag:'wx'})
}
