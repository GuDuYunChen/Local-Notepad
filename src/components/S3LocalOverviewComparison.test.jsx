import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Comparison from './S3LocalOverviewComparison.jsx'
import Viewer from './S3LocalOverviewFile.jsx'
import { comparisonFile, comparisonLocal } from '../../scripts/s3-local-overview-comparison-cases.mjs'
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs'

let root, host
const render = (report, localSummary) => act(async () => root.render(<StrictMode><Comparison report={report} localSummary={localSummary}/></StrictMode>))
const click = selector => act(async () => host.querySelector(selector).click())
const start = () => click('[data-local-compare-start]')
const result = () => host.querySelector('[data-local-compare-result]')
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async () => { await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals() })
it('inventory comparison UI never calculates, reads or writes on StrictMode mount',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch'),save=vi.spyOn(Storage.prototype,'setItem')
  await render(comparisonFile(),comparisonLocal());expect(result()).toBeNull();expect(fetch).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled()
})
it('inventory comparison UI requires explicit consent and shows precise signed deltas',async()=>{
  await render(comparisonFile(),comparisonLocal());await start()
  const rows=[...result().querySelectorAll('tbody tr')]
  expect(rows.length).toBe(12);expect(rows[0].cells[3].textContent).toBe('+2 项')
  expect(rows[1].cells[3].textContent).toBe('+10 B');expect(rows[2].cells[3].textContent).toBe('-3 B');expect(rows[3].cells[3].textContent).toBe('-1 项')
  expect(rows[4].cells[1].textContent).toBe('1 项');expect(rows[4].cells[2].textContent).toBe('3 项')
})
it('inventory comparison UI does not present identical counts as matching content or sync consent',async()=>{
  const file=comparisonFile();await render(file,file.summary);await start()
  expect(result()).not.toBeNull();expect(host.textContent).toContain('差值为 0 也不能证明正文或附件内容相同')
  expect(host.textContent).toContain('未验证两者来自同一工作区');expect(host.textContent).toContain('不是盘点时间')
})
it('inventory comparison UI missing local observation is disabled and does not initiate a scan',async()=>{
  await render(comparisonFile(),null);expect(host.querySelector('[data-local-compare-start]').disabled).toBe(true)
  expect(host.textContent).toContain('这里不会自动扫描');await start();expect(result()).toBeNull()
})
it('inventory comparison UI local reread immediately removes comparison without discarding the file prop',async()=>{
  const file=comparisonFile();await render(file,comparisonLocal());await start();expect(result()).not.toBeNull()
  await render(file,null);expect(result()).toBeNull();await render(file,comparisonLocal());expect(result()).toBeNull();await start();expect(result()).not.toBeNull()
})
it('inventory comparison UI changed file or local observation requires renewed consent',async()=>{
  let file=comparisonFile(),local=comparisonLocal();await render(file,local);await start()
  file=comparisonFile();await render(file,local);expect(result()).toBeNull();await start()
  local=comparisonLocal();await render(file,local);expect(result()).toBeNull()
})
it('inventory comparison UI A-B-A source changes cannot revive an earlier consent',async()=>{
  const a=comparisonFile(),b=comparisonFile(),local=comparisonLocal();await render(a,local);await start()
  await render(b,local);await render(a,local);expect(result()).toBeNull()
})
it('inventory comparison UI stable rerenders keep the explicit result and clearing affects only comparison',async()=>{
  const file=comparisonFile(),local=comparisonLocal();await render(file,local);await start();const shown=result().textContent
  await render(file,local);expect(result().textContent).toBe(shown);await click('[data-local-compare-clear]');expect(result()).toBeNull()
  expect(file.summary.records).toBe(2);expect(local.records).toBe(4)
})
it('inventory comparison UI malformed sources fail as a whole without error details',async()=>{
  const local=structuredClone(comparisonLocal());local.records=999
  await render(comparisonFile(),local);await start();expect(result()).toBeNull()
  expect(host.querySelector('[data-local-compare-state]').dataset.localCompareState).toBe('failed');expect(host.textContent).not.toContain('999')
})
it('inventory comparison UI unmount and remount require another explicit comparison',async()=>{
  const file=comparisonFile(),local=comparisonLocal();await render(file,local);await start()
  await act(async()=>root.render(null));await render(file,local);expect(result()).toBeNull()
})
it('inventory comparison UI labels source columns and uses non-submit accessible controls',async()=>{
  const submit=vi.fn(e=>e.preventDefault())
  await act(async()=>root.render(<form onSubmit={submit}><Comparison report={comparisonFile()} localSummary={comparisonLocal()}/></form>))
  await start();expect(submit).not.toHaveBeenCalled();expect(result().querySelectorAll('th[scope=row]').length).toBe(12)
  const b=host.querySelector('[data-local-compare-start]');expect(document.getElementById(b.getAttribute('aria-describedby'))).not.toBeNull()
  expect(host.textContent).toContain('所选报告');expect(host.textContent).toContain('本次本地盘点')
})
it('inventory comparison production file view clears comparison when replacing or clearing the file',async()=>{
  const readers=[]
  vi.stubGlobal('FileReader',class{constructor(){readers.push(this)}readAsArrayBuffer(file){this.file=file}abort(){}})
  const local=comparisonLocal()
  await act(async()=>root.render(<StrictMode><Viewer currentSummary={local}/></StrictMode>))
  const select=async()=>act(async()=>{
    const input=host.querySelector('input[type=file]'),raw=JSON.stringify(reportFixture())
    Object.defineProperty(input,'files',{configurable:true,value:[new File([raw],'report.json')]});input.dispatchEvent(new Event('change',{bubbles:true}))
  })
  const load=async()=>act(async()=>{const r=readers.at(-1);r.result=new TextEncoder().encode(JSON.stringify(reportFixture())).buffer;r.onload?.();for(let i=0;i<8;i++)await Promise.resolve()})
  await select();await load();await start();expect(result()).not.toBeNull()
  await select();expect(result()).toBeNull();await load();expect(result()).toBeNull();await start()
  await click('[data-local-report-file] button');expect(result()).toBeNull();expect(host.querySelector('[data-local-file-result]')).toBeNull()
})
it('inventory comparison source declarations are rendered as text and never become instructions',async()=>{
  const file={...comparisonFile(),generatedAtUTC:'<img src=x onerror=PRIVATE>'}
  await render(file,comparisonLocal());await start();expect(result()).toBeNull();expect(host.textContent).not.toContain('PRIVATE');expect(host.querySelector('img')).toBeNull()
})
