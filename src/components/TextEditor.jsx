import React, { useEffect, useMemo, useRef, useState, useImperativeHandle } from 'react'
import { api } from '~/services/api'
import { tagApi } from '~/services/tagApi'
import Editor from './Editor/Editor'
import TagSelector from './TagSelector'

function TextEditorInternal({ activeId, deletedIds, onChange, onLoaded, onSaved, autoSaveOnSwitch = true }, ref) {
  // taRef, query, rep, wrapOn removed as they are specific to textarea
  const contentRef = useRef('')
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
  const [selMode, setSelMode] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [fileTags, setFileTags] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const statusRef = useRef(null)
  const [editorContent, setEditorContent] = useState('')

  const onChangeRef = useRef(onChange)
  const onLoadedRef = useRef(onLoaded)
  const onSavedRef = useRef(onSaved)
  const deletedIdsRef = useRef(deletedIds)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onLoadedRef.current = onLoaded }, [onLoaded])
  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])
  useEffect(() => { deletedIdsRef.current = deletedIds }, [deletedIds])

  const saveNow = React.useCallback(async (reason, specificId = null) => {
    const id = specificId || currentIdRef.current
    if (!id) return
    
    // Check if deleted
    if (deletedIdsRef.current && deletedIdsRef.current.has(id)) {
        console.debug('Skip save for deleted file:', id)
        return
    }

    const text = contentRef.current
    if (inFlightSaveRef.current?.id === id) {
      return inFlightSaveRef.current.promise
    }

    const ctl = new AbortController()
    const savePromise = (async () => {
      try {
        setSaving(true)
        saveAbortRef.current = ctl
        const updated = await api(`/api/files/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ content: text }),
          signal: ctl.signal,
        })
        const now = Date.now()
        // Only update UI state if we are still on the same file
        if (id === currentIdRef.current) {
          setLastSavedAt(now)
          cacheWrite(id, text, now)
          onSavedRef.current?.(updated)
        }
        console.debug('自动保存完成', reason, id, now)
        return updated
      } catch (e) {
        if (e.name === 'AbortError') return
        
        // If error is 1006 (Update failed) and likely due to file deleted, suppress or warn gently
        // But we don't have the code here easily, just the message.
        // If message contains "更新失败", it might be deleted.
        if (e.message && e.message.includes('更新失败')) {
          // Check if it might be deleted
          if (deletedIdsRef.current && deletedIdsRef.current.has(id)) {
              console.warn('Suppressing save error for deleted file:', id)
              return
          }
        }

        console.error('保存失败', reason, e)
        throw e
      } finally {
        if (saveAbortRef.current === ctl) {
          saveAbortRef.current = null
        }
        if (inFlightSaveRef.current?.promise === savePromise) {
          inFlightSaveRef.current = null
        }
        setSaving(false)
      }
    })()

    inFlightSaveRef.current = { id, promise: savePromise }
    return savePromise
  }, [])

  useImperativeHandle(ref, () => ({
    save: () => saveNow('external'),
    clearCache: () => {
        if (currentIdRef.current) {
            cacheRemove(currentIdRef.current)
        }
    }
  }))

  useEffect(() => {
    if (activeId === currentIdRef.current) return

    setSwitching(true)
    
    const prevId = currentIdRef.current
    if (prevId && contentRef.current !== undefined) {
      const isDeleted = deletedIds?.has(prevId)
      if (!isDeleted && autoSaveOnSwitch) {
        cacheWrite(prevId, contentRef.current)
        void saveNow('manual', prevId) 
      }
    }

    if (loadAbortRef.current) { loadAbortRef.current.abort() }
    const loadCtl = new AbortController()
    loadAbortRef.current = loadCtl

    currentIdRef.current = activeId || null

    if (!activeId) {
      setSwitching(false)
      setLoading(false)
      setLastSavedAt(null)
      setFileTags([])
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
        const text = useCache ? cached.content : f.content
        
        setLastSavedAt(f.updated_at ? f.updated_at * 1000 : null)
        contentRef.current = text || ''
        setEditorContent(text || '')
        onChangeRef.current?.(contentRef.current)
        onLoadedRef.current?.(contentRef.current)
        
        try {
          const tags = await tagApi.getFileTags(id)
          if (id === currentIdRef.current) setFileTags(tags || [])
        } catch (e) {
          console.error('加载标签失败', e)
        }
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
      if (loadAbortRef.current === loadCtl) {
        loadAbortRef.current = null
      }
    }
  }, [activeId, autoSaveOnSwitch])

  useEffect(() => {
    if (intervalRef.current) { window.clearInterval(intervalRef.current) }
    intervalRef.current = window.setInterval(() => { saveNow('interval') }, 30000)
    return () => { if (intervalRef.current) { window.clearInterval(intervalRef.current); intervalRef.current = null } }
  }, [saveNow])

  useEffect(() => {
    const apply = () => {
      const h = statusRef.current ? statusRef.current.offsetHeight : 44
      document.documentElement.style.setProperty('--status-bar-h', `${h}px`)
    }
    apply()
    window.addEventListener('resize', apply)
    const onMode = (e) => { setSelMode(!!e.detail) }
    window.addEventListener('tableSelection:mode', onMode)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('tableSelection:mode', onMode)
    }
  }, [])

  const formatFull = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d)
  }

  const scheduleCache = () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      if (currentIdRef.current) cacheWrite(currentIdRef.current, contentRef.current)
    }, 250)
  }

  const handleEditorChange = React.useCallback((newContent) => {
    contentRef.current = newContent
    scheduleCache()
    onChangeRef.current?.(newContent)
    try {
      const state = JSON.parse(newContent)
      let text = ''
      const extract = (node) => {
        if (node.type === 'text') text += node.text || ''
        if (node.children) node.children.forEach(extract)
      }
      if (state.root && state.root.children) {
        state.root.children.forEach(extract)
      }
      setWordCount(text.length)
    } catch {
      setWordCount(0)
    }
  }, [])

  const handleDragOver = React.useCallback((e) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = React.useCallback(() => setDragOver(false), [])
  const handleDrop = React.useCallback(() => setDragOver(false), [])

  return (
    <div 
      className={switching ? 'content switching' : 'content'} 
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
        <div className="placeholder">请选择文件以开始编辑</div>
      ) : loading ? (
        <div className="placeholder">加载中…</div>
      ) : (
        <>
          <Editor 
             initialContent={editorContent} 
             onChange={handleEditorChange} 
          />
           <div ref={statusRef} className="editor-status-bar">
             <span>{saving ? '保存中…' : (lastSavedAt ? `已保存 ${formatFull(lastSavedAt)}` : '未保存')}</span>
             <span className="status-right">
               {activeId && <TagSelector fileId={activeId} tags={fileTags} onChange={setFileTags} />}
               <span>字数：{wordCount}</span>
               <span style={{ marginLeft: 10 }}>选择模式：{selMode ? '开' : '关'}</span>
               <button className="btn small save-btn" onClick={() => saveNow('manual')} disabled={saving}>
                 {saving ? (
                   <>
                     <span className="spinner" /> 保存中…
                   </>
                 ) : '立即保存'}
               </button>
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
  } catch { return false }
}

const cacheRead = (id) => {
  try {
    if (!supportsLocalStorage()) return memoryCache.get(id) || null
    const raw = localStorage.getItem(`editor:cache:${id}`)
    if (!raw) return memoryCache.get(id) || null
    return JSON.parse(raw)
  } catch { return memoryCache.get(id) || null }
}

const cacheWrite = (id, content, savedAt) => {
  const payload = { content, editedAt: Date.now(), savedAt }
  memoryCache.set(id, payload)
  if (!supportsLocalStorage()) return
  if (content.length > 1024 * 1024 * 1) return
  try { localStorage.setItem(`editor:cache:${id}`, JSON.stringify(payload)) } catch {}
}

const cacheRemove = (id) => {
  memoryCache.delete(id)
  if (!supportsLocalStorage()) return
  try { localStorage.removeItem(`editor:cache:${id}`) } catch {}
}

const TextEditor = React.forwardRef(TextEditorInternal)
export default TextEditor
