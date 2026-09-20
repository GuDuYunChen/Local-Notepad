import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
import ConfirmDialog from './ConfirmDialog'

const RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export function trashDaysRemaining(deletedAt, now = Date.now()) {
  if (!deletedAt) return RETENTION_DAYS
  const elapsed = Math.max(0, now - deletedAt * 1000)
  return Math.max(0, RETENTION_DAYS - Math.floor(elapsed / DAY_MS))
}

export function formatTrashDeletedAt(ts) {
  if (!ts) return '删除时间未知'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function TrashPanel({ onClose, onRestored }) {
  const [items, setItems] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [busyIds, setBusyIds] = useState(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const loadTrash = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api('/api/files/trash')
      setItems(Array.isArray(list) ? list : [])
      setSelectedIds(prev => {
        const valid = new Set((Array.isArray(list) ? list : []).map(item => item.id))
        return new Set([...prev].filter(id => valid.has(id)))
      })
    } catch (error) {
      console.error('加载回收站失败', error)
      toast.error(error.message || '加载回收站失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTrash()
  }, [loadTrash])

  const allSelected = items.length > 0 && selectedIds.size === items.length

  const selectedItems = useMemo(
    () => items.filter(item => selectedIds.has(item.id)),
    [items, selectedIds]
  )

  const setBusy = (id, busy) => {
    setBusyIds(prev => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const removeItems = (ids) => {
    const idSet = new Set(ids)
    setItems(prev => prev.filter(item => !idSet.has(item.id)))
    setSelectedIds(prev => new Set([...prev].filter(id => !idSet.has(id))))
  }

  const restoreOne = async (item, silent = false) => {
    setBusy(item.id, true)
    try {
      await api(`/api/files/${item.id}/restore`, { method: 'POST' })
      removeItems([item.id])
      if (!silent) {
        onRestored?.([item.id])
        toast.success(`已恢复：${item.title}`)
      }
      return { ok: true, id: item.id }
    } catch (error) {
      console.error('恢复失败', item.id, error)
      if (!silent) toast.error(error.message || `恢复失败：${item.title}`)
      return { ok: false, id: item.id, error }
    } finally {
      setBusy(item.id, false)
    }
  }

  const permanentDeleteOne = async (item, silent = false) => {
    setBusy(item.id, true)
    try {
      await api(`/api/files/${item.id}/permanent`, { method: 'DELETE' })
      removeItems([item.id])
      if (!silent) toast.success(`已永久删除：${item.title}`)
      return { ok: true, id: item.id }
    } catch (error) {
      console.error('永久删除失败', item.id, error)
      if (!silent) toast.error(error.message || `永久删除失败：${item.title}`)
      return { ok: false, id: item.id, error }
    } finally {
      setBusy(item.id, false)
    }
  }

  const restoreSelected = async () => {
    if (selectedItems.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const results = await Promise.all(selectedItems.map(item => restoreOne(item, true)))
      const restored = results.filter(result => result.ok)
      const failed = results.filter(result => !result.ok)
      if (restored.length) {
        onRestored?.(restored.map(result => result.id))
        toast.success(`已恢复 ${restored.length} 项`)
      }
      if (failed.length) {
        toast.warning(`${failed.length} 项恢复失败，请检查同名冲突`)
      }
    } finally {
      setBulkBusy(false)
    }
  }

  const permanentlyDeleteSelected = async (targets) => {
    if (targets.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const results = await Promise.all(targets.map(item => permanentDeleteOne(item, true)))
      const deleted = results.filter(result => result.ok).length
      const failed = results.length - deleted
      if (deleted) toast.success(`已永久删除 ${deleted} 项`)
      if (failed) toast.warning(`${failed} 项删除失败`)
    } finally {
      setBulkBusy(false)
    }
  }

  const emptyTrash = async () => {
    if (items.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      await api('/api/files/trash', { method: 'DELETE' })
      setItems([])
      setSelectedIds(new Set())
      toast.success('回收站已清空')
    } catch (error) {
      console.error('清空回收站失败', error)
      toast.error(error.message || '清空回收站失败')
      throw error
    } finally {
      setBulkBusy(false)
    }
  }

  const requestDeleteSelected = () => {
    const targets = [...selectedItems]
    if (targets.length === 0 || bulkBusy) return
    setConfirmAction({
      title: `永久删除 ${targets.length} 项？`,
      message: '删除后无法恢复。只有确定不再需要这些内容时才继续。',
      confirmLabel: '永久删除',
      run: () => permanentlyDeleteSelected(targets),
    })
  }

  const requestEmptyTrash = () => {
    const count = items.length
    if (count === 0 || bulkBusy) return
    setConfirmAction({
      title: '清空回收站？',
      message: `回收站中的 ${count} 项内容都会被永久删除，并且无法恢复。`,
      confirmLabel: '清空回收站',
      run: emptyTrash,
    })
  }

  const requestDeleteOne = (item) => {
    setConfirmAction({
      title: '永久删除这项内容？',
      message: `“${item.title || '未命名'}”删除后无法恢复。`,
      confirmLabel: '永久删除',
      run: async () => {
        const result = await permanentDeleteOne(item)
        if (!result.ok) throw result.error || new Error('永久删除失败')
      },
    })
  }

  const runConfirmedAction = async () => {
    if (!confirmAction?.run || confirmBusy) return
    setConfirmBusy(true)
    try {
      await confirmAction.run()
      setConfirmAction(null)
    } catch {
      // The action already surfaces its own error toast.
    } finally {
      setConfirmBusy(false)
    }
  }

  return (
    <div className="trash-panel">
      <header className="trash-toolbar">
        <div>
          <strong>回收站</strong>
          <p>最近删除的内容会保留 30 天，你可以随时恢复。</p>
        </div>

        <div className="trash-toolbar-actions">
          <button className="btn small" onClick={() => void loadTrash()} disabled={loading || bulkBusy}>
            刷新
          </button>
          <button className="icon-btn" onClick={onClose} title="返回笔记" aria-label="返回笔记">×</button>
        </div>
      </header>

      {items.length > 0 && (
        <div className="trash-bulkbar">
          <label className="trash-select-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={event => {
                if (event.target.checked) setSelectedIds(new Set(items.map(item => item.id)))
                else setSelectedIds(new Set())
              }}
            />
            <span>{selectedIds.size ? `已选择 ${selectedIds.size} 项` : `共 ${items.length} 项`}</span>
          </label>

          <div className="trash-bulk-actions">
            <button
              className="btn small"
              disabled={selectedIds.size === 0 || bulkBusy}
              onClick={() => void restoreSelected()}
            >
              恢复所选
            </button>
            <button
              className="btn small danger"
              disabled={selectedIds.size === 0 || bulkBusy}
              onClick={requestDeleteSelected}
            >
              永久删除所选
            </button>
            <button
              className="btn small danger subtle"
              disabled={bulkBusy}
              onClick={requestEmptyTrash}
            >
              清空回收站
            </button>
          </div>
        </div>
      )}

      <div className="trash-content">
        {loading ? (
          <div className="placeholder">正在读取回收站…</div>
        ) : items.length === 0 ? (
          <div className="empty-state trash-empty">
            <div className="trash-empty-mark" aria-hidden="true">✓</div>
            <div className="empty-title">回收站是空的</div>
            <div className="empty-desc">删除的笔记和文件夹会先放到这里，30 天内可以恢复。</div>
            <button className="btn" onClick={onClose}>返回笔记</button>
          </div>
        ) : (
          <div className="trash-list" role="list" aria-label="已删除项目">
            {items.map(item => {
              const busy = busyIds.has(item.id)
              const days = trashDaysRemaining(item.deleted_at)

              return (
                <article
                  key={item.id}
                  className={`trash-item${selectedIds.has(item.id) ? ' selected' : ''}`}
                  role="listitem"
                >
                  <label className="trash-item-select" title="选择">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={event => {
                        setSelectedIds(prev => {
                          const next = new Set(prev)
                          if (event.target.checked) next.add(item.id)
                          else next.delete(item.id)
                          return next
                        })
                      }}
                    />
                  </label>

                  <div className={`trash-item-icon${item.is_folder ? ' folder' : ''}`} aria-hidden="true">
                    {item.is_folder ? '▣' : '▤'}
                  </div>

                  <div className="trash-item-main">
                    <div className="trash-item-title">{item.title || '未命名'}</div>
                    <div className="trash-item-meta">
                      <span>{item.is_folder ? '文件夹' : '笔记'}</span>
                      <span>删除于 {formatTrashDeletedAt(item.deleted_at)}</span>
                    </div>
                  </div>

                  <div className={`trash-retention${days <= 3 ? ' urgent' : ''}`}>
                    <strong>{days}</strong>
                    <span>天后清理</span>
                  </div>

                  <div className="trash-item-actions">
                    <button
                      className="btn small"
                      disabled={busy || bulkBusy}
                      onClick={() => void restoreOne(item)}
                    >
                      恢复
                    </button>
                    <button
                      className="btn small danger subtle"
                      disabled={busy || bulkBusy}
                      onClick={() => requestDeleteOne(item)}
                    >
                      永久删除
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          onClose={() => {
            if (!confirmBusy) setConfirmAction(null)
          }}
          actions={[
            {
              label: '取消',
              disabled: confirmBusy,
              onClick: () => setConfirmAction(null),
            },
            {
              label: confirmAction.confirmLabel,
              kind: 'danger',
              loading: confirmBusy,
              onClick: () => void runConfirmedAction(),
            },
          ]}
        />
      )}
    </div>
  )
}
