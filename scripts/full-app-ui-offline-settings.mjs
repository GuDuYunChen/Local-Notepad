import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { prepareHistoryExport } from '../src/services/syncHistoryExport.mjs'
import { parseHistoryFile } from '../src/services/syncHistoryFile.mjs'
import { HISTORY_FILE_FILTER_ALL, selectHistoryFilePage } from '../src/services/syncHistoryFileSelection.mjs'
import { conflictHistoryURL, parseConflictHistory } from '../src/services/syncConflictHistory.mjs'
import { SYNC_CLOCK_PREFERENCE_KEY } from '../src/services/syncClockPreference.mjs'
import { prepareLocalOverviewReport } from '../src/services/s3LocalOverviewReport.mjs'
import { parseLocalOverviewFile } from '../src/services/s3LocalOverviewFile.mjs'
import { compareOfflineReportPair } from '../src/services/s3OfflineReportPair.mjs'
import { offlinePairOrderedRows } from '../src/services/s3OfflinePairOrder.mjs'
import { comparisonDelta } from '../src/services/s3LocalOverviewComparison.mjs'

const historyRoot = '[data-history-file-viewer]'
const identifiersRoot = '[data-history-file-row]:first-child [data-history-file-identifiers]'
const datesRoot = '[data-history-file-date-filter] [data-history-time-filter]'
const historyLiveRoot = '[data-sync-conflict-history]'
const pairRoot = '[data-offline-pair]'

export const offlineSettingsRoutes = [
  { id: 'local-sync-clock', title: '同步时间显示与只读偏好', source: 'src/components/SyncOverviewTimes.jsx', root: '.sync-clock-controls',
    stateRoots: { preference: '[data-sync-clock-preference]', restored: '[data-sync-clock-feedback]' }, requiredStates: ['utc', 'local', 'preference', 'restored'] },
  { id: 'local-sync-activity', title: '本机当前任务空态', source: 'src/components/SyncActivityPanel.jsx', root: '.sync-activity', requiredStates: ['idle', 'refreshed'] },
  { id: 'local-sync-diagnostic', title: '本机诊断摘要', source: 'src/components/SyncDiagnosticPanel.jsx', root: '.sync-diagnostic-panel', requiredStates: ['default', 'generated', 'selected'] },
  { id: 'local-sync-history', title: '本机冲突历史空态', source: 'src/components/SyncConflictHistoryPanel.jsx', root: historyLiveRoot, requiredStates: ['unread', 'empty', 'type-popup'] },
  { id: 'local-sync-history-export', title: '本机历史导出拒绝条件', source: 'src/components/SyncHistoryExport.jsx', root: '[data-sync-conflict-history] [data-history-export]', requiredStates: ['unread', 'empty'] },
  { id: 'offline-history-file', title: '离线历史文件查看', source: 'src/components/SyncHistoryFileViewer.jsx', root: historyRoot,
    requiredStates: ['default', 'populated-filtered', 'kind-popup', 'outcome-popup', 'order-popup', 'query-empty', 'object-filtered', 'record-filtered', 'invalid-retained', 'version-two', 'cleared'] },
  { id: 'offline-history-identifiers', title: '离线历史完整标识', source: 'src/components/SyncHistoryFileIdentifiers.jsx', root: identifiersRoot, requiredStates: ['expanded', 'selected-object', 'selected-record'] },
  { id: 'offline-history-pagination', title: '离线历史分页和跳页', source: 'src/components/SyncHistoryFilePagination.jsx', root: '.sync-history-file-pages', requiredStates: ['first', 'second', 'invalid-jump', 'restored'] },
  { id: 'offline-history-dates', title: '离线历史日期筛选', source: 'src/components/SyncHistoryTimeFilter.jsx', root: datesRoot, requiredStates: ['default', 'mode-popup', 'range-draft', 'invalid-range', 'missing-applied', 'restored'] },
  { id: 'local-inventory-report', title: '真实本机统计报告控件', source: 'src/components/S3LocalOverviewReport.jsx', root: '[data-local-report]', requiredStates: ['available'] },
  { id: 'offline-inventory-file', title: '离线统计文件查看', source: 'src/components/S3LocalOverviewFile.jsx', root: '[data-local-report-file]', requiredStates: ['default', 'invalid', 'populated', 'cleared'] },
  { id: 'offline-inventory-comparison', title: '文件与本次本机统计比较', source: 'src/components/S3LocalOverviewComparison.jsx', root: '[data-local-comparison]', requiredStates: ['ready', 'compared', 'differences', 'cleared'] },
  { id: 'offline-inventory-export', title: '完整本机统计比较导出控件', source: 'src/components/S3LocalOverviewComparison.jsx', root: '[data-local-compare-export-panel]', requiredStates: ['formats'] },
  { id: 'offline-report-pair', title: '两份离线统计报告比较', source: 'src/components/S3OfflineReportPair.jsx', root: pairRoot,
    requiredStates: ['default', 'one-report', 'both-ready', 'compared', 'direction-popup', 'scope-popup', 'order-popup', 'empty-filter', 'restored', 'swapped', 'invalid-replacement', 'reset'] },
  { id: 'offline-report-export', title: '双报告完整概览与导出控件', source: 'src/components/S3OfflinePairExport.jsx', root: '[data-offline-export]', requiredStates: ['formats', 'filtered', 'swapped'] },
]

