// Whitelist-only, local presentation. Never retain arbitrary API strings,
// identities, paths, titles, bodies, credentials or raw error messages.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const bool = value => typeof value === 'boolean' ? value : null
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const millis = value => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000 ? value : null
const seconds = value => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000 ? value * 1000 : null
const present = value => typeof value === 'string' ? value.length > 0 : null
const known = (value, choices) => typeof value === 'string' && Object.hasOwn(choices, value) ? value : 'unknown'
const PROVIDERS = Object.freeze({ 'local-lab': '本地实验室', webdav: 'WebDAV', unknown: '未知 / 不支持' })
const STATES = Object.freeze({ never: '尚未同步', ok: '上次报告完成', error: '上次报告失败', conflicts: '上次报告有冲突', rebound: '已重新绑定',
  review_required: '写入结果待确认', retry_wait: '预检暂缓，等待重试', recovery_blocked: '恢复保护阻断，需处理', unknown: '未知 / 未提供' })
const RECOVERY = Object.freeze({ idle: '空闲', backoff: '预检暂缓', blocked: '需要处理', applying: '正在写入或结果待确认', review_required: '写入结果待确认', unknown: '未知 / 未提供' })
const READS = Object.freeze({ unavailable: '尚无可核实的读取结果', stale: '上次读取结果；刷新失败或状态待核实', refreshing: '正在刷新；仍是上次读取结果', captured: '已读取的状态快照（非实时保证）' })
const yesNo = value => value === true ? '是' : value === false ? '否' : '未知 / 未提供'
const numeric = value => value === null ? '未知 / 未提供' : String(value)
const utc = value => value === null ? '未知 / 未记录' : new Date(value).toISOString()

export function syncDiagnosticFacts(input = {}) {
  const { settings, status, health, conflictCount, busy, draftChanged, actionFailed } = object(input) ? input : {}
  const readAt = millis(health?.lastReadAt)
  const loaded = !!readAt && object(settings) && object(status)
  const readError = present(health?.error)
  const failures = count(health?.failures)
  const loading = bool(health?.loading)
  const readState = !loaded ? 'unavailable' : readError !== false || failures === null || failures > 0
    ? 'stale' : loading === true ? 'refreshing' : loading === false ? 'captured' : 'stale'
  const values = loaded ? status : null, config = loaded ? settings : null
  return Object.freeze({
    readState, readAt, loading, readError, failures,
    provider: known(config?.sync_provider, PROVIDERS), enabled: bool(config?.sync_enabled),
    automatic: bool(config?.sync_auto_enabled),
    intervalMinutes: Number.isSafeInteger(config?.sync_interval_minutes) && config.sync_interval_minutes >= 1 && config.sync_interval_minutes <= 1440 ? config.sync_interval_minutes : null,
    lastState: known(values?.last_status, STATES), lastAttemptAt: seconds(values?.last_sync_at),
    recovery: known(values?.recovery?.mode, RECOVERY), lastSuccessAt: seconds(values?.recovery?.last_success_at),
    nextAttemptAt: seconds(values?.recovery?.next_attempt_at),
    baseItems: count(values?.base_items), openConflicts: count(values?.open_conflicts),
    listedConflicts: loaded ? count(conflictCount) : null,
    syncError: present(values?.last_error), busy: bool(busy), draftChanged: bool(draftChanged), actionFailed: bool(actionFailed),
  })
}

// RecoveryRunner.Status emits these fixed last_status values in addition to
// its structured recovery mode. Keep both independent: one cannot erase the
// other's explicit warning, nor can a missing detail fabricate a success.
const RECOVERY_LAST_STATES = Object.freeze({
  applying: 'review_required', review_required: 'review_required',
  backoff: 'retry_wait', blocked: 'recovery_blocked',
})
function recoveryDetailNotice(f) {
  const special = ['review_required', 'retry_wait', 'recovery_blocked'].includes(f.lastState)
  const expectedState = Object.hasOwn(RECOVERY_LAST_STATES, f.recovery) ? RECOVERY_LAST_STATES[f.recovery] : null
  if (special && f.recovery === 'unknown') {
    return '\n恢复信息提示：恢复详情缺失或不受支持；保留已有的最近状态提示，不推断任务已经停止或完成。'
  }
  if ((special && expectedState !== f.lastState) ||
      (expectedState && f.lastState !== 'unknown' && expectedState !== f.lastState)) {
    return '\n恢复信息提示：最近状态与恢复详情不一致；两项按原值保留，不能据此认定写入已完成，请先刷新并核查。'
  }
  return ''
}

