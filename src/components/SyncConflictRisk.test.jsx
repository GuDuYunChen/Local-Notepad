import { prepareUiSelectChange } from '~/test/uiControlDriver'
import { uiOptionsText } from '~/test/uiControlDriver'
import { changeUiValue } from '~/test/uiControlDriver'
import { setUiValue, uiDisabled, uiQuery, uiQueryAll, uiText, uiValue } from "~/test/uiControlDriver";import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Queue from './SyncConflictQueue';
import { queueFixture, queueAttachment, queueSettings, queueStatus } from '../../scripts/fixtures/sync-conflict-queue.mjs';
import { riskFixture, tombstone } from '../../scripts/fixtures/sync-conflict-risk.mjs';
import { conflictScope } from '~/services/syncConflictReview.mjs';
let root, container, conflicts, resolve, refresh, props, actEnvironment;
const scope = conflictScope(queueSettings, queueStatus);
const flush = async () => {for (let i = 0; i < 12; i++) await Promise.resolve();};
const button = (label) => [...uiQueryAll(container, 'button')].find((node) => uiText(node) === label);
const field = (label) => uiQuery(container, '[aria-label="' + label + '"]');
const cards = () => [...uiQueryAll(container, '[data-conflict-id]')].map((node) => node.dataset.conflictId);
async function render() {await act(async () => {root.render(<Queue conflicts={conflicts} scope={scope} onResolve={resolve} onRefresh={refresh} {...props} />);await flush();});}
async function click(node) {expect(node).toBeTruthy();await act(async () => {node.click();await flush();});}
async function change(label, value) {await (async () => {
  const node = field(label);
  await changeUiValue(node, value, ['input', 'change']);
  await act(flush);
})();}
beforeEach(() => {
  actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');document.body.appendChild(container);root = createRoot(container);
  conflicts = riskFixture();resolve = vi.fn().mockResolvedValue(true);refresh = vi.fn().mockResolvedValue(true);props = {};
});
afterEach(async () => {
  await act(async () => {root.unmount();await flush();});container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment;vi.restoreAllMocks();
});
it('labels side-specific deletion, recycling and missing snapshots before opening reviews', async () => {
  await render();
  expect(uiText(container)).toContain('远端：永久删除');expect(uiText(container)).toContain('本机：在回收站');
  expect(uiText(container)).toContain('版本快照缺失（不等于删除）');expect(uiText(container)).toContain('本机：状态待核实');
  expect(uiQuery(container, '[aria-label="冲突版本对照"]')).toBeNull();
  expect(resolve).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('shows overlapping counts with an explicit caveat and combines all three filters', async () => {
  await render();expect(await uiOptionsText(field('冲突关注项'))).toContain('含永久删除（3）');
  expect(await uiOptionsText(field('冲突关注项'))).toContain('含回收站（2）');
  expect(uiText(container)).toContain('各类关注项可能重叠');
  await change('冲突关注项', 'permanent');await change('冲突对象类型', 'attachment');await change('搜索冲突', '资料😀');
  expect(cards()).toEqual(['attachment-conflict']);
  expect(await uiOptionsText(field('冲突关注项'))).toContain('含永久删除（3）');
  expect(resolve).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('clears every condition together and resets page without handling a conflict', async () => {
  await render();await change('冲突关注项', 'permanent');await change('冲突对象类型', 'attachment');
  expect(cards()).toHaveLength(1);await click(button('清空筛选'));
  expect(uiValue(field('冲突关注项'))).toBe('all');expect(uiValue(field('冲突对象类型'))).toBe('all');expect(cards()).toHaveLength(7);
  expect(uiDisabled(button('清空筛选'))).toBe(true);expect(resolve).not.toHaveBeenCalled();
});
it('changing concern revokes a previous review even when the same record is still visible', async () => {
  conflicts = [riskFixture()[1]];await render();await click(button('保留本机'));
  await click(uiQuery(container, 'input[type="checkbox"]'));expect(uiDisabled(button('确认处理此冲突'))).toBe(false);
  await change('冲突关注项', 'permanent');expect(uiQuery(container, '[aria-label="冲突版本对照"]')).toBeNull();
  await change('冲突关注项', 'all');await click(button('保留本机'));
  expect(uiQuery(container, 'input[type="checkbox"]').checked).toBe(false);
  expect(uiDisabled(button('确认处理此冲突'))).toBe(true);expect(resolve).not.toHaveBeenCalled();
});
it('an unchanged refresh retains valid explicit consent instead of behaving like user browsing', async () => {
  conflicts = [riskFixture()[1]];await render();await click(button('保留本机'));await click(uiQuery(container, 'input[type="checkbox"]'));
  conflicts = structuredClone(conflicts);await render();
  expect(uiQuery(container, 'input[type="checkbox"]').checked).toBe(true);
  expect(uiDisabled(button('确认处理此冲突'))).toBe(false);expect(resolve).not.toHaveBeenCalled();
});
it('pending submission blocks a same-turn risk-filter change and preserves the original review', async () => {
  let finish;resolve.mockImplementation(() => new Promise((r) => {finish = r;}));
  conflicts = [riskFixture()[1]];await render();await click(button('保留本机'));await click(uiQuery(container, 'input[type="checkbox"]'));
  const selector = field('冲突关注项');
  const selectOption = await prepareUiSelectChange(selector, 'missing');
  await act(async () => {button('确认处理此冲突').click();selectOption();await flush();});
  expect(resolve).toHaveBeenCalledTimes(1);expect(uiValue(selector)).toBe('all');expect(uiDisabled(selector)).toBe(true);
  expect(cards()).toEqual(['conflict-002']);
  await act(async () => {finish(false);await flush();});
});
it('stale or unsaved state still permits inspection but never re-enables resolution', async () => {
  props.disabled = true;await render();await change('冲突关注项', 'permanent');
  expect(cards()).toHaveLength(3);expect(uiDisabled(button('保留本机'))).toBe(true);
  expect(resolve).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('busy state disables concern controls just like existing type/search controls', async () => {
  props.busy = true;await render();expect(uiDisabled(field('冲突关注项'))).toBe(true);
  expect(uiDisabled(field('冲突对象类型'))).toBe(true);expect(uiDisabled(field('搜索冲突'))).toBe(true);
});
it('filtered pagination reaches the final risky record and resets on another filter', async () => {
  conflicts = queueFixture(25);conflicts.forEach((c) => {c.remote_record = tombstone(c.remote_record);});
  await render();await change('冲突关注项', 'permanent');await click(button('下一页冲突'));await click(button('下一页冲突'));
  expect(cards()).toHaveLength(5);expect(cards().at(-1)).toBe('conflict-025');
  await change('冲突关注项', 'missing');expect(cards()).toHaveLength(0);
  expect(uiText(container)).toContain('没有匹配的冲突，不代表冲突已解决');
  expect(uiText(container)).toContain('第 1 / 1 页');expect(resolve).not.toHaveBeenCalled();
});
it('refreshed metadata recomputes concern counts and cannot resurrect a missing review', async () => {
  conflicts = queueFixture(1);await render();await change('冲突关注项', 'permanent');expect(cards()).toHaveLength(0);
  conflicts = [{ ...conflicts[0], remote_record: tombstone(conflicts[0].remote_record) }];await render();
  expect(cards()).toHaveLength(1);expect(await uiOptionsText(field('冲突关注项'))).toContain('含永久删除（1）');
  expect(uiQuery(container, '[aria-label="冲突版本对照"]')).toBeNull();expect(resolve).not.toHaveBeenCalled();
});
it('unknown lifecycle status remains non-actionable even through concern filtering', async () => {
  conflicts = queueFixture(1);conflicts[0].status = 'resolved';await render();await change('冲突关注项', 'unknown');
  expect(cards()).toHaveLength(1);expect(button('保留本机')).toBeUndefined();
  expect(uiText(container)).toContain('记录未确认处于待处理状态');expect(resolve).not.toHaveBeenCalled();
});
it('risk browsing cannot change the object or direction passed to the existing explicit resolver', async () => {
  conflicts = [riskFixture()[1]];const original = JSON.stringify(conflicts);
  await render();await change('冲突关注项', 'permanent');await click(button('采用远端'));
  expect(resolve).not.toHaveBeenCalled();await click(uiQuery(container, 'input[type="checkbox"]'));await click(button('确认处理此冲突'));
  expect(resolve).toHaveBeenCalledTimes(1);expect(resolve.mock.calls[0][0].id).toBe('conflict-002');
  expect(resolve.mock.calls[0][1]).toBe('remote');expect(JSON.stringify(conflicts)).toBe(original);
});

// Real Queue + Review: only their external callbacks are mocked.
const attachmentIdentityFixture = (id = 'identity-attachment', name = '资料😀.pdf') => {
  const c = queueAttachment(id, name);
  c.remote_record = structuredClone(c.local_record);
  return c;
};
it('inconsistent tombstone kinds enter unverified concerns rather than permanent-deletion counts', async () => {
  conflicts = queueFixture(1);
  conflicts[0].remote_record = { ...tombstone(conflicts[0].remote_record), kind: 'tag' };
  await render();
  expect(await uiOptionsText(field('冲突关注项'))).toContain('状态待核实（1）');
  expect(await uiOptionsText(field('冲突关注项'))).toContain('含永久删除（0）');
  expect(uiText(uiQuery(container, '[aria-label="删除与缺失提示"]'))).toBe('远端：状态待核实');
  await change('冲突关注项', 'permanent');expect(cards()).toHaveLength(0);
  await change('冲突关注项', 'unknown');expect(cards()).toEqual(['conflict-001']);
  expect(resolve).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('a mismatched attachment name is discoverable by unverified concern and cannot bypass the original review validator', async () => {
  conflicts = [attachmentIdentityFixture()];conflicts[0].local_record.attachment.name = 'wrong.pdf';
  await render();await change('冲突关注项', 'unknown');await change('冲突对象类型', 'attachment');await change('搜索冲突', 'wrong.pdf');
  expect(cards()).toEqual(['identity-attachment']);
  expect(uiText(uiQuery(container, '[aria-label="删除与缺失提示"]'))).toBe('本机：状态待核实');
  await click(button('保留本机'));
  expect(uiQuery(container, '[aria-label="冲突版本对照"]')).toBeNull();
  expect(uiText(container)).toContain('冲突版本信息不完整或格式不受支持');
  expect(resolve).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('valid exact Unicode attachment identity preserves the explicit resolver flow', async () => {
  conflicts = [attachmentIdentityFixture('unicode-attachment', '\ufeff资料😀.pdf')];
  await render();expect(await uiOptionsText(field('冲突关注项'))).toContain('状态待核实（0）');
  await click(button('保留本机'));expect(resolve).not.toHaveBeenCalled();
  await click(uiQuery(container, 'input[type="checkbox"]'));await click(button('确认处理此冲突'));
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve.mock.calls[0][0].local_record.attachment.name).toBe('\ufeff资料😀.pdf');
  expect(resolve.mock.calls[0][1]).toBe('local');
});
it('a corrected reread updates the concern filter without selecting or resolving the record', async () => {
  conflicts = [attachmentIdentityFixture()];const good = structuredClone(conflicts);
  conflicts[0].local_record.attachment.name = 'wrong.pdf';
  await render();await change('冲突关注项', 'unknown');expect(cards()).toHaveLength(1);
  conflicts = good;await render();expect(cards()).toHaveLength(0);
  expect(await uiOptionsText(field('冲突关注项'))).toContain('状态待核实（0）');
  await change('冲突关注项', 'all');expect(cards()).toHaveLength(1);
  expect(uiQuery(container, '[aria-label="冲突版本对照"]')).toBeNull();
  expect(resolve).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('an observed identity mismatch revokes an existing confirmation even when the exact valid version returns', async () => {
  conflicts = [attachmentIdentityFixture()];const good = structuredClone(conflicts);
  await render();await click(button('保留本机'));await click(uiQuery(container, 'input[type="checkbox"]'));
  expect(uiDisabled(button('确认处理此冲突'))).toBe(false);
  conflicts = structuredClone(good);conflicts[0].local_record.attachment.name = 'wrong.pdf';await render();
  expect(await uiOptionsText(field('冲突关注项'))).toContain('状态待核实（1）');
  expect(uiDisabled(button('确认处理此冲突'))).toBe(true);
  conflicts = structuredClone(good);await render();
  expect(await uiOptionsText(field('冲突关注项'))).toContain('状态待核实（0）');
  expect(uiDisabled(button('确认处理此冲突'))).toBe(true);
  expect(uiQuery(container, 'input[type="checkbox"]').checked).toBe(false);
  expect(resolve).not.toHaveBeenCalled();
});
it('all invalid-identity records remain reachable in the unverified filter without automatic requests', async () => {
  conflicts = Array.from({ length: 25 }, (_, i) => {
    const c = attachmentIdentityFixture('identity-' + i, 'original-' + i + '.txt');
    c.local_record.attachment.name = 'wrong-' + i + '.txt';
    return c;
  });
  await render();await change('冲突关注项', 'unknown');
  expect(await uiOptionsText(field('冲突关注项'))).toContain('状态待核实（25）');
  await click(button('下一页冲突'));await click(button('下一页冲突'));
  expect(cards()).toEqual(['identity-20', 'identity-21', 'identity-22', 'identity-23', 'identity-24']);
  expect(resolve).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
