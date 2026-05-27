import React, { useEffect, useState, useRef } from 'react'
import { api } from '../services/api'
import './VersionHistory.css'

export default function VersionHistory({ fileId, onRestore }) {
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!fileId) {
      setVersions([])
      return
    }

    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    const load = async () => {
      setLoading(true)
      try {
        const list = await api(`/api/files/${fileId}/versions`)
        if (controller.signal.aborted) return
        setVersions(list || [])
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('加载版本历史失败', e)
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      controller.abort()
    }
  }, [fileId])

  const handleRestore = async (versionId) => {
    try {
      await api(`/api/files/${fileId}/versions/${versionId}/restore`, {
        method: 'POST'
      })
      onRestore?.()
    } catch (e) {
      console.error('恢复版本失败', e)
      alert('恢复失败: ' + (e.message || '未知错误'))
    }
  }

  if (!fileId) return null

  return (
    <div className="version-history">
      <div className="version-header">
        <h3>版本历史 ({versions.length})</h3>
      </div>
      <div className="version-list">
        {loading ? (
          <div className="version-loading">加载中...</div>
        ) : versions.length === 0 ? (
          <div className="version-empty">暂无版本历史</div>
        ) : (
          versions.map((version, index) => (
            <div
              key={version.id}
              className={`version-item ${selectedVersion?.id === version.id ? 'selected' : ''}`}
              onClick={() => setSelectedVersion(version)}
            >
              <div className="version-title">
                {index === 0 ? '当前版本' : `版本 ${versions.length - index}`}
              </div>
              <div className="version-time">
                {new Date(version.created_at * 1000).toLocaleString('zh-CN')}
              </div>
              <div className="version-actions">
                {index > 0 && (
                  <button
                    className="btn small"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRestore(version.id)
                    }}
                  >
                    恢复此版本
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {selectedVersion && (
        <div className="version-preview">
          <h4>内容预览</h4>
          <pre>{selectedVersion.content.substring(0, 500)}...</pre>
        </div>
      )}
    </div>
  )
}
