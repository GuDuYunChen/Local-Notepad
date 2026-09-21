const RECENT_REFERENCES_KEY = 'localNotepad.recentReferences.v1'

export function normalizeSectionPath(path) {
  return (Array.isArray(path) ? path : [])
    .map(value => String(value || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

export function formatSectionPath(path) {
  return normalizeSectionPath(path).join(' › ')
}

export function formatWikiReferenceText(title, sectionPath = []) {
  const noteTitle = String(title || '').trim() || '未命名'
  const section = formatSectionPath(sectionPath)
  return section ? '[[' + noteTitle + '#' + section + ']]' : '[[' + noteTitle + ']]'
}

export function extractHeadingReferences(content) {
  let state
  try {
    state = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    return []
  }

  const children = state?.root?.children
  if (!Array.isArray(children)) return []

  const stack = []
  const results = []

  for (const node of children) {
    if (node?.type !== 'heading') continue

    const tag = String(node.tag || '')
    const level = Math.max(1, Math.min(6, Number(tag.replace('h', '')) || Number(node.level) || 1))
    const text = collectNodeText(node).trim().replace(/\s+/g, ' ') || '未命名标题'

    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    stack.push({ level, text })
    results.push({
      level,
      text,
      path: stack.map(item => item.text),
    })
  }

  return results
}

export function findWikiLinkOccurrences(content, targetId) {
  const id = String(targetId || '').trim()
  if (!id) return []

  let state
  try {
    state = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    return []
  }

  const children = state?.root?.children
  if (!Array.isArray(children)) return []

  const stack = []
  const results = []

  const visit = (node, sourceSectionPath) => {
    if (!node) return

    if (node.type === 'wiki-link' && String(node.id || '') === id) {
      results.push({
        sourceSectionPath: normalizeSectionPath(sourceSectionPath),
        targetSectionPath: normalizeSectionPath(node.sectionPath),
        title: String(node.title || ''),
      })
    }

    for (const child of node.children || []) {
      visit(child, sourceSectionPath)
    }
  }

  for (const node of children) {
    if (node?.type === 'heading') {
      const tag = String(node.tag || '')
      const level = Math.max(1, Math.min(6, Number(tag.replace('h', '')) || Number(node.level) || 1))
      const text = collectNodeText(node).trim().replace(/\s+/g, ' ') || '未命名标题'

      while (stack.length && stack[stack.length - 1].level >= level) {
        stack.pop()
      }
      stack.push({ level, text })
    }

    visit(node, stack.map(item => item.text))
  }

  return results
}

function collectNodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return String(node.text || '')
  if (node.type === 'wiki-link') return String(node.title || '')
  return (node.children || []).map(collectNodeText).join('')
}

function recentKey(reference) {
  return [
    String(reference?.id || ''),
    ...normalizeSectionPath(reference?.sectionPath),
  ].join('\u001f')
}

export function getRecentReferences(limit = 8) {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_REFERENCES_KEY) || '[]')
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter(item => item?.id && item?.title)
      .map(item => ({
        id: String(item.id),
        title: String(item.title),
        sectionPath: normalizeSectionPath(item.sectionPath),
        usedAt: Number(item.usedAt) || 0,
      }))
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(0, Math.max(1, Number(limit) || 8))
  } catch {
    return []
  }
}

export function rememberReference(reference, limit = 12) {
  if (!reference?.id || !reference?.title) return

  const nextReference = {
    id: String(reference.id),
    title: String(reference.title),
    sectionPath: normalizeSectionPath(reference.sectionPath),
    usedAt: Date.now(),
  }

  const key = recentKey(nextReference)
  const existing = getRecentReferences(Math.max(20, Number(limit) || 12))
    .filter(item => recentKey(item) !== key)

  const next = [nextReference, ...existing].slice(0, Math.max(1, Number(limit) || 12))

  try {
    localStorage.setItem(RECENT_REFERENCES_KEY, JSON.stringify(next))
  } catch {
    // Recent-reference history is optional and must never block editing.
  }
}
