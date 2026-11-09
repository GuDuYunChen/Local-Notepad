import { changeUiValue } from '~/test/uiControlDriver'
import { setUiValue, uiQuery, uiQueryAll, uiText } from "~/test/uiControlDriver";import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import Panel from './SyncConflictHistoryPanel';
import Summary from './SyncHistorySummary';
import { api } from '~/services/api';
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs';
vi.mock('~/services/api', () => ({ api: vi.fn() }));
let root, host, oldAct;
const control = (name) => uiQuery(host, '[data-history-' + name + ']');
const summaries = () => uiQuery(host, '[data-history-summary]');
const counts = (dim) => [...uiQueryAll(host, '[data-history-summary-' + dim + ']')].map((n) => Number(uiText(n)));
const items = () => [
{ ...historyRow('a'), current_title: '星图', item_id: 'shared' },
{ ...historyRow('b', 'resolved', 'remote', 1790586500), current_title: '星图补记', item_id: 'shared' },
{ ...historyRow('c', 'superseded', 'remote-rebind', 1790586400), kind: 'attachment', current_title: '' },
{ ...historyRow('d', 'resolved', 'unknown', 0), kind: 'tag', current_title: '' }];

async function render() {await act(async () => root.render(<Panel />));await act(async () => {uiQuery(host, 'details').open = true;});}
async function click(name) {await act(async () => {control(name).click();await Promise.resolve();});}
async function read() {await render();await click('read');}
async function input(value, composing = false) {await act(async () => {
    const n = control('query');await setUiValue(n, value);
    n.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }));
  });}
