import React, { useEffect, useRef, useState, useImperativeHandle } from 'react'
import { api } from '~/services/api'
import { countLexicalCharacters } from '~/utils/lexicalText'
import { normalizeLegacyTableBreakMarkup } from '~/services/legacyContentCompatibility'
import { hasHeadingStructureChanged } from './Editor/utils/referenceUtils'
import {
  isFreshEditorDraft,
  readEditorDraft,
  removeEditorDraft,
  writeEditorDraft,
} from '~/services/editorDraftCache'

import { editorQuit, createEditorQuitParticipant } from '~/services/editorQuit.mjs'

const Editor = React.lazy(() => import('./Editor/Editor'))

function TextEditorInternal({
  activeId,
  documentTitle,
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
  const saveControllersRef = useRef(new Set())
  const loadAbortRef = useRef(null)
  const inFlightSavesRef = useRef(new Map())
  const savingCountsRef = useRef(new Map())
  const currentIdRef = useRef(null)
  const loadedDocumentRef = useRef(null)
  const [loadedDocumentId, setLoadedDocumentId] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [selMode, setSelMode] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [structureDirty, setStructureDirty] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const statusRef = useRef(null)
  const pendingStructureMappingsRef = useRef([])
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
  useEffect(() => {
    deletedIdsRef.current = deletedIds
    for (const id of deletedIds || []) editorQuit.forget(id)
  }, [deletedIds])

  const syncCurrentSavingState = React.useCallback((id = currentIdRef.current) => {
    if (!id) {
      setSaving(false)
      return
    }
    setSaving((savingCountsRef.current.get(id) || 0) > 0)
  }, [])

  const beginSaving = React.useCallback((id) => {
    const next = (savingCountsRef.current.get(id) || 0) + 1
    savingCountsRef.current.set(id, next)
    if (id === currentIdRef.current) setSaving(true)
  }, [])

  const endSaving = React.useCallback((id) => {
    const current = savingCountsRef.current.get(id) || 0
    if (current <= 1) savingCountsRef.current.delete(id)
    else savingCountsRef.current.set(id, current - 1)

    if (id === currentIdRef.current) {
      setSaving((savingCountsRef.current.get(id) || 0) > 0)
    }
  }, [])

  const saveNow = React.useCallback(async (reason, specificId = null, contentOverride = null) => {
    const id = specificId || currentIdRef.current
    if (!id || (!specificId && loadedDocumentRef.current !== id)) return

    if (deletedIdsRef.current?.has(id)) return

    const text = contentOverride ?? contentRef.current
    const hasStructuralChanges = id === currentIdRef.current && hasHeadingStructureChanged(
      lastSavedContentRef.current,
      text,
    )

    if (reason === 'interval' && hasStructuralChanges) {
      setStructureDirty(true)
      return {
        id,
        content: text,
        skipped: true,
        structural: true,
      }
    }

    const inFlight = inFlightSavesRef.current.get(id)
    if (inFlight) {
      if (inFlight.content === text) {
        return inFlight.promise
      }
      const queuedText = text
      return inFlight.promise.then(() => saveNow(reason, id, queuedText))
    }

    // A pending older write can change the saved baseline. Do not skip a revert
    // until that write has settled, otherwise exit could approve the wrong text.
    if (id === currentIdRef.current && text === lastSavedContentRef.current) {
      editorQuit.saved(id, text)
      setSaveError(false)
      return { id, content: text, skipped: true }
    }

    const ctl = new AbortController()
    const savePromise = (async () => {
      try {
        beginSaving(id)
        if (id === currentIdRef.current) setSaveError(false)
        saveControllersRef.current.add(ctl)

        const updated = await api(`/api/files/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ content: text }),
          signal: ctl.signal,
        })

        if (!updated || updated.id !== id || updated.content !== text) {
          throw new Error('正文保存响应未确认，请重新检查保存状态')
        }
        editorQuit.saved(id, text)
        const now = Date.now()
        if (id === currentIdRef.current) {
          lastSavedContentRef.current = text
          setStructureDirty(hasHeadingStructureChanged(text, contentRef.current))
          if (contentRef.current === text) pendingStructureMappingsRef.current = []
          setLastSavedAt(now)
          // A delayed acknowledgement must not overwrite a newer cached draft.
          writeEditorDraft(id, contentRef.current, now)
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
        saveControllersRef.current.delete(ctl)
        if (inFlightSavesRef.current.get(id)?.promise === savePromise) {
          inFlightSavesRef.current.delete(id)
        }
        endSaving(id)
      }
    })()

    inFlightSavesRef.current.set(id, { content: text, promise: savePromise })
    return savePromise
  }, [beginSaving, endSaving])

  // Closing or inspecting a clean document is not a new edit. Stamping it as
  // a fresh draft can mask newer server content when the document is reopened.
  // A pending write for this same document still needs a recovery snapshot,
  // even if the user has reverted the visible text to the previous baseline.
  const cachePendingDraft = React.useCallback(() => {
    const id = currentIdRef.current
    if (!id || loadedDocumentRef.current !== id || deletedIdsRef.current?.has(id)) return
    if (contentRef.current === lastSavedContentRef.current && !inFlightSavesRef.current.has(id)) return
    writeEditorDraft(id, contentRef.current)
  }, [])

  useEffect(() => editorQuit.register(createEditorQuitParticipant({
    snapshot: () => ({
      id: currentIdRef.current,
      ready: loadedDocumentRef.current === currentIdRef.current,
      deleted: deletedIdsRef.current?.has(currentIdRef.current),
      content: contentRef.current,
      saved: lastSavedContentRef.current,
      structural: hasHeadingStructureChanged(lastSavedContentRef.current, contentRef.current),
      pending: [...inFlightSavesRef.current.values()].map(item => item.promise),
    }),
    cache: () => {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      cachePendingDraft()
    },
    save: () => saveNow('quit'),
  })), [saveNow, cachePendingDraft])

  useImperativeHandle(ref, () => ({
    save: () => saveNow('external'),
    clearCache: () => {
      if (currentIdRef.current) removeEditorDraft(currentIdRef.current)
    },
    getReferenceRefactorState: () => ({
      currentContent: contentRef.current,
      savedContent: lastSavedContentRef.current,
      structureChanged: hasHeadingStructureChanged(
        lastSavedContentRef.current,
        contentRef.current,
      ),
      sectionPathMappings: [...pendingStructureMappingsRef.current],
    }),
    replaceDraftContent: (nextContent, options = {}) => {
      const text = String(nextContent ?? '')
      const mappings = Array.isArray(options.sectionPathMappings)
        ? options.sectionPathMappings
        : []

      contentRef.current = text
      editorQuit.remember(currentIdRef.current, text)
      pendingStructureMappingsRef.current = [
        ...pendingStructureMappingsRef.current,
        ...mappings,
      ]
      setEditorContent(text)
      setWordCount(countLexicalCharacters(text))
      setStructureDirty(hasHeadingStructureChanged(
        lastSavedContentRef.current,
        text,
      ))

      if (currentIdRef.current) {
        writeEditorDraft(
          currentIdRef.current,
          text,
          lastSavedAt,
        )
      }

      onChangeRef.current?.(text)
    },
    replaceSavedContent: (nextContent, updatedAt) => {
      const text = String(nextContent ?? '')
      const rawUpdatedAt = Number(updatedAt) || 0
      const savedAt = rawUpdatedAt
        ? (rawUpdatedAt < 1_000_000_000_000 ? rawUpdatedAt * 1000 : rawUpdatedAt)
        : Date.now()

      contentRef.current = text
      editorQuit.remember(currentIdRef.current, text)
      editorQuit.saved(currentIdRef.current, text)
      lastSavedContentRef.current = text
      setEditorContent(text)
      setWordCount(countLexicalCharacters(text))
      setLastSavedAt(savedAt)
      setSaveError(false)
      setStructureDirty(false)
      pendingStructureMappingsRef.current = []

      if (currentIdRef.current) {
        writeEditorDraft(currentIdRef.current, text, savedAt)
      }

      onChangeRef.current?.(text)
    },
  }))

  useEffect(() => {
    // Mount the editor only after this exact load has produced its content.
    // A matching ID alone is not enough during A → B → A or StrictMode replay.
    setSwitching(true)
    setLoadError(false)
    setLoadedDocumentId(null)
    setSaveError(false)

    const prevId = currentIdRef.current
    if (prevId && prevId !== activeId && loadedDocumentRef.current === prevId) {
      const isDeleted = deletedIds?.has(prevId)
      if (!isDeleted && autoSaveOnSwitch) {
        writeEditorDraft(prevId, contentRef.current)
        void saveNow('manual', prevId).catch(() => {})
      }
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    loadedDocumentRef.current = null
    loadAbortRef.current?.abort()
    const loadCtl = new AbortController()
    loadAbortRef.current = loadCtl
    currentIdRef.current = activeId || null
    contentRef.current = ''
    lastSavedContentRef.current = ''
    syncCurrentSavingState(activeId || null)

    if (!activeId) {
      setSwitching(false)
      setLoading(false)
      setLastSavedAt(null)
      lastSavedContentRef.current = ''
      contentRef.current = ''
      setEditorContent('')
      setStructureDirty(false)
      pendingStructureMappingsRef.current = []
      return
    }

    const load = async (id) => {
      setLoading(true)
      try {
        const f = await api(`/api/files/${id}`, { signal: loadCtl.signal })
        if (loadCtl.signal.aborted || loadAbortRef.current !== loadCtl || id !== currentIdRef.current) return

        const cached = readEditorDraft(id)
        const useCache = isFreshEditorDraft(cached) && cached.editedAt && (!f.updated_at || cached.editedAt > f.updated_at * 1000)
        const serverText = normalizeLegacyTableBreakMarkup(f.content || '')
        const cachedText = useCache
          ? normalizeLegacyTableBreakMarkup(cached.content || '')
          : ''
        const text = useCache ? cachedText : serverText

        editorQuit.saved(id, serverText)
        if (text !== serverText) editorQuit.remember(id, text)
        lastSavedContentRef.current = serverText
        pendingStructureMappingsRef.current = []
        setStructureDirty(hasHeadingStructureChanged(serverText, text || ''))
        setLastSavedAt(f.updated_at ? f.updated_at * 1000 : null)
        contentRef.current = text || ''
        setWordCount(countLexicalCharacters(text || ''))
        setEditorContent(text || '')
        loadedDocumentRef.current = id
        setLoadedDocumentId(id)
        onChangeRef.current?.(contentRef.current)
        onLoadedRef.current?.(contentRef.current)
      } catch (e) {
        if (!loadCtl.signal.aborted && loadAbortRef.current === loadCtl && e.name !== 'AbortError') {
          setLoadError(true)
          console.error('加载内容失败', e)
        }
      } finally {
        if (!loadCtl.signal.aborted && loadAbortRef.current === loadCtl && id === currentIdRef.current) {
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
  // autoSaveOnSwitch is consulted on a document switch, not a reason to reload an active draft.
  }, [activeId, loadAttempt, saveNow, syncCurrentSavingState])

  useEffect(() => () => {
    cachePendingDraft()
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    loadAbortRef.current?.abort()
    loadAbortRef.current = null

    for (const controller of saveControllersRef.current) {
      controller.abort()
    }
    saveControllersRef.current.clear()
    inFlightSavesRef.current.clear()
  }, [cachePendingDraft])

  useEffect(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current)
    intervalRef.current = window.setInterval(() => {
      void saveNow('interval').catch(() => {})
    }, 30000)
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
      structureDirty,
    })
  }, [activeId, saving, saveError, lastSavedAt, wordCount, structureDirty])

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
      if (currentIdRef.current) writeEditorDraft(currentIdRef.current, contentRef.current)
    }, 250)
  }

  const handleEditorChange = React.useCallback((newContent) => {
    contentRef.current = newContent
    editorQuit.remember(currentIdRef.current, newContent)
    setSaveError(false)
    scheduleCache()
    onChangeRef.current?.(newContent)

    setWordCount(countLexicalCharacters(newContent))
    setStructureDirty(hasHeadingStructureChanged(
      lastSavedContentRef.current,
      newContent,
    ))
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
      ) : loadError ? (
        <div className="placeholder" role="alert">
          正文加载失败，尚未打开编辑器。
          <button type="button" className="btn" onClick={() => setLoadAttempt(value => value + 1)}>重试加载正文</button>
        </div>
      ) : loading || loadedDocumentId !== activeId ? (
        <div className="placeholder">加载中…</div>
      ) : (
        <>
          <React.Suspense fallback={<div className="placeholder">正在加载编辑器…</div>}>
            <Editor
              documentId={activeId}
              documentTitle={documentTitle}
              initialContent={editorContent}
              onChange={handleEditorChange}
            />
          </React.Suspense>
          <div ref={statusRef} className="editor-status-bar">
            {(saveError || saving) && (
              <span className={`save-state${saveError ? ' error' : ''}`}>
                {saveError ? '保存失败' : '保存中…'}
                {saveError && (
                  <button
                    className="status-retry-btn"
                    onClick={() => { void saveNow('retry').catch(() => {}) }}
                    disabled={saving}
                  >
                    重试
                  </button>
                )}
              </span>
            )}
            <span className="status-right">
              {structureDirty && (
                <span
                  className="selection-mode-pill structure-dirty-pill"
                  title="章节标题或层级已变化，Ctrl+S 时会先检查跨笔记引用影响"
                >
                  章节结构待确认
                </span>
              )}
              {selMode && <span className="selection-mode-pill">表格选择</span>}
              <span>{wordCount.toLocaleString()} 字</span>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const TextEditor = React.forwardRef(TextEditorInternal)

export default TextEditor
