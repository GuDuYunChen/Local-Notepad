import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Comparison from './S3LocalOverviewComparison.jsx'
import { comparisonFile, comparisonLocal } from '../../scripts/s3-local-overview-comparison-cases.mjs'
let root, host
const render = (report, localSummary) => act(async () => root.render(<StrictMode><Comparison report={report} localSummary={localSummary}/></StrictMode>))
const click = selector => act(async () => host.querySelector(selector).click())
const start = () => click('[data-local-compare-start]')
const toggle = () => click('[data-local-compare-differences]')
const rows = () => [...host.querySelectorAll('[data-local-compare-result] tbody tr')].map(r => [...r.cells].map(c => c.textContent))
const filtered = () => host.querySelector('[data-local-compare-differences]')?.getAttribute('aria-pressed')
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('comparison difference controls appear only after explicit successful comparison', async () => {
  await render(comparisonFile(), comparisonLocal()); expect(filtered()).toBeUndefined(); await start()
  expect(filtered()).toBe('false'); expect(rows()).toHaveLength(12)
})
it('comparison difference filter shows both signed directions and can restore exact original rows', async () => {
  await render(comparisonFile(), comparisonLocal()); await start(); const original = rows(); await toggle()
  expect(filtered()).toBe('true'); expect(rows()).toEqual(original.filter(row => !/^0 /.test(row[3])))
  expect(rows()).toHaveLength(6); expect(rows().some(row => row[3].startsWith('-'))).toBe(true)
  expect(host.querySelector('[data-local-compare-metrics]').textContent).toContain('6 个数值不同')
  await toggle(); expect(rows()).toEqual(original); expect(filtered()).toBe('false')
})
it('comparison zero-difference view is explicit and never claims identical content', async () => {
  const file = comparisonFile(); await render(file, file.summary); await start(); await toggle()
  expect(rows()).toHaveLength(0); expect(host.querySelector('[data-local-compare-empty]').textContent).toContain('不代表笔记或附件内容相同')
  expect(host.textContent).toContain('0 个数值不同'); await toggle(); expect(rows()).toHaveLength(12)
})
it('comparison difference filter survives unchanged renders but resets after source A-B-A', async () => {
  const file = comparisonFile(), local = comparisonLocal(); await render(file,local); await start(); await toggle()
  await render(file,local); expect(filtered()).toBe('true')
  await render(comparisonFile(),local); await render(file,local); expect(filtered()).toBeUndefined()
  await start(); expect(filtered()).toBe('false'); expect(rows()).toHaveLength(12)
})
it('comparison difference filter cannot revive consent after reread, clear or remount', async () => {
  const file = comparisonFile(), local = comparisonLocal(); await render(file,local); await start(); await toggle()
  await render(file,null); expect(filtered()).toBeUndefined(); await render(file,local); expect(rows()).toHaveLength(0)
  await start(); expect(filtered()).toBe('false'); await toggle(); await click('[data-local-compare-clear]'); expect(filtered()).toBeUndefined()
  await start(); expect(filtered()).toBe('false'); await act(async()=>root.render(null)); await render(file,local); expect(filtered()).toBeUndefined()
})
it('comparison difference filter toggles no network, storage or clipboard operation', async () => {
  const fetch = vi.spyOn(globalThis,'fetch'), store = vi.spyOn(Storage.prototype,'setItem')
  await render(comparisonFile(),comparisonLocal()); await start(); await toggle(); await toggle()
  expect(fetch).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled()
})
it('comparison difference filter has a stable accessible name, pressed state and metric explanation', async () => {
  await render(comparisonFile(),comparisonLocal()); await start(); const button = host.querySelector('[data-local-compare-differences]')
  expect(button.type).toBe('button'); expect(button.textContent).toBe('仅看有差异的指标'); await toggle()
  expect(button.textContent).toBe('仅看有差异的指标'); expect(button.getAttribute('aria-pressed')).toBe('true')
  const text = document.getElementById(button.getAttribute('aria-describedby')).textContent
  expect(text).toContain('指标个数不是发生变化的笔记数量')
})
it('comparison difference filter never offers rows after malformed observations', async () => {
  const local = structuredClone(comparisonLocal()); local.records++
  await render(comparisonFile(),local); await start(); expect(filtered()).toBeUndefined(); expect(rows()).toHaveLength(0)
  expect(host.querySelector('[data-local-compare-state]').dataset.localCompareState).toBe('failed')
})
it('comparison difference filter keeps category changes when the aggregate counts cancel', async () => {
  const file = comparisonFile(), local = structuredClone(file.summary)
  local.kinds[0].records=2; local.kinds[0].record_bytes=110; local.kinds[3].records=0; local.kinds[3].record_bytes=0; local.attachment_bytes=0
  await render(file,local); await start(); await toggle(); expect(rows()).toHaveLength(5)
  expect(rows().some(row=>row[0]==='记录合计')).toBe(false)
  expect(rows().some(row=>row[0].includes('附件 · 数量') && row[3]==='-1 项')).toBe(true)
})
