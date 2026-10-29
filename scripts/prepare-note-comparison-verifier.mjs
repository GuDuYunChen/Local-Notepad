import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {COMPARISON_SOURCES} from './note-comparison-desktop-evidence.mjs'
import {comparisonNativeBlob as blob} from './note-comparison-native-fixture.mjs'
export function buildNoteComparisonRunner(original){
 assert.equal(blob(original),'fc51d942724612a0f408c814c4ad4a09a84d76f2','Unreviewed preceding process owner')
 const changes=[
 ['DUPLICATE_REPORT as DRAFT_REPORT, DUPLICATE_SOURCES as DRAFT_SOURCES, duplicateHash as draftHash, duplicateBlob as draftBlob, verifyDuplicateNativeReport as verifyDraftDurabilityReport','COMPARISON_REPORT as DRAFT_REPORT, COMPARISON_SOURCES as DRAFT_SOURCES, comparisonHash as draftHash, comparisonBlob as draftBlob, verifyComparisonNativeReport as verifyDraftDurabilityReport'],
 ["from './duplicate-notes-desktop-evidence.mjs'","from './note-comparison-desktop-evidence.mjs'"],
 ["import { verifyDuplicateNotesDesktop as verifyDraftDurabilityDesktop } from './duplicate-notes-desktop-driver.mjs'","import { verifyNoteComparisonDesktop as verifyDraftDurabilityDesktop } from './note-comparison-desktop-driver.mjs'"],
 ["'duplicate-notes113-'","'note-comparison114-'"],
 ["'test-results/installer-lifecycle/duplicate-notes'","'test-results/installer-lifecycle/note-comparison'"],
 ["module: '2F.113'","module: '2F.114'"],['pin.duplicateNotesSourceFiles','pin.noteComparisonSourceFiles'],
 ["capture('duplicate113-failure.png')","capture('comparison114-failure.png')"]]
 let next=original;for(const[a,b]of changes){assert.equal(next.split(a).length,2);assert.equal(next.includes(b),false);next=next.replace(a,b)}
 let inverse=next;for(const[a,b]of [...changes].reverse()){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}assert.equal(inverse,original,'Original process/install owner changed');return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),read=f=>readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.equal(JSON.parse(read('package.json')).version,'4.247.0')
 const pin=JSON.parse(read('scripts/reading-mode-installer-pin.json')),binding=JSON.parse(read('scripts/appearance-product-binding.json'))
 assert.equal(binding.productHead,'c58c0aa86a003399ed9decb8ba739656e90883b4');assert.equal(pin.currentSource.headSha,binding.productHead)
 for(const[f,sha]of Object.entries(binding.productionTrees))assert.equal(execFileSync('git',['rev-parse','HEAD:'+f],{cwd:root,encoding:'utf8'}).trim(),sha,'Unreviewed product '+f)
 const original=read('scripts/run-duplicate-notes-desktop-generated.mjs'),runner=buildNoteComparisonRunner(original),out=path.join(root,'test-results/installer-lifecycle/note-comparison-preparation');mkdirSync(out,{recursive:true})
 for(const[f,v]of [['run-duplicate-notes-desktop-generated.mjs.before.txt',original],['run-note-comparison-desktop-generated.mjs',runner]])writeFileSync(path.join(out,f),v,{flag:'wx'})
 writeFileSync(path.join(root,'scripts/run-note-comparison-desktop-generated.mjs'),runner,{flag:'wx'});execFileSync(process.execPath,['--check',path.join(root,'scripts/run-note-comparison-desktop-generated.mjs')])
 pin.noteComparisonSourceFiles=Object.fromEntries(COMPARISON_SOURCES.map(f=>[f,blob(read(f))]));writeFileSync(path.join(root,'scripts/reading-mode-installer-pin.json'),JSON.stringify(pin,null,2)+'\n')
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,product:pin.product,productHead:binding.productHead,productTree:binding.productTree,sources:pin.noteComparisonSourceFiles,productionChanged:false,originalProcessPoliciesPreserved:true,nativeAcceptanceClaimed:false},null,2)+'\n',{flag:'wx'})
}
