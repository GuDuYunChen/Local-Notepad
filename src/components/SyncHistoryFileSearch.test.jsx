import { setUiValue, uiQuery, uiQueryAll, uiText, uiValue } from "~/test/uiControlDriver";import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import Viewer from './SyncHistoryFileViewer';
import Overview from './SyncOverviewPanel';
import { readHistoryFile, parseHistoryFile } from '~/services/syncHistoryFile.mjs';
import { prepareHistoryExport } from '~/services/syncHistoryExport.mjs';
import { api } from '~/services/api';
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs';
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs';
vi.mock('~/services/api', () => ({ api: vi.fn() }));
vi.mock('~/services/syncHistoryFile.mjs', async (original) => {
  const module = await original();return { ...module, readHistoryFile: vi.fn(module.readHistoryFile) };
});
let host, root, previousAct;
const records = () => Array.from({ length: 61 }, (_, i) => ({
  id: 'r' + i, itemID: 'object-' + i, title: i === 60 ? '尾页 星图 ＡＢＣ Café 🌱' : '笔记 ' + i,
  kind: i % 2 ? 'tag' : 'file', status: i === 60 ? 'superseded' : 'resolved',
  resolution: i === 60 ? 'remote-rebind' : i % 3 ? 'remote' : 'local', createdAt: 1, resolvedAt: 1790726400
}));
const raw = (rows = records(), extra = {}) => prepareHistoryExport({ snapshot: { items: rows, filter: 'all', hasMore: true }, phase: 'ready', ...extra }, new Date('2026-09-30T10:00:00Z')).raw;
const c = (key) => uiQuery(host, '[data-history-file-' + key + ']');
const ids = () => [...uiQueryAll(host, '[data-history-file-row]')].map((n) => uiText(uiQueryAll(n, 'code')[1]));
async function mount() {await act(async () => root.render(<Viewer />));uiQuery(host, 'details').open = true;}
async function select(file, wait = true) {
  await act(async () => {
    Object.defineProperty(c('input'), 'files', { configurable: true, value: file ? [file] : [] });
    c('input').dispatchEvent(new Event('change', { bubbles: true }));await Promise.resolve();
    if (file && wait) await uiValue(readHistoryFile.mock.results.at(-1)).catch(() => {});
  });
}
const open = async (text = raw(), name = 'history.json') => select(new File([text], name, { type: 'application/json' }));
async function type(value, composing = false) {
  await act(async () => {
    setUiValue(c('query'), value);
    c('query').dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }));
  });
}
async function click(key) {await act(async () => c(key).click());}
async function choose(key, value) {await act(async () => {await setUiValue(c(key), value);c(key).dispatchEvent(new Event('change', { bubbles: true }));});}
async function compose(typeName, value) {
  await act(async () => {
    if (value !== undefined) setUiValue(c('query'), value);
    c('query').dispatchEvent(new CompositionEvent(typeName, { bubbles: true, data: value || '' }));
  });
}
const loaded = async () => {await mount();await open();};
beforeEach(async () => {
  previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const module = await vi.importActual('~/services/syncHistoryFile.mjs');readHistoryFile.mockReset().mockImplementation(module.readHistoryFile);
  api.mockReset();host = document.createElement('div');document.body.append(host);root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;});
