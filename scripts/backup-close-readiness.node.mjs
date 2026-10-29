import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {observeBackupCloseReadiness,verifyBackupCloseWitness,buildBackupCloseDriver} from './prepare-backup-close-readiness.mjs'
// Deterministic DOM observation counterexamples, NOT real browser/native evidence.
function context(change=()=>{}){
 let frame=0,time=0;const state={left:800,top:50,width:28,height:28,animation:'finished',busy:false,hit:true,buttons:1,owners:1,hidden:false,inert:false,disabled:false,opacity:'1',connected:true,replace:false}
 const node={parentElement:null,get isConnected(){return state.connected},get disabled(){return state.disabled},get hidden(){return state.hidden},closest:()=>state.inert?{}:null,getAnimations:()=>[{playState:state.animation,pending:state.pending}],getBoundingClientRect:()=>({left:state.left,top:state.top,width:state.width,height:state.height,right:state.left+state.width,bottom:state.top+state.height}),contains:n=>n===node}
 const owner={contains:n=>n===node,querySelector:()=>state.busy?{}:null}
 const ctx=vm.createContext({performance:{now:()=>time},innerWidth:1008,innerHeight:655,requestAnimationFrame:fn=>{time+=16;change(state,++frame);fn()},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:state.opacity}),document:{querySelectorAll:s=>s==='.backup-center-modal'?Array(state.owners).fill(owner):Array(state.buttons).fill(state.replace?{...node}:node),elementFromPoint:()=>state.hit?node:{}}})
 return{ctx,state,run:()=>vm.runInContext('('+observeBackupCloseReadiness.toString()+')()',ctx)}
}
test('stable owned enabled target is observed across three frames',async()=>{const c=context();const r=await c.run();assert.equal(r.frames,3);assert.equal(r.elapsedMs,48);assert.equal(r.hit,true)})
for(const[k,v]of Object.entries({animation:'running',busy:true,hit:false,buttons:2,owners:2,hidden:true,inert:true,disabled:true,opacity:'0',connected:false,pending:true,left:-5,top:-2,width:0,height:0}))test('refuses initial '+k,async()=>{const c=context();c.state[k]=v;assert.equal(await c.run(),null)})
for(const[k,v]of Object.entries({animation:'running',busy:true,hit:false,buttons:0,owners:0,hidden:true,inert:true,disabled:true,opacity:'0',connected:false,pending:true,left:802,top:52,width:30,height:30,replace:true}))test('refuses between-frame '+k,async()=>{const c=context((s,i)=>{if(i===2)s[k]=v});assert.equal(await c.run(),null)})
test('old single point admits running animation; new observation refuses until settled',async()=>{const c=context();c.state.animation='running';assert.equal(c.state.hit,true);assert.equal(await c.run(),null);c.state.animation='finished';assert.equal((await c.run()).frames,3)})
function report(){return{destinations:[{id:'backup',accepted:true,launcherClosed:true}],backupCloseReadiness:{selector:'.backup-center-modal button[aria-label="关闭备份中心"]',frames:3,elapsedMs:50,width:1008,height:655,before:{left:800,top:50,right:828,bottom:78},after:{left:800,top:50,right:828,bottom:78},activeAnimations:0,backupBusy:false,hit:true,originalClickCount:1,normalCloseObserved:true}}}
test('complete supplementary witness, not acceptance on its own',()=>assert.equal(verifyBackupCloseWitness(report()),true))
for(const[k,v]of Object.entries({selector:'button',frames:1,elapsedMs:NaN,width:500,height:70,activeAnimations:1,backupBusy:true,hit:false,originalClickCount:2,normalCloseObserved:false}))test('refuses witness '+k,()=>{const r=report();r.backupCloseReadiness[k]=v;assert.throws(()=>verifyBackupCloseWitness(r))})
test('original driver transformation is exact and cannot be applied twice',()=>{const original=readFileSync(new URL('./local-actions-desktop-driver.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');const next=buildBackupCloseDriver(original);assert.equal(next.match(/await click\(selector\+' button\[aria-label='/g).length,1);assert.throws(()=>buildBackupCloseDriver(next));assert.throws(()=>buildBackupCloseDriver(original+'\n'))})
test('observation cannot synthesize clicks, change animation/layout, or extend timeouts',()=>{const s=observeBackupCloseReadiness.toString();assert.doesNotMatch(s,/\.click\(|dispatchEvent|setAttribute|\.style\s*=|\.cancel\(|\.finish\(|setTimeout|setInterval/);assert.match(s,/getAnimations/);assert.match(s,/requestAnimationFrame/);assert.match(s,/elementFromPoint/)})
