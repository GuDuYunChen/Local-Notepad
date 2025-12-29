import React, { useEffect, useState, useRef } from 'react'
import ThemeToggle from './components/ThemeToggle'
import TextEditor from './components/TextEditor'
import FileList from './components/FileList'
import { api } from '~/services/api'
import ConfirmDialog from './components/ConfirmDialog'
import { message } from 'antd'

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
  const [deletedIds, setDeletedIds] = useState(new Set()) // Track deleted files to skip save
  const [dialog, setDialog] = useState(null)
  // Check unsaved changes: compare current content with original content from database
  // Note: current.content holds the original content loaded from DB.
  // content holds the current editor content.
  // If current is null, no file selected.
  const unsaved = !!(current && content !== (current.content || ''))
  
  const select = (f) => {
    setSwitching(true)
    setCurrent(f)
    setContent(f ? (f.content || '') : '')
    
    // Clear from deletedIds if we are selecting it (e.g. Undo delete)
    if (f && deletedIds.has(f.id)) {
        setDeletedIds(prev => {
            const next = new Set(prev)
            next.delete(f.id)
            return next
        })
    }

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
  }, [current])

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
                onSelect={(f, options = {}) => {
                  // If switching to the same file, do nothing
                  if (current && f && f.id === current.id) return
                  
                  // Force skip save check (e.g. after delete)
                  if (options?.skipSave) {
                      select(f)
                      return
                  }
                  
                  // Check if current file was deleted
                  if (current && deletedIds.has(current.id)) {
                      select(f)
                      return
                  }
                  
                  // Check for unsaved changes
                  if (!current || !unsaved) { 
                      select(f)
                      return 
                  }
                  
                  // Show Unsaved Dialog
                  setDialog({ 
                      type: 'unsaved', 
                      next: () => select(f) 
                  })
                }}
                onBeforeNew={async () => {
                  if (!unsaved) return true
                  return new Promise((resolve) => {
                    setDialog({ type: 'unsaved', next: () => resolve(true), cancel: () => resolve(false) })
                  })
                }}
                onBeforeDelete={async (id) => {
                  // This callback is now deprecated/unused by FileList for delete confirmation,
                  // but might still be called? No, FileList handles delete internally now.
                  // However, we can use this to notify App about deletion start?
                  // Or better, FileList should notify us about deletion.
                  // Since FileList handles delete, we need a way to track deleted IDs here.
                  // But FileList doesn't emit "onDeleted" prop.
                  // We can infer it from onItemsChanged or we can add onDeleted prop.
                  // For now, let's rely on FileList calling onItemsChanged.
                  return true 
                }}
                onItemsChanged={(list) => { 
                    // Detect if current file is gone
                    if (current && !list.find(i => i.id === current.id)) {
                        // Current file deleted. Add to deletedIds to prevent save.
                        setDeletedIds(prev => new Set([...prev, current.id]))
                        // If FileList didn't select new one yet (it should have), we might need to handle it.
                        // But FileList logic says it calls onSelect.
                    }
                    if (!current && list.length) select(list[0]) 
                }}
              />
            </aside>
            <div className="resizer" onMouseDown={() => setDragging(true)} />
            <section className={`content${switching ? ' switching' : ''}`}>
              <TextEditor
                ref={editorRef}
                activeId={current?.id || null}
                deletedIds={deletedIds}
                autoSaveOnSwitch={false}
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
            { 
              label: '保存', 
              kind: 'primary', 
              loading: dialog.saving,
              onClick: async () => { 
                setDialog(prev => ({ ...prev, saving: true }))
                const ok = await saveCurrent()
                if (ok) {
                  setDialog(null)
                  dialog.next() 
                } else { 
                  message.error('保存失败，请重试') 
                  setDialog(prev => ({ ...prev, saving: false }))
                } 
              }
            },
            { 
              label: '不保存', 
              disabled: dialog.saving,
              onClick: () => { 
                  setDialog(null)
                  dialog.next() 
              } 
            },
            { 
              label: '取消', 
              disabled: dialog.saving,
              onClick: () => { 
                  if (dialog.cancel) dialog.cancel()
                  setDialog(null) 
              } 
            },
          ]}
          onClose={() => { 
              if (dialog.saving) return
              if (dialog.cancel) dialog.cancel()
              setDialog(null) 
          }}
        />
      )}
      {/* Delete dialog is handled in FileList now, so we can remove 'delete' type here if unused, 
          but we keep 'unsaved' logic. */}
    </div>
  )
}
