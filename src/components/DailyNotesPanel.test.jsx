import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import DailyNotesPanel from './DailyNotesPanel'
import { api } from '~/services/api'
import { createDailyWorkspace } from '../services/dailyNotes.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
const note = patch => ({ id: 'original', title: '2026-10-13', content: 'original-body', parent_id: '', is_folder: false, is_deleted: false, updated_at: 20, ...patch })
let root, host, session, selected, records, mode, release
const flush = async () => act(async () => { for (let n = 0; n < 20; n++) await Promise.resolve() })
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; api.mockReset(); selected = vi.fn(); records = []; mode = ''; release = null
  api.mockImplementation(async (path, init = {}) => {
    if (path.startsWith('/api/files?')) { if (mode === 'index-error') throw Error('private detail'); return records }
    const date = path.split('/').at(-1).split('?')[0], found = records.find(f => f.title === date && f.parent_id === '' && !f.is_deleted) || null
    if (init.method === 'POST') {
      if (mode === 'hang-create') return new Promise(resolve => { release = () => resolve({ file: note({ title: date }), created: true }) })
      if (!found) records.push(note({ id: 'new', title: date, content: '' }))
      if (mode === 'lost-reply') throw Error('reply lost after commit')
      return { file: found || records.at(-1), created: !found }
    }
    if (mode === 'hang-read') return new Promise(resolve => { release = () => resolve({ file: null, created: false }) })
    return { file: found, created: false }
  })
  session = createDailyWorkspace(api); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { session.cancel(); root.unmount() }); host.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
async function mount() { await act(async () => root.render(<React.StrictMode><DailyNotesPanel session={session} onSelectFile={selected} onClose={() => root.render(null)} /></React.StrictMode>)); await flush() }
const button = text => [...host.querySelectorAll('button')].find(n => n.textContent === text)
async function click(text) { const element = button(text); expect(element, text).toBeTruthy(); await act(async () => element.click()); await flush() }
async function input(label, value) { const element = host.querySelector(`input[aria-label="${label}"]`); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) }); await flush() }
async function day(date = '2026-10-13') {
  await input('跳转日期', date); await click('查看日期')
  const element = host.querySelector(`.calendar-day[aria-label^="${date}"]`); expect(element).toBeTruthy(); await act(async () => element.click()); await flush()
}
test('empty list is shown only after successful reading and does not create today', async () => { await mount(); expect(host.textContent).toContain('还没有每日笔记'); expect(api.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false) })
test('metadata read error stays distinct from empty and explicit retry recovers', async () => {
  mode = 'index-error'; await mount(); expect(host.textContent).toContain('读取每日笔记失败'); expect(host.textContent).not.toContain('还没有每日笔记'); expect(host.textContent).not.toContain('private detail')
  mode = ''; await click('重试读取每日笔记'); expect(host.textContent).toContain('还没有每日笔记')
})
test('new day is created once and handed to original editor with complete content', async () => { await mount(); await day(); expect(selected).toHaveBeenCalledTimes(1); expect(selected.mock.calls[0][0].content).toBe(''); expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1) })
test('existing root note is reread without creation or overwriting body', async () => { records = [note()]; await mount(); await day(); expect(selected).toHaveBeenCalledWith(records[0]); expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0) })
test('nested date notes are not root daily records and root folders block creation', async () => {
  records = [note({ id: 'nested', parent_id: 'folder' }), note({ id: 'folder', is_folder: true })]; await mount(); expect(host.querySelector('.daily-note-item')).toBeNull(); await day()
  expect(host.textContent).toContain('同名文件夹'); expect(selected).not.toHaveBeenCalled(); expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0)
})
test('all dates are accessible through pagination, literal date search and clear', async () => {
  records = Array.from({ length: 31 }, (_, n) => note({ id: String(n), title: '2026-10-' + String(n + 1).padStart(2, '0') })); await mount()
  expect(host.querySelectorAll('.daily-note-item')).toHaveLength(14); await click('下一页'); expect(host.textContent).toContain('2 / 3')
  await input('查找每日笔记', '2026-10-31'); expect(host.querySelectorAll('.daily-note-item')).toHaveLength(1)
  await input('查找每日笔记', '2030'); await click('清除查找'); expect(host.querySelectorAll('.daily-note-item')).toHaveLength(14)
})
test('stop during preflight prevents late creation and re-enables the calendar', async () => {
  mode = 'hang-read'; await mount(); await day(); expect(host.querySelectorAll('.calendar-day[aria-label]:enabled')).toHaveLength(0)
  await click('停止等待'); await act(async () => release()); await flush(); expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0); expect(selected).not.toHaveBeenCalled()
})
test('closing after dispatch preserves uncertain date and rejects late navigation across remount', async () => {
  mode = 'hang-create'; await mount(); await day(); await act(async () => root.render(null)); await act(async () => release()); await flush()
  expect(selected).not.toHaveBeenCalled(); mode = ''; await mount(); expect(host.textContent).toContain('待核对日期（1）')
})
test('lost creation reply is reconciled via read-only endpoint without another POST', async () => {
  mode = 'lost-reply'; await mount(); await day(); expect(host.textContent).toContain('创建结果未确认'); mode = ''; await click('核对并打开记录')
  expect(selected).toHaveBeenCalledTimes(1); expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
})
test('uncertain-create confirmation can be cancelled without a repeated request', async () => {
  mode = 'lost-reply'; await mount(); await day(); await click('重新创建该日记录…'); expect(host.querySelector('[role=dialog]')).toBeTruthy(); await click('取消')
  expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
})
test('editor handoff failure explains that the note exists and does not retry creation', async () => {
  selected.mockImplementation(() => { throw Error('editor failed') }); await mount(); await day(); expect(host.textContent).toContain('编辑器未能打开'); expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
})
test('unconfirmed capacity refusal is visible and never silently creates', async () => {
  session.open = vi.fn(async () => { throw Object.assign(Error('full'), { code: 'unconfirmed-limit' }) })
  await mount(); await day(); expect(host.textContent).toContain('待核对日期已达到'); expect(selected).not.toHaveBeenCalled()
  expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0)
})
