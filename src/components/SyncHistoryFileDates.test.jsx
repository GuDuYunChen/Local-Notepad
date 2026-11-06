import { setUiValue, uiQuery, uiQueryAll, uiText, uiValue } from "~/test/uiControlDriver";import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import Viewer from './SyncHistoryFileViewer';
import Overview from './SyncOverviewPanel';
import { prepareHistoryExport } from '~/services/syncHistoryExport.mjs';
import { readHistoryFile } from '~/services/syncHistoryFile.mjs';
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs';
import { api } from '~/services/api';
vi.mock('~/services/api', () => ({ api: vi.fn() }));
vi.mock('~/services/syncHistoryFile.mjs', async (original) => {
  const module = await original();return { ...module, readHistoryFile: vi.fn(module.readHistoryFile) };
});
let host, root, actMode;
const stamp = (text) => Date.parse(text) / 1000;
const rows = () => Array.from({ length: 31 }, (_, i) => ({ id: 'r' + i, itemID: 'same', title: i >= 25 ? '星图 ' + i : '笔记 ' + i,
  kind: i === 28 ? 'tag' : 'file', status: i === 29 ? 'superseded' : 'resolved', resolution: i === 29 ? 'remote-rebind' : i === 27 ? 'remote' : 'local', createdAt: 1,
  resolvedAt: i < 25 ? stamp('2026-09-29T12:00:00Z') : i === 25 ? stamp('2026-09-29T23:59:59Z') : i === 26 ? stamp('2026-09-30T00:00:00Z') : i === 27 ? stamp('2026-09-30T23:59:59Z') : i === 28 ? stamp('2026-10-01T00:00:00Z') : 0 }));
const raw = (items = rows(), extra = {}) => prepareHistoryExport({ snapshot: { filter: 'all', items, hasMore: true }, phase: 'ready', ...extra }, new Date('2026-10-01T10:00:00Z')).raw;
const c = (key) => uiQuery(host, '[data-history-file-' + key + ']');
const d = (key) => c('date-filter')?.querySelector('[data-history-time-' + key + ']');
const ids = () => [...uiQueryAll(host, '[data-history-file-row]')].map((n) => uiText(uiQueryAll(n, 'code')[1]));
const counts = () => [...uiQueryAll(host, '[data-file-summary-outcome]')].map((n) => Number(uiText(n)));
async function open(text = raw(), wait = true) {await act(async () => {
    Object.defineProperty(c('input'), 'files', { configurable: true, value: [new File([text], 'archive.json')] });
    c('input').dispatchEvent(new Event('change', { bubbles: true }));await Promise.resolve();
    if (wait) await uiValue(readHistoryFile.mock.results.at(-1)).catch(() => {});
  });}
async function click(node) {await act(async () => node.click());}
async function choose(node, value) {await act(async () => {setUiValue(node, value);node.dispatchEvent(new Event('change', { bubbles: true }));});}
async function fill(node, value) {await act(async () => {
    setUiValue(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));node.dispatchEvent(new Event('change', { bubbles: true }));
  });}
async function range(from = '2026-09-30', to = '2026-09-30') {
  await choose(d('mode'), 'range');await fill(d('from'), from);await fill(d('to'), to);
}
async function ready() {await act(async () => root.render(<Viewer />));await open();}
beforeEach(async () => {actMode = globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const module = await vi.importActual('~/services/syncHistoryFile.mjs');readHistoryFile.mockReset().mockImplementation(module.readHistoryFile);api.mockReset();
  host = document.createElement('div');document.body.append(host);root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT = actMode;});
