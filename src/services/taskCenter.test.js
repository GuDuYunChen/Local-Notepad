import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { validateTaskCenter, filterTasks, readTaskCenter, readTaskSource, taskCenterReport, downloadTaskCenter } from './taskCenter.mjs'
import { taskCenterFixture as fixture, taskFixtureBody } from '../test/taskCenterFixture.mjs'
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('complete saved task snapshot', () => {
  it('accepts empty and complete lists without mutating or retaining response objects', () => {
    for (const count of [0, 1, 60]) { const raw = fixture(count), result = validateTaskCenter(raw); expect(result.items).toHaveLength(count); expect(Object.isFrozen(result.items)).toBe(true); raw.notes[0].title = 'mutated'; expect(result.notes[0].title).toBe('待办源笔记') }
  })
  it.each([
    r => { r.complete = false }, r => { r.version = 2 }, r => { r.revision = 'invalid' }, r => { r.captured_at = -1 },
    r => { r.totals.tasks++ }, r => { r.totals.pending-- }, r => { r.totals.done++ }, r => { r.totals.with_tasks = 0 },
    r => { r.totals.unsupported = 1 }, r => { r.totals.trash = 20000 }, r => { r.notes[0].content_hash = '' },
    r => { r.notes.push({ ...r.notes[0] }) }, r => { r.items[0].note_id = 'unknown' }, r => { r.items[0].ordinal = 2 },
    r => { r.items[0].done = 'false' }, r => { r.items[0].format = 'unknown' }, r => { r.items[0].line = 0 },
    r => { r.items[0].block_id = 'b-' + 'a'.repeat(32) }, r => { r.items[0].text = '😀'.repeat(1025) },
    r => { r.items[0].truncated = 1 }, r => { r.items[0].format = 'lexical' },
  ])('refuses partial or conflicting shape %#', mutate => { const raw = fixture(2); mutate(raw); expect(() => validateTaskCenter(raw)).toThrow(/不完整|矛盾/) })
  it('recognizes explicit supported and unsupported sources independently of task count', () => { const raw = fixture(0); raw.notes[0].supported = false; raw.totals.unsupported = 1; expect(validateTaskCenter(raw).totals.unsupported).toBe(1) })
  it('filters by text, title and checkbox state with stable ordering', () => {
    const raw = fixture(3); raw.items[1].done = true; raw.totals.pending--; raw.totals.done++
    const s = validateTaskCenter(raw)
    expect(filterTasks(s).map(t => t.ordinal)).toEqual([1, 3]); expect(filterTasks(s, { filter: 'done' }).map(t => t.ordinal)).toEqual([2])
    expect(filterTasks(s, { query: '任务 3' })).toHaveLength(1); expect(filterTasks(s, { query: '源笔记', filter: 'all' })).toHaveLength(3)
    expect(filterTasks(s, { filter: 'all', sort: 'status' }).map(t => t.ordinal)).toEqual([1, 3, 2]); expect(() => filterTasks(s, { filter: 'bogus' })).toThrow()
  })
  it('binds a readonly request and refuses a cancelled late response', async () => {
    const load = vi.fn(async () => fixture(1)), ctl = new AbortController(); await readTaskCenter(load, ctl.signal)
    expect(load.mock.calls[0][0]).toBe('/api/task-center'); expect(load.mock.calls[0][1].method).toBeUndefined()
    const p = readTaskCenter(async () => { ctl.abort(); return fixture(1) }, ctl.signal); await expect(p).rejects.toThrow()
  })
  it('times out a hung read without retrying', async () => { vi.useFakeTimers(); const load = vi.fn(() => new Promise(() => {})); const p = readTaskCenter(load, undefined, 20); const rejected = expect(p).rejects.toThrow(); await vi.advanceTimersByTimeAsync(21); await rejected; expect(load).toHaveBeenCalledTimes(1) })
})
describe('source navigation uses fresh saved content and the original guard', () => {
  it('reads the exact source and verifies its bytes without saving anything', async () => {
    vi.stubGlobal('crypto', webcrypto); const s = fixture(2), file = { id: 'task-source', title: '待办源笔记', content: taskFixtureBody(2) }, load = vi.fn(async () => file)
    expect(await readTaskSource(load, s.notes[0])).toBe(file); expect(load.mock.calls[0][0]).toBe('/api/files/task-source'); expect(load.mock.calls[0][1].method).toBeUndefined()
  })
  it.each(['content', 'title', 'is_deleted', 'is_folder', 'id'])('refuses changed %s rather than opening a cached source', async field => {
    vi.stubGlobal('crypto', webcrypto); const s = fixture(1), file = { id: 'task-source', title: '待办源笔记', content: taskFixtureBody(1), [field]: field.startsWith('is_') ? true : 'changed' }
    await expect(readTaskSource(async () => file, s.notes[0])).rejects.toMatchObject({ code: 'STALE_TASK_SOURCE' })
  })
  it('does not adopt a fresh file after cancellation', async () => { vi.stubGlobal('crypto', webcrypto); const ctl = new AbortController(); ctl.abort(); await expect(readTaskSource(async () => ({ id: 'task-source', title: '待办源笔记', content: taskFixtureBody(1) }), fixture(1).notes[0], ctl.signal)).rejects.toThrow() })
})
describe('explicit privacy-tiered export', () => {
  it('omits task text, title, IDs and query by default and includes only selected details after explicit opt-in', () => {
    const s = fixture(3), options = { query: '任务 2', filter: 'pending', sort: 'title' }
    const summary = taskCenterReport(s, options); for (const text of ['待办源笔记', 'task-source', '任务 2']) expect(summary).not.toContain(text)
    expect(JSON.parse(summary).selection).toMatchObject({ count: 1, query_omitted: true }); expect(JSON.parse(taskCenterReport(s, options, 'true')).tasks).toBeUndefined()
    const detailed = JSON.parse(taskCenterReport(s, options, true)); expect(detailed.tasks).toHaveLength(1); expect(detailed.tasks[0]).toMatchObject({ ordinal: 2, title: '待办源笔记' })
  })
  it('downloads a JSON file and always revokes its object URL', async () => {
    vi.useFakeTimers(); const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tasks'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let download; vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { download = this.download })
    downloadTaskCenter(fixture(1), { filter: 'all' }, true); expect(download).toBe('local-notepad-tasks.json'); expect(create).toHaveBeenCalledTimes(1); expect(document.querySelector('a[download]')).toBeNull(); await vi.advanceTimersByTimeAsync(1000); expect(revoke).toHaveBeenCalledWith('blob:tasks')
  })
  it('cleans up when the download click fails and does not claim a saved file', async () => { vi.useFakeTimers(); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed'); const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw Error('denied') }); expect(() => downloadTaskCenter(fixture(1), {})).toThrow('denied'); expect(document.querySelector('a[download]')).toBeNull(); await vi.advanceTimersByTimeAsync(1000); expect(revoke).toHaveBeenCalledWith('blob:failed') })
})
