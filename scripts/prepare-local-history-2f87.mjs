// One immutable base, bounded source edits, normal npm versioning. This auxiliary
// task creates content-addressed blobs ONLY; it never commits or updates refs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const blob = text => createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex')
const sha256 = text => createHash('sha256').update(text).digest('hex')
const expected = {
 'src/App.jsx':'03aed8f1c261dd17f864dae36ccf93050e90bbd3',
 'src/components/TextEditor.jsx':'fc1cfe4375891175843e513d199ba0539738c630',
 'src/components/InspectorPanel.jsx':'cf3dc2cd823deb14cccf7cc88c299e33b3f12600',
 'scripts/check-desktop-save.mjs':'5ba0111b13a4a3577865364d35542554aa7fda58',
 'AGENTS.md':'7d9f572150678588075078874ceaaa05432a9140',
 'package.json':'075b963750dbaf9cf0a5323dcaf6f298c94aee85',
}
const targets=[...Object.keys(expected),'package-lock.json']
const read = p => fs.readFileSync(p,'utf8')
const replaceOne = (s,a,b) => { assert.equal(s.split(a).length,2,'Exact source range mismatch: '+a.slice(0,70));return s.replace(a,b) }
if(process.argv[2]==='apply') {
 const source={}; for(const [file,hash]of Object.entries(expected)){source[file]=read(file);assert.equal(blob(source[file]),hash,file)}
 const originalLock=JSON.parse(read('package-lock.json'));assert.equal(originalLock.version,'4.219.1');assert.equal(originalLock.packages[''].version,'4.219.1')
 let s=source['src/components/TextEditor.jsx']
 s=replaceOne(s,"import { api } from '~/services/api'","import { api } from '~/services/api'\nimport { restoreEditorHistory } from '~/services/versionHistory.mjs'")
 s=replaceOne(s,"  const contentRef = useRef('')","  const contentRef = useRef('')\n  const historyBoundaryRef = useRef(0)")
 const start=s.indexOf('    replaceDraftContent: (nextContent, options = {}) => {'),end=s.indexOf('    replaceSavedContent:',start)
 assert.ok(start>0&&end>start)
 const old=s.slice(start,end);assert.ok(old.endsWith('    },\n'))
 const fn=old.replace('    replaceDraftContent: (nextContent, options = {}) => {','  const replaceDraftContent = (nextContent, options = {}) => {').replace(/    },\n$/,'  }\n')
 s=s.slice(0,start)+'    replaceDraftContent,\n    captureHistoryState,\n    restoreHistoryVersion: (version, reviewed, signal) => restoreEditorHistory({\n      snapshot: captureHistoryState, replace: replaceDraftContent, save: () => saveNow(\'history-restore\'),\n    }, version, reviewed, signal),\n    saveHistoryCurrent: (reviewed) => {\n      const current = captureHistoryState()\n      if (!reviewed || !current.ready || current.id !== reviewed.id || current.generation !== reviewed.generation || current.boundary !== reviewed.boundary)\n        return Promise.reject(new Error(\'笔记已经变化，未发起保存\'))\n      return saveNow(\'history-save-current\')\n    },\n'+s.slice(end)
 const capture=`  const captureHistoryState = () => Object.freeze({
    id: currentIdRef.current,
    ready: saveLifetimeRef.current.active && !!currentIdRef.current && loadedDocumentRef.current === currentIdRef.current && !deletedIdsRef.current?.has(currentIdRef.current),
    generation: loadGenerationRef.current,
    boundary: historyBoundaryRef.current,
    revision: databaseRevisionRef.current.get(currentIdRef.current) || 0,
    content: contentRef.current, saved: lastSavedContentRef.current,
    pending: inFlightSavesRef.current.has(currentIdRef.current) || queuedSavesRef.current.has(currentIdRef.current) || conflictBusyRef.current,
    uncertain: saveAttemptsRef.current.has(currentIdRef.current) || saveConflictsRef.current.has(currentIdRef.current),
  })

`
 s=replaceOne(s,'  useImperativeHandle(ref, () => ({',fn+'\n'+capture+'  useImperativeHandle(ref, () => ({')
 let count=0;s=s.replace(/^(\s*)contentRef\.current = (.+)$/gm,(line,indent)=>{count++;return indent+'historyBoundaryRef.current += 1\n'+line});assert.ok(count>=7&&count<=10,'Unexpected assignment count: '+count)
 // A quit attempt invalidates preflight/confirmation before the original quit
 // participant captures and drains saves. It does not add a new quit blocker.
 s=replaceOne(s,"    cache: () => {\n      window.clearTimeout", "    cache: () => {\n      historyBoundaryRef.current += 1\n      window.clearTimeout")
 fs.writeFileSync('src/components/TextEditor.jsx',s)
 s=source['src/App.jsx']
 s=replaceOne(s,`  const restoreCurrent = React.useCallback(() => {
    if (!current) return
    api(\`/api/files/\${current.id}\`).then(select)
  }, [current, select])`,`  const historyEditor = React.useMemo(() => ({
    snapshot: () => editorRef.current?.captureHistoryState?.(),
    restore: (version, reviewed, signal) => {
      const active = editorRef.current
      if (!active?.restoreHistoryVersion) return Promise.reject(new Error('编辑器未就绪'))
      return active.restoreHistoryVersion(version, reviewed, signal)
    },
    saveCurrent: reviewed => {
      const active = editorRef.current
      if (!active?.saveHistoryCurrent) return Promise.reject(new Error('编辑器未就绪'))
      return active.saveHistoryCurrent(reviewed)
    },
  }), [])`)
 s=replaceOne(s,'                    onRestore={restoreCurrent}','                    historyEditor={historyEditor}');fs.writeFileSync('src/App.jsx',s)
 s=source['src/components/InspectorPanel.jsx'];s=replaceOne(s,'  onRestore,','  historyEditor,');s=replaceOne(s,'<VersionHistory fileId={file.id} onRestore={onRestore} />','<VersionHistory key={file.id} fileId={file.id} editor={historyEditor} />');fs.writeFileSync('src/components/InspectorPanel.jsx',s)
 s=source['scripts/check-desktop-save.mjs'];s="import { verifyVersionHistoryDesktop } from './check-version-history-desktop.mjs'\n"+s
 s=replaceOne(s,'  await verifyLocalOverviewDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })','  await verifyLocalOverviewDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })\n  await verifyVersionHistoryDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })');fs.writeFileSync('scripts/check-desktop-save.mjs',s)
 const paragraphs=source['AGENTS.md'].split('\n\n');assert.ok(paragraphs[1].startsWith('Current local module candidate: 2F.86'))
 paragraphs[1]='Current local module: 2F.87 / 4.220.0 complete local note version history and safe body restoration. Read docs/LOCAL_VERSION_HISTORY_2F87.md. Base 048a9ca /4.219.1 and its real installer lifecycle are accepted in PR #2 comment 6140762411; do not repeat them. Finish history entry, valid/empty/error reads, full-text comparison, confirmation, clean-editor admission, original receipt-backed save, before-snapshot, failure/quit/draft protection, and current-source Windows/build acceptance before another local module. History rows are previous snapshots, not proof of the current body. Never restore via the old direct POST endpoint or overwrite dirty/pending/conflicted editors. Product source, local tests, current-HEAD CI and installer evidence are distinct checkpoints. No cloud/multi-device development.'
 fs.writeFileSync('AGENTS.md',paragraphs.join('\n\n'))
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'});execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.219.1'],{stdio:'inherit'});execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'})
 const updated=JSON.parse(read('package-lock.json'));assert.equal(updated.version,'4.220.0');assert.equal(updated.packages[''].version,'4.220.0');updated.version=originalLock.version;updated.packages[''].version=originalLock.packages[''].version;assert.deepEqual(updated,originalLock)
 execFileSync('git',['diff','--check'],{stdio:'inherit'});fs.mkdirSync('source-objects',{recursive:true});fs.writeFileSync('source-objects/prepared.json',JSON.stringify({base:'048a9ca0f70b32fed1afc0f162e297789c781747',targets,assignmentGuards:count,testsExecuted:false},null,2))
} else if(process.argv[2]==='publish') {
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const file of targets) {
  const content=read(file),r=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})})
  assert.equal(r.status,201,'Blob creation failed: '+file);const result=await r.json();assert.equal(result.sha,blob(content),file)
  const dest=path.join('source-objects',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content)
  records.push({path:file,sha:result.sha,bytes:Buffer.byteLength(content),sha256:sha256(content)})
 }
 fs.writeFileSync('source-objects/objects.json',JSON.stringify({base:'048a9ca0f70b32fed1afc0f162e297789c781747',verifier:process.env.GITHUB_SHA,refUpdated:false,records},null,2));console.log(JSON.stringify(records.map(({path,sha})=>({path,sha}))))
} else throw Error('Use apply or publish')
