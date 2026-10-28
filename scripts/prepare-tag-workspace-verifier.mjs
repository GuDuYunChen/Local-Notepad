import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {tagBlob,TAG_SOURCES} from './tag-workspace-desktop-evidence.mjs'
import {replaceExactlyAndProveInverse} from './reading-mode-installed-evidence.mjs'
import {buildAppearanceRunner} from './prepare-appearance-verifier.mjs'
export function buildTagWorkspaceRunner(originalDraft){
 const original=buildAppearanceRunner(originalDraft)
 const changes=[
  ['APPEARANCE_REPORT as DRAFT_REPORT, APPEARANCE_SOURCES as DRAFT_SOURCES, appearanceHash as draftHash, appearanceBlob as draftBlob, verifyAppearanceNativeReport as verifyDraftDurabilityReport','TAG_REPORT as DRAFT_REPORT, TAG_SOURCES as DRAFT_SOURCES, tagHash as draftHash, tagBlob as draftBlob, verifyTagWorkspaceNativeReport as verifyDraftDurabilityReport'],
  ["from './appearance-desktop-evidence.mjs'","from './tag-workspace-desktop-evidence.mjs'"],
  ["import { verifyAppearanceDesktop as verifyDraftDurabilityDesktop } from './appearance-desktop-driver.mjs'","import { verifyTagWorkspaceDesktop as verifyDraftDurabilityDesktop } from './tag-workspace-desktop-driver.mjs'"],
  ["'appearance105-'","'tag-workspace106-'"],["'test-results/installer-lifecycle/appearance'","'test-results/installer-lifecycle/tag-workspace'"],
  ["module: '2F.105'","module: '2F.106'"],['pin.appearanceSourceFiles','pin.tagWorkspaceSourceFiles'],
  ["capture('appearance105-failure.png')","capture('tag106-failure.png')"],
  ["import { createExportDirectorySession } from './local-export-directory-session.mjs'", "import { createExportDirectorySession } from './local-export-directory-session.mjs'\nimport { observeRetainedTagBodies } from './tag-workspace-retained-bodies.mjs'"],
  ['      requestCount: () => requests.length,', `      readRetainedTagBodies: async expected => {
        assert.equal(alive(app), false, 'Body observation requires the owned application to exit')
        assert.equal(report.exit?.normal, true)
        await stopped()
        return observeRetainedTagBodies(data, expected)
      },
      requestCount: () => requests.length,`],
 ]
 return replaceExactlyAndProveInverse(original,changes)
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),read=f=>readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.equal(JSON.parse(read('package.json')).version,'4.239.0')
 const pin=JSON.parse(read('scripts/reading-mode-installer-pin.json')),binding=JSON.parse(read('scripts/appearance-product-binding.json'))
 assert.equal(pin.currentSource.headSha,binding.productHead);assert.equal(pin.currentSource.headSha,'568c229706a26973163bde1efc553fc2d900b1da')
 for(const [f,sha] of Object.entries(binding.productionTrees))assert.equal(execFileSync('git',['rev-parse','HEAD:'+f],{cwd:root,encoding:'utf8'}).trim(),sha,'Product source differs: '+f)
 const original=read('test-results/installer-lifecycle/appearance-preparation/run-draft-durability-desktop.mjs.before.txt')
 const runner=buildTagWorkspaceRunner(original),out=path.join(root,'test-results/installer-lifecycle/tag-workspace-preparation');mkdirSync(out,{recursive:true})
 writeFileSync(path.join(root,'scripts/run-tag-workspace-desktop-generated.mjs'),runner,{flag:'wx'});writeFileSync(path.join(out,'run-tag-workspace-desktop-generated.mjs'),runner,{flag:'wx'})
 execFileSync(process.execPath,['--check',path.join(root,'scripts/run-tag-workspace-desktop-generated.mjs')])
 pin.tagWorkspaceSourceFiles=Object.fromEntries(TAG_SOURCES.map(f=>[f,tagBlob(read(f))]))
 writeFileSync(path.join(root,'scripts/reading-mode-installer-pin.json'),JSON.stringify(pin,null,2)+'\n')
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,product:pin.product,productHead:binding.productHead,productTree:binding.productTree,productionChanged:false,appearanceAndDraftRetained:true,sources:pin.tagWorkspaceSourceFiles,nativeExecutionClaimedByPreparation:false},null,2)+'\n',{flag:'wx'})
}
