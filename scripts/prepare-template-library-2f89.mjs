// Exact baseline integration and evidence emission for one complete module.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const blob = b => createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0').update(b).digest('hex')
const sha = b => createHash('sha256').update(b).digest('hex')
const base = 'd002c8870af32eee85c4730e2db1d240a93f118a'
const expected = {
  "src/components/TemplateSelector.jsx": "ebbe0cc8bbfbd6c04462a673db6608c1176f4672",
  "src/components/FileList.jsx": "f0e4e0e0bac39b37b270b7c867b3475716c52f01",
  "scripts/check-desktop-save.mjs": "8729350ac4236b933b1cf238f62231ee55934e72",
  "server/internal/controller/file.go": "719694f5d6360c79f43cb7128f86961dd8821518",
  "AGENTS.md": "73a99b20c5b0138bbe7ce210cdc1fe106fe299e5"
}
const targets = [
  "AGENTS.md",
  "docs/LOCAL_TEMPLATE_LIBRARY_2F89.md",
  "package-lock.json",
  "package.json",
  "scripts/check-desktop-save.mjs",
  "scripts/check-template-library-desktop.mjs",
  "scripts/template-library-cases.mjs",
  "scripts/template-library.node.mjs",
  "server/internal/controller/file.go",
  "server/internal/controller/template_library.go",
  "server/internal/dao/template_library.go",
  "server/internal/dao/template_library_test.go",
  "src/components/FileList.jsx",
  "src/components/TemplateLibrary.css",
  "src/components/TemplateLibrary.jsx",
  "src/components/TemplateLibrary.test.jsx",
  "src/components/TemplateSelector.jsx",
  "src/services/templateDocument.test.js",
  "src/services/templateLibrary.mjs",
  "src/services/templateLibrary.test.js"
]
if (process.argv[2] === 'apply') {
  for (const [file, hash] of Object.entries(expected)) assert.equal(blob(fs.readFileSync(file)), hash, file)
  const before = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
  assert.equal(before.version, '4.221.1'); assert.equal(Object.keys(before.packages).length - 1, 679)
  execFileSync('git', ['apply', '--check', 'scripts/template-library-integration.patch'], {stdio:'inherit'})
  execFileSync('git', ['apply', 'scripts/template-library-integration.patch'], {stdio:'inherit'})
  execFileSync('gofmt', ['-w', 'server/internal/controller/template_library.go', 'server/internal/dao/template_library.go', 'server/internal/dao/template_library_test.go'], {stdio:'inherit'})
  const agent = fs.readFileSync('AGENTS.md', 'utf8').split('\n\n')
  assert.ok(agent[1].startsWith('Current local module: 2F.88'))
  agent[1] = 'Current local module: 2F.89 / 4.222.0 complete local text template library and safe note creation. Read docs/LOCAL_TEMPLATE_LIBRARY_2F89.md. Base d002c88 /4.221.1 and installed daily/history/trash are accepted in PR #2 comment6158925298; do not repeat their development. Finish entry, complete/error reads, draft authoring, template-only CAS edit/archive/restore, independent note creation with durable request receipts, original editor save, uncertain-operation reconciliation and current-source Windows/package/installation acceptance before another local module. Preserve old rich templates when renaming; copies explicitly use plain text and do not copy embedded files. No cloud or multidevice development. Never use the rejected workspace-export workflow.'
  fs.writeFileSync('AGENTS.md', agent.join('\n\n'))
  execFileSync('npm', ['run', 'version:minor'], {stdio:'inherit'})
  execFileSync('node', ['scripts/check-app-version.mjs', '--previous-version=4.221.1'], {stdio:'inherit'})
  execFileSync('node', ['scripts/verify-dependency-lock.mjs'], {stdio:'inherit'})
  const after = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')); assert.equal(after.version, '4.222.0'); assert.equal(after.packages[''].version, '4.222.0')
  after.version = before.version; after.packages[''].version = before.packages[''].version; assert.deepEqual(after, before)
  execFileSync('git', ['diff', '--check'], {stdio:'inherit'})
  fs.mkdirSync('template-module-evidence', {recursive:true})
  fs.writeFileSync('template-module-evidence/identity.json', JSON.stringify({base,verifier:process.env.GITHUB_SHA,productRefUpdated:false,targets},null,2))
} else if (process.argv[2] === 'publish') {
  assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad')
  assert.equal(process.env.GITHUB_REF, 'refs/heads/ci/local-history-2f87')
  const records = []
  for (const file of targets) {
    const content = fs.readFileSync(file, 'utf8')
    const response = await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs', {method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})})
    assert.equal(response.status,201,'Object write failed: '+file);const value=await response.json();assert.equal(value.sha,blob(content),file)
    const dest=path.join('template-module-evidence','source',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content)
    records.push({path:file,sha:value.sha,sha256:sha(content),bytes:Buffer.byteLength(content)})
  }
  fs.writeFileSync('template-module-evidence/objects.json',JSON.stringify({base,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2))
  console.log(JSON.stringify(records.map(({path,sha})=>({path,sha}))))
} else throw Error('Expected apply or publish')
