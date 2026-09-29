import React, { useEffect, useRef, useState, useImperativeHandle } from 'react'
import { api } from '~/services/api'
import { countLexicalCharacters } from '~/utils/lexicalText'
import { normalizeLegacyTableBreakMarkup } from '~/services/legacyContentCompatibility'
import { hasHeadingStructureChanged } from './Editor/utils/referenceUtils'
import {
  readEditorDraft,
  removeEditorDraft,
  writeEditorDraft,
} from '~/services/editorDraftCache'

import { editorQuit, createEditorQuitParticipant } from '~/services/editorQuit.mjs'
import { discardEditorDraft, observeEditorDraft } from '~/services/editorDraftDiscard.mjs'
import { createEditorSaveAttempt, commitEditorSave, boundedEditorRequest } from '~/services/editorSaveTransaction.mjs'

import { captureEditorDraftRecovery, recoverEditorDraft } from '~/services/editorDraftRecovery.mjs'
import EditorSaveConflictDialog from './EditorSaveConflictDialog'

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
  const rawSavedBodiesRef = useRef(new Map())
  const saveAttemptsRef = useRef(new Map())
  const saveLifetimeRef = useRef({ active: true, generation: 0 })
  const databaseRevisionRef = useRef(new Map())
  const saveConflictsRef = useRef(new Map())
  const [conflictDialog, setConflictDialog] = useState(null)
  const [conflictBusy, setConflictBusy] = useState(false)
  const conflictBusyRef = useRef(false)
  const conflictResolutionRef = useRef(null)
  const [conflictProblem, setConflictProblem] = useState('')
  const loadGenerationRef = useRef(0)
  const [saveProblem, setSaveProblem] = useState('')
  const [editRevision, setEditRevision] = useState(0)
  const saveTimerRef = useRef(null)
  const intervalRef = useRef(null)
  const saveControllersRef = useRef(new Set())
  const loadAbortRef = useRef(null)
  const inFlightSavesRef = useRef(new Map())
  const queuedSavesRef = useRef(new Map())
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
    for (const id of deletedIds || []) {
      editorQuit.forget(id)
      saveConflictsRef.current.delete(id)
      saveAttemptsRef.current.delete(id)
    }
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

  const cachePendingBodyForRetry = (id, text) => {
    try {
      writeEditorDraft(id, text, undefined, captureEditorDraftRecovery(id,
        rawSavedBodiesRef.current.get(id), saveAttemptsRef.current.get(id), saveConflictsRef.current.has(id)))
    } catch { /* The existing cache service keeps its in-memory fallback. */ }
  }

  const saveNow = React.useCallback(async (reason, specificId = null, contentOverride = null, fromQueue = false) => {
    const lifetime = saveLifetimeRef.current.generation
    if (!saveLifetimeRef.current.active) return
    const id = specificId || currentIdRef.current
    if (!id || (!specificId && loadedDocumentRef.current !== id)) return

    if (deletedIdsRef.current?.has(id)) return

    if (saveConflictsRef.current.has(id)) throw new Error('数据库正文已变化，请先处理保存冲突；当前草稿保留。')
    const text = contentOverride ?? contentRef.current
    // Coalesce only with the last requested snapshot, not an older running
    // write. In A -> B -> A, the last A must wait for B and then restore A;
    // returning the first A receipt would approve a still-changing database.
    const predecessor = fromQueue ? null : (queuedSavesRef.current.get(id) || inFlightSavesRef.current.get(id))
    if (predecessor) {
      if (predecessor.content === text && reason !== 'confirmed-conflict') return predecessor.promise
      const queuedText = text
      const promise = predecessor.promise.then(() => {
        if (!saveLifetimeRef.current.active || saveLifetimeRef.current.generation !== lifetime) return
        return saveNow(reason, id, queuedText, true)
      })
      queuedSavesRef.current.set(id, { content: text, promise })
      try { return await promise }
      finally {
        if (queuedSavesRef.current.get(id)?.promise === promise) queuedSavesRef.current.delete(id)
      }
    }

    // A pending older write can change the saved baseline. Do not skip a revert
    // until that write has settled, otherwise exit could approve the wrong text.
    // A conflict decision always rechecks the reviewed database version, even
    // when the draft happens to match our last observation of that version.
    if (reason !== 'confirmed-conflict' && id === currentIdRef.current && loadedDocumentRef.current === id && text === lastSavedContentRef.current && !saveAttemptsRef.current.has(id)) {
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

        // An unknown earlier result must be reconciled with its SAME token
        // before a newer body can be submitted. Never blindly create a retry.
        let updated
        let attempt = saveAttemptsRef.current.get(id)
        for (let round = 0; round < 2; round += 1) {
          if (!attempt) {
            const expected = rawSavedBodiesRef.current.get(id)
            attempt = createEditorSaveAttempt(id, expected, text,
              id === currentIdRef.current && loadedDocumentRef.current === id ? pendingStructureMappingsRef.current : [])
            saveAttemptsRef.current.set(id, attempt)
          }
          // Persist the immutable request with the newest draft before sending.
          // Reopening must reconcile this token, not invent another write.
          const pendingBody = id === currentIdRef.current && loadedDocumentRef.current === id ? contentRef.current : (readEditorDraft(id)?.content ?? text)
          // A queued write can make an already acknowledged visible body
          // uncertain again. Retain its exit guard before issuing that PUT.
          editorQuit.remember(id, pendingBody)
          cachePendingBodyForRetry(id, pendingBody)
          updated = await commitEditorSave(api, attempt, ctl.signal)
          if (ctl.signal.aborted || !saveLifetimeRef.current.active || saveLifetimeRef.current.generation !== lifetime) return
          databaseRevisionRef.current.set(id, (databaseRevisionRef.current.get(id) || 0) + 1)
          rawSavedBodiesRef.current.set(id, updated.content)
          saveAttemptsRef.current.delete(id)
          editorQuit.saved(id, updated.content)
          const now = Date.now()
          if (id === currentIdRef.current && loadedDocumentRef.current === id) {
            lastSavedContentRef.current = updated.content
            setStructureDirty(hasHeadingStructureChanged(updated.content, contentRef.current))
            if (contentRef.current === updated.content) pendingStructureMappingsRef.current = []
            setLastSavedAt(now); setSaveProblem('')
            window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null
            if (contentRef.current === updated.content) removeEditorDraft(id)
            else cachePendingBodyForRetry(id, contentRef.current)
            onSavedRef.current?.(updated)
          } else {
            // During A → B → A loading, contentRef is only a placeholder.
            // Update the owned recovery entry, never that empty loading buffer.
            const cached = readEditorDraft(id)
            if (cached?.recovery?.attempt?.requestID === attempt.requestID) {
              if (cached.content === updated.content) removeEditorDraft(id)
              else cachePendingBodyForRetry(id, cached.content)
            }
          }
          // Maintenance has already been journalled atomically with the body.
          // Its worker and any network failure are not awaited by this save.
          if (updated.save_receipt.reference_pending) window.dispatchEvent(new Event('editor:durable-save'))
          if (attempt.content === text) return updated
          attempt = null
        }
        return updated
      } catch (e) {
        if (ctl.signal.aborted || !saveLifetimeRef.current.active || saveLifetimeRef.current.generation !== lifetime || e.name === 'AbortError') return
        const ownsVisibleBody = id === currentIdRef.current && loadedDocumentRef.current === id
        if (e.code === 'save-conflict' && e.currentFile?.id === id) {
          const rejected = saveAttemptsRef.current.get(id)
          databaseRevisionRef.current.set(id, (databaseRevisionRef.current.get(id) || 0) + 1)
          rawSavedBodiesRef.current.set(id, e.currentFile.content)
          saveAttemptsRef.current.delete(id) // terminal database receipt, NOT a timeout
          saveConflictsRef.current.set(id, e.currentFile)
          if (ownsVisibleBody) {
            lastSavedContentRef.current = normalizeLegacyTableBreakMarkup(e.currentFile.content)
            editorQuit.remember(id, contentRef.current)
          } else {
            const cached = readEditorDraft(id)
            if (rejected && cached?.recovery?.attempt?.requestID === rejected.requestID) {
              cachePendingBodyForRetry(id, cached.content)
            }
          }
        }
        if (e.message?.includes('更新失败') && deletedIdsRef.current?.has(id)) return
        if (ownsVisibleBody) {
          setSaveError(true); setSaveProblem(e.message || '正文保存失败，草稿保留')
          cachePendingBodyForRetry(id, contentRef.current)
        }
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
    if (contentRef.current === lastSavedContentRef.current && !inFlightSavesRef.current.has(id) && !queuedSavesRef.current.has(id) && !saveAttemptsRef.current.has(id) && !saveConflictsRef.current.has(id)) return
    cachePendingBodyForRetry(id, contentRef.current)
  }, [])

  useEffect(() => editorQuit.register(createEditorQuitParticipant({
    snapshot: () => ({
      id: currentIdRef.current,
      ready: loadedDocumentRef.current === currentIdRef.current,
      deleted: deletedIdsRef.current?.has(currentIdRef.current),
      content: contentRef.current,
      saved: lastSavedContentRef.current,
      structural: false, // structure maintenance is now durably captured by SaveEditor
      uncertain: saveAttemptsRef.current.size > 0 || saveConflictsRef.current.size > 0,
      pending: [...inFlightSavesRef.current.values(), ...queuedSavesRef.current.values()].map(item => item.promise),
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
    getDocumentId: () => currentIdRef.current,
    // Called only by the explicit "不保存" action. Refuse outstanding writes;
    // clearing a cache is not confirmation that an in-flight save was cancelled.
    clearCache: () => discardEditorDraft({
      id: currentIdRef.current,
      ready: loadedDocumentRef.current === currentIdRef.current,
      content: contentRef.current,
      saved: lastSavedContentRef.current,
      pending: [...inFlightSavesRef.current.values(), ...queuedSavesRef.current.values(), ...saveAttemptsRef.current.values()],
    }, editorQuit, text => {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      contentRef.current = text
      pendingStructureMappingsRef.current = []
      removeEditorDraft(currentIdRef.current)
      saveConflictsRef.current.delete(currentIdRef.current)
      setEditorContent(text)
      setWordCount(countLexicalCharacters(text))
      setStructureDirty(false)
      setSaveError(false)
      onChangeRef.current?.(text)
    }),
    getReferenceRefactorState: () => ({
      currentContent: contentRef.current,
      savedContent: lastSavedContentRef.current,
      savePending: inFlightSavesRef.current.has(currentIdRef.current) || queuedSavesRef.current.has(currentIdRef.current),
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
        cachePendingBodyForRetry(currentIdRef.current, text)
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
      rawSavedBodiesRef.current.set(currentIdRef.current, text)
      setEditorContent(text)
      setWordCount(countLexicalCharacters(text))
      setLastSavedAt(savedAt)
      setSaveError(false)
      setStructureDirty(false)
      pendingStructureMappingsRef.current = []

      if (currentIdRef.current) {
        window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null
        removeEditorDraft(currentIdRef.current)
      }

      onChangeRef.current?.(text)
    },
  }))

  useEffect(() => {
    // Mount the editor only after this exact load has produced its content.
    // A matching ID alone is not enough during A → B → A or StrictMode replay.
    loadGenerationRef.current += 1
    conflictResolutionRef.current?.abort()
    conflictResolutionRef.current = null
    conflictBusyRef.current = false
    setConflictBusy(false)
    setConflictProblem('')
    setConflictDialog(null)
    setSwitching(true)
    setLoadError(false)
    setLoadedDocumentId(null)
    setSaveError(false)

    const prevId = currentIdRef.current
    if (prevId && prevId !== activeId && loadedDocumentRef.current === prevId) {
      const isDeleted = deletedIds?.has(prevId)
      if (!isDeleted) {
        // Disabling autosave-on-switch is not permission to erase its draft.
        cachePendingDraft()
        if (autoSaveOnSwitch && (contentRef.current !== lastSavedContentRef.current || saveAttemptsRef.current.has(prevId))) {
          void saveNow('manual', prevId).catch(() => {})
        }
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
        let f = null
        for (let readAttempt = 0; readAttempt < 3; readAttempt += 1) {
          const revision = databaseRevisionRef.current.get(id) || 0
          const result = await boundedEditorRequest(api, `/api/files/${encodeURIComponent(id)}`, { signal: loadCtl.signal })
          if (loadCtl.signal.aborted || loadAbortRef.current !== loadCtl || id !== currentIdRef.current) return
          if (result?.id !== id || typeof result.content !== 'string') throw new Error('正文读取响应不匹配，未打开编辑器或替换草稿')
          // A receipt/conflict received during this GET makes its snapshot old.
          // Re-read instead of restoring a draft against a pre-save database body.
          if ((databaseRevisionRef.current.get(id) || 0) === revision) { f = result; break }
        }
        if (!f) throw new Error('读取期间正文持续变化，请重试加载；草稿保留')

        const cached = readEditorDraft(id)
        const rawServer = f.content || ''
        const serverText = normalizeLegacyTableBreakMarkup(rawServer)
        const recovery = recoverEditorDraft(id, cached, rawServer)
        rawSavedBodiesRef.current.set(id, recovery.expectedContent)
        if (recovery.attempt && !saveAttemptsRef.current.has(id)) saveAttemptsRef.current.set(id, recovery.attempt)
        const text = normalizeLegacyTableBreakMarkup(recovery.content)
        if (recovery.review && !saveAttemptsRef.current.has(id)) {
          saveConflictsRef.current.set(id, f)
          setSaveProblem('未确认草稿已恢复；其保存基线与当前数据库未获一致确认，请处理保存冲突。')
        }
        // Matching a fresh read can clear a clean draft, but never an unknown
        // request that still has to be reconciled with its original identity.
        const unconfirmed = saveAttemptsRef.current.has(id)
        if (text === serverText && !unconfirmed && !recovery.review) {
          saveConflictsRef.current.delete(id)
          if (cached?.recovery) removeEditorDraft(id)
        }
        if (saveConflictsRef.current.has(id) || unconfirmed) {
          setSaveError(true)
          if (unconfirmed) setSaveProblem('已恢复尚未确认的保存请求。重试会先核对原请求，当前草稿保留。')
        }
        if (text !== serverText || unconfirmed || recovery.review) editorQuit.remember(id, text)
        else editorQuit.saved(id, serverText)
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

  useEffect(() => {
    saveLifetimeRef.current.active = true
    return () => {
      saveLifetimeRef.current.active = false
      saveLifetimeRef.current.generation += 1
      // A database adoption is a read, not an editor-save controller. Invalidate
      // its authority before caching or detaching this editor. An ignored abort
      // or late response must never clear this document's unsaved registration.
      loadGenerationRef.current += 1
      conflictResolutionRef.current?.abort()
      conflictResolutionRef.current = null
      conflictBusyRef.current = false
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
      queuedSavesRef.current.clear()
    }
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
  }, [activeId, saving, saveError, lastSavedAt, wordCount, structureDirty, editRevision])

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
      cachePendingDraft()
    }, 250)
  }

  const handleEditorChange = React.useCallback((newContent) => {
    const id = currentIdRef.current
    if (!id || loadedDocumentRef.current !== id) return
    contentRef.current = newContent
    setEditRevision(value => value + 1)
    const pending = inFlightSavesRef.current.has(id) || queuedSavesRef.current.has(id) || saveAttemptsRef.current.has(id) || saveConflictsRef.current.has(id)
    observeEditorDraft(editorQuit, id, newContent, lastSavedContentRef.current, pending)
    setSaveError(saveConflictsRef.current.has(id))
    if (!pending && newContent === lastSavedContentRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      removeEditorDraft(id)
    } else scheduleCache()
    onChangeRef.current?.(newContent)

    setWordCount(countLexicalCharacters(newContent))
    setStructureDirty(hasHeadingStructureChanged(
      lastSavedContentRef.current,
      newContent,
    ))
  }, [])

  const openSaveConflict = () => {
    const id = currentIdRef.current, file = saveConflictsRef.current.get(id)
    if (file) {
      setConflictProblem('')
      setConflictDialog({ id, file, draft: contentRef.current, generation: loadGenerationRef.current })
    }
  }
  const resolveSaveConflict = async choice => {
    const reviewed = conflictDialog
    if (!reviewed || conflictBusyRef.current) return
    if (reviewed.id !== currentIdRef.current || reviewed.generation !== loadGenerationRef.current || reviewed.draft !== contentRef.current) {
      setConflictDialog(null); setSaveProblem('正文已变化，请重新打开冲突处理。'); return
    }
    const operation = new AbortController()
    conflictResolutionRef.current = operation
    conflictBusyRef.current = true
    setConflictBusy(true)
    setConflictProblem('')
    try {
      if (choice === 'keep') {
        // The user reviewed this exact database version. A fresh CAS must still
        // reject another intervening write; never silently refresh Expected.
        rawSavedBodiesRef.current.set(reviewed.id, reviewed.file.content)
        pendingStructureMappingsRef.current = []
        saveConflictsRef.current.delete(reviewed.id)
        setConflictDialog(null)
        await saveNow('confirmed-conflict')
      } else {
        const file = await boundedEditorRequest(api, '/api/files/' + encodeURIComponent(reviewed.id), { signal: operation.signal })
        if (file?.id !== reviewed.id || typeof file.content !== 'string') throw new Error('数据库正文未获确认，草稿保留')
        if (operation.signal.aborted || reviewed.id !== currentIdRef.current || reviewed.generation !== loadGenerationRef.current || reviewed.draft !== contentRef.current || inFlightSavesRef.current.has(reviewed.id) || saveAttemptsRef.current.has(reviewed.id)) {
          throw Object.assign(new Error('核对期间正文或笔记已变化，草稿仍保留，请重新处理。'), { code: 'adoption-changed' })
        }
        if (deletedIdsRef.current?.has(reviewed.id) || editorQuit.discard(reviewed.id, reviewed.draft) !== true) throw new Error('草稿登记已变化，未替换正文')
        const text = normalizeLegacyTableBreakMarkup(file.content)
        rawSavedBodiesRef.current.set(reviewed.id, file.content)
        contentRef.current = text; lastSavedContentRef.current = text
        saveConflictsRef.current.delete(reviewed.id)
        window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null
        removeEditorDraft(reviewed.id)
        pendingStructureMappingsRef.current = []
        setEditorContent(text); setWordCount(countLexicalCharacters(text)); setStructureDirty(false)
        setSaveError(false); setSaveProblem(''); setConflictDialog(null)
        setLastSavedAt(file.updated_at ? file.updated_at * 1000 : null)
        setEditRevision(value => value + 1)
        onChangeRef.current?.(text); onLoadedRef.current?.(text)
      }
    } catch (error) {
      if (!operation.signal.aborted && reviewed.id === currentIdRef.current && reviewed.generation === loadGenerationRef.current) {
        const message = choice === 'keep' ? (error.message || '冲突处理未完成，草稿保留')
          : error.code === 'adoption-changed' ? error.message
            : '未能采用数据库正文，草稿仍保留。请重试或暂不处理。'
        setSaveError(true); setSaveProblem(message)
        if (choice !== 'keep') setConflictProblem(message)
      }
    } finally {
      // A superseded/unmounted request cannot release a newer operation's UI.
      if (conflictResolutionRef.current === operation) {
        conflictResolutionRef.current = null
        conflictBusyRef.current = false; setConflictBusy(false)
      }
    }
  }

  return (
    <div
      className={switching ? 'content switching' : 'content'}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => setDragOver(false)}
    >
      {conflictDialog && <EditorSaveConflictDialog
        draft={conflictDialog.draft} database={conflictDialog.file.content} busy={conflictBusy} problem={conflictProblem}
        onClose={() => { if (!conflictBusy) setConflictDialog(null) }} onResolve={resolveSaveConflict}/> }
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
                {saveError ? '保存未确认' : '保存中…'}
                {saveError && <span role="status">{saveProblem}</span>}
                {saveError && saveConflictsRef.current.has(activeId) ? (
                  <button type="button" className="status-retry-btn" onClick={openSaveConflict} disabled={saving}>处理保存冲突</button>
                ) : saveError && (
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
                  title="正文照常保存；引用维护另行处理，不阻塞保存或退出"
                >
                  章节结构已修改
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