it('does not expose file search before a successful explicit file read', async () => {
  await mount();expect(c('query')).toBeNull();await select(null);
  expect(readHistoryFile).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();
});
it('searches the entire file, including records outside the visible page', async () => {
  await loaded();expect(ids()).not.toContain('r60');await type('星图');
  expect(ids()).toEqual(['r60']);expect(uiText(c('matches'))).toContain('当前匹配 1 条 / 文件内共 61 条');
  expect(uiText(c('page'))).toContain('1 / 1');expect(readHistoryFile).toHaveBeenCalledTimes(1);expect(api).not.toHaveBeenCalled();
});
it('supports case folding, full-width letters, accents and IDs with literal matching', async () => {
  await loaded();
  for (const q of ['abc', 'CAFÉ', '🌱', 'OBJECT-60', 'r60']) {await type(q);expect(ids()).toEqual(['r60']);}
  await type('.*');expect(ids()).toEqual([]);
});
it('intersects all three conditions and does not reclassify invalidation as a remote choice', async () => {
  await loaded();await type('笔记');await choose('kind', 'tag');await choose('outcome', 'local');
  expect(ids()).toHaveLength(10);expect(uiText(c('matches'))).toContain('10 条 / 文件内共 61 条');
  await type('星图');await choose('kind', 'file');await choose('outcome', 'remote');expect(ids()).toEqual([]);
  await choose('outcome', 'superseded');expect(ids()).toEqual(['r60']);expect(uiText(c('row'))).toContain('不代表已选边');
});
it('resets pagination and scroll on a changed condition but keeps input focus', async () => {
  await loaded();await click('next');await click('next');c('query').focus();
  uiQuery(host, '.sync-history-file-list').scrollTop = 120;await type('笔记');
  expect(uiText(c('page'))).toContain('1 / 3');expect(ids()[0]).toBe('r0');
  expect(uiQuery(host, '.sync-history-file-list').scrollTop).toBe(0);expect(document.activeElement).toBe(c('query'));
});
it('zero matches disable both paging directions without inventing page 1 of 0', async () => {
  await loaded();await type('missing');await click('prev');await click('next');
  expect(c('prev').getAttribute('aria-disabled')).toBe('true');expect(c('next').getAttribute('aria-disabled')).toBe('true');
  expect(uiText(c('page'))).toContain('暂无可翻页');expect(uiText(c('page'))).not.toContain('1 / 0');
  expect(uiText(c('empty'))).toContain('不是本机或全部历史没有记录');
});
it('clear restores all file records and first page without clearing the file or its declared scope', async () => {
  await loaded();const declaration = uiText(c('scope')),source = uiText(c('source'));
  await type('星图');await choose('kind', 'file');await choose('outcome', 'superseded');c('filter-clear').focus();await click('filter-clear');
  expect(uiText(c('name'))).toBe('history.json');expect(ids()).toHaveLength(25);
  expect(uiText(c('matches'))).toContain('61 条 / 文件内共 61 条');expect(document.activeElement).toBe(c('query'));
  expect(uiText(c('scope'))).toBe(declaration);expect(uiText(c('source'))).toBe(source);expect(readHistoryFile).toHaveBeenCalledTimes(1);
});
it('IME candidate input leaves the committed selection and page intact until confirmation', async () => {
  await loaded();await type('笔记');await click('next');const before = ids();
  await compose('compositionstart');await type('xingtu', true);
  expect(ids()).toEqual(before);expect(uiValue(c('query'))).toBe('xingtu');expect(c('composing')).toBeTruthy();
  await compose('compositionend', '星图');expect(ids()).toEqual(['r60']);expect(uiText(c('page'))).toContain('1 / 1');
});
it('does not truncate a composition candidate before selection at the Unicode limit', async () => {
  await loaded();await type('中'.repeat(127));await compose('compositionstart');await type('中'.repeat(127) + 'zhong', true);
  expect(uiValue(c('query'))).toBe('中'.repeat(127) + 'zhong');
  await compose('compositionend', '中'.repeat(129));expect(uiValue(c('query'))).toBe('中'.repeat(128));
  await type('🌱'.repeat(130));expect(uiValue(c('query'))).toBe('🌱'.repeat(128));
});
it('clear during composition prevents a late end event from reviving old text', async () => {
  await loaded();await type('星图');await compose('compositionstart');await type('xingtu', true);await click('filter-clear');
  await compose('compositionend');expect(uiValue(c('query'))).toBe('');expect(c('composing')).toBeNull();expect(ids()).toHaveLength(25);
});
it('cancelled composition returns to the prior query without resetting the current page', async () => {
  await loaded();await type('笔记');await click('next');const before = ids();
  await compose('compositionstart');await type('pin', true);await compose('compositionend', '笔记');
  expect(ids()).toEqual(before);expect(uiText(c('page'))).toContain('2 / 3');
});
it('invalid replacement preserves the previous file selection and page, labelled stale', async () => {
  await loaded();await type('笔记');await click('next');const before = ids();
  await open('invalid', 'bad.json');expect(ids()).toEqual(before);expect(uiValue(c('query'))).toBe('笔记');
  expect(uiText(c('name'))).toBe('history.json');expect(c('stale')).toBeTruthy();expect(uiText(c('page'))).toContain('2 / 3');
});
it('successful replacement resets file-only filters and page without hiding the new contents', async () => {
  await loaded();await type('星图');await choose('outcome', 'superseded');
  await open(raw([{ ...records()[0], id: 'fresh', title: '新文件' }]), 'replacement.json');
  expect(uiValue(c('query'))).toBe('');expect(uiValue(c('outcome'))).toBe('all');expect(ids()).toEqual(['fresh']);
});
it('stopping a replacement preserves filters, rejects late results and allows further local search', async () => {
  await loaded();await type('笔记');let finish;
  readHistoryFile.mockImplementationOnce(() => new Promise((r) => finish = r));
  await select(new File([raw()], 'slow.json'), false);await choose('kind', 'tag');await click('stop');
  await act(async () => finish(parseHistoryFile(raw())));
  expect(uiValue(c('kind'))).toBe('tag');expect(uiValue(c('query'))).toBe('笔记');expect(c('stale')).toBeTruthy();
  await type('object-59');expect(ids()).toEqual(['r59']);
});
it('cancelled picker and parent rerender preserve current file criteria and page', async () => {
  await loaded();await type('笔记');await click('next');const input = c('query'),before = ids();
  await select(null);await act(async () => root.render(<Viewer />));
  expect(c('query')).toBe(input);expect(ids()).toEqual(before);expect(uiValue(c('query'))).toBe('笔记');
});
it('a late older file cannot overwrite new file filters after a newer read succeeds', async () => {
  await loaded();let finish;
  readHistoryFile.mockImplementationOnce(() => new Promise((r) => finish = r));await select(new File([raw()], 'slow.json'), false);
  await open(raw(), 'new.json');await type('星图');await act(async () => finish(parseHistoryFile(raw())));
  expect(uiText(c('name'))).toBe('new.json');expect(uiValue(c('query'))).toBe('星图');expect(ids()).toEqual(['r60']);
});
it('clear-view then reopen and component remount forget file-only search state', async () => {
  await loaded();await type('星图');await click('clear');expect(c('query')).toBeNull();
  await open();expect(uiValue(c('query'))).toBe('');await type('私人标题');
  await act(async () => root.unmount());root = createRoot(host);await mount();await open();expect(uiValue(c('query'))).toBe('');
});
it('file filter actions do not download, store criteria, fetch or re-read the original file', async () => {
  const network = vi.spyOn(globalThis, 'fetch'),write = vi.spyOn(Storage.prototype, 'setItem'),download = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  await loaded();await type('星图');await choose('kind', 'file');await choose('outcome', 'superseded');await click('filter-clear');
  expect(network).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
  expect(readHistoryFile).toHaveBeenCalledTimes(1);expect(api).not.toHaveBeenCalled();
});
it('escapes file text and query markup and does not treat private notices as searchable records', async () => {
  const d = JSON.parse(raw([{ ...records()[0], title: '<img src=x onerror=alert(1)>' }]));
  d.notices = ['PRIVATE_INSTRUCTION'];await mount();await open(JSON.stringify(d));await type('<img');
  expect(ids()).toEqual(['r0']);expect(uiQuery(host, 'script,img,a,iframe')).toBeNull();
  await type('PRIVATE_INSTRUCTION');expect(ids()).toEqual([]);
});
it('the current file keeps original v2 date/source declarations while the local view is narrowed', async () => {
  await mount();await open(raw(undefined, { phase: 'error', timeFilter: { mode: 'range', from: '2026-09-30', to: '2026-09-30' } }));
  const scope = uiText(c('scope')),dates = uiText(c('dates'));await type('星图');
  expect(uiText(c('scope'))).toBe(scope);expect(uiText(c('dates'))).toBe(dates);expect(uiText(c('source'))).toContain('最近一次读取失败');
  expect(uiText(c('matches'))).toContain('1 条 / 文件内共 61 条');
});
it('searching an offline file never changes live history filters, summary or export metadata', async () => {
  api.mockResolvedValue(historyPage([{ ...historyRow('live'), current_title: '本机历史' }]));
  const navigate = vi.fn();await act(async () => root.render(<Overview {...overviewFixture()} onNavigate={navigate} />));
  uiQuery(host, '[data-sync-conflict-history]').open = true;uiQuery(host, '[data-history-file-viewer]').open = true;
  await act(async () => uiQuery(host, '[data-history-read]').click());
  const live = uiText(uiQuery(host, '[data-sync-conflict-history]')),guidance = uiText(uiQuery(host, '[data-sync-guidance]'));
  await open();await type('星图');await choose('outcome', 'superseded');await click('filter-clear');
  expect(uiText(uiQuery(host, '[data-sync-conflict-history]'))).toBe(live);
  expect(uiText(uiQuery(host, '[data-sync-guidance]'))).toBe(guidance);expect(api).toHaveBeenCalledTimes(1);expect(navigate).not.toHaveBeenCalled();
});