const q = JSON.stringify
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const noMatch = 'ONLY-SYNTHETIC-NO-MATCH-000000'
const historyProjection = row => ({ id: row.id, itemID: row.itemID, title: row.title })
const pairProjection = row => ({ key: row.key, a: String(row.a), b: String(row.b), delta: comparisonDelta(row.delta), unit: row.unit })

// These are explicitly synthetic FILE declarations, never a native scan,
// remote plan, persisted conflict record or receipt for an existing workspace.
export async function prepareOfflineSettings(ctx) {
  assert.equal(typeof ctx.writeFixtureFile, 'function', 'The runner must own every selected input file')
  assert.ok(Array.isArray(ctx.report?.fixtureInputs))
  const namespace = 'offline-' + randomUUID().slice(0, 8), query = namespace + '-LONG'
  const records = Array.from({ length: 31 }, (_, index) => ({
    id: namespace + '-record-' + String(index).padStart(2, '0'),
    itemID: namespace + '-object-' + index % 9 + '-完整中文标识-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    title: index < 3 ? `${query} ${index + 1}：较长中文标题用于检查离线记录换行、对象限定和原始标识完整保留` : `${namespace} 分页记录 ${String(index).padStart(2, '0')}`,
    kind: ['file', 'tag', 'file-tag', 'attachment'][index % 4],
    status: index % 5 === 0 ? 'superseded' : 'resolved',
    resolution: index % 5 === 0 ? 'remote-rebind' : index % 2 ? 'remote' : 'local',
    createdAt: 1735689600 + index * 86400,
    resolvedAt: index % 10 === 0 ? 0 : 1735693200 + index * 86400,
  }))
  const snapshot = { filter: 'all', hasMore: true, items: records }
  const time = new Date('2025-02-01T12:34:56.000Z')
  const history = prepareHistoryExport({ snapshot, phase: 'ready' }, time)
  const historyMissing = prepareHistoryExport({ snapshot, phase: 'ready', timeFilter: { mode: 'missing', from: '', to: '' } }, time)
  const parsedHistory = parseHistoryFile(history.raw), parsedMissing = parseHistoryFile(historyMissing.raw)
  assert.equal(parsedHistory.version, 1); assert.equal(parsedHistory.records.length, 31)
  assert.equal(parsedMissing.version, 2); assert.equal(parsedMissing.records.length, 4)
  assert.equal(parsedMissing.filters.timeFilter.mode, 'missing')
  const observation = (counts, sizes, attachmentBytes, baseItems) => ({
    format: 'local-notepad-s3-local-candidate-overview', version: 1, read_only: true, observed_stable: true, complete_for_preview: false,
    records: counts.reduce((sum, value) => sum + value, 0), record_bytes: sizes.reduce((sum, value) => sum + value, 0),
    attachment_bytes: attachmentBytes, base_items: baseItems,
    kinds: ['file', 'tag', 'file-tag', 'attachment'].map((kind, index) => ({ kind, records: counts[index], record_bytes: sizes[index] })),
  })
  const reportA = prepareLocalOverviewReport(observation([3, 2, 0, 1], [300, 20, 0, 10], 10, 5), time.getTime())
  const reportB = prepareLocalOverviewReport(observation([6, 1, 2, 1], [600, 40, 20, 10], 20, 2), time.getTime() + 1000)
  const parsedA = parseLocalOverviewFile(reportA.raw), parsedB = parseLocalOverviewFile(reportB.raw)
  const expectedPair = compareOfflineReportPair(parsedA, parsedB)
  assert.equal(expectedPair.rows.length, 12); assert.ok(expectedPair.rows.some(row => row.delta < 0) && expectedPair.rows.some(row => row.delta > 0))
  assert.equal(offlinePairOrderedRows(expectedPair, true, 'decrease', 'bytes', 'original').length, 0)
  const invalid = '{"incomplete":'
  assert.throws(() => parseHistoryFile(invalid)); assert.throws(() => parseLocalOverviewFile(invalid))
  const write = async (suffix, raw) => {
    const name = namespace + '-' + suffix + '.json', bytes = Buffer.from(raw, 'utf8')
    const file = await ctx.writeFixtureFile({ name, bytes })
    assert.equal(file?.name, name); assert.equal(file?.bytes, bytes.length); assert.equal(file?.sha256, sha(bytes))
    assert.equal(typeof file.path, 'string'); assert.ok(file.path.length)
    assert.equal(ctx.report.fixtureInputs.filter(item => item.path === file.path).length, 1)
    assert.deepEqual(ctx.report.fixtureInputs.find(item => item.path === file.path), file, 'Prepared bytes must identify exactly one runner-owned input')
    return file
  }
  const files = { history: await write('history-v1', history.raw), historyMissing: await write('history-v2-missing', historyMissing.raw),
    reportA: await write('inventory-a', reportA.raw), reportB: await write('inventory-b', reportB.raw), invalid: await write('invalid', invalid) }
  return { noteIDs: [], offlineSettings: { namespace, query, files, history: parsedHistory, historyMissing: parsedMissing,
    reportA: parsedA, reportB: parsedB, expectedPair, scope: 'owned-synthetic-offline-files-only',
    openCoverage: [
      { source: 'src/components/SyncPlanPanel.jsx', reason: 'The real App renders no plan while sync is disabled and no legitimate preview snapshot exists; no sync/preview operation or injected plan is permitted.' },
      { source: 'src/components/SyncConflictQueue.jsx', reason: 'This isolated profile has no pending sync conflicts; queue/review/diff populated states remain outside this actual App matrix. Independent current component-native evidence retains its own narrower provenance.' },
      { source: 'src/components/SyncHistoryExport.jsx', reason: 'The real local history is empty. Unread/empty export refusals are observed; offline file rows are not represented as exportable local conflicts.' },
      { source: 'src/components/SyncActivityPanel.jsx', reason: 'Idle and explicit GET refresh are observed; active/cancel states require a real sync task and are not fabricated.' },
      { source: 'src/components/S3OfflineBatchDrop.jsx', reason: 'Two-file batch and native drag payload workflows are not substituted with single-file input or synthetic DOM events; the existing independent native gates retain their original scope.' },
      { source: 'src/components/S3OfflinePairExport.jsx', reason: 'Actual enabled JSON/CSV/HTML controls and full twelve-metric ownership are observed; this module does not request unowned downloads or claim a saved export.' },
      { source: 'src/components/S3LocalOverviewReport.jsx', reason: 'Actual report controls are observed after a genuine local read; no system clipboard write or unowned download is requested.' },
    ] } }
}

