// Actual App routes for a separately seeded, owned local-lab profile.
// All mutations below are transient UI selection; no conflict is submitted.
import assert from 'node:assert/strict'
import { captureConflictReview, conflictScope } from '../src/services/syncConflictReview.mjs'
import { parseConflictHistory } from '../src/services/syncConflictHistory.mjs'
import { buildLocalSyncLabRows, LOCAL_SYNC_LAB_COUNTS } from './full-app-ui-local-sync-seed.mjs'

const q = JSON.stringify
const route = (id, title, name, root, requiredStates) => ({ id, title, source: 'src/components/' + name + '.jsx', root, requiredStates })
export const localSyncLabRoutes = Object.freeze([
  route('lab-sync-plan', '本机只读同步计划', 'SyncPlanPanel', '.sync-plan-view', ['controls', 'next-page']),
  route('lab-sync-queue', '合成待处理冲突队列', 'SyncConflictQueue', '.sync-conflict-queue', ['controls', 'next-page']),
  route('lab-sync-review', '合成冲突两端对照与取消', 'SyncConflictReview', '.sync-conflict-review', ['open', 'unsubmitted-choice']),
  route('lab-sync-diff', '合成正文差异定位', 'SyncConflictDiff', '.sync-conflict-diff', ['first-group', 'next-page', 'next-group']),
  route('lab-sync-history', '实际本机合成历史读取', 'SyncConflictHistoryPanel', '.sync-conflict-history-body', ['loaded', 'earlier-records']),
])

export async function prepareLocalSyncLab(ctx) {
  const seed = ctx.report.localSyncLabSeed
  assert.equal(seed?.complete, true); assert.deepEqual(seed.expectedCounts, LOCAL_SYNC_LAB_COUNTS)
  const settings = await ctx.api('/api/settings'), status = await ctx.api('/api/sync/status')
  assert.equal(settings.sync_enabled, true); assert.equal(settings.sync_provider, 'local-lab'); assert.equal(settings.sync_auto_enabled, false)
  for (const key of ['sync_endpoint', 'sync_username', 'sync_password']) assert.ok(!settings[key])
  assert.ok(!settings.sync_password_set); assert.equal(status.remote_store_id, ''); assert.equal(status.remote_revision, '')
  assert.equal(status.base_items, 0); assert.equal(status.open_conflicts, LOCAL_SYNC_LAB_COUNTS.open)
  const files = await Promise.all(seed.noteIDs.map(id => ctx.api('/api/files/' + encodeURIComponent(id))))
  assert.deepEqual(files, seed.files, 'Restarted actual App did not retain the exact seeded source files')
  const expected = buildLocalSyncLabRows(files), conflicts = await ctx.api('/api/sync/conflicts'), scope = conflictScope(settings, status)
  assert.ok(scope); assert.equal(conflicts.length, LOCAL_SYNC_LAB_COUNTS.open)
  for (const row of conflicts) {
    const original = expected.rows.find(item => item.id === row.id)
    assert.ok(original && original.status === 'open')
    for (const key of ['id', 'item_id', 'base_hash', 'local_hash', 'remote_hash', 'created_at', 'status', 'resolution']) assert.equal(row[key], original[key])
    assert.deepEqual(row.local_record, JSON.parse(original.local_record)); assert.deepEqual(row.remote_record, JSON.parse(original.remote_record))
    captureConflictReview(row, scope)
  }
  const first = parseConflictHistory(await ctx.api('/api/sync/conflicts/history?filter=all&limit=25'), 'all')
  assert.equal(first.items.length, 25); assert.equal(first.hasMore, true)
  const last = parseConflictHistory(await ctx.api('/api/sync/conflicts/history?filter=all&limit=25&before=' + encodeURIComponent(first.nextCursor)), 'all')
  assert.equal(last.items.length, 1); assert.equal(last.hasMore, false)
  assert.equal(new Set([...first.items, ...last.items].map(item => item.id)).size, LOCAL_SYNC_LAB_COUNTS.history)
  for (const item of [...first.items, ...last.items]) {
    const original = expected.rows.find(row => row.id === item.id), file = files.find(row => row.id === original?.item_id)
    assert.ok(original && original.status !== 'open' && file)
    assert.deepEqual(item, { id: original.id, itemID: original.item_id, kind: 'file', title: file.title,
      createdAt: original.created_at, resolvedAt: original.resolved_at, status: original.status, resolution: original.resolution || 'unknown' })
  }
  return { localSyncLab: { settings, status, files, conflicts, history: [...first.items, ...last.items], scope }, noteIDs: [...seed.noteIDs] }
}

