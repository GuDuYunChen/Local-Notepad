import UiThemeProvider from './ui/UiThemeProvider';
import { setUiValue, uiDisabled, uiQuery, uiQueryAll, uiText } from "~/test/uiControlDriver";import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteComparison from './NoteComparison';
import { comparisonFixture, comparisonIndexFixture, lexicalComparisonBody } from '../test/noteComparisonFixture.mjs';
import { api } from '~/services/api';
vi.mock('~/services/api', () => ({ api: vi.fn() }));
let root, host, closed, opened, current, bodyData, indexData, held, readError, downloads;
const drain = async () => {for (let i = 0; i < 30; i++) await Promise.resolve();await new Promise((r) => setTimeout(r, 8));for (let i = 0; i < 20; i++) await Promise.resolve();};
const button = (text, owner = document) => [...uiQueryAll(owner, 'button')].find((n) => uiText(n).trim() === text || n.getAttribute('aria-label') === text);
const click = async (text, owner = document) => act(async () => {const n = button(text, owner);expect(n, text).toBeTruthy();expect(uiDisabled(n), text).toBe(false);n.focus();n.click();await drain();});
// Body verification and source reads can outlive a click's render drain. Wait
// for the active operation's visible cancel control to leave before inspecting
// its result. Held-read and cancellation tests intentionally keep plain click.
const clickAndWaitForCompletion = async (text, owner = document) => {
  await click(text, owner);
  await vi.waitFor(async () => {
    await act(drain);
    expect(button('取消读取') ?? button('停止核对') ?? button('取消打开'), uiQuery(document, '.note-comparison-feedback')?.textContent).toBeUndefined();
  }, { timeout: 2000, interval: 10 });
};
const select = async (id, side) => click(side === 'left' ? '设为左侧' : '设为右侧', uiQuery(document, '[data-compare-note="' + id + '"]'));
const change = async (selector, value) => {const n = uiQuery(document, selector);expect(n).toBeTruthy();await setUiValue(n, value);await act(async () => {n.dispatchEvent(new Event(n.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));await drain();});};
const compare = async () => {await select('a', 'left');await select('b', 'right');await click('开始比较');await awaitComparisonResult();};
function Harness() {const [show, setShow] = useState(true);return <>{show && <NoteComparison onClose={() => {closed();setShow(false);}} onOpenFile={opened} />}</>;}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);vi.stubGlobal('crypto', webcrypto);localStorage.clear();closed = vi.fn();held = null;readError = false;downloads = [];indexData = comparisonIndexFixture(51);bodyData = comparisonFixture();current = bodyData.notes[0];
  opened = vi.fn(async (id, opts) => {await opts.readFile(id, { signal: opts.signal });return false;});
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {downloads.push(blob);return 'blob:comparison';});vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  api.mockReset().mockImplementation(async (path, init) => {if (init?.method) throw Error('unexpected write');if (path === '/api/folder-workspace') return indexData;if (path.startsWith('/api/note-comparison?')) {if (readError) throw Error('injected');if (held) return held.promise;const u = new URL(path, 'http://local');if (u.searchParams.get('left') === 'b') return comparisonFixture([...bodyData.notes].reverse().map((n) => n.content), ['b', 'a']);return bodyData;}if (path.startsWith('/api/files/')) return { ...current, is_folder: false, is_deleted: false };throw Error('unexpected read ' + path);});
  host = document.createElement('div');document.body.appendChild(host);root = createRoot(host);await act(async () => {root.render(<UiThemeProvider><Harness /></UiThemeProvider>);await drain();});
});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('whole note comparison workflow', () => {
  it('requires two explicit distinct sources, pages all 51 and retains selected IDs', async () => {expect(uiDisabled(button('开始比较'))).toBe(true);await select('a', 'left');await click('下一页笔记');expect(uiQueryAll(document, '[data-compare-note]')).toHaveLength(1);expect(uiText(uiQuery(document, '[data-comparison-selection="0"]'))).toContain('a.md');await click('上一页笔记');await select('a', 'right');expect(uiText(uiQuery(document, '[data-comparison-selection="0"]'))).toBe('尚未选择');await select('b', 'left');expect(uiDisabled(button('开始比较'))).toBe(false);});
  it('compares full pair, exposes direction/EOL, returns and swaps deliberately', async () => {await compare();expect(uiQuery(document, '[data-comparison-state]').dataset.comparisonState).toBe('different');expect(uiText(uiQuery(document, '[data-diff-kind=left] pre'))).toBe('left');expect(uiText(uiQuery(document, '[data-diff-kind=right] pre'))).toBe('right');await click('返回选择');await click('交换左右');expect(uiText(uiQuery(document, '[data-comparison-selection="0"]'))).toContain('b.md');await click('开始比较');await awaitComparisonResult();expect(uiText(uiQuery(document, '[data-diff-kind=left] pre'))).toBe('right');});
  it('searches a complete title or location without losing selections', async () => {await select('a', 'left');await change('input[aria-label="比较笔记查找"]', 'note-50');expect(uiQueryAll(document, '[data-compare-note]')).toHaveLength(1);expect(uiText(uiQuery(document, '[data-comparison-selection="0"]'))).toContain('a.md');await change('input[aria-label="比较笔记查找"]', 'no match');expect(uiText(document.body)).toContain('没有匹配的普通笔记');});
  it('distinguishes projected text equality from raw content and refuses unknown nodes', async () => {const a = lexicalComparisonBody('hello');bodyData = comparisonFixture([a, a.replace('"format":0', '"format":1')]);await compare();expect(uiText(document.body)).toContain('文本投影相同，但保存正文不同');await change('select[aria-label="笔记比较模式"]', 'raw');expect(uiQuery(document, '[data-comparison-state]').dataset.comparisonState).toBe('different');});
  it('renders raw hostile markup as plain text, not image or script', async () => {bodyData = comparisonFixture(['<img src="x" onerror="alert(1)">', '<script>danger()</script>']);await compare();expect(uiQuery(document, '.note-comparison img')).toBeNull();expect(uiQuery(document, '.note-comparison script')).toBeNull();expect(uiText(uiQuery(document, '.note-comparison-lines'))).toContain('<script>danger()</script>');});
  it('pages all differences and navigates distant change groups', async () => {bodyData = comparisonFixture(['left\n' + 'same\n'.repeat(100) + 'last-a\n', 'right\n' + 'same\n'.repeat(100) + 'last-b\n']);await compare();expect(uiQueryAll(document, '[data-diff-kind]')).toHaveLength(60);await click('下一处差异');expect(uiText(uiQuery(document, '[data-change-target=true] pre'))).toBe('last-a');expect(uiText(document.body)).toContain('第 2/2 页');await click('上一处差异');expect(uiText(uiQuery(document, '[data-change-target=true] pre'))).toBe('left');});
  it('does not download without explicit consent, resets opt-in on reopen', async () => {await compare();await click('导出比较报告');expect(uiQuery(document, 'input[type=checkbox]').checked).toBe(false);await act(async () => {uiQuery(document, 'input[type=checkbox]').click();await drain();});await click('取消导出');expect(downloads).toHaveLength(0);await click('导出比较报告');expect(uiQuery(document, 'input[type=checkbox]').checked).toBe(false);});
  it('downloads private summary only after fresh pair revalidation', async () => {await compare();const before = api.mock.calls.filter(([p]) => p.startsWith('/api/note-comparison')).length;await click('导出比较报告');await clickAndWaitForCompletion('确认导出');await vi.waitFor(() => expect(downloads).toHaveLength(1), { timeout: 5000, interval: 20 });const v = JSON.parse(await downloads[0].text());expect(v.notes).toBeUndefined();expect(v.contains_contents).toBe(false);expect(api.mock.calls.filter(([p]) => p.startsWith('/api/note-comparison')).length).toBe(before + 1);expect(uiText(uiQuery(document, '[role=status]'))).toContain('已发起比较报告下载');});
  it('explicit detailed export contains both full sources in the chosen direction', async () => {await compare();await click('导出比较报告');await act(async () => {uiQuery(document, 'input[type=checkbox]').click();await drain();});await clickAndWaitForCompletion('确认导出');const v = JSON.parse(await downloads[0].text());expect(v.notes).toEqual(bodyData.notes);expect(v.rows.some((n) => n.kind === 'right')).toBe(true);});
  it('rejects a changed body before export even when server revision is reused', async () => {await compare();await click('导出比较报告');bodyData = { ...comparisonFixture(['new', 'other']), revision: bodyData.revision };await clickAndWaitForCompletion('确认导出');expect(downloads).toHaveLength(0);expect(uiText(uiQuery(document, '[role=alert]'))).toContain('资料库已变化');expect(uiDisabled(button('导出比较报告'))).toBe(true);});
  it('rejects a renamed source since selection instead of mislabeling the pair', async () => {await select('a', 'left');await select('b', 'right');bodyData.notes[0].title = 'renamed';await clickAndWaitForCompletion('开始比较');expect(uiQuery(document, '[data-comparison-state]')).toBeNull();expect(uiText(uiQuery(document, '[role=alert]'))).toContain('资料库已变化');});
  it('keeps original source guard and remains mounted on cancel', async () => {await compare();await clickAndWaitForCompletion('打开左侧原文');expect(opened).toHaveBeenCalledTimes(1);expect(uiQuery(document, '.note-comparison')).not.toBeNull();expect(uiText(uiQuery(document, '[role=status]'))).toContain('打开已取消');expect(api.mock.calls.some(([p]) => p === '/api/files/a')).toBe(true);});
  it('closes only when original source owner accepts a fresh read', async () => {opened.mockImplementation(async (id, opts) => {await opts.readFile(id, { signal: opts.signal });return opts.shouldSelect();});await compare();await clickAndWaitForCompletion('打开左侧原文');expect(closed).toHaveBeenCalledTimes(1);expect(uiQuery(document, '.note-comparison')).toBeNull();});
  it('refuses changed source navigation', async () => {await compare();current = { ...current, content: 'changed' };await clickAndWaitForCompletion('打开左侧原文');expect(closed).not.toHaveBeenCalled();expect(uiText(uiQuery(document, '[role=alert]'))).toContain('资料库已变化');});
  it('read errors discard results and allow explicit complete retry', async () => {await select('a', 'left');await select('b', 'right');readError = true;await clickAndWaitForCompletion('开始比较');expect(uiQuery(document, '[role=alert]')).not.toBeNull();expect(uiQuery(document, '[data-comparison-state]')).toBeNull();readError = false;await click('开始比较');await awaitComparisonResult();expect(uiQuery(document, '[data-comparison-state]')).not.toBeNull();});
});
const defer = () => {let resolve;return { promise: new Promise((r) => {resolve = r;}), resolve: (v) => resolve(v) };};
describe('cancellation and ownership', () => {
  it('cancelled pair ignores late result and never resends', async () => {await select('a', 'left');await select('b', 'right');held = defer();await click('开始比较');const before = api.mock.calls.length;await click('取消读取');await act(async () => {held.resolve(bodyData);await drain();});expect(uiQuery(document, '[data-comparison-state]')).toBeNull();expect(api.mock.calls.length).toBe(before);expect(uiText(uiQuery(document, '[role=status]'))).toContain('比较已取消');});
  it('cancelled export revalidation cannot download later', async () => {await compare();await click('导出比较报告');held = defer();await click('确认导出');await click('取消导出');await act(async () => {held.resolve(bodyData);await drain();});expect(downloads).toHaveLength(0);expect(uiQuery(document, '[role=alertdialog]')).toBeNull();});
  it('external change invalidates consent and blocks late compare', async () => {await select('a', 'left');await select('b', 'right');held = defer();await click('开始比较');await act(async () => {window.dispatchEvent(new CustomEvent('library:refresh'));held.resolve(bodyData);await drain();});expect(uiQuery(document, '[data-comparison-state]')).toBeNull();expect(uiDisabled(button('开始比较'))).toBe(true);});
  it('closing a held read never adopts it or triggers a download', async () => {held = defer();await select('a', 'left');await select('b', 'right');await click('开始比较');await click('关闭双笔记比较');await act(async () => {held.resolve(bodyData);await drain();});expect(closed).toHaveBeenCalledTimes(1);expect(downloads).toHaveLength(0);expect(uiQuery(document, '.note-comparison')).toBeNull();});
  it('duplicate activation has only one network request', async () => {await select('a', 'left');await select('b', 'right');held = defer();await act(async () => {const b = button('开始比较');b.click();b.click();await drain();});expect(api.mock.calls.filter(([p]) => p.startsWith('/api/note-comparison'))).toHaveLength(1);await click('取消读取');});
  it('IME Escape is ignored, regular Escape closes, and save shortcut is suppressed', async () => {const p = uiQuery(document, '.note-comparison');await act(async () => {const save = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });p.dispatchEvent(save);expect(save.defaultPrevented).toBe(true);p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));await drain();});expect(closed).not.toHaveBeenCalled();await act(async () => {p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));await drain();});expect(closed).toHaveBeenCalledTimes(1);});
  it('confirmation owns Tab/Escape and never propagates to page navigation', async () => {await compare();await click('导出比较报告');const box = uiQuery(document, '[role=alertdialog]'),last = button('确认导出', box);last.focus();await act(async () => {box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));await drain();});expect(document.activeElement).toBe(uiQuery(box, 'input'));await act(async () => {box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));await drain();});expect(uiQuery(document, '[role=alertdialog]')).toBeNull();expect(document.activeElement).toBe(button('导出比较报告'));expect(closed).not.toHaveBeenCalled();});
  it('all product interactions use GET-only requests and no saved comparison state', async () => {await compare();await click('导出比较报告');await clickAndWaitForCompletion('确认导出');expect(api.mock.calls.every(([, o]) => !o.method)).toBe(true);expect(localStorage.length).toBe(0);});
});

