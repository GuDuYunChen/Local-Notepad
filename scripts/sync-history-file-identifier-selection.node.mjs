import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { selectHistoryFileIdentifier, clearHistoryFileIdentifierSelection } from '../src/services/syncHistoryFileIdentifierSelection.mjs'
const { verifyIdentifierSelectionScene } = createRequire(import.meta.url)('./sync-history-file-identifier-selection-evidence.cjs')
function fixture(text = '记录-🌱-abc') {
  let clears = 0, adds = 0, target = null
  const selection = { rangeCount: 0, anchorNode: null, focusNode: null,
    removeAllRanges() { clears++; this.rangeCount = 0; this.anchorNode = this.focusNode = null },
    addRange(range) { adds++; this.rangeCount = 1; this.anchorNode = this.focusNode = range.target },
    toString() { return this.rangeCount ? this.anchorNode.textContent : '' } }
  const node = { nodeName: 'CODE', isConnected: true, textContent: text,
    hasAttribute: key => key === 'data-history-file-selectable-id', contains: child => child === node,
    ownerDocument: { defaultView: { getSelection: () => selection }, createRange: () => ({ selectNodeContents(n) { this.target = n; target = n } }) } }
  return { node, selection, get clears() { return clears }, get adds() { return adds }, get target() { return target } }
}
for (const text of ['对象-🌱', 'A&B <literal>', 'x'.repeat(128), '记录-ＡＢＣ']) test('select exact inert identifier ' + text.slice(0, 15), () => {
  const f = fixture(text); assert.equal(selectHistoryFileIdentifier(f.node), true)
  assert.equal(f.selection.toString(), text); assert.equal(f.target, f.node); assert.equal(f.adds, 1); assert.equal(f.clears, 1)
})
test('selecting twice replaces, never accumulates ranges or appends a label', () => {
  const f=fixture(); selectHistoryFileIdentifier(f.node); selectHistoryFileIdentifier(f.node)
  assert.equal(f.selection.rangeCount,1);assert.equal(f.adds,2)
})
for (const [name,change] of [['detached',f=>f.node.isConnected=false],['non-code',f=>f.node.nodeName='DIV'],['unmarked',f=>f.node.hasAttribute=()=>false],['empty',f=>f.node.textContent='']]) test('refuse '+name+' before changing a selection',()=>{
  const f=fixture();change(f);assert.equal(selectHistoryFileIdentifier(f.node),false);assert.equal(f.clears,0)
})
test('null targets are safe no-ops',()=>{assert.equal(selectHistoryFileIdentifier(null),false);assert.equal(clearHistoryFileIdentifierSelection(null),false)})
for(const [name,change]of[
 ['missing selection',f=>f.node.ownerDocument.defaultView.getSelection=()=>null],
 ['denied selection',f=>f.node.ownerDocument.defaultView.getSelection=()=>{throw Error('PRIVATE')}],
 ['range creation',f=>f.node.ownerDocument.createRange=()=>{throw Error('PRIVATE')}],
 ['add range',f=>f.selection.addRange=()=>{throw Error('PRIVATE')}],
 ['partial selection',f=>f.selection.toString=()=> 'partial'],
 ['wrong endpoint',f=>f.selection.addRange=()=>{f.selection.rangeCount=1;f.selection.anchorNode=f.node;f.selection.focusNode={}}],
])test('selection failure is not a success: '+name,()=>{const f=fixture();change(f);assert.equal(selectHistoryFileIdentifier(f.node),false)})
test('clears only a complete single selection owned by the supplied node',()=>{
 const f=fixture();selectHistoryFileIdentifier(f.node);assert.equal(clearHistoryFileIdentifierSelection(f.node),true)
 assert.equal(f.selection.toString(),'');assert.equal(clearHistoryFileIdentifierSelection(f.node),false)
})
for(const [name,change]of[
 ['outside both',f=>{f.selection.anchorNode={};f.selection.focusNode={}}],
 ['extended outside',f=>f.selection.focusNode={}],
 ['multiple ranges',f=>f.selection.rangeCount=2],
])test('preserve unrelated user selection: '+name,()=>{const f=fixture();selectHistoryFileIdentifier(f.node);change(f);const before=f.clears;assert.equal(clearHistoryFileIdentifierSelection(f.node),false);assert.equal(f.clears,before)})
test('clear tolerates denied APIs without exposing error text',()=>{const f=fixture();selectHistoryFileIdentifier(f.node);f.selection.removeAllRanges=()=>{throw Error('PRIVATE')};assert.equal(clearHistoryFileIdentifierSelection(f.node),false)})
function scene(){return {identifierSelections:['object','record','collapse-cleared','page-cleared'].map((action,i)=>({action,reads:1,network:0,mutations:0,pageUnchanged:i!==3,page:i===3?'第 2 / 3 页':'第 1 / 3 页',orderUnchanged:true,
 text:i===0?'same':i===1?'r0':'',rangeCount:i<2?1:0,kind:i===0?'object':'record',recordID:'r0',exactNode:true,focusRetained:true,visible:true,contrast:5,notice:i<2?'已选中标识；请手动复制。':''}))}}
test('accept exact four-action selection evidence without claiming clipboard writes',()=>assert.equal(verifyIdentifierSelectionScene(scene()),true))
for(const [name,change]of[
 ['wrong text',s=>s.identifierSelections[0].text='对象：same'],['other row',s=>s.identifierSelections[1].recordID='r1'],
 ['unscoped range',s=>s.identifierSelections[0].exactNode=false],['lost focus',s=>s.identifierSelections[0].focusRetained=false],
 ['offscreen control',s=>s.identifierSelections[1].visible=false],['low contrast',s=>s.identifierSelections[0].contrast=4.49],
 ['stale hidden selection',s=>s.identifierSelections[2].text='r0'],['stale notice',s=>s.identifierSelections[3].notice='已选中'],
 ['false copied receipt',s=>s.identifierSelections[1].notice='已复制标识'],['extra read',s=>s.identifierSelections[0].reads=2],
 ['extra network',s=>s.identifierSelections[0].network=1],['changed order',s=>s.identifierSelections[0].orderUnchanged=false],
 ['missing action',s=>s.identifierSelections.pop()],
])test('reject '+name,()=>{const s=scene();change(s);assert.throws(()=>verifyIdentifierSelectionScene(s))})
