import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseTestEvents, parsePackages, sourceIdentity, collectBackendEvidence, verifyBackendReport, TEST_ARGS } from './backend-test-evidence.mjs'
const pkg = 'notepad-server/internal/syncs3', other = 'notepad-server/cmd/demo'
const inventory = [{name:pkg,packageName:'syncs3',testFiles:1},{name:other,packageName:'main',testFiles:0}]
const event = (Package, Action, Test, Output) => ({Time:'2026-10-02T12:00:00Z', Package, Action, ...(Test?{Test}:{}), ...(Output?{Output}:{})})
const fixture = () => [event(pkg,'start'),event(other,'start'),event(pkg,'run','TestRead'),event(pkg,'run','TestRead/first'),
  event(pkg,'pause','TestRead/first'),event(pkg,'cont','TestRead/first'),event(pkg,'pass','TestRead/first'),
  event(pkg,'pass','TestRead'),event(other,'output',null,'?\t'+other+'\t[no test files]\n'),event(other,'skip'),event(pkg,'pass')]
const raw = events => events.map(e => JSON.stringify(e)).join('\n')+'\n'
const verify = events => parseTestEvents(raw(events),inventory,['TestRead'])
test('accept interleaved packages, parallel subtest and honest no-test package', () => {
  const r=verify(fixture()); assert.equal(r.s3TopLevel,1);assert.equal(r.testPassEvents,2);assert.equal(r.testSkipEvents,0)
})
for(const [name, mutate] of [
  ['foreign package',a=>a[2].Package='notepad-server/internal/api'],
  ['failed test',a=>a[7].Action='fail'],['failed package',a=>a.at(-1).Action='fail'],
  ['missing package',a=>a.splice(1,1)],['missing final',a=>a.pop()],
  ['truncated test lifecycle',a=>a.splice(7,1)],['missing run',a=>a.splice(2,1)],
  ['duplicate start',a=>a.splice(1,0,{...a[0]})],['duplicate terminal',a=>a.push({...a.at(-1)})],
  ['cached output',a=>a.splice(2,0,event(pkg,'output',null,`ok\t${pkg}\t(cached)\n`))],
  ['skipped S3 test',a=>a[7].Action='skip'],['skipped test package',a=>a.at(-1).Action='skip'],
  ['different S3 test',a=>{for(const e of a)if(e.Test)e.Test=e.Test.replace('TestRead','TestFake')}],
  ['timestamp missing',a=>delete a[2].Time],['unknown action',a=>a[2].Action='complete'],
  ['build failure',a=>a.at(-1).FailedBuild=pkg],['test event after package pass',a=>a.push(event(pkg,'run','TestMore'))],
])test('reject '+name,()=>{const a=fixture();mutate(a);assert.throws(()=>verify(a))})
test('reject non-JSON stdout and partial final JSON line',()=>{
  assert.throws(()=>parseTestEvents('ok all\n',inventory,['TestRead']))
  assert.throws(()=>parseTestEvents(raw(fixture()).trimEnd(),inventory,['TestRead']))
})
test('reject empty or duplicated discovery set',()=>{
  for(const names of [[],['TestRead','TestRead'],['not a test']])assert.throws(()=>parseTestEvents(raw(fixture()),inventory,names))
})
test('missing a discovered S3 test is not silently accepted',()=>assert.throws(()=>parseTestEvents(raw(fixture()),inventory,['TestRead','TestMissing'])))
test('non-S3 conditional skip is surfaced without rewriting go test policy',()=>{
 const a=fixture();a.splice(8,0,event(other,'run','TestConditional'),event(other,'skip','TestConditional'));a[a.length-2].Action='pass'
 const r=parseTestEvents(raw(a),[{...inventory[0]},{...inventory[1],testFiles:1}],['TestRead']);assert.equal(r.testSkipEvents,1)
})
const source={moduleName:'notepad-server',files:[{path:'server/internal/syncs3/a.go'},{path:'server/internal/syncs3/a_test.go'},{path:'server/cmd/demo/main.go'}]}
const list=`${pkg}\tsyncs3\t1\t0\n${other}\tmain\t0\t0\n`
test('package list matches exact source folder coverage',()=>assert.deepEqual(parsePackages(list,source),inventory))
for(const [name,value] of [['foreign',list.replace('syncs3\tsyncs3','api\tapi')],['omitted',list.split('\n')[0]+'\n'],['duplicate',list+list],['test-count',list.replace('1\t0','2\t0')],['malformed','notepad-server syncs3\n']])
 test('reject package listing '+name,()=>assert.throws(()=>parsePackages(value,source)))
test('test invocation keeps full ./... suite and explicitly disables result cache',()=>assert.deepEqual(TEST_ARGS,['test','-json','-count=1','./...']))

