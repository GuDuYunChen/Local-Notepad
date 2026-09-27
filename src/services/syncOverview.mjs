import { syncDiagnosticFacts } from './syncDiagnostic.mjs'

// A read-only index into the existing center, not another sync controller.
export const SYNC_OVERVIEW_DESTINATIONS = Object.freeze([
  ['health', '状态与恢复', '查看读取结果、任务提示与恢复保护'],
  ['connection', '连接配置', '查看 WebDAV、本地实验室与自动同步设置'],
  ['execution', '预演与执行', '先查看计划，再由你明确执行'],
  ['conflicts', '冲突队列', '搜索、筛选并逐项核对版本'],
  ['diagnostic', '诊断摘要', '手动生成可分享的本地摘要'],
].map(([key, label, detail]) => Object.freeze({ key, label, detail })))
const targets = new Set(['overview', ...SYNC_OVERVIEW_DESTINATIONS.map(item => item.key)])
const providerLabel = { webdav: 'WebDAV', 'local-lab': '本地实验室', unknown: '尚未核实' }
const numberLabel = value => value === null ? '未知' : String(value)
const dateLabel = value => value === null ? '尚无记录' : new Date(value).toISOString()
const specialModes = { applying: 'review_required', review_required: 'review_required', backoff: 'retry_wait', blocked: 'recovery_blocked' }

export function buildSyncOverview(input) {
  const facts = syncDiagnosticFacts(input)
  // Navigation availability follows actual rendered regions, not a guessed
  // interpretation of the counters or of a stale status snapshot.
  const enabled = input?.settings?.sync_enabled === true
  const conflictRegion = enabled && Number.isSafeInteger(input?.conflictCount) && input.conflictCount > 0
  const destinations = Object.freeze(SYNC_OVERVIEW_DESTINATIONS.map(item => Object.freeze({ ...item,
    available: item.key === 'execution' ? enabled : item.key === 'conflicts' ? conflictRegion : true,
    unavailableReason: item.key === 'execution' ? '启用同步后显示此区域' : item.key === 'conflicts' ? '当前没有可定位的冲突队列，请先查看状态' : '',
  })))
  let state, title, detail, target = 'health'
  if (facts.lastState === 'review_required' || ['applying', 'review_required'].includes(facts.recovery)) {
    state = 'uncertain'; title = '先核查写入结果'; detail = '已有信息提示写入尚未结束或结果待确认。先核查两端，不要反复执行或重新绑定。'
  } else if (facts.readState === 'unavailable') {
    state = 'unavailable'; title = '尚无可核实的状态'; detail = '可以先查看状态区域。未读取的数量不是零，不能据此判断两端是否一致。'
  } else if (facts.busy === true) {
    state = 'waiting'; title = '正在等待操作结果'; detail = '页面仍在等待。你可以查看其他区域，导航不会停止等待、重试任务或解除操作锁。'
  } else if (facts.readState !== 'captured') {
    state = 'stale'; title = facts.readState === 'refreshing' ? '正在读取更新后的状态' : '当前保留的是上次读取结果'
    detail = '下面的计数和时间来自先前快照，不是实时保证。请在状态区域核实读取结果。'
  } else if (facts.lastState === 'recovery_blocked' || facts.recovery === 'blocked') {
    state = 'blocked'; title = '恢复保护需要处理'; detail = '先查看恢复提示和连接配置，不要通过清除数据或重新绑定跳过保护。'
  } else if (facts.lastState === 'retry_wait' || facts.recovery === 'backoff') {
    state = 'backoff'; title = '同步预检暂缓'; detail = '查看状态区域中的最早重试时间；定位或刷新状态不会提前重跑同步。'
  } else if (facts.draftChanged === true) {
    state = 'draft'; title = '有未保存的连接配置'; detail = '先核对正在编辑的配置。导航不会覆盖输入、保存密码或启用同步。'; target = 'connection'
  } else if (facts.openConflicts !== null && facts.listedConflicts !== null && facts.openConflicts !== facts.listedConflicts) {
    state = 'mismatch'; title = '两处冲突数量需要核实'; detail = '状态计数与已读取列表不同，分别展示，不猜测哪个正确。请先查看状态。'
  } else if (facts.enabled === false) {
    state = 'disabled'; title = '同步尚未启用'; detail = '本地内容仍可使用。需要同步时，再由你完成配置、验证和启用。'; target = 'connection'
  } else if (facts.enabled !== true || facts.provider === 'unknown' || facts.recovery === 'unknown' || facts.lastState === 'unknown' || facts.openConflicts === null || facts.listedConflicts === null) {
    state = 'unknown'; title = '部分状态尚未核实'; detail = '存在缺失或不受支持的信息。请先查看状态或生成诊断摘要，不把未知解释为成功。'
  } else if (facts.openConflicts > 0 || facts.listedConflicts > 0) {
    state = 'conflicts'; title = '有冲突需要逐项核对'; detail = '先阅读两端版本，再明确选择。查看队列不会自动选边、删除或批量处理。'; target = conflictRegion ? 'conflicts' : 'health'
  } else if (facts.lastState === 'error' || facts.syncError === true || facts.actionFailed === true) {
    state = 'error'; title = '查看最近操作的详细提示'; detail = '总览不猜测报错原因。请在本机状态区域查看提示，需要分享时可生成诊断摘要。'
  } else if (facts.lastState === 'conflicts') {
    state = 'unknown'; title = '最近状态与当前计数需要核实'; detail = '最近一次报告有冲突，但当前计数为零；这不证明冲突已处理或同步已完成。'
  } else {
    state = 'preview'; title = '先预演，再决定是否同步'; detail = '已读取的状态不代表两端现在完全一致。到预演区域检查计划，执行仍须你明确操作。'; target = 'execution'
  }
  const expected = Object.hasOwn(specialModes, facts.recovery) ? specialModes[facts.recovery] : null
  const special = ['review_required', 'retry_wait', 'recovery_blocked'].includes(facts.lastState)
  const recoveryNotice = special && facts.recovery === 'unknown'
    ? '恢复详情缺失或不受支持；保留已有警示，不推断任务已经结束。'
    : (special && expected !== facts.lastState) || (expected && facts.lastState !== 'unknown' && expected !== facts.lastState)
      ? '最近状态与恢复详情不一致；请查看原始状态区域，两项均不能证明写入已完成。' : ''
  return Object.freeze({ state, title, detail, target, recoveryNotice, destinations,
    provider: providerLabel[facts.provider],
    automation: facts.automatic === true ? '自动同步已开启' : facts.automatic === false ? '自动同步已关闭' : '自动同步状态未知',
    reportedConflicts: numberLabel(facts.openConflicts), listedConflicts: numberLabel(facts.listedConflicts),
    lastSuccess: dateLabel(facts.lastSuccessAt), readAt: dateLabel(facts.readAt),
  })
}

// Only fixed, in-center regions can be focused. Never click a control, follow
// a URL, change inputs or consult a different mounted center. No smooth motion.
export function focusSyncOverviewRegion(root, key) {
  if (typeof key !== 'string' || !targets.has(key) || !root?.isConnected ||
      !root.matches?.('[data-sync-center]')) return false
  const target = root.querySelector(`[data-sync-section="${key}"]`)
  if (!target?.isConnected || target.closest('[data-sync-center]') !== root || target.closest('[hidden],[inert]') ||
      target.getAttribute('tabindex') !== '-1') return false
  try {
    target.focus({ preventScroll: true })
    if (target.ownerDocument.activeElement !== target) return false
    target.scrollIntoView?.({ block: 'start', behavior: 'instant' })
    return true
  } catch { return false }
}
