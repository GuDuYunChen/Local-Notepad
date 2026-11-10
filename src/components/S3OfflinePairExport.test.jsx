import { uiDisabled, uiQuery, uiQueryAll, uiText } from "~/test/uiControlDriver";import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Export from './S3OfflinePairExport.jsx';
import Pair from './S3OfflineReportPair.jsx';
import { offlineExportFixture } from '../../scripts/s3-offline-pair-export-cases.mjs';
import { reportFixture } from '../../scripts/s3-local-overview-file-cases.mjs';
let host, root, clicked, readers, descriptors;
const flush = async () => {for (let i = 0; i < 10; i++) await Promise.resolve();};
const status = () => uiQuery(host, '[data-offline-export-status]')?.getAttribute('data-offline-export-status');
const render = (output) => act(async () => {root.render(<StrictMode><Export output={output} /></StrictMode>);await flush();});
const click = (selector) => act(async () => {uiQuery(host, selector).click();await flush();});
const select = (side) => act(async () => {
  const input = uiQuery(host, `[data-offline-side=${side}] input`),text = JSON.stringify(reportFixture());
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'PRIVATE_report.json')] });
  input.dispatchEvent(new Event('change', { bubbles: true }));await flush();
});
const load = (index) => act(async () => {
  const r = readers[index];r.result = new TextEncoder().encode(JSON.stringify(reportFixture())).buffer;r.onload?.();await flush();
});
const mountPair = async () => {
  await act(async () => {root.render(<StrictMode><Pair /></StrictMode>);await flush();});
  await act(async () => {uiQuery(host, 'details').open = true;uiQuery(host, 'details').dispatchEvent(new Event('toggle'));await flush();});
};
const compare = async () => {await select('a');await select('b');await load(0);await load(1);await click('[data-offline-compare]');};
beforeEach(() => {
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);readers = [];
  descriptors = ['createObjectURL', 'revokeObjectURL'].map((k) => [k, Object.getOwnPropertyDescriptor(URL, k)]);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:pair') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('FileReader', class {constructor() {readers.push(this);}readAsArrayBuffer(file) {this.file = file;}abort() {this.aborted = true;}});
  host = document.createElement('div');document.body.append(host);root = createRoot(host);
});
afterEach(async () => {
  await act(async () => {root.unmount();vi.runOnlyPendingTimers();await flush();});host.remove();
  for (const [k, d] of descriptors) if (d) Object.defineProperty(URL, k, d);else delete URL[k];
  vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
});
it('offline pair export UI has exactly JSON CSV HTML controls and no implicit output', async () => {
  await render(offlineExportFixture());
  expect([...uiQueryAll(host, 'button')].map((b) => b.dataset.offlineExportFormat)).toEqual(['json', 'csv', 'html']);
  expect(clicked).not.toHaveBeenCalled();expect(readers).toHaveLength(0);expect(status()).toBe('');
  for (const b of uiQueryAll(host, 'button')) expect(document.getElementById(b.getAttribute('aria-describedby'))).not.toBeNull();
});
it('offline pair export UI explicitly requests each format and never claims it is saved', async () => {
  await render(offlineExportFixture());
  for (const format of ['json', 'csv', 'html']) {await click(`[data-offline-export-format=${format}]`);expect(status()).toBe('requested');}
  expect(clicked).toHaveBeenCalledTimes(3);expect(uiText(host)).toContain('尚未确认落盘');
  expect(uiQuery(document, 'a[download]')).toBeNull();
  await act(async () => {vi.advanceTimersByTime(1000);await flush();});expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
});
it('offline pair export UI sanitizes download exceptions and retains its controls', async () => {
  clicked.mockImplementation(() => {throw Error('PRIVATE_PATH');});await render(offlineExportFixture());
  await click('[data-offline-export-format=json]');expect(status()).toBe('failed');expect(uiText(host)).not.toContain('PRIVATE_PATH');
  expect(uiQueryAll(host, 'button')).toHaveLength(3);
});
it('offline pair export UI resets stale feedback on A B A snapshots but not an unchanged render', async () => {
  const a = offlineExportFixture(),b = offlineExportFixture();await render(a);await click('[data-offline-export-format=json]');
  await render(a);expect(status()).toBe('requested');await render(b);await render(a);expect(status()).toBe('');
  expect(clicked).toHaveBeenCalledTimes(1);
});
it('offline pair export UI disables missing data and never submits an enclosing form', async () => {
  await render(null);expect([...uiQueryAll(host, 'button')].every((b) => uiDisabled(b))).toBe(true);
  const submit = vi.fn((e) => e.preventDefault());await act(async () => root.render(<form onSubmit={submit}><Export output={offlineExportFixture()} /></form>));
  await click('[data-offline-export-format=csv]');expect(submit).not.toHaveBeenCalled();
});
it('offline pair export integration waits for both reports and explicit comparison', async () => {
  await mountPair();expect(uiQuery(host, '[data-offline-export]')).toBeNull();await select('a');await load(0);
  expect(uiQuery(host, '[data-offline-export]')).toBeNull();await select('b');await load(1);
  expect(uiQuery(host, '[data-offline-export]')).toBeNull();await click('[data-offline-compare]');
  expect(uiQueryAll(host, '[data-offline-export-format]')).toHaveLength(3);
  expect(uiQueryAll(host, '[data-offline-result] tbody tr')).toHaveLength(12);
});
it('offline pair export integration preserves old view on picker cancellation', async () => {
  await mountPair();await compare();await click('[data-offline-export-format=json]');
  await act(async () => {const i = uiQuery(host, '[data-offline-side=a] input');Object.defineProperty(i, 'files', { configurable: true, value: [] });i.dispatchEvent(new Event('change', { bubbles: true }));await flush();});
  expect(status()).toBe('requested');expect(readers).toHaveLength(2);
});
it('offline pair export integration removes old exports during replacement and a failed read', async () => {
  await mountPair();await compare();await select('a');expect(uiQuery(host, '[data-offline-export]')).toBeNull();
  await act(async () => {readers[2].onerror?.();await flush();});expect(uiQuery(host, '[data-offline-export]')).toBeNull();
  expect(uiQuery(host, '[data-offline-side=b] [data-offline-state]').dataset.offlineState).toBe('ready');
});
it('offline pair export integration swapping invalidates old export feedback until reconfirmed', async () => {
  await mountPair();await compare();await click('[data-offline-export-format=html]');await click('[data-offline-swap]');
  expect(uiQuery(host, '[data-offline-export]')).toBeNull();await click('[data-offline-compare]');expect(status()).toBe('');
  expect(clicked).toHaveBeenCalledTimes(1);expect(readers).toHaveLength(2);
});
it('offline pair export integration clear and close discard exports and do not revive them', async () => {
  await mountPair();await compare();await click('[data-offline-side=a] button');expect(uiQuery(host, '[data-offline-export]')).toBeNull();
  await select('a');await load(2);await click('[data-offline-compare]');
  await act(async () => {const d = uiQuery(host, 'details');d.open = false;d.dispatchEvent(new Event('toggle'));await flush();});
  expect(uiQuery(host, '[data-offline-export]')).toBeNull();expect(clicked).not.toHaveBeenCalled();
});
it('offline pair export integration never scans or writes storage while exporting all formats', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch'),storage = vi.spyOn(Storage.prototype, 'setItem');
  await mountPair();await compare();
  for (const format of ['json', 'csv', 'html']) await click(`[data-offline-export-format=${format}]`);
  expect(readers).toHaveLength(2);expect(fetch).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();
  expect(uiText(host)).not.toContain('PRIVATE_report');
});
it('offline pair export integration a failed download leaves twelve source rows intact', async () => {
  await mountPair();await compare();const saved = uiText(uiQuery(host, '[data-offline-result]'));
  clicked.mockImplementation(() => {throw Error('PRIVATE_DOWNLOAD');});await click('[data-offline-export-format=csv]');
  expect(status()).toBe('failed');expect(uiText(uiQuery(host, '[data-offline-result]'))).toBe(saved);
  expect(uiText(host)).not.toContain('PRIVATE_DOWNLOAD');
});
