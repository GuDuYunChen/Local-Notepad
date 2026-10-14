import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
const BASE='241dd411970fbd25b557c8b1fc8973fc7505cf44'
const read=p=>fs.readFileSync(p,'utf8')
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const sha=s=>createHash('sha256').update(s).digest('hex')
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Source range mismatch: '+a.slice(0,80));return s.replace(a,b)}
const test='src/components/FileListRefreshOwnership.test.jsx'
const files=['src/components/FileList.jsx',test,'package.json','package-lock.json','AGENTS.md','docs/LOCAL_TEMPLATE_LIBRARY_2F89.md']
fs.mkdirSync('refresh-evidence',{recursive:true})
if(process.argv[2]==='baseline'){
 assert.equal(blob(read(files[0])),'6eab26a5f7c4e047d1cae07a5b1d27f1e5d2a6e3')
 const r=spawnSync('npx',['vitest','run','--root=.',test,'--reporter=json','--outputFile=refresh-evidence/before.json'],{encoding:'utf8',timeout:90000})
 fs.writeFileSync('refresh-evidence/before.log',String(r.stdout||'')+String(r.stderr||''))
 assert.equal(r.status,1,'The original production component must reproduce the defect')
 const report=JSON.parse(read('refresh-evidence/before.json'));assert.equal(report.numTotalTests,5)
 const failing=report.testResults.flatMap(x=>x.assertionResults).filter(x=>x.status==='failed')
 assert.ok(failing.some(x=>x.fullName.includes('daily refresh delivered after navigation')))
 assert.ok(failing.some(x=>x.fullName.includes('initial read cannot auto-select')))
 console.log('Reproduced original list ownership defects',failing.map(x=>x.fullName))
}else if(process.argv[2]==='apply'){
 const file=files[0];let s=read(file);assert.equal(blob(s),'6eab26a5f7c4e047d1cae07a5b1d27f1e5d2a6e3')
 s=once(s,'  const treeListRef = useRef(null)',`  const treeListRef = useRef(null)
  // Reads may finish after another module selected a note. Deliver metadata to
  // the current parent, never the callback captured when the read started.
  const listContextRef = useRef(null)
  listContextRef.current = { q, selectedId, onItemsChanged, onSelect }
  const listReadRef = useRef({ active: false, epoch: 0 })`)
 s=once(s,'  useEffect(() => {\n    void load()\n    ',`  useEffect(() => {
    listReadRef.current.active = true
    void load()
    `)
 s=once(s,"      document.removeEventListener('mousedown', handleClickOutside)","      listReadRef.current.active = false\n      listReadRef.current.epoch += 1\n      document.removeEventListener('mousedown', handleClickOutside)")
 const a=s.indexOf('  async function load(retryCount = 0) {'),b=s.indexOf('  const getPathLabel',a)
 assert.ok(a>0&&b>a)
 s=s.slice(0,a)+`  async function load(retryCount = 0) {
    const lifetime = listReadRef.current
    if (!lifetime.active) return
    const epoch = ++lifetime.epoch
    const query = listContextRef.current.q
    const ownsRead = () => lifetime.active && lifetime.epoch === epoch && listContextRef.current.q === query
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    setLoading(true)
    try {
      const normalizedList = await listAllFiles(query)
      if (!ownsRead()) return
      setItems(normalizedList)
      const current = listContextRef.current
      current.onItemsChanged?.(normalizedList)
      if (!current.selectedId && normalizedList.length > 0) {
        const tree = buildTree(normalizedList)
        const first = findFirstFileInTree(tree)
        if (first) current.onSelect?.(first)
      }
    } catch (error) {
      if (!ownsRead()) return
      console.error(error)
      if (retryCount < 3) {
        retryTimerRef.current = setTimeout(() => {
          if (ownsRead()) void load(retryCount + 1)
        }, 1000)
      } else {
        toast.error('加载文件列表失败，请手动刷新')
      }
    } finally {
      if (ownsRead()) setLoading(false)
    }
  }

`+s.slice(b)
 fs.writeFileSync(file,s)
 let doc=read(files[5]);doc=once(doc,'# 2F.89 / 4.222.2','# 2F.89 / 4.222.3')
 doc+='\n## Async list ownership / 4.222.3\n\nInstalled1f83a11 failed returning from daily read-only reconciliation. Code review found that library:refresh retained its first parent callback and selectedId; late list completion could combine a newly selected body with a previously selected note ID. A real FileList/React-parent test reproduces that cross-module handoff before repair. List loads now deliver to current props, invalidate out-of-order and unmounted reads, and allow retries only while the originating read still owns the current query. Original note selection, dirty guards, saved receipts and template handoff stay unchanged. Five actual React tests cover daily handoff, initial delayed selection, reversed completions, unmount and normal metadata updates. Full original tests, production Go/build and current Windows/installation gates remain required. Same template module closure, not a new feature.\n'
 fs.writeFileSync(files[5],doc)
 fs.writeFileSync(files[4],once(read(files[4]),'2F.89 / 4.222.2','2F.89 / 4.222.3'))
 const before=JSON.parse(read('package-lock.json'));assert.equal(before.version,'4.222.2')
 execFileSync('npm',['run','version:patch'],{stdio:'inherit'})
 const after=JSON.parse(read('package-lock.json'));assert.equal(after.version,'4.222.3');assert.equal(after.packages[''].version,'4.222.3')
 after.version=before.version;after.packages[''].version=before.packages[''].version;assert.deepEqual(after,before)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.222.2'],{stdio:'inherit'})
 execFileSync('git',['diff','--check'],{stdio:'inherit'})
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const file of files){
  const content=read(file)
  const r=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})})
  assert.equal(r.status,201);const result=await r.json();assert.equal(result.sha,blob(content))
  const p=path.join('refresh-evidence/source',file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content)
  records.push({path:file,sha:result.sha,bytes:Buffer.byteLength(content),sha256:sha(content)})
 }
 fs.writeFileSync('refresh-evidence/objects.json',JSON.stringify({base:BASE,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2))
}else throw Error('Expected baseline, apply or publish')
