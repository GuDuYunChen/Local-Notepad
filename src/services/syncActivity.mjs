const kinds = { sync: '手动同步', 'auto-sync': '自动同步', check: '连接检查', plan: '同步预演', 'enable-auto': '自动同步验证', resolve: '冲突处理' }
export function parseSyncActivity(value) {
  if (!value || typeof value.active !== 'boolean') throw new Error('任务状态响应无效')
  if (!value.active) return { active: false, id: '', kind: '', phase: '', started_at: 0, cancel_requested: false }
  if (!/^[a-f0-9]{32}$/.test(value.id) || !Object.hasOwn(kinds, value.kind) ||
      !['preflight', 'applying'].includes(value.phase) || typeof value.cancel_requested !== 'boolean' ||
      !Number.isFinite(value.started_at) || value.started_at <= 0) throw new Error('任务状态响应无效')
  return { active: true, id: value.id, kind: value.kind, phase: value.phase, started_at: value.started_at, cancel_requested: value.cancel_requested }
}
export function syncActivityLabel(value) {
  if (!value?.active) return '当前没有正在执行的同步任务'
  if (value.cancel_requested) return '正在取消，等待任务结束'
  return `${kinds[value.kind]} · ${value.phase === 'applying' ? '可能写入阶段' : '只读预检阶段'}`
}
// Never resolve the target again after confirmation: an old click must not stop a new task.
export async function requestSyncCancellation(api, snapshot, confirm, signal) {
  const target = parseSyncActivity(snapshot)
  if (!target.active || target.cancel_requested) return { accepted: false, reason: 'not-requested' }
  if (!confirm('仅取消当前任务，不关闭自动同步。任务可能已经写入；取消不等于回滚，结束后请核查同步恢复状态。继续吗？')) {
    return { accepted: false, reason: 'declined' }
  }
  const receipt = await api('/api/sync/cancel', { method: 'POST', body: JSON.stringify({ id: target.id }), signal })
  if (receipt?.id !== target.id || typeof receipt.accepted !== 'boolean' ||
      !['requested', 'already-requested', 'not-active'].includes(receipt.reason)) throw new Error('取消结果尚未确认')
  if (receipt.accepted !== (receipt.reason !== 'not-active')) throw new Error('取消结果尚未确认')
  return receipt
}
