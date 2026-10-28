import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
// Deterministic owner/state models. These are not native Windows evidence.
const source=readFileSync(new URL('./task-center-desktop-driver.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n')
const start=source.indexOf('export async function prepareTaskEditorViewport(')
const end=source.indexOf('export async function verifyTaskCenterDesktop(',start)
assert.ok(start>=0&&end>start)
const helper=source.slice(start,end)
const prepare=new Function('assert',helper.replace('export ','')+';return prepareTaskEditorViewport')(assert)
function model(options={}){
 const state={collapsed:false,owners:1,settings:0,centers:0,width:704,height:455,...options},calls=[]
 const observe=()=>({owners:state.owners,collapsed:state.collapsed,collapseButtons:state.collapseButtons??(state.collapsed?0:1),expandButtons:state.expandButtons??(state.collapsed?1:0),settings:state.settings,centers:state.centers,width:state.width,height:state.height})
 const evaluate=async expression=>{
  calls.push('observe');const snapshot=observe()
  const owner={classList:{contains:name=>{assert.equal(name,'collapsed');return snapshot.collapsed}},querySelectorAll:selector=>{
   if(selector==='button[aria-label="折叠侧边栏"]')return Array(snapshot.collapseButtons).fill({})
   if(selector==='button[aria-label="展开侧边栏"]')return Array(snapshot.expandButtons).fill({})
   throw new Error('Unexpected owner selector '+selector)
  }}
  const document={querySelectorAll:selector=>{
   if(selector==='.workspace-sidebar')return Array(snapshot.owners).fill(owner)
   if(selector==='.settings-panel')return Array(snapshot.settings).fill({})
   if(selector==='.task-center')return Array(snapshot.centers).fill({})
   throw new Error('Unexpected global selector '+selector)
  }}
  return vm.runInNewContext(expression,{document,innerWidth:snapshot.width,innerHeight:snapshot.height})
 }
 const click=async selector=>{calls.push('click');assert.equal(selector,'.workspace-sidebar button[aria-label="折叠侧边栏"]');if(state.clickError)throw state.clickError;if(!state.noTransition)state.collapsed=true;if(state.resize)state.width=720;if(state.ownerLost)state.owners=0}
 const until=async(fn,message)=>{calls.push('wait');const value=await fn();if(!value)throw new Error(message);return value}
 return {state,calls,ctx:{evaluate,click,until}}
}
test('expanded overlay blocks old geometry; original collapse action restores modeled reachability',async()=>{const f=model();assert.equal(f.state.collapsed,false);const report=await prepare(f.ctx);assert.equal(report.clicked,true);assert.equal(report.before.collapsed,false);assert.equal(report.after.collapsed,true);assert.deepEqual(f.calls,['observe','click','wait','observe'])})
test('already collapsed does not toggle open or retry',async()=>{const f=model({collapsed:true});const report=await prepare(f.ctx);assert.equal(report.clicked,false);assert.deepEqual(f.calls,['observe'])})
for(const[key,value]of Object.entries({owners:0,settings:1,centers:1,width:1008,height:655,collapseButtons:2,expandButtons:1}))test('refuses invalid precondition '+key,async()=>{const f=model({[key]:value});await assert.rejects(prepare(f.ctx));assert.equal(f.calls.includes('click'),false)})
test('refuses duplicate sidebar owners',async()=>{const f=model({owners:2});await assert.rejects(prepare(f.ctx));assert.equal(f.calls.includes('click'),false)})
test('native input error propagates without replay',async()=>{const error=new Error('input refused'),f=model({clickError:error});await assert.rejects(prepare(f.ctx),e=>e===error);assert.equal(f.calls.filter(x=>x==='click').length,1);assert.equal(f.calls.includes('wait'),false)})
test('unchanged overlay fails instead of assuming a successful click',async()=>{const f=model({noTransition:true});await assert.rejects(prepare(f.ctx),/did not collapse/);assert.equal(f.calls.filter(x=>x==='click').length,1)})
test('viewport cannot be enlarged to pass geometry',async()=>{const f=model({resize:true});await assert.rejects(prepare(f.ctx),/Viewport changed/);assert.equal(f.calls.filter(x=>x==='click').length,1)})
test('owner disappearance is not successful collapse',async()=>{const f=model({ownerLost:true});await assert.rejects(prepare(f.ctx),/sidebar owner/);assert.equal(f.calls.filter(x=>x==='click').length,1)})
test('readiness precedes both unchanged narrow geometry assertions',()=>{assert.match(source,/await resizeSmall\(\);\n report\.sidebarReadiness=await prepareTaskEditorViewport\(\{evaluate,click,until\}\);save\(\);\n await observeLayout\('smallChecked'/);assert.match(source,/await observeLayout\('smallUnchecked',prefix\+' item 01','false'\)/);assert.match(source,/x\.textLeft>=x\.markerRight\+4/);assert.match(source,/hit===n/);assert.match(source,/task109-editor-small\.png/);assert.doesNotMatch(helper,/\.click\(|localStorage|setAttribute|\.style|setTimeout|setInterval|dispatchEvent|resizeSmall\(/)})
test('original completion and privacy/retention checks remain present',()=>{for(const text of ["await key('s',83,2)","report.notes.otherBodyWrites,0","report.uiRequests.centerMutations,0","report.uiRequests.unexpectedMutations,0","mark('installation-retains-completion-and-source-data')","mark('actual-summary-download-omits-identities')"] )assert.ok(source.includes(text),text)})
