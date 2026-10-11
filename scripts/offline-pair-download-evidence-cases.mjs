import assert from 'node:assert/strict'
import { inspectOfflinePairDownload, verifyOfflinePairDownloadInvariance } from './offline-pair-download-evidence.mjs'

const formats = ['json', 'csv', 'html'], oldTime = '2026-10-01T00:00:00.000Z'
const first = '2026-10-11T01:02:03.000Z', second = '2026-10-11T01:02:04.000Z'
const metrics = Array.from({ length: 12 }, (_, i) => ({ key: `m${i}`, label: `Metric ${i}`,
  a: i + 1, b: i, delta: -1, unit: i % 2 ? 'B' : '项' }))
const quote = value => typeof value === 'number' ? String(value) : `"${value.replace(/"/g, '""')}"`
function sample(format, time = first) {
  const data = { format: 'local-notepad-offline-pair-comparison', version: 1,
    scope: 'previously-confirmed-file-pair', direction: 'B-minus-A', generatedAtUTC: time,
    generationTimeIsObservationTime: false, sameWorkspaceVerified: false, contentEqualityVerified: false,
    completeForPreview: false, includesAllMetrics: true, metricCount: 12,
    reportA: { source: 'untrusted-file', declaredGeneratedAtUTC: oldTime },
    reportB: { source: 'untrusted-file', declaredGeneratedAtUTC: oldTime }, notice: 'fixed, "notice"', metrics }
  const text = format === 'json' ? JSON.stringify(data, null, 2) + '\n' : format === 'csv' ? '\uFEFF' + [
    ['指标键', '指标', '单位', '报告 A', '报告 B', '差值 B − A', 'A声明生成时间UTC', 'B声明生成时间UTC', '导出时间UTC（不是盘点时间）', '同一工作区已验证', '范围说明'],
    ...metrics.map(r => [r.key, r.label, r.unit, r.a, r.b, r.delta, oldTime, oldTime, time, 'false', data.notice]),
  ].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n' :
    `<dl><dt>报告 A 声明生成时间（UTC）</dt><dd><time>${oldTime}</time></dd><dt>报告 B 声明生成时间（UTC）</dt><dd><time>${oldTime}</time></dd><dt>导出生成时间（UTC，不是盘点时间）</dt><dd><time>${time}</time></dd></dl><p>fixed notice</p>` +
    metrics.map(r => `<tr data-offline-metric="${r.key}"><th scope="row">${r.label}</th><td>${r.a}</td><td>${r.b}</td><td>${r.delta}</td><td>${r.unit}</td></tr>`).join('\n')
  return { format, raw: Buffer.from(text), filename: `Local-Notepad-offline-pair-${time.replace(/[:.]/g, '-')}.${format}`,
    startedAt: Date.parse(time) - 10, completedAt: Date.parse(time) + 10 }
}
const all = time => formats.map(format => sample(format, time))
const mutate = (file, from, to) => ({ ...file, raw: Buffer.from(file.raw.toString('utf8').replace(from, to)) })
export function registerOfflineDownloadEvidenceTests(test) {
  test('download evidence accepts six exports with fresh generation times only', () => {
    const proof = verifyOfflinePairDownloadInvariance(all(first), all(second), metrics)
    assert.equal(proof.length, 3); assert.ok(proof.every(p => p.beforeSHA256 !== p.afterSHA256))
  })
  test('download evidence accepts equal times without inventing a mandatory clock advance', () => {
    assert.equal(verifyOfflinePairDownloadInvariance(all(first), all(first), metrics).length, 3)
  })
  for (const format of formats) {
    test(`download evidence ${format} rejects a changed metric label`, () => {
      const after = all(second); after[formats.indexOf(format)] = mutate(sample(format, second), 'Metric 0', 'Changed 0')
      assert.throws(() => verifyOfflinePairDownloadInvariance(all(first), after, metrics))
    })
    test(`download evidence ${format} rejects a changed source-declared time`, () => {
      const after = all(second); after[formats.indexOf(format)] = mutate(sample(format, second), oldTime, '2026-10-02T00:00:00.000Z')
      assert.throws(() => verifyOfflinePairDownloadInvariance(all(first), after, metrics))
    })
    test(`download evidence ${format} rejects changed non-metric notice bytes`, () => {
      const after = all(second); after[formats.indexOf(format)] = mutate(sample(format, second), 'fixed', 'altered')
      assert.throws(() => verifyOfflinePairDownloadInvariance(all(first), after, metrics))
    })
    test(`download evidence ${format} binds generation time to the filename and request`, () => {
      assert.throws(() => inspectOfflinePairDownload({ ...sample(format), filename: 'renamed.' + format }))
      assert.throws(() => inspectOfflinePairDownload({ ...sample(format), startedAt: Date.parse(second), completedAt: Date.parse(second) }))
    })
    test(`download evidence ${format} never ignores malformed export timestamps`, () => {
      assert.throws(() => inspectOfflinePairDownload(mutate(sample(format), first, 'not-a-time')))
    })
  }
  test('download evidence rejects duplicate JSON generation fields', () => {
    const file = sample('json'), line = `  "generatedAtUTC": "${first}",`
    assert.throws(() => inspectOfflinePairDownload(mutate(file, line, line + '\n' + line)))
  })
  test('download evidence rejects inconsistent repeated CSV export times', () => {
    assert.throws(() => inspectOfflinePairDownload(mutate(sample('csv'), first, second)))
  })
  test('download evidence rejects missing format coverage and metric count', () => {
    assert.throws(() => verifyOfflinePairDownloadInvariance(all(first).slice(1), all(second), metrics))
    assert.throws(() => verifyOfflinePairDownloadInvariance(all(first), all(second), metrics.slice(1)))
  })
  test('download evidence rejects valid arithmetic with altered actual numbers', () => {
    const file = sample('json'), data = JSON.parse(file.raw)
    data.metrics[0] = { ...data.metrics[0], a: 10, b: 9 }
    const after = all(second); after[0] = { ...file, raw: Buffer.from(JSON.stringify(data, null, 2) + '\n') }
    assert.throws(() => verifyOfflinePairDownloadInvariance(all(first), after, metrics))
  })
  test('download evidence rejects invalid UTF8 and oversized files before comparison', () => {
    assert.throws(() => inspectOfflinePairDownload({ ...sample('json'), raw: Buffer.from([0xff]) }))
    assert.throws(() => inspectOfflinePairDownload({ ...sample('json'), raw: Buffer.alloc(16385) }))
  })
}
