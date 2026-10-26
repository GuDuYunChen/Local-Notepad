import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { blockReportFixture, product, verifier } from './block-references-test-fixture.mjs'
import { BLOCK_REFERENCE_REPORT, blockReferenceHash, validateBlockReferencesReport, verifyBlockReferencesReport } from './block-references-evidence.mjs'
const expected=pin=>({commit:product,verifier,scope:'installed',sources:pin.blockReferenceSources})
test('synthetic valid report exercises the full validator, not native acceptance',()=>{const{pin,report}=blockReportFixture();assert.equal(validateBlockReferencesReport(report,expected(pin)),true)})
for(const [name,change]of[
 ['fake layout',r=>r.verificationScope='development-business-only'],['overflow',r=>r.smallViewport.overflow=true],['wrong window owner',r=>r.minimumWindow.pid++],['not dark',r=>r.darkPanel.theme='light'],
 ['missing check',r=>r.checks.pop()],['duplicate check',r=>r.checks.push(r.checks[0])],['wrong order',r=>r.checks.reverse()],
 ['incomplete',r=>r.complete=false],['unclean',r=>r.cleanupComplete=false],['force exit',r=>r.forceTerminated=true],['wrong platform',r=>r.platform='linux'],['local report',r=>r.localValidationOnly=true],['wrong runner',r=>r.runnerEnvironment='self-hosted'],
 ['bridge mock',r=>r.bridgeOverridden=true],['fast timers',r=>r.timerAccelerated=true],['no backend',r=>r.realBackend=false],['wrong version',r=>r.app.version='4.235.0'],['not packaged',r=>r.app.packaged=false],['old source',r=>r.sourceFiles['src/App.jsx']='f'.repeat(40)],['missing source',r=>delete r.sourceFiles['src/App.jsx']],
 ['wrong product',r=>r.productCommit='f'.repeat(40)],['wrong verifier',r=>r.verifierCommit='e'.repeat(40)],['wrong scope',r=>r.scope='packaged'],['no normal exit',r=>r.exit.normalClose=false],['wrong pid',r=>r.exit.pid++],['nonzero exit',r=>r.exit.code=1],['backend alive',r=>r.backendStopped=false],['bad binary hash',r=>r.asarSHA256='a'.repeat(63)],
 ['reported failure',r=>r.error='failed'],['cleanup failure',r=>r.cleanupError='failed'],['fixture identity',r=>r.saved.source.id='wrong'],['deleted source',r=>r.saved.source.is_deleted=true],['folder source',r=>r.saved.source.is_folder=true],
 ['lost block',r=>{const d=JSON.parse(r.saved.source.content);delete d.root.children[0].$;r.saved.source.content=JSON.stringify(d)}],['duplicate anchor',r=>{const d=JSON.parse(r.saved.source.content);d.root.children.push(d.root.children[0]);r.saved.source.content=JSON.stringify(d)}],
 ['missing embed',r=>{const d=JSON.parse(r.saved.destination.content);d.root.children.pop();r.saved.destination.content=JSON.stringify(d)}],['lost inline',r=>{const d=JSON.parse(r.saved.destination.content);d.root.children.shift();r.saved.destination.content=JSON.stringify(d)}],
 ['wrong locator',r=>r.fixture.locator+='?x=1'],['missing image',r=>r.screenshots.pop()],['image path traversal',r=>r.screenshots[0].filename='../a.png'],['invalid image digest',r=>r.screenshots[0].sha256='no'],
])test('refuses '+name,()=>{const{pin,report}=blockReportFixture();change(report);assert.throws(()=>validateBlockReferencesReport(report,expected(pin)))})
test('file verification reads actual bytes and rejects tampered screenshot',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'blocks-contract-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const{pin,report}=blockReportFixture()
 // PNG header fixture is intentionally not a screenshot. Validator only promises
 // identity/dimensions; actual screenshots are collected by the native driver.
 const image=Buffer.alloc(2000);Buffer.from('89504e470d0a1a0a','hex').copy(image);image.writeUInt32BE(800,16);image.writeUInt32BE(600,20)
 for(const item of report.screenshots){item.sha256=blockReferenceHash(image);writeFileSync(path.join(dir,item.filename),image)}
 writeFileSync(path.join(dir,BLOCK_REFERENCE_REPORT),JSON.stringify(report));assert.equal(verifyBlockReferencesReport(dir,expected(pin)).complete,true)
 writeFileSync(path.join(dir,report.screenshots[0].filename),Buffer.from('tampered'));assert.throws(()=>verifyBlockReferencesReport(dir,expected(pin)))
})
