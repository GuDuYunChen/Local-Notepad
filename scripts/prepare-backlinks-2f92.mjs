import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
const BASE='8925c2097e74ce6720dc29b3c2ddd1b5038c3fc5'
const TARGETS=["AGENTS.md", "scripts/check-desktop-save.mjs", "server/internal/controller/file.go", "src/components/BacklinksPanel.css", "src/components/BacklinksPanel.jsx", "src/components/InspectorPanel.jsx", "src/hooks/useGuardedNoteOpener.js", "src/hooks/useGuardedNoteOpener.test.jsx", "docs/LOCAL_BACKLINKS_2F92.md", "scripts/backlink-sources-cases.mjs", "scripts/backlink-sources.node.mjs", "scripts/check-backlinks-desktop.mjs", "server/internal/controller/backlink_sources.go", "server/internal/dao/backlink_sources.go", "server/internal/dao/backlink_sources_test.go", "src/components/BacklinksPanel.legacy-safety.test.jsx", "src/components/BacklinksPanel.test.jsx", "src/services/backlinkSources.mjs", "src/services/backlinkSources.test.js", "package.json", "package-lock.json"]
const read=p=>fs.readFileSync(p,'utf8')
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
fs.mkdirSync('backlink-module-evidence',{recursive:true})
if(process.argv[2]==='prepare'){
 const expected={"src/hooks/useGuardedNoteOpener.js": "aad5475c377aa535ac1a9372bc995988450ef3f4", "src/hooks/useGuardedNoteOpener.test.jsx": "5731bfe9c74e870ff6c036f8d25b2b908b596089", "src/components/InspectorPanel.jsx": "2c7971eefd554d459e2a90f76f9f55d4b0e7c7db", "server/internal/controller/file.go": "7104d5e15a76db775873a569c92aa7829b1cdffa", "scripts/check-desktop-save.mjs": "b8183c796531499f35dca6cd595469ec340be141", "AGENTS.md": "89c8577ad900af148175961befd8abe4a8a78c2e"}
 const original={};for(const [p,sha]of Object.entries(expected)){original[p]=read(p);assert.equal(blob(original[p]),sha,p)}
 const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Exact integration anchor mismatch');return s.replace(a,b)}
 let s=original['src/hooks/useGuardedNoteOpener.js']
 s=once(s,"Promise.resolve().then(() => api(`/api/files/${encodeURIComponent(id)}`, { signal: controller.signal }))","Promise.resolve().then(() => {\n        if (!valid()) return null\n        return typeof options.readFile === 'function'\n          ? options.readFile(id, { signal: controller.signal })\n          : api(`/api/files/${encodeURIComponent(id)}`, { signal: controller.signal })\n      })")
 fs.writeFileSync('src/hooks/useGuardedNoteOpener.js',s)
 fs.writeFileSync('src/hooks/useGuardedNoteOpener.test.jsx',original['src/hooks/useGuardedNoteOpener.test.jsx']+"\nit('uses an explicit source-verified read adapter but preserves the original selection guard',async()=>{\n const reader=vi.fn(async()=>({id:'source'}));let guard\n await render({onSelectFile:(_file,o)=>{guard=o}})\n const result=open('source',{readFile:reader});await drain()\n expect(reader).toHaveBeenCalledWith('source',{signal:expect.any(AbortSignal)});expect(api).not.toHaveBeenCalled()\n guard.onCancel();expect(await result).toBe(false)\n})\nit('invalid adapter identity cannot cross the original note selection boundary',async()=>{\n const selected=vi.fn();await render({onSelectFile:selected})\n expect(await open('source',{readFile:async()=>({id:'wrong'})})).toBe(false);expect(selected).not.toHaveBeenCalled()\n})\nit('external cancellation prevents a late verified reader from opening a source',async()=>{\n let release;const c=new AbortController(),selected=vi.fn()\n await render({onSelectFile:selected})\n const result=open('source',{signal:c.signal,readFile:()=>new Promise(r=>release=r)});await drain();c.abort()\n expect(await result).toBe(false);release({id:'source'});await drain();expect(selected).not.toHaveBeenCalled()\n})\n")
 s=once(original['src/components/InspectorPanel.jsx'],'<BacklinksPanel fileId={file.id} onSelectFile={onSelectFile} />','<BacklinksPanel key={file.id} fileId={file.id} onSelectFile={onSelectFile} />');fs.writeFileSync('src/components/InspectorPanel.jsx',s)
 const route='\tgroup.GET("/files/{id}/backlinks", c.Backlinks)'
 s=once(original['server/internal/controller/file.go'],route,route+'\n\tgroup.GET("/files/{id}/backlink-sources", c.BacklinkSources)');fs.writeFileSync('server/internal/controller/file.go',s)
 const native='  await verifyNoteTagsDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })'
 s="import { verifyBacklinksDesktop } from './check-backlinks-desktop.mjs'\n"+once(original['scripts/check-desktop-save.mjs'],native,native+'\n  await verifyBacklinksDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })');fs.writeFileSync('scripts/check-desktop-save.mjs',s)
 const paragraphs=original['AGENTS.md'].split('\n\n');assert.ok(paragraphs[1].startsWith('Current local module: 2F.91'))
 paragraphs[1]="Current local module: 2F.92 / 4.225.0 complete local backlinks and guarded source navigation. Read docs/LOCAL_BACKLINKS_2F92.md. Base8925c209 /4.224.0 is accepted in PR2 comment6182622470. Complete consistent indexed-source reads, unavailable/stale/verified distinctions, literal/IME search, source preview, fresh destination checks, original App save/discard/cancel and heading navigation, stop/retry/close, and current-source Windows/package/installation acceptance. Do not rewrite note bodies or index links, expose deleted source bodies, guess ambiguous sections, treat errors as empty success or weaken original save/quit guards. No cloud/multidevice or rejected dependency export.";fs.writeFileSync('AGENTS.md',paragraphs.join('\n\n'))
 execFileSync('gofmt',['-w','server/internal/dao/backlink_sources.go','server/internal/dao/backlink_sources_test.go','server/internal/controller/backlink_sources.go','server/internal/controller/file.go'],{stdio:'inherit'})

 const oldLock=JSON.parse(read('package-lock.json'));assert.equal(oldLock.version,'4.224.0');assert.equal(JSON.parse(read('package.json')).version,'4.224.0')
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'})
 const next=JSON.parse(read('package-lock.json'));assert.equal(next.version,'4.225.0');assert.equal(next.packages[''].version,'4.225.0');next.version=oldLock.version;next.packages[''].version=oldLock.packages[''].version;assert.deepEqual(next,oldLock)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.224.0'],{stdio:'inherit'});execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'})
 execFileSync('git',['diff','--check'],{stdio:'inherit'})
}else if(process.argv[2]==='baseline'){
 const p='src/components/BacklinksPanel.jsx',fixed=read(p),old=execFileSync('git',['show',BASE+':'+p],{encoding:'utf8'})
 try{
  fs.writeFileSync(p,old)
  const run=spawnSync('npx',['vitest','run','--root=.','src/components/BacklinksPanel.legacy-safety.test.jsx','--reporter=json','--outputFile=backlink-module-evidence/before.json'],{encoding:'utf8',timeout:60000})
  fs.writeFileSync('backlink-module-evidence/before.log',String(run.stdout||'')+String(run.stderr||''));assert.equal(run.status,1)
  const report=JSON.parse(read('backlink-module-evidence/before.json'));assert.equal(report.numTotalTests,3);assert.equal(report.numFailedTests,3)
  for(const test of report.testResults.flatMap(t=>t.assertionResults)){assert.equal(test.status,'failed');assert.ok(!test.failureMessages.join('\n').includes('timed out'))}
  fs.writeFileSync('backlink-module-evidence/old-component.txt',old)
 }finally{fs.writeFileSync(p,fixed)}
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const p of TARGETS){
  const content=read(p),res=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(res.status,201,p);const value=await res.json();assert.equal(value.sha,blob(content))
  const dest=path.join('backlink-module-evidence/source',p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);records.push({path:p,sha:value.sha,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')})
 }
 fs.writeFileSync('backlink-module-evidence/objects.json',JSON.stringify({base:BASE,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2))
}else throw Error('Expected prepare, baseline or publish')
