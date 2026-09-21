import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  listAllFilesWithContent,
} from '~/services/api'
import { toast } from '~/services/toast'
import { tagApi } from '~/services/tagApi'
import {
  buildProjectWorkspace,
  calculateProjectCardMove,
  getProjectCandidates,
  getProjectChapterSummary,
  getProjectExportIds,
  getProjectIndexAliases,
  getProjectLabels,
  getProjectProgress,
  getProjectTemplate,
  getRecentProjectActivity,
  getVolumeExportIds,
  nextProjectStatus,
  readProjectWorkspaceMeta,
  writeProjectWorkspaceMeta,
} from './projectWorkspaceUtils'
import './ProjectWorkspacePanel.css'

const LAST_PROJECT_KEY = 'localNotepad.projectWorkspace.lastProject'

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
  onClose,
}) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [movingId, setMovingId] = useState('')
  const [exportingKey, setExportingKey] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState(
    () => localStorage.getItem(LAST_PROJECT_KEY) || ''
  )
  const [projectMeta, setProjectMeta] = useState({
    type: 'novel',
    targetWords: 0,
    statuses: {},
    summaries: {},
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
    if (!selectedProjectId) {
      setProjectMeta({
        type: 'novel',
        targetWords: 0,
        statuses: {},
        summaries: {},
      })
      return
    }

    localStorage.setItem(LAST_PROJECT_KEY, selectedProjectId)
    setProjectMeta(readProjectWorkspaceMeta(selectedProjectId))
  }, [selectedProjectId])

  const loadProjectIndexes = useCallback(async (workspaceValue) => {
    const noteIds = new Set(
      (workspaceValue?.volumes || [])
        .flatMap(volume => volume.notes || [])
        .map(note => note.id)
        .filter(Boolean)
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
  }, [])

  const workspace = useMemo(
    () => buildProjectWorkspace(files, selectedProjectId, projectMeta),
    [files, projectMeta, selectedProjectId]
  )

  useEffect(() => {
    if (!workspace?.project?.id) return
    void loadProjectIndexes(workspace)
  }, [loadProjectIndexes, workspace?.project?.id, files])

  const labels = getProjectLabels(workspace?.project?.type || projectMeta.type)
  const progress = getProjectProgress(workspace, projectMeta)
  const recentActivity = getRecentProjectActivity(workspace, 6)

  const updateMeta = next => {
    setProjectMeta(previous => {
      const value = typeof next === 'function' ? next(previous) : next
      writeProjectWorkspaceMeta(selectedProjectId, value)
      return value
    })
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

        const existing = currentFiles.find(item => (
          !item.is_folder &&
          String(item.parent_id || '') === String(parentId) &&
          String(item.title || '') === noteSpec.title
        ))
        if (existing) continue

        const created = await api('/api/files', {
          method: 'POST',
          body: JSON.stringify({
            title: noteSpec.title,
            content: noteSpec.content,
            is_folder: false,
            parent_id: parentId,
          }),
        })
        currentFiles.push(created)
        createdCount += 1

        const title = String(noteSpec.title || '')
        let categoryTag = ''
        if (/人物|角色/.test(title)) categoryTag = '角色'
        else if (/世界观|场景/.test(title)) categoryTag = '地点'
        else if (/伏笔/.test(title)) categoryTag = '伏笔'

        const tag = tagsByName.get(categoryTag)
        if (tag?.id) {
          try {
            await tagApi.addFileTag(created.id, tag.id)
          } catch (error) {
            console.warn('初始化项目索引标签失败', created.id, error)
          }
        }
      }

      updateMeta(previous => ({
        ...previous,
        type: template.id,
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
            onChange={event => setSelectedProjectId(event.target.value)}
            aria-label="选择项目"
          >
            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.title} · {project.noteCount} 篇
              </option>
            ))}
          </select>

          <div className="project-type-switch" role="group" aria-label="项目类型">
            <button
              type="button"
              className={workspace.project.type === 'novel' ? 'active' : ''}
              onClick={() => setProjectType('novel')}
            >
              小说
            </button>
            <button
              type="button"
              className={workspace.project.type === 'script' ? 'active' : ''}
              onClick={() => setProjectType('script')}
            >
              剧本
            </button>
          </div>

          <button
            type="button"
            className="btn small"
            disabled={!projectIds.length || Boolean(exportingKey)}
            onClick={() => void exportCombined({
              ids: projectIds,
              title: workspace.project.title,
              format: 'markdown',
              key: 'project-md',
            })}
          >
            合并 MD
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!projectIds.length || Boolean(exportingKey)}
            onClick={() => void exportCombined({
              ids: projectIds,
              title: workspace.project.title,
              format: 'docx',
              key: 'project-docx',
            })}
          >
            合并 Word
          </button>
          <button type="button" className="icon-btn" onClick={() => void load()} title="刷新" aria-label="刷新">↻</button>
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

      <div className="project-workspace-board">
        {workspace.volumes.map(volume => {
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
                if (!draggedNoteId) return
                event.preventDefault()
                setDropTarget({
                  volumeId: parentId,
                  noteId: '',
                  position: 'end',
                })
              }}
              onDrop={event => {
                if (!draggedNoteId) return
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
                        (isAfter ? ' drop-after' : '')
                      }
                      draggable={!movingId}
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
                        if (!draggedNoteId || draggedNoteId === note.id) return
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
                        if (!draggedNoteId || draggedNoteId === note.id) return
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
                      <button
                        type="button"
                        className="project-chapter-open"
                        onClick={() => onOpenFile?.(note.id)}
                      >
                        <strong>{displayTitle(note.title)}</strong>
                        <span>
                          {formatCount(note.wordCount)} 字 · {formatUpdated(note.updated_at)}
                        </span>
                      </button>

                      <button
                        type="button"
                        className={'project-chapter-status ' + note.status}
                        onClick={() => cycleStatus(note)}
                        title="点击切换章节状态"
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

      <footer className="project-workspace-footer">
        <span>拖动章节卡可跨{labels.volume}移动和调整顺序。</span>
        <span>状态仅是本机项目视图偏好，不修改正文或现有数据库。</span>
      </footer>
    </div>
  )
}