export async function verifyLocalSyncLabPages(ctx) {
  const { shared, evaluate, click, until } = ctx
  const setup = ctx.setup.localSyncLab, ui = ctx.report.fullAppUi
  const present = selector => until(() => evaluate(`Boolean(document.querySelector(${q(selector)}))`), 'Actual local-lab region missing: ' + selector)
  const hit = (selector, text) => click(text === undefined ? selector : { selector, text })
  const shot = (routeId, stateId, anchors, requiredText = []) => shared.captureState({ routeId, stateId, anchors, requiredText })
  const focus = (routeId, stateId, selector) => shared.focus(selector, { routeId, stateId })
  const select = (routeId, stateId, selector) => shared.select(selector, { routeId, stateId, captureScene: false })
  await shared.openSettings()
  await until(() => evaluate('document.querySelectorAll(".sync-queue-row").length===10'), 'Actual seeded conflict queue did not load')

  // The sole allowed sync POST is this existing read-only local-lab preview.
  const previousPlans = ui.localSyncLab.allowedPlanRequests.length
  await hit('[data-sync-section="execution"] button', '预演同步')
  await present('.sync-plan-view')
  const planRequest = await until(() => {
    assert.ok(ui.localSyncLab.allowedPlanRequests.length <= previousPlans + 1, 'A single actual preview made more than one plan request')
    const request = ui.localSyncLab.allowedPlanRequests[previousPlans]
    return request?.complete === true && request
  }, 'Actual read-only preview response was not captured and validated')
  await until(() => evaluate('document.querySelector(".sync-plan-counts")?.textContent.includes("上传 21")'), 'Actual read-only plan does not match the 21 owned files')
  assert.equal(await evaluate('Boolean(document.querySelector(".sync-plan-notice[role=alert]"))'), false)
  const planInput = '.sync-plan-view input[aria-label="同步计划搜索"]'
  await focus('lab-sync-plan', 'controls', planInput)
  await select('lab-sync-plan', 'controls', '.sync-plan-view [role="combobox"][aria-label="同步计划方向"]')
  await shot('lab-sync-plan', 'controls', [planInput], ['预演快照（只读）', '上传 21', '首次执行才会创建仓库身份'])
  await hit('.sync-plan-pagination button', '下一页')
  await until(() => evaluate('document.querySelector(".sync-plan-pagination")?.textContent.includes("第 2 / 2 页")'), 'Actual plan pagination did not advance')
  await shot('lab-sync-plan', 'next-page', ['.sync-plan-pagination > span'])
  await hit('.sync-plan-pagination button', '上一页')

  const queueInput = '.sync-conflict-queue input[aria-label="搜索冲突"]'
  await focus('lab-sync-queue', 'controls', queueInput)
  for (const label of ['冲突对象类型', '冲突关注项', '冲突查看顺序']) await select('lab-sync-queue', 'controls', '.sync-conflict-queue [role="combobox"][aria-label=' + q(label) + ']')
  await shot('lab-sync-queue', 'controls', [queueInput], ['当前列表 21 条', '不会自动覆盖'])
  await hit('.sync-queue-pagination button', '下一页冲突')
  await until(() => evaluate('document.querySelector(".sync-queue-pagination")?.textContent.includes("第 2 / 3 页")'), 'Actual conflict pagination did not advance')
  await shot('lab-sync-queue', 'next-page', ['.sync-queue-pagination > span'])

  // Search selects a real existing row; no captured conflict is injected.
  await shared.text(queueInput, setup.files[0].id)
  const row = '.sync-queue-row[data-conflict-id="ui-lab-open-01"]'
  await until(() => evaluate(`document.querySelectorAll('.sync-queue-row').length===1&&Boolean(document.querySelector(${q(row)}))`), 'Actual first conflict was not found by its real object ID')
  await hit(row + ' .sync-conflict-actions button', '对照版本')
  await present('.sync-conflict-review')
  await focus('lab-sync-review', 'open', '.sync-review-heading button')
  await shot('lab-sync-review', 'open', ['.sync-review-heading h4'], ['先对照，再确认处理'])
  await hit('.sync-review-choice label:first-of-type input')
  await hit('.sync-review-ack input')
  assert.equal(await evaluate('document.querySelector(".sync-review-footer .primary")?.disabled'), false)
  await shot('lab-sync-review', 'unsubmitted-choice', ['.sync-review-footer .primary'], ['将以本机版本更新远端'])
  // Deliberately never activate the enabled submit button.
  await hit('.sync-review-ack input')
  assert.equal(await evaluate('document.querySelector(".sync-review-footer .primary")?.disabled'), true)

  await hit('.sync-diff-heading button', '查看正文差异')
  await present('.sync-diff-details')
  await focus('lab-sync-diff', 'first-group', '.sync-diff-heading button')
  await shot('lab-sync-diff', 'first-group', ['.sync-diff-navigation[aria-label="正文差异位置"] strong'])
  await hit('.sync-diff-navigation[aria-label="本处差异分页"] button', '下一页差异行')
  await until(() => evaluate('document.querySelector(".sync-diff-navigation[aria-label=\"本处差异分页\"]")?.textContent.includes("第 2 / 2 页")'), 'Actual diff paging did not advance')
  await shot('lab-sync-diff', 'next-page', ['.sync-diff-navigation[aria-label="本处差异分页"] > span'])
  await hit('.sync-diff-navigation[aria-label="正文差异位置"] button', '下一处差异')
  await until(() => evaluate('document.querySelector(".sync-diff-navigation[aria-label=\"正文差异位置\"] strong")?.textContent.includes("第 2 / 2 处差异")'), 'Actual second change group was not reached')
  await shot('lab-sync-diff', 'next-group', ['.sync-diff-navigation[aria-label="正文差异位置"] strong'])
  await hit('.sync-review-heading button', '收起对照')
  await until(() => evaluate('!document.querySelector(".sync-conflict-review")'), 'Actual conflict review did not close')
  await shared.text(queueInput, '')

  const historyRoot = '.sync-conflict-history-body'
  await hit('[data-sync-conflict-history] > summary')
  await hit(historyRoot + ' [data-history-read]')
  await until(() => evaluate('document.querySelectorAll("[data-history-row]").length===25'), 'Actual local history did not read its first page')
  await focus('lab-sync-history', 'loaded', historyRoot + ' input[data-history-query]')
  for (const label of ['冲突记录类型', '筛选记录对象类型', '筛选记录处理结果']) await select('lab-sync-history', 'loaded', historyRoot + ' [role="combobox"][aria-label=' + q(label) + ']')
  await until(() => evaluate('document.querySelectorAll("[data-history-row]").length===25&&Boolean(document.querySelector("[data-history-more]"))'), 'Restored actual history filter did not retain the first page')
  await shot('lab-sync-history', 'loaded', [historyRoot + ' input[data-history-query]'], ['已读取 25 条记录'])
  await hit('[data-history-more]')
  await until(() => evaluate('document.querySelectorAll("[data-history-row]").length===26&&!document.querySelector("[data-history-more]")'), 'Actual earlier history was not appended')
  await shot('lab-sync-history', 'earlier-records', ['.sync-conflict-history-feedback'], ['已读取 26 条记录'])
  await hit('[data-sync-conflict-history] > summary')

  const after = await ctx.api('/api/sync/conflicts')
  assert.deepEqual(after, setup.conflicts, 'Viewing or cancelling changed the real open conflict rows')
  ui.localSyncLab.viewReceipts.push({ ...ctx.matrix, planRequestId: planRequest.requestId, openConflictsUnchanged: true, historyRead: 26,
    previewOnly: true, choiceCancelled: true, resolveCalled: false })
  ctx.save(); await shared.closeSettings()
}
