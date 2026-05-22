import React, { useState, useEffect, useRef } from 'react'
import { tagApi } from '~/services/tagApi'
import { message } from 'antd'

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
      message.error('标签操作失败')
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
      message.error('创建标签失败')
    }
  }

  return (
    <div className="tag-selector" ref={dropdownRef}>
      <div className="tag-list">
        {tags.map(tag => (
          <span
            key={tag.id}
            className="tag-badge"
            style={{ backgroundColor: tag.color }}
            onClick={() => toggleTag(tag)}
          >
            {tag.name} ×
          </span>
        ))}
        <button className="tag-add-btn" onClick={() => setDropdownOpen(!dropdownOpen)} title="管理标签">
          +
        </button>
      </div>
      {dropdownOpen && (
        <div className="tag-dropdown">
          <div className="tag-options">
            {allTags.map(tag => {
              const isAttached = tags.some(t => t.id === tag.id)
              return (
                <div
                  key={tag.id}
                  className={`tag-option ${isAttached ? 'attached' : ''}`}
                  onClick={() => toggleTag(tag)}
                >
                  <span className="tag-color-dot" style={{ backgroundColor: tag.color }} />
                  <span className="tag-option-name">{tag.name}</span>
                  {isAttached && <span className="tag-check">✓</span>}
                </div>
              )
            })}
          </div>
          {showCreate ? (
            <div className="tag-create-form">
              <input
                className="tag-input"
                placeholder="标签名称"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createTag()}
                autoFocus
              />
              <button className="btn small" onClick={createTag}>创建</button>
              <button className="btn small" onClick={() => setShowCreate(false)}>取消</button>
            </div>
          ) : (
            <button className="tag-create-btn" onClick={() => setShowCreate(true)}>
              + 新建标签
            </button>
          )}
        </div>
      )}
    </div>
  )
}
