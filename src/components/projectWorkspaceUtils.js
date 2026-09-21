import { countLexicalCharacters } from '~/utils/lexicalText'
import { compareLibraryItems } from './fileTreeUtils'

export const PROJECT_META_KEY = 'localNotepad.projectWorkspace.v1'

function normalizeId(value) {
  return String(value || '')
}

function activeItems(files) {
  return (Array.isArray(files) ? files : [])
    .filter(item => item && !item.is_deleted && !String(item.title || '').startsWith('__tpl__'))
}

function descendantsOf(files, parentId) {
  const items = activeItems(files)
  const childrenByParent = new Map()

  for (const item of items) {
    const key = normalizeId(item.parent_id)
    const list = childrenByParent.get(key) || []
    list.push(item)
    childrenByParent.set(key, list)
  }

  const result = []
  const visit = id => {
    for (const child of childrenByParent.get(normalizeId(id)) || []) {
      result.push(child)
      if (child.is_folder) visit(child.id)
    }
  }
  visit(parentId)
  return result
}

export function getProjectCandidates(files) {
  const items = activeItems(files)
  const roots = items
    .filter(item => item.is_folder && !normalizeId(item.parent_id))
    .sort(compareLibraryItems)

  return roots.map(folder => {
    const descendants = descendantsOf(items, folder.id)
    const noteCount = descendants.filter(item => !item.is_folder).length
    const volumeCount = descendants.filter(item => (
      item.is_folder && normalizeId(item.parent_id) === normalizeId(folder.id)
    )).length

    return {
      ...folder,
      noteCount,
      volumeCount,
    }
  })
}

function sortAscendingByLibraryOrder(items) {
  return [...items].sort((a, b) => -compareLibraryItems(a, b))
}

export function buildProjectWorkspace(files, projectId, projectMeta = {}) {
  const items = activeItems(files)
  const project = items.find(item => (
    item.is_folder && normalizeId(item.id) === normalizeId(projectId)
  ))
  if (!project) return null

  const directChildren = items.filter(item => (
    normalizeId(item.parent_id) === normalizeId(project.id)
  ))
  const volumeFolders = sortAscendingByLibraryOrder(
    directChildren.filter(item => item.is_folder)
  )
  const directNotes = sortAscendingByLibraryOrder(
    directChildren.filter(item => !item.is_folder)
  )

  const volumes = []

  if (directNotes.length) {
    volumes.push(buildVolume({
      id: '',
      title: '未分卷',
      projectId: project.id,
      notes: directNotes,
      meta: projectMeta,
    }))
  }

  for (const folder of volumeFolders) {
    const descendants = descendantsOf(items, folder.id)
      .filter(item => !item.is_folder)

    volumes.push(buildVolume({
      id: folder.id,
      title: folder.title || '未命名卷',
      projectId: project.id,
      notes: sortAscendingByLibraryOrder(descendants),
      meta: projectMeta,
    }))
  }

  const totalWords = volumes.reduce((sum, volume) => sum + volume.wordCount, 0)
  const chapterCount = volumes.reduce((sum, volume) => sum + volume.notes.length, 0)

  return {
    project: {
      ...project,
      type: projectMeta.type === 'script' ? 'script' : 'novel',
    },
    volumes,
    totalWords,
    chapterCount,
    volumeCount: volumeFolders.length,
  }
}

function buildVolume({ id, title, projectId, notes, meta }) {
  const cards = notes.map(note => ({
    ...note,
    wordCount: countLexicalCharacters(note.content || ''),
    status: normalizeProjectStatus(meta.statuses?.[note.id]),
  }))

  return {
    id,
    projectId,
    title,
    notes: cards,
    wordCount: cards.reduce((sum, note) => sum + note.wordCount, 0),
    updatedAt: cards.reduce((max, note) => Math.max(max, Number(note.updated_at) || 0), 0),
  }
}

export function normalizeProjectStatus(status) {
  return ['draft', 'review', 'done'].includes(status) ? status : 'draft'
}

export function nextProjectStatus(status) {
  const normalized = normalizeProjectStatus(status)
  if (normalized === 'draft') return 'review'
  if (normalized === 'review') return 'done'
  return 'draft'
}

export function readProjectWorkspaceMeta(projectId) {
  try {
    const all = JSON.parse(localStorage.getItem(PROJECT_META_KEY) || '{}')
    const value = all?.[normalizeId(projectId)] || {}
    return {
      type: value.type === 'script' ? 'script' : 'novel',
      statuses: value.statuses && typeof value.statuses === 'object'
        ? { ...value.statuses }
        : {},
    }
  } catch {
    return { type: 'novel', statuses: {} }
  }
}

export function writeProjectWorkspaceMeta(projectId, nextMeta) {
  const id = normalizeId(projectId)
  if (!id) return

  try {
    const all = JSON.parse(localStorage.getItem(PROJECT_META_KEY) || '{}')
    all[id] = {
      type: nextMeta?.type === 'script' ? 'script' : 'novel',
      statuses: nextMeta?.statuses && typeof nextMeta.statuses === 'object'
        ? nextMeta.statuses
        : {},
    }
    localStorage.setItem(PROJECT_META_KEY, JSON.stringify(all))
  } catch {
    // Project view preferences are optional and must not block editing.
  }
}

export function getProjectLabels(type) {
  if (type === 'script') {
    return {
      project: '剧本项目',
      volume: '幕 / 集',
      chapter: '场次',
      ungrouped: '未分幕',
    }
  }
  return {
    project: '小说项目',
    volume: '卷',
    chapter: '章节',
    ungrouped: '未分卷',
  }
}

export function calculateProjectCardMove(files, noteId, targetParentId, targetIndex) {
  const items = activeItems(files)
  const note = items.find(item => (
    !item.is_folder && normalizeId(item.id) === normalizeId(noteId)
  ))
  if (!note) return null

  const parentId = normalizeId(targetParentId)
  const siblings = sortAscendingByLibraryOrder(
    items.filter(item => (
      !item.is_folder &&
      normalizeId(item.parent_id) === parentId &&
      normalizeId(item.id) !== normalizeId(noteId)
    ))
  )

  const index = Math.max(0, Math.min(Number(targetIndex) || 0, siblings.length))
  const previous = index > 0 ? siblings[index - 1] : null
  const next = index < siblings.length ? siblings[index] : null

  let sortOrder
  if (previous && next) {
    sortOrder = Math.floor(
      (Number(previous.sort_order || 0) + Number(next.sort_order || 0)) / 2
    )
    if (sortOrder === Number(previous.sort_order || 0) || sortOrder === Number(next.sort_order || 0)) {
      sortOrder = Number(previous.sort_order || 0) - 1
    }
  } else if (previous) {
    sortOrder = Number(previous.sort_order || 0) - 1000
  } else if (next) {
    sortOrder = Number(next.sort_order || 0) + 1000
  } else {
    sortOrder = Math.floor(Date.now() / 1000)
  }

  return {
    id: note.id,
    parent_id: parentId,
    sort_order: sortOrder,
  }
}

export function getVolumeExportIds(volume) {
  return (volume?.notes || []).map(note => note.id).filter(Boolean)
}

export function getProjectExportIds(workspace) {
  return (workspace?.volumes || [])
    .flatMap(volume => getVolumeExportIds(volume))
}
