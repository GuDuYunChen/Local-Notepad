// Close the reproduced template workflow obstruction; never suppress its toast.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex')
const sha256 = text => createHash('sha256').update(text).digest('hex')
const read = file => fs.readFileSync(file, 'utf8')
const once = (text, from, to) => { assert.equal(text.split(from).length, 2, 'Unexpected source anchor'); return text.replace(from, to) }
const cssFile = 'src/styles/redesign.css', testFile = 'src/components/ToastViewport.test.jsx'
if (process.argv[2] === 'baseline') {
  assert.equal(blob(read(cssFile)), '3d863c30fb862c4dc2bf36889587c92e9c6b2cfe')
  const run = spawnSync('npx', ['vitest','run','--root=.',testFile,'--reporter=json','--outputFile=template-module-evidence/toast-before.json'], {encoding:'utf8', timeout:60000})
  fs.writeFileSync('template-module-evidence/toast-before.log', String(run.stdout || '') + String(run.stderr || ''))
  assert.equal(run.status, 1, 'Old CSS must reproduce the regression')
  const report = JSON.parse(read('template-module-evidence/toast-before.json'))
  assert.equal(report.numTotalTests, 8); assert.equal(report.numFailedTests, 1)
  const failed = report.testResults.flatMap(t => t.assertionResults).filter(t => t.status === 'failed')
  assert.equal(failed.length, 1); assert.ok(failed[0].fullName.includes('CSS cannot intercept'))
  console.log('Reproduced passive-toast CSS failure; original seven behavior checks pass.')
} else if (process.argv[2] === 'apply') {
  const expected = {
    [cssFile]: '3d863c30fb862c4dc2bf36889587c92e9c6b2cfe',
    'scripts/check-template-library-desktop.mjs': '04b042522e7f13e3b0d74660c1034c64bd13d9c3',
    'AGENTS.md': 'ac800363070ec0e2500a1824636a6904087416ab',
    'docs/LOCAL_TEMPLATE_LIBRARY_2F89.md': '579d49bad7f12665868cfae75af5d97eac1887b6',
  }
  const originals = {}; for (const [file, hash] of Object.entries(expected)) { originals[file] = read(file); assert.equal(blob(originals[file]), hash, file) }
  let css = originals[cssFile], start = css.indexOf('\n.app-toast {'), end = css.indexOf('\n}', start)
  assert.ok(start > 0 && end > start)
  css = css.slice(0, start) + once(css.slice(start, end), 'pointer-events: auto;', 'pointer-events: none;') + css.slice(end)
  fs.writeFileSync(cssFile, css)
  let native = originals['scripts/check-template-library-desktop.mjs']
  const from = "  await open();await hasText('本地模板验收');await screenshot();await action('返回模板选择');await click('.template-selector-header button[aria-label=\"关闭\"]');mark('library-can-close-and-reopen')"
  const to = `  await open();await hasText('本地模板验收')
  await evaluate("window.dispatchEvent(new CustomEvent('local-notepad:toast',{detail:{action:'show',toast:{id:'template-passive-hit-test',type:'success',content:'模板通知保持可见',duration:0}}}))")
  await until(()=>evaluate("[...document.querySelectorAll('.app-toast-content')].some(n=>n.textContent==='模板通知保持可见')"),'Real passive notification missing')
  assert.equal(await evaluate("[...document.querySelectorAll('.app-toast')].every(n=>getComputedStyle(n).pointerEvents==='none')"),true,'Passive toast must not intercept input')
  await screenshot();await action('返回模板选择')
  assert.equal(await evaluate("!!document.querySelector('.template-selector') && [...document.querySelectorAll('.app-toast-content')].some(n=>n.textContent==='模板通知保持可见')"),true,'Return must complete without hiding notification')
  report.passiveToast={realViewport:true,remainedVisible:true,originalMouseHitTest:true};mark('visible-passive-toast-does-not-block-template-return')
  await click('.template-selector-header button[aria-label="关闭"]');mark('library-can-close-and-reopen')`
  native = once(native, from, to)
  native = once(native, " finally{if(intercept)", " finally{await evaluate(\"window.dispatchEvent(new CustomEvent('local-notepad:toast',{detail:{action:'close',id:'template-passive-hit-test'}}))\");if(intercept)")
  fs.writeFileSync('scripts/check-template-library-desktop.mjs', native)
  fs.writeFileSync('AGENTS.md', once(originals['AGENTS.md'], '2F.89 / 4.222.1', '2F.89 / 4.222.2'))
  const doc = once(originals['docs/LOCAL_TEMPLATE_LIBRARY_2F89.md'], '# 2F.89 / 4.222.1', '# 2F.89 / 4.222.2') + '\n## Passive notification obstruction / 4.222.2\n\nActual Windows53d3657 artifact11869770639 completed the first10 template checks, then a visible saved toast intercepted the final return button. ToastViewport renders text-only status/alert notifications, with no interactive controls. Change only their CSS pointer-events from auto to none; retain text, roles, timers and closing behavior, do not hide notifications or bypass the real mouse test. Eight React/style contracts preserve the original behavior and reject the old CSS. The native workflow now keeps a real persistent success notification visible while the original hit-tested mouse returns to the selector, then cleans up the owned notification. All prior template, editor, daily, history, trash and installer checks remain required. Standard patch4.222.2; original Go/Electron/schema14 and679 dependency nodes unchanged.\n'
  fs.writeFileSync('docs/LOCAL_TEMPLATE_LIBRARY_2F89.md', doc)
  const oldLock = JSON.parse(read('package-lock.json')); assert.equal(oldLock.version, '4.222.1')
  execFileSync('npm', ['run','version:patch'], {stdio:'inherit'})
  const newLock = JSON.parse(read('package-lock.json')); assert.equal(newLock.version, '4.222.2'); assert.equal(newLock.packages[''].version, '4.222.2')
  newLock.version = oldLock.version; newLock.packages[''].version = oldLock.packages[''].version; assert.deepEqual(newLock, oldLock)
  execFileSync('node', ['scripts/check-app-version.mjs','--previous-version=4.222.1'], {stdio:'inherit'})
  execFileSync('git', ['diff','--check'], {stdio:'inherit'})
} else if (process.argv[2] === 'publish') {
  assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad'); assert.equal(process.env.GITHUB_REF, 'refs/heads/ci/local-history-2f87')
  const file = 'template-module-evidence/objects.json', index = JSON.parse(read(file))
  for (const name of [cssFile, testFile]) {
    assert.ok(!index.records.some(r => r.path === name)); const content = read(name)
    const response = await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs', {method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})})
    assert.equal(response.status,201); const result = await response.json(); assert.equal(result.sha,blob(content))
    const dest = path.join('template-module-evidence/source',name); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,content)
    index.records.push({path:name,sha:result.sha,bytes:Buffer.byteLength(content),sha256:sha256(content)})
  }
  fs.writeFileSync(file,JSON.stringify(index,null,2)+'\n')
} else throw Error('Use baseline, apply or publish')
