// Fix a reproduced real click obstruction, not the click test. Existing native
// reference notifications remain visible; history scrolls its controls clear.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const sha=s=>createHash('sha256').update(s).digest('hex')
const targets=['src/components/VersionHistory.jsx','src/components/VersionHistory.css','src/components/VersionHistory.test.jsx','docs/LOCAL_VERSION_HISTORY_2F87.md']
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,'Source range mismatch');return s.replace(a,b)}
if(process.argv[2]==='apply'){
 let s=fs.readFileSync(targets[0],'utf8');assert.equal(blob(s),'f7fccfadb313a13f99c3c9da9276373db0b7df85')
 s=replace(s,'useEffect, useMemo','useEffect, useLayoutEffect, useMemo')
 s=replace(s,'  const alive = useRef(false)',`  const clearance = useRef(null)
  useLayoutEffect(() => {
    const panel = clearance.current
    if (!panel) return
    let frame = 0, banner = null
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure) }
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    function measure() {
      frame = 0
      const current = document.querySelector('.reference-maintenance-status')
      if (current !== banner) {
        if (banner) resize?.unobserve(banner)
        banner = current
        if (banner) resize?.observe(banner)
      }
      const bounds = panel.getBoundingClientRect(), overlay = banner?.getBoundingClientRect()
      const overlaps = overlay && overlay.bottom > 0 && overlay.top < window.innerHeight &&
        overlay.right > bounds.left && overlay.left < bounds.right
      const inset = overlaps ? Math.ceil(window.innerHeight - Math.max(0, overlay.top)) + 16 : 16
      panel.style.setProperty('--history-bottom-clearance', inset + 'px')
    }
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    measure()
    return () => { mutations.disconnect(); resize?.disconnect(); window.removeEventListener('resize', schedule); window.cancelAnimationFrame(frame) }
  }, [fileId])
  const alive = useRef(false)`)
 s=replace(s,'return <section className="version-history"','return <section ref={clearance} className="version-history"')
 fs.writeFileSync(targets[0],s)
 s=fs.readFileSync(targets[1],'utf8');assert.equal(blob(s),'67fe59ef742f5bf658b5064a11e0e7360dfcf173')
 s=replace(s,'.version-history { min-width: 0;', '.version-history { padding-bottom: var(--history-bottom-clearance, 16px); min-width: 0;')
 fs.writeFileSync(targets[1],s)
 s=fs.readFileSync(targets[2],'utf8');assert.equal(blob(s),'089aea4f339989f3874d984647f4484ef2f46a32')
 s+=`\ntest('visible reference notification reserves measured scroll space and releases it when removed',async()=>{
 const banner=document.createElement('aside');banner.className='reference-maintenance-status';document.body.append(banner)
 const top=window.innerHeight-144
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){return this===banner?{left:0,right:300,top,bottom:top+60}:{left:0,right:320,top:0,bottom:600}})
 try{
  await mount();expect(host.querySelector('.version-history').style.getPropertyValue('--history-bottom-clearance')).toBe('160px')
  banner.remove();await act(async()=>{await Promise.resolve();await new Promise(r=>window.requestAnimationFrame(r))})
  expect(host.querySelector('.version-history').style.getPropertyValue('--history-bottom-clearance')).toBe('16px')
  expect(bridge.restore).not.toHaveBeenCalled()
 }finally{banner.remove()}
})
test('notifications outside the panel do not add an unnecessary large scroll gap',async()=>{
 const banner=document.createElement('aside');banner.className='reference-maintenance-status';document.body.append(banner)
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){return this===banner?{left:400,right:700,top:10,bottom:100}:{left:0,right:320,top:0,bottom:600}})
 try{await mount();expect(host.querySelector('.version-history').style.getPropertyValue('--history-bottom-clearance')).toBe('16px')}finally{banner.remove()}
})
`
 fs.writeFileSync(targets[2],s)
 const native='scripts/check-version-history-desktop.mjs';s=fs.readFileSync(native,'utf8');assert.equal(blob(s),'233ec98ca49a02e0d61d029c02d150535778b686')
 s=replace(s,"if(a.length!==1||a[0].disabled)return false;a[0].setAttribute('data-history-click','');", "if(a.length!==1||a[0].disabled)return false;a[0].scrollIntoView({block:'center'});const r=a[0].getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!a[0].contains(hit))return false;a[0].setAttribute('data-history-click','');")
 fs.writeFileSync(native,s)
 let agents=fs.readFileSync('AGENTS.md','utf8');agents=replace(agents,'Current local module: 2F.87 / 4.220.0','Current local module: 2F.87 / 4.220.1');fs.writeFileSync('AGENTS.md',agents)
 let doc=fs.readFileSync(targets[3],'utf8');doc=replace(doc,'# 2F.87 / 4.220.0','# 2F.87 / 4.220.1')
 doc+='\n## Windows operation-area repair / 4.220.1\n\nCurrent-source c79d8a0 Windows artifact11802740854 passed real history read, first-snapshot restore and dirty-draft admission, then its explicit-save click was intercepted by the fixed reference-maintenance banner. Preserve the original failure screenshot and original native click, not a JavaScript click bypass. The panel now reserves measured bottom scroll clearance for that visible, horizontally overlapping banner, updates it on appearance/resize/removal and cleans up observers on unmount. The reference notice and its retry remain fully functional. Added two DOM layout contracts; the native helper now also checks actual hit testing before dispatching the original mouse input. Same module, normal patch version4.220.1, unchanged save/Go/Electron/installer/schema and679 dependency nodes. Complete current-source regression, actual desktop and installation gates remain mandatory.\n'
 fs.writeFileSync(targets[3],doc)
 const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));assert.equal(lock.version,'4.220.0')
 execFileSync('npm',['run','version:patch'],{stdio:'inherit'})
 const updated=JSON.parse(fs.readFileSync('package-lock.json','utf8'));assert.equal(updated.version,'4.220.1');updated.version=lock.version;updated.packages[''].version=lock.packages[''].version;assert.deepEqual(updated,lock)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.220.0'],{stdio:'inherit'});execFileSync('git',['diff','--check'],{stdio:'inherit'})
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const index=JSON.parse(fs.readFileSync('source-objects/objects.json','utf8'))
 for(const file of targets){
  assert.ok(!index.records.some(r=>r.path===file));const content=fs.readFileSync(file,'utf8')
  const r=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})})
  assert.equal(r.status,201);const result=await r.json();assert.equal(result.sha,blob(content))
  const dest=path.join('source-objects',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content)
  index.records.push({path:file,sha:result.sha,bytes:Buffer.byteLength(content),sha256:sha(content)})
 }
 fs.writeFileSync('source-objects/objects.json',JSON.stringify(index,null,2));console.log(JSON.stringify(index.records.map(({path,sha})=>({path,sha}))))
}else throw Error('Expected apply or publish')
