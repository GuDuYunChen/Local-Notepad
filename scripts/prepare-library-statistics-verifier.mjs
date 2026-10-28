import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {STATISTICS_SOURCES,statisticsBlob} from './library-statistics-desktop-evidence.mjs'
export function buildStatisticsRunner(original){
 assert.equal(statisticsBlob(original),'b4ac535ad4f30ebb0458d106ce88eb941d0fddf6','Unreviewed generated tag process owner')
 const changes=[
 ['TAG_REPORT as DRAFT_REPORT, TAG_SOURCES as DRAFT_SOURCES, tagHash as draftHash, tagBlob as draftBlob, verifyTagWorkspaceNativeReport as verifyDraftDurabilityReport','STATISTICS_REPORT as DRAFT_REPORT, STATISTICS_SOURCES as DRAFT_SOURCES, statisticsHash as draftHash, statisticsBlob as draftBlob, verifyStatisticsNativeReport as verifyDraftDurabilityReport'],
 ["from './tag-workspace-desktop-evidence.mjs'","from './library-statistics-desktop-evidence.mjs'"],
 ["import { verifyTagWorkspaceDesktop as verifyDraftDurabilityDesktop } from './tag-workspace-desktop-driver.mjs'","import { verifyLibraryStatisticsDesktop as verifyDraftDurabilityDesktop } from './library-statistics-desktop-driver.mjs'"],
 ["'tag-workspace106-'","'library-statistics107-'"],
 ["'test-results/installer-lifecycle/tag-workspace'","'test-results/installer-lifecycle/library-statistics'"],
 ["module: '2F.106'","module: '2F.107'"],
 ['pin.tagWorkspaceSourceFiles','pin.libraryStatisticsSourceFiles'],
 ["capture('tag106-failure.png')","capture('statistics107-failure.png')"],
 ]
 let value=original
 for(const [a,b] of changes){assert.equal(value.split(a).length,2,'Ambiguous replacement '+a);assert.equal(value.includes(b),false);value=value.replace(a,b)}
 let inverse=value;for(const[a,b]of [...changes].reverse()){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}assert.equal(inverse,original,'Original process/install protection changed');return value
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),read=f=>readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.equal(JSON.parse(read('package.json')).version,'4.240.0')
 const pin=JSON.parse(read('scripts/reading-mode-installer-pin.json')),binding=JSON.parse(read('scripts/appearance-product-binding.json'))
 assert.equal(binding.productHead,'9ad6be13bc2c7dee0902c7464724b23ad535b3e3');assert.equal(pin.currentSource.headSha,binding.productHead)
 for(const[f,sha]of Object.entries(binding.productionTrees))assert.equal(execFileSync('git',['rev-parse','HEAD:'+f],{cwd:root,encoding:'utf8'}).trim(),sha,'Unreviewed product '+f)
 const source=read('scripts/run-tag-workspace-desktop-generated.mjs'),runner=buildStatisticsRunner(source),out=path.join(root,'test-results/installer-lifecycle/library-statistics-preparation');mkdirSync(out,{recursive:true})
 for(const[f,v]of [['run-tag-workspace-desktop-generated.mjs.before.txt',source],['run-library-statistics-desktop-generated.mjs',runner]])writeFileSync(path.join(out,f),v,{flag:'wx'})
 writeFileSync(path.join(root,'scripts/run-library-statistics-desktop-generated.mjs'),runner,{flag:'wx'});execFileSync(process.execPath,['--check',path.join(root,'scripts/run-library-statistics-desktop-generated.mjs')])
 pin.libraryStatisticsSourceFiles=Object.fromEntries(STATISTICS_SOURCES.map(f=>[f,statisticsBlob(read(f))]));writeFileSync(path.join(root,'scripts/reading-mode-installer-pin.json'),JSON.stringify(pin,null,2)+'\n')
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,product:pin.product,productHead:binding.productHead,productTree:binding.productTree,sources:pin.libraryStatisticsSourceFiles,productionChanged:false,originalProcessPoliciesPreserved:true,nativeAcceptanceClaimed:false},null,2)+'\n',{flag:'wx'})
}
