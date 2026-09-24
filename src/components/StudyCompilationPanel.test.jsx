import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import CollectionStudyHub from './CollectionStudyHub'
import { createCollectionStudyHub } from '../services/collectionStudyHub'
import { createCollectionStudyStore } from '../services/collectionStudy'
import { createSearchCollectionStore } from '../services/searchCollections'
import { collectionReport, memoryStorage } from '../test/collectionFixtures'
import { api } from '../services/api'
import { downloadCollectionReviewReport } from '../services/collectionReviewReport'
vi.mock('../services/api', () => ({ api: vi.fn() }))
vi.mock('../services/collectionReviewReport', async original => ({ ...await original(), downloadCollectionReviewReport: vi.fn() }))
let host, root, source, study, hub, entry, onReceipt
const button = name => [...host.querySelectorAll('button')].find(el => el.textContent === name)
const label = name => host.querySelector(`[aria-label="${name}"]`)
const click = name => act(async () => { expect(button(name)).toBeTruthy(); button(name).click() })
const render = props => act(async () => root.render(<CollectionStudyHub active sourceStore={source} studyStore={study} service={hub} onCompilationReceipt={onReceipt} {...props} />))
async function change(name, value) { await act(async () => { const el = label(name); const type = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }) }
async function seed(number = 1) { for (let i = 0; i < number; i++) await study.saveNote(await study.load(entry, source), 'n' + i, 'revisit', '批注原文 ' + i + '\n😀', { sourceStore: source }) }
async function prepare() { await click('选择本页批注'); await click('预览所选批注研究笔记') }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', { randomUUID, subtle: { digest: async (_alg, bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer } })
  const storage = memoryStorage(); source = createSearchCollectionStore({ storage: () => storage, createId: () => 'fixture' })
  source.save('资料', collectionReport(23)); entry = source.list().entries[0]
  study = createCollectionStudyStore({ storage: () => storage, locks: () => ({ request: (_n, _o, fn) => Promise.resolve().then(fn) }) })
  hub = createCollectionStudyHub({ storage: () => storage, sourceStore: source, studyStore: study }); onReceipt = vi.fn()
  api.mockReset().mockImplementation(async (_url, init) => ({ id: 'research', ...JSON.parse(init.body) }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('creates only after explicit preview and confirm', async () => {
  await seed(); await render(); await prepare()
  expect(label('研究笔记完整预览')).toBeTruthy(); expect(api).not.toHaveBeenCalled()
  await click('确认创建独立研究笔记')
  expect(api).toHaveBeenCalledTimes(1); expect(onReceipt).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'confirmed', id: 'research' }))
  expect(button('确认创建独立研究笔记').disabled).toBe(true)
})
it('previews every selected page, not just the last page', async () => {
  await seed(23); await render(); await click('选择本页批注'); await click('批注下一页'); await click('选择本页批注'); await click('预览所选批注研究笔记')
  expect(label('研究笔记完整预览').textContent).toContain('23 条已存批注'); expect(label('研究笔记完整预览').textContent).toContain('批注原文 22')
})
it('editing the title, goal or grouping clears a previously approved preview', async () => {
  await seed(); await render(); await prepare(); await change('研究笔记名称', '新的名称'); expect(label('研究笔记完整预览')).toBeNull()
  await click('预览所选批注研究笔记'); await change('研究目标', '新目标'); expect(label('研究笔记完整预览')).toBeNull()
})
it('changing selection or reading filter invalidates the preview', async () => {
  await seed(2); await render(); await prepare(); await change('阅读工作台状态筛选', 'read'); expect(label('研究笔记完整预览')).toBeNull()
})
it('uses actual destination ID and verifies it before creating', async () => {
  await seed(); await render({ folders: [{ id: 'folder', label: '项目 / 研究' }] }); await change('研究笔记存放目录', 'folder'); await prepare()
  api.mockResolvedValueOnce({ id: 'folder', is_folder: true }); await click('确认创建独立研究笔记')
  expect(api.mock.calls[0][0]).toBe('/api/files/folder'); expect(JSON.parse(api.mock.calls[1][1].body).parent_id).toBe('folder')
})
it('download uses the complete preview and does not create or modify a note', async () => {
  await seed(2); await render(); await prepare(); await click('下载研究笔记 Markdown')
  expect(downloadCollectionReviewReport.mock.calls[0][0].text).toContain('批注原文 1'); expect(api).not.toHaveBeenCalled()
})
it('hostile-looking user text remains ordinary text in the preview', async () => {
  await study.saveNote(await study.load(entry, source), 'n0', 'read', '<img src=x onerror=alert(1)>', { sourceStore: source })
  await render(); await prepare(); expect(label('研究笔记完整预览').querySelectorAll('img,script')).toHaveLength(0)
  expect(label('研究笔记完整预览').textContent).toContain('<img src=x')
})
it('failed POST is reported as uncertain and disables replay while keeping the preview', async () => {
  await seed(); await render(); await prepare(); api.mockRejectedValueOnce(new Error('网络断开')); await click('确认创建独立研究笔记')
  expect(host.textContent).toContain('可能已经写入'); expect(button('确认创建独立研究笔记').disabled).toBe(true)
  expect(label('研究笔记完整预览')).toBeTruthy(); await click('下载研究笔记 Markdown'); expect(api).toHaveBeenCalledTimes(1)
})
it('new source storage changes make confirmation unavailable until refreshed', async () => {
  await seed(); await render(); await prepare(); await act(async () => seed(2))
  expect(button('确认创建独立研究笔记')?.disabled ?? !label('研究笔记完整预览')).toBeTruthy(); expect(api).not.toHaveBeenCalled()
})
it('invalid selection shows an actionable error without silently excluding empty notes', async () => {
  await render(); await act(async () => host.querySelector('.study-hub-check input').click()); await prepare()
  expect(host.textContent).toContain('没有已存批注'); expect(label('研究笔记完整预览')).toBeNull()
})
it('late preparation after tab switch cannot show an obsolete preview', async () => {
  await seed(); await render(); await click('选择本页批注')
  const original = study.load; let resolve
  vi.spyOn(study, 'load').mockImplementationOnce((...args) => new Promise(done => { resolve = () => original(...args).then(done) }))
  await click('预览所选批注研究笔记'); await render({ active: false }); await act(async () => resolve())
  expect(label('研究笔记完整预览')).toBeNull(); expect(api).not.toHaveBeenCalled()
})
it('receipt observer failure does not turn a successful creation into failure', async () => {
  onReceipt.mockImplementation(() => { throw new Error('view failed') }); await seed(); await render(); await prepare(); await click('确认创建独立研究笔记')
  expect(host.textContent).toContain('独立研究笔记已创建'); expect(api).toHaveBeenCalledTimes(1)
})