// Crypto verification crosses the actual Node/WebCrypto boundary. Wait for the
// adopted result, not an assumed 8ms completion time under concurrent Vitest load.
const awaitComparisonResult = () => vi.waitFor(async () => {
  await act(drain);
  expect(uiQuery(document, '[data-comparison-state]'), uiQuery(document, '.note-comparison-feedback')?.textContent).not.toBeNull();
}, { timeout: 2000, interval: 10 });
const compareSettled = compare;

// Regression: a long common prefix must not hide the only selected difference
// behind disabled Previous/Next buttons on the first page.
describe('distant first-change navigation regression', () => {
  it('lands on the only difference after 130 unchanged lines', async () => {
    bodyData = comparisonFixture(['same\n'.repeat(130) + 'LEFT\n', 'same\n'.repeat(130) + 'RIGHT\n']);
    await compareSettled();
    expect(uiQuery(document, '[data-change-target=true] pre')?.textContent).toBe('LEFT');
    expect(uiText(uiQuery(document, '[aria-label="笔记差异分页"]'))).toContain('第 3/3 页');
    expect(uiDisabled(button('上一处差异'))).toBe(true);expect(uiDisabled(button('下一处差异'))).toBe(true);
  });
  it('initially locates the first distant group, then next and previous remain exact', async () => {
    const common = 'same\n'.repeat(130);
    bodyData = comparisonFixture([common + 'FIRST-L\n' + 'between\n'.repeat(80) + 'LAST-L\n', common + 'FIRST-R\n' + 'between\n'.repeat(80) + 'LAST-R\n']);
    await compareSettled();expect(uiQuery(document, '[data-change-target=true] pre')?.textContent).toBe('FIRST-L');
    await click('下一处差异');expect(uiQuery(document, '[data-change-target=true] pre')?.textContent).toBe('LAST-L');
    await click('上一处差异');expect(uiQuery(document, '[data-change-target=true] pre')?.textContent).toBe('FIRST-L');
  });
  it('mode changes locate the first difference in the new model rather than resetting to page one', async () => {
    const prefix = 'same\n'.repeat(130);
    bodyData = comparisonFixture([lexicalComparisonBody(prefix + 'LEFT'), lexicalComparisonBody(prefix + 'RIGHT')]);
    await compareSettled();await change('select[aria-label="笔记比较模式"]', 'raw');
    expect(uiText(uiQuery(document, '[aria-label="笔记差异分页"]'))).toContain('第 1/1 页');
    await change('select[aria-label="笔记比较模式"]', 'text');
    expect(uiQuery(document, '[data-change-target=true] pre')?.textContent).toBe('LEFT');
    expect(uiText(uiQuery(document, '[aria-label="笔记差异分页"]'))).toContain('第 3/3 页');
  });
  it('re-comparing another pair initializes its own distant first difference', async () => {
    await compareSettled();await click('返回选择');
    bodyData = comparisonFixture(['same\n'.repeat(121) + 'NEW-L\n', 'same\n'.repeat(121) + 'NEW-R\n']);
    await click('开始比较');await awaitComparisonResult();expect(uiQuery(document, '[data-change-target=true] pre')?.textContent).toBe('NEW-L');
  });
});