async function choose(name, value) {await (async () => {
  const n = control(name);
  await changeUiValue(n, value, ['change']);
})();}
beforeEach(() => {oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.mockReset();api.mockResolvedValue(historyPage(items()));host = document.createElement('div');document.body.append(host);root = createRoot(host);});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;});
it('no summary fabricates unread counts or triggers the first request', async () => {
  await render();await input('星');expect(summaries()).toBeNull();expect(api).not.toHaveBeenCalled();
});
it('read creates a compact collapsed summary of displayed records and counts shared objects separately', async () => {
  await read();expect(summaries().open).toBe(false);expect(counts('outcome')).toEqual([1, 1, 1, 1]);expect(counts('kind')).toEqual([2, 1, 0, 1]);
  expect(uiText(control('summary-scope'))).toContain('当前显示的 4 条');expect(uiText(control('summary-time-coverage'))).toContain('时间缺失 1 条');
  expect(control('summary-earliest').dateTime).toBe(new Date(1790586400000).toISOString());
  expect(control('summary-latest').dateTime).toBe(new Date(1790586600000).toISOString());expect(api).toHaveBeenCalledTimes(1);
});
it('query and multiple filters update only the current selection summary without fetching', async () => {
  await read();await input('星图');expect(counts('outcome')).toEqual([1, 1, 0, 0]);expect(counts('kind')).toEqual([2, 0, 0, 0]);
  await choose('outcome', 'remote');expect(counts('outcome')).toEqual([0, 1, 0, 0]);
  await choose('kind', 'attachment');expect(counts('outcome')).toEqual([0, 0, 0, 0]);expect(uiText(control('summary-no-time'))).toContain('没有匹配');expect(api).toHaveBeenCalledTimes(1);
});
it('zero matches preserve unread-page scope and do not claim the whole history is empty', async () => {
  api.mockResolvedValue(historyPage(items(), 'all', 'next'));await read();await input('absent');
  expect(uiText(control('summary-scope'))).toContain('0 条');expect(uiText(control('summary-unread'))).toContain('未计入');
  expect(control('more')).toBeTruthy();expect(control('summary-earliest')).toBeNull();expect(api).toHaveBeenCalledTimes(1);
});
it('explicit append updates group counts and range, without resetting summary disclosure', async () => {
  const first = items().slice(0, 3);
  api.mockResolvedValueOnce(historyPage(first, 'all', 'next')).mockResolvedValueOnce(historyPage([items()[3]]));
  await read();await act(async () => {summaries().open = true;});await click('more');
  expect(counts('outcome')).toEqual([1, 1, 1, 1]);expect(summaries().open).toBe(true);expect(control('summary-unread')).toBeNull();
  expect(uiText(control('summary-time-coverage'))).toContain('有时间记录 3 条，时间缺失 1 条');
});
it('during refresh and after its failure old counts have explicit provenance', async () => {
  let fail;await read();api.mockImplementationOnce(() => new Promise((_, r) => fail = r));await click('read');
  expect(uiText(control('summary-provenance'))).toContain('正在读取');expect(counts('outcome')).toEqual([1, 1, 1, 1]);
  await act(async () => fail(Error('PRIVATE_SERVER')));
  expect(uiText(control('summary-provenance'))).toContain('最近读取失败');expect(uiText(summaries())).not.toContain('PRIVATE_SERVER');
});
it('stop preserves counts with provenance and late response cannot replace them', async () => {
  let finish;await read();api.mockImplementationOnce(() => new Promise((r) => finish = r));await click('read');await click('stop');
  await act(async () => finish(historyPage([])));
  expect(counts('outcome')).toEqual([1, 1, 1, 1]);expect(uiText(control('summary-provenance'))).toContain('已停止');
});
it('server-filter changes remove incompatible old counts while unread and after failure', async () => {
  await read();api.mockRejectedValueOnce(Error('failed'));
  await (async () => {
  const n = uiQuery(host, 'select');
  await changeUiValue(n, 'superseded', ['change']);
})();
  expect(summaries()).toBeNull();expect(uiText(host)).toContain('尚无可核实');
});
it('composition uses the committed query until completion and does not fetch', async () => {
  await read();await input('星图');expect(counts('outcome')).toEqual([1, 1, 0, 0]);
  await act(async () => control('query').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await input('pin', true);expect(counts('outcome')).toEqual([1, 1, 0, 0]);expect(control('summary-composition')).toBeTruthy();
  await act(async () => {const n = control('query');setUiValue(n, '不存在');n.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '不存在' }));});
  expect(counts('outcome')).toEqual([0, 0, 0, 0]);expect(control('summary-composition')).toBeNull();expect(api).toHaveBeenCalledTimes(1);
});
it('filter roundtrips do not remount disclosure or steal keyboard focus', async () => {
  await read();const details = summaries();await act(async () => {details.open = true;});control('query').focus();
  await input('星图');await input('');expect(summaries()).toBe(details);expect(details.open).toBe(true);
  expect(document.activeElement).toBe(control('query'));expect(counts('outcome')).toEqual([1, 1, 1, 1]);
});
it('summary open/close does not download, store preferences, navigate or introduce action controls', async () => {
  const write = vi.spyOn(Storage.prototype, 'setItem'),download = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  await read();await act(async () => {summaries().open = true;summaries().dispatchEvent(new Event('toggle'));});await act(async () => {summaries().open = false;});
  expect(uiQuery(summaries(), 'button,input,select,a,textarea')).toBeNull();expect(write).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();expect(api).toHaveBeenCalledTimes(1);
});
it('empty loaded history differs from an unread or all-missing timestamp collection', async () => {
  api.mockResolvedValueOnce(historyPage([])).mockResolvedValueOnce(historyPage([items()[3]]));await read();
  expect(counts('outcome')).toEqual([0, 0, 0, 0]);expect(uiText(control('summary-time-coverage'))).toContain('时间缺失 0 条');
  await click('read');expect(counts('outcome')).toEqual([0, 0, 0, 1]);expect(uiText(control('summary-no-time'))).toContain('没有已知');expect(uiText(control('summary-time-coverage'))).toContain('时间缺失 1 条');
});
it('defensive invalid input displays unavailable, never partially credible counts or private error content', async () => {
  await act(async () => root.render(<Summary rows={[{ id: 'bad', kind: 'PRIVATE_KIND' }]} phase="ready" hasMore={false} composing={false} />));
  expect(uiText(control('summary-scope'))).toContain('未生成部分统计');expect(counts('outcome')).toEqual([]);expect(uiText(summaries())).not.toContain('PRIVATE_KIND');
});
it('two panels have independent disclosure and unique accessible scope references', async () => {
  const rows = [{ id: 'a', kind: 'file', status: 'resolved', resolution: 'local', resolvedAt: 1 }];
  await act(async () => root.render(<><Summary rows={rows} phase="ready" /><Summary rows={[]} phase="ready" /></>));
  const pair = uiQueryAll(host, '[data-history-summary]');await act(async () => {pair[0].open = true;});
  expect(pair[1].open).toBe(false);const refs = [...pair].map((n) => uiQuery(n, 'summary').getAttribute('aria-describedby'));
  expect(new Set(refs).size).toBe(2);refs.forEach((id) => expect(document.getElementById(id)).toBeTruthy());
});
