import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const formats = ['json', 'csv', 'html']
const iso = value => {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.equal(new Date(value).toISOString(), value)
  return Date.parse(value)
}
const hash = raw => createHash('sha256').update(raw).digest('hex')
const csvCells = line => {
  const cells = []; let quoted = false, start = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') i++
      else quoted = !quoted
    } else if (line[i] === ',' && !quoted) { cells.push(line.slice(start, i)); start = i + 1 }
  }
  assert.equal(quoted, false); cells.push(line.slice(start))
  for (const cell of cells) assert.match(cell, /^(?:"(?:[^"]|"")*"|[^",\r\n]*)$/)
  return cells
}
const cellValue = cell => cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell
const metric = (key, label, a, b, delta, unit) => ({ key, label, a: Number(a), b: Number(b), delta: Number(delta), unit })

// Test-only evidence checking. Mask ONLY each format's export-generation slot.
// Source-declared times, metrics, notices, formatting and every other byte stay
// in the equality check. Retain the original raw hash separately for provenance.
export function inspectOfflinePairDownload({ format, raw, filename, startedAt, completedAt }) {
  assert.ok(formats.includes(format)); assert.ok(Buffer.isBuffer(raw))
  assert.ok(raw.length > 0 && raw.length <= 16384)
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)
  let generatedAtUTC, invariant, metrics
  if (format === 'json') {
    const data = JSON.parse(text)
    assert.equal(data.format, 'local-notepad-offline-pair-comparison')
    assert.equal(data.version, 1); assert.equal(data.scope, 'previously-confirmed-file-pair')
    assert.equal(data.direction, 'B-minus-A'); assert.equal(data.metricCount, 12); assert.equal(data.includesAllMetrics, true)
    for (const key of ['generationTimeIsObservationTime', 'sameWorkspaceVerified', 'contentEqualityVerified', 'completeForPreview']) assert.equal(data[key], false)
    for (const side of [data.reportA, data.reportB]) { assert.equal(side.source, 'untrusted-file'); iso(side.declaredGeneratedAtUTC) }
    const matches = [...text.matchAll(/^  "generatedAtUTC": "([^"\r\n]+)",$/gm)]
    assert.equal(matches.length, 1); generatedAtUTC = matches[0][1]
    assert.equal(data.generatedAtUTC, generatedAtUTC); metrics = data.metrics
    invariant = text.replace(matches[0][0], '  "generatedAtUTC": "<export-generation-time>",')
  } else if (format === 'csv') {
    assert.ok(text.startsWith('\uFEFF')); assert.ok(text.endsWith('\r\n'))
    const rows = text.slice(1, -2).split('\r\n').map(csvCells)
    assert.equal(rows.length, 13); assert.ok(rows.every(row => row.length === 11))
    assert.deepEqual(rows[0].map(cellValue), ['指标键', '指标', '单位', '报告 A', '报告 B', '差值 B − A', 'A声明生成时间UTC', 'B声明生成时间UTC', '导出时间UTC（不是盘点时间）', '同一工作区已验证', '范围说明'])
    generatedAtUTC = cellValue(rows[1][8]); metrics = []
    for (const row of rows.slice(1)) {
      const cells = row.map(cellValue)
      assert.equal(cells[8], generatedAtUTC); assert.equal(cells[9], 'false')
      iso(cells[6]); iso(cells[7])
      metrics.push(metric(cells[0], cells[1], cells[3], cells[4], cells[5], cells[2]))
      row[8] = '"<export-generation-time>"'
    }
    invariant = '\uFEFF' + rows.map(row => row.join(',')).join('\r\n') + '\r\n'
  } else {
    const matches = [...text.matchAll(/<dt>导出生成时间（UTC，不是盘点时间）<\/dt><dd><time>([^<]+)<\/time><\/dd>/g)]
    assert.equal(matches.length, 1); generatedAtUTC = matches[0][1]
    invariant = text.replace(matches[0][0], matches[0][0].replace(generatedAtUTC, '<export-generation-time>'))
    const rows = [...text.matchAll(/<tr data-offline-metric="([^"]+)"><th scope="row">([^<]+)<\/th><td>(\d+)<\/td><td>(\d+)<\/td><td>([+-]?\d+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
    assert.equal((text.match(/<tr data-offline-metric=/g) || []).length, 12)
    metrics = rows.map(m => metric(m[1], m[2], m[3], m[4], m[5], m[6]))
    assert.doesNotMatch(text, /<script\b|\s(?:src|href)=/i)
  }
  assert.equal(metrics.length, 12)
  for (const row of metrics) {
    assert.ok(Number.isSafeInteger(row.a) && row.a >= 0 && Number.isSafeInteger(row.b) && row.b >= 0)
    assert.ok(Number.isSafeInteger(row.delta)); assert.equal(row.delta, row.b - row.a)
    assert.ok(['项', 'B'].includes(row.unit))
  }
  const generatedAt = iso(generatedAtUTC)
  assert.ok(Number.isSafeInteger(startedAt) && Number.isSafeInteger(completedAt) && startedAt <= completedAt)
  assert.ok(generatedAt >= startedAt && generatedAt <= completedAt, 'Export time must belong to this download request')
  assert.equal(filename.split(/[\\/]/).at(-1), `Local-Notepad-offline-pair-${generatedAtUTC.replace(/[:.]/g, '-')}.${format}`)
  return { generatedAtUTC, invariant, metrics, rawSHA256: hash(raw), invariantSHA256: hash(invariant) }
}

export function verifyOfflinePairDownloadInvariance(before, after, expectedMetrics) {
  assert.deepEqual(before.map(file => file.format), formats)
  assert.deepEqual(after.map(file => file.format), formats)
  assert.equal(expectedMetrics.length, 12)
  return formats.map((format, i) => {
    const a = inspectOfflinePairDownload(before[i]), b = inspectOfflinePairDownload(after[i])
    assert.deepEqual(a.metrics, expectedMetrics); assert.deepEqual(b.metrics, expectedMetrics)
    assert.equal(b.invariant, a.invariant, 'Only the export-generation slot may differ')
    return { format, beforeGeneratedAtUTC: a.generatedAtUTC, afterGeneratedAtUTC: b.generatedAtUTC,
      beforeSHA256: a.rawSHA256, afterSHA256: b.rawSHA256, invariantSHA256: a.invariantSHA256 }
  })
}
