import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HISTORY_PRODUCT, HISTORY_NATIVE_BLOB, HISTORY_INSTALLER, HISTORY_CHECKS, validateInstalledHistory } from './history-installation-evidence.mjs'
const verifier='a'.repeat(40),target='http://127.0.0.1:27121/api/files/owned-1'
function fixture(){return{report:{productCommit:HISTORY_PRODUCT,verifierCommit:verifier,complete:true,cleanupComplete:true,platform:'win32',runnerEnvironment:'github-hosted',syntheticData:true,usedDefaultDataPath:true,forceTerminated:false,installers:{current:{...HISTORY_INSTALLER},previous:{version:'4.219.1'}},historySource:{productCommit:HISTORY_PRODUCT,gitBlob:HISTORY_NATIVE_BLOB,report:'version-history.json',testCodeOnly:true},checks:['installed-app-version-history-workflow']},history:{commit:verifier,complete:true,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[...HISTORY_CHECKS],failureInjection:{mode:'exact-PUT-only',requests:[{method:'GET',url:target+'/versions',blocked:false},{method:'PUT',url:target,blocked:true}]},screenshots:['version-history-restored.png','version-history-empty.png'].map(filename=>({filename,bytes:123,sha256:'b'.repeat(64)}))}}}
test('complete source-bound installed history evidence accepted',()=>{const{report,history}=fixture();assert.equal(validateInstalledHistory(report,history,verifier),true)})
for(const[label,change]of[
 ['old product',f=>f.report.productCommit='c'.repeat(40)],['wrong verifier',f=>f.history.commit='c'.repeat(40)],
 ['old installer',f=>f.report.installers.current.version='4.219.1'],['wrong binary',f=>f.report.installers.current.sha256='d'.repeat(64)],
 ['old upgrade seed',f=>f.report.installers.previous.version='4.218.0'],['wrong history source',f=>f.report.historySource.gitBlob='c'.repeat(40)],
 ['wrong report',f=>f.report.historySource.report='../other.json'],['unfinished install',f=>f.report.complete=false],['unclean exit',f=>f.report.cleanupComplete=false],
 ['non-native',f=>f.report.platform='linux'],['self hosted',f=>f.report.runnerEnvironment='self-hosted'],['forced close',f=>f.report.forceTerminated=true],
 ['user data',f=>f.report.syntheticData=false],['alternate data path',f=>f.report.usedDefaultDataPath=false],
 ['missing install history check',f=>f.report.checks=[]],['duplicate install check',f=>f.report.checks.push(f.report.checks[0])],
 ['history incomplete',f=>f.history.complete=false],['backend replaced',f=>f.history.realBackend=false],['unpacked history',f=>f.history.realPackagedApp=false],
 ['missing history check',f=>f.history.checks.pop()],['duplicate history check',f=>f.history.checks[1]=f.history.checks[0]],
 ['wrong failure method',f=>f.history.failureInjection.requests[1].method='GET'],['no real preflight',f=>f.history.failureInjection.requests.shift()],
 ['two failed writes',f=>f.history.failureInjection.requests.push({...f.history.failureInjection.requests[1]})],
 ['other note preflight',f=>f.history.failureInjection.requests[0].url=target+'-other/versions'],['external target',f=>f.history.failureInjection.requests[1].url='https://example.com/files/a'],
 ['missing screenshot',f=>f.history.screenshots.pop()],['unsafe screenshot',f=>f.history.screenshots[0].filename='../image.png'],['empty screenshot',f=>f.history.screenshots[0].bytes=0],
])test('rejects '+label,()=>{const f=fixture();change(f);assert.throws(()=>validateInstalledHistory(f.report,f.history,verifier))})
