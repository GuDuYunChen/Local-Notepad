import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {AUDIT_SOURCES,auditBlob} from './attachment-audit-desktop-evidence.mjs'
export function buildAuditRunner(original){
 assert.equal(auditBlob(original),'fdcaa659a6cfc8eb5e279d430d6d23d42e6a6e68','Unreviewed statistics process owner')
 const changes=[
 [
  "STATISTICS_REPORT as DRAFT_REPORT, STATISTICS_SOURCES as DRAFT_SOURCES, statisticsHash as draftHash, statisticsBlob as draftBlob, verifyStatisticsNativeReport as verifyDraftDurabilityReport",
  "AUDIT_REPORT as DRAFT_REPORT, AUDIT_SOURCES as DRAFT_SOURCES, auditHash as draftHash, auditBlob as draftBlob, verifyAuditNativeReport as verifyDraftDurabilityReport"
 ],
 [
  "from './library-statistics-desktop-evidence.mjs'",
  "from './attachment-audit-desktop-evidence.mjs'"
 ],
 [
  "import { verifyLibraryStatisticsDesktop as verifyDraftDurabilityDesktop } from './library-statistics-desktop-driver.mjs'",
  "import { verifyAttachmentAuditDesktop as verifyDraftDurabilityDesktop } from './attachment-audit-desktop-driver.mjs'"
 ],
 [
  "'library-statistics107-'",
  "'attachment-audit108-'"
 ],
 [
  "'test-results/installer-lifecycle/library-statistics'",
  "'test-results/installer-lifecycle/attachment-audit'"
 ],
 [
  "module: '2F.107'",
  "module: '2F.108'"
 ],
 [
  "pin.libraryStatisticsSourceFiles",
  "pin.attachmentAuditSourceFiles"
 ],
 [
  "capture('statistics107-failure.png')",
  "capture('audit108-failure.png')"
 ]
]
 let value=original
 for(const[a,b]of changes){assert.equal(value.split(a).length,2,'Ambiguous replacement '+a);assert.equal(value.includes(b),false);value=value.replace(a,b)}
 let inverse=value;for(const[a,b]of [...changes].reverse()){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}assert.equal(inverse,original,'Original process/install policies changed');return value
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),read=f=>readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.equal(JSON.parse(read('package.json')).version,'4.241.0')
 const pin=JSON.parse(read('scripts/reading-mode-installer-pin.json')),binding=JSON.parse(read('scripts/appearance-product-binding.json'))
 assert.equal(binding.productHead,'ed96da5efa6ae8cd6e0af591a9b6e7349d4406c6');assert.equal(pin.currentSource.headSha,binding.productHead)
 for(const[f,sha]of Object.entries(binding.productionTrees))assert.equal(execFileSync('git',['rev-parse','HEAD:'+f],{cwd:root,encoding:'utf8'}).trim(),sha,'Unreviewed product '+f)
 const source=read('scripts/run-library-statistics-desktop-generated.mjs'),runner=buildAuditRunner(source),out=path.join(root,'test-results/installer-lifecycle/attachment-audit-preparation');mkdirSync(out,{recursive:true})
 for(const[f,v]of [['run-library-statistics-desktop-generated.mjs.before.txt',source],['run-attachment-audit-desktop-generated.mjs',runner]])writeFileSync(path.join(out,f),v,{flag:'wx'})
 writeFileSync(path.join(root,'scripts/run-attachment-audit-desktop-generated.mjs'),runner,{flag:'wx'});execFileSync(process.execPath,['--check',path.join(root,'scripts/run-attachment-audit-desktop-generated.mjs')])
 pin.attachmentAuditSourceFiles=Object.fromEntries(AUDIT_SOURCES.map(f=>[f,auditBlob(read(f))]));writeFileSync(path.join(root,'scripts/reading-mode-installer-pin.json'),JSON.stringify(pin,null,2)+'\n')
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,product:pin.product,productHead:binding.productHead,productTree:binding.productTree,sources:pin.attachmentAuditSourceFiles,productionChanged:false,originalProcessPoliciesPreserved:true,nativeAcceptanceClaimed:false},null,2)+'\n',{flag:'wx'})
}
