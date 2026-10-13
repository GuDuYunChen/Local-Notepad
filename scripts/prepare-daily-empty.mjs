import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,'Exact blank-note repair anchor mismatch');return s.replace(a,b)}
if(process.argv[2]==='apply'){
 const file='server/internal/dao/daily.go';let s=fs.readFileSync(file,'utf8');assert.equal(blob(s),'ac415e3e301f46f17f07fb311b8c4477892a2ee7')
 fs.writeFileSync('daily-evidence/daily-before-blank-repair.go.txt',s)
 const canonical='{"root":{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"root","version":1}}'
 s=replace(s,'const dailyInsertSQL =', '// Matches the installed Lexical empty paragraph serializer; the paired JS test\n// rejects any change in this contract. Existing bodies are never rewritten.\nconst dailyInitialContent = `'+canonical+'`\n\nconst dailyInsertSQL =')
 s=replace(s," SELECT ?, ?, '', ?, ?, 0,",' SELECT ?, ?, ?, ?, ?, 0,')
 s=replace(s,'dailyInsertSQL, uuid.NewString(), date, now, now, date','dailyInsertSQL, uuid.NewString(), date, dailyInitialContent, now, now, date')
 fs.writeFileSync(file,s)
 const tests='server/internal/dao/daily_test.go';s=fs.readFileSync(tests,'utf8');assert.equal(blob(s),'af9827b57fd49accbf9e994b4bd7453a3527bc77')
 s=replace(s,'first.Content != ""','first.Content != dailyInitialContent')
 s+=`\nfunc TestDailyLegacyEmptyBodyIsNeverRewritten(t *testing.T) {
 d:=newSearchTestDAO(t);d.DB.SetMaxOpenConns(1);ctx:=context.Background()
 if err:=d.Create(ctx,&model.File{ID:"legacy-empty",Title:"2026-10-13",Content:""});err!=nil{t.Fatal(err)}
 for _,readOnly:=range []bool{true,false}{f,created,err:=d.OpenDaily(ctx,"2026-10-13",readOnly);if err!=nil||created||f.ID!="legacy-empty"||f.Content!=""{t.Fatalf("legacy body rewritten: %v %v %v",f,created,err)}}
}
`
 fs.writeFileSync(tests,s)
 const native='scripts/check-daily-notes-desktop.mjs';s=fs.readFileSync(native,'utf8');assert.equal(blob(s),'041825443ce69a4d2bb6446c8b278d8dd7c012ba')
 s=replace(s,"    assert.equal((await current(faultDate)).file.id, committed.id); report.failureInjection", "    await until(() => evaluate(\"!document.querySelector('.save-state')\"), 'Opening a pristine daily note incorrectly dirtied the editor')\n    assert.equal((await current(faultDate)).file.id, committed.id); report.failureInjection")
 fs.writeFileSync(native,s)
 for(const f of ['AGENTS.md','docs/LOCAL_DAILY_NOTES_2F88.md']){
  let text=fs.readFileSync(f,'utf8');text=text.replaceAll('4.221.0','4.221.1')
  if(f.startsWith('docs/'))text+='\n## 同模块空白初始化修补 / 4.221.1\n\n981677b 的原 Windows 日常链路已通过前8项，但全新空白记录用空字符串存储后被 Lexical 初始化为带空段落的 JSON，未输入就出现未保存确认。新建记录改用与当前锁定 Lexical 实际序列化逐字节核对的空段落正文。仅改变新增记录的初始格式，不自动保存、不清除草稿、不抑制退出确认，也不重写已有空字符串记录；原编辑器保存规则保持。新增实际序列化契约、旧记录不重写 Go 回归，并让原生回执核对之后明确等待无脏状态再返回日历。原失败产物11829720692保留。\n'
  fs.writeFileSync(f,text)
 }
 const before=JSON.parse(fs.readFileSync('package-lock.json','utf8'));assert.equal(before.version,'4.221.0')
 execFileSync('npm',['run','version:patch'],{stdio:'inherit'})
 const after=JSON.parse(fs.readFileSync('package-lock.json','utf8'));assert.equal(after.version,'4.221.1');after.version=before.version;after.packages[''].version=before.packages[''].version;assert.deepEqual(after,before)
 execFileSync('gofmt',['-w',file,tests],{stdio:'inherit'});execFileSync('git',['diff','--check'],{stdio:'inherit'})
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const f='src/services/dailyInitialContent.test.js',content=fs.readFileSync(f,'utf8')
 const r=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})})
 assert.equal(r.status,201);const result=await r.json();assert.equal(result.sha,blob(content))
 const target=path.join('daily-evidence/source',f);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content)
 const index=JSON.parse(fs.readFileSync('daily-evidence/objects.json','utf8'));assert.ok(!index.records.some(x=>x.path===f));index.records.push({path:f,sha:result.sha,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')})
 fs.writeFileSync('daily-evidence/objects.json',JSON.stringify(index,null,2))
}else throw Error('Expected apply or publish')
