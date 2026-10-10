import assert from 'node:assert/strict'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { comparisonHTMLRows } from './s3-local-comparison-html-cases.mjs'

// Runs after the original JSON/CSV checks, while only differences are visible.
// Read the real downloaded HTML; no replacement response or application code.
export async function verifyComparisonHTMLDesktop({ evaluate, click, cdp, until, out, destination, metrics }) {
  assert.equal(readdirSync(destination).filter(n=>n.endsWith('.html')).length,0)
  await click('[data-local-compare-export="html"]')
  const name=await until(()=>readdirSync(destination).find(n=>/^Local-Notepad-comparison-.*\.html$/.test(n)), 'Comparison HTML download missing')
  const bytes=readFileSync(path.join(destination,name)),raw=bytes.toString('utf8')
  assert.ok(bytes.length>0 && bytes.length<=16384)
  assert.deepEqual(comparisonHTMLRows(raw),metrics)
  assert.match(raw,/default-src 'none'/);assert.match(raw,/@media print/)
  assert.doesNotMatch(raw,/<(?:script|iframe|object|embed|link|img|form|a)\b|\son\w+=|\b(?:src|href)=/i)
  // Parse the actual file with the production Chromium DOM parser. This is
  // structural validation, not a claim of printer output or external browser UI.
  const parsed=await evaluate(`(()=>{const d=new DOMParser().parseFromString(${JSON.stringify(raw)},'text/html');return {rows:d.querySelectorAll('tbody tr').length,language:d.documentElement.lang,title:d.title,columns:d.querySelectorAll('th[scope=col]').length}})()`)
  assert.deepEqual(parsed,{rows:12,language:'zh-CN',title:'Local-Notepad 完整统计比较报告',columns:5})
  assert.match(await evaluate("document.querySelector('[data-local-compare-export-status]').textContent"),/尚未确认落盘/)
  await evaluate("document.querySelector('[data-local-compare-export-panel]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64')
  const hash=b=>createHash('sha256').update(b).digest('hex')
  writeFileSync(path.join(out,'local-comparison-html.png'),png)
  writeFileSync(path.join(out,'local-comparison-html-checks.json'),JSON.stringify({complete:true,commit:process.env.GITHUB_SHA,
    realPackagedApp:true,realDownload:true,syntheticData:true,
    checks:['real-html-download','all-twelve-metrics-match-json','signed-and-zero-values','scriptless-self-contained-document','chromium-parses-structure','truthful-download-receipt'],
    file:{filename:path.join('comparison-downloads',name),bytes:bytes.length,sha256:hash(bytes)},
    screenshot:{filename:'local-comparison-html.png',bytes:png.length,sha256:hash(png)}},null,2))
}
