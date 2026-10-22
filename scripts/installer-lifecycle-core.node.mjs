import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { assertHostedWindows, nsisArgs, requireOwnedPath, verifyInstaller, validateLifecycleReport, RELEASES, LEGACY_DEFECT, REQUIRED_CHECKS, PRODUCT_COMMIT, CI_BRANCH } from './installer-lifecycle-core.mjs'
const env = { GITHUB_ACTIONS:'true', RUNNER_ENVIRONMENT:'github-hosted', GITHUB_REPOSITORY:'GuDuYunChen/Local-Notepad', GITHUB_REF:'refs/heads/'+CI_BRANCH, GITHUB_SHA:'a'.repeat(40), RUNNER_TEMP:'D:\\a\\_temp' }
const root = 'D:\\a\\_temp\\notepad-install-ABC', dir = root + '\\中文 安装目录'
test('only exact disposable runner identity is admitted', () => assertHostedWindows(env, 'win32'))
for (const [field,value] of [['GITHUB_ACTIONS','false'],['RUNNER_ENVIRONMENT','self-hosted'],['GITHUB_REPOSITORY','other/repo'],['GITHUB_REF','refs/heads/master'],['GITHUB_SHA',''],['RUNNER_TEMP','relative']])
 test('refuses unsafe environment '+field,()=>assert.throws(()=>assertHostedWindows({...env,[field]:value},'win32')))
test('refuses simulated Windows acceptance',()=>assert.throws(()=>assertHostedWindows(env,'linux')))
test('silent install and uninstall preserve the exact final unquoted Unicode path',()=>{
 assert.deepEqual(nsisArgs(root,dir),['/S','/currentuser','/D='+dir])
 assert.deepEqual(nsisArgs(root,dir,true),['/S','/currentuser','_?='+dir])
})
for (const candidate of [root,root+'-other\\dir','D:\\other','C:\\Windows','relative','\\\\host\\share',root+'\\..\\outside',root+'\\name:stream',root+'\\quoted"name',root+'\\folder.\\child',root+'\\folder \\child'])
 test('unsafe path refused: '+candidate,()=>assert.throws(()=>requireOwnedPath(root,candidate)))
test('hash and byte size are both checked before execution',()=>{
 const b=Buffer.from('MZsynthetic'),e={bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}
 assert.equal(verifyInstaller(b,e).sha256,e.sha256)
 assert.throws(()=>verifyInstaller(Buffer.from('MZmodified!'),e))
 assert.throws(()=>verifyInstaller(b,{...e,bytes:1}))
 const wrong=Buffer.from('NOsynthetic');assert.throws(()=>verifyInstaller(wrong,{bytes:wrong.length,sha256:createHash('sha256').update(wrong).digest('hex')}))
})
const complete=()=>({productCommit:PRODUCT_COMMIT,verifierCommit:'a'.repeat(40),complete:true,platform:'win32',runnerEnvironment:'github-hosted',syntheticData:true,usedDefaultDataPath:true,forceTerminated:false,cleanupComplete:true,checks:[...REQUIRED_CHECKS],legacyInstaller:LEGACY_DEFECT,legacyPathProbe:{observedTruncation:true,cleaned:true},legacyProbeCommands:[{code:0,signal:null,timedOut:false},{code:0,signal:null,timedOut:false}],installers:RELEASES,commands:Array.from({length:8},()=>({code:0,signal:null,timedOut:false,pid:22,elapsedMs:2})),appExits:Array.from({length:5},()=>({code:0,signal:null,nativeClose:true})),dataComparisons:Array.from({length:5},()=>({equal:true,files:1,digest:'b'.repeat(64)}))})
test('complete source-bound report is accepted',()=>assert.equal(validateLifecycleReport(complete()),true))
for(const field of ['complete','syntheticData','usedDefaultDataPath','cleanupComplete'])test('incomplete evidence refused '+field,()=>assert.throws(()=>validateLifecycleReport({...complete(),[field]:false})))
for(const [label,change] of [
 ['old source',r=>r.productCommit='b'.repeat(40)],['forced exit',r=>r.forceTerminated=true],['missing check',r=>r.checks.pop()],['duplicate check',r=>r.checks[1]=r.checks[0]],['missing command',r=>r.commands.pop()],['installer timeout',r=>r.commands[0].timedOut=true],['installer failure',r=>r.commands[0].code=1],['no native close',r=>r.appExits[0].nativeClose=false],['lost data',r=>r.dataComparisons[0].equal=false],['empty snapshot',r=>r.dataComparisons[0].files=0],['wrong binary',r=>r.installers={...RELEASES,current:{...RELEASES.current,sha256:'c'.repeat(64)}}]])test('false green rejected: '+label,()=>{const r=complete();change(r);assert.throws(()=>validateLifecycleReport(r))})

test('legacy quoted seeding is explicit, while new NSIS paths stay unquoted',()=>{assert.deepEqual(nsisArgs(root,dir,false,true),['/S','/currentuser','"/D='+dir+'"']);assert.equal(nsisArgs(root,dir).at(-1),'/D='+dir);assert.throws(()=>nsisArgs(root,dir,true,true))})
test('missing old-directory reproduction cannot become complete',()=>{const r=complete();r.legacyPathProbe.observedTruncation=false;assert.throws(()=>validateLifecycleReport(r))})
test('unclean old-directory probe cannot become complete',()=>{const r=complete();r.legacyProbeCommands[1].code=1;assert.throws(()=>validateLifecycleReport(r))})
