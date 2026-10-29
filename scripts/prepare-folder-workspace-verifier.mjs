import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {FOLDER_SOURCES,folderBlob} from './folder-workspace-desktop-evidence.mjs'
export function buildFolderWorkspaceRunner(original){
 assert.equal(folderBlob(original),'07c984213c372acf85d6aeea84906d7c703e0385','Unreviewed local actions process owner')
 const changes=[
 [
  "ACTIONS_REPORT as DRAFT_REPORT, ACTIONS_SOURCES as DRAFT_SOURCES, actionsHash as draftHash, actionsBlob as draftBlob, verifyActionsNativeReport as verifyDraftDurabilityReport",
  "FOLDER_REPORT as DRAFT_REPORT, FOLDER_SOURCES as DRAFT_SOURCES, folderHash as draftHash, folderBlob as draftBlob, verifyFolderNativeReport as verifyDraftDurabilityReport"
 ],
 [
  "from './local-actions-desktop-evidence.mjs'",
  "from './folder-workspace-desktop-evidence.mjs'"
 ],
 [
  "import { verifyLocalActionsDesktop as verifyDraftDurabilityDesktop } from './local-actions-desktop-driver.mjs'",
  "import { verifyFolderWorkspaceDesktop as verifyDraftDurabilityDesktop } from './folder-workspace-desktop-driver.mjs'"
 ],
 [
  "'local-actions110-'",
  "'folder-workspace111-'"
 ],
 [
  "'test-results/installer-lifecycle/local-actions'",
  "'test-results/installer-lifecycle/folder-workspace'"
 ],
 [
  "module: '2F.110'",
  "module: '2F.111'"
 ],
 [
  "pin.localActionsSourceFiles",
  "pin.folderWorkspaceSourceFiles"
 ],
 [
  "capture('actions110-failure.png')",
  "capture('folder111-failure.png')"
 ]
]

 let next=original;for(const[a,b]of changes){assert.equal(next.split(a).length,2);assert.equal(next.includes(b),false);next=next.replace(a,b)}
 let inverse=next;for(const[a,b]of [...changes].reverse()){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}assert.equal(inverse,original,'Original process/install policies changed');assert.equal(folderBlob(next),'bbbc0f317abb63286fed3448d4015ad30912351c');return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),read=f=>readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.equal(JSON.parse(read('package.json')).version,'4.244.0')
 const pin=JSON.parse(read('scripts/reading-mode-installer-pin.json')),binding=JSON.parse(read('scripts/appearance-product-binding.json'))
 assert.equal(binding.productHead,'f059280614b6df3a03025d8f2567417bd14f2839');assert.equal(pin.currentSource.headSha,binding.productHead)
 for(const[f,sha]of Object.entries(binding.productionTrees))assert.equal(execFileSync('git',['rev-parse','HEAD:'+f],{cwd:root,encoding:'utf8'}).trim(),sha,'Unreviewed product '+f)
 const source=read('scripts/run-local-actions-desktop-generated.mjs'),runner=buildFolderWorkspaceRunner(source),out=path.join(root,'test-results/installer-lifecycle/folder-workspace-preparation');mkdirSync(out,{recursive:true})
 for(const[f,v]of [['run-local-actions-desktop-generated.mjs.before.txt',source],['run-folder-workspace-desktop-generated.mjs',runner]])writeFileSync(path.join(out,f),v,{flag:'wx'})
 writeFileSync(path.join(root,'scripts/run-folder-workspace-desktop-generated.mjs'),runner,{flag:'wx'});execFileSync(process.execPath,['--check',path.join(root,'scripts/run-folder-workspace-desktop-generated.mjs')])
 pin.folderWorkspaceSourceFiles=Object.fromEntries(FOLDER_SOURCES.map(f=>[f,folderBlob(read(f))]));writeFileSync(path.join(root,'scripts/reading-mode-installer-pin.json'),JSON.stringify(pin,null,2)+'\n')
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,product:pin.product,productHead:binding.productHead,productTree:binding.productTree,sources:pin.folderWorkspaceSourceFiles,productionChanged:false,originalProcessPoliciesPreserved:true,nativeAcceptanceClaimed:false},null,2)+'\n',{flag:'wx'})
}
