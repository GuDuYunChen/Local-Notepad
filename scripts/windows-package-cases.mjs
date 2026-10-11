import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageWindows, installerVersion, packageIdentity, versionAtLeast, digest } from './windows-package-core.mjs'
import { commandSpec, runNative } from './package-windows.mjs'

export function fixturePE(version = [4, 217, 1, 0]) {
  const b = Buffer.alloc(1024), w16 = (at, n) => b.writeUInt16LE(n, at), w32 = (at, n) => b.writeUInt32LE(n >>> 0, at)
  w16(0, 0x5a4d); w32(0x3c, 128); w32(128, 0x4550); w16(134, 1); w16(148, 224)
  const opt = 152, section = opt + 224, resource = 512
  w16(opt, 0x10b); w32(opt + 92, 16); w32(opt + 112, 4096); w32(opt + 116, 512)
  w32(section + 12, 4096); w32(section + 16, 512); w32(section + 20, 512)
  for (const [offset, id, next] of [[0,16,0x80000018],[24,1,0x80000030],[48,1033,72]]) {
    w16(resource + offset + 14, 1); w32(resource + offset + 16, id); w32(resource + offset + 20, next)
  }
  w32(resource + 72, 4096 + 96); w32(resource + 76, 92)
  const value = resource + 96
  w16(value,92); w16(value+2,52); Buffer.from('VS_VERSION_INFO\0','utf16le').copy(b,value+6)
  w32(value+40,0xfeef04bd); w32(value+44,0x10000)
  for (const offset of [48,56]) { w32(value+offset,version[0]*65536+version[1]);w32(value+offset+4,version[2]*65536+version[3]) }
  return b
}
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "notepad package 用户 O'Brien "))
  const manifest = { name:'notepad-desktop', version:'4.217.1', build:{directories:{output:'release'},nsis:{artifactName:'Notepad-${version}-Setup.exe'}} }
  const lock = { name:manifest.name,version:manifest.version,lockfileVersion:3,packages:{'':{name:manifest.name,version:manifest.version}} }
  writeFileSync(path.join(root,'package.json'),JSON.stringify(manifest));writeFileSync(path.join(root,'package-lock.json'),JSON.stringify(lock))
  mkdirSync(path.join(root,'server'));writeFileSync(path.join(root,'server','go.mod'),'module notepad-server\n\ngo 1.22\n\ntoolchain go1.24.11\n')
  mkdirSync(path.join(root,'release'))
  const target = path.join(root,'release','Notepad-4.217.1-Setup.exe'), calls = []
  const run = async (command,args) => {
    calls.push(args.join(' '))
    if (args.join(' ') === 'run build') writeFileSync(target,fixturePE())
    return { code:0,stdout:command==='go'?'go1.24.11\n':'' }
  }
  const options = { root,run,platform:'win32',nodeVersion:'24.0.0' }
  return { root,target,calls,run,options,close:()=>rmSync(root,{recursive:true,force:true}) }
}
const using = async fn => { const f=fixture();try { await fn(f) } finally { f.close() } }
const receipts = root => {
  // No recursive guesses about installers: only test receipt directories.
  const dir=path.join(root,'test-results','local-package')
  return import('node:fs').then(fs=>fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>JSON.parse(readFileSync(path.join(dir,x.name,'receipt.json')))))
}
export function registerWindowsPackageTests(test) {
  test('package pipeline verifies the freshly built exact-version installer and writes a receipt',()=>using(async f=>{
    const out=await packageWindows(f.options)
    assert.equal(out.complete,true);assert.equal(out.installer.sha256,digest(fixturePE()))
    assert.equal(out.installer.fileVersion,'4.217.1.0');assert.equal(out.installationTested,false)
    assert.deepEqual(f.calls,['scripts/check-app-version.mjs','--version','-C server env GOVERSION','ci --no-audit --no-fund','run build'])
    assert.equal(readFileSync(f.target+'.sha256','utf8'),`${out.installer.sha256}  Notepad-4.217.1-Setup.exe\n`)
    assert.equal((await receipts(f.root))[0].complete,true)
    assert.equal(existsSync(path.join(f.root,'test-results','local-package','running.lock')),false)
  }))
  for(const command of ['scripts/check-app-version.mjs','--version','-C server env GOVERSION','ci --no-audit --no-fund','run build']) {
    test(`package pipeline stops after failed ${command} without accepting a stale executable`,()=>using(async f=>{
      writeFileSync(f.target,fixturePE())
      const seen=[]
      await assert.rejects(packageWindows({...f.options,run:async(c,args,o)=>{
        const key=args.join(' ');seen.push(key);return key===command?{code:7}:f.run(c,args,o)
      }}),/failed/)
      assert.equal(seen.at(-1),command);assert.equal(seen.filter(x=>x===command).length,1)
      assert.equal((await receipts(f.root))[0].complete,false)
      if(command==='run build')assert.equal(existsSync(f.target),false)
    }))
  }
  test('package pipeline rejects successful build exit without a new installer',()=>using(async f=>{
    writeFileSync(f.target,fixturePE())
    await assert.rejects(packageWindows({...f.options,run:async(c,a,o)=>a.join(' ')==='run build'?{code:0}:f.run(c,a,o)}),/ENOENT/)
    assert.equal((await receipts(f.root))[0].complete,false)
  }))
  test('package pipeline never selects an older version or unpacked application',()=>using(async f=>{
    writeFileSync(path.join(f.root,'release','Notepad-4.217.0-Setup.exe'),fixturePE([4,217,0,0]))
    mkdirSync(path.join(f.root,'release','win-unpacked'));writeFileSync(path.join(f.root,'release','win-unpacked','notes.exe'),fixturePE())
    await assert.rejects(packageWindows({...f.options,run:async(c,a,o)=>a.join(' ')==='run build'?{code:0}:f.run(c,a,o)}),/ENOENT/)
  }))
  test('package pipeline preserves previous same-version package without using it as evidence',()=>using(async f=>{
    const old=Buffer.from('previous installer preserved');writeFileSync(f.target,old)
    const out=await packageWindows(f.options)
    assert.deepEqual(readFileSync(path.join(f.root,out.previousInstaller)),old)
    assert.deepEqual(readFileSync(f.target),fixturePE())
  }))
  test('package pipeline reinstalls locked dependencies even with node_modules present',()=>using(async f=>{
    mkdirSync(path.join(f.root,'node_modules'));await packageWindows(f.options)
    assert.equal(f.calls.filter(c=>c==='ci --no-audit --no-fund').length,1);assert.ok(!f.calls.includes('install'))
  }))
  for(const stage of ['ci --no-audit --no-fund','run build']) {
    test(`package pipeline refuses lock mutation during ${stage}`,()=>using(async f=>{
      await assert.rejects(packageWindows({...f.options,run:async(c,a,o)=>{
        const out=await f.run(c,a,o);if(a.join(' ')===stage)writeFileSync(path.join(f.root,'package-lock.json'),readFileSync(path.join(f.root,'package-lock.json'),'utf8')+' ');return out
      }}),/changed package/)
      assert.equal((await receipts(f.root))[0].complete,false)
    }))
  }
  test('package pipeline version disagreement is refused before running commands',()=>using(async f=>{
    const lock=JSON.parse(readFileSync(path.join(f.root,'package-lock.json')));lock.version='4.217.0';writeFileSync(path.join(f.root,'package-lock.json'),JSON.stringify(lock))
    await assert.rejects(packageWindows(f.options),/do not match/);assert.equal(f.calls.length,0)
  }))
  test('package pipeline rejects an outdated effective Go compiler',()=>using(async f=>{
    await assert.rejects(packageWindows({...f.options,run:async(c,a,o)=>c==='go'?{code:0,stdout:'go1.22.0'}:f.run(c,a,o)}),/Go 1.24.11/)
    assert.ok(!f.calls.includes('run build'));assert.ok(!f.calls.includes('ci --no-audit --no-fund'))
  }))
  test('package pipeline rejects wrong internal version despite correct filename',()=>using(async f=>{
    await assert.rejects(packageWindows({...f.options,run:async(c,a,o)=>{const out=await f.run(c,a,o);if(a.join(' ')==='run build')writeFileSync(f.target,fixturePE([4,217,0,0]));return out}}),/internal version/)
  }))
  test('package pipeline rejects corrupt installer bytes',()=>using(async f=>{
    await assert.rejects(packageWindows({...f.options,run:async(c,a,o)=>{const out=await f.run(c,a,o);if(a.join(' ')==='run build')writeFileSync(f.target,Buffer.alloc(1024));return out}}),/PE executable/)
  }))
  test('package pipeline concurrent lock is not stolen or silently removed',()=>using(async f=>{
    const dir=path.join(f.root,'test-results','local-package');mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'running.lock'),'keep')
    await assert.rejects(packageWindows(f.options),/owns/);assert.equal(readFileSync(path.join(dir,'running.lock'),'utf8'),'keep');assert.equal(f.calls.length,0)
  }))
  test('package pipeline pre-cancellation performs no command or build',()=>using(async f=>{
    const c=new AbortController();c.abort(new Error('cancelled'))
    await assert.rejects(packageWindows({...f.options,signal:c.signal}),/cancelled/);assert.equal(f.calls.length,0)
    assert.equal((await receipts(f.root))[0].complete,false)
  }))
  test('package pipeline cancellation after install never starts a build',()=>using(async f=>{
    const c=new AbortController()
    await assert.rejects(packageWindows({...f.options,signal:c.signal,run:async(cmd,a,o)=>{const out=await f.run(cmd,a,o);if(a[0]==='ci')c.abort(new Error('cancelled'));return out}}),/cancelled/)
    assert.ok(!f.calls.includes('run build'));assert.equal((await receipts(f.root))[0].complete,false)
  }))
  test('package pipeline refuses unsupported platform and Node before commands',()=>using(async f=>{
    await assert.rejects(packageWindows({...f.options,platform:'linux'}),/requires Windows/)
    await assert.rejects(packageWindows({...f.options,nodeVersion:'18.20.0'}),/22.12/);assert.equal(f.calls.length,0)
  }))
  test('package pipeline is independent of working-directory spaces and Unicode',()=>using(async f=>{
    const out=await packageWindows(f.options);assert.ok(out.target.includes("用户 O'Brien"));assert.equal(out.complete,true)
  }))
  test('package pipeline refuses redirected release directory',()=>using(async f=>{
    const external=path.join(f.root,'other');mkdirSync(external);rmSync(path.join(f.root,'release'),{recursive:true})
    symlinkSync(external,path.join(f.root,'release'),'junction')
    await assert.rejects(packageWindows(f.options),/real directory/);assert.ok(!f.calls.includes('run build'))
  }))
  test('package PE reader follows the version resource and rejects unstructured signatures',()=>{
    const good=fixturePE();assert.deepEqual(installerVersion(good),{fileVersion:'4.217.1.0',productVersion:'4.217.1.0'})
    const bad=Buffer.from(good);bad.writeUInt32LE(0,152+112);assert.throws(()=>installerVersion(bad))
  })
  test('package PE reader rejects truncation, invalid offsets, and resource loops',()=>{
    for(const length of [0,128,512,650])assert.throws(()=>installerVersion(fixturePE().subarray(0,length)))
    const bad=fixturePE();bad.writeUInt32LE(0x80000000,512+48+20);assert.throws(()=>installerVersion(bad))
  })
  test('package runtime comparison handles patch minimum and malformed versions',()=>{
    assert.equal(versionAtLeast('22.12.0','22.12.0'),true);assert.equal(versionAtLeast('24.0.0','22.12.0'),true)
    assert.equal(versionAtLeast('22.11.9','22.12.0'),false);assert.throws(()=>versionAtLeast('22.x','22.12.0'))
  })
  test('package npm command mapping accepts only fixed commands without shell-supplied paths',()=>{
    assert.deepEqual(commandSpec('npm',['ci','--no-audit','--no-fund'],'win32'),{command:'cmd.exe',args:['/d','/s','/c','npm.cmd ci --no-audit --no-fund']})
    assert.throws(()=>commandSpec('npm',['run','build & echo wrong'],'win32'))
    assert.deepEqual(commandSpec('npm',['--version'],'linux'),{command:'npm',args:['--version']})
  })
  test('package native runner preserves a real failed child exit code',async()=>{
    const out=await runNative(process.execPath,['-e','process.exit(9)'],{quiet:true,timeout:5000})
    assert.equal(out.code,9)
  })
  test('package native runner reports missing command rather than a success receipt',async()=>{
    const out=await runNative('notepad-command-that-does-not-exist',[],{quiet:true,timeout:5000})
    assert.ok(out.error);assert.notEqual(out.code,0)
  })
  test('package native runner enforces timeout without reporting successful completion',async()=>{
    await assert.rejects(runNative(process.execPath,['-e','setInterval(()=>{},1000)'],{quiet:true,timeout:200}),/timeout/)
  })
  test('package PowerShell selects one executable when multiple Node paths resolve',()=>{
    const ps=readFileSync(fileURLToPath(new URL('../pack-win.ps1',import.meta.url)),'utf8')
    assert.match(ps,/Get-Command node\.exe -CommandType Application -ErrorAction Stop \| Select-Object -First 1\)\.Source/)
  })
  test('package entry wrappers propagate native failure and do not search arbitrary executables',()=>{
    const root=fileURLToPath(new URL('../',import.meta.url)),ps=readFileSync(path.join(root,'pack-win.ps1'),'utf8'),bat=readFileSync(path.join(root,'pack-win.bat'),'utf8')
    assert.match(ps,/\$code = \$LASTEXITCODE/);assert.match(ps,/exit \$code/);assert.match(ps,/\$PSScriptRoot/)
    assert.doesNotMatch(ps,/Get-ChildItem|npm install|ELECTRON_MIRROR=/)
    assert.match(bat,/%~dp0pack-win\.ps1/);assert.match(bat,/exit \/b %pack_exit%/)
  })
}
