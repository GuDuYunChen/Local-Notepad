import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync,spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const BASE='6100a3522e875bf4247bcc48a6742f4f2c97a3a9'
const out='quick-module-evidence'
const targets=['AGENTS.md','package.json','package-lock.json','scripts/check-desktop-save.mjs','src/services/api.js','src/components/UIRedesign.test.jsx','src/App.jsx']
const files=[...targets,'src/components/QuickSwitcher.jsx','src/components/QuickSwitcher.css','src/services/quickSwitcher.mjs','src/services/quickSwitcher.test.js','scripts/quick-switcher-cases.mjs','scripts/quick-switcher.node.mjs','src/components/QuickSwitcher.lifecycle.test.jsx','src/App.quickSwitcher.test.jsx','scripts/check-quick-switcher-desktop.mjs','docs/LOCAL_QUICK_SWITCHER_2F90.md']
const read=f=>fs.readFileSync(f,'utf8'),blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex'),sha=s=>createHash('sha256').update(s).digest('hex')
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unexpected source anchor');return s.replace(a,b)}
fs.mkdirSync(out,{recursive:true})
if(process.argv[2]==='baseline'){
 const p='src/components/QuickSwitcher.jsx',patched=read(p)
 try{
  fs.writeFileSync(p,execFileSync('git',['show',BASE+':'+p]))
  const r=spawnSync('npx',['vitest','run','--root=.','src/App.quickSwitcher.test.jsx','--reporter=json','--outputFile='+out+'/before.json'],{encoding:'utf8',timeout:90000})
  fs.writeFileSync(out+'/before.log',String(r.stdout||'')+String(r.stderr||''))
  assert.equal(r.status,1);const data=JSON.parse(read(out+'/before.json'));assert.equal(data.numTotalTests,3);assert.equal(data.numFailedTests,3)
 }finally{fs.writeFileSync(p,patched)}
}else if(process.argv[2]==='apply'){
 for(const file of targets)assert.equal(blob(read(file)),execFileSync('git',['rev-parse',BASE+':'+file],{encoding:'utf8'}).trim(),file)
 let transport=read('src/services/api.js');transport=once(transport,'export async function searchFiles(query) {','export async function searchFiles(query, init) {');transport=once(transport,'const res = await api(`/api/files?q=${encodeURIComponent(query)}`)','const res = await api(`/api/files?q=${encodeURIComponent(query)}`, init)');fs.writeFileSync('src/services/api.js',transport)
 let component=read('src/components/QuickSwitcher.jsx')
 component=once(component,'onSelectFile, onOpenSearchWorkspace }) {','onSelectFile, onOpenSearchWorkspace, navigationEpoch }) {')
 component=once(component,'    const timer = window.setTimeout(async () => {','    const run = async () => {')
 component=once(component,"    }, captured.trim() ? 180 : 0)\n    return () => { controller.abort(); window.clearTimeout(timer) }", "    }\n    const timer = captured.trim() ? window.setTimeout(run, 180) : null\n    if (!captured.trim()) void run()\n    return () => { controller.abort(); window.clearTimeout(timer) }")
 component=once(component,'  const visibleResults = results.slice', "  useEffect(() => {\n    if (choosing.current && choosing.current.epoch !== navigationEpoch?.current) {\n      cancelOpening(); setOpening(''); setNotice('页面已切换，原打开操作已取消。')\n    }\n  }, [navigationEpoch?.current])\n  const visibleResults = results.slice")
 component=once(component,'const controller = new AbortController(); choosing.current = controller','const controller = new AbortController(); controller.epoch = navigationEpoch?.current; choosing.current = controller')
 component=once(component,"      if (!owns()) return\n      if (typeof latest.current.onSelectFile", "      if (!owns()) return\n      if (controller.epoch !== navigationEpoch?.current) { cancelled(); return }\n      if (typeof latest.current.onSelectFile")
 component=once(component,'        shouldSelect: owns,','        shouldSelect: () => owns() && controller.epoch === navigationEpoch?.current,')
 fs.writeFileSync('src/components/QuickSwitcher.jsx',component)
 let app=read('src/App.jsx');app=once(app,'            open={quickSearchOpen}','            open={quickSearchOpen}\n            navigationEpoch={navigationEpoch}');fs.writeFileSync('src/App.jsx',app)
 const testPath='src/components/UIRedesign.test.jsx';let tests=read(testPath)
 const testStart=tests.indexOf("  it('opens recent notes and supports keyboard selection in quick search'"),testEnd=tests.indexOf("  it('organizes project work",testStart)
 assert.ok(testStart>=0&&testEnd>testStart);let block=tests.slice(testStart,testEnd);fs.writeFileSync(out+'/original-quick-smoke.txt',block)
 block=once(block,'const onSelectFile = vi.fn()','const onSelectFile = vi.fn((file, options) => options.afterSelect(file))')
 block=once(block,'    api.mockResolvedValue([','    const quickRows = [')
 block=once(block,"    ])\n    searchFiles.mockResolvedValue([])","    ]\n    api.mockImplementation(async path => path.startsWith('/api/files?') ? quickRows : quickRows.find(file => path.endsWith('/' + file.id)))\n    searchFiles.mockResolvedValue([])")
 block=once(block,"expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))","expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }), expect.objectContaining({ shouldSelect: expect.any(Function), afterSelect: expect.any(Function), onCancel: expect.any(Function) }))\n    expect(api).toHaveBeenCalledTimes(2)")
 fs.writeFileSync(testPath,tests.slice(0,testStart)+block+tests.slice(testEnd))
 const prior=JSON.parse(read('package-lock.json'));assert.equal(prior.version,'4.222.3')
 let s=read('scripts/check-desktop-save.mjs');s="import { verifyQuickSwitcherDesktop } from './check-quick-switcher-desktop.mjs'\n"+s
 s=once(s,'  await verifyTemplateLibraryDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })','  await verifyTemplateLibraryDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })\n  await verifyQuickSwitcherDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })');fs.writeFileSync('scripts/check-desktop-save.mjs',s)
 s=read('AGENTS.md');const first=s.indexOf('\n\n'),end=s.indexOf('\n\n',first+2);assert.ok(s.slice(first,end).includes('2F.89 / 4.222.3'))
 s=s.slice(0,first)+'\n\nCurrent local module: 2F.90 / 4.223.0 complete local quick search and guarded note opening. Read docs/LOCAL_QUICK_SWITCHER_2F90.md. Base6100a35 /4.222.3 template module is accepted in PR2 comment6165531005; do not repeat it. Complete Ctrl+K entry, recent/query reads, IME, keyboard navigation, current-target verification, original App save/discard/cancel decision, failure/stop/retry/close and full-search handoff, then current-source regression, Windows and installation gates. No save or quit policy changes, cloud/multidevice, rejected source/dependency export or fake acceptance.'+s.slice(end);fs.writeFileSync('AGENTS.md',s)
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'});execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.222.3'],{stdio:'inherit'})
 const updated=JSON.parse(read('package-lock.json'));assert.equal(updated.version,'4.223.0');assert.equal(updated.packages[''].version,'4.223.0');updated.version=prior.version;updated.packages[''].version=prior.packages[''].version;assert.deepEqual(updated,prior)
 execFileSync('git',['diff','--check'],{stdio:'inherit'})
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const file of files){const content=read(file);const response=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(response.status,201);const b=await response.json();assert.equal(b.sha,blob(content));const dest=path.join(out,'source',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);records.push({path:file,sha:b.sha,bytes:Buffer.byteLength(content),sha256:sha(content)})}
 fs.writeFileSync(out+'/objects.json',JSON.stringify({base:BASE,verifier:process.env.GITHUB_SHA,records},null,2))
}else throw Error('Expected baseline/apply/publish')
