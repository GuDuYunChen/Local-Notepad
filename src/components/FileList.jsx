import React, { useEffect, useState } from 'react'
import { api } from '~/services/api'
import NameDialog from './NameDialog'

/**
 * 文件列表组件
 * 职责：展示应用库中的文件列表，提供新建/打开/保存/删除基础操作
 */
export default function FileList({ selectedId, onSelect, onBeforeNew, onBeforeDelete, onItemsChanged, updatedItem }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [naming, setNaming] = useState(false)
  const [renaming, setRenaming] = useState(null)

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!updatedItem) return
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === updatedItem.id)
      if (idx < 0) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], ...updatedItem }
      return next
    })
  }, [updatedItem])

  async function load() {
    setLoading(true)
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : ''
      const list = await api(`/api/files${qs}`)
      const sorted = [...list].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
      setItems(sorted)
      onItemsChanged?.(sorted)
      if (!selectedId && sorted.length > 0) { onSelect(sorted[0]) }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function onNew() {
    try {
      const ok = await (onBeforeNew?.() ?? true)
      if (!ok) return
      setNaming(true)
    } catch (e) {
      console.error(e)
    }
  }

  async function onImport() {
    try {
      const paths = await window.electronAPI.openFileDialog()
      if (!paths || paths.length === 0) return
      if (paths.length === 1) {
        const created = await api('/api/files/import', {
          method: 'POST',
          body: JSON.stringify({ path: paths[0], encoding: 'utf-8' }),
        })
        const next = [created, ...items]
        const sorted = [...next].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
        setItems(sorted)
        onItemsChanged?.(sorted)
      } else {
        const createdList = await api('/api/files/import', {
          method: 'POST',
          body: JSON.stringify({ paths, encoding: 'utf-8' }),
        })
        const next = [...createdList, ...items]
        const sorted = [...next].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
        setItems(sorted)
        onItemsChanged?.(sorted)
      }
    } catch (e) { console.error(e) }
  }

  async function onSaveAs(id) {
    try {
      const path = await window.electronAPI.saveFileDialog()
      if (!path) return
      await api(`/api/files/${id}/save-as`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
    } catch (e) { console.error(e) }
  }

  async function onDelete(id) {
    try {
      const ok = await (onBeforeDelete?.(id) ?? true)
      if (!ok) return
      await api(`/api/files/${id}`, { method: 'DELETE' })
      const next = items.filter(i => i.id !== id)
      const sorted = [...next].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
      setItems(sorted)
      onItemsChanged?.(sorted)
      if (selectedId === id) { if (sorted.length > 0) onSelect(sorted[0]) }
    } catch (e) {
      console.error(e)
    }
  }

  function validateName(n) {
    const illegal = /[\\/:*?"<>|]/
    if (illegal.test(n)) return '文件名不能包含 \\/ : * ? " < > |'
    if (n.length > 100) return '文件名过长（最多100个字符）'
    return ''
  }

  async function onRenameConfirm(id, name) {
    try {
      const updated = await api(`/api/files/${id}`, { method: 'PUT', body: JSON.stringify({ title: name }) })
      setItems(prev => prev.map(i => i.id === id ? { ...i, title: updated.title } : i))
      onItemsChanged?.(items)
      setRenaming(null)
    } catch (e) { console.error(e) }
  }

  function format(ts) {
    const d = new Date(ts * 1000)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  return (
    <div className="file-list">
      <div className="toolbar colored">
        <button className="btn primary" onClick={onNew}>新建</button>
        <button className="btn" onClick={onImport}>导入</button>
        <div className="search-box">
          <input className="input" placeholder="搜索标题或内容" value={q} onChange={e => setQ(e.target.value)} />
          <button className="btn" onClick={() => void load()}>搜索</button>
        </div>
      </div>
      {loading ? (
        <div className="placeholder">加载中…</div>
      ) : (
        <ul className="list">
          {items.map(i => (
            <li key={i.id} className={`list-item${selectedId === i.id ? ' active' : ''}`} onClick={() => onSelect(i)}>
              <div className="info">
                <div className="title" title={i.title}>{i.title}</div>
                <div className="meta">{format(i.updated_at)}</div>
              </div>
              <div className="actions">
                <button className="btn" onClick={(e) => { e.stopPropagation(); setRenaming(i) }}>重命名</button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); void onSaveAs(i.id) }}>另存为</button>
                <button className="btn" onClick={(e) => { e.stopPropagation(); void onDelete(i.id) }}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {naming && (
        <NameDialog
          defaultName={'未命名.md'}
          title={'新建文件'}
          message={'请输入文件名（可包含扩展名）：'}
          onConfirm={async (name) => {
            try {
              const item = await api('/api/files', { method: 'POST', body: JSON.stringify({ title: name, content: '' }) })
              const next = [item, ...items]
              const sorted = [...next].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
              setItems(sorted)
              onItemsChanged?.(sorted)
              onSelect(item)
            } catch (e) { console.error(e) }
            setNaming(false)
          }}
          onCancel={() => setNaming(false)}
        />
      )}
      {renaming && (
        <NameDialog
          defaultName={renaming.title}
          title={'重命名文件'}
          message={`当前文件名：${renaming.title}`}
          validate={validateName}
          onConfirm={(name) => void onRenameConfirm(renaming.id, name)}
          onCancel={() => setRenaming(null)}
        />
      )}
    </div>
  )
}