// Real isolated Go package, real git objects, original files and verifier. No
// production workspace or network; the fixture toolchain is the installed Go.
function command(root,args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return r.stdout.trim()}
function project(fail=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'notepad-backend-evidence-'))
 const go=spawnSync('go',['env','GOVERSION'],{cwd:os.tmpdir(),env:{...process.env,GOTOOLCHAIN:'local',GOWORK:'off'},encoding:'utf8',timeout:15000})
 assert.equal(go.status,0,'local Go is required for evidence fixture test');const version=go.stdout.trim();assert.match(version,/^go\d+\.\d+\.\d+$/)
 fs.mkdirSync(path.join(root,'server/internal/syncs3'),{recursive:true});fs.mkdirSync(path.join(root,'server/cmd/demo'),{recursive:true})
 fs.writeFileSync(path.join(root,'server/go.mod'),`module notepad-server\n\ngo 1.22\n\ntoolchain ${version}\n`)
 fs.writeFileSync(path.join(root,'server/internal/syncs3/a.go'),'package syncs3\nfunc Value() int { return 7 }\n')
 fs.writeFileSync(path.join(root,'server/internal/syncs3/a_test.go'),`package syncs3\nimport "testing"\nfunc TestRead(t *testing.T) {t.Run("first", func(t *testing.T) {if Value()!=${fail?8:7} {t.Fatal("fixture failure")}})}\n`)
 fs.writeFileSync(path.join(root,'server/cmd/demo/main.go'),'package main\nfunc main() {}\n')
 command(root,['init','-q']);command(root,['add','.']);command(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','isolated fixture'])
 return {root,localFixture:true,dir:path.join(root,'evidence'),commit:command(root,['rev-parse','HEAD']),tree:command(root,['rev-parse','HEAD^{tree}'])}
}
function rewrite(dir,fn){const p=path.join(dir,'report.json'),b=fs.readFileSync(p);const r=JSON.parse(b);fn(r);fs.writeFileSync(p,JSON.stringify(r));return()=>fs.writeFileSync(p,b)}
test('real collection, re-verification and artifact/source tampering refusals',{timeout:90000},async t=>{
 const f=project();try{
  const r=collectBackendEvidence(f.root,f.dir,{localFixture:true});assert.equal(r.s3TopLevel,1);assert.equal(r.packages.length,2)
  assert.equal(r.testPassEvents,2);assert.equal(r.scope,'backend-tests-only')
  assert.equal(verifyBackendReport(f.dir,f.root,f).commit,f.commit)
  await t.test('local fixture cannot impersonate default CI verification',()=>assert.throws(()=>verifyBackendReport(f.dir,f.root,{commit:f.commit,tree:f.tree})))
  for(const [name,change]of [
   ['wrong commit',r=>r.commit='a'.repeat(40)],['wrong tree',r=>r.tree='a'.repeat(40)],['incomplete',r=>r.complete=false],
   ['wrong repository',r=>r.repository='other/repo'],['wrong branch',r=>r.branch='master'],['wrong toolchain',r=>r.go.version='go1.0.0'],
   ['filtered test invocation',r=>r.testArgs=['test','-json','-run','TestRead','./...']],['failed exit',r=>r.commands[3].exitCode=1],['subcommand filter',r=>r.commands[3].args=['test','-run','TestRead']],['wrong cwd',r=>r.commands[3].workingDirectory='another-server'],
   ['timeout',r=>r.commands[3].signal='SIGKILL'],['error despite zero exit',r=>r.commands[3].error='execution-error'],
   ['forged summary',r=>r.result.s3TopLevel=999],['missing source',r=>r.sourceBefore.files.pop()],
   ['changed-after-source',r=>r.sourceAfter.files[0].sha256='a'.repeat(64)],['path injection',r=>r.files['../data']=r.files['tests.jsonl']],
  ])await t.test('artifact rejects '+name,()=>{const undo=rewrite(f.dir,change);try{assert.throws(()=>verifyBackendReport(f.dir,f.root,f))}finally{undo()}})
  await t.test('raw log checksum alteration',()=>{const p=path.join(f.dir,'tests.jsonl'),b=fs.readFileSync(p);fs.appendFileSync(p,'\n');assert.throws(()=>verifyBackendReport(f.dir,f.root,f));fs.writeFileSync(p,b)})
  await t.test('truncation still rejected after attacker updates declared checksum',()=>{
   const p=path.join(f.dir,'tests.jsonl'),b=fs.readFileSync(p);const altered=b.toString().trimEnd().split('\n').slice(0,-1).join('\n')+'\n'
   fs.writeFileSync(p,altered);const undo=rewrite(f.dir,r=>r.files['tests.jsonl']={bytes:Buffer.byteLength(altered),sha256:createHash('sha256').update(altered).digest('hex')})
   try{assert.throws(()=>verifyBackendReport(f.dir,f.root,f))}finally{undo();fs.writeFileSync(p,b)}
  })
  await t.test('working source differs from trusted tree',()=>{const p=path.join(f.root,'server/internal/syncs3/a.go'),b=fs.readFileSync(p);fs.appendFileSync(p,'\n');assert.throws(()=>sourceIdentity(f.root,f.tree));fs.writeFileSync(p,b)})
  await t.test('collector does not overwrite an existing run',()=>assert.throws(()=>collectBackendEvidence(f.root,f.dir,{localFixture:true})))
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
})
test('real failed go test retains original JSON and cannot claim complete',{timeout:90000},()=>{
 const f=project(true);try{
  assert.throws(()=>collectBackendEvidence(f.root,f.dir,{localFixture:true}))
  const r=JSON.parse(fs.readFileSync(path.join(f.dir,'report.json')));assert.equal(r.complete,false);assert.equal(r.commands.at(-1).exitCode,1)
  assert.match(fs.readFileSync(path.join(f.dir,'tests.jsonl'),'utf8'),/"Action":"fail"/)
  assert.throws(()=>verifyBackendReport(f.dir,f.root,f))
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
})