describe('explicit current-change relocation', () => {
  it('returns to the only distant difference after browsing earlier common pages', async () => {
    bodyData = comparisonFixture(['same\n'.repeat(130) + 'LEFT\n', 'same\n'.repeat(130) + 'RIGHT\n']);await compareSettled();
    await click('上一页差异');await click('上一页差异');
    expect(uiQuery(document, '[data-change-target=true]')).toBeNull();
    const before = api.mock.calls.length;await click('定位当前差异');
    expect(uiQuery(document, '[data-change-target=true] pre')?.textContent).toBe('LEFT');
    expect(uiText(uiQuery(document, '[aria-label="笔记差异分页"]'))).toContain('第 3/3 页');
    expect(api.mock.calls.length).toBe(before);expect(downloads).toHaveLength(0);
  });
  it('re-locates twice on the same page without requiring a state-changing page jump', async () => {
    await compareSettled();const row = uiQuery(document, '[data-change-target=true]');row.scrollIntoView = vi.fn();
    await click('定位当前差异');await click('定位当前差异');
    expect(row.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(row.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
  });
  it('cannot relocate stale results or steal focus from export confirmation', async () => {
    await compareSettled();await click('导出比较报告');expect(uiDisabled(button('定位当前差异'))).toBe(true);
    await click('取消导出');expect(uiDisabled(button('定位当前差异'))).toBe(false);
    await act(async () => {window.dispatchEvent(new CustomEvent('library:refresh'));await drain();});
    expect(uiDisabled(button('定位当前差异'))).toBe(true);
  });
  it('keeps long identical and refused results out of difference navigation', async () => {
    const same = 'same\n'.repeat(130);bodyData = comparisonFixture([same, same]);await compareSettled();
    expect(uiQuery(document, '[aria-label="笔记差异导航"]')).toBeNull();
    await click('返回选择');bodyData = comparisonFixture(['a\n'.repeat(2001), 'b']);await click('开始比较');await awaitComparisonResult();
    expect(uiQuery(document, '[data-comparison-state]').dataset.comparisonState).toBe('unavailable');
    expect(uiQuery(document, '[aria-label="笔记差异导航"]')).toBeNull();
  });
});

// Each independent boundary owns the original renderer setup/cleanup and test
// budget. Six complete Ant Design workflows must not share one test deadline.
it.each([59, 60, 61, 119, 120, 180])('locates exact first-change page at both sides of each 60-row boundary (%i unchanged lines)', async (prefixLength) => {
  bodyData = comparisonFixture(['same\n'.repeat(prefixLength) + 'BOUNDARY-LEFT\n', 'same\n'.repeat(prefixLength) + 'BOUNDARY-RIGHT\n']);
  await compareSettled();
  expect(uiQuery(document, '[data-change-target=true] pre')?.textContent).toBe('BOUNDARY-LEFT');
  expect(uiText(uiQuery(document, '[aria-label="笔记差异分页"]'))).toContain('第 ' + (Math.floor(prefixLength / 60) + 1) + '/');
});

// Exercise the real WebCrypto implementation with an intentionally slow boundary.
// The comparison helper must wait for the adopted pair, not an elapsed 8ms sleep.
it('waits for both real body digests before treating comparison as complete', async () => {
  const digest = vi.fn(async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return webcrypto.subtle.digest(...args);
  });
  vi.stubGlobal('crypto', { subtle: { digest } });
  const body = lexicalComparisonBody('delayed but complete');
  bodyData = comparisonFixture([body, body.replace('"format":0', '"format":1')]);
  await compare();
  expect(uiQuery(document, '[data-comparison-state]')?.dataset.comparisonState).toBe('same');
  expect(uiText(document.body)).toContain('文本投影相同，但保存正文不同');
  expect(digest).toHaveBeenCalledTimes(2);
  await click('导出比较报告');
  bodyData = { ...comparisonFixture(['new', 'other']), revision: bodyData.revision };
  await clickAndWaitForCompletion('确认导出');
  expect(downloads).toHaveLength(0);
  expect(uiText(uiQuery(document, '[role=alert]'))).toContain('资料库已变化');
  expect(uiDisabled(button('导出比较报告'))).toBe(true);
  expect(digest).toHaveBeenCalledTimes(4);
});
