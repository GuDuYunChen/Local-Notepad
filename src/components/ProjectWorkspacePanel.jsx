import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  listAllFilesWithContent,
} from '~/services/api'
import { toast } from '~/services/toast'
import { tagApi } from '~/services/tagApi'
import { markdownToLexical } from '~/services/importContent'
import {
  buildProjectWorkspace,
  buildProjectBatchMovePlan,
  calculateProjectCardMove,
  getProjectCandidates,
  getProjectChapterSummary,
  getProjectDescendantNoteIds,
  getProjectExportIds,
  getProjectIndexAliases,
  getProjectLabels,
  getProjectProgress,
  filterProjectVolumes,
  getProjectTemplate,
  getRecentProjectActivity,
  getVolumeExportIds,
  nextProjectStatus,
  readProjectWorkspaceMeta,
  writeProjectWorkspaceMeta,
} from './projectWorkspaceUtils'
import ProjectAnalyticsPanel from './ProjectAnalyticsPanel'
import ProjectPlanningPanel from './ProjectPlanningPanel'
import ProjectSprintPanel from './ProjectSprintPanel'
import ProjectTodayCenter from './ProjectTodayCenter'
import FocusSessionAnalyticsPanel from './FocusSessionAnalyticsPanel'
import ProjectInsightsPanel from './ProjectInsightsPanel'
import './ProjectWorkspacePanel.css'

const LAST_PROJECT_KEY = 'localNotepad.projectWorkspace.lastProject'
const PROJECT_VIEW_KEY = 'localNotepad.projectWorkspace.activeView'
const PROJECT_VIEWS = [
  { id: 'today', label: '今日', description: '今日任务、冲刺与每日复盘' },
  { id: 'project', label: '项目', description: '项目进度、索引与卷章看板' },
  { id: 'planning', label: '计划', description: '目标、截止日期与章节队列' },
  { id: 'analysis', label: '分析', description: '创作与 Session 数据分析' },
  { id: 'insights', label: '洞察', description: '异常提醒与自动周报/月报' },
]

function initialProjectView() {
  try {
    const stored = localStorage.getItem(PROJECT_VIEW_KEY)
    return PROJECT_VIEWS.some(view => view.id === stored) ? stored : 'today'
  } catch {
    return 'today'
  }
}

function displayTitle(title) {
  return String(title || '未命名').replace(/\.[^.]+$/, '')
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function formatUpdated(value) {
  const seconds = Number(value) || 0
  if (!seconds) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(seconds * 1000))
}

function statusCopy(status) {
  if (status === 'done') return '完成'
  if (status === 'review') return '修订'
  return '草稿'
}

