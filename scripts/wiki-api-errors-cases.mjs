import assert from 'node:assert/strict'
import { api } from '../src/services/api.js'
import { readWikiFile, readWikiPreview } from '../src/services/wikiNavigation.mjs'
const request={id:'target',title:'引用',headingPath:[]}
const file={id:'target',title:'目标',content:'正文',updated_at:1,is_folder:false,is_deleted:false}
// Test the real shared API decoder with an isolated transport fixture. This is
// not a production server, and no request leaves this process.
async function transport(body,action,status=200){
 const fetchBefore=Object.getOwnPropertyDescriptor(globalThis,'fetch'),windowBefore=Object.getOwnPropertyDescriptor(globalThis,'window'),calls=[]
 Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{}})
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url,options)=>{calls.push({url,options});if(body instanceof Error)throw body;return {ok:status>=200&&status<300,status,json:async()=>body}}})
 try{return await action(calls)}finally{
  for(const [name,descriptor]of [['fetch',fetchBefore],['window',windowBefore]]){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}
 }
}
export function registerWikiApiErrorTests(test){
 test('real API decoder retains numeric business identity without altering existing error behavior',()=>transport({code:1001,message:'文件不存在',data:null},async calls=>{
  await assert.rejects(api('/api/files/target'),error=>{assert.equal(error.constructor,Error);assert.equal(error.message,'文件不存在');assert.equal(error.apiCode,1001);assert.equal(error.code,undefined);assert.deepEqual(Object.keys(error),[]);return true})
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined)
 }))
 test('unrelated numeric business errors retain their code but are not target-deletion classifications',()=>transport({code:5007,message:'other failure',data:null},async()=>{
  await assert.rejects(api('/api/files/target'),error=>{assert.equal(error.apiCode,5007);assert.equal(error.message,'other failure');return true})
 }))
 test('noninteger or string business codes are never exposed as trusted numeric identities',async()=>{
  for(const code of ['1001',null,1001.5,Number.MAX_SAFE_INTEGER+1])await transport({code,message:'invalid',data:null},async()=>{await assert.rejects(api('/api/files/target'),error=>{assert.equal(error.apiCode,undefined);return true})})
 })
 test('HTTP failures do not masquerade as the file-not-found business response',async()=>{
  for(const status of [404,500])await transport({code:1001,message:'not decoded'},async()=>{await assert.rejects(api('/api/files/target'),error=>{assert.equal(error.apiCode,undefined);return true})},status)
 })
 test('successful responses retain their original data without error metadata',()=>transport({code:0,data:file},async()=>{
  assert.equal(await api('/api/files/target'),file);assert.equal(Object.hasOwn(file,'apiCode'),false)
 }))
 test('real not-found business response becomes an explicit unavailable Wiki target without exposing details',()=>transport({code:1001,message:'文件不存在',detail:'PRIVATE_DATABASE_PATH',data:null},async calls=>{
  await assert.rejects(readWikiFile(api,request),error=>{assert.equal(error.code,'target');assert.ok(error.message.includes('已删除'));assert.ok(!error.message.includes('PRIVATE'));return true})
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined)
 }))
 test('unavailable preview stops before backlinks and cannot expose returned private content',()=>transport({code:1001,message:'文件不存在',data:{content:'PRIVATE_RECYCLE_BODY'}},async calls=>{
  await assert.rejects(readWikiPreview(api,request),error=>{assert.equal(error.code,'target');assert.ok(!error.message.includes('PRIVATE'));return true});assert.equal(calls.length,1)
 }))
 test('other business failures remain service failures instead of claiming the note was deleted',()=>transport({code:1006,detail:'PRIVATE_SAVE_FAILURE',data:null},async()=>{
  await assert.rejects(readWikiFile(api,request),error=>{assert.equal(error.code,'request');assert.ok(!error.message.includes('PRIVATE'));assert.ok(!error.message.includes('已删除'));return true})
 }))
 test('message text resembling not-found never substitutes for the numeric business identity',()=>transport({code:5007,message:'文件不存在 PRIVATE',data:null},async()=>{
  await assert.rejects(readWikiFile(api,request),{code:'request'})
 }))
 test('network failure keeps existing bounded request error handling',()=>transport(Error('PRIVATE_NETWORK'),async()=>{
  await assert.rejects(readWikiFile(api,request),error=>{assert.equal(error.code,'request');assert.ok(!error.message.includes('PRIVATE'));return true})
 }))
 test('valid HTTP payload with a deleted file remains rejected by the original identity checks',()=>transport({code:0,data:{...file,is_deleted:true}},async()=>{
  await assert.rejects(readWikiFile(api,request),{code:'target'})
 }))
 test('string apiCode from an unrelated adapter cannot be treated as confirmed target absence',async()=>{
  await assert.rejects(readWikiFile(()=>Promise.reject(Object.assign(Error('missing'),{apiCode:'1001'})),request),{code:'request'})
 })
}
