import React, { useEffect, useMemo, useState, useRef } from 'react'
import { api } from '../services/api'
import './VersionHistory.css'

function extractReadableText(content) {
  if (!content) return '（空内容）'

  try {
    const state = JSON.parse(content)

    const collectText = (node) => {
      if (!node) return ''
      if (node.type === 'text') return node.text || ''
      if (!Array.isArray(node.children)) return ''
      return node.children.map(collectText).join('')
    }

    if (state?.root?.children) {
      const text = state.root.children
        .map(collectText)
        .filter(line => line.trim())
        .join('\n')
        .trim()
      return text || '（空内容）'
    }
  } catch {
    // Older versions may contain plain text rather than Lexical JSON.
  }

  return String(content)
}

function formatVersionTime(ts) {
  if (!ts) return '时间未知'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function VersionHistory({ fileId, onRestore }) {
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(false)
  const [restoringId, setRestoringId] = useState(null)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!fileId) {
      setVersions([])
      setSelectedVersion(null)
      return undefined
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const load = async () => {
      setLoading(true)
      try {
        const list = await api(`/api/files/${fileId}/versions`)
        if (controller.signal.aborted) return
        const next = Array.isArray(list) ? list : []
        setVersions(next)
        setSelectedVersion(next[0] || null)
      } catch (e) {
        if (e.name !== 'AbortError') console.error('加载版本历史失败', e)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [fileId])

  const preview = useMemo(
    () => extractReadableText(selectedVersion?.content).slice(0, 1800),
    [selectedVersion]
  )

  const handleRestore = async (version) => {
    if (!version?.id) return
    const confirmed = window.confirm(`恢复到 ${formatVersionTime(version.created_at)} 的版本？\n\n恢复前系统仍会保留当前版本记录。`)
    if (!confirmed) return

    setRestoringId(version.id)
    try {
      await api(`/api/files/${fileId}/versions/${version.id}/restore`, {
        method: 'POST'
      })
      onRestore?.()
    } catch (e) {
      console.error('恢复版本失败', e)
      alert('恢复失败: ' + (e.message || '未知错误'))
    } finally {
      setRestoringId(null)
    }
  }

  if (!fileId) return null

  return (
    <div className="version-history">
      <div className="version-header inspector-section-header">
        <div>
          <div className="inspector-section-eyebrow">Versions</div>
          <h3>版本历史</h3>
        </div>
        <span>{versions.length}</span>
      </div>

      <div className="version-list">
        {loading ? (
          <div className="version-loading">正在读取历史版本…</div>
        ) : versions.length === 0 ? (
          <div className="version-empty">暂无版本历史</div>
        ) : (
          versions.map((version, index) => (
            <div
              key={version.id}
              className={`version-item ${selectedVersion?.id === version.id ? 'selected' : ''}`}
            >
              <button
                type="button"
                className="version-select-action"
                onClick={() => setSelectedVersion(version)}
              >
                <span className="version-item-main">
                  <strong>{index === 0 ? '当前版本' : `历史版本 ${versions.length - index}`}</strong>
                  <small>{formatVersionTime(version.created_at)}</small>
                </span>
              </button>
              {index > 0 && (
                <button
                  type="button"
                  className="version-restore-action"
                  onClick={() => void handleRestore(version)}
                  disabled={restoringId === version.id}
                >
                  {restoringId === version.id ? '恢复中…' : '恢复'}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {selectedVersion && (
        <div className="version-preview">
          <div className="version-preview-header">
            <strong>内容预览</strong>
            <span>{preview.length.toLocaleString()} 字符</span>
          </div>
          <pre>{preview}</pre>
        </div>
      )}
    </div>
  )
}
