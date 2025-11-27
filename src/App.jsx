import React, { useEffect, useState, useRef } from 'react'
import ThemeToggle from './components/ThemeToggle'
import TextEditor from './components/TextEditor'
import FileList from './components/FileList'
import { api } from '~/services/api'
import ConfirmDialog from './components/ConfirmDialog'

// 应用根组件：后续接入路由、主题与编辑器
/**
 * 应用根组件
 * 功能：提供基础布局与主题切换入口，后续承载文件列表与编辑器区域
 */
export default function App() {
  const editorRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [sidebarW, setSidebarW] = useState(() => {
    const v = localStorage.getItem('sidebarWidth')
    const n = v ? parseInt(v, 10) : 280
    return Math.min(480, Math.max(200, isNaN(n) ? 280 : n))
  })
  const [dragging, setDragging] = useState(false)
  const [current, setCurrent] = useState(null)
  const [content, setContent] = useState('')
  const [switching, setSwitching] = useState(false)
  const [dialog, setDialog] = useState(null)
  const unsaved = !!(current && content !== (current.content || ''))
  const select = (f) => {
    setSwitching(true)
    setCurrent(f)
    setContent(f.content || '')
    setTimeout(() => setSwitching(false), 180)
  }
  async function saveCurrent() {
    if (!current || !editorRef.current) return false
    try {
      const updated = await editorRef.current.save()
      return !!updated
    } catch (e) {
      console.error(e)
      return false
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 100)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase()
      if (e.ctrlKey && k === 's') {
        e.preventDefault()
        void saveCurrent()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current]) // Removed content dependency as saveCurrent doesn't use it directly

  useEffect(() => {
    function onMove(e) {
      if (!dragging) return
      const w = Math.min(480, Math.max(200, e.clientX))
      setSidebarW(w)
      localStorage.setItem('sidebarWidth', String(w))
    }
    function onUp() {
      if (dragging) setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  return (
    <div className="app">
      <header className="app-header">
        <h1>记事本</h1>
        <div className="spacer" />
        <ThemeToggle />
      </header>
      <main className="app-main flex" style={{ '--sidebar-w': `${sidebarW}px` }}>
        {ready ? (
          <>
            <aside className="sidebar">
              <FileList
                selectedId={current?.id}
                updatedItem={current}
                onSelect={(f) => {
                  if (!current || f.id === current.id || !unsaved) { select(f); return }
                  setDialog({ type: 'unsaved', next: () => select(f) })
                }}
                onBeforeNew={async () => {
                  if (!unsaved) return true
                  return new Promise((resolve) => {
                    setDialog({ type: 'unsaved', next: () => resolve(true), cancel: () => resolve(false) })
                  })
                }}
                onBeforeDelete={async (id) => {
                  return new Promise((resolve) => {
                    setDialog({ type: 'delete', id, resolve })
                  })
                }}
                onItemsChanged={(list) => { if (!current && list.length) select(list[0]) }}
              />
            </aside>
            <div className="resizer" onMouseDown={() => setDragging(true)} />
            <section className={`content${switching ? ' switching' : ''}`}>
              <TextEditor
                ref={editorRef}
                activeId={current?.id || null}
                onChange={setContent}
                onLoaded={(text) => {
                  if (current) {
                    setCurrent(prev => ({ ...prev, content: text }))
                    setContent(text)
                  }
                }}
                onSaved={(updated) => {
                  if (current) {
                    const finalContent = updated.content !== undefined ? updated.content : content
                    const merged = { ...current, ...updated, content: finalContent }
                    setCurrent(merged)
                  }
                }}
              />
            </section>
          </>
        ) : (
          <div className="placeholder">正在加载…</div>
        )}
      </main>
      {dialog?.type === 'unsaved' && (
        <ConfirmDialog
          title="当前文件未保存"
          message="是否保存更改？"
          actions={[
            { label: '保存', kind: 'primary', onClick: async () => { 
              const ok = await saveCurrent()
              if (ok) {
                dialog.next() 
                setDialog(null) 
              } else { 
                alert('保存失败，请重试') 
              } 
            }},
            { label: '不保存', onClick: () => { dialog.next(); setDialog(null) } },
            { label: '取消', onClick: () => { setDialog(null) } },
          ]}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title="确认删除"
          message="删除后不可恢复，是否继续？"
          actions={[
            { label: '删除', kind: 'danger', onClick: () => { dialog.resolve(true); setDialog(null) } },
            { label: '取消', onClick: () => { dialog.resolve(false); setDialog(null) } },
          ]}
          onClose={() => { dialog.resolve(false); setDialog(null) }}
        />
      )}
    </div>
  )
}
