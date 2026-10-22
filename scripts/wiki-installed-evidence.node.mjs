import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {WIKI_CHECKS,extendWikiInstallation,validateInstalledWiki} from './wiki-installed-evidence.mjs'
const verifier='b'.repeat(40)
// Validator-only synthetic fixtures are never reported as Windows execution.
function fixture(){
 const pin={product:'a'.repeat(40),current:{version:'4.231.2',bytes:100,sha256:'c'.repeat(64)},previous:{version:'4.230.1',bytes:99,sha256:'d'.repeat(64)}}
 for(const k of ['quickBlob','tagsBlob','templateBlob','backlinksBlob','searchBlob','outlineBlob','graphBlob','pinsBlob','recentBlob','wikiBlob'])pin[k]='e'.repeat(40)
 const report={productCommit:pin.product,verifierCommit:verifier,complete:true,cleanupComplete:true,syntheticData:true,usedDefaultDataPath:true,forceTerminated:false,platform:'win32',runnerEnvironment:'github-hosted',installers:{current:{...pin.current},previous:{...pin.previous}},wikiNavigationSource:{productCommit:pin.product,sha:pin.wikiBlob},checks:['installed-app-wiki-navigation-workflow']}
 const wiki={commit:verifier,complete:true,realPackagedApp:true,realBackend:true,syntheticData:true,checks:[...WIKI_CHECKS],delayedRead:{realResponse:true,method:'GET',responseStatusCode:200,replayed:false},delayedBodyRead:{verification:{method:'GET',responseStatusCode:200,continuedUnchanged:true},editor:{method:'GET',responseStatusCode:200},selectedBeforeBodyReady:true,replayed:false,ordinaryReopen:{sourceRetained:true,targetLoaded:true,anchorEvents:0,outlineOpened:false}},unavailableTarget:{deletionConfirmed:true,readRejected:true,navigationRejected:true},screenshots:['wiki-navigation-body-return-installed.png','wiki-navigation-installed.png'].map(filename=>({filename,bytes:100,sha256:'f'.repeat(64)}))}
 return {pin,report,wiki}
}
test('accepts complete source-bound Wiki installed evidence',()=>{const f=fixture();assert.equal(validateInstalledWiki(f.report,f.wiki,f.pin,verifier),true)})
for(const[name,mutate]of [
 ['old version',f=>f.pin.current.version='4.230.1'],['wrong seed',f=>f.pin.previous.version='4.229.0'],['wrong product',f=>f.report.productCommit='f'.repeat(40)],['wrong verifier',f=>f.report.verifierCommit='f'.repeat(40)],['wrong Wiki source',f=>f.report.wikiNavigationSource.sha='f'.repeat(40)],['source product mismatch',f=>f.report.wikiNavigationSource.productCommit='f'.repeat(40)],['bad source hash',f=>f.pin.wikiBlob='invalid'],['missing inherited source',f=>delete f.pin.recentBlob],['bad binary digest',f=>f.pin.current.sha256='invalid'],['empty binary',f=>f.pin.current.bytes=0],['fractional binary size',f=>f.pin.current.bytes=1.5],['different installer',f=>f.report.installers.current.bytes=101],['not complete',f=>f.report.complete=false],['no cleanup',f=>f.report.cleanupComplete=false],['forced exit',f=>f.report.forceTerminated=true],['user data',f=>f.report.syntheticData=false],['alternate profile',f=>f.report.usedDefaultDataPath=false],['wrong platform',f=>f.report.platform='linux'],['self hosted',f=>f.report.runnerEnvironment='self-hosted'],['missing installed hook',f=>f.report.checks=[]],['duplicate hook',f=>f.report.checks.push(f.report.checks[0])],['wrong native run',f=>f.wiki.commit='f'.repeat(40)],['unfinished native',f=>f.wiki.complete=false],['unpackaged app',f=>f.wiki.realPackagedApp=false],['mock backend',f=>f.wiki.realBackend=false],['unsafe native data',f=>f.wiki.syntheticData=false],['missing check',f=>f.wiki.checks.pop()],['duplicate check',f=>f.wiki.checks[1]=f.wiki.checks[0]],['reordered checks',f=>f.wiki.checks.reverse()],['no real delayed response',f=>f.wiki.delayedRead.realResponse=false],['wrong method',f=>f.wiki.delayedRead.method='PUT'],['error instead of real target',f=>f.wiki.delayedRead.responseStatusCode=500],['replayed request',f=>f.wiki.delayedRead.replayed=true],['no deletion confirmation',f=>f.wiki.unavailableTarget.deletionConfirmed=false],['deleted target exposed',f=>f.wiki.unavailableTarget.readRejected=false],['deleted target selected',f=>f.wiki.unavailableTarget.navigationRejected=false],['missing image',f=>f.wiki.screenshots=[]],['extra image',f=>f.wiki.screenshots.push({...f.wiki.screenshots[0]})],['unsafe image name',f=>f.wiki.screenshots[0].filename='../wiki-navigation-installed.png'],['zero image',f=>f.wiki.screenshots[0].bytes=0],['bad image hash',f=>f.wiki.screenshots[0].sha256='invalid'],
])test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>validateInstalledWiki(f.report,f.wiki,f.pin,verifier))})
for(const[name,mutate]of [
 ['previous patch version',f=>f.pin.current.version='4.231.1'],
 ['missing delayed body evidence',f=>delete f.wiki.delayedBodyRead],
 ['verification is not GET',f=>f.wiki.delayedBodyRead.verification.method='POST'],
 ['verification is not a real successful response',f=>f.wiki.delayedBodyRead.verification.responseStatusCode=500],
 ['verification response was changed',f=>f.wiki.delayedBodyRead.verification.continuedUnchanged=false],
 ['missing second editor GET',f=>delete f.wiki.delayedBodyRead.editor],
 ['editor body request is not GET',f=>f.wiki.delayedBodyRead.editor.method='POST'],
 ['editor body request did not return real content',f=>f.wiki.delayedBodyRead.editor.responseStatusCode=500],
 ['target was not selected while body remained pending',f=>f.wiki.delayedBodyRead.selectedBeforeBodyReady=false],
 ['replayed delayed body request',f=>f.wiki.delayedBodyRead.replayed=true],
 ['missing ordinary reopen result',f=>delete f.wiki.delayedBodyRead.ordinaryReopen],
 ['source body was not retained',f=>f.wiki.delayedBodyRead.ordinaryReopen.sourceRetained=false],
 ['ordinary target body was not loaded',f=>f.wiki.delayedBodyRead.ordinaryReopen.targetLoaded=false],
 ['abandoned anchor event was revived',f=>f.wiki.delayedBodyRead.ordinaryReopen.anchorEvents=1],
 ['ordinary reopen opened the old outline',f=>f.wiki.delayedBodyRead.ordinaryReopen.outlineOpened=true],
 ['missing ordinary-return image',f=>f.wiki.screenshots.shift()],
 ['missing original deletion image',f=>f.wiki.screenshots.pop()],
 ['reordered workflow images',f=>f.wiki.screenshots.reverse()],
 ['empty original deletion image',f=>f.wiki.screenshots[1].bytes=0],
 ['bad original deletion image hash',f=>f.wiki.screenshots[1].sha256='invalid'],
])test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>validateInstalledWiki(f.report,f.wiki,f.pin,verifier))})
test('required evidence matches all sixteen real native workflow checkpoints',()=>{
 const source=readFileSync(new URL('./check-wiki-navigation-desktop.mjs',import.meta.url),'utf8')
 assert.equal(WIKI_CHECKS.length,16)
 assert.deepEqual([...source.matchAll(/mark\('([^']+)'\)/g)].map(match=>match[1]),WIKI_CHECKS)
})
function inherited(pin){return {core:`export const PRODUCT_COMMIT = '${pin.product}'\nconst checks=['installed-app-recent-notes-workflow',]`,script:"  await verifyRecentNotesDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})\nmark('installed-app-recent-notes-workflow')\n// original save and quit policy retained"}}
test('extends exactly one Wiki hook and inverse-preserves old lifecycle',()=>{const{pin}=fixture(),original=inherited(pin),next=extendWikiInstallation(original,pin);assert.ok(next.script.includes('original save and quit policy retained'));assert.equal(next.script.match(/await verifyWikiNavigationDesktop/g).length,1);assert.equal(original.script.includes('verifyWikiNavigationDesktop'),false)})
for(const[name,mutate]of [['duplicate native hook',p=>p.script+='\nverifyWikiNavigationDesktop'],['duplicate source marker',p=>p.script+='\nwikiNavigationSource'],['duplicate lifecycle marker',p=>p.script+="\nmark('installed-app-wiki-navigation-workflow')"],['duplicate core marker',p=>p.core+="\n'installed-app-wiki-navigation-workflow'"],['missing recent hook',p=>p.script=p.script.replace('verifyRecentNotesDesktop','other')],['duplicate recent hook',p=>p.script+=p.script],['wrong product core',p=>p.core=p.core.replace('a'.repeat(40),'z'.repeat(40))],['missing core anchor',p=>p.core=p.core.replace('installed-app-recent-notes-workflow','other')]])test('rejects extension '+name,()=>{const{pin}=fixture(),p=inherited(pin);mutate(p);assert.throws(()=>extendWikiInstallation(p,pin))})
