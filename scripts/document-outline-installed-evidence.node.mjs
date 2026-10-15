import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DOCUMENT_SEARCH_CHECKS} from './document-search-installed-evidence.mjs'
import {DOCUMENT_OUTLINE_CHECKS,validateInstalledOutline,prepareOutlineInstallation} from './document-outline-installed-evidence.mjs'
const verifier='a'.repeat(40)
function fixture(){
 const pin={product:'b'.repeat(40),outlineBlob:'c'.repeat(40),searchBlob:'d'.repeat(40),current:{version:'4.227.1',bytes:123,sha256:'e'.repeat(64)},previous:{version:'4.226.0',bytes:122,sha256:'f'.repeat(64)}}
 const report={productCommit:pin.product,verifierCommit:verifier,complete:true,cleanupComplete:true,syntheticData:true,usedDefaultDataPath:true,forceTerminated:false,platform:'win32',runnerEnvironment:'github-hosted',installers:{current:{...pin.current},previous:{...pin.previous}},documentOutlineSource:{productCommit:pin.product,sha:pin.outlineBlob},documentSearchSource:{productCommit:pin.product,sha:pin.searchBlob},checks:['installed-app-document-outline-workflow','installed-app-document-search-workflow']}
 const module=(checks,filename)=>({commit:verifier,complete:true,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[...checks],screenshots:[{filename,bytes:100,sha256:'1'.repeat(64)}]})
 return{pin,report,outline:module(DOCUMENT_OUTLINE_CHECKS,'document-outline-installed.png'),search:module(DOCUMENT_SEARCH_CHECKS,'document-search-installed.png')}
}
const check=f=>validateInstalledOutline(f.report,f.outline,f.search,f.pin,verifier)
test('source-bound outline and original document search gates are accepted together',()=>assert.equal(check(fixture()),true))
for(const[name,change]of [
 ['other product',f=>f.report.productCommit='0'.repeat(40)],['other verifier',f=>f.report.verifierCommit='0'.repeat(40)],
 ['old current version',f=>f.pin.current.version='4.227.0'],['wrong upgrade seed',f=>f.pin.previous.version='4.225.0'],
 ['invalid binary size',f=>f.pin.current.bytes=-1],['invalid checksum',f=>f.pin.current.sha256='broken'],['different binary',f=>f.report.installers.current.sha256='0'.repeat(64)],
 ['incomplete lifecycle',f=>f.report.complete=false],['unfinished cleanup',f=>f.report.cleanupComplete=false],['user data',f=>f.report.syntheticData=false],['alternate data directory',f=>f.report.usedDefaultDataPath=false],['force termination',f=>f.report.forceTerminated=true],['non-Windows',f=>f.report.platform='linux'],['nonhosted',f=>f.report.runnerEnvironment='self-hosted'],
 ['old outline code',f=>f.report.documentOutlineSource.sha='0'.repeat(40)],['old search code',f=>f.report.documentSearchSource.sha='0'.repeat(40)],
 ['missing outline installation gate',f=>f.report.checks.shift()],['missing search installation gate',f=>f.report.checks.pop()],['duplicate installation gate',f=>f.report.checks.push(f.report.checks[0])],
 ['other outline run',f=>f.outline.commit='0'.repeat(40)],['other search run',f=>f.search.commit='0'.repeat(40)],['incomplete outline',f=>f.outline.complete=false],['incomplete search',f=>f.search.complete=false],
 ['fake outline backend',f=>f.outline.realBackend=false],['fake search app',f=>f.search.realPackagedApp=false],['real user outline',f=>f.outline.syntheticData=false],
 ['missing outline check',f=>f.outline.checks.pop()],['duplicate outline check',f=>f.outline.checks[1]=f.outline.checks[0]],['removed clipboard proof',f=>f.outline.checks=f.outline.checks.filter(n=>!n.includes('clipboard'))],['removed foreground proof',f=>f.outline.checks=f.outline.checks.filter(n=>!n.includes('foreground'))],
 ['missing original search check',f=>f.search.checks.pop()],['duplicate original search check',f=>f.search.checks[1]=f.search.checks[0]],
 ['missing outline shot',f=>f.outline.screenshots=[]],['missing search shot',f=>f.search.screenshots=[]],['unsafe shot path',f=>f.outline.screenshots[0].filename='../other'],['empty shot',f=>f.outline.screenshots[0].bytes=0],['invalid shot hash',f=>f.outline.screenshots[0].sha256='bad'],['second shot',f=>f.search.screenshots.push(f.search.screenshots[0])],
 ])test('refuses '+name,()=>{const f=fixture();change(f);assert.throws(()=>check(f))})
test('foreign verifier source cannot be adapted',()=>assert.throws(()=>prepareOutlineInstallation('not the core','not the script',fixture().pin)))