function guidance(f) {
  if (f.lastState === 'review_required' || ['applying', 'review_required'].includes(f.recovery)) return '该快照显示写入尚未结束或结果待确认。先核查两端，不要反复执行或重新绑定；只读检查不会自动撤销写入。'
  if (f.readState === 'unavailable') return '先在同步中心读取状态。未读取的数量不是零，摘要不能判断同步是否成功。'
  if (f.busy === true) return '界面仍在等待操作结果。本摘要不证明操作已完成；不要根据摘要自动重试。'
  if (f.readState !== 'captured') return '先刷新同步状态再判断。保留的上次结果不能证明当前连接、版本或待处理数量。'
  if (f.draftChanged === true) return '存在未保存的配置草稿；先核对本机输入，摘要不包含草稿值，也不会替你保存或启用。'
  if (f.lastState === 'recovery_blocked' || f.recovery === 'blocked') return '在本机检查连接配置与详细提示；不要通过清除数据或重新绑定来跳过恢复保护。'
  if (f.lastState === 'retry_wait' || f.recovery === 'backoff') return '该快照显示同步预检处于暂缓状态。查看最早重试时间；刷新状态不会提前重跑同步。'
  if ((f.openConflicts !== null && f.openConflicts > 0) || (f.listedConflicts !== null && f.listedConflicts > 0)) return '到冲突中心逐项对照并明确确认；摘要不会选择本机或远端，也不能代替正文核对。'
  if (f.enabled === false) return '同步尚未启用；只有你决定使用同步并完成原有验证流程后才启用，本摘要不更改设置。'
  if (f.lastState === 'error' || f.syncError === true || f.actionFailed === true) return '在本机查看具体提示，必要时使用只读连接检查；摘要未复制错误原文，也未推断故障原因。'
  return '可先预演查看差异。上次成功或当前列表没有冲突，不代表两端现在完全一致；执行仍会重新核对。'
}

export function captureSyncDiagnostic(input, generatedAt = Date.now()) {
  const facts = syncDiagnosticFacts(input)
  const capturedAt = millis(generatedAt)
  const rows = [
    ['摘要格式', 'local-notepad-sync-diagnostic/v1'], ['生成时间 UTC', utc(capturedAt)],
    ['状态依据', READS[facts.readState]], ['最近状态读取 UTC', utc(facts.readAt)],
    ['读取中', yesNo(facts.loading)], ['读取错误标记', yesNo(facts.readError)], ['连续读取失败次数', numeric(facts.failures)],
    ['同步类型', PROVIDERS[facts.provider]], ['同步已启用', yesNo(facts.enabled)], ['自动同步已启用', yesNo(facts.automatic)],
    ['自动同步间隔（分钟）', numeric(facts.intervalMinutes)], ['最近状态', STATES[facts.lastState]],
    ['最近同步尝试 UTC', utc(facts.lastAttemptAt)], ['恢复状态', RECOVERY[facts.recovery]],
    ['最近确认成功 UTC', utc(facts.lastSuccessAt)], ['最早重试 UTC', utc(facts.nextAttemptAt)],
    ['基线对象数', numeric(facts.baseItems)], ['状态报告待处理数', numeric(facts.openConflicts)], ['当前已读取列表数', numeric(facts.listedConflicts)],
    ['同步错误标记', yesNo(facts.syncError)], ['界面正在等待操作', yesNo(facts.busy)],
    ['存在未保存草稿', yesNo(facts.draftChanged)], ['界面操作错误标记', yesNo(facts.actionFailed)],
  ]
  const discrepancy = facts.openConflicts !== null && facts.listedConflicts !== null && facts.openConflicts !== facts.listedConflicts
    ? '\n数量提示：状态计数与已读取列表数量不一致，未取较大值或猜测正确值，请刷新核实。' : ''
  const text = 'Local-Notepad 同步诊断摘要\n' + rows.map(([label, value]) => label + '：' + value).join('\n') + discrepancy + recoveryDetailNotice(facts) +
    '\n\n下一步参考：' + guidance(facts) +
    '\n\n分享边界：仅包含状态、计数和时间。未包含正文、标题、附件名、对象/设备/仓库编号、账号、地址、密码、令牌、哈希或错误原文。计数和时间仍可能透露使用情况，请核对后再分享。' +
    '\n这是手动生成的本地快照，不会自动更新、上传、同步或处理冲突。\n'
  return Object.freeze({ facts, capturedAt, key: JSON.stringify(facts), text })
}

// Clipboard APIs offer no cancellation. Bound waiting, not the native write.
// A late completion cannot cause an automatic replay or a false cancellation claim.
export async function copySyncDiagnostic(text, write, { timeoutMs = 5000, schedule = setTimeout, cancel = clearTimeout } = {}) {
  if (typeof text !== 'string' || text.length > 8192 || typeof write !== 'function') return false
  let timer
  try {
    const expires = new Promise(resolve => { timer = schedule(() => resolve(false), Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5000 ? timeoutMs : 5000) })
    const completed = Promise.resolve(write(text)).then(() => true, () => false)
    return await Promise.race([completed, expires])
  } catch { return false } finally { if (timer !== undefined) cancel(timer) }
}