export async function verifyOfflineSettingsPages(ctx) {
  const { api, evaluate, click, until, shared, setup, matrix, report, save } = ctx
  const fixture = setup.offlineSettings
  assert.equal(fixture?.scope, 'owned-synthetic-offline-files-only')
  const route = id => { const found = offlineSettingsRoutes.find(item => item.id === id); assert.ok(found); return found }
  const rootOf = (id, state) => route(id).stateRoots?.[state] ?? route(id).root
  const exists = selector => evaluate(`Boolean(document.querySelector(${q(selector)}))`)
  const present = selector => until(() => exists(selector), 'Actual offline UI is missing: ' + selector)
  const absent = selector => until(async () => !(await exists(selector)), 'Actual offline UI did not clear: ' + selector)
  const contains = (selector, value) => until(() => evaluate(`document.querySelector(${q(selector)})?.textContent.includes(${q(value)})===true`), 'Actual offline result text is missing: ' + value)
  const ready = selector => until(() => evaluate(`(()=>{const n=document.querySelector(${q(selector)});return !!n&&!n.matches(':disabled')&&n.getAttribute('aria-disabled')!=='true'})()`), 'Actual offline control is not ready: ' + selector)
  const press = (root, text) => click({ selector: root + ' button', text })
  const shot = (id, state, anchors, requiredText = []) => shared.captureState({ routeId: id, stateId: state, root: rootOf(id, state), anchors, requiredText })
  const focus = (selector, id, state) => shared.focus(selector, { routeId: id, stateId: state })
  const openDetails = async selector => {
    await present(selector)
    if (!(await evaluate(`document.querySelector(${q(selector)}).open`))) await click(selector + ' > summary')
    await until(() => evaluate(`document.querySelector(${q(selector)})?.open===true`), 'Actual disclosure did not open: ' + selector)
  }
  const closeDetails = async selector => {
    if (await evaluate(`document.querySelector(${q(selector)})?.open===true`)) await click(selector + ' > summary')
    await until(() => evaluate(`document.querySelector(${q(selector)})?.open===false`), 'Actual disclosure did not close: ' + selector)
  }
  const readHistory = async () => {
    const raw = await api(conflictHistoryURL('all')), checked = parseConflictHistory(raw)
    assert.equal(checked.items.length, 0, 'The owned profile must not manufacture live conflict history for appearance tests')
    assert.equal(checked.hasMore, false); return raw
  }
  const before = { settings: await api('/api/settings'), history: await readHistory(),
    clock: await evaluate(`localStorage.getItem(${q(SYNC_CLOCK_PREFERENCE_KEY)})`) }
  assert.equal(before.settings.sync_enabled, false)
  assert.equal(before.clock, null, 'The new isolated matrix profile has no saved display preference')
  const evidence = { ...matrix, scope: fixture.scope, complete: false, selectedFiles: [], historyPages: [], pairViews: [], localComparison: null }
  ;(report.fullAppUi.offlineSettings ||= []).push(evidence); save()
  const choose = async (selector, file) => { const receipt = await shared.chooseFile(selector, file); evidence.selectedFiles.push({ selector, file: { ...file }, trusted: receipt.events.some(event => event.type === 'change' && event.trusted) }); save() }

  await shared.openSettings()
  await present('.sync-overview')
  await press('.sync-clock-controls', 'UTC')
  await focus('.sync-clock-controls button:first-of-type', 'local-sync-clock', 'utc')
  await shot('local-sync-clock', 'utc', ['.sync-clock-controls button:first-of-type'], ['UTC'])
  await press('.sync-clock-controls', '本机时区')
  assert.equal(await evaluate(`document.querySelector('.sync-clock-controls button:last-of-type').getAttribute('aria-pressed')`), 'true')
  await shot('local-sync-clock', 'local', ['.sync-clock-controls button:last-of-type'], ['本机时区'])
  await press('.sync-clock-controls', 'UTC')
  await openDetails('[data-sync-clock-preference]')
  await shot('local-sync-clock', 'preference', ['[data-sync-clock-restore]'], ['读取并使用已保存方式'])
  await click('[data-sync-clock-restore]')
  await contains('[data-sync-clock-feedback]', '没有已保存的时间偏好，当前显示保持不变。')
  await shot('local-sync-clock', 'restored', ['[data-sync-clock-feedback] p'], ['没有已保存的时间偏好'])
  await closeDetails('[data-sync-clock-preference]')

  await contains('.sync-activity', '当前没有正在执行的同步任务')
  await ready('.sync-activity button')
  await focus('.sync-activity button', 'local-sync-activity', 'idle')
  await shot('local-sync-activity', 'idle', ['.sync-activity button'], ['当前没有正在执行的同步任务'])
  await press('.sync-activity', '刷新任务状态'); await ready('.sync-activity button')
  await contains('.sync-activity', '当前没有正在执行的同步任务')
  assert.equal((await api('/api/sync/activity')).active, false)
  await shot('local-sync-activity', 'refreshed', ['.sync-activity button'], ['当前没有正在执行的同步任务'])
  await focus('.sync-diagnostic-heading button', 'local-sync-diagnostic', 'default')
  await shot('local-sync-diagnostic', 'default', ['.sync-diagnostic-heading button'], ['生成诊断摘要'])
  await press('.sync-diagnostic-panel', '生成诊断摘要')
  const diagnosticInput = '.sync-diagnostic-panel textarea[aria-label="可复制的诊断摘要"]'
  await present(diagnosticInput)
  const diagnostic = await evaluate(`document.querySelector(${q(diagnosticInput)}).value`)
  assert.ok(diagnostic.length > 30)
  await shot('local-sync-diagnostic', 'generated', [diagnosticInput], ['选择摘要'])
  await press('.sync-diagnostic-panel', '选择摘要')
  assert.deepEqual(await evaluate(`(()=>{const n=document.querySelector(${q(diagnosticInput)});return [n.value,n.selectionStart,n.selectionEnd]})()`), [diagnostic, 0, diagnostic.length])
  await shot('local-sync-diagnostic', 'selected', [diagnosticInput], ['收起诊断摘要'])
  await press('.sync-diagnostic-panel', '收起诊断摘要'); await absent(diagnosticInput)

  await openDetails(historyLiveRoot)
  await focus('[data-history-read]', 'local-sync-history', 'unread')
  await shot('local-sync-history', 'unread', ['[data-history-read]'], ['尚未读取。'])
  await focus('[data-history-export-button]', 'local-sync-history-export', 'unread')
  assert.equal(await evaluate(`document.querySelector('[data-history-export-button]').getAttribute('aria-disabled')`), 'true')
  await shot('local-sync-history-export', 'unread', ['[data-history-export-button]'], ['请先读取历史记录。'])
  await click('[data-history-read]'); await present('.sync-conflict-history-list')
  await contains('.sync-conflict-history-scroll', '本次读取没有历史记录。'); await absent('[data-history-stop]')
  await shot('local-sync-history', 'empty', ['[data-history-read]'], ['本次读取没有历史记录。'])
  await shared.select('[aria-label="冲突记录类型"]', { routeId: 'local-sync-history', stateId: 'type-popup', value: 'resolved', restore: true })
  await absent('[data-history-stop]'); await contains('.sync-conflict-history-scroll', '本次读取没有历史记录。')
  assert.equal(await evaluate(`document.querySelector('[data-history-export-button]').getAttribute('aria-disabled')`), 'true')
  await shot('local-sync-history-export', 'empty', ['[data-history-export-button]'], ['当前没有匹配记录。'])
  await closeDetails(historyLiveRoot)

  await openDetails(historyRoot)
  await focus('[data-history-file-choose]', 'offline-history-file', 'default')
  await shot('offline-history-file', 'default', ['[data-history-file-choose]'], ['尚未选择文件'])
  await choose('[data-history-file-input]', fixture.files.history)
  await contains('[data-history-file-notice]', '文件格式检查通过，共 31 条')
  const rows = () => evaluate(`Array.from(document.querySelectorAll('[data-history-file-row]'),n=>({id:n.querySelector('[data-history-file-selectable-id="record"]').textContent,itemID:n.querySelector('[data-history-file-selectable-id="object"]').textContent,title:n.querySelector('strong > bdi').textContent}))`)
  const verifyRows = async (filters = {}, page = 0, order = 'file', source = fixture.history) => {
    const selected = selectHistoryFilePage(source.records, { ...HISTORY_FILE_FILTER_ALL, ...filters }, page, order)
    const expected = selected.rows.map(historyProjection)
    await until(async () => q(await rows()) === q(expected), 'Actual offline history does not match the parsed file selection')
    assert.deepEqual(await rows(), expected)
    evidence.historyPages.push({ file: source === fixture.history ? fixture.files.history.name : fixture.files.historyMissing.name, filters, page: selected.page, order, matched: selected.matched, rows: expected }); save()
    return selected
  }
  await verifyRows()
  await focus('[data-history-file-jump-input]', 'offline-history-pagination', 'first')
  await shot('offline-history-pagination', 'first', ['[data-history-file-jump-input]'], ['第 1 / 2 页'])
  await click('[data-history-file-next]'); await verifyRows({}, 1)
  await shot('offline-history-pagination', 'second', ['[data-history-file-jump-input]'], ['第 2 / 2 页'])
  await shared.text('[data-history-file-jump-input]', '999'); await click('[data-history-file-jump]')
  await present('[data-history-file-jump-error]'); await verifyRows({}, 1)
  await shot('offline-history-pagination', 'invalid-jump', ['[data-history-file-jump-input]'])
  await shared.text('[data-history-file-jump-input]', '1'); await click('[data-history-file-jump]'); await verifyRows()
  await absent('[data-history-file-jump-error]')
  await shot('offline-history-pagination', 'restored', ['[data-history-file-jump-input]'], ['第 1 / 2 页'])
  // A real query narrows repeated row controls while preserving the declared
  // 31-row file. Pagination above observes both unfiltered actual pages.
  await shared.text('[data-history-file-query]', fixture.query); await verifyRows({ query: fixture.query })
  await shot('offline-history-file', 'populated-filtered', ['[data-history-file-query]'], [fixture.history.records[0].title, '文件内共 31 条'])
  for (const [field, state, value] of [['kind', 'kind-popup', 'tag'], ['outcome', 'outcome-popup', 'remote'], ['order', 'order-popup', 'completed-desc']]) {
    await shared.select('[data-history-file-' + field + ']', { routeId: 'offline-history-file', stateId: state, value, restore: true })
    await verifyRows({ query: fixture.query })
  }
  await openDetails(identifiersRoot)
  await focus(identifiersRoot + ' [data-history-file-select-id="object"]', 'offline-history-identifiers', 'expanded')
  await shot('offline-history-identifiers', 'expanded', [identifiersRoot + ' [data-history-file-select-id="object"]'], [fixture.history.records[0].itemID])
  for (const key of ['object', 'record']) {
    await click(identifiersRoot + ' [data-history-file-select-id=' + q(key) + ']')
    const expected = key === 'object' ? fixture.history.records[0].itemID : fixture.history.records[0].id
    assert.equal(await evaluate('window.getSelection().toString()'), expected)
    await shot('offline-history-identifiers', 'selected-' + key, [identifiersRoot + ' [data-history-file-select-id=' + q(key) + ']'], ['手动复制'])
  }
  await closeDetails(identifiersRoot)
  await shared.text('[data-history-file-query]', noMatch); await verifyRows({ query: noMatch })
  await shot('offline-history-file', 'query-empty', ['[data-history-file-query]'], ['本文件中没有符合当前条件的记录'])
  await shared.text('[data-history-file-query]', '')
  await verifyRows(); await click('[data-history-file-row]:first-child [data-history-file-filter-object]')
  await verifyRows({ itemID: fixture.history.records[0].itemID })
  await shot('offline-history-file', 'object-filtered', ['[data-history-file-object-filter-clear]'], ['当前精确限定对象'])
  await click('[data-history-file-row]:first-child [data-history-file-filter-record]')
  await verifyRows({ itemID: fixture.history.records[0].itemID, recordID: fixture.history.records[0].id })
  await shot('offline-history-file', 'record-filtered', ['[data-history-file-record-filter-clear]'], ['当前精确限定记录'])
  await click('[data-history-file-filter-clear]'); await verifyRows()
  await openDetails(datesRoot + ' [data-history-time-controls]')
  await focus(datesRoot + ' [data-history-time-apply]', 'offline-history-dates', 'default')
  await shot('offline-history-dates', 'default', [datesRoot + ' [data-history-time-apply]'], ['按文件内处理日期筛选'])
  await shared.select(datesRoot + ' [data-history-time-mode]', { routeId: 'offline-history-dates', stateId: 'mode-popup', value: 'missing', restore: true })
  await shared.nativeSelect.choose(datesRoot + ' [data-history-time-mode]', 'range')
  await present(datesRoot + ' [data-history-time-from]')
  await shot('offline-history-dates', 'range-draft', [datesRoot + ' [data-history-time-from]'], ['文件内日期条件尚未应用'])
  await click(datesRoot + ' [data-history-time-apply]'); await contains(datesRoot + ' [data-history-time-error]', '请至少填写一个日期')
  await verifyRows()
  await shot('offline-history-dates', 'invalid-range', [datesRoot + ' [data-history-time-apply]'], ['请至少填写一个日期'])
  await shared.nativeSelect.choose(datesRoot + ' [data-history-time-mode]', 'missing'); await click(datesRoot + ' [data-history-time-apply]')
  await verifyRows({ timeFilter: { mode: 'missing', from: '', to: '' } })
  await shot('offline-history-dates', 'missing-applied', [datesRoot + ' [data-history-time-apply]'], ['仅处理或失效时间缺失的记录'])
  await shared.nativeSelect.choose(datesRoot + ' [data-history-time-mode]', 'all'); await click(datesRoot + ' [data-history-time-apply]'); await verifyRows()
  await absent(datesRoot + ' [data-history-time-applied]')
  await shot('offline-history-dates', 'restored', [datesRoot + ' [data-history-time-apply]'], ['按文件内处理日期筛选'])
  await closeDetails(datesRoot + ' [data-history-time-controls]')
  await shared.text('[data-history-file-query]', fixture.query); await verifyRows({ query: fixture.query })
  await choose('[data-history-file-input]', fixture.files.invalid)
  await contains('[data-history-file-notice]', '文件内容或记录范围不符合历史导出格式'); await absent('[data-history-file-stop]')
  await present('[data-history-file-stale]'); await verifyRows({ query: fixture.query })
  await shot('offline-history-file', 'invalid-retained', ['[data-history-file-choose]'], ['上一次成功读取的文件'])
  await choose('[data-history-file-input]', fixture.files.historyMissing)
  await contains('[data-history-file-notice]', '文件格式检查通过，共 4 条'); await verifyRows({}, 0, 'file', fixture.historyMissing)
  await shot('offline-history-file', 'version-two', ['[data-history-file-query]'], ['文件内有 4 条记录'])
  await click('[data-history-file-clear]'); await absent('[data-history-file-result]')
  await shot('offline-history-file', 'cleared', ['[data-history-file-choose]'], ['已清除查看结果'])
  await closeDetails(historyRoot)

  // Read the real owned workspace only through the existing read-only button.
  await ready('.local-inventory > .local-inventory-actions > button:first-of-type')
  await click('.local-inventory > .local-inventory-actions > button:first-of-type')
  await present('.local-inventory > .local-inventory-totals')
  await focus('[data-local-report-copy]', 'local-inventory-report', 'available')
  await ready('[data-local-report-copy]'); await ready('[data-local-report-download]')
  await shot('local-inventory-report', 'available', ['[data-local-report-download]'], ['复制统计摘要', '导出统计报告'])
  await openDetails('[data-local-report-file]')
  const inventoryInput = '[data-local-report-file] input[type="file"]'
  await focus(inventoryInput, 'offline-inventory-file', 'default')
  await shot('offline-inventory-file', 'default', [inventoryInput], ['选择已导出的统计 JSON 文件'])
  await choose(inventoryInput, fixture.files.invalid); await present('[data-local-file-state="failed"]')
  await shot('offline-inventory-file', 'invalid', [inventoryInput], ['未显示部分内容'])
  await choose(inventoryInput, fixture.files.reportA); await present('[data-local-file-state="ready"]')
  await contains('[data-local-file-result]', fixture.reportA.generatedAtUTC)
  await shot('offline-inventory-file', 'populated', [inventoryInput], ['文件记录合计：6', '来源和真实性未经验证'])
  await ready('[data-local-compare-start]')
  await focus('[data-local-compare-start]', 'offline-inventory-comparison', 'ready')
  await shot('offline-inventory-comparison', 'ready', ['[data-local-compare-start]'], ['准备好后点击比较'])
  await click('[data-local-compare-start]'); await present('[data-local-compare-state="ready"]')
  const comparisonRows = await evaluate(`Array.from(document.querySelectorAll('[data-local-compare-result] table tbody tr'),row=>Array.from(row.querySelectorAll('td'),cell=>cell.textContent.trim()))`)
  assert.equal(comparisonRows.length, 12)
  const referenceRows = fixture.expectedPair.rows
  comparisonRows.forEach((cells, index) => {
    assert.equal(cells.length, 3)
    const values = cells.map(cell => { assert.match(cell, /^[+-]?\d+ (项|B)$/); return Number(cell.split(' ')[0]) })
    assert.equal(values[0], referenceRows[index].a); assert.ok(values.every(Number.isSafeInteger)); assert.equal(values[2], values[1] - values[0])
  })
  evidence.localComparison = { referenceFile: { ...fixture.files.reportA }, rows: comparisonRows, arithmeticVerified: true }; save()
  await shot('offline-inventory-comparison', 'compared', ['[data-local-compare-differences]'], ['共 12 个统计指标'])
  await focus('[data-local-compare-export="json"]', 'offline-inventory-export', 'formats')
  for (const format of ['json', 'csv', 'html']) await ready('[data-local-compare-export=' + q(format) + ']')
  await shot('offline-inventory-export', 'formats', ['[data-local-compare-export="json"]'], ['全部 12 项指标'])
  await click('[data-local-compare-differences]')
  assert.equal(await evaluate(`document.querySelector('[data-local-compare-differences]').getAttribute('aria-pressed')`), 'true')
  await shot('offline-inventory-comparison', 'differences', ['[data-local-compare-differences]'], ['当前仅显示有差异的指标'])
  await click('[data-local-compare-clear]'); await absent('[data-local-compare-result]')
  await shot('offline-inventory-comparison', 'cleared', ['[data-local-compare-start]'], ['准备好后点击比较'])
  await press('[data-local-report-file]', '清除文件视图'); await absent('[data-local-file-result]')
  await shot('offline-inventory-file', 'cleared', [inventoryInput], ['选择已导出的统计 JSON 文件'])
  await closeDetails('[data-local-report-file]')

  await openDetails(pairRoot)
  await focus('[data-offline-reset]', 'offline-report-pair', 'default')
  await shot('offline-report-pair', 'default', ['[data-offline-reset]'], ['尚未选择报告'])
  await choose('[data-offline-side="a"] input[type="file"]', fixture.files.reportA)
  await present('[data-offline-side="a"] [data-offline-state="ready"]')
  assert.equal(await evaluate(`document.querySelector('[data-offline-compare]').disabled`), true)
  await shot('offline-report-pair', 'one-report', ['[data-offline-reset]'], [fixture.reportA.generatedAtUTC])
  await choose('[data-offline-side="b"] input[type="file"]', fixture.files.reportB)
  await present('[data-offline-side="b"] [data-offline-state="ready"]'); await ready('[data-offline-compare]')
  await absent('[data-offline-result]')
  await shot('offline-report-pair', 'both-ready', ['[data-offline-compare]'], ['不会自动比较或扫描'])
  const pairRows = () => evaluate(`Array.from(document.querySelectorAll('[data-offline-metric]'),row=>{const cells=Array.from(row.querySelectorAll('td'),cell=>cell.textContent.trim());return {key:row.getAttribute('data-offline-metric'),a:cells[0],b:cells[1],delta:cells[2],unit:cells[3]}})`)
  const verifyPair = async (comparison = fixture.expectedPair, differences = false, direction = 'all', scope = 'all', order = 'original') => {
    const expected = offlinePairOrderedRows(comparison, differences, direction, scope, order).map(pairProjection)
    await until(async () => q(await pairRows()) === q(expected), 'Actual pair view does not match the two selected parsed reports')
    assert.deepEqual(await pairRows(), expected)
    const summary = await evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('[data-offline-summary-count]'),n=>[n.getAttribute('data-offline-summary-count'),Number(n.textContent)]))`)
    assert.deepEqual(summary, { increase: comparison.rows.filter(row => row.delta > 0).length, decrease: comparison.rows.filter(row => row.delta < 0).length, unchanged: comparison.rows.filter(row => row.delta === 0).length })
    evidence.pairViews.push({ differences, direction, scope, order, generatedA: comparison.generatedA, generatedB: comparison.generatedB, rows: expected, summary }); save()
  }
  await click('[data-offline-compare]'); await present('[data-offline-result]'); await verifyPair()
  await shot('offline-report-pair', 'compared', ['[data-offline-differences]'], ['12 项指标'])
  await focus('[data-offline-export-format="json"]', 'offline-report-export', 'formats')
  for (const format of ['json', 'csv', 'html']) await ready('[data-offline-export-format=' + q(format) + ']')
  await shot('offline-report-export', 'formats', ['[data-offline-export-format="json"]'], ['完整比较概览', '全部 12 项指标'])
  await click('[data-offline-differences]'); await verifyPair(fixture.expectedPair, true)
  await shared.select('[data-offline-direction]', { routeId: 'offline-report-pair', stateId: 'direction-popup', value: 'increase', restore: true })
  await verifyPair(fixture.expectedPair, true)
  await shared.select('[data-offline-scope]', { routeId: 'offline-report-pair', stateId: 'scope-popup', value: 'counts', restore: true })
  await verifyPair(fixture.expectedPair, true)
  await shared.nativeSelect.choose('[data-offline-scope]', 'counts')
  await shared.select('[data-offline-order]', { routeId: 'offline-report-pair', stateId: 'order-popup', value: 'largest', restore: true })
  await verifyPair(fixture.expectedPair, true, 'all', 'counts')
  await shot('offline-report-export', 'filtered', ['[data-offline-export-format="html"]'], ['完整比较概览', '不随筛选变化'])
  await shared.nativeSelect.choose('[data-offline-scope]', 'bytes'); await shared.nativeSelect.choose('[data-offline-direction]', 'decrease')
  await verifyPair(fixture.expectedPair, true, 'decrease', 'bytes')
  await shot('offline-report-pair', 'empty-filter', ['[data-offline-view-reset]'], ['当前指标类型与方向没有匹配项'])
  await click('[data-offline-view-reset]'); await verifyPair()
  await absent('[data-offline-direction]'); await absent('[data-offline-scope]'); await absent('[data-offline-order]')
  await shot('offline-report-pair', 'restored', ['[data-offline-compare]'], ['显示 12 / 12 项指标'])
  await click('[data-offline-swap]'); await absent('[data-offline-result]')
  await ready('[data-offline-compare]'); await click('[data-offline-compare]')
  const swapped = compareOfflineReportPair(fixture.reportB, fixture.reportA)
  await present('[data-offline-result]'); await verifyPair(swapped)
  await shot('offline-report-pair', 'swapped', ['[data-offline-swap]'], ['报告 B − 报告 A'])
  await shot('offline-report-export', 'swapped', ['[data-offline-export-format="json"]'], ['完整比较概览'])
  await choose('[data-offline-side="a"] input[type="file"]', fixture.files.invalid)
  await present('[data-offline-side="a"] [data-offline-state="failed"]'); await absent('[data-offline-result]')
  assert.equal(await evaluate(`document.querySelector('[data-offline-compare]').disabled`), true)
  await present('[data-offline-side="b"] [data-offline-state="ready"]')
  await shot('offline-report-pair', 'invalid-replacement', ['[data-offline-reset]'], ['没有采用部分数据'])
  await click('[data-offline-reset]')
  for (const side of ['a', 'b']) await present('[data-offline-side=' + q(side) + '] [data-offline-state="idle"]')
  await absent('[data-offline-result]')
  await shot('offline-report-pair', 'reset', ['[data-offline-reset]'], ['尚未选择报告'])
  await closeDetails(pairRoot)
  await shared.closeSettings()
  assert.deepEqual(await api('/api/settings'), before.settings, 'Offline viewing changed actual persisted Settings')
  assert.deepEqual(await readHistory(), before.history, 'Offline files changed live conflict history')
  assert.equal(await evaluate(`localStorage.getItem(${q(SYNC_CLOCK_PREFERENCE_KEY)})`), before.clock, 'Time-display observations wrote a preference')
  evidence.complete = true; evidence.settingsUnchanged = true; evidence.liveHistoryUnchanged = true; evidence.clockPreferenceUnchanged = true; save()
}
