import React, { useEffect, useState, useRef } from 'react'
import TextEditor from './components/TextEditor'
import FileList from './components/FileList'
import WorkspaceSidebar from './components/WorkspaceSidebar'
import {
  api,
  createFileVersionSnapshot,
  listAllFilesWithContent,
} from '~/services/api'
import ConfirmDialog from './components/ConfirmDialog'
import ToastViewport from './components/ToastViewport'
import ReferenceRefactorDialog from './components/ReferenceRefactorDialog'
import { toast } from '~/services/toast'
import {
  expandRefactorTargetIds,
  planDeleteReferenceImpact,
  planTargetReferenceRefactor,
} from './components/Editor/utils/referenceUtils'
import {
  extractStructureSection,
  planSectionExtractionImpact,
  rewriteSectionTargetReferences,
} from './components/Editor/utils/structureUtils'

const GraphPanel = React.lazy(() => import('./components/GraphPanel'))
const DailyNotesPanel = React.lazy(() => import('./components/DailyNotesPanel'))
const InspectorPanel = React.lazy(() => import('./components/InspectorPanel'))
const ShortcutsModal = React.lazy(() => import('./components/ShortcutsModal'))
const BackupPanel = React.lazy(() => import('./components/BackupPanel'))
const QuickSwitcher = React.lazy(() => import('./components/QuickSwitcher'))
const TrashPanel = React.lazy(() => import('./components/TrashPanel'))
const SettingsPanel = React.lazy(() => import('./components/SettingsPanel'))
import ErrorBoundary from './components/ErrorBoundary'

function buildExtractedNoteTitle(files, sourceFile, sectionText) {
  const sourceTitle = String(sourceFile?.title || '')
  const extensionMatch = sourceTitle.match(/(\.[^.]+)$/)
  const extension = extensionMatch?.[1] || '.md'
  const base = String(sectionText || '拆分章节')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_') || '拆分章节'
  const parentId = String(sourceFile?.parent_id || '')
  const siblings = new Set(
    (Array.isArray(files) ? files : [])
      .filter(file => String(file?.parent_id || '') === parentId)
      .map(file => String(file?.title || '').toLocaleLowerCase())
  )

  let candidate = base + extension
  let suffix = 2
  while (siblings.has(candidate.toLocaleLowerCase())) {
    candidate = base + ' (' + suffix + ')' + extension
    suffix += 1
  }
  return candidate
}

