// Invoke the actual App callback text; these are callback contracts, not React mounts.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {URL as NodeURL} from 'node:url'
import vm from 'node:vm'
const source=readFileSync(new NodeURL('../src/App.jsx',import.meta.url),'utf8')
const start='  const handleSelectFile = ',end='\n\n  const handleInspectorSelectFile = '
const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a)
const code=source.slice(a+start.length,b)
const note={id:'a',title:'old',content:'old body'},fresh={...note,title:'renamed',content:'latest saved body'}
function fixture({workspace='recent',unsaved=false}={}){
 const calls=[],context={current:note,workspace,unsaved,deletedIds:new Set(),select:f=>calls.push(['select',f]),setWorkspace:w=>calls.push(['workspace',w]),setDialog:d=>calls.push(['dialog',d])}
 vm.createContext(context);return{calls,select:vm.runInContext('('+code+')',context)}
}
export function registerRecentReopenTests(test){
 test('explicit clean same-note workspace return selects the verified fresh file',()=>{const f=fixture();let confirmed;f.select(fresh,{refreshCurrent:true,afterSelect:x=>confirmed=x});assert.deepEqual(f.calls,[['select',fresh]]);assert.equal(confirmed,fresh)})
 test('ordinary same-note return keeps its original shortcut behavior',()=>{const f=fixture();f.select(fresh);assert.deepEqual(f.calls,[['workspace','notes']])})
 test('same-note refresh never replaces an unsaved current draft',()=>{const f=fixture({unsaved:true});f.select(fresh,{refreshCurrent:true});assert.deepEqual(f.calls,[['workspace','notes']])})
 test('same-note already-open editor is not reset even with refresh requested',()=>{const f=fixture({workspace:'notes'});f.select(fresh,{refreshCurrent:true});assert.deepEqual(f.calls,[['workspace','notes']])})
 test('truthy nonboolean refresh cannot opt in',()=>{const f=fixture();f.select(fresh,{refreshCurrent:'true'});assert.deepEqual(f.calls,[['workspace','notes']])})
 test('cancelled ownership cannot select or refresh anything',()=>{const f=fixture();let cancelled=0;f.select(fresh,{refreshCurrent:true,shouldSelect:()=>false,onCancel:()=>cancelled++});assert.equal(f.calls.length,0);assert.equal(cancelled,1)})
 test('different-note refresh request cannot bypass the original dirty guard',()=>{const f=fixture({unsaved:true});f.select({...fresh,id:'b'},{refreshCurrent:true});assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'dialog');assert.equal(f.calls[0][1].type,'unsaved')})
 test('a delayed original guard cannot refresh after its source becomes invalid',()=>{const f=fixture({unsaved:true});let valid=true,cancelled=0;f.select({...fresh,id:'b'},{refreshCurrent:true,shouldSelect:()=>valid,onCancel:()=>cancelled++});const dialog=f.calls[0][1];valid=false;dialog.next();assert.equal(f.calls.length,1);assert.equal(cancelled,1)})
}
