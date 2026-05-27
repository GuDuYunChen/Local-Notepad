import React, { useEffect, useState } from 'react'
import { api, getBacklinks } from '../services/api'
import './BacklinksPanel.css'

export default function BacklinksPanel({ fileId, onSelectFile }) {
  const [backlinks, setBacklinks] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!fileId) {
      setBacklinks([])
      return
    }

    const load = async () => {
      setLoading(true)
      try {
        const links = await getBacklinks(fileId)
        const enriched = await Promise.all(
          links.map(async (link) => {
            try {
              const file = await api(`/api/files/${link.source_id}`)
              return { ...link, source_title: file.title }
            } catch {
              return { ...link, source_title: '未知文件' }
            }
          })
        )
        setBacklinks(enriched)
      } catch (e) {
        console.error('加载反向链接失败', e)
      } finally {
        setLoading(false)
      }
    }

    load()
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
