import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { revealBlockReferenceEditor, focusBlockReferenceParagraph } from './block-references-desktop-driver.mjs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { blockReportFixture, product, verifier } from './block-references-test-fixture.mjs'
import { BLOCK_REFERENCE_REPORT, blockReferenceHash, validateBlockReferencesReport, verifyBlockReferencesReport } from './block-references-evidence.mjs'
const expected=pin=>({commit:product,verifier,scope:'installed',sources:pin.blockReferenceSources})
test('synthetic valid report exercises the full validator, not native acceptance',()=>{const{pin,report}=blockReportFixture();assert.equal(validateBlockReferencesReport(report,expected(pin)),true)})
for(const [name,change]of[
 ['missing entry receipt',r=>delete r.smallWindowEntry],['covered entry',r=>r.smallWindowEntry.after.entryReachable=false],
 ['unproven collapse',r=>r.smallWindowEntry.collapsedByClick=false],['changed viewport',r=>r.smallWindowEntry.after.width=1400],
 ['sidebar still covering',r=>r.smallWindowEntry.after.blockedBySidebar=true],
 ['white dark panel',r=>r.darkPanel.background='rgb(255, 255, 255)'],['wrong dark ink',r=>r.darkPanel.color='rgb(34, 34, 34)'],
 ['light tokens in dark mode',r=>Object.assign(r.darkPanel,{background:'rgb(255, 255, 255)',surface:'#ffffff',color:'rgb(34, 34, 34)',ink:'#222222'})],
 ['low contrast dark panel',r=>Object.assign(r.darkPanel,{color:'rgb(40, 40, 40)',ink:'#282828'})],
 ['missing dark token',r=>delete r.darkPanel.surface],
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

// Protocol-level recovery tests; native reachability is still proved by the
// packaged/installed Windows run, not these synthetic DOM observations.
function entryFixture({width=704,expanded=true,blocked=true}={}) {
 let state={width,height:455,sidebarPresent:true,sidebarExpanded:expanded,entryPresent:true,
   entryReachable:!blocked,blockedBySidebar:blocked}
 const clicks=[],observations=[]
 const context={evaluate:async expression=>{
   observations.push(expression)
   if(expression.includes("document.querySelector('.workspace-sidebar.collapsed')"))return !state.sidebarExpanded
   return {...state}
 },click:async selector=>{clicks.push(selector);state={...state,sidebarExpanded:false,blockedBySidebar:false,entryReachable:true}},
 until:async(probe,label)=>{for(let n=0;n<3;n++){const value=await probe();if(value)return value}throw Error(label)}}
 return{context,clicks,observations,set:patch=>{state={...state,...patch}}}
}
test('small-window entry uses one native collapse and retains actual bounds',async()=>{
 const f=entryFixture(),receipt=await revealBlockReferenceEditor(f.context)
 assert.deepEqual(f.clicks,['.workspace-sidebar button[aria-label="折叠侧边栏"]'])
 assert.equal(receipt.before.entryReachable,false);assert.equal(receipt.after.entryReachable,true)
 assert.equal(receipt.collapsedByClick,true);assert.equal(receipt.after.width,704);assert.equal(receipt.after.height,455)
 assert.ok(f.observations.every(source=>!source.includes('localStorage')&&!source.includes('.click(')&&!source.includes('.style')))
})
test('large-window expanded sidebar is preserved',async()=>{
 const f=entryFixture({width:1400,blocked:false}),receipt=await revealBlockReferenceEditor(f.context)
 assert.deepEqual(f.clicks,[]);assert.equal(receipt.after.sidebarExpanded,true);assert.equal(receipt.collapsedByClick,false)
})
test('already collapsed narrow sidebar is not toggled back open',async()=>{
 const f=entryFixture({expanded:false,blocked:false});await revealBlockReferenceEditor(f.context);assert.deepEqual(f.clicks,[])
})
test('visible narrow-window entry does not collapse an unrelated expanded sidebar',async()=>{
 const f=entryFixture({blocked:false});await revealBlockReferenceEditor(f.context);assert.deepEqual(f.clicks,[])
})
test('unconfirmed native collapse is not replayed',async()=>{
 const f=entryFixture(),error=Error('native click unconfirmed');f.context.click=async selector=>{f.clicks.push(selector);throw error}
 await assert.rejects(revealBlockReferenceEditor(f.context),e=>e===error);assert.equal(f.clicks.length,1)
})
test('no-change native collapse fails without re-clicking',async()=>{
 const f=entryFixture();f.context.click=async selector=>{f.clicks.push(selector)}
 await assert.rejects(revealBlockReferenceEditor(f.context),/did not collapse/);assert.equal(f.clicks.length,1)
})
test('a different overlay stays a failure instead of collapsing the sidebar',async()=>{
 const f=entryFixture({blocked:false});f.set({entryReachable:false})
 await assert.rejects(revealBlockReferenceEditor(f.context),/still occluded/);assert.equal(f.clicks.length,0)
})
test('missing entry is not silently repaired or reported as visible',async()=>{
 const f=entryFixture();f.set({entryPresent:false});await assert.rejects(revealBlockReferenceEditor(f.context),/entry is missing/);assert.equal(f.clicks.length,0)
})

for(const key of ['smallWindowCaret','darkWindowCaret'])for(const [name,change]of[
 ['missing',r=>delete r[key]],['ambiguous',r=>r[key].before.candidateCount=2],
 ['root boundary',r=>r[key].after.topLevelParagraph=false],['readonly',r=>r[key].after.editable=false],
 ['range',r=>r[key].after.collapsed=false],['nontext',r=>r[key].after.textNode=false],
 ['wrong note',r=>r[key].after.marker='another note'],['offscreen',r=>r[key].before.x=800],
 ['resized',r=>r[key].after.width=1400],['synthetic method',r=>r[key].method='setSelection'],
])test('refuses '+key+' '+name,()=>{const{pin,report}=blockReportFixture();change(report);assert.throws(()=>validateBlockReferencesReport(report,expected(pin)))})
function caretFixture() {
 const before={candidateCount:1,marker:'BLOCK103 destination',x:120,y:180,width:704,height:455}
 const after={marker:before.marker,collapsed:true,textNode:true,topLevelParagraph:true,editable:true,width:704,height:455}
 const inputs=[],expressions=[]
 const context={evaluate:async expression=>{expressions.push(expression);return expression.includes('getSelection()')?after:before},
 cdp:{send:async(method,input)=>{inputs.push({method,...input})}},
 until:async(probe,label)=>{for(let n=0;n<3;n++){const value=await probe();if(value)return value}throw Error(label)}}
 return {context,before,after,inputs,expressions}
}
test('native caret positioning sends one mouse pair and does not mutate selection or content',async()=>{
 const f=caretFixture(),receipt=await focusBlockReferenceParagraph(f.context)
 assert.equal(receipt.method,'native-text-click');assert.deepEqual(f.inputs.map(i=>i.type),['mousePressed','mouseReleased'])
 assert.ok(f.inputs.every(i=>i.method==='Input.dispatchMouseEvent'&&i.x===120&&i.y===180&&i.clickCount===1))
 assert.ok(f.expressions.every(s=>!s.includes('removeAllRanges')&&!s.includes('addRange')&&!s.includes('setSelection')&&!s.includes('.click(')&&!s.includes('localStorage')))
})
test('ambiguous paragraph refuses before input',async()=>{
 const f=caretFixture();f.before.candidateCount=2;await assert.rejects(focusBlockReferenceParagraph(f.context),/ambiguous/);assert.equal(f.inputs.length,0)
})
test('unconfirmed native caret is not clicked again',async()=>{
 const f=caretFixture();f.context.evaluate=async s=>s.includes('getSelection()')?null:f.before
 await assert.rejects(focusBlockReferenceParagraph(f.context),/did not establish/);assert.equal(f.inputs.length,2)
})
test('native caret input failure is not replayed',async()=>{
 const f=caretFixture();f.context.cdp.send=async(method,input)=>{f.inputs.push(input);throw Error('native unavailable')}
 await assert.rejects(focusBlockReferenceParagraph(f.context),/native unavailable/);assert.equal(f.inputs.length,1)
})