it('date controls appear only after a file read and initially remain collapsed', async () => {
  await act(async () => root.render(<Viewer />));expect(c('date-filter')).toBeNull();expect(readHistoryFile).not.toHaveBeenCalled();
  await open();expect(d('controls').open).toBe(false);expect(uiValue(d('mode'))).toBe('all');expect(d('applied')).toBeNull();
  expect(uiText(c('date-filter'))).toContain('仅作用于本文件全部记录');
});
it('pending date drafts leave the current page and all-match counts intact', async () => {
  await ready();await click(c('next'));const before = ids(),summary = counts();await range();
  expect(ids()).toEqual(before);expect(counts()).toEqual(summary);expect(uiText(c('page'))).toContain('2 / 2');
  expect(uiText(d('pending'))).toContain('尚未应用');expect(d('applied')).toBeNull();
});
it('UTC date apply includes both boundary seconds, filters before paging and excludes missing timestamps', async () => {
  await ready();await click(c('next'));await range();await click(d('apply'));
  expect(ids()).toEqual(['r26', 'r27']);expect(counts()).toEqual([1, 1, 0, 0]);expect(uiText(c('matches'))).toContain('2 条 / 文件内共 31 条');
  expect(uiText(c('page'))).toContain('1 / 1');expect(uiText(d('applied'))).toContain('包含结束当日');
});
it('supports either open-ended boundary without including unknown dates', async () => {
  await ready();await range('2026-09-30', '');await click(d('apply'));expect(ids()).toEqual(['r26', 'r27', 'r28']);
  await fill(d('from'), '');await fill(d('to'), '2026-09-29');await click(d('apply'));expect(uiText(c('matches'))).toContain('26 条 /');
  await click(c('next'));expect(ids()).toEqual(['r25']);
});
it('intersects date with text, kind and outcome and shares exactly the same summary', async () => {
  await ready();await range();await click(d('apply'));await fill(c('query'), '星图');await choose(c('kind'), 'file');await choose(c('outcome'), 'remote');
  expect(ids()).toEqual(['r27']);expect(counts()).toEqual([0, 1, 0, 0]);expect(uiText(c('matches'))).toContain('1 条 / 文件内共 31 条');
});
it('invalid or empty date range leaves accepted conditions and results unchanged', async () => {
  await ready();await range();await click(d('apply'));await fill(d('from'), '2026-10-02');await click(d('apply'));
  expect(uiText(d('error'))).toContain('不能晚于');expect(ids()).toEqual(['r26', 'r27']);expect(uiText(d('applied'))).toContain('2026-09-30 至 2026-09-30');
  await fill(d('from'), '');await fill(d('to'), '');await click(d('apply'));expect(uiText(d('error'))).toContain('至少填写');expect(ids()).toEqual(['r26', 'r27']);
});
it('missing-time selection distinguishes invalidation and never invents an epoch date', async () => {
  await ready();await choose(d('mode'), 'missing');await click(d('apply'));
  expect(ids()).toEqual(['r29', 'r30']);expect(counts()).toEqual([1, 0, 1, 0]);expect(uiText(uiQuery(host, '[data-file-summary-no-time]'))).toContain('全部缺失');
  expect(uiQuery(host, '[data-file-summary-earliest]')).toBeNull();
});
it('zero matches have no fake range and cannot page', async () => {
  await ready();await range('2027-01-01', '2027-01-01');await click(d('apply'));expect(ids()).toEqual([]);
  expect(counts()).toEqual([0, 0, 0, 0]);expect(uiText(c('page'))).toContain('暂无可翻页');await click(c('next'));expect(ids()).toEqual([]);
});
it('global local-filter clear also discards an unapplied date draft without rereading the file', async () => {
  await ready();const declarations = uiText(c('scope'));await range();d('controls').open = true;
  expect(c('filter-clear')).toBeTruthy();c('filter-clear').focus();await click(c('filter-clear'));
  expect(uiValue(d('mode'))).toBe('all');expect(d('from')).toBeNull();expect(d('pending')).toBeNull();expect(d('controls').open).toBe(true);
  expect(uiText(c('matches'))).toContain('31 条 / 文件内共 31 条');expect(uiText(c('scope'))).toBe(declarations);
  expect(document.activeElement).toBe(c('query'));expect(readHistoryFile).toHaveBeenCalledTimes(1);
});
it('invalid replacement keeps both accepted dates and uncommitted draft with stale-file provenance', async () => {
  await ready();await range();await click(d('apply'));await fill(d('from'), '2026-10-02');await open('not JSON');
  expect(ids()).toEqual(['r26', 'r27']);expect(c('stale')).toBeTruthy();expect(uiQuery(host, '[data-file-summary-retained]')).toBeTruthy();
  expect(uiValue(d('from'))).toBe('2026-10-02');expect(d('pending')).toBeTruthy();await click(c('filter-clear'));expect(c('stale')).toBeTruthy();
});
it('new file and same-file successful reload clear both date states without remounting disclosure', async () => {
  await ready();await range();await click(d('apply'));const disclosure = d('controls');disclosure.open = true;
  await open(raw([{ ...rows()[0], id: 'fresh' }]));expect(uiValue(d('mode'))).toBe('all');expect(ids()).toEqual(['fresh']);expect(d('applied')).toBeNull();
  expect(d('controls')).toBe(disclosure);expect(disclosure.open).toBe(true);
  await choose(d('mode'), 'missing');await click(d('apply'));await open(raw([{ ...rows()[0], id: 'fresh' }]));expect(ids()).toEqual(['fresh']);
});
it('stopped replacement retains date selection and summary, including after late response', async () => {
  await ready();await range();await click(d('apply'));let finish;
  const module = await vi.importActual('~/services/syncHistoryFile.mjs');
  readHistoryFile.mockImplementationOnce(() => new Promise((r) => finish = r));await open(raw(), false);await click(c('stop'));
  await act(async () => finish(module.parseHistoryFile(raw())));expect(ids()).toEqual(['r26', 'r27']);expect(d('applied')).toBeTruthy();expect(c('stale')).toBeTruthy();
});
it('native date Enter applies but Ctrl+S is not consumed as a date confirmation', async () => {
  await ready();await range();let accepted;
  await act(async () => {accepted = d('from').dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));});
  expect(accepted).toBe(true);expect(d('applied')).toBeNull();
  await act(async () => d('to').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(ids()).toEqual(['r26', 'r27']);
});
it('editing text while dates are pending does not apply the draft or alter the source declarations', async () => {
  await ready();await range();await fill(c('query'), '星图');expect(uiText(c('matches'))).toContain('6 条 /');
  expect(d('pending')).toBeTruthy();await click(d('apply'));expect(ids()).toEqual(['r26', 'r27']);
});
it('local date and summary operations cause no new IO, storage or download and do not modify v2 declarations', async () => {
  const network = vi.spyOn(globalThis, 'fetch'),storage = vi.spyOn(Storage.prototype, 'setItem'),download = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  await act(async () => root.render(<Viewer />));await open(raw(rows(), { phase: 'error', timeFilter: { mode: 'range', from: '2026-09-29', to: '2026-10-01' } }));
  const declared = uiText(c('dates')),scope = uiText(c('scope'));
  await range();await click(d('apply'));expect(uiText(c('dates'))).toBe(declared);expect(uiText(c('scope'))).toBe(scope);expect(uiText(c('source'))).toContain('读取失败');
  expect(uiText(c('matches'))).toContain('2 条 / 文件内共 29 条');expect(readHistoryFile).toHaveBeenCalledTimes(1);
  expect(network).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
});
it('file-date operations do not change live workspace-history controls or guidance', async () => {
  await act(async () => root.render(<Overview {...overviewFixture()} />));const live = uiQuery(host, '[data-sync-conflict-history]'),before = uiText(live),guidance = uiText(uiQuery(host, '[data-sync-guidance]'));
  await open();await range();await click(d('apply'));await click(c('filter-clear'));
  expect(uiText(live)).toBe(before);expect(uiText(uiQuery(host, '[data-sync-guidance]'))).toBe(guidance);expect(api).not.toHaveBeenCalled();
});
