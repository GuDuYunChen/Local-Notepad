import React, { useEffect, useState } from 'react'
import BacklinksPanel from './BacklinksPanel'
import VersionHistory from './VersionHistory'
import TagSelector from './TagSelector'
import { tagApi } from '~/services/tagApi'
import { toast } from '~/services/toast'
import { rememberReference } from './Editor/utils/referenceUtils'

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

function copyTextFallback(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand?.('copy')
  textarea.remove()
  return copied !== false
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return copyTextFallback(text)
}

function statusLabel(editorStatus, unsaved) {
  if (editorStatus?.saveError) return '保存失败'
  if (editorStatus?.saving) return '保存中…'
  if (unsaved || editorStatus?.dirty) return '未保存'
  if (editorStatus?.lastSavedAt) return '已保存'
  return '尚未保存'
}

export default function InspectorPanel({
  file,
  activeTab,
  onTabChange,
  onClose,
  onSelectFile,
  onRestore,
  editorStatus,
  unsaved,
  onUpdateFile,
}) {
  const [tags, setTags] = useState([])
  const [pinBusy, setPinBusy] = useState(false)

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

  const togglePinned = async () => {
    if (!onUpdateFile || pinBusy) return
    setPinBusy(true)
    try {
      await onUpdateFile({ is_pinned: !file.is_pinned })
      toast.success(file.is_pinned ? '已取消置顶' : '已置顶')
    } catch (error) {
      console.error('置顶操作失败', error)
      toast.error(error.message || '置顶操作失败')
    } finally {
      setPinBusy(false)
    }
  }

  const copyWikiReference = async () => {
    try {
      await copyText(`[[${file.title || '未命名'}]]`)
      rememberReference({
        id: file.id,
        title: file.title || '未命名',
        sectionPath: [],
      })
      toast.success('笔记引用已复制')
    } catch (error) {
      console.error('复制笔记引用失败', error)
      toast.error('复制失败')
    }
  }

  const saveState = statusLabel(editorStatus, unsaved)
  const tabs = [
    ['properties', '属性'],
    ['backlinks', '反向链接'],
    ['history', '历史'],
  ]

  const handleTabKeyDown = (event, index) => {
    let nextIndex = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1

    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = tabs[nextIndex][0]
    onTabChange(nextTab)
    window.requestAnimationFrame(() => {
      document.getElementById(`inspector-tab-${nextTab}`)?.focus()
    })
  }

  return (
    <aside className="inspector-panel" aria-label="笔记详情">
      <div className="inspector-header">
        <div>
          <div className="inspector-eyebrow">笔记详情</div>
          <div className="inspector-title" title={file.title}>{file.title || '未命名'}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="关闭详情" aria-label="关闭详情">×</button>
      </div>

      <div className="inspector-quick-actions">
        <button
          type="button"
          className={`inspector-action-btn${file.is_pinned ? ' active' : ''}`}
          onClick={() => void togglePinned()}
          disabled={pinBusy}
        >
          <span aria-hidden="true">{file.is_pinned ? '★' : '☆'}</span>
          {pinBusy ? '处理中…' : file.is_pinned ? '取消置顶' : '置顶'}
        </button>
        <button
          type="button"
          className="inspector-action-btn"
          onClick={() => void copyWikiReference()}
        >
          <span aria-hidden="true">[[]]</span>
          复制 Wiki 引用
        </button>
      </div>

      <div className="inspector-tabs" role="tablist" aria-label="笔记信息">
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            id={`inspector-tab-${id}`}
            className={`inspector-tab${activeTab === id ? ' active' : ''}`}
            onClick={() => onTabChange(id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`inspector-panel-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        id={`inspector-panel-${activeTab}`}
        className="inspector-body"
        role="tabpanel"
        aria-labelledby={`inspector-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === 'properties' && (
          <div className="inspector-properties">
            <div className="property-summary-grid">
              <div className="property-summary-card">
                <span>字数</span>
                <strong>{(editorStatus?.wordCount || 0).toLocaleString()}</strong>
              </div>
              <div className={`property-summary-card save-${saveState}`}>
                <span>保存状态</span>
                <strong>{saveState}</strong>
              </div>
            </div>

            <div className="property-group">
              <div className="property-label">标签</div>
              <TagSelector fileId={file.id} tags={tags} onChange={setTags} />
            </div>

            <div className="property-row">
              <span>类型</span>
              <strong>{file.is_folder ? '文件夹' : '笔记'}</strong>
            </div>
            <div className="property-row">
              <span>创建时间</span>
              <strong>{formatUpdated(file.created_at)}</strong>
            </div>
            <div className="property-row">
              <span>最后更新</span>
              <strong>{formatUpdated(file.updated_at)}</strong>
            </div>
            <div className="property-row">
              <span>置顶</span>
              <strong>{file.is_pinned ? '是' : '否'}</strong>
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

export { statusLabel }
