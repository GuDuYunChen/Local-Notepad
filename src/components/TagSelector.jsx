import React, { useState, useEffect, useRef } from 'react'
import { tagApi } from '~/services/tagApi'
import { toast } from '~/services/toast'

export default function TagSelector({ fileId, tags, onChange }) {
  const [allTags, setAllTags] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    loadTags()
  }, [])

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function loadTags() {
    try {
      const data = await tagApi.list()
      setAllTags(data || [])
    } catch (e) {
      console.error(e)
    }
  }

  async function toggleTag(tag) {
    const isAttached = tags.some(t => t.id === tag.id)
    try {
      if (isAttached) {
        await tagApi.removeFileTag(fileId, tag.id)
      } else {
        await tagApi.addFileTag(fileId, tag.id)
      }
      const updated = await tagApi.getFileTags(fileId)
      onChange(updated || [])
    } catch (e) {
      toast.error('标签操作失败')
    }
  }

  async function createTag() {
    if (!newTagName.trim()) return
    try {
      await tagApi.create({ name: newTagName.trim() })
      setNewTagName('')
      setShowCreate(false)
      await loadTags()
    } catch (e) {
      toast.error('创建标签失败')
    }
  }

  const closeDropdown = () => {
    setDropdownOpen(false)
    setShowCreate(false)
    setNewTagName('')
  }

  return (
    <div
      className="tag-selector"
      ref={dropdownRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && dropdownOpen) {
          event.stopPropagation()
          closeDropdown()
        }
      }}
    >
      <div className="tag-list">
        {tags.map(tag => (
          <button
            key={tag.id}
            type="button"
            className="tag-badge"
            style={{ backgroundColor: tag.color }}
            onClick={() => toggleTag(tag)}
            aria-label={`移除标签 ${tag.name}`}
            title={`移除标签：${tag.name}`}
          >
            {tag.name} ×
          </button>
        ))}
        <button
          type="button"
          className="tag-add-btn"
          onClick={() => setDropdownOpen(prev => !prev)}
          title="管理标签"
          aria-label="管理标签"
          aria-haspopup="dialog"
          aria-expanded={dropdownOpen}
        >
          +
        </button>
      </div>
      {dropdownOpen && (
        <div className="tag-dropdown" role="dialog" aria-label="管理标签">
          <div className="tag-options" role="listbox" aria-label="可用标签" aria-multiselectable="true">
            {allTags.map(tag => {
              const isAttached = tags.some(t => t.id === tag.id)
              return (
                <button
                  type="button"
                  key={tag.id}
                  className={`tag-option ${isAttached ? 'attached' : ''}`}
                  onClick={() => toggleTag(tag)}
                  role="option"
                  aria-selected={isAttached}
                >
                  <span className="tag-color-dot" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                  <span className="tag-option-name">{tag.name}</span>
                  {isAttached && <span className="tag-check" aria-hidden="true">✓</span>}
                </button>
              )
            })}
          </div>
          {showCreate ? (
            <div className="tag-create-form">
              <input
                className="tag-input"
                placeholder="标签名称"
                aria-label="标签名称"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createTag()}
                autoFocus
              />
              <button type="button" className="btn small" onClick={createTag}>创建</button>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setShowCreate(false)
                  setNewTagName('')
                }}
              >
                取消
              </button>
            </div>
          ) : (
            <button type="button" className="tag-create-btn" onClick={() => setShowCreate(true)}>
              + 新建标签
            </button>
          )}
        </div>
      )}
    </div>
  )
}
