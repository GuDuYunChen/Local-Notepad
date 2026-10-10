import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Comparison from './S3LocalOverviewComparison.jsx'
import { comparisonFile, comparisonLocal } from '../../scripts/s3-local-overview-comparison-cases.mjs'
let host, root, blobs, clicked, oldCreate, oldRevoke
const flush = async () => { for(let i=0;i<6;i++) await Promise.resolve() }
const render = (report=comparisonFile(),localSummary=comparisonLocal()) => act(async()=>root.render(<StrictMode><Comparison report={report} localSummary={localSummary}/></StrictMode>))
const click = selector => act(async()=>{host.querySelector(selector).click();await flush()})
const start = () => click('[data-local-compare-start]')
const download = () => click('[data-local-compare-export="html"]')
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();blobs=[]
 oldCreate=Object.getOwnPropertyDescriptor(URL,'createObjectURL');oldRevoke=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL')
 Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(blob=>{blobs.push(blob);return 'blob:html-owned'})})
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})
 clicked=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{
 await act(async()=>root.unmount());host.remove();vi.runOnlyPendingTimers()
 for(const [key,old] of [['createObjectURL',oldCreate],['revokeObjectURL',oldRevoke]]){if(old)Object.defineProperty(URL,key,old);else delete URL[key]}
 vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()
})
it('comparison HTML UI requires an explicit valid comparison before offering export',async()=>{
 await render();expect(host.querySelector('[data-local-compare-export="html"]')).toBeNull();expect(clicked).not.toHaveBeenCalled()
 await start();expect(host.querySelector('[data-local-compare-export="html"]').textContent).toBe('导出完整比较（HTML）')
})
it('comparison HTML UI exports all twelve rows while the display is filtered',async()=>{
 await render();await start();await click('[data-local-compare-differences]');expect(host.querySelectorAll('tbody tr')).toHaveLength(6)
 await download();const doc=new DOMParser().parseFromString(await blobs[0].text(),'text/html')
 expect(doc.querySelectorAll('tbody tr')).toHaveLength(12);expect(doc.querySelectorAll('th[scope=col]')).toHaveLength(5)
 expect(doc.body.textContent).toContain('未验证同一工作区');expect(doc.querySelector('script')).toBeNull()
 expect(host.querySelector('[data-local-compare-export-status]').textContent).toContain('尚未确认落盘')
})
it('comparison HTML UI resets output after source A-B-A and clear',async()=>{
 const file=comparisonFile(),local=comparisonLocal();await render(file,local);await start();await download()
 await render(comparisonFile(),local);await render(file,local);expect(host.querySelector('[data-local-compare-export="html"]')).toBeNull()
 await start();await click('[data-local-compare-clear]');expect(host.querySelector('[data-local-compare-export="html"]')).toBeNull()
 expect(clicked).toHaveBeenCalledTimes(1)
})
it('comparison HTML UI export neither rereads nor persists workspace data',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch'),save=vi.spyOn(Storage.prototype,'setItem')
 await render();await start();await download();expect(fetch).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled()
 expect(blobs[0].type).toBe('text/html;charset=utf-8');expect(document.querySelector('a[download]')).toBeNull()
 await act(async()=>vi.advanceTimersByTime(1000));expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:html-owned')
})
it('comparison HTML UI download failure preserves confirmed values and hides private errors',async()=>{
 await render();await start();clicked.mockImplementation(()=>{throw Error('PRIVATE_DOWNLOAD')});await download()
 expect(host.querySelectorAll('tbody tr')).toHaveLength(12);expect(host.textContent).toContain('未能发起')
 expect(host.textContent).not.toContain('PRIVATE_DOWNLOAD')
})
it('comparison HTML UI uses a non-submit button with a linked scope description',async()=>{
 await render();await start();const button=host.querySelector('[data-local-compare-export="html"]')
 expect(button.type).toBe('button');expect(document.getElementById(button.getAttribute('aria-describedby')).textContent).toContain('HTML 文件可离线阅读')
})
