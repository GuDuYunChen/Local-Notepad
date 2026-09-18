import React, { useEffect, useRef, useState, useImperativeHandle } from 'react'
import { api } from '~/services/api'
import { countLexicalCharacters } from '~/utils/lexicalText'

const Editor = React.lazy(() => import('./Editor/Editor'))

function TextEditorInternal({
  activeId,
  deletedIds,
  onChange,
  onLoaded,
  onSaved,
  onStatusChange,
  onCreateNote,
  onOpenSearch,
  onOpenDaily,
  autoSaveOnSwitch = true,
}, ref) {
  const contentRef = useRef('')
  const lastSavedContentRef = useRef('')
  const saveTimerRef = useRef(null)
  const intervalRef = useRef(null)
  const saveAbortRef = useRef(null)
  const loadAbortRef = useRef(null)
  const inFlightSaveRef = useRef(null)
  const currentIdRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [selMode, setSelMode] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const statusRef = useRef(null)
  const [editorContent, setEditorContent] = useState('')

  const onChangeRef = useRef(onChange)
  const onLoadedRef = useRef(onLoaded)
  const onSavedRef = useRef(onSaved)
  const onStatusChangeRef = useRef(onStatusChange)
  const deletedIdsRef = useRef(deletedIds)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onLoadedRef.current = onLoaded }, [onLoaded])
  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])
  useEffect(() => { onStatusChangeRef.current = onStatusChange }, [onStatusChange])
  useEffect(() => { deletedIdsRef.current = deletedIds }, [deletedIds])

  const saveNow = React.useCallback(async (reason, specificId = null, contentOverride = null) => {
    const id = specificId || currentIdRef.current
    if (!id) return

    if (deletedIdsRef.current?.has(id)) return

    const text = contentOverride ?? contentRef.current
    if (id === currentIdRef.current && text === lastSavedContentRef.current) {
      setSaveError(false)
      return { id, content: text, skipped: true }
    }

    if (inFlightSaveRef.current?.id === id) {
      if (inFlightSaveRef.current.content === text) {
        return inFlightSaveRef.current.promise
      }
      const queuedText = text
      return inFlightSaveRef.current.promise.then(() => saveNow(reason, id, queuedText))
    }

    const ctl = new AbortController()
    const savePromise = (async () => {
      try {
        setSaving(true)
        setSaveError(false)
        saveAbortRef.current = ctl

        const updated = await api(`/api/files/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ content: text }),
          signal: ctl.signal,
        })

        const now = Date.now()
        if (id === currentIdRef.current) {
          lastSavedContentRef.current = text
          setLastSavedAt(now)
          cacheWrite(id, text, now)
          onSavedRef.current?.(updated)
        }
        return updated
      } catch (e) {
        if (e.name === 'AbortError') return
        if (e.message?.includes('更新失败') && deletedIdsRef.current?.has(id)) return
        if (id === currentIdRef.current) setSaveError(true)
        console.error('保存失败', reason, e)
        throw e
      } finally {
        if (saveAbortRef.current === ctl) saveAbortRef.current = null
        if (inFlightSaveRef.current?.promise === savePromise) inFlightSaveRef.current = null
        setSaving(false)
      }
    })()

    inFlightSaveRef.current = { id, content: text, promise: savePromise }
    return savePromise
  }, [])

  useImperativeHandle(ref, () => ({
    save: () => saveNow('external'),
    clearCache: () => {
      if (currentIdRef.current) cacheRemove(currentIdRef.current)
    }
  }))

  useEffect(() => {
    if (activeId === currentIdRef.current) return

    setSwitching(true)
    setSaveError(false)

    const prevId = currentIdRef.current
    if (prevId && contentRef.current !== undefined) {
      const isDeleted = deletedIds?.has(prevId)
      if (!isDeleted && autoSaveOnSwitch) {
        cacheWrite(prevId, contentRef.current)
        void saveNow('manual', prevId)
      }
    }

    loadAbortRef.current?.abort()
    const loadCtl = new AbortController()
    loadAbortRef.current = loadCtl
    currentIdRef.current = activeId || null

    if (!activeId) {
      setSwitching(false)
      setLoading(false)
      setLastSavedAt(null)
      lastSavedContentRef.current = ''
      contentRef.current = ''
      setEditorContent('')
      return
    }

    const load = async (id) => {
      setLoading(true)
      try {
        const f = await api(`/api/files/${id}`)
        if (id !== currentIdRef.current) return

        const cached = cacheRead(id)
        const cacheMaxAge = 5 * 60 * 1000
        const isCacheFresh = cached && cached.editedAt && (Date.now() - cached.editedAt) < cacheMaxAge
        const useCache = isCacheFresh && cached.editedAt && (!f.updated_at || cached.editedAt > f.updated_at * 1000)
        const serverText = f.content || ''
        const text = useCache ? cached.content : serverText

        lastSavedContentRef.current = serverText
        setLastSavedAt(f.updated_at ? f.updated_at * 1000 : null)
        contentRef.current = text || ''
        setWordCount(countLexicalCharacters(text || ''))
        setEditorContent(text || '')
        onChangeRef.current?.(contentRef.current)
        onLoadedRef.current?.(contentRef.current)
      } catch (e) {
        if (e.name !== 'AbortError') console.error('加载内容失败', e)
      } finally {
        if (id === currentIdRef.current) {
          setLoading(false)
          setSwitching(false)
        }
      }
    }

    load(activeId)

    return () => {
      loadCtl.abort()
      if (loadAbortRef.current === loadCtl) loadAbortRef.current = null
    }
  }, [activeId, autoSaveOnSwitch])

  useEffect(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current)
    intervalRef.current = window.setInterval(() => { saveNow('interval') }, 30000)
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [saveNow])

  useEffect(() => {
    onStatusChangeRef.current?.({
      activeId,
      saving,
      saveError,
      lastSavedAt,
      dirty: Boolean(activeId && contentRef.current !== lastSavedContentRef.current),
      wordCount,
    })
  }, [activeId, saving, saveError, lastSavedAt, wordCount])

  useEffect(() => {
    const apply = () => {
      const h = statusRef.current ? statusRef.current.offsetHeight : 34
      document.documentElement.style.setProperty('--status-bar-h', `${h}px`)
    }
    apply()
    window.addEventListener('resize', apply)
    const onMode = (e) => setSelMode(!!e.detail)
    window.addEventListener('tableSelection:mode', onMode)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('tableSelection:mode', onMode)
    }
  }, [])

  const formatSavedTime = (ts) => {
    if (!ts) return ''
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(ts))
  }

  const scheduleCache = () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      if (currentIdRef.current) cacheWrite(currentIdRef.current, contentRef.current)
    }, 250)
  }

  const handleEditorChange = React.useCallback((newContent) => {
    contentRef.current = newContent
    setSaveError(false)
    scheduleCache()
    onChangeRef.current?.(newContent)

    setWordCount(countLexicalCharacters(newContent))
  }, [])

  return (
    <div
      className={switching ? 'content switching' : 'content'}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => setDragOver(false)}
    >
      {dragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <div className="drag-icon">📄</div>
            <div className="drag-text">释放以导入文件</div>
          </div>
        </div>
      )}

      {!activeId ? (
        <div className="empty-editor-state">
          <div className="empty-editor-mark">N</div>
          <div className="empty-editor-title">从这里开始</div>
          <div className="empty-editor-desc">创建一篇新笔记，或快速回到已有内容。数据始终保存在本地。</div>
          <div className="empty-editor-actions">
            <button className="btn primary" onClick={onCreateNote}>新建笔记</button>
            <button className="btn" onClick={onOpenSearch}>快速搜索</button>
            <button className="btn" onClick={onOpenDaily}>每日笔记</button>
          </div>
          <div className="empty-editor-shortcuts">
            <span><kbd>Ctrl N</kbd> 新建</span>
            <span><kbd>Ctrl K</kbd> 搜索</span>
          </div>
        </div>
      ) : loading ? (
        <div className="placeholder">加载中…</div>
      ) : (
        <>
          <React.Suspense fallback={<div className="placeholder">正在加载编辑器…</div>}>
            <Editor initialContent={editorContent} onChange={handleEditorChange} />
          </React.Suspense>
          <div ref={statusRef} className="editor-status-bar">
            <span className={`save-state${saveError ? ' error' : ''}`}>
              {saveError ? '保存失败' : saving ? '保存中…' : lastSavedAt ? `已保存 ${formatSavedTime(lastSavedAt)}` : '尚未保存'}
              {saveError && (
                <button className="status-retry-btn" onClick={() => saveNow('retry')} disabled={saving}>重试</button>
              )}
            </span>
            <span className="status-right">
              {selMode && <span className="selection-mode-pill">表格选择模式</span>}
              <span>{wordCount.toLocaleString()} 字</span>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const memoryCache = new Map()

function supportsLocalStorage() {
  try {
    const k = '__supports_ls__'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}

const cacheRead = (id) => {
  try {
    if (!supportsLocalStorage()) return memoryCache.get(id) || null
    const raw = localStorage.getItem(`editor:cache:${id}`)
    if (!raw) return memoryCache.get(id) || null
    return JSON.parse(raw)
  } catch {
    return memoryCache.get(id) || null
  }
}

const cacheWrite = (id, content, savedAt) => {
  const payload = { content, editedAt: Date.now(), savedAt }
  memoryCache.set(id, payload)
  if (!supportsLocalStorage()) return
  if (content.length > 1024 * 1024) return
  try { localStorage.setItem(`editor:cache:${id}`, JSON.stringify(payload)) } catch {}
}

const cacheRemove = (id) => {
  memoryCache.delete(id)
  if (!supportsLocalStorage()) return
  try { localStorage.removeItem(`editor:cache:${id}`) } catch {}
}

const TextEditor = React.forwardRef(TextEditorInternal)
export default TextEditor
