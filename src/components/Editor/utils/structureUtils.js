function parseState(content) {
  try {
    const state = typeof content === 'string'
      ? JSON.parse(content)
      : structuredClone(content)
    if (!state?.root || !Array.isArray(state.root.children)) return null
    return state
  } catch {
    return null
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function headingLevel(node) {
  if (node?.type !== 'heading') return null
  const value = Number(String(node.tag || '').replace(/^h/i, '')) || Number(node.level)
  if (!Number.isFinite(value)) return null
  return Math.max(1, Math.min(6, value))
}

function nodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return String(node.text || '')
  if (node.type === 'wiki-link') return String(node.title || '')
  return (node.children || []).map(nodeText).join('')
}

function pathKey(path) {
  return (Array.isArray(path) ? path : [])
    .map(value => String(value || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\u001f')
}

function sectionEnd(children, startIndex, level) {
  for (let index = startIndex + 1; index < children.length; index++) {
    const nextLevel = headingLevel(children[index])
    if (nextLevel !== null && nextLevel <= level) return index
  }
  return children.length
}

function buildFlatSections(state) {
  const children = state?.root?.children || []
  const stack = []
  const flat = []

  for (let index = 0; index < children.length; index++) {
    const level = headingLevel(children[index])
    if (level === null) continue

    const text = nodeText(children[index]).trim().replace(/\s+/g, ' ') || '未命名标题'

    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    const parent = stack[stack.length - 1] || null
    const path = [...(parent?.path || []), text]
    const id = 'section:' + index + ':' + level + ':' + encodeURIComponent(text)

    const section = {
      id,
      index,
      startIndex: index,
      endIndex: sectionEnd(children, index, level),
      level,
      text,
      path,
      parentId: parent?.id || '',
      childIds: [],
    }

    flat.push(section)
    if (parent) parent.childIds.push(id)
    stack.push(section)
  }

  return flat
}

export function buildLongFormStructure(content) {
  const state = parseState(content)
  if (!state) {
    return {
      valid: false,
      sections: [],
      roots: [],
      counts: { volumes: 0, chapters: 0, scenes: 0, headings: 0 },
    }
  }

  const sections = buildFlatSections(state)
  const byId = new Map(sections.map(section => [section.id, section]))
  const roots = sections
    .filter(section => !section.parentId)
    .map(section => buildTreeNode(section, byId))

  return {
    valid: true,
    sections,
    roots,
    counts: {
      volumes: sections.filter(section => section.level === 1).length,
      chapters: sections.filter(section => section.level === 2).length,
      scenes: sections.filter(section => section.level === 3).length,
      headings: sections.length,
    },
  }
}

function buildTreeNode(section, byId) {
  return {
    ...section,
    children: section.childIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(child => buildTreeNode(child, byId)),
  }
}

export function findStructureSectionByPath(content, path) {
  const key = pathKey(path)
  if (!key) return null
  return buildLongFormStructure(content).sections
    .find(section => pathKey(section.path) === key) || null
}

export function getStructureSiblings(content, sectionId) {
  const structure = buildLongFormStructure(content)
  const section = structure.sections.find(item => item.id === sectionId)
  if (!section) return []

  return structure.sections.filter(item => (
    item.level === section.level &&
    item.parentId === section.parentId
  ))
}

export function moveStructureSection(content, sourceId, targetId, position = 'before') {
  const state = parseState(content)
  if (!state) return { content: String(content || ''), changed: false }

  const structure = buildLongFormStructure(state)
  const source = structure.sections.find(item => item.id === sourceId)
  const target = structure.sections.find(item => item.id === targetId)

  if (
    !source ||
    !target ||
    source.id === target.id ||
    source.level !== target.level ||
    source.parentId !== target.parentId
  ) {
    return { content: JSON.stringify(state), changed: false }
  }

  const children = state.root.children
  const sourceHeading = children[source.startIndex]
  const targetHeading = children[target.startIndex]
  const block = children.splice(
    source.startIndex,
    source.endIndex - source.startIndex,
  )

  const targetIndex = children.indexOf(targetHeading)
  if (targetIndex < 0) {
    return { content: JSON.stringify(state), changed: false }
  }

  let insertIndex = targetIndex
  if (position === 'after') {
    insertIndex = sectionEnd(children, targetIndex, target.level)
  }

  children.splice(insertIndex, 0, ...block)

  return {
    content: JSON.stringify(state),
    changed: children.indexOf(sourceHeading) !== source.startIndex,
  }
}

export function moveStructureSectionAdjacent(content, sectionId, direction) {
  const siblings = getStructureSiblings(content, sectionId)
  const index = siblings.findIndex(item => item.id === sectionId)
  if (index < 0) return { content: String(content || ''), changed: false }

  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= siblings.length) {
    return { content: String(content || ''), changed: false }
  }

  return moveStructureSection(
    content,
    sectionId,
    siblings[targetIndex].id,
    direction === 'up' ? 'before' : 'after',
  )
}

export function mergeStructureSectionWithPrevious(content, sectionId) {
  const state = parseState(content)
  if (!state) {
    return {
      content: String(content || ''),
      changed: false,
      mappings: [],
      previous: null,
    }
  }

  const structure = buildLongFormStructure(state)
  const section = structure.sections.find(item => item.id === sectionId)
  if (!section) {
    return {
      content: JSON.stringify(state),
      changed: false,
      mappings: [],
      previous: null,
    }
  }

  const siblings = structure.sections.filter(item => (
    item.level === section.level &&
    item.parentId === section.parentId
  ))
  const siblingIndex = siblings.findIndex(item => item.id === section.id)
  const previous = siblingIndex > 0 ? siblings[siblingIndex - 1] : null
  if (!previous) {
    return {
      content: JSON.stringify(state),
      changed: false,
      mappings: [],
      previous: null,
    }
  }

  const descendants = structure.sections.filter(item => (
    item.startIndex >= section.startIndex &&
    item.startIndex < section.endIndex
  ))

  const mappings = descendants.map(item => {
    const suffix = item.path.slice(section.path.length)
    return {
      before: item.path,
      after: [...previous.path, ...suffix],
    }
  })

  state.root.children.splice(section.startIndex, 1)

  return {
    content: JSON.stringify(state),
    changed: true,
    mappings,
    previous: {
      id: previous.id,
      text: previous.text,
      path: [...previous.path],
    },
  }
}

export function extractStructureSection(content, sectionPath) {
  const state = parseState(content)
  if (!state) {
    return {
      changed: false,
      sourceContent: String(content || ''),
      extractedContent: '',
      section: null,
    }
  }

  const structure = buildLongFormStructure(state)
  const key = pathKey(sectionPath)
  const section = structure.sections.find(item => pathKey(item.path) === key)
  if (!section) {
    return {
      changed: false,
      sourceContent: JSON.stringify(state),
      extractedContent: '',
      section: null,
    }
  }

  const byId = new Map(structure.sections.map(item => [item.id, item]))
  const ancestors = []
  let parentId = section.parentId
  while (parentId) {
    const parent = byId.get(parentId)
    if (!parent) break
    ancestors.unshift(parent)
    parentId = parent.parentId
  }

  const sourceChildren = state.root.children
  const extractedBlock = sourceChildren
    .slice(section.startIndex, section.endIndex)
    .map(clone)
  const ancestorHeadings = ancestors
    .map(item => clone(sourceChildren[item.startIndex]))

  const extractedState = clone(state)
  extractedState.root.children = [
    ...ancestorHeadings,
    ...extractedBlock,
  ]

  sourceChildren.splice(
    section.startIndex,
    section.endIndex - section.startIndex,
  )

  return {
    changed: true,
    sourceContent: JSON.stringify(state),
    extractedContent: JSON.stringify(extractedState),
    section: {
      text: section.text,
      level: section.level,
      path: [...section.path],
      parentPath: section.path.slice(0, -1),
    },
  }
}

function pathStartsWith(path, prefix) {
  const value = Array.isArray(path) ? path : []
  const start = Array.isArray(prefix) ? prefix : []
  return (
    value.length >= start.length &&
    start.every((part, index) => String(value[index] || '') === String(part || ''))
  )
}

export function rewriteSectionTargetReferences(
  content,
  sourceTargetId,
  sectionPathPrefix,
  targetId,
  targetTitle,
) {
  const state = parseState(content)
  if (!state) {
    return {
      content: String(content || ''),
      changed: false,
      rewrittenCount: 0,
    }
  }

  let rewrittenCount = 0

  const walk = node => {
    if (!node || typeof node !== 'object') return

    if (
      node.type === 'wiki-link' &&
      String(node.id || '') === String(sourceTargetId || '') &&
      pathStartsWith(node.sectionPath, sectionPathPrefix)
    ) {
      node.id = String(targetId || '')
      node.title = String(targetTitle || node.title || '')
      rewrittenCount += 1
    }

    for (const child of node.children || []) walk(child)
  }

  walk(state.root)

  return {
    content: JSON.stringify(state),
    changed: rewrittenCount > 0,
    rewrittenCount,
  }
}

export function planSectionExtractionImpact(
  files,
  sourceTargetId,
  sectionPathPrefix,
  targetTitle,
) {
  const notes = (Array.isArray(files) ? files : [])
    .filter(file => file && !file.is_folder && !file.is_deleted && !String(file.title || '').startsWith('__tpl__'))

  const sources = []
  let incomingReferences = 0

  for (const file of notes) {
    let state
    try {
      state = typeof file.content === 'string'
        ? JSON.parse(file.content)
        : file.content
    } catch {
      continue
    }

    const matches = []

    const walk = node => {
      if (!node || typeof node !== 'object') return

      if (
        node.type === 'wiki-link' &&
        String(node.id || '') === String(sourceTargetId || '') &&
        pathStartsWith(node.sectionPath, sectionPathPrefix)
      ) {
        const sectionPath = Array.isArray(node.sectionPath)
          ? [...node.sectionPath]
          : []
        matches.push({
          ordinal: matches.length,
          before: '[[' + String(node.title || '') +
            (sectionPath.length ? '#' + sectionPath.join(' › ') : '') + ']]',
          after: '[[' + String(targetTitle || '') +
            (sectionPath.length ? '#' + sectionPath.join(' › ') : '') + ']]',
          sectionPath,
        })
      }

      for (const child of node.children || []) walk(child)
    }

    walk(state?.root)

    if (!matches.length) continue

    incomingReferences += matches.length
    sources.push({
      id: String(file.id || ''),
      title: String(file.title || '未命名'),
      content: String(file.content || ''),
      incomingReferences: matches.length,
      changes: matches,
    })
  }

  return {
    summary: {
      incomingReferences,
      affectedFiles: sources.length,
      repairable: incomingReferences,
      broken: 0,
    },
    sources,
  }
}
