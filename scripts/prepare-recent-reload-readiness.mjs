import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export function prepareRecentReloadReadiness(original){
 assert.equal(blob(original),'5b34a6ad07ede92f1670abe2c7635e022ae36026','Unreviewed inherited reading preparation')
 const old=`  const script = "import {verifyReadingModeDesktop} from './check-reading-mode-desktop.mjs'\\n" +
    replaceExactlyAndProveInverse(prepared.script, [[anchor, addition], [marker, marker + ";mark('installed-app-reading-mode-workflow')"]])`
 const next=`  const recent = '  await verifyRecentNotesDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})'
  const recentReady = '  await verifyRecentNotesAfterReload(verifyRecentNotesDesktop,{evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]},value=>{report.recentReloadReadiness=value;save()})'
  const script = "import {verifyReadingModeDesktop} from './check-reading-mode-desktop.mjs'\\nimport {verifyRecentNotesAfterReload} from './recent-reload-readiness.mjs'\\n" +
    replaceExactlyAndProveInverse(prepared.script, [[anchor, addition], [marker, marker + ";mark('installed-app-reading-mode-workflow')"], [recent, recentReady]])`
 assert.equal(original.split(old).length,2);assert.equal(original.includes(next),false)
 const output=original.replace(old,next)
 assert.equal(output.split(next).length,2);assert.equal(output.replace(next,old),original,'Inherited reading assertions changed')
 return output
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.platform,'win32');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86')
 const root=fileURLToPath(new URL('../',import.meta.url)),file=path.join(root,'scripts/reading-mode-installed-evidence.mjs')
 assert.equal(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,'4.240.0')
 const before=readFileSync(file,'utf8').replace(/\r\n/g,'\n'),after=prepareRecentReloadReadiness(before),out=path.join(root,'test-results/installer-lifecycle/recent-reload-preparation')
 mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'reading-mode-installed-evidence.mjs.before.txt'),before,{flag:'wx'});writeFileSync(path.join(out,'reading-mode-installed-evidence.mjs'),after,{flag:'wx'})
 const helper=readFileSync(new URL('./recent-reload-readiness.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n')
 writeFileSync(path.join(out,'recent-reload-readiness.mjs'),helper,{flag:'wx'})
 writeFileSync(file,after)
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,before:blob(before),after:blob(after),helper:blob(helper),inverseBytesEqual:true,originalDriverUnchanged:true,originalClicksAndAssertionsPreserved:true,readinessBudgetMs:18000,automaticReloadRetries:0,nativeAcceptanceClaimed:false},null,2)+'\n',{flag:'wx'})
}
