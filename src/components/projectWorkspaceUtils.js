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
  return [...items].sort((a, b) => {
    const sortDelta = Number(a?.sort_order || 0) - Number(b?.sort_order || 0)
    if (sortDelta !== 0) return sortDelta

    const createdDelta = Number(a?.created_at || 0) - Number(b?.created_at || 0)
    if (createdDelta !== 0) return createdDelta

    return String(a?.id || '').localeCompare(String(b?.id || ''))
  })
}

export function buildProjectWorkspace(files, projectId, projectMeta = {}) {
  const items = activeItems(files)
  const project = items.find(item => (
    item.is_folder && normalizeId(item.id) === normalizeId(projectId)
  ))
  if (!project) return null

  const supportNoteIds = new Set(
    (projectMeta.supportNoteIds || []).map(normalizeId)
  )

  const directChildren = items.filter(item => (
    normalizeId(item.parent_id) === normalizeId(project.id)
  ))
  const volumeFolders = sortAscendingByLibraryOrder(
    directChildren.filter(item => item.is_folder)
  )
  const directNotes = sortAscendingByLibraryOrder(
    directChildren.filter(item => (
      !item.is_folder && !supportNoteIds.has(normalizeId(item.id))
    ))
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
    const notes = items.filter(item => (
      !item.is_folder &&
      !supportNoteIds.has(normalizeId(item.id)) &&
      normalizeId(item.parent_id) === normalizeId(folder.id)
    ))

    volumes.push(buildVolume({
      id: folder.id,
      title: folder.title || '未命名卷',
      projectId: project.id,
      notes: sortAscendingByLibraryOrder(notes),
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
      targetWords: Math.max(0, Number(value.targetWords) || 0),
      chapterTargetWords: Math.max(0, Number(value.chapterTargetWords) || 0),
      dailyGoal: Math.max(0, Number(value.dailyGoal) || 0),
      weeklyGoal: Math.max(0, Number(value.weeklyGoal) || 0),
      deadline: typeof value.deadline === 'string' ? value.deadline : '',
      statuses: value.statuses && typeof value.statuses === 'object'
        ? { ...value.statuses }
        : {},
      summaries: value.summaries && typeof value.summaries === 'object'
        ? { ...value.summaries }
        : {},
      supportNoteIds: Array.isArray(value.supportNoteIds)
        ? [...new Set(value.supportNoteIds.map(normalizeId).filter(Boolean))]
        : [],
      foreshadowStates: value.foreshadowStates && typeof value.foreshadowStates === 'object'
        ? { ...value.foreshadowStates }
        : {},
      volumeMilestones: value.volumeMilestones && typeof value.volumeMilestones === 'object'
        ? { ...value.volumeMilestones }
        : {},
      chapterQueue: Array.isArray(value.chapterQueue)
        ? [...new Set(value.chapterQueue.map(normalizeId).filter(Boolean))]
        : [],
      sprint: value.sprint && typeof value.sprint === 'object'
        ? { ...value.sprint }
        : null,
      dailyReviews: value.dailyReviews && typeof value.dailyReviews === 'object'
        ? { ...value.dailyReviews }
        : {},
    }
  } catch {
    return {
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
    }
  }
}

export function writeProjectWorkspaceMeta(projectId, nextMeta) {
  const id = normalizeId(projectId)
  if (!id) return

  try {
    const all = JSON.parse(localStorage.getItem(PROJECT_META_KEY) || '{}')
    all[id] = {
      type: nextMeta?.type === 'script' ? 'script' : 'novel',
      targetWords: Math.max(0, Number(nextMeta?.targetWords) || 0),
      chapterTargetWords: Math.max(0, Number(nextMeta?.chapterTargetWords) || 0),
      dailyGoal: Math.max(0, Number(nextMeta?.dailyGoal) || 0),
      weeklyGoal: Math.max(0, Number(nextMeta?.weeklyGoal) || 0),
      deadline: typeof nextMeta?.deadline === 'string' ? nextMeta.deadline : '',
      statuses: nextMeta?.statuses && typeof nextMeta.statuses === 'object'
        ? nextMeta.statuses
        : {},
      summaries: nextMeta?.summaries && typeof nextMeta.summaries === 'object'
        ? nextMeta.summaries
        : {},
      supportNoteIds: Array.isArray(nextMeta?.supportNoteIds)
        ? [...new Set(nextMeta.supportNoteIds.map(normalizeId).filter(Boolean))]
        : [],
      foreshadowStates: nextMeta?.foreshadowStates && typeof nextMeta.foreshadowStates === 'object'
        ? nextMeta.foreshadowStates
        : {},
      volumeMilestones: nextMeta?.volumeMilestones && typeof nextMeta.volumeMilestones === 'object'
        ? nextMeta.volumeMilestones
        : {},
      chapterQueue: Array.isArray(nextMeta?.chapterQueue)
        ? [...new Set(nextMeta.chapterQueue.map(normalizeId).filter(Boolean))]
        : [],
      sprint: nextMeta?.sprint && typeof nextMeta.sprint === 'object'
        ? nextMeta.sprint
        : null,
      dailyReviews: nextMeta?.dailyReviews && typeof nextMeta.dailyReviews === 'object'
        ? nextMeta.dailyReviews
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
  const originalSiblings = sortAscendingByLibraryOrder(
    items.filter(item => (
      !item.is_folder &&
      normalizeId(item.parent_id) === parentId
    ))
  )
  const sourceIndex = originalSiblings.findIndex(item => (
    normalizeId(item.id) === normalizeId(noteId)
  ))

  const siblings = originalSiblings.filter(item => (
    normalizeId(item.id) !== normalizeId(noteId)
  ))

  let requestedIndex = Number(targetIndex) || 0
  if (
    normalizeId(note.parent_id) === parentId &&
    sourceIndex >= 0 &&
    sourceIndex < requestedIndex
  ) {
    requestedIndex -= 1
  }

  const index = Math.max(0, Math.min(requestedIndex, siblings.length))
  const previous = index > 0 ? siblings[index - 1] : null
  const next = index < siblings.length ? siblings[index] : null

  let sortOrder
  if (previous && next) {
    sortOrder = Math.floor(
      (Number(previous.sort_order || 0) + Number(next.sort_order || 0)) / 2
    )
    if (
      sortOrder === Number(previous.sort_order || 0) ||
      sortOrder === Number(next.sort_order || 0)
    ) {
      const ordered = [...siblings]
      ordered.splice(index, 0, note)
      return {
        id: note.id,
        parent_id: parentId,
        sort_order: (index + 1) * 1000,
        rebalance: ordered.map((item, orderIndex) => ({
          id: item.id,
          parent_id: parentId,
          sort_order: (orderIndex + 1) * 1000,
        })),
      }
    }
  } else if (previous) {
    sortOrder = Number(previous.sort_order || 0) + 1000
  } else if (next) {
    sortOrder = Number(next.sort_order || 0) - 1000
  } else {
    sortOrder = Math.floor(Date.now() / 1000)
  }

  return {
    id: note.id,
    parent_id: parentId,
    sort_order: sortOrder,
  }
}

export function getProjectDescendantNoteIds(files, projectId) {
  return descendantsOf(files, projectId)
    .filter(item => !item.is_folder)
    .map(item => item.id)
    .filter(Boolean)
}

export function filterProjectVolumes(workspace, projectMeta = {}, filters = {}) {
  const query = String(filters.query || '').trim().toLocaleLowerCase()
  const status = ['draft', 'review', 'done'].includes(filters.status)
    ? filters.status
    : 'all'
  const volumeId = String(filters.volumeId || 'all')

  return (workspace?.volumes || [])
    .filter(volume => (
      volumeId === 'all' ||
      String(volume.id || '__ungrouped__') === volumeId
    ))
    .map(volume => {
      const notes = (volume.notes || []).filter(note => {
        if (status !== 'all' && note.status !== status) return false
        if (!query) return true

        const haystack = [
          note.title,
          getProjectChapterSummary(note, projectMeta, 240),
        ]
          .join(' ')
          .toLocaleLowerCase()

        return haystack.includes(query)
      })

      return {
        ...volume,
        notes,
        wordCount: notes.reduce(
          (sum, note) => sum + (Number(note.wordCount) || 0),
          0,
        ),
      }
    })
    .filter(volume => volume.notes.length > 0)
}

export function buildProjectBatchMovePlan(files, noteIds, targetParentId) {
  const ids = [...new Set(
    (Array.isArray(noteIds) ? noteIds : [])
      .map(normalizeId)
      .filter(Boolean)
  )]
  if (!ids.length) return []

  const items = activeItems(files)
  const selectedSet = new Set(ids)
  const notesById = new Map(
    items
      .filter(item => !item.is_folder)
      .map(item => [normalizeId(item.id), item])
  )
  const targetId = normalizeId(targetParentId)
  const targetSiblings = sortAscendingByLibraryOrder(
    items.filter(item => (
      !item.is_folder &&
      normalizeId(item.parent_id) === targetId &&
      !selectedSet.has(normalizeId(item.id))
    ))
  )
  const lastSortOrder = targetSiblings.reduce(
    (max, item) => Math.max(max, Number(item.sort_order) || 0),
    0,
  )

  return ids
    .filter(id => notesById.has(id))
    .map((id, index) => ({
      id,
      parent_id: targetId,
      sort_order: lastSortOrder + ((index + 1) * 1000),
    }))
}

function projectNodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return String(node.text || '')
  if (node.type === 'wiki-link') return String(node.title || '')
  return (node.children || []).map(projectNodeText).join('')
}

function chineseProjectNumber(value) {
  const n = Math.max(1, Math.floor(Number(value) || 1))
  if (n > 999) return String(n)

  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const underHundred = number => {
    if (number < 10) return digits[number]
    const tens = Math.floor(number / 10)
    const ones = number % 10
    return (tens === 1 ? '' : digits[tens]) + '十' + (ones ? digits[ones] : '')
  }

  if (n < 100) return underHundred(n)

  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (!rest) return digits[hundreds] + '百'
  if (rest < 10) return digits[hundreds] + '百零' + digits[rest]
  return digits[hundreds] + '百' + underHundred(rest)
}

export function suggestProjectChapterTitle(workspace) {
  const count = Math.max(0, Number(workspace?.chapterCount) || 0) + 1
  const isScript = workspace?.project?.type === 'script'
  return '第' + chineseProjectNumber(count) + (isScript ? '场.md' : '章.md')
}

export function uniqueProjectChapterTitle(files, parentId, requestedTitle) {
  const targetParent = normalizeId(parentId)
  const raw = String(requestedTitle || '').trim() || '未命名.md'
  const hasExtension = /\.[^.]+$/.test(raw)
  const baseTitle = hasExtension ? raw : raw + '.md'
  const dot = baseTitle.lastIndexOf('.')
  const stem = dot > 0 ? baseTitle.slice(0, dot) : baseTitle
  const extension = dot > 0 ? baseTitle.slice(dot) : ''
  const existing = new Set(
    activeItems(files)
      .filter(item => normalizeId(item.parent_id) === targetParent)
      .map(item => String(item.title || '').trim().toLocaleLowerCase())
  )

  if (!existing.has(baseTitle.toLocaleLowerCase())) return baseTitle

  let index = 2
  while (existing.has(
    (stem + ' (' + index + ')' + extension).toLocaleLowerCase()
  )) {
    index += 1
  }
  return stem + ' (' + index + ')' + extension
}

export function getProjectChapterPresets(type = 'novel') {
  if (type === 'script') {
    return [
      { id: 'standard', label: '标准场次' },
      { id: 'action', label: '动作场' },
      { id: 'dialogue', label: '对话场' },
      { id: 'blank', label: '空白' },
    ]
  }

  return [
    { id: 'standard', label: '标准章节' },
    { id: 'conflict', label: '冲突推进' },
    { id: 'reveal', label: '信息揭示' },
    { id: 'blank', label: '空白' },
  ]
}

function presetMarkdown(title, type, presetId) {
  const heading = '# ' + String(title || '未命名').replace(/\.[^.]+$/, '')

  if (presetId === 'blank') {
    return heading + '\n\n'
  }

  if (type === 'script') {
    if (presetId === 'action') {
      return [
        heading,
        '',
        '## 场景目标',
        '',
        '## 动作节拍',
        '',
        '## 冲突升级',
        '',
        '## 收束',
        '',
      ].join('\n')
    }
    if (presetId === 'dialogue') {
      return [
        heading,
        '',
        '## 场景目标',
        '',
        '## 对话推进',
        '',
        '## 潜台词与信息差',
        '',
        '## 转折',
        '',
      ].join('\n')
    }
    return [
      heading,
      '',
      '## 场景目标',
      '',
      '## 动作与对白',
      '',
      '## 转折',
      '',
    ].join('\n')
  }

  if (presetId === 'conflict') {
    return [
      heading,
      '',
      '## 本章目标',
      '',
      '## 冲突建立',
      '',
      '## 压力升级',
      '',
      '## 关键转折',
      '',
      '## 章末钩子',
      '',
    ].join('\n')
  }
  if (presetId === 'reveal') {
    return [
      heading,
      '',
      '## 本章目标',
      '',
      '## 线索铺垫',
      '',
      '## 信息揭示',
      '',
      '## 角色反应',
      '',
      '## 后续悬念',
      '',
    ].join('\n')
  }

  return [
    heading,
    '',
    '## 本章目标',
    '',
    '## 核心推进',
    '',
    '## 关键转折',
    '',
    '## 收束与钩子',
    '',
  ].join('\n')
}

export function buildProjectChapterMarkdown(
  title,
  type = 'novel',
  presetId = 'standard',
  sourceContent = '',
) {
  const normalizedType = type === 'script' ? 'script' : 'novel'
  const safeTitle = String(title || '未命名').trim() || '未命名'

  if (presetId !== 'continue') {
    return presetMarkdown(safeTitle, normalizedType, presetId)
  }

  let state
  try {
    state = typeof sourceContent === 'string'
      ? JSON.parse(sourceContent)
      : sourceContent
  } catch {
    state = null
  }

  const children = Array.isArray(state?.root?.children)
    ? state.root.children
    : []
  const headings = children
    .filter(node => node?.type === 'heading')
    .map(node => {
      const level = Math.max(
        2,
        Math.min(
          6,
          Number(String(node.tag || '').replace('h', '')) ||
          Number(node.level) ||
          2,
        ),
      )
      return {
        level,
        text: projectNodeText(node).trim().replace(/\s+/g, ' '),
      }
    })
    .filter(item => item.text)
    .slice(1)

  if (!headings.length) {
    return presetMarkdown(safeTitle, normalizedType, 'standard')
  }

  const lines = ['# ' + safeTitle.replace(/\.[^.]+$/, ''), '']
  for (const item of headings.slice(0, 12)) {
    lines.push('#'.repeat(item.level) + ' ' + item.text, '')
  }
  return lines.join('\n')
}

export function getProjectVolumeByNoteId(workspace, noteId) {
  const id = normalizeId(noteId)
  return (workspace?.volumes || []).find(volume => (
    (volume.notes || []).some(note => normalizeId(note.id) === id)
  )) || null
}

export function splitProjectChapterContent(content) {
  let state
  try {
    state = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    return null
  }

  const root = state?.root
  const children = Array.isArray(root?.children) ? root.children : []
  if (children.length < 2) return null

  const firstHeadingIndex = children.findIndex(node => node?.type === 'heading')
  const firstHeadingLevel = firstHeadingIndex >= 0
    ? Math.max(
      1,
      Math.min(
        6,
        Number(String(children[firstHeadingIndex]?.tag || '').replace('h', '')) ||
        Number(children[firstHeadingIndex]?.level) ||
        1,
      ),
    )
    : 0

  let splitIndex = firstHeadingIndex > 0 ? firstHeadingIndex : -1
  if (splitIndex < 0) {
    for (let index = Math.max(1, firstHeadingIndex + 1); index < children.length; index++) {
      const node = children[index]
      if (node?.type !== 'heading') continue
      const level = Math.max(
        1,
        Math.min(
          6,
          Number(String(node.tag || '').replace('h', '')) ||
          Number(node.level) ||
          1,
        ),
      )

      const canSplit = firstHeadingLevel === 1
        ? level > firstHeadingLevel
        : level >= firstHeadingLevel
      if (!firstHeadingLevel || canSplit) {
        splitIndex = index
        break
      }
    }
  }

  if (splitIndex < 0) return null

  const splitHeading = children[splitIndex]
  const title = projectNodeText(splitHeading)
    .trim()
    .replace(/\s+/g, ' ') || '拆分章节'
  const tailHeading = {
    ...splitHeading,
    tag: 'h1',
  }
  if ('level' in tailHeading) tailHeading.level = 1

  const headState = {
    ...state,
    root: {
      ...root,
      children: children.slice(0, splitIndex),
    },
  }
  const tailState = {
    ...state,
    root: {
      ...root,
      children: [
        tailHeading,
        ...children.slice(splitIndex + 1),
      ],
    },
  }

  return {
    title,
    splitIndex,
    headContent: JSON.stringify(headState),
    tailContent: JSON.stringify(tailState),
  }
}

export function getProjectProgress(workspace, projectMeta = {}) {
  const totalWords = Number(workspace?.totalWords) || 0
  const targetWords = Math.max(0, Number(projectMeta?.targetWords) || 0)
  const allNotes = (workspace?.volumes || []).flatMap(volume => volume.notes || [])
  const completed = allNotes.filter(note => note.status === 'done').length
  const totalChapters = allNotes.length

  return {
    totalWords,
    targetWords,
    wordProgress: targetWords > 0
      ? Math.max(0, Math.min(100, Math.round((totalWords / targetWords) * 100)))
      : 0,
    completed,
    totalChapters,
    chapterProgress: totalChapters > 0
      ? Math.round((completed / totalChapters) * 100)
      : 0,
  }
}

export function getRecentProjectActivity(workspace, limit = 6) {
  return (workspace?.volumes || [])
    .flatMap(volume => (volume.notes || []).map(note => ({
      ...note,
      volumeId: volume.id,
      volumeTitle: volume.title,
    })))
    .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
    .slice(0, Math.max(1, Number(limit) || 6))
}

export function getProjectChapterSummary(note, projectMeta = {}, maxLength = 96) {
  const manual = String(projectMeta?.summaries?.[note?.id] || '').trim()
  if (manual) return manual

  const fallback = extractLexicalProjectText(note?.content || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!fallback) return '还没有摘要。'
  const limit = Math.max(24, Number(maxLength) || 96)
  return fallback.length > limit
    ? fallback.slice(0, limit).trimEnd() + '…'
    : fallback
}

function extractLexicalProjectText(content) {
  let state
  try {
    state = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    return String(content || '')
  }

  const collect = node => {
    if (!node) return ''
    if (node.type === 'text') return String(node.text || '')
    if (node.type === 'code-block') return String(node.code || '')
    if (node.type === 'todo') return String(node.text || '')
    if (node.type === 'wiki-link') return String(node.title || '')
    return (node.children || []).map(collect).join(' ')
  }

  return (state?.root?.children || [])
    .map(collect)
    .filter(Boolean)
    .join(' ')
}

export function getProjectTemplate(type = 'novel') {
  if (type === 'script') {
    return {
      id: 'script',
      label: '剧本项目模板',
      targetWords: 30000,
      folders: [
        { key: 'act-1', title: '第一集' },
      ],
      notes: [
        { title: '剧集总纲.md', parentKey: '', role: 'support', content: '# 剧集总纲\n\n## 核心冲突\n\n## 主线推进\n\n## 角色弧光\n' },
        { title: '角色表.md', parentKey: '', role: 'support', content: '# 角色表\n\n## 主要角色\n\n## 关系变化\n' },
        { title: '场景表.md', parentKey: '', role: 'support', content: '# 场景表\n\n## 常用场景\n\n## 视觉锚点\n' },
        { title: '伏笔清单.md', parentKey: '', role: 'support', content: '# 伏笔清单\n\n## 已埋\n\n## 待回收\n' },
        { title: '第一场.md', parentKey: 'act-1', content: '# 第一场\n\n## 场景目标\n\n## 动作与对白\n' },
      ],
    }
  }

  return {
    id: 'novel',
    label: '小说项目模板',
    targetWords: 500000,
    folders: [
      { key: 'volume-1', title: '第一卷' },
    ],
    notes: [
      { title: '作品总纲.md', parentKey: '', role: 'support', content: '# 作品总纲\n\n## 核心命题\n\n## 主线\n\n## 终局\n' },
      { title: '人物设定.md', parentKey: '', role: 'support', content: '# 人物设定\n\n## 主角\n\n## 重要配角\n' },
      { title: '世界观.md', parentKey: '', role: 'support', content: '# 世界观\n\n## 地域\n\n## 力量体系\n\n## 社会规则\n' },
      { title: '伏笔清单.md', parentKey: '', role: 'support', content: '# 伏笔清单\n\n## 已埋\n\n## 待回收\n' },
      { title: '第一章.md', parentKey: 'volume-1', content: '# 第一章\n\n' },
    ],
  }
}

export function getProjectIndexAliases() {
  return {
    characters: ['角色', '人物', 'character', 'characters'],
    locations: ['地点', '场景', 'location', 'locations'],
    foreshadows: ['伏笔', '线索', 'foreshadow', 'foreshadows'],
  }
}

export function getVolumeExportIds(volume) {
  return (volume?.notes || []).map(note => note.id).filter(Boolean)
}

export function getProjectExportIds(workspace) {
  return (workspace?.volumes || [])
    .flatMap(volume => getVolumeExportIds(volume))
}
