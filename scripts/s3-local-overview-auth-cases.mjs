import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createS3LocalOverviewService as create } from '../electron/s3-local-overview-bridge.js'
import { createS3LocalOverviewRuntime } from '../electron/s3-local-overview-runtime.js'
const token = 'a'.repeat(64)
function transport() {
  const calls = []
  return { calls, requestImpl(url, options, callback) {
    const req = new EventEmitter(); req.destroy = () => queueMicrotask(() => req.emit('close'))
    req.end = body => { calls.push({ url: String(url), options, body }); queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = 422; res.complete = true; res.rawTrailers=[]; res.trailers={}; res.destroy=()=>{}
      res.rawHeaders=['Content-Type','application/json','Cache-Control','no-store','X-Content-Type-Options','nosniff']
      callback(res);res.emit('data',Buffer.from('{"code":422,"message":"local-overview-not-available","data":null}'));res.emit('end');req.emit('close')
    }) };return req
  } }
}
export function registerLocalOverviewAuthTests(test) {
  test('local overview authorization uses a trusted main-only header and fixed body', async () => {
    const t=transport(),s=create({...t,getToken:()=>token});const out=await s.read({readOnly:true})
    assert.equal(t.calls.length,1);assert.equal(t.calls[0].options.headers['X-Notepad-Local-Overview'],token)
    assert.equal(t.calls[0].body,'{"readOnly":true}');assert.equal(out.code,'local-overview-not-available');assert.ok(!JSON.stringify(out).includes(token))
  })
  for (const bad of [null,undefined,'',true,'a','A'.repeat(64),'g'.repeat(64),token+' ']) test(`local overview authorization fails offline for ${String(bad).slice(0,8)}`,async()=>{
    const t=transport(),s=create({...t,getToken:()=>bad});assert.equal((await s.read({readOnly:true})).code,'native-local-overview-unavailable');assert.equal(t.calls.length,0)
  })
  test('local overview invalid intent does not acquire private authorization',async()=>{
    let reads=0;const t=transport(),s=create({...t,getToken:()=>{reads++;return token}})
    await s.read({readOnly:true,token});assert.equal(reads,0);assert.equal(t.calls.length,0)
  })
  test('local overview authorization getter failure is fixed and can recover',async()=>{
    let broken=true;const t=transport(),s=create({...t,getToken:()=>{if(broken)throw Error('PRIVATE_TOKEN');return token}})
    const out=await s.read({readOnly:true});assert.equal(out.data,null);assert.ok(!JSON.stringify(out).includes('PRIVATE'))
    assert.equal(t.calls.length,0);broken=false;await s.read({readOnly:true});assert.equal(t.calls.length,1)
  })
  test('local overview runtime creates distinct ephemeral capabilities without mutating parent env',()=>{
    const build=()=>createS3LocalOverviewRuntime({ipcMain:{handle(){}},getWindow:()=>null,getExpectedURL:()=>'',isClosing:()=>false,isAvailable:()=>false})
    const a=build(),b=build(),env={PORT:'27121'};const next=a.childEnvironment(env)
    assert.deepEqual(env,{PORT:'27121'});assert.match(next.NOTEPAD_LOCAL_OVERVIEW_TOKEN,/^[a-f0-9]{64}$/)
    assert.notEqual(next.NOTEPAD_LOCAL_OVERVIEW_TOKEN,b.childEnvironment(env).NOTEPAD_LOCAL_OVERVIEW_TOKEN)
    assert.equal(JSON.stringify(a),'{}');a.abort();b.abort()
  })
  test('local overview runtime refuses an untrusted frame before any filesystem or network access',async()=>{
    let handle;const runtime=createS3LocalOverviewRuntime({ipcMain:{handle(_key,fn){handle=fn}},getWindow:()=>null,getExpectedURL:()=>'',isClosing:()=>false,isAvailable:()=>false})
    const out=await handle({}, {readOnly:true});assert.equal(out.code,'untrusted-frame');assert.equal(out.data,null);runtime.abort()
  })
}
