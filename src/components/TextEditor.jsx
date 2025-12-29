import React, { useEffect, useMemo, useRef, useState, useImperativeHandle } from 'react'
import { api } from '~/services/api'
import Editor from './Editor/Editor'

function TextEditorInternal({ activeId, deletedIds, onChange, onLoaded, onSaved, autoSaveOnSwitch = true }, ref) {
  // taRef, query, rep, wrapOn removed as they are specific to textarea
  const contentRef = useRef('')
  const saveTimerRef = useRef(null)
  const intervalRef = useRef(null)
  const abortRef = useRef(null)
  const currentIdRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [selMode, setSelMode] = useState(false)
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
    try {
      setSaving(true)
      if (abortRef.current) { abortRef.current.abort() }
      const ctl = new AbortController()
      abortRef.current = ctl
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
      setSaving(false)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    save: () => saveNow('external')
  }))

  useEffect(() => {
    // Prevent recursive saves or re-entries if activeId is stable
    if (activeId === currentIdRef.current) return

    setSwitching(true)
    
    // Save previous file if it was loaded and has content
    if (currentIdRef.current && contentRef.current !== undefined) {
      const isDeleted = deletedIds?.has(currentIdRef.current)
      if (!isDeleted && autoSaveOnSwitch) {
        cacheWrite(currentIdRef.current, contentRef.current)
        // Don't await this save - let it happen in background or via abortable controller
        void saveNow('manual', currentIdRef.current) 
      }
    }

    currentIdRef.current = activeId || null

    if (!activeId) {
      setSwitching(false)
      setLoading(false)
      setLastSavedAt(null)
      contentRef.current = ''
      setEditorContent('')
      return
    }

    const load = async (id) => {
      setLoading(true)
      try {
        const f = await api(`/api/files/${id}`)
        const cached = cacheRead(id)
        const useCache = cached && cached.editedAt && (!f.updated_at || cached.editedAt > f.updated_at * 1000)
        const text = useCache ? cached.content : f.content
        
        setLastSavedAt(f.updated_at ? f.updated_at * 1000 : null)
        contentRef.current = text || ''
        setEditorContent(text || '')
        onChangeRef.current?.(contentRef.current)
        onLoadedRef.current?.(contentRef.current)
      } catch (e) {
        console.error('加载内容失败', e)
      } finally {
        setLoading(false)
        setSwitching(false)
      }
    }

    load(activeId)
    
    return () => {
      // Cleanup if needed
    }
  }, [activeId, saveNow, autoSaveOnSwitch])

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
    return () => window.removeEventListener('resize', apply)
  }, [])

  const formatFull = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const scheduleCache = () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      if (currentIdRef.current) cacheWrite(currentIdRef.current, contentRef.current)
    }, 250)
  }

  const handleEditorChange = (newContent) => {
    contentRef.current = newContent
    scheduleCache()
    onChangeRef.current?.(newContent)
  }

  return (
    <div className={switching ? 'content switching' : 'content'} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
           <div ref={statusRef} className="editor-status-bar" style={{ position: 'sticky', bottom: 0, borderTop: '1px solid #ddd', padding: '6px 10px', fontSize: 12, color: '#666', background: '#f5f5f5', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
             <span>{saving ? '保存中…' : (lastSavedAt ? `已保存 ${formatFull(lastSavedAt)}` : '未保存')}</span>
             <span style={{ marginLeft: 10 }}>选择模式：{selMode ? '开' : '关'}</span>
             <button style={{marginLeft: 10}} onClick={() => saveNow('manual')} disabled={saving}>{saving ? '...' : '立即保存'}</button>
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

const TextEditor = React.forwardRef(TextEditorInternal)
export default TextEditor
