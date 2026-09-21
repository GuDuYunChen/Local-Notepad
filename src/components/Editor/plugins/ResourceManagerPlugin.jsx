import React, { useEffect, useMemo, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey, $getRoot } from 'lexical'

export function describeSerializedResource(serialized, key = '') {
  if (!serialized?.type) return null

  if (serialized.type === 'image') {
    return {
      key,
      kind: 'image',
      label: serialized.caption || serialized.alt || '图片',
      meta: serialized.alt || '',
      preview: serialized.src || '',
    }
  }

  if (serialized.type === 'image-grid') {
    const items = Array.isArray(serialized.items) ? serialized.items : []
    return {
      key,
      kind: 'image-grid',
      label: `图片组 · ${items.length} 张`,
      meta: items.map(item => item.caption || item.alt).filter(Boolean).slice(0, 2).join(' · '),
      preview: items[0]?.src || '',
    }
  }

  if (serialized.type === 'video') {
    const duration = Number(serialized.duration) || 0
    const minutes = Math.floor(duration / 60)
    const seconds = Math.floor(duration % 60)
    return {
      key,
      kind: 'video',
      label: '视频',
      meta: duration ? `${minutes}:${String(seconds).padStart(2, '0')}` : '',
      preview: serialized.poster || '',
    }
  }

  if (serialized.type === 'attachment') {
    return {
      key,
      kind: 'attachment',
      label: serialized.name || '附件',
      meta: [serialized.mime, serialized.size ? formatBytes(serialized.size) : ''].filter(Boolean).join(' · '),
      preview: '',
    }
  }

  return null
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (!value) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function collectResourcesFromState() {
  const resources = []

  const visit = node => {
    const descriptor = describeSerializedResource(node.exportJSON?.(), node.getKey?.() || '')
    if (descriptor) resources.push(descriptor)

    for (const child of node.getChildren?.() || []) visit(child)
  }

  for (const child of $getRoot().getChildren()) visit(child)
  return resources
}

const FILTERS = [
  ['all', '全部'],
  ['image', '图片'],
  ['video', '视频'],
  ['attachment', '附件'],
]

export default function ResourceManagerPlugin({ readOnly = false }) {
  const [editor] = useLexicalComposerContext()
  const [resources, setResources] = useState([])
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const collect = editorState => {
      let next = []
      editorState.read(() => {
        next = collectResourcesFromState()
      })
      setResources(next)
      if (!next.length) setOpen(false)
    }

    collect(editor.getEditorState())

    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      const changed = (dirtyElements?.size || 0) > 0 || (dirtyLeaves?.size || 0) > 0
      if (changed) collect(editorState)
    })
  }, [editor])

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    return resources.filter(resource => {
      const kindMatches = filter === 'all'
        || filter === resource.kind
        || (filter === 'image' && resource.kind === 'image-grid')
      if (!kindMatches) return false

      if (!normalized) return true
      return `${resource.label} ${resource.meta}`.toLowerCase().includes(normalized)
    })
  }, [resources, filter, query])

  if (!resources.length) return null

  const locate = resource => {
    const element = editor.getElementByKey(resource.key)
    if (!element) return

    setOpen(false)
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      element.classList.add('resource-manager-target')
      window.setTimeout(() => element.classList.remove('resource-manager-target'), 900)
    }, 180)
  }

  const remove = resource => {
    editor.update(() => {
      const node = $getNodeByKey(resource.key)
      node?.remove?.()
    })
  }

  return (
    <div className={`editor-resource-manager${open ? ' open' : ''}`}>
      <button
        type="button"
        className="editor-resource-toggle"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        title="当前笔记资源"
      >
        <span>资源</span>
        <b>{resources.length}</b>
      </button>

      {open && (
        <section className="editor-resource-panel" aria-label="当前笔记资源">
          <header className="editor-resource-header">
            <div>
              <strong>当前笔记资源</strong>
              <span>{resources.length} 个媒体或附件块</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭资源面板">×</button>
          </header>

          <div className="editor-resource-controls">
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索资源…"
              aria-label="搜索资源"
            />
            <div className="editor-resource-filters">
              {FILTERS.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={filter === value ? 'active' : ''}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="editor-resource-list">
            {visible.length ? visible.map(resource => (
              <article key={resource.key} className="editor-resource-item">
                <button
                  type="button"
                  className="editor-resource-preview"
                  onClick={() => locate(resource)}
                  title="定位到正文"
                >
                  {resource.preview ? (
                    <img src={resource.preview} alt="" />
                  ) : (
                    <span>{resource.kind === 'video' ? '▶' : resource.kind === 'attachment' ? 'FILE' : 'IMG'}</span>
                  )}
                </button>

                <div className="editor-resource-copy">
                  <strong title={resource.label}>{resource.label}</strong>
                  <small>{resource.meta || (
                    resource.kind === 'image-grid' ? '图片组'
                      : resource.kind === 'image' ? '图片'
                        : resource.kind === 'video' ? '视频'
                          : '附件'
                  )}</small>
                </div>

                <div className="editor-resource-actions">
                  <button type="button" onClick={() => locate(resource)}>定位</button>
                  {!readOnly && (
                    <button type="button" className="danger" onClick={() => remove(resource)}>删除</button>
                  )}
                </div>
              </article>
            )) : (
              <div className="editor-resource-empty">没有匹配的资源</div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
