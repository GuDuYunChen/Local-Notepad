import React, { useEffect, useState } from 'react'
import BacklinksPanel from './BacklinksPanel'
import VersionHistory from './VersionHistory'
import TagSelector from './TagSelector'
import { tagApi } from '~/services/tagApi'

function formatUpdated(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function InspectorPanel({
  file,
  activeTab,
  onTabChange,
  onClose,
  onSelectFile,
  onRestore,
}) {
  const [tags, setTags] = useState([])

  useEffect(() => {
    let alive = true
    if (!file?.id) {
      setTags([])
      return undefined
    }

    tagApi.getFileTags(file.id)
      .then(data => {
        if (alive) setTags(data || [])
      })
      .catch(() => {
        if (alive) setTags([])
      })

    return () => { alive = false }
  }, [file?.id])

  if (!file) return null

  return (
    <aside className="inspector-panel" aria-label="文档检查器">
      <div className="inspector-header">
        <div>
          <div className="inspector-eyebrow">当前文档</div>
          <div className="inspector-title" title={file.title}>{file.title || '未命名'}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="关闭检查器" aria-label="关闭检查器">×</button>
      </div>

      <div className="inspector-tabs" role="tablist" aria-label="文档信息">
        {[
          ['properties', '属性'],
          ['backlinks', '反向链接'],
          ['history', '历史'],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`inspector-tab${activeTab === id ? ' active' : ''}`}
            onClick={() => onTabChange(id)}
            role="tab"
            aria-selected={activeTab === id}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="inspector-body">
        {activeTab === 'properties' && (
          <div className="inspector-properties">
            <div className="property-group">
              <div className="property-label">标签</div>
              <TagSelector fileId={file.id} tags={tags} onChange={setTags} />
            </div>
            <div className="property-row">
              <span>最后更新</span>
              <strong>{formatUpdated(file.updated_at)}</strong>
            </div>
            <div className="property-row">
              <span>类型</span>
              <strong>{file.is_folder ? '文件夹' : '笔记'}</strong>
            </div>
          </div>
        )}

        {activeTab === 'backlinks' && (
          <BacklinksPanel fileId={file.id} onSelectFile={onSelectFile} />
        )}

        {activeTab === 'history' && (
          <VersionHistory fileId={file.id} onRestore={onRestore} />
        )}
      </div>
    </aside>
  )
}
