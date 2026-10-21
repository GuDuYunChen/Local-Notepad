import {test} from 'node:test'
import assert from 'node:assert/strict'
import {NOTE_TAG_CHECKS,validateInstalledNoteTags,prepareNoteTagInstallation} from './note-tags-installed-evidence.mjs'
const verifier='c'.repeat(40)
function fixture(){
 const pin={product:'a'.repeat(40),tagsBlob:'b'.repeat(40),current:{version:'4.224.0',bytes:123,sha256:'d'.repeat(64)},previous:{version:'4.223.0',bytes:124,sha256:'e'.repeat(64)}}
 return {pin,report:{productCommit:pin.product,verifierCommit:verifier,complete:true,cleanupComplete:true,syntheticData:true,usedDefaultDataPath:true,forceTerminated:false,platform:'win32',runnerEnvironment:'github-hosted',installers:structuredClone({current:pin.current,previous:pin.previous}),noteTagsSource:{productCommit:pin.product,sha:pin.tagsBlob},checks:['installed-app-note-tags-workflow']},tags:{commit:verifier,complete:true,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[...NOTE_TAG_CHECKS],failureInjection:{exactPostResponseOnly:true,faults:[{method:'POST',responseStatusCode:200,url:'http://127.0.0.1:27121/api/note-tags/12345678-1234-4234-8234-123456789abc'}]},screenshots:[{filename:'note-tags-installed.png',bytes:100,sha256:'f'.repeat(64)}]}}
}
test('all source-bound installed note tag evidence accepted',()=>{const f=fixture();assert.equal(validateInstalledNoteTags(f.report,f.tags,f.pin,verifier),true)})
for(const [label,change] of [
 ['wrong product',f=>f.report.productCommit='0'.repeat(40)],['wrong verifier',f=>f.tags.commit='0'.repeat(40)],['wrong source',f=>f.report.noteTagsSource.sha='0'.repeat(40)],
 ['old binary',f=>f.report.installers.current.version='4.222.3'],['old upgrade seed',f=>f.report.installers.previous.bytes=0],['altered bytes',f=>f.report.installers.current.bytes=1],
 ['unfinished install',f=>f.report.complete=false],['unfinished module',f=>f.tags.complete=false],['incomplete cleanup',f=>f.report.cleanupComplete=false],['forced exit',f=>f.report.forceTerminated=true],
 ['non Windows',f=>f.report.platform='linux'],['user machine',f=>f.report.runnerEnvironment='self-hosted'],['real user data',f=>f.report.syntheticData=false],['nonstandard data path',f=>f.report.usedDefaultDataPath=false],['mock backend',f=>f.tags.realBackend=false],
 ['missing workflow',f=>f.report.checks=[]],['duplicate workflow',f=>f.report.checks.push(f.report.checks[0])],['missing checkpoint',f=>f.tags.checks.pop()],['reordered checkpoints',f=>f.tags.checks.reverse()],
 ['no response loss',f=>f.tags.failureInjection.exactPostResponseOnly=false],['two write faults',f=>f.tags.failureInjection.faults.push({...f.tags.failureInjection.faults[0]})],['not committed',f=>f.tags.failureInjection.faults[0].responseStatusCode=400],['wrong method',f=>f.tags.failureInjection.faults[0].method='GET'],['remote endpoint',f=>f.tags.failureInjection.faults[0].url='https://example.com/'],
 ['missing screenshot',f=>f.tags.screenshots=[]],['empty screenshot',f=>f.tags.screenshots[0].bytes=0],['unsafe screenshot',f=>f.tags.screenshots[0].filename='../outside'],['invalid checksum',f=>f.tags.screenshots[0].sha256='invalid'],
])test('rejects '+label,()=>{const f=fixture();change(f);assert.throws(()=>validateInstalledNoteTags(f.report,f.tags,f.pin,verifier))})
test('unrecognized original installer source refused',()=>assert.throws(()=>prepareNoteTagInstallation('other','other',{tagsBlob:'b'.repeat(40),quickBlob:'a'.repeat(40)})))
