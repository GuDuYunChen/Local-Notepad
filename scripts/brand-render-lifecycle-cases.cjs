const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { isolateBrandRenderProfile, createBrandRenderLifecycle, PHASES, TIMEOUT_MS } = require('./brand-render-lifecycle.cjs')

const result = () => ({ checks: 23, nativePng: true, nativeIco: true, lightRoundTrip: true,
  primaryContrast: 7, mutedContrast: 5 })
const images = () => ['light.png', 'dark.png'].map(name => ({ name, bytes: 300,
  width: 1280, height: 960, sha256: 'a'.repeat(64) }))
function harness(extra = {}) {
  const writes = [], exits = [], timers = [], cancelled = []
  const lifecycle = createBrandRenderLifecycle({
    write: value => writes.push(JSON.parse(JSON.stringify(value))), exit: code => exits.push(code),
    now: () => 100, schedule: (fn, ms) => { timers.push({fn,ms});return 123 }, cancel: id => cancelled.push(id),
    ...extra,
  })
  return { lifecycle, writes, exits, timers, cancelled }
}
const advance = h => { for (const phase of PHASES.slice(1)) assert.equal(h.lifecycle.mark(phase), true) }
function registerBrandLifecycleTests(test) {
  test('brand fixture isolates user and session profiles before Electron readiness', () => {
    const seen = [], profiles = []
    const app = { isReady: () => false, setPath: (name, value) => seen.push([name,value]) }
    try {
      profiles.push(isolateBrandRenderProfile(app)); profiles.push(isolateBrandRenderProfile(app))
      assert.notEqual(profiles[0], profiles[1])
      for (let i=0; i<2; i++) {
        assert.equal(path.isAbsolute(profiles[i]), true)
        assert.equal(fs.statSync(profiles[i]).isDirectory(), true)
        assert.deepEqual(seen.slice(i*2,i*2+2), [['userData',profiles[i]],['sessionData',profiles[i]]])
      }
      assert.throws(() => isolateBrandRenderProfile({ isReady: () => true }), /before ready/)
    } finally { for (const profile of profiles) fs.rmSync(profile, { recursive: true, force: true }) }
  })
  test('brand actual runner configures both isolated paths before calling whenReady', () => {
    const calls = [], runner = path.join(__dirname,'check-brand-theme-render.cjs')
    const app = { isReady:()=>false, setPath:(...args)=>calls.push(['path',...args]),
      whenReady(){calls.push(['ready']);return {then(){return{catch(){}}}}} }
    let allocated
    const nativeRequire = name => {
      if(name==='electron')return{app}
      if(name==='node:fs')return { mkdirSync(){}, existsSync:()=>false,
        readFileSync:()=>Buffer.from('synthetic-source'), writeFileSync(){} }
      if(name==='./brand-render-lifecycle.cjs')return {
        isolateBrandRenderProfile: target => { allocated=isolateBrandRenderProfile(target) },
        createBrandRenderLifecycle: () => ({})
      }
      return require(name)
    }
    try {
      new vm.Script(fs.readFileSync(runner,'utf8'),{filename:runner}).runInNewContext({
        require:nativeRequire,__dirname,process,console,Buffer
      })
      assert.deepEqual(calls.map(x=>x.slice(0,2)),[['path','userData'],['path','sessionData'],['ready']])
    } finally { if(allocated) fs.rmSync(allocated,{recursive:true,force:true}) }
  })
  test('brand timeout preserves the exact last phase and cannot be reported successful', () => {
    const h=harness(); h.lifecycle.mark('ready');h.lifecycle.mark('assets-ready');h.lifecycle.mark('window-created')
    assert.equal(TIMEOUT_MS,45000);assert.equal(h.timers[0].ms,45000)
    h.timers[0].fn()
    assert.deepEqual(h.exits,[1]);assert.equal(h.writes.at(-1).complete,false)
    assert.equal(h.writes.at(-1).phase,'window-created');assert.equal(h.writes.at(-1).reason,'timeout')
    assert.equal(h.lifecycle.complete(result(),images()),false);assert.deepEqual(h.exits,[1])
  })
  test('brand readiness timeout leaves a receipt even before a BrowserWindow exists', () => {
    const h=harness();assert.equal(h.writes[0].phase,'starting')
    h.timers[0].fn();assert.equal(h.writes.at(-1).reason,'timeout');assert.deepEqual(h.exits,[1])
  })
  test('brand completion requires all original checks and two actual screenshot receipts', () => {
    const h=harness();advance(h);assert.equal(h.lifecycle.complete(result(),images()),true)
    assert.equal(h.writes.at(-1).complete,true);assert.equal(h.writes.at(-1).result.checks,23)
    assert.equal(h.writes.at(-1).observations.length,PHASES.length);assert.deepEqual(h.exits,[0])
    assert.deepEqual(h.cancelled,[123])
  })
  test('brand partial, skipped and reordered phases cannot satisfy completion', () => {
    const incomplete=harness();incomplete.lifecycle.complete(result(),images());assert.deepEqual(incomplete.exits,[1])
    const reordered=harness();assert.equal(reordered.lifecycle.mark('fonts-ready'),false)
    assert.equal(reordered.writes.at(-1).reason,'invalid-progress');assert.deepEqual(reordered.exits,[1])
  })
  test('brand reduced checks, low contrast and missing or malformed PNG evidence fail closed', () => {
    for(const bad of [{...result(),checks:22},{...result(),mutedContrast:4.49},{...result(),primaryContrast:NaN},
      {...result(),nativePng:false},{...result(),lightRoundTrip:false}]) {
      const h=harness();advance(h);h.lifecycle.complete(bad,images());assert.deepEqual(h.exits,[1])
    }
    for(const bad of [[],images().slice(0,1),[images()[0],images()[0]],
      images().map(x=>({...x,sha256:'not-a-hash'})),images().map(x=>({...x,width:0})),
      images().map(x=>({...x,bytes:0}))]) {
      const h=harness();advance(h);h.lifecycle.complete(result(),bad);assert.deepEqual(h.exits,[1])
    }
  })
  test('brand first load failure is sticky and does not expose native paths or exception text', () => {
    const h=harness();h.lifecycle.fail('main-frame-load-failed',{errorCode:-2,url:'PRIVATE_URL',stack:'PRIVATE_STACK'})
    h.lifecycle.fail('timeout');h.lifecycle.mark('ready');h.lifecycle.complete(result(),images())
    assert.deepEqual(h.exits,[1]);assert.equal(h.writes.at(-1).reason,'main-frame-load-failed')
    assert.deepEqual(h.writes.at(-1).detail,{errorCode:-2})
    assert.doesNotMatch(JSON.stringify(h.writes),/PRIVATE/)
  })
  test('brand renderer exit is recorded once and cannot be overridden by late callbacks', () => {
    const h=harness();h.lifecycle.fail('renderer-gone');const count=h.writes.length
    h.timers[0].fn();assert.equal(h.writes.length,count);assert.deepEqual(h.exits,[1])
  })
  test('brand failed report writes can never exit zero', () => {
    const exits=[]
    const h=harness({ write(){throw new Error('PRIVATE_PATH')},exit:code=>exits.push(code) })
    assert.deepEqual(exits,[1]);assert.equal(h.lifecycle.isSettled(),true)
    h.lifecycle.complete(result(),images());assert.deepEqual(exits,[1])
    let failFinal=false;const other=harness({write(value){if(failFinal&&value.complete)throw new Error('PRIVATE_PATH')}})
    advance(other);failFinal=true;other.lifecycle.complete(result(),images());assert.deepEqual(other.exits,[1])
  })
  test('brand synchronous deadline cannot be overwritten with an in-progress report', () => {
    const h=harness({schedule:fn=>{fn();return 3}})
    assert.deepEqual(h.exits,[1]);assert.equal(h.writes.length,1);assert.equal(h.writes[0].reason,'timeout')
  })
  test('brand reports contain only fixed fields and detached primitive evidence', () => {
    const h=harness();advance(h)
    const r={...result(),secret:'PRIVATE'},p=images();p[0].private='PRIVATE'
    h.lifecycle.complete(r,p);r.checks=0;p[0].bytes=0
    assert.equal(h.writes.at(-1).result.checks,23);assert.equal(h.writes.at(-1).images[0].bytes,300)
    assert.doesNotMatch(JSON.stringify(h.writes),/PRIVATE/)
  })
}
module.exports={registerBrandLifecycleTests}