export default function ProjectWorkspacePanel({
  onOpenFile,
  onStartFocus,
  onClose,
}) {
  const [files, setFiles] = useState([])
  const [activeView, setActiveView] = useState(initialProjectView)
  const [projectActionsOpen, setProjectActionsOpen] = useState(false)
  const projectActionsRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [movingId, setMovingId] = useState('')
  const [exportingKey, setExportingKey] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState(
    () => localStorage.getItem(LAST_PROJECT_KEY) || ''
  )
  const [projectMeta, setProjectMeta] = useState({
    type: 'novel',
    targetWords: 0,
    chapterTargetWords: 0,
    dailyGoal: 0,
    weeklyGoal: 0,
    deadline: '',
    statuses: {},
    summaries: {},
    supportNoteIds: [],
    foreshadowStates: {},
    volumeMilestones: {},
    chapterQueue: [],
    sprint: null,
    dailyReviews: {},
  })
  const [projectIndexes, setProjectIndexes] = useState({
    characters: [],
    locations: [],
    foreshadows: [],
  })
  const [indexLoading, setIndexLoading] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [editingSummaryId, setEditingSummaryId] = useState('')
  const [summaryDraft, setSummaryDraft] = useState('')
  const [draggedNoteId, setDraggedNoteId] = useState('')
  const [dropTarget, setDropTarget] = useState(null)
  const [projectBoardQuery, setProjectBoardQuery] = useState('')
  const [projectBoardStatus, setProjectBoardStatus] = useState('all')
  const [projectBoardVolume, setProjectBoardVolume] = useState('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState([])
  const [batchStatusTarget, setBatchStatusTarget] = useState('review')
  const [batchMoveTarget, setBatchMoveTarget] = useState('__ungrouped__')
  const [batchBusy, setBatchBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await listAllFilesWithContent()
      setFiles(next)

      const projects = getProjectCandidates(next)
      setSelectedProjectId(current => {
        if (current && projects.some(project => project.id === current)) {
          return current
        }
        return projects[0]?.id || ''
      })
    } catch (error) {
      console.error('加载项目工作台失败', error)
      toast.error(error.message || '加载项目工作台失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_VIEW_KEY, activeView)
    } catch {
      // View preference is optional and must never block project rendering.
    }
  }, [activeView])

  useEffect(() => {
    const onKeyDown = event => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

      const target = event.target
      const tag = target?.tagName?.toLowerCase()
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable
      ) {
        return
      }

      const index = Number(event.key) - 1
      const view = PROJECT_VIEWS[index]
      if (!view) return

      event.preventDefault()
      setActiveView(view.id)
      setProjectActionsOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!selectionMode) return undefined

    const exitSelection = event => {
      if (event.key !== 'Escape') return
      setSelectionMode(false)
      setSelectedNoteIds([])
    }

    window.addEventListener('keydown', exitSelection)
    return () => window.removeEventListener('keydown', exitSelection)
  }, [selectionMode])

  useEffect(() => {
    if (!projectActionsOpen) return undefined

    const close = event => {
      if (projectActionsRef.current?.contains(event.target)) return
      setProjectActionsOpen(false)
    }
    const closeOnEscape = event => {
      if (event.key === 'Escape') setProjectActionsOpen(false)
    }

    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [projectActionsOpen])

  useEffect(() => {
    const refresh = event => {
      if (event?.detail?.source === 'project-workspace') return
      void load()
    }
    window.addEventListener('library:refresh', refresh)
    return () => window.removeEventListener('library:refresh', refresh)
  }, [load])

  const projects = useMemo(
    () => getProjectCandidates(files),
    [files]
  )

  useEffect(() => {
    setSelectionMode(false)
    setSelectedNoteIds([])
    setBatchMoveTarget('__ungrouped__')

    if (!selectedProjectId) {
      setProjectMeta({
        type: 'novel',
        targetWords: 0,
        chapterTargetWords: 0,
        dailyGoal: 0,
        weeklyGoal: 0,
        deadline: '',
        statuses: {},
        summaries: {},
        supportNoteIds: [],
        foreshadowStates: {},
        volumeMilestones: {},
        chapterQueue: [],
        sprint: null,
        dailyReviews: {},
      })
      return
    }

    localStorage.setItem(LAST_PROJECT_KEY, selectedProjectId)
    setProjectMeta(readProjectWorkspaceMeta(selectedProjectId))
  }, [selectedProjectId])

  useEffect(() => {
    if (activeView === 'project') return
    setSelectionMode(false)
    setSelectedNoteIds([])
  }, [activeView])

  const loadProjectIndexes = useCallback(async (workspaceValue) => {
    const noteIds = new Set(
      getProjectDescendantNoteIds(
        files,
        workspaceValue?.project?.id,
      )
    )

    if (!noteIds.size) {
      setProjectIndexes({
        characters: [],
        locations: [],
        foreshadows: [],
      })
      return
    }

    setIndexLoading(true)
    try {
      const tags = await tagApi.list()
      const aliases = getProjectIndexAliases()
      const normalizedTags = (tags || []).map(tag => ({
        ...tag,
        normalizedName: String(tag.name || '').trim().toLocaleLowerCase(),
      }))

      const next = {}
      for (const [category, names] of Object.entries(aliases)) {
        const normalizedAliases = new Set(
          names.map(name => String(name).toLocaleLowerCase())
        )
        const matchingTags = normalizedTags.filter(tag => (
          normalizedAliases.has(tag.normalizedName)
        ))

        const groups = await Promise.all(
          matchingTags.map(tag => tagApi.getFilesByTag(tag.id).catch(() => []))
        )

        const byId = new Map()
        for (const group of groups) {
          for (const item of group || []) {
            if (noteIds.has(item.id)) byId.set(item.id, item)
          }
        }

        next[category] = Array.from(byId.values())
          .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
      }

      setProjectIndexes({
        characters: next.characters || [],
        locations: next.locations || [],
        foreshadows: next.foreshadows || [],
      })
    } catch (error) {
      console.error('加载项目索引失败', error)
      setProjectIndexes({
        characters: [],
        locations: [],
        foreshadows: [],
      })
    } finally {
      setIndexLoading(false)
    }
  }, [files])

  const workspace = useMemo(
    () => buildProjectWorkspace(files, selectedProjectId, projectMeta),
    [files, projectMeta, selectedProjectId]
  )

  useEffect(() => {
    if (!workspace?.project?.id) return
    void loadProjectIndexes(workspace)
  }, [loadProjectIndexes, workspace?.project?.id])

  const labels = getProjectLabels(workspace?.project?.type || projectMeta.type)
  const progress = getProjectProgress(workspace, projectMeta)
  const recentActivity = getRecentProjectActivity(workspace, 6)
  const filteredProjectVolumes = useMemo(
    () => filterProjectVolumes(workspace, projectMeta, {
      query: projectBoardQuery,
      status: projectBoardStatus,
      volumeId: projectBoardVolume,
    }),
    [projectBoardQuery, projectBoardStatus, projectBoardVolume, projectMeta, workspace]
  )
  const projectBoardFilterActive = Boolean(
    projectBoardQuery.trim() ||
    projectBoardStatus !== 'all' ||
    projectBoardVolume !== 'all'
  )
  const filteredProjectChapterCount = filteredProjectVolumes.reduce(
    (sum, volume) => sum + volume.notes.length,
    0,
  )
  const filteredProjectWordCount = filteredProjectVolumes.reduce(
    (sum, volume) => sum + Number(volume.wordCount || 0),
    0,
  )
  const visibleProjectNoteIds = useMemo(
    () => filteredProjectVolumes.flatMap(
      volume => volume.notes.map(note => note.id)
    ),
    [filteredProjectVolumes]
  )
  const selectedNoteIdSet = useMemo(
    () => new Set(selectedNoteIds),
    [selectedNoteIds]
  )
  const selectedVisibleCount = visibleProjectNoteIds.filter(
    id => selectedNoteIdSet.has(id)
  ).length
  const allVisibleSelected = Boolean(
    visibleProjectNoteIds.length &&
    selectedVisibleCount === visibleProjectNoteIds.length
  )
  const projectBoardInteractionLocked = selectionMode || projectBoardFilterActive

  const updateMeta = next => {
    setProjectMeta(previous => {
      const value = typeof next === 'function' ? next(previous) : next
      writeProjectWorkspaceMeta(selectedProjectId, value)
      return value
    })
  }

  const toggleNoteSelection = noteId => {
    const id = String(noteId || '')
    if (!id) return
    setSelectedNoteIds(previous => (
      previous.includes(id)
        ? previous.filter(item => item !== id)
        : [...previous, id]
    ))
  }

  const toggleVisibleSelection = () => {
    setSelectedNoteIds(previous => {
      const current = new Set(previous)
      if (allVisibleSelected) {
        for (const id of visibleProjectNoteIds) current.delete(id)
      } else {
        for (const id of visibleProjectNoteIds) current.add(id)
      }
      return Array.from(current)
    })
  }

  const applyBulkStatus = () => {
    if (!selectedNoteIds.length) return

    updateMeta(previous => ({
      ...previous,
      statuses: {
        ...previous.statuses,
        ...Object.fromEntries(
          selectedNoteIds.map(id => [id, batchStatusTarget])
        ),
      },
    }))
    toast.success(
      '已将 ' + selectedNoteIds.length + ' 个' + labels.chapter +
      '设为“' + statusCopy(batchStatusTarget) + '”'
    )
  }

  const moveSelectedNotes = async () => {
    if (!selectedNoteIds.length || batchBusy || !workspace?.project?.id) return

    const selectedInOrder = getProjectExportIds(workspace)
      .filter(id => selectedNoteIdSet.has(id))
    const targetParentId = batchMoveTarget === '__ungrouped__'
      ? workspace.project.id
      : batchMoveTarget
    const plan = buildProjectBatchMovePlan(
      files,
      selectedInOrder,
      targetParentId,
    )
    if (!plan.length) return

    setBatchBusy(true)
    try {
      for (const item of plan) {
        await api('/api/files/' + item.id, {
          method: 'PUT',
          body: JSON.stringify({
            parent_id: item.parent_id,
            sort_order: item.sort_order,
          }),
        })
      }

      await load()
      setSelectedNoteIds([])
      toast.success(
        '已移动 ' + plan.length + ' 个' + labels.chapter
      )
      window.dispatchEvent(new CustomEvent('library:refresh', {
        detail: { source: 'project-workspace' },
      }))
    } catch (error) {
      console.error('批量移动章节失败', error)
      toast.error(error.message || '批量移动章节失败')
    } finally {
      setBatchBusy(false)
    }
  }

  const setProjectType = type => {
    updateMeta(previous => ({
      ...previous,
      type: type === 'script' ? 'script' : 'novel',
    }))
  }

  const saveSummary = noteId => {
    updateMeta(previous => ({
      ...previous,
      summaries: {
        ...previous.summaries,
        [noteId]: summaryDraft.trim(),
      },
    }))
    setEditingSummaryId('')
    setSummaryDraft('')
  }

  const beginSummaryEdit = note => {
    setEditingSummaryId(note.id)
    setSummaryDraft(String(projectMeta.summaries?.[note.id] || ''))
  }

  const applyProjectTemplate = async () => {
    if (!workspace?.project?.id || templateBusy) return

    setTemplateBusy(true)
    try {
      const template = getProjectTemplate(workspace.project.type)
      const projectId = workspace.project.id
      const currentFiles = await listAllFilesWithContent()
      const folderIds = new Map()
      const supportNoteIds = new Set(projectMeta.supportNoteIds || [])
      let createdCount = 0

      for (const folderSpec of template.folders) {
        const existing = currentFiles.find(item => (
          item.is_folder &&
          String(item.parent_id || '') === String(projectId) &&
          String(item.title || '') === folderSpec.title
        ))

        if (existing) {
          folderIds.set(folderSpec.key, existing.id)
          continue
        }

        const created = await api('/api/files', {
          method: 'POST',
          body: JSON.stringify({
            title: folderSpec.title,
            content: '',
            is_folder: true,
            parent_id: projectId,
          }),
        })
        folderIds.set(folderSpec.key, created.id)
        currentFiles.push(created)
        createdCount += 1
      }

      const tagNames = new Set(['角色', '地点', '伏笔'])
      const allTags = await tagApi.list()
      const tagsByName = new Map(
        (allTags || []).map(tag => [
          String(tag.name || '').trim(),
          tag,
        ])
      )

      for (const tagName of tagNames) {
        if (!tagsByName.has(tagName)) {
          try {
            const createdTag = await tagApi.create({ name: tagName })
            tagsByName.set(tagName, createdTag)
          } catch (error) {
            console.warn('创建项目索引标签失败', tagName, error)
          }
        }
      }

      for (const noteSpec of template.notes) {
        const parentId = noteSpec.parentKey
          ? (folderIds.get(noteSpec.parentKey) || projectId)
          : projectId

        let targetNote = currentFiles.find(item => (
          !item.is_folder &&
          String(item.parent_id || '') === String(parentId) &&
          String(item.title || '') === noteSpec.title
        ))

        if (!targetNote) {
          targetNote = await api('/api/files', {
            method: 'POST',
            body: JSON.stringify({
              title: noteSpec.title,
              content: markdownToLexical(noteSpec.content),
              is_folder: false,
              parent_id: parentId,
            }),
          })
          currentFiles.push(targetNote)
          createdCount += 1
        }

        const title = String(noteSpec.title || '')
        let categoryTag = ''
        if (/人物|角色/.test(title)) categoryTag = '角色'
        else if (/世界观|场景/.test(title)) categoryTag = '地点'
        else if (/伏笔/.test(title)) categoryTag = '伏笔'

        if (noteSpec.role === 'support' && targetNote?.id) {
          supportNoteIds.add(targetNote.id)
        }

        const tag = tagsByName.get(categoryTag)
        if (tag?.id) {
          try {
            await tagApi.addFileTag(targetNote.id, tag.id)
          } catch (error) {
            console.warn('初始化项目索引标签失败', targetNote.id, error)
          }
        }
      }

      updateMeta(previous => ({
        ...previous,
        type: template.id,
        targetWords: Number(previous.targetWords) > 0
          ? previous.targetWords
          : template.targetWords,
        supportNoteIds: Array.from(supportNoteIds),
      }))

      await load()
      toast.success(
        createdCount
          ? template.label + '已初始化，共新增 ' + createdCount + ' 项'
          : '项目模板内容已存在，没有覆盖现有创作'
      )
      window.dispatchEvent(new CustomEvent('library:refresh', {
        detail: { source: 'project-workspace' },
      }))
    } catch (error) {
      console.error('初始化项目模板失败', error)
      toast.error(error.message || '初始化项目模板失败')
    } finally {
      setTemplateBusy(false)
    }
  }

  const cycleStatus = note => {
    updateMeta(previous => ({
      ...previous,
      statuses: {
        ...previous.statuses,
        [note.id]: nextProjectStatus(previous.statuses?.[note.id]),
      },
    }))
  }

  const moveNote = async (noteId, targetParentId, targetIndex) => {
    if (!noteId || movingId) return

    const patch = calculateProjectCardMove(
      files,
      noteId,
      targetParentId,
      targetIndex,
    )
    if (!patch) return

    const original = files.find(file => file.id === noteId)
    if (
      original &&
      String(original.parent_id || '') === String(patch.parent_id || '') &&
      Number(original.sort_order || 0) === Number(patch.sort_order || 0)
    ) {
      return
    }

    setMovingId(noteId)
    try {
      if (Array.isArray(patch.rebalance) && patch.rebalance.length) {
        for (const item of patch.rebalance) {
          await api('/api/files/' + item.id, {
            method: 'PUT',
            body: JSON.stringify({
              parent_id: item.parent_id,
              sort_order: item.sort_order,
            }),
          })
        }
      } else {
        await api('/api/files/' + noteId, {
          method: 'PUT',
          body: JSON.stringify({
            parent_id: patch.parent_id,
            sort_order: patch.sort_order,
          }),
        })
      }

      await load()
      window.dispatchEvent(new CustomEvent('library:refresh', {
        detail: { source: 'project-workspace' },
      }))
    } catch (error) {
      console.error('移动章节失败', error)
      toast.error(error.message || '移动章节失败')
    } finally {
      setMovingId('')
      setDraggedNoteId('')
      setDropTarget(null)
    }
  }

  const exportCombined = async ({ ids, title, format, key }) => {
    if (!ids.length || exportingKey) return

    if (!window.electronAPI?.openDirectoryDialog || !window.electronAPI?.exportCombinedManuscript) {
      toast.error('当前环境不支持合并导出')
      return
    }

    setExportingKey(key)
    try {
      const targetDir = await window.electronAPI.openDirectoryDialog()
      if (!targetDir) return

      const result = await window.electronAPI.exportCombinedManuscript(
        ids,
        targetDir,
        format,
        title,
      )
      if (!result?.success) {
        throw new Error(result?.message || '导出失败')
      }

      toast.success(
        (format === 'markdown' ? 'Markdown' : 'Word') +
        ' 合并稿已导出'
      )
    } catch (error) {
      console.error('项目合并导出失败', error)
      toast.error(error.message || '项目合并导出失败')
    } finally {
      setExportingKey('')
    }
  }

  if (loading) {
    return (
      <div className="project-workspace-panel">
        <div className="placeholder">正在整理项目结构…</div>
      </div>
    )
  }

  if (!projects.length) {
    return (
      <div className="project-workspace-panel">
        <header className="project-workspace-toolbar">
          <div>
            <strong>项目工作台</strong>
            <span>把文件夹作为小说或剧本项目来管理。</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="返回笔记">×</button>
        </header>
        <div className="project-workspace-empty">
          <div className="project-workspace-empty-mark">▤</div>
          <strong>还没有项目文件夹</strong>
          <span>先在“笔记”里创建一个根文件夹，再把卷 / 幕与章节笔记放进去。</span>
          <button type="button" className="btn primary" onClick={onClose}>返回笔记</button>
        </div>
      </div>
    )
  }

  if (!workspace) return null

  const projectIds = getProjectExportIds(workspace)

  return (
    <div className="project-workspace-panel">
      <header className="project-workspace-toolbar">
        <div className="project-workspace-heading">
          <div className="project-workspace-title-row">
            <strong>项目工作台</strong>
            <span className="project-workspace-kind">{labels.project}</span>
          </div>
          <span>按文件夹组织长篇小说、剧本与章节文件。</span>
        </div>

        <div className="project-workspace-toolbar-actions">
          <select
            value={selectedProjectId}
            onChange={event => {
              setSelectedProjectId(event.target.value)
              setProjectActionsOpen(false)
            }}
            aria-label="选择项目"
          >
            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.title} · {project.noteCount} 篇
              </option>
            ))}
          </select>

          <div
            className="project-actions-menu-wrap"
            ref={projectActionsRef}
          >
            <button
              type="button"
              className="btn small project-actions-trigger"
              onClick={() => setProjectActionsOpen(value => !value)}
              aria-haspopup="menu"
              aria-expanded={projectActionsOpen}
            >
              项目操作
              <span aria-hidden="true">⌄</span>
            </button>

            {projectActionsOpen && (
              <div className="project-actions-menu" role="menu">
                <div className="project-actions-menu-section">
                  <span>项目类型</span>
                  <div className="project-actions-type-switch">
                    <button
                      type="button"
                      className={workspace.project.type === 'novel' ? 'active' : ''}
                      onClick={() => {
                        setProjectType('novel')
                        setProjectActionsOpen(false)
                      }}
                    >
                      小说
                    </button>
                    <button
                      type="button"
                      className={workspace.project.type === 'script' ? 'active' : ''}
                      onClick={() => {
                        setProjectType('script')
                        setProjectActionsOpen(false)
                      }}
                    >
                      剧本
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  role="menuitem"
                  disabled={templateBusy}
                  onClick={() => {
                    setProjectActionsOpen(false)
                    void applyProjectTemplate()
                  }}
                >
                  {templateBusy ? '正在初始化模板…' : '初始化项目模板'}
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={!projectIds.length || Boolean(exportingKey)}
                  onClick={() => {
                    setProjectActionsOpen(false)
                    void exportCombined({
                      ids: projectIds,
                      title: workspace.project.title,
                      format: 'markdown',
                      key: 'project-md',
                    })
                  }}
                >
                  合并导出 Markdown
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={!projectIds.length || Boolean(exportingKey)}
                  onClick={() => {
                    setProjectActionsOpen(false)
                    void exportCombined({
                      ids: projectIds,
                      title: workspace.project.title,
                      format: 'docx',
                      key: 'project-docx',
                    })
                  }}
                >
                  合并导出 Word
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProjectActionsOpen(false)
                    void load()
                  }}
                >
                  刷新项目数据
                </button>
              </div>
            )}
          </div>

          <button type="button" className="icon-btn" onClick={onClose} title="返回笔记" aria-label="返回笔记">×</button>
        </div>
      </header>

      <div className="project-workspace-stats">
        <div>
          <span>{labels.volume}</span>
          <strong>{workspace.volumeCount}</strong>
        </div>
        <div>
          <span>{labels.chapter}</span>
          <strong>{workspace.chapterCount}</strong>
        </div>
        <div>
          <span>总字数</span>
          <strong>{formatCount(workspace.totalWords)}</strong>
        </div>
        <div>
          <span>完成</span>
          <strong>
            {workspace.volumes.reduce(
              (sum, volume) => sum + volume.notes.filter(note => note.status === 'done').length,
              0,
            )}
          </strong>
        </div>
      </div>

      <nav className="project-workspace-view-tabs" aria-label="项目工作台视图">
        {PROJECT_VIEWS.map(view => (
          <button
            key={view.id}
            type="button"
            className={activeView === view.id ? 'active' : ''}
            onClick={() => {
              setActiveView(view.id)
              setProjectActionsOpen(false)
            }}
            aria-pressed={activeView === view.id}
            aria-keyshortcuts={'Alt+' + (PROJECT_VIEWS.indexOf(view) + 1)}
            title={view.label + ' · Alt+' + (PROJECT_VIEWS.indexOf(view) + 1)}
          >
            <strong>{view.label}</strong>
            <span>{view.description}</span>
          </button>
        ))}
      </nav>

      <div className={'project-workspace-view-content view-' + activeView}>
      {activeView === 'today' && (
        <>
      <ProjectTodayCenter
        workspace={workspace}
        projectMeta={projectMeta}
        onOpenFile={onOpenFile}
        onStartFocus={(note, durationMinutes) => (
          onStartFocus?.(note, durationMinutes, workspace.project)
        )}
        onNavigateView={setActiveView}
      />
        </>
      )}

      {activeView === 'project' && (
        <>
      <section className="project-creative-console" aria-label="创作项目控制台">
        <div className="project-console-card project-progress-card">
          <div className="project-console-card-head">
            <div>
              <strong>创作进度</strong>
              <span>目标字数与章节完成度</span>
            </div>
          </div>

          <label className="project-target-input">
            <span>目标字数</span>
            <input
              type="number"
              min="0"
              step="1000"
              value={projectMeta.targetWords || ''}
              placeholder={workspace.project.type === 'script' ? '例如 30000' : '例如 500000'}
              onChange={event => {
                const value = Math.max(0, Number(event.target.value) || 0)
                updateMeta(previous => ({
                  ...previous,
                  targetWords: value,
                }))
              }}
            />
          </label>

          <div className="project-progress-line">
            <div>
              <span>字数</span>
              <strong>
                {formatCount(progress.totalWords)}
                {progress.targetWords > 0 ? ' / ' + formatCount(progress.targetWords) : ''}
              </strong>
            </div>
            <div className="project-progress-track">
              <span style={{ width: String(progress.wordProgress) + '%' }} />
            </div>
            <small>{progress.targetWords > 0 ? progress.wordProgress + '%' : '未设目标'}</small>
          </div>

          <div className="project-progress-line">
            <div>
              <span>完成章节</span>
              <strong>{progress.completed} / {progress.totalChapters}</strong>
            </div>
            <div className="project-progress-track">
              <span style={{ width: String(progress.chapterProgress) + '%' }} />
            </div>
            <small>{progress.chapterProgress}%</small>
          </div>
        </div>

        <div className="project-console-card project-activity-card">
          <div className="project-console-card-head">
            <div>
              <strong>最近写作</strong>
              <span>按最后更新时间排序</span>
            </div>
          </div>
          <div className="project-activity-list">
            {recentActivity.length ? recentActivity.map(note => (
              <button
                key={note.id}
                type="button"
                onClick={() => onOpenFile?.(note.id)}
              >
                <span>
                  <strong>{displayTitle(note.title)}</strong>
                  <small>{note.volumeTitle || labels.ungrouped}</small>
                </span>
                <em>{formatUpdated(note.updated_at)}</em>
              </button>
            )) : (
              <div className="project-console-empty">还没有写作活动。</div>
            )}
          </div>
        </div>

        <div className="project-console-card project-index-card">
          <div className="project-console-card-head">
            <div>
              <strong>项目索引</strong>
              <span>复用“角色 / 地点 / 伏笔”标签</span>
            </div>
            {indexLoading && <small>更新中…</small>}
          </div>

          <div className="project-index-groups">
            {[
              ['characters', '角色'],
              ['locations', '地点'],
              ['foreshadows', '伏笔'],
            ].map(([key, label]) => (
              <div key={key} className="project-index-group">
                <div className="project-index-group-head">
                  <strong>{label}</strong>
                  <span>{projectIndexes[key]?.length || 0}</span>
                </div>
                <div className="project-index-items">
                  {(projectIndexes[key] || []).slice(0, 4).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpenFile?.(item.id)}
                      title={item.title}
                    >
                      {displayTitle(item.title)}
                    </button>
                  ))}
                  {(projectIndexes[key] || []).length === 0 && (
                    <small>给项目笔记添加“{label}”标签后会出现在这里。</small>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
        </>
      )}

      {activeView === 'analysis' && (
        <ProjectAnalyticsPanel
          workspace={workspace}
          projectMeta={projectMeta}
          projectIndexes={projectIndexes}
          onMetaChange={updateMeta}
          onOpenFile={onOpenFile}
          onNavigateView={setActiveView}
        />
      )}

      {activeView === 'planning' && (
        <ProjectPlanningPanel
          workspace={workspace}
          projectMeta={projectMeta}
          onMetaChange={updateMeta}
          onOpenFile={onOpenFile}
        />
      )}

      {activeView === 'today' && (
        <ProjectSprintPanel
          workspace={workspace}
          projectMeta={projectMeta}
          onMetaChange={updateMeta}
          onOpenFile={onOpenFile}
        />
      )}

      {activeView === 'analysis' && (
        <FocusSessionAnalyticsPanel
          workspace={workspace}
          onOpenFile={onOpenFile}
        />
      )}

      {activeView === 'insights' && (
        <ProjectInsightsPanel
          workspace={workspace}
          projectMeta={projectMeta}
          projectIndexes={projectIndexes}
          onOpenFile={onOpenFile}
          onNavigateView={setActiveView}
        />
      )}

      {activeView === 'project' && (
        <>
      {workspace.chapterCount === 0 ? (
        <div className="project-board-empty-state">
          <div className="project-board-empty-mark">▤</div>
          <strong>这个项目还没有正文章节</strong>
          <span>
            可以先初始化项目模板，或返回笔记创建卷 / 章节后再回来管理。
          </span>
          <div>
            <button
              type="button"
              className="btn primary"
              disabled={templateBusy}
              onClick={() => void applyProjectTemplate()}
            >
              {templateBusy ? '初始化中…' : '初始化项目模板'}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              返回笔记
            </button>
          </div>
        </div>
      ) : (
      <>
      <section className="project-board-toolbar" aria-label="项目章节筛选">
        <div className="project-board-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={projectBoardQuery}
            onChange={event => setProjectBoardQuery(event.target.value)}
            placeholder="搜索章节标题或摘要"
            aria-label="搜索项目章节"
          />
        </div>
        <select
          value={projectBoardStatus}
          onChange={event => setProjectBoardStatus(event.target.value)}
          aria-label="按章节状态筛选"
        >
          <option value="all">全部状态</option>
          <option value="draft">草稿</option>
          <option value="review">修订</option>
          <option value="done">完成</option>
        </select>
        <select
          value={projectBoardVolume}
          onChange={event => setProjectBoardVolume(event.target.value)}
          aria-label="按卷筛选"
        >
          <option value="all">全部{labels.volume}</option>
          {workspace.volumes.map(volume => (
            <option
              key={volume.id || '__ungrouped__'}
              value={volume.id || '__ungrouped__'}
            >
              {volume.title}
            </option>
          ))}
        </select>
        <div className="project-board-filter-summary">
          <strong>{filteredProjectChapterCount}</strong>
          <span>{labels.chapter} · {formatCount(filteredProjectWordCount)} 字</span>
        </div>
        {projectBoardFilterActive && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setProjectBoardQuery('')
              setProjectBoardStatus('all')
              setProjectBoardVolume('all')
            }}
          >
            清除筛选
          </button>
        )}
        <button
          type="button"
          className={'btn small project-board-select-toggle' + (selectionMode ? ' active' : '')}
          aria-pressed={selectionMode}
          onClick={() => {
            setProjectActionsOpen(false)
            setSelectionMode(value => {
              const next = !value
              if (!next) setSelectedNoteIds([])
              return next
            })
            setEditingSummaryId('')
            setSummaryDraft('')
          }}
        >
          {selectionMode ? '结束多选' : '批量选择'}
        </button>
      </section>

      {selectionMode && (
        <section className="project-board-bulkbar" aria-label="章节批量操作">
          <div className="project-board-bulk-summary">
            <strong>已选 {selectedNoteIds.length} {labels.chapter}</strong>
            <span>
              当前结果中 {selectedVisibleCount} 项已选
            </span>
          </div>

          <button
            type="button"
            className="btn small"
            disabled={!visibleProjectNoteIds.length}
            onClick={toggleVisibleSelection}
          >
            {allVisibleSelected ? '取消当前结果' : '选择当前结果'}
          </button>

          <div className="project-board-bulk-group">
            <select
              value={batchStatusTarget}
              onChange={event => setBatchStatusTarget(event.target.value)}
              aria-label="批量设置章节状态"
            >
              <option value="draft">设为草稿</option>
              <option value="review">设为修订</option>
              <option value="done">设为完成</option>
            </select>
            <button
              type="button"
              className="btn small"
              disabled={!selectedNoteIds.length}
              onClick={applyBulkStatus}
            >
              应用状态
            </button>
          </div>

          <div className="project-board-bulk-group">
            <select
              value={batchMoveTarget}
              onChange={event => setBatchMoveTarget(event.target.value)}
              aria-label={'批量移动目标' + labels.volume}
            >
              <option value="__ungrouped__">{labels.ungrouped}</option>
              {workspace.volumes.filter(volume => volume.id).map(volume => (
                <option key={volume.id} value={volume.id}>
                  {volume.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn small"
              disabled={!selectedNoteIds.length || batchBusy}
              onClick={() => void moveSelectedNotes()}
            >
              {batchBusy ? '移动中…' : '移动'}
            </button>
          </div>

          <button
            type="button"
            className="btn small"
            disabled={!selectedNoteIds.length}
            onClick={() => setSelectedNoteIds([])}
          >
            取消选择
          </button>
        </section>
      )}

      {filteredProjectVolumes.length ? (
      <div className="project-workspace-board">
        {filteredProjectVolumes.map(volume => {
          const parentId = volume.id || workspace.project.id
          const exportIds = getVolumeExportIds(volume)
          const volumeTitle = volume.id
            ? volume.title
            : labels.ungrouped

          return (
            <section
              key={volume.id || '__ungrouped__'}
              className="project-volume-column"
              onDragOver={event => {
                if (projectBoardInteractionLocked || !draggedNoteId) return
                event.preventDefault()
                setDropTarget({
                  volumeId: parentId,
                  noteId: '',
                  position: 'end',
                })
              }}
              onDrop={event => {
                if (projectBoardInteractionLocked || !draggedNoteId) return
                event.preventDefault()
                void moveNote(
                  draggedNoteId,
                  parentId,
                  volume.notes.length,
                )
              }}
            >
              <header className="project-volume-header">
                <div>
                  <strong>{volumeTitle}</strong>
                  <span>
                    {volume.notes.length} {labels.chapter} · {formatCount(volume.wordCount)} 字
                  </span>
                </div>
                <div className="project-volume-export">
                  <button
                    type="button"
                    disabled={!exportIds.length || Boolean(exportingKey)}
                    onClick={() => void exportCombined({
                      ids: exportIds,
                      title: workspace.project.title + '-' + volumeTitle,
                      format: 'markdown',
                      key: (volume.id || 'ungrouped') + '-md',
                    })}
                    title="合并导出 Markdown"
                  >
                    MD
                  </button>
                  <button
                    type="button"
                    disabled={!exportIds.length || Boolean(exportingKey)}
                    onClick={() => void exportCombined({
                      ids: exportIds,
                      title: workspace.project.title + '-' + volumeTitle,
                      format: 'docx',
                      key: (volume.id || 'ungrouped') + '-docx',
                    })}
                    title="合并导出 Word"
                  >
                    W
                  </button>
                </div>
              </header>

              <div className="project-volume-cards">
                {volume.notes.map((note, index) => {
                  const isDragging = draggedNoteId === note.id
                  const isBefore = dropTarget?.noteId === note.id && dropTarget.position === 'before'
                  const isAfter = dropTarget?.noteId === note.id && dropTarget.position === 'after'

                  return (
                    <article
                      key={note.id}
                      className={
                        'project-chapter-card' +
                        (isDragging ? ' dragging' : '') +
                        (isBefore ? ' drop-before' : '') +
                        (isAfter ? ' drop-after' : '') +
                        (selectedNoteIdSet.has(note.id) ? ' selected' : '') +
                        (selectionMode ? ' selection-mode' : '')
                      }
                      draggable={!projectBoardInteractionLocked && !movingId && editingSummaryId !== note.id}
                      onDragStart={event => {
                        setDraggedNoteId(note.id)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', note.id)
                      }}
                      onDragEnd={() => {
                        setDraggedNoteId('')
                        setDropTarget(null)
                      }}
                      onDragOver={event => {
                        if (projectBoardInteractionLocked || !draggedNoteId || draggedNoteId === note.id) return
                        event.preventDefault()
                        event.stopPropagation()
                        const rect = event.currentTarget.getBoundingClientRect()
                        const position = event.clientY < rect.top + rect.height / 2
                          ? 'before'
                          : 'after'
                        setDropTarget({
                          volumeId: parentId,
                          noteId: note.id,
                          position,
                        })
                      }}
                      onDrop={event => {
                        if (projectBoardInteractionLocked || !draggedNoteId || draggedNoteId === note.id) return
                        event.preventDefault()
                        event.stopPropagation()

                        const position = dropTarget?.noteId === note.id
                          ? dropTarget.position
                          : 'before'
                        const targetIndex = position === 'after'
                          ? index + 1
                          : index
                        void moveNote(draggedNoteId, parentId, targetIndex)
                      }}
                    >
                      {selectionMode && (
                        <label
                          className="project-chapter-select"
                          title={'选择' + displayTitle(note.title)}
                        >
                          <input
                            type="checkbox"
                            checked={selectedNoteIdSet.has(note.id)}
                            onChange={() => toggleNoteSelection(note.id)}
                            aria-label={'选择章节 ' + displayTitle(note.title)}
                          />
                          <span aria-hidden="true">✓</span>
                        </label>
                      )}

                      <div className="project-chapter-main">
                        <button
                          type="button"
                          className="project-chapter-open"
                          onClick={() => (
                            selectionMode
                              ? toggleNoteSelection(note.id)
                              : onOpenFile?.(note.id)
                          )}
                        >
                          <strong>{displayTitle(note.title)}</strong>
                          <span>
                            {formatCount(note.wordCount)} 字 · {formatUpdated(note.updated_at)}
                          </span>
                        </button>

                        {editingSummaryId === note.id ? (
                          <div className="project-chapter-summary-editor">
                            <textarea
                              value={summaryDraft}
                              onChange={event => setSummaryDraft(event.target.value)}
                              placeholder="一句话概括这一章的目标、冲突或推进…"
                              maxLength={240}
                              autoFocus
                            />
                            <div>
                              <button type="button" onClick={() => saveSummary(note.id)}>保存</button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSummaryId('')
                                  setSummaryDraft('')
                                }}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="project-chapter-summary"
                            onClick={() => (
                              selectionMode
                                ? toggleNoteSelection(note.id)
                                : beginSummaryEdit(note)
                            )}
                            title={selectionMode ? '选择章节' : '编辑章节摘要'}
                          >
                            {getProjectChapterSummary(note, projectMeta)}
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        className={'project-chapter-status ' + note.status}
                        onClick={() => (
                          selectionMode
                            ? toggleNoteSelection(note.id)
                            : cycleStatus(note)
                        )}
                        title={selectionMode ? '选择章节' : '点击切换章节状态'}
                      >
                        {statusCopy(note.status)}
                      </button>
                    </article>
                  )
                })}

                {volume.notes.length === 0 && (
                  <div className="project-volume-empty">
                    拖动{labels.chapter}到这里
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>
      ) : (
        <div className="project-board-filter-empty">
          <strong>没有匹配的章节</strong>
          <span>换一个关键词、状态或{labels.volume}筛选条件。</span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setProjectBoardQuery('')
              setProjectBoardStatus('all')
              setProjectBoardVolume('all')
            }}
          >
            清除筛选
          </button>
        </div>
      )}
      </>
      )}

      <footer className="project-workspace-footer">
        <span>{
          selectionMode
            ? '批量选择中：点击章节卡即可勾选，拖动排序暂时关闭。'
            : projectBoardFilterActive
              ? '筛选状态下仅用于查找与打开章节。'
              : '拖动章节卡可跨' + labels.volume + '移动和调整顺序。'
        }</span>
        <span>状态仅是本机项目视图偏好，不修改正文或现有数据库。</span>
      </footer>
        </>
      )}
      </div>
    </div>
  )
}
