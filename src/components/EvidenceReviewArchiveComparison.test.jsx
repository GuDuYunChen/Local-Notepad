import { setUiValue, uiDisabled, uiOptions, uiQuery, uiQueryAll, uiText, uiValue } from "~/test/uiControlDriver";import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EvidenceReviewArchives from './EvidenceReviewArchives';
import { reviewArchives, REVIEW_ARCHIVE_PREFIX } from '~/services/evidenceReviewArchives';
import { evidenceReview } from '~/services/evidenceReviewSession';
import { toast } from '~/services/toast';

let container, root;
const data = (count = 3, patch = {}) => ({
  projectId: 'p', entityId: 'e', entityLabel: '关关', filters: { source: 'all', query: '', volumeId: null, page: 1 },
  chapterId: 'c1', chapters: Array.from({ length: count }, (_, i) => ({ id: 'c' + (i + 1), title: '第' + (i + 1) + '章', ordinal: i + 1 })),
  reviewedIds: [], annotations: {}, ...patch
});
const note = (text, needsChanges = false) => ({ text, needsChanges });
function savePair(count = 3, a = {}, b = {}) {
  const before = reviewArchives.save(data(count, a), '2026-09-22T10:00:00.000Z');
  const after = reviewArchives.save(data(count, b), '2026-09-23T10:00:00.000Z');
  return [before, after];
}
const button = (text) => [...uiQueryAll(container, 'button')].find((node) => uiText(node) === text);
const byLabel = (text) => uiQuery(container, '[aria-label="' + text + '"]');
const panel = () => uiQuery(container, '.review-archive-comparison');
async function click(node) {expect(node).toBeTruthy();await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));}
async function change(node, value) {
  await setUiValue(node, value);
  await act(async () => {
    node.dispatchEvent(new Event('input', { bubbles: true }));node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function render(props = {}) {await act(async () => root.render(<EvidenceReviewArchives projectId="p" entityId="e" {...props} />));}
async function compare(pair) {
  await change(byLabel('对比基准存档'), REVIEW_ARCHIVE_PREFIX + pair[0].id);
  await change(byLabel('对比目标存档'), REVIEW_ARCHIVE_PREFIX + pair[1].id);
  await click(button('开始对比'));
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();evidenceReview.end(undefined, { discardAnnotations: true });
  vi.spyOn(toast, 'error').mockImplementation(() => {});
  container = document.createElement('div');document.body.appendChild(container);root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();evidenceReview.end(undefined, { discardAnnotations: true });localStorage.clear();vi.restoreAllMocks();
});

describe('read-only review archive comparison', () => {
  it('integrates collapsed into the archive manager and needs two explicit selections', async () => {
    savePair();await render();
    expect(panel()).toBeTruthy();expect(panel().open).toBe(false);
    expect(uiDisabled(button('开始对比'))).toBe(true);
    expect(uiDisabled(button('导出完整对比'))).toBe(true);
    expect(evidenceReview.getSnapshot()).toBeNull();
  });
  it('compares both sides and never equates clearing a flag with a verified fix', async () => {
    const pair = savePair(3, { annotations: { c1: note('旧注', true) } }, { annotations: { c1: note('已调整') } });
    await render();await compare(pair);
    expect(uiText(panel())).toContain('共同 3 章 · 变化 1 章 · 未变化 2 章');
    expect(uiText(byLabel('存档对比章节 c1'))).toContain('旧注');
    expect(uiText(byLabel('存档对比章节 c1'))).toContain('已调整');
    expect(uiText(panel())).toContain('取消待修改标记（不代表已修复）');
  });
  it('does not mark out-of-scope issues as cleared', async () => {
    const pair = savePair(3, { annotations: { c3: note('仍有问题', true) } }, { chapters: data(2).chapters });
    await render();await compare(pair);
    expect(uiText(panel())).toContain('移出范围 1 章');
    expect(uiText(panel())).toContain('取消待修改 0');
    expect(uiText(byLabel('存档对比章节 c3'))).toContain('仍有问题');
  });
  it('can select all saved snapshots across the archive manager page boundary', async () => {
    const pairs = [savePair(), savePair(), savePair()];await render();
    expect((await uiOptions(byLabel('对比基准存档'))).length).toBe(7);
    await compare([pairs[0][0], pairs[2][1]]);
    expect(uiText(panel())).toContain('共同 3 章');
  });
  it('retains both controlled archive choices for long native option labels', async () => {
    const longEntityLabel = '第一章 人物与项目开端的长标题'.repeat(8);
    const pair = savePair(3, { entityLabel: longEntityLabel }, { entityLabel: longEntityLabel });
    await render();
    const base = byLabel('对比基准存档');
    const target = byLabel('对比目标存档');
    // Both fields must still use the width-constrained real ControlKit host.
    expect(base.closest('.review-compare-selectors .app-ui-select-host')).toBeTruthy();
    expect(target.closest('.review-compare-selectors .app-ui-select-host')).toBeTruthy();
    await change(base, REVIEW_ARCHIVE_PREFIX + pair[0].id);
    await change(target, REVIEW_ARCHIVE_PREFIX + pair[1].id);
    expect(uiValue(base)).toBe(REVIEW_ARCHIVE_PREFIX + pair[0].id);
    expect(uiValue(target)).toBe(REVIEW_ARCHIVE_PREFIX + pair[1].id);
    expect(uiDisabled(button('开始对比'))).toBe(false);
    await click(button('开始对比'));
    expect(uiText(panel())).toContain('共同 3 章');
  });
  it('excludes a different project or entity and unreadable records from the target selector', async () => {
    const pair = savePair();
    reviewArchives.save(data(3, { entityId: 'else', entityLabel: '同名' }));
    reviewArchives.save(data(3, { projectId: 'other' }));
    localStorage.setItem(REVIEW_ARCHIVE_PREFIX + 'broken', 'invalid');
    await render();await change(byLabel('存档查看范围'), 'all');
    await change(byLabel('对比基准存档'), REVIEW_ARCHIVE_PREFIX + pair[0].id);
    expect((await uiOptions(byLabel('对比目标存档'))).length).toBe(2);
    expect((await uiOptions(byLabel('对比基准存档'))).length).toBe(5);
  });
  it('compares without changing the active review or writing to persistent storage', async () => {
    const pair = savePair();evidenceReview.restoreArchive(data());
    const original = evidenceReview.getSnapshot();await render();
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    await compare(pair);
    expect(spy).not.toHaveBeenCalled();expect(evidenceReview.getSnapshot()).toBe(original);
  });
  it('filters and searches both old and new notes, including Unicode', async () => {
    const pair = savePair(3, { annotations: { c1: note('Élodie 旧注') } }, { annotations: { c1: note('新注'), c2: note('', true) } });
    await render();await compare(pair);
    await change(byLabel('存档对比变化筛选'), 'notes');await change(byLabel('搜索存档对比'), ' E\u0301LODIE ');
    expect(uiQueryAll(panel(), 'article')).toHaveLength(1);
    await change(byLabel('搜索存档对比'), '无匹配');
    expect(uiText(panel())).toContain('当前筛选没有章节');
    expect(uiDisabled(button('导出完整对比'))).toBe(false);
  });
  it('paginates changes, clamps pages and resets the page when filtering', async () => {
    const pair = savePair(19, {}, { annotations: Object.fromEntries(data(19).chapters.map((c) => [c.id, note('变化')])) });
    await render();await compare(pair);
    expect(uiQueryAll(panel(), 'article')).toHaveLength(8);
    await click(button('下一页对比'));await click(button('下一页对比'));
    expect(uiQueryAll(panel(), 'article')).toHaveLength(3);
    expect(byLabel('存档对比章节 c19')).toBeTruthy();
    await change(byLabel('搜索存档对比'), '第1章');
    expect(uiText(byLabel('存档对比分页'))).toContain('1 / 1');
  });
  it('keeps unchanged unresolved issues visible through the issue filter', async () => {
    const pair = savePair(3, { annotations: { c1: note('疑点', true) } }, { annotations: { c1: note('疑点', true) } });
    await render();await compare(pair);
    expect(uiQueryAll(panel(), 'article')).toHaveLength(0);
    await change(byLabel('存档对比变化筛选'), 'issues');
    expect(uiQueryAll(panel(), 'article')).toHaveLength(1);
    expect(uiText(panel())).toContain('记录未变化');
  });
  it('warns on changed scope and reversing A/B changes direction only after a new comparison', async () => {
    const pair = savePair(3, {}, { filters: { source: 'alias', query: '称呼', volumeId: '', page: 1 } });
    await render();await compare(pair);
    expect(uiText(panel())).toContain('两份存档筛选条件不同');
    await click(button('交换 A / B'));
    expect(uiDisabled(button('导出完整对比'))).toBe(true);
    await click(button('开始对比'));
    expect(uiText(panel())).toContain('B 的保存时间早于 A');
  });
  it('warns instead of inferring chronology from equal save timestamps', async () => {
    const a = reviewArchives.save(data(), '2026-09-23T10:00:00.000Z');
    const b = reviewArchives.save(data(), '2026-09-23T10:00:00.000Z');
    await render();await compare([a, b]);
    expect(uiText(panel())).toContain('保存时间相同，不推断先后');
  });
  it('invalidates deleted snapshots on store notifications without changing the review', async () => {
    const pair = savePair(3, {}, { annotations: { c1: note('机密注') } });await render();await compare(pair);
    const selected = reviewArchives.list().entries.find((entry) => entry.archive.id === pair[1].id);
    await act(async () => reviewArchives.remove(selected));
    expect(uiDisabled(button('导出完整对比'))).toBe(true);
    expect(uiText(panel())).toContain('旧对比已停用');
    expect(uiQueryAll(panel(), 'article')).toHaveLength(0);
  });
  it('invalidates changed snapshots after an external storage event', async () => {
    const pair = savePair();await render();await compare(pair);
    const key = REVIEW_ARCHIVE_PREFIX + pair[1].id;
    await act(async () => {
      localStorage.setItem(key, JSON.stringify({ ...pair[1], data: { ...pair[1].data, entityLabel: '变化' } }));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
    expect(uiText(panel())).toContain('旧对比已停用');
  });
  it('revalidates at export even when no storage event arrives', async () => {
    const pair = savePair();await render();await compare(pair);
    localStorage.removeItem(REVIEW_ARCHIVE_PREFIX + pair[0].id);
    const make = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:comparison');
    await click(button('导出完整对比'));
    expect(make).not.toHaveBeenCalled();expect(toast.error).toHaveBeenCalled();
    expect(uiText(panel())).toContain('请刷新存档列表后重试');
  });
  it('downloads the full union despite search, with correct text and cleanup', async () => {
    const pair = savePair(19, {}, { annotations: { c19: note('末页备注') } });await render();await compare(pair);
    await change(byLabel('搜索存档对比'), '无匹配');
    let blob, filename;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {blob = value;return 'blob:report';});
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {filename = this.download;});
    await click(button('导出完整对比'));
    expect(await blob.text()).toContain('章节 ID：c19');
    expect(await blob.text()).toContain('末页备注');
    expect(filename).toMatch(/^核对存档对比-.*\.md$/);
    expect(uiQuery(document, 'a[href="blob:report"]')).toBeNull();
  });
  it('renders hostile-looking title and notes as ordinary text', async () => {
    const pair = savePair(3, {}, { annotations: { c1: note('<img src=x onerror=alert(1)>') } });
    await render();await compare(pair);
    expect(uiQuery(panel(), 'img')).toBeNull();expect(uiText(panel())).toContain('<img src=x');
  });
  it('clears selection and stale comparison after switching project context', async () => {
    const pair = savePair();await render();await compare(pair);
    await render({ projectId: 'new' });
    expect(uiValue(byLabel('对比基准存档'))).toBe('');
    expect(uiDisabled(button('导出完整对比'))).toBe(true);
  });
  it('changing A clears B and the result without deleting snapshots', async () => {
    const pair = savePair();await render();await compare(pair);
    await change(byLabel('对比基准存档'), REVIEW_ARCHIVE_PREFIX + pair[1].id);
    expect(uiValue(byLabel('对比目标存档'))).toBe('');
    expect(uiQueryAll(panel(), 'article')).toHaveLength(0);
    expect(reviewArchives.list().entries).toHaveLength(2);
  });
});
