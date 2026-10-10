import assert from 'node:assert/strict'
import { createLocalComparisonExport, COMPARISON_EXPORT_LIMIT } from '../src/services/s3LocalComparisonExport.mjs'
import { comparisonFile, comparisonLocal } from './s3-local-overview-comparison-cases.mjs'
const at = Date.UTC(2026, 9, 10, 12)
const create = () => createLocalComparisonExport(comparisonFile(), comparisonLocal())
export function comparisonHTMLRows(raw) {
  const body = raw.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]
  assert.equal(typeof body, 'string')
  return [...body.matchAll(/<tr data-metric="([^"]+)"><th scope="row">([^<]+)<\/th><td>(-?\d+)<\/td><td>(-?\d+)<\/td><td>([+-]?\d+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
    .map(m => ({ id: m[1], label: m[2], reference: Number(m[3]), local: Number(m[4]), delta: Number(m[5]), unit: m[6] }))
}
export function registerComparisonHTMLTests(test) {
  test('comparison HTML preserves all twelve metrics and signed values exactly like JSON', () => {
    const output = create(), html = output.prepare('html', at), json = JSON.parse(output.prepare('json', at).raw)
    assert.deepEqual(comparisonHTMLRows(html.raw), json.metrics)
    assert.equal(comparisonHTMLRows(html.raw).length, 12)
    assert.ok(comparisonHTMLRows(html.raw).some(r => r.delta > 0))
    assert.ok(comparisonHTMLRows(html.raw).some(r => r.delta < 0))
    assert.ok(comparisonHTMLRows(html.raw).some(r => r.delta === 0))
    assert.match(html.raw, /<td>\+2<\/td>/)
  })
  test('comparison HTML empty difference output retains all original zero rows', () => {
    const file = comparisonFile(), out = createLocalComparisonExport(file, file.summary).prepare('html', at)
    const rows = comparisonHTMLRows(out.raw)
    assert.equal(rows.length, 12); assert.ok(rows.every(r => r.delta === 0))
    assert.match(out.raw, /0 项数值不同/)
  })
  test('comparison HTML has a portable filename, correct MIME and an immutable receipt', () => {
    const html = create().prepare('html', at)
    assert.equal(html.filename, 'Local-Notepad-comparison-2026-10-10T12-00-00-000Z.html')
    assert.equal(html.mime, 'text/html;charset=utf-8'); assert.equal(html.format, 'html')
    assert.ok(Object.isFrozen(html)); assert.ok(Buffer.byteLength(html.raw) <= COMPARISON_EXPORT_LIMIT)
    assert.match(html.raw, /^<!doctype html>\n<html lang="zh-CN">/)
  })
  test('comparison HTML scope distinguishes generation, reference time, identity and freshness', () => {
    const raw = create().prepare('html', at).raw
    for (const text of ['不是盘点时间','未验证同一工作区','数值相同不代表内容相同','不是笔记备份或同步授权',
      '导出没有再次读取数据','差值 = 本次本地盘点 − 所选报告','不受界面差异筛选影响','指标个数不是发生变化的笔记数量']) assert.ok(raw.includes(text), text)
    assert.match(raw, /<time>2026-10-10T12:00:00\.000Z<\/time>/)
    assert.match(raw, /浏览器的打印功能/)
  })
  test('comparison HTML is self-contained and disallows scripts and external resources', () => {
    const raw = create().prepare('html', at).raw
    assert.match(raw, /http-equiv="Content-Security-Policy"/)
    assert.match(raw, /default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/)
    assert.doesNotMatch(raw, /<(script|iframe|object|embed|link|img|form|a)\b|\son\w+=|\b(?:src|href)=|@import|url\(/i)
    assert.doesNotMatch(raw, /https?:\/\//)
  })
  test('comparison HTML retains semantic headers, responsive overflow and print table structure', () => {
    const raw = create().prepare('html', at).raw
    assert.equal((raw.match(/scope="row"/g) || []).length, 12)
    assert.equal((raw.match(/scope="col"/g) || []).length, 5)
    assert.match(raw, /<caption>完整数量与容量比较/)
    assert.match(raw, /@media print/); assert.match(raw, /@media\(max-width:640px\)/)
    assert.match(raw, /thead\{display:table-header-group\}/); assert.match(raw, /break-inside:avoid/)
  })
  test('comparison HTML can represent maximum budget values without truncation', () => {
    const s = structuredClone(comparisonLocal())
    Object.assign(s,{records:256,record_bytes:2097152,attachment_bytes:67108864,base_items:128})
    s.kinds.forEach((k,i)=>Object.assign(k,{records:i===0||i===3?128:0,record_bytes:i===0||i===3?1048576:0}))
    const out = createLocalComparisonExport(comparisonFile(),s)
    const html = out.prepare('html', at)
    assert.deepEqual(comparisonHTMLRows(html.raw), JSON.parse(out.prepare('json', at).raw).metrics)
    assert.ok(Buffer.byteLength(html.raw) <= COMPARISON_EXPORT_LIMIT)
  })
  test('comparison HTML snapshots do not change when original inputs are mutated', () => {
    const file=structuredClone(comparisonFile()),local=structuredClone(comparisonLocal())
    const output=createLocalComparisonExport(file,local),old=output.prepare('html',at).raw
    file.summary.records=999;local.records=888;file.generatedAtUTC='<script>PRIVATE</script>'
    assert.equal(output.prepare('html',at).raw,old)
    assert.doesNotMatch(old, /PRIVATE|999|888/)
  })
  test('comparison HTML refuses untrusted extra fields, getters and inconsistent input', () => {
    const local=structuredClone(comparisonLocal());local.records++
    assert.throws(()=>createLocalComparisonExport(comparisonFile(),local))
    const file=structuredClone(comparisonFile());file.generatedAtUTC='<script>alert(1)</script>'
    assert.throws(()=>createLocalComparisonExport(file,comparisonLocal()))
    let touched=0;const other=structuredClone(comparisonLocal())
    Object.defineProperty(other,'body',{enumerable:true,get(){touched++;return 'PRIVATE'}})
    assert.throws(()=>createLocalComparisonExport(comparisonFile(),other));assert.equal(touched,0)
  })
  test('comparison HTML refuses invalid generation clocks and non-lowercase formats', () => {
    const output=create()
    for(const time of [NaN,Infinity,-1,1.5,null,'PRIVATE',253402300800000]) assert.throws(()=>output.prepare('html',time),/未导出部分数据/)
    for(const format of ['HTML','htm','PRIVATE']) assert.throws(()=>output.prepare(format,at),/未导出部分数据/)
  })
}
