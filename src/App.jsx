import React, { useEffect, useState, useRef } from 'react'
import TextEditor from './components/TextEditor'
import FileList from './components/FileList'
import NavigationRail from './components/NavigationRail'
import { api } from '~/services/api'
import ConfirmDialog from './components/ConfirmDialog'
import ToastViewport from './components/ToastViewport'
import { toast } from '~/services/toast'

const GraphPanel = React.lazy(() => import('./components/GraphPanel'))
const DailyNotesPanel = React.lazy(() => import('./components/DailyNotesPanel'))
const InspectorPanel = React.lazy(() => import('./components/InspectorPanel'))
const ShortcutsModal = React.lazy(() => import('./components/ShortcutsModal'))
const BackupPanel = React.lazy(() => import('./components/BackupPanel'))
const QuickSwitcher = React.lazy(() => import('./components/QuickSwitcher'))
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  const editorRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [workspace, setWorkspace] = useState('notes')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState('properties')
  const [sidebarW, setSidebarW] = useState(() => {
    const v = localStorage.getItem('sidebarWidth')
    const n = v ? parseInt(v, 10) : 280
    return Math.min(420, Math.max(220, isNaN(n) ? 280 : n))
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  const [dragging, setDragging] = useState(false)
  const [current, setCurrent] = useState(null)
  const [content, setContent] = useState('')
  const [switching, setSwitching] = useState(false)
  const [deletedIds, setDeletedIds] = useState(new Set())
  const [dialog, setDialog] = useState(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)

  const unsaved = !!(current && content !== (current.content || ''))

  const select = React.useCallback((f) => {
    setSwitching(true)
    setCurrent(f)
    setContent(f ? (f.content || '') : '')
    setWorkspace('notes')
    if (typeof window !== 'undefined' && window.innerWidth <= 720) {
      setSidebarCollapsed(true)
    }

    if (f && deletedIds.has(f.id)) {
      setDeletedIds(prev => {
        const next = new Set(prev)
        next.delete(f.id)
        return next
      })
    }

    setTimeout(() => setSwitching(false), 180)
  }, [deletedIds])

  const saveCurrent = React.useCallback(async () => {
    if (!current || !editorRef.current) return false
    try {
      const updated = await editorRef.current.save()
      return !!updated
    } catch (e) {
      console.error(e)
      return false
    }
  }, [current])

  const loadAndSelect = React.useCallback((id) => {
    api(`/api/files/${id}`).then(select)
  }, [select])

  const restoreCurrent = React.useCallback(() => {
    if (!current) return
    api(`/api/files/${current.id}`).then(select)
  }, [current, select])

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 100)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return undefined
    const cleanup = window.electronAPI.onReload(() => window.location.reload())
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault()
        void saveCurrent()
      }
      if ((e.ctrlKey || e.metaKey) && k === 'k') {
        e.preventDefault()
        setQuickSearchOpen(true)
      }
      if (k === '/' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setShortcutsOpen(prev => !prev)
      }
      if (k === 'f1') {
        e.preventDefault()
        setShortcutsOpen(true)
      }
      if (k === 'f11') {
        e.preventDefault()
        setFocusMode(prev => !prev)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [saveCurrent])

  useEffect(() => {
    function onMove(e) {
      if (!dragging) return
      const rail = 52
      const w = Math.min(420, Math.max(220, e.clientX - rail))
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

  const handleSelectFile = (f, options = {}) => {
    if (current && f && f.id === current.id) {
      setWorkspace('notes')
      return
    }
    if (options?.skipSave || (current && deletedIds.has(current.id)) || !current || !unsaved) {
      select(f)
      return
    }
    setDialog({ type: 'unsaved', next: () => select(f) })
  }

  const workspaceTitle = workspace === 'daily' ? '每日笔记' : workspace === 'graph' ? '知识图谱' : (current?.title || '笔记')

  return (
    <div className={`app-shell${focusMode ? ' focus-mode' : ''}`}>
      {!focusMode && (
        <NavigationRail
          activeWorkspace={workspace}
          onChangeWorkspace={setWorkspace}
          onOpenSearch={() => setQuickSearchOpen(true)}
          onOpenBackup={() => setBackupOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />
      )}

      <div className="app-surface">
        {!focusMode && (
          <header className="workspace-header">
            <div className="workspace-heading">
              <div className="workspace-kicker">{workspace === 'notes' ? 'Local Notepad' : '工作区'}</div>
              <div className="workspace-title" title={workspaceTitle}>{workspaceTitle}</div>
            </div>
            <div className="workspace-header-actions">
              {workspace === 'notes' && current && (
                <button
                  className={`icon-btn${inspectorOpen ? ' active' : ''}`}
                  onClick={() => setInspectorOpen(prev => !prev)}
                  title="文档信息"
                  aria-label="文档信息"
                  aria-pressed={inspectorOpen}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5M12 8h.01" />
                  </svg>
                </button>
              )}
              {workspace === 'notes' && (
                <button className="icon-btn" onClick={() => setFocusMode(true)} title="专注模式 (F11)" aria-label="进入专注模式">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
                  </svg>
                </button>
              )}
            </div>
          </header>
        )}

        {focusMode && (
          <button className="focus-exit-floating" onClick={() => setFocusMode(false)} title="退出专注模式 (F11)" aria-label="退出专注模式">
            ✕ 退出专注
          </button>
        )}

        <main className="workspace-frame" style={{ '--sidebar-w': `${sidebarW}px` }}>
          {ready ? (
            <>
              {!focusMode && workspace === 'notes' && (
                <>
                  <aside className={`file-sidebar${sidebarCollapsed ? ' collapsed' : ''}`} style={{ '--sidebar-w': `${sidebarW}px` }}>
                    {!sidebarCollapsed && (
                      <ErrorBoundary label="文件列表">
                        <FileList
                          selectedId={current?.id}
                          updatedItem={current}
                          onSelect={handleSelectFile}
                          onBeforeNew={async () => {
                            if (!unsaved) return true
                            return new Promise((resolve) => {
                              setDialog({ type: 'unsaved', next: () => resolve(true), cancel: () => resolve(false) })
                            })
                          }}
                          onBeforeDelete={async () => true}
                          onItemsChanged={(list) => {
                            if (current) {
                              const matched = list.find(i => i.id === current.id)
                              if (!matched) {
                                setDeletedIds(prev => new Set([...prev, current.id]))
                                const nextFile = list.find(i => !i.is_folder) || list[0] || null
                                if (nextFile) select(nextFile)
                                else {
                                  setCurrent(null)
                                  setContent('')
                                }
                                return
                              }

                              setCurrent(prev => prev
                                ? { ...prev, ...matched, content: prev.content }
                                : prev
                              )
                            } else if (list.length) {
                              select(list[0])
                            }
                          }}
                        />
                      </ErrorBoundary>
                    )}
                    <button
                      className="sidebar-toggle-btn"
                      onClick={() => {
                        setSidebarCollapsed(prev => {
                          const next = !prev
                          localStorage.setItem('sidebarCollapsed', String(next))
                          return next
                        })
                      }}
                      title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                      aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                    >
                      {sidebarCollapsed ? '›' : '‹'}
                    </button>
                  </aside>
                  {!sidebarCollapsed && <div className="resizer" onMouseDown={() => setDragging(true)} />}
                </>
              )}

              <section className={`workspace-content${switching ? ' switching' : ''}`}>
                {workspace === 'notes' && (
                  <ErrorBoundary label="编辑器">
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
                          setCurrent({ ...current, ...updated, content: finalContent })
                        }
                      }}
                    />
                  </ErrorBoundary>
                )}

                {workspace === 'daily' && (
                  <React.Suspense fallback={<div className="workspace-loading">正在打开每日笔记…</div>}>
                    <DailyNotesPanel
                      onClose={() => setWorkspace('notes')}
                      onSelectFile={(f) => {
                        if (typeof f === 'string') api(`/api/files/${f}`).then(select)
                        else select(f)
                      }}
                    />
                  </React.Suspense>
                )}

                {workspace === 'graph' && (
                  <React.Suspense fallback={<div className="workspace-loading">正在加载知识图谱…</div>}>
                    <GraphPanel
                      onClose={() => setWorkspace('notes')}
                      onSelectFile={loadAndSelect}
                    />
                  </React.Suspense>
                )}
              </section>

              {!focusMode && workspace === 'notes' && inspectorOpen && current && (
                <React.Suspense fallback={<aside className="inspector-panel inspector-loading">正在加载…</aside>}>
                  <InspectorPanel
                    file={current}
                    activeTab={inspectorTab}
                    onTabChange={setInspectorTab}
                    onClose={() => setInspectorOpen(false)}
                    onSelectFile={loadAndSelect}
                    onRestore={restoreCurrent}
                  />
                </React.Suspense>
              )}
            </>
          ) : (
            <div className="placeholder">正在加载…</div>
          )}
        </main>
      </div>

      <ToastViewport />

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
                  toast.error('保存失败，请重试')
                  setDialog(prev => ({ ...prev, saving: false }))
                }
              }
            },
            {
              label: '不保存',
              disabled: dialog.saving,
              onClick: () => {
                editorRef.current?.clearCache()
                setDialog(null)
                dialog.next()
              }
            },
            {
              label: '取消',
              disabled: dialog.saving,
              onClick: () => {
                dialog.cancel?.()
                setDialog(null)
              }
            },
          ]}
          onClose={() => {
            if (dialog.saving) return
            dialog.cancel?.()
            setDialog(null)
          }}
        />
      )}

      {(shortcutsOpen || backupOpen || quickSearchOpen) && (
        <React.Suspense fallback={null}>
          <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
          <BackupPanel open={backupOpen} onClose={() => setBackupOpen(false)} />
          <QuickSwitcher
            open={quickSearchOpen}
            onClose={() => setQuickSearchOpen(false)}
            onSelectFile={handleSelectFile}
          />
        </React.Suspense>
      )}
    </div>
  )
}
