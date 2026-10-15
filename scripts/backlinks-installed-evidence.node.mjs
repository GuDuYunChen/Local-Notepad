import {test} from 'node:test'
import assert from 'node:assert/strict'
import {BACKLINK_CHECKS,validateInstalledBacklinks,prepareBacklinkInstallation} from './backlinks-installed-evidence.mjs'
const verifier='a'.repeat(40)
function fixture(){const pin={product:'b'.repeat(40),backlinksBlob:'c'.repeat(40),current:{version:'4.225.0',bytes:2,sha256:'d'.repeat(64)},previous:{version:'4.224.0',bytes:3,sha256:'e'.repeat(64)}};return {pin,report:{productCommit:pin.product,verifierCommit:verifier,complete:true,cleanupComplete:true,syntheticData:true,usedDefaultDataPath:true,forceTerminated:false,platform:'win32',runnerEnvironment:'github-hosted',installers:structuredClone({current:pin.current,previous:pin.previous}),backlinksSource:{productCommit:pin.product,sha:pin.backlinksBlob},checks:['installed-app-backlinks-workflow']},backlinks:{commit:verifier,complete:true,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[...BACKLINK_CHECKS],screenshots:['backlinks-preview.png','backlinks-installed.png'].map(filename=>({filename,bytes:100,sha256:'f'.repeat(64)}))}}}
const validate=f=>validateInstalledBacklinks(f.report,f.backlinks,f.pin,verifier)
test('complete source-bound installed backlinks evidence accepted',()=>assert.equal(validate(fixture()),true))
for(const[name,change]of[
 ['wrong product',f=>f.report.productCommit='d'.repeat(40)],['invalid product',f=>f.pin.product='bad'],['wrong verifier',f=>f.report.verifierCommit='d'.repeat(40)],
 ['incomplete install',f=>f.report.complete=false],['cleanup missing',f=>f.report.cleanupComplete=false],['real user data',f=>f.report.syntheticData=false],['alternate data path',f=>f.report.usedDefaultDataPath=false],['forced exit',f=>f.report.forceTerminated=true],['not Windows',f=>f.report.platform='linux'],['not disposable runner',f=>f.report.runnerEnvironment='self-hosted'],
 ['wrong version',f=>f.report.installers.current.version='4.224.0'],['wrong bytes',f=>f.report.installers.current.bytes++],['wrong hash',f=>f.report.installers.current.sha256='0'.repeat(64)],['wrong upgrade',f=>f.report.installers.previous.version='4.223.0'],
 ['wrong module source',f=>f.report.backlinksSource.sha='0'.repeat(40)],['wrong source product',f=>f.report.backlinksSource.productCommit='0'.repeat(40)],['missing source',f=>delete f.report.backlinksSource],
 ['missing installation gate',f=>f.report.checks=[]],['duplicate installation gate',f=>f.report.checks.push('installed-app-backlinks-workflow')],
 ['wrong module run',f=>f.backlinks.commit='0'.repeat(40)],['module incomplete',f=>f.backlinks.complete=false],['mock application',f=>f.backlinks.realPackagedApp=false],['mock backend',f=>f.backlinks.realBackend=false],['module nonisolated',f=>f.backlinks.syntheticData=false],
 ['missing checkpoint',f=>f.backlinks.checks.pop()],['duplicate checkpoint',f=>f.backlinks.checks[1]=f.backlinks.checks[0]],['wrong order',f=>f.backlinks.checks.reverse()],
 ['missing screenshot',f=>f.backlinks.screenshots.pop()],['extra screenshot',f=>f.backlinks.screenshots.push({...f.backlinks.screenshots[0]})],['unsafe path',f=>f.backlinks.screenshots[0].filename='../escape.png'],['empty image',f=>f.backlinks.screenshots[0].bytes=0],['invalid image digest',f=>f.backlinks.screenshots[0].sha256='bad'],['fractional image size',f=>f.backlinks.screenshots[0].bytes=0.5]
])test('rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>validate(f))})
test('unrecognized installer source cannot be adapted',()=>assert.throws(()=>prepareBacklinkInstallation('other','other',fixture().pin)))
