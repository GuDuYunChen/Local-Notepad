import {test} from 'node:test'
import assert from 'node:assert/strict'
import {historyTabReady,waitForInstallerHistoryTab,prepareInstallerHistoryReadiness} from './installer-history-readiness.mjs'
const fixture=()=>{
 const node={isConnected:true,disabled:false,getAttribute:()=>null,getBoundingClientRect:()=>({width:120,height:30})}
 let present=false,loading=true
 const document={querySelector:s=>s==='#inspector-tab-history'?(present?node:null):(loading?{}:null)}
 const style={visibility:'visible',display:'block'}
 return {node,document,style,setReady(){present=true;loading=false},show(){present=true}}
}
test('legacy immediate click misses lazy tab while readiness waits for the mounted control',async()=>{
 const f=fixture();assert.equal(f.document.querySelector('#inspector-tab-history'),null)
 let checks=0,evaluations=0
 const evaluate=async()=>{evaluations++;return historyTabReady(f.document,()=>f.style)}
 await waitForInstallerHistoryTab({evaluate,until:async check=>{checks++;assert.equal(await check(),false);f.show();assert.equal(await check(),false);f.setReady();assert.equal(await check(),true)}})
 assert.equal(checks,1);assert.equal(evaluations,4)
})
for(const[name,mutate]of [
 ['missing',f=>f.document.querySelector=()=>null],['loading fallback',f=>f.document.querySelector=s=>s==='#inspector-tab-history'?f.node:{}],['detached',f=>f.node.isConnected=false],['disabled',f=>f.node.disabled=true],['aria disabled',f=>f.node.getAttribute=()=> 'true'],['zero width',f=>f.node.getBoundingClientRect=()=>({width:0,height:20})],['zero height',f=>f.node.getBoundingClientRect=()=>({width:100,height:0})],['hidden',f=>f.style.visibility='hidden'],['not displayed',f=>f.style.display='none']
])test('readiness refuses '+name,()=>{const f=fixture();f.setReady();mutate(f);assert.equal(historyTabReady(f.document,()=>f.style),false)})
test('ready visible tab is accepted',()=>{const f=fixture();f.setReady();assert.equal(historyTabReady(f.document,()=>f.style),true)})
test('failed bounded wait propagates without input or retries',async()=>{let calls=0;await assert.rejects(waitForInstallerHistoryTab({evaluate:async()=>false,until:async()=>{calls++;throw Error('original timeout')}}),/original timeout/);assert.equal(calls,1)})
test('tab lost between wait and input is rejected',async()=>{await assert.rejects(waitForInstallerHistoryTab({evaluate:async()=>false,until:async()=>true}),/became unavailable/)})
const original=()=>({core:'original core',script:"async function click(selector) {\n  const p={x:0,y:0}\n  for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1})\n}"})
test('generated change preserves every old click byte and core while adding exact readiness',()=>{const x=original(),y=prepareInstallerHistoryReadiness(x);assert.equal(y.core,x.core);assert.ok(y.script.includes("Input.dispatchMouseEvent"));assert.ok(y.script.includes("selector === '#inspector-tab-history'"));assert.equal((y.script.match(/Input.dispatchMouseEvent/g)||[]).length,1);assert.doesNotMatch(y.script,/\.click\(/)})
for(const[name,mutate]of [['already applied',x=>x.script+='\nwaitForInstallerHistoryTab'],['duplicate click',x=>x.script+=x.script],['unknown input code',x=>x.script=x.script.replace('Input.dispatchMouseEvent','other')]])test('refuses unsafe preparation '+name,()=>{const x=original();mutate(x);assert.throws(()=>prepareInstallerHistoryReadiness(x))})