export default function App() {
  const editorRef = useRef(null)
  const titleInputRef = useRef(null)
  const skipTitleCommitRef = useRef(false)
  const pendingEditorNavigationRef = useRef(null)
  const referenceRefactorResolverRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [workspace, setWorkspace] = useState('notes')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState('properties')
  const [sidebarW, setSidebarW] = useState(() => {
    const v = localStorage.getItem('sidebarWidth')
    const n = v ? parseInt(v, 10) : 280
    return Math.min(420, Math.max(220, isNaN(n) ? 280 : n))
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsedV4')
    return saved === null ? false : saved === 'true'
  })
  const [dragging, setDragging] = useState(false)
  const [current, setCurrent] = useState(null)
  const [content, setContent] = useState('')
  const [switching, setSwitching] = useState(false)
  const [deletedIds, setDeletedIds] = useState(new Set())
  const [dialog, setDialog] = useState(null)
  const [referenceRefactor, setReferenceRefactor] = useState(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [editorStatus, setEditorStatus] = useState({
    saving: false,
    saveError: false,
    lastSavedAt: null,
    dirty: false,
    wordCount: 0,
  })
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [titleSaving, setTitleSaving] = useState(false)

  const unsaved = !!(current && content !== (current.content || ''))

  const select = React.useCallback((f) => {
    setSwitching(true)
    setCurrent(f)
    setContent(f ? (f.content || '') : '')
    setTitleEditing(false)
    setTitleDraft(f?.title || '')
    setEditorStatus({
      saving: false,
      saveError: false,
      lastSavedAt: f?.updated_at ? f.updated_at * 1000 : null,
      dirty: false,
      wordCount: 0,
    })
    setWorkspace('notes')
    if (typeof window !== 'undefined' && window.innerWidth <= 720) {
      setSidebarCollapsed(true)
      localStorage.setItem('sidebarCollapsedV4', 'true')
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

  const requestReferenceRefactor = React.useCallback((config) => {
    const incoming = Number(config?.plan?.summary?.incomingReferences) || 0
    if (!incoming) {
      return Promise.resolve({
        proceed: true,
        sync: true,
        plan: config?.plan || null,
      })
    }

    return new Promise(resolve => {
      referenceRefactorResolverRef.current = resolve
      setReferenceRefactor(config)
    })
  }, [])

  const closeReferenceRefactor = React.useCallback((decision) => {
    const resolve = referenceRefactorResolverRef.current
    referenceRefactorResolverRef.current = null
    setReferenceRefactor(null)
    resolve?.(decision)
  }, [])

  const applyReferenceRepairPlan = React.useCallback(async (
    plan,
    { allowCurrentSource = false } = {},
  ) => {
    const sources = (plan?.sources || []).filter(source => source.repairContent)
    let repairedFiles = 0
    let repairedReferences = 0
    const skipped = []

    for (const source of sources) {
      try {
        if (
          source.id === current?.id &&
          unsaved &&
          !allowCurrentSource
        ) {
          throw new Error('来源笔记有未保存修改')
        }

        const latest = await api('/api/files/' + source.id)
        if (String(latest?.content || '') !== String(source.content || '')) {
          throw new Error('来源正文已变化')
        }

        await createFileVersionSnapshot(source.id)
        const updated = await api('/api/files/' + source.id, {
          method: 'PUT',
          body: JSON.stringify({ content: source.repairContent }),
        })

        repairedFiles += 1
        repairedReferences += source.repairedCount || 0

        if (source.id === current?.id) {
          const finalContent = String(updated?.content ?? source.repairContent)
          editorRef.current?.replaceSavedContent?.(finalContent, updated?.updated_at)
          setContent(finalContent)
          setCurrent(prev => (
            prev?.id === source.id
              ? { ...prev, ...updated, content: finalContent }
              : prev
          ))
        }
      } catch (error) {
        console.error('同步引用失败', source.id, error)
        skipped.push({
          id: source.id,
          title: source.title,
          message: error.message || '同步失败',
        })
      }
    }

    return {
      repairedFiles,
      repairedReferences,
      skipped,
    }
  }, [current?.id, unsaved])

  const reviewRenameRefactor = React.useCallback(async (item, nextTitle) => {
    if (!item?.id || item.is_folder) {
      return { proceed: true, sync: false, plan: null }
    }

    let files = await listAllFilesWithContent()
    if (current?.id && unsaved) {
      const draft = editorRef.current?.getReferenceRefactorState?.()?.currentContent
      files = files.map(file => (
        file.id === current.id
          ? { ...file, content: String(draft ?? file.content ?? '') }
          : file
      ))
    }

    const plan = planTargetReferenceRefactor(files, item.id, {
      title: nextTitle,
    })

    const decision = await requestReferenceRefactor({
      mode: 'rename',
      targetTitle: item.title || '未命名',
      nextTitle,
      plan,
    })

    return {
      ...decision,
      plan,
    }
  }, [current?.id, requestReferenceRefactor, unsaved])

  const reviewDeleteRefactor = React.useCallback(async ({
    targetIds,
    targetTitle,
  }) => {
    const ids = Array.isArray(targetIds) ? targetIds.filter(Boolean) : []
    if (!ids.length) return true

    try {
      let files = await listAllFilesWithContent()
      if (current?.id && unsaved) {
        const draft = editorRef.current?.getReferenceRefactorState?.()?.currentContent
        files = files.map(file => (
          file.id === current.id
            ? { ...file, content: String(draft ?? file.content ?? '') }
            : file
        ))
      }

      const plan = planDeleteReferenceImpact(
        files,
        expandRefactorTargetIds(files, ids),
      )
      const decision = await requestReferenceRefactor({
        mode: 'delete',
        targetTitle: targetTitle || '所选内容',
        plan,
      })

      return Boolean(decision?.proceed)
    } catch (error) {
      console.error('删除前引用检查失败', error)
      toast.error('无法检查引用影响，已取消删除')
      return false
    }
  }, [current?.id, requestReferenceRefactor, unsaved])

  const saveCurrent = React.useCallback(async () => {
    if (!current || !editorRef.current) return false

    try {
      const refactorState = editorRef.current.getReferenceRefactorState?.()
      let review = null

      if (refactorState?.structureChanged) {
        const files = await listAllFilesWithContent()
        const plan = planTargetReferenceRefactor(files, current.id, {
          title: current.title,
          content: refactorState.currentContent,
          sectionPathMappings: refactorState.sectionPathMappings || [],
        })

        const affectedReferences =
          (Number(plan.summary?.repairable) || 0) +
          (Number(plan.summary?.broken) || 0)

        if (affectedReferences > 0) {
          review = await requestReferenceRefactor({
            mode: 'structure',
            targetTitle: current.title || '当前笔记',
            plan,
          })

          if (!review?.proceed) return null
          review = { ...review, plan }
        }
      }

      if (refactorState?.structureChanged) {
        await createFileVersionSnapshot(current.id)
      }

      const updated = await editorRef.current.save()
      if (!updated) return false

      if (review?.sync && review.plan) {
        const result = await applyReferenceRepairPlan(review.plan, {
          allowCurrentSource: true,
        })

        if (result.skipped.length) {
          toast.warning(
            '正文已保存；' +
            result.repairedReferences +
            ' 处引用已同步，' +
            result.skipped.length +
            ' 篇来源因内容变化被跳过'
          )
        } else if (result.repairedReferences) {
          toast.success('正文已保存，并同步 ' + result.repairedReferences + ' 处引用')
        }
      }

      return true
    } catch (e) {
      console.error(e)
      return false
    }
  }, [
    applyReferenceRepairPlan,
    current,
    requestReferenceRefactor,
  ])

  const handleExtractStructureSection = React.useCallback(async (section) => {
    if (!current?.id || !section?.path?.length || !editorRef.current) return

    try {
      if (unsaved) {
        const saved = await saveCurrent()
        if (saved !== true) return
      }

      const latestSource = await api('/api/files/' + current.id)
      const extraction = extractStructureSection(
        latestSource?.content || '',
        section.path,
      )

      if (!extraction.changed || !extraction.section) {
        toast.warning('章节结构已经变化，请刷新后重试')
        return
      }

      let files = await listAllFilesWithContent()
      files = files.map(file => (
        file.id === latestSource.id
          ? latestSource
          : file
      ))

      const targetTitle = buildExtractedNoteTitle(
        files,
        latestSource,
        extraction.section.text,
      )
      const plan = planSectionExtractionImpact(
        files,
        latestSource.id,
        extraction.section.path,
        targetTitle,
      )

      const review = await requestReferenceRefactor({
        mode: 'extract',
        targetTitle: latestSource.title || '当前笔记',
        nextTitle: targetTitle,
        plan,
      })
      if (!review?.proceed) return

      await createFileVersionSnapshot(latestSource.id)

      let created = null
      let sourceSaved = false
      try {
        created = await api('/api/files', {
          method: 'POST',
          body: JSON.stringify({
            title: targetTitle,
            content: extraction.extractedContent,
            is_folder: false,
            parent_id: latestSource.parent_id || '',
          }),
        })

        const targetRewrite = rewriteSectionTargetReferences(
          extraction.extractedContent,
          latestSource.id,
          extraction.section.path,
          created.id,
          created.title || targetTitle,
        )

        if (targetRewrite.changed) {
          created = await api('/api/files/' + created.id, {
            method: 'PUT',
            body: JSON.stringify({
              content: targetRewrite.content,
            }),
          })
        }

        const sourceRewrite = rewriteSectionTargetReferences(
          extraction.sourceContent,
          latestSource.id,
          extraction.section.path,
          created.id,
          created.title || targetTitle,
        )

        const updatedSource = await api('/api/files/' + latestSource.id, {
          method: 'PUT',
          body: JSON.stringify({
            content: sourceRewrite.content,
          }),
        })
        sourceSaved = true

        const finalSourceContent = String(
          updatedSource?.content ?? sourceRewrite.content
        )
        editorRef.current?.replaceSavedContent?.(
          finalSourceContent,
          updatedSource?.updated_at,
        )
        setContent(finalSourceContent)
        setCurrent(prev => (
          prev?.id === latestSource.id
            ? { ...prev, ...updatedSource, content: finalSourceContent }
            : prev
        ))

        let rewrittenReferences = sourceRewrite.rewrittenCount || 0
        let skippedReferences = 0

        for (const source of plan.sources || []) {
          if (source.id === latestSource.id) continue

          try {
            const latest = await api('/api/files/' + source.id)
            if (String(latest?.content || '') !== String(source.content || '')) {
              skippedReferences += source.incomingReferences || 0
              continue
            }

            const rewritten = rewriteSectionTargetReferences(
              latest.content || '',
              latestSource.id,
              extraction.section.path,
              created.id,
              created.title || targetTitle,
            )
            if (!rewritten.changed) continue

            await createFileVersionSnapshot(source.id)
            await api('/api/files/' + source.id, {
              method: 'PUT',
              body: JSON.stringify({ content: rewritten.content }),
            })
            rewrittenReferences += rewritten.rewrittenCount
          } catch (error) {
            console.error('拆分章节引用同步失败', source.id, error)
            skippedReferences += source.incomingReferences || 0
          }
        }

        toast.success(
          '已拆出“' + extraction.section.text + '”' +
          (rewrittenReferences
            ? '，并迁移 ' + rewrittenReferences + ' 处引用'
            : '')
        )

        if (skippedReferences) {
          toast.warning(
            skippedReferences +
            ' 处引用因来源正文变化未自动迁移，可在“全库引用体检”继续处理'
          )
        }

        const finalTarget = await api('/api/files/' + created.id)
        select(finalTarget)
      } catch (error) {
        if (created?.id && !sourceSaved) {
          try {
            await api('/api/files/' + created.id, { method: 'DELETE' })
          } catch {
            // Best-effort rollback only. The original source remains intact.
          }
        }
        throw error
      }
    } catch (error) {
      console.error('拆出章节失败', error)
      toast.error(error.message || '拆出章节失败')
    }
  }, [
    current,
    requestReferenceRefactor,
    saveCurrent,
    select,
    unsaved,
  ])

  const beginTitleEdit = React.useCallback(() => {
    if (workspace !== 'notes' || !current || current.is_folder || titleSaving) return
    skipTitleCommitRef.current = false
    setTitleDraft(current.title || '')
    setTitleEditing(true)
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
  }, [workspace, current, titleSaving])

  const cancelTitleEdit = React.useCallback(() => {
    skipTitleCommitRef.current = true
    setTitleDraft(current?.title || '')
    setTitleEditing(false)
  }, [current?.title])

  const commitTitleEdit = React.useCallback(async () => {
    if (skipTitleCommitRef.current) {
      skipTitleCommitRef.current = false
      return
    }
    if (!titleEditing || !current?.id || titleSaving) return

    const nextTitle = titleDraft.trim()
    if (!nextTitle) {
      toast.error('标题不能为空')
      window.requestAnimationFrame(() => titleInputRef.current?.focus())
      return
    }
    if (nextTitle === current.title) {
      setTitleEditing(false)
      return
    }

    try {
      const review = await reviewRenameRefactor(current, nextTitle)
      if (!review?.proceed) {
        setTitleDraft(current.title || '')
        setTitleEditing(false)
        return
      }

      setTitleSaving(true)
      const updated = await api(`/api/files/${current.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: nextTitle }),
      })

      setCurrent(prev => (
        prev?.id === current.id
          ? { ...prev, ...updated, content: prev.content }
          : prev
      ))
      setTitleDraft(updated.title || nextTitle)
      setTitleEditing(false)

      if (review.sync && review.plan) {
        const result = await applyReferenceRepairPlan(review.plan)
        if (result.skipped.length) {
          toast.warning(
            '标题已更新；' +
            result.repairedReferences +
            ' 处引用已同步，' +
            result.skipped.length +
            ' 篇来源需稍后体检'
          )
        } else if (result.repairedReferences) {
          toast.success('标题已更新，并同步 ' + result.repairedReferences + ' 处引用')
        } else {
          toast.success('标题已更新')
        }
      } else {
        toast.success('标题已更新')
      }
    } catch (error) {
      console.error('重命名失败', error)
      toast.error(error.message || '重命名失败')
      window.requestAnimationFrame(() => titleInputRef.current?.focus())
    } finally {
      setTitleSaving(false)
    }
  }, [
    applyReferenceRepairPlan,
    current,
    reviewRenameRefactor,
    titleDraft,
    titleEditing,
    titleSaving,
  ])

  const loadAndSelect = React.useCallback((id, options = {}) => {
    api(`/api/files/${id}`).then(file => {
      const headingPath = Array.isArray(options?.headingPath)
        ? options.headingPath.filter(Boolean)
        : []

      if (headingPath.length) {
        if (current?.id === id) {
          select(file)
          window.requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('editor:open-heading-anchor', {
              detail: { path: headingPath },
            }))
          })
          return
        }

        pendingEditorNavigationRef.current = {
          id,
          headingPath,
        }
      }

      select(file)
    })
  }, [current?.id, select])

  const updateCurrentFile = React.useCallback(async (patch) => {
    const id = current?.id
    if (!id) return null

    const updated = await api(`/api/files/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    })

    const hasContentPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'content')
    const finalContent = hasContentPatch
      ? String(updated?.content ?? patch.content ?? '')
      : null

    if (hasContentPatch) {
      editorRef.current?.replaceSavedContent?.(finalContent, updated?.updated_at)
      setContent(finalContent)
    }

    setCurrent(prev => (
      prev?.id === id
        ? {
          ...prev,
          ...updated,
          content: hasContentPatch ? finalContent : prev.content,
        }
        : prev
    ))
    return updated
  }, [current?.id])

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
    const openStructureManager = () => {
      if (!current || current.is_folder) return
      setInspectorOpen(true)
      setInspectorTab('structure')
      setWorkspace('notes')
    }

    window.addEventListener('editor:open-structure-manager', openStructureManager)
    return () => window.removeEventListener('editor:open-structure-manager', openStructureManager)
  }, [current])

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
      if (k === 'f2' && workspace === 'notes' && current && !current.is_folder) {
        const el = document.activeElement
        const tag = el?.tagName?.toLowerCase()
        if (tag !== 'input' && tag !== 'textarea' && !el?.isContentEditable) {
          e.preventDefault()
          beginTitleEdit()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [saveCurrent, beginTitleEdit, workspace, current])

  useEffect(() => {
    function onMove(e) {
      if (!dragging) return
      const w = Math.min(420, Math.max(220, e.clientX))
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

  const changeWorkspace = React.useCallback((nextWorkspace) => {
    if (!nextWorkspace || nextWorkspace === workspace) return

    if (
      workspace === 'notes' &&
      nextWorkspace !== 'notes' &&
      current &&
      !deletedIds.has(current.id) &&
      unsaved
    ) {
      setDialog({
        type: 'unsaved',
        next: () => setWorkspace(nextWorkspace),
      })
      return
    }

    setWorkspace(nextWorkspace)
  }, [workspace, current, deletedIds, unsaved])

  const handleNavigation = React.useCallback((nextWorkspace) => {
    changeWorkspace(nextWorkspace)
  }, [changeWorkspace])

  const handleSelectFile = (f, options = {}) => {
    const performSelect = () => {
      select(f)
      options.afterSelect?.(f)
    }

    if (current && f && f.id === current.id) {
      setWorkspace('notes')
      options.afterSelect?.(f)
      return
    }
    if (options?.skipSave || (current && deletedIds.has(current.id)) || !current || !unsaved) {
      performSelect()
      return
    }
    setDialog({
      type: 'unsaved',
      next: performSelect,
      cancel: () => options.onCancel?.(),
    })
  }

  const handleInspectorSelectFile = (id, options = {}) => {
    if (!id) return

    const headingPath = Array.isArray(options?.headingPath)
      ? options.headingPath.filter(Boolean)
      : []

    api(`/api/files/${id}`)
      .then(file => {
        handleSelectFile(file, {
          afterSelect: () => {
            if (!headingPath.length) return

            if (current?.id === id) {
              window.requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent('editor:open-heading-anchor', {
                  detail: { path: headingPath },
                }))
              })
              return
            }

            pendingEditorNavigationRef.current = {
              id,
              headingPath,
            }
          },
        })
      })
      .catch(error => {
        console.error('打开引用目标失败', error)
        toast.error('目标笔记不存在或已删除')
      })
  }

  useEffect(() => {
    const openWikiLink = (event) => {
      const id = event.detail?.id
      if (!id) return

      const headingPath = Array.isArray(event.detail?.headingPath)
        ? event.detail.headingPath.filter(Boolean)
        : []

      api(`/api/files/${id}`)
        .then(file => handleSelectFile(file, {
          afterSelect: () => {
            if (!headingPath.length) return

            pendingEditorNavigationRef.current = {
              id,
              headingPath,
            }

            if (current?.id === id) {
              const pending = pendingEditorNavigationRef.current
              pendingEditorNavigationRef.current = null
              window.requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent('editor:open-heading-anchor', {
                  detail: { path: pending.headingPath },
                }))
              })
            }
          },
          onCancel: () => {
            if (pendingEditorNavigationRef.current?.id === id) {
              pendingEditorNavigationRef.current = null
            }
          },
        }))
        .catch(error => {
          console.error('打开 WikiLink 失败', error)
          toast.error('目标笔记不存在或已删除')
        })
    }

    window.addEventListener('wikiLink:open', openWikiLink)
    return () => window.removeEventListener('wikiLink:open', openWikiLink)
  }, [current, deletedIds, unsaved, select])

  const workspaceTitle = workspace === 'daily'
    ? '每日笔记'
    : workspace === 'graph'
      ? '知识图谱'
      : workspace === 'trash'
        ? '回收站'
        : workspace === 'settings'
          ? '设置与诊断'
          : (current?.title || '笔记')

  const documentHeader = !focusMode && workspace === 'notes' && current && !current.is_folder ? (
  <header className="workspace-header consumer-document-header">
    <div className="workspace-heading">
      {current && !current.is_folder ? (
        <div className="workspace-document-title">
          {titleEditing ? (
            <input
              ref={titleInputRef}
              className="workspace-title-input"
              value={titleDraft}
              disabled={titleSaving}
              onChange={event => setTitleDraft(event.target.value)}
              onBlur={() => void commitTitleEdit()}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelTitleEdit()
                  event.currentTarget.blur()
                }
              }}
              aria-label="当前笔记标题"
            />
          ) : (
            <button
              type="button"
              className="workspace-title-button"
              onClick={beginTitleEdit}
              title="点击重命名（F2）"
              aria-label={`重命名 ${current.title || '未命名'}`}
            >
              {current.title || '未命名'}
            </button>
          )}
          {(editorStatus.saveError || editorStatus.saving || unsaved || editorStatus.dirty) && (
            <span
              className={`workspace-save-chip${editorStatus.saveError ? ' error' : editorStatus.saving ? ' saving' : ' dirty'}`}
            >
              {editorStatus.saveError
                ? '保存失败'
                : editorStatus.saving
                  ? '保存中…'
                  : editorStatus.structureDirty
                    ? '结构待确认'
                    : '未保存'}
            </span>
          )}
        </div>
      ) : (
        <div className="workspace-title" title="笔记">笔记</div>
      )}
    </div>
    <div className="workspace-header-actions">
      {workspace === 'notes' && current && (
        <button
          className={`icon-btn${inspectorOpen ? ' active' : ''}`}
          onClick={() => setInspectorOpen(prev => !prev)}
          title="笔记详情"
          aria-label="笔记详情"
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
  ) : null

  return (
    <div className={`app-shell${focusMode ? ' focus-mode' : ''}`}>
      <div className="app-surface">


        {focusMode && (
          <button className="focus-exit-floating" onClick={() => setFocusMode(false)} title="退出专注模式 (F11)" aria-label="退出专注模式">
            ✕ 退出专注
          </button>
        )}

        <main className="workspace-frame" style={{ '--sidebar-w': `${sidebarW}px` }}>
          {ready ? (
            <>
              {!focusMode && (
                <>
                  <WorkspaceSidebar
                    activeWorkspace={workspace}
                    collapsed={sidebarCollapsed}
                    onToggleCollapsed={() => {
                      setSidebarCollapsed(prev => {
                        const next = !prev
                        localStorage.setItem('sidebarCollapsedV4', String(next))
                        return next
                      })
                    }}
                    onChangeWorkspace={handleNavigation}
                    onOpenSearch={() => setQuickSearchOpen(true)}
                    onOpenBackup={() => setBackupOpen(true)}
                    onOpenShortcuts={() => setShortcutsOpen(true)}
                  >
                    <ErrorBoundary label="笔记列表">
                      <FileList
                        selectedId={current?.id}
                        updatedItem={current}
                        onSelect={handleSelectFile}
                        onBeforeRename={({ item, nextTitle }) => (
                          reviewRenameRefactor(item, nextTitle)
                        )}
                        onAfterRename={async ({ review }) => {
                          const result = await applyReferenceRepairPlan(review.plan)
                          if (result.skipped.length) {
                            toast.warning(
                              result.repairedReferences +
                              ' 处引用已同步，' +
                              result.skipped.length +
                              ' 篇来源需稍后体检'
                            )
                          } else if (result.repairedReferences) {
                            toast.success('已同步 ' + result.repairedReferences + ' 处引用')
                          }
                        }}
                        onBeforeDelete={reviewDeleteRefactor}
                        onBeforeNew={async () => {
                          if (!unsaved) return true
                          return new Promise((resolve) => {
                            setDialog({ type: 'unsaved', next: () => resolve(true), cancel: () => resolve(false) })
                          })
                        }}
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
                  </WorkspaceSidebar>
                  {!sidebarCollapsed && <div className="resizer" onMouseDown={() => setDragging(true)} />}
                </>
              )}

              <section className={`workspace-content${switching ? ' switching' : ''}`}>
                {documentHeader}
                {workspace === 'notes' && (
                  <ErrorBoundary label="编辑器">
                    <TextEditor
                      ref={editorRef}
                      activeId={current?.id || null}
                      documentTitle={current?.title || ''}
                      deletedIds={deletedIds}
                      autoSaveOnSwitch={false}
                      onCreateNote={() => window.dispatchEvent(new Event('library:create-note'))}
                      onOpenSearch={() => setQuickSearchOpen(true)}
                      onOpenDaily={() => changeWorkspace('daily')}
                      onChange={setContent}
                      onLoaded={(text) => {
                        if (current) {
                          setCurrent(prev => ({ ...prev, content: text }))
                          setContent(text)

                          const pending = pendingEditorNavigationRef.current
                          if (pending?.id === current.id && pending.headingPath?.length) {
                            pendingEditorNavigationRef.current = null
                            window.requestAnimationFrame(() => {
                              window.requestAnimationFrame(() => {
                                window.dispatchEvent(new CustomEvent('editor:open-heading-anchor', {
                                  detail: { path: pending.headingPath },
                                }))
                              })
                            })
                          }
                        }
                      }}
                      onStatusChange={setEditorStatus}
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
                      onSelectFile={handleInspectorSelectFile}
                    />
                  </React.Suspense>
                )}

                {workspace === 'trash' && (
                  <React.Suspense fallback={<div className="workspace-loading">正在打开回收站…</div>}>
                    <TrashPanel
                      onClose={() => setWorkspace('notes')}
                      onRestored={(ids) => {
                        setDeletedIds(prev => {
                          const next = new Set(prev)
                          ids.forEach(id => next.delete(id))
                          return next
                        })
                      }}
                    />
                  </React.Suspense>
                )}

                {workspace === 'settings' && (
                  <React.Suspense fallback={<div className="workspace-loading">正在读取诊断信息…</div>}>
                    <SettingsPanel
                      onClose={() => setWorkspace('notes')}
                      onOpenBackup={() => setBackupOpen(true)}
                      onOpenShortcuts={() => setShortcutsOpen(true)}
                      onOpenFile={handleInspectorSelectFile}
                    />
                  </React.Suspense>
                )}
              </section>

              {!focusMode && workspace === 'notes' && inspectorOpen && current && (
                <React.Suspense fallback={<aside className="inspector-panel inspector-loading">正在加载…</aside>}>
                  <InspectorPanel
                    file={current}
                    draftContent={content}
                    activeTab={inspectorTab}
                    onTabChange={setInspectorTab}
                    onClose={() => setInspectorOpen(false)}
                    onSelectFile={handleInspectorSelectFile}
                    onRestore={restoreCurrent}
                    editorStatus={editorStatus}
                    unsaved={unsaved}
                    onUpdateFile={updateCurrentFile}
                    onApplyDraftContent={(nextContent, metadata) => {
                      editorRef.current?.replaceDraftContent?.(
                        nextContent,
                        metadata,
                      )
                    }}
                    onExtractSection={handleExtractStructureSection}
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

      {referenceRefactor && (
        <ReferenceRefactorDialog
          mode={referenceRefactor.mode}
          targetTitle={referenceRefactor.targetTitle}
          nextTitle={referenceRefactor.nextTitle}
          plan={referenceRefactor.plan}
          onCancel={() => closeReferenceRefactor({
            proceed: false,
            sync: false,
          })}
          onConfirm={() => closeReferenceRefactor({
            proceed: true,
            sync: referenceRefactor.mode !== 'delete',
          })}
          onOpenSource={(id) => {
            closeReferenceRefactor({
              proceed: false,
              sync: false,
            })
            window.requestAnimationFrame(() => handleInspectorSelectFile(id))
          }}
        />
      )}

      {dialog?.type === 'unsaved' && (
        <ConfirmDialog
          title="当前笔记未保存"
          message="是否保存更改？"
          actions={[
            {
              label: '保存',
              kind: 'primary',
              loading: dialog.saving,
              onClick: async () => {
                setDialog(prev => ({ ...prev, saving: true }))
                const ok = await saveCurrent()
                if (ok === true) {
                  setDialog(null)
                  dialog.next()
                } else if (ok === null) {
                  setDialog(prev => ({ ...prev, saving: false }))
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
