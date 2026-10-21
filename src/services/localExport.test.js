import { describe, expect, it, vi } from 'vitest'
import { exportResult, localExportBridge, localExportRequest, validateExportPlan, validateExportSelection } from './localExport.mjs'

const plan = () => ({
  planId: 'plan-1', requestId: 'request-1', format: 'markdown', source: 'saved', phase: 'prepared', state: 'prepared', busy: false,
  destination: '', canStart: false, canRetry: false, canReveal: false,
  items: [{ id: 'note-1', title: '笔记', relativePath: '笔记.md', preview: '已保存正文', status: 'ready', message: '', warnings: [] }],
  counts: { total: 1, ready: 1, running: 0, succeeded: 0, failed: 0, cancelled: 0 },
})
const success = () => {
  const value = plan(); value.phase = 'settled'; value.state = 'completed'; value.destination = 'C:\\Exports'
  value.items[0] = { ...value.items[0], status: 'succeeded', outputPath: 'C:\\Exports\\batch\\笔记.md', bytes: 15, sha256: 'a'.repeat(64) }
  value.counts.ready = 0; value.counts.succeeded = 1
  return value
}

describe('local export response and selection boundaries', () => {
  it('accepts complete preview and independently confirmed receipt', () => {
    expect(validateExportPlan(plan()).source).toBe('saved')
    expect(validateExportPlan(success(), { previous: plan() }).counts.succeeded).toBe(1)
  })
  it.each([
    ['different plan', value => { value.planId = 'other' }],
    ['different format', value => { value.format = 'docx' }],
    ['wrong source', value => { value.source = 'draft' }],
    ['busy without active phase', value => { value.busy = true }],
    ['unknown state', value => { value.state = 'success' }],
    ['missing capabilities', value => { delete value.canStart }],
    ['wrong count', value => { value.counts.ready = 2 }],
    ['duplicate identities', value => { value.items.push({ ...value.items[0] }); value.counts.total = 2; value.counts.ready = 2 }],
    ['missing preview', value => { delete value.items[0].preview }],
    ['unknown status', value => { value.items[0].status = 'written' }],
    ['invalid warnings', value => { value.items[0].warnings = 'ignored' }],
    ['extra item', value => { value.items.push({ ...value.items[0], id: 'note-2' }); value.counts.total = 2; value.counts.ready = 2 }],
  ])('rejects %s before adopting a response', (_name, change) => {
    const value = plan(); change(value)
    expect(() => validateExportPlan(value, { planId: 'plan-1', format: 'markdown', previous: plan() })).toThrow(/回执/)
  })
  it.each(['outputPath', 'bytes', 'sha256'])('requires %s on a succeeded file', field => {
    const value = success(); delete value.items[0][field]
    expect(() => validateExportPlan(value)).toThrow(/回执/)
  })
  it.each(['title', 'relativePath', 'preview', 'outputPath', 'bytes', 'sha256'])('does not replace a confirmed success with changed %s', field => {
    const old = success(), next = success()
    next.items[0][field] = field === 'bytes' ? 16 : field === 'sha256' ? 'b'.repeat(64) : 'changed'
    expect(() => validateExportPlan(next, { previous: old })).toThrow(/回执/)
  })
  it('does not downgrade an already succeeded file for retry', () => {
    expect(() => validateExportPlan(plan(), { previous: success() })).toThrow(/回执/)
  })
  it.each([[], ['a', 'a'], [''], [null], Array.from({ length: 101 }, (_, index) => String(index))])('rejects invalid selected identities %j', ids => {
    expect(() => validateExportSelection(ids)).toThrow(/请选择/)
  })
  it('copies a valid selection without mutating caller state', () => {
    const ids = ['a', 'b']; expect(validateExportSelection(ids)).toEqual(ids); expect(validateExportSelection(ids)).not.toBe(ids)
  })
  it('does not expose an incomplete desktop bridge', () => {
    expect(localExportBridge({ exportWorkspacePrepare: () => {} })).toBeNull()
    expect(localExportBridge(null)).toBeNull()
  })
  it('preserves an explicit native failure and rejects a falsely successful reply', () => {
    expect(() => exportResult({ success: false, message: '未取得目录授权' })).toThrow('未取得目录授权')
    expect(() => exportResult({ success: true })).toThrow(/回执/)
  })
  it('bounds an unanswered request without reporting success', async () => {
    vi.useFakeTimers()
    try {
      const promise = localExportRequest(() => new Promise(() => {}), 100)
      const result = expect(promise).rejects.toThrow(/超时/)
      await vi.advanceTimersByTimeAsync(100); await result
    } finally { vi.useRealTimers() }
  })
})
