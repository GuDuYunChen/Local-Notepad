import React, { useEffect, useState, useRef } from 'react'
import { api, getBacklinks } from '../services/api'
import './BacklinksPanel.css'

export default function BacklinksPanel({ fileId, onSelectFile }) {
  const [backlinks, setBacklinks] = useState([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!fileId) {
      setBacklinks([])
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
        const links = await getBacklinks(fileId)
        if (controller.signal.aborted) return

        const enriched = await Promise.all(
          links.map(async (link) => {
            try {
              const file = await api(`/api/files/${link.source_id}`)
              if (controller.signal.aborted) return { ...link, source_title: '未知文件' }
              return { ...link, source_title: file.title }
            } catch {
              return { ...link, source_title: '未知文件' }
            }
          })
        )
        if (controller.signal.aborted) return
        setBacklinks(enriched)
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('加载反向链接失败', e)
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

  if (!fileId) return null

  return (
    <div className="backlinks-panel">
      <div className="backlinks-header">
        <h3>反向链接 ({backlinks.length})</h3>
      </div>
      <div className="backlinks-list">
        {loading ? (
          <div className="backlinks-loading">加载中...</div>
        ) : backlinks.length === 0 ? (
          <div className="backlinks-empty">暂无反向链接</div>
        ) : (
          backlinks.map((link) => (
            <div
              key={link.id}
              className="backlink-item"
              onClick={() => onSelectFile?.(link.source_id)}
            >
              <div className="backlink-title">{link.source_title}</div>
              <div className="backlink-time">
                {new Date(link.created_at * 1000).toLocaleString('zh-CN')}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
