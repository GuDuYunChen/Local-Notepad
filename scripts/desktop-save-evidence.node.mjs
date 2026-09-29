import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { selectDesktopMainWindow } from './desktop-window-target.mjs'
import { desktopNote } from './desktop-save-fixture.mjs'
import { createEditor } from 'lexical'
import { HeadingNode } from '@lexical/rich-text'
import { verifyDesktopSaveReport } from './desktop-save-evidence.mjs'
const sha = 'a'.repeat(40)
const crc = b => { let n = 0xffffffff; for (const x of b) { n ^= x; for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0) } return (n^0xffffffff)>>>0 }
function png() {
 const chunk = (name, data) => {
  const type=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])))
  return Buffer.concat([len,type,data,sum])
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(1000);header.writeUInt32BE(720,4);header[8]=8;header[9]=2
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((3000+1)*720))),chunk('IEND',Buffer.alloc(0))])
}
function fixture(fn) {
 const dir=mkdtempSync(path.join(tmpdir(),'desktop-evidence-')),bytes=png()
 const report={commit:sha,platform:'win32',complete:true,realPackagedApp:true,realLexical:true,realPreloadAndQuit:true,
  realBackend:true,syntheticData:true,timerAccelerated:false,dirtyBeforeClose:true,noForcedBackendWarning:true,processIDs:[100,200],
  exits:[100,200].map(pid=>({pid,code:0,signal:null,nativeClose:true})),
  appSHA256:'b'.repeat(64),asarSHA256:'c'.repeat(64),backendSHA256:'d'.repeat(64),finalBodySHA256:'e'.repeat(64),
  checks:[
   'production preload connected for process 100',
   'native Ctrl+S saved actual heading and body without reference confirmation',
   'real library switch and reopen retain saved Lexical content',
   'real unaccelerated 30-second autosave persisted a changed heading',
   'real failed browser PUT retains draft, actual retry saves it',
   'WM_CLOSE with dirty Lexical body completed real quit gate and backend shutdown',
   'production preload connected for process 200',
   'fresh-profile packaged restart reads latest body from real database and closes cleanly'],
  screenshots:[['manual-saved','manual-native-4189'],['automatic-saved','automatic-native-4189'],
   ['failure-retains-draft','recovered-after-block'],['retry-saved','recovered-after-block'],
   ['restarted-fresh-profile','native-close-latest']].map(([n,text])=>({filename:n+'.png',text,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))}
 report.closeTargets=[100,200].map((pid,i)=>({pid,handle:i+300,visible:true,title:'记事本 · Local-Notepad',cls:'Chrome_WidgetWin_1',childText:['Chrome Legacy Window']}))
 report.closeDiagnostics=report.closeTargets.map(t=>({phase:'before-close',pid:t.pid,native:[t],renderer:{title:t.title}}))
 for(const s of report.screenshots)writeFileSync(path.join(dir,s.filename),bytes)
 const save=()=>writeFileSync(path.join(dir,'checks.json'),JSON.stringify(report));save()
 try{fn(dir,report,save)}finally{rmSync(dir,{recursive:true,force:true})}
}
test('accepts complete current-commit report with all native checks and PNGs',()=>fixture(dir=>assert.equal(verifyDesktopSaveReport(dir,sha).complete,true)))
for(const [label,change] of [
 ['wrong native window',r=>r.closeTargets[1]={...r.closeTargets[1],handle:999}],
 ['wrong commit',r=>r.commit='f'.repeat(40)],['incomplete run',r=>r.complete=false],
 ['replaced Lexical input',r=>r.realLexical=false],['accelerated autosave',r=>r.timerAccelerated=true],
 ['already saved before close',r=>r.dirtyBeforeClose=false],['forced backend warning',r=>r.noForcedBackendWarning=false],
 ['missing actual restart',r=>r.processIDs.pop()],['forced process termination',r=>r.exits[0].signal='SIGKILL'],
 ['missing quit check',r=>r.checks.splice(5,1)],['wrong visible marker',r=>r.screenshots[4].text='old body'],
])test('rejects '+label,()=>fixture((dir,r,save)=>{change(r);save();assert.throws(()=>verifyDesktopSaveReport(dir,sha))}))
test('rejects missing or modified screenshot even when run reports success',()=>{
 fixture((dir,r)=>{unlinkSync(path.join(dir,r.screenshots[0].filename));assert.throws(()=>verifyDesktopSaveReport(dir,sha))})
 fixture((dir,r)=>{writeFileSync(path.join(dir,r.screenshots[0].filename),'bad');assert.throws(()=>verifyDesktopSaveReport(dir,sha))})
})

test('synthetic seed uses actual canonical Lexical serialization without a load-time edit',()=>{
 const text=desktopNote('原始标题','original body'),editor=createEditor({nodes:[HeadingNode],onError(e){throw e}})
 const roundtrip=editor.parseEditorState(text)
 assert.equal(JSON.stringify(roundtrip.toJSON()),text)
})

const main={pid:100,handle:400,title:'记事本 · Local-Notepad',cls:'Chrome_WidgetWin_1',visible:true,childText:['Chrome Legacy Window']}
test('selects the actual renderer window rather than an earlier visible untitled helper',()=>{
 const helper={...main,handle:300,title:'',childText:[]}
 assert.equal(selectDesktopMainWindow([helper,main],100,main.title),main)
})
test('refuses another process, missing title, absent renderer child and ambiguous windows',()=>{
 for(const windows of [[{...main,pid:200}],[{...main,title:''}],[{...main,childText:[]}],[main,{...main,handle:500}],[]]){
  assert.throws(()=>selectDesktopMainWindow(windows,100,main.title))
 }
})
test('refuses hidden or malformed native window identities without posting a close',()=>{
 for(const change of [{visible:false},{handle:0},{handle:'400'},{cls:'Other'}]){
  assert.throws(()=>selectDesktopMainWindow([{...main,...change}],100,main.title))
 }
})
