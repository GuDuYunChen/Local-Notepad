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


function getTargetById(targets, id) {
  if (!targets) return null
  if (targets instanceof Map) return targets.get(id) || null
  return targets[id] || null
}

function sameSectionPath(left, right) {
  const a = normalizeSectionPath(left)
  const b = normalizeSectionPath(right)
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sectionRepairForTarget(target, sectionPath) {
  const storedPath = normalizeSectionPath(sectionPath)
  if (!storedPath.length) {
    return {
      valid: true,
      repairable: false,
      nextPath: [],
      candidates: [],
    }
  }

  const headings = extractHeadingReferences(target?.content || '')
  const exact = headings.find(item => sameSectionPath(item.path, storedPath))
  if (exact) {
    return {
      valid: true,
      repairable: false,
      nextPath: storedPath,
      candidates: [exact.path],
    }
  }

  const leaf = storedPath[storedPath.length - 1]
  const candidates = headings
    .filter(item => item.text === leaf)
    .map(item => item.path)

  if (candidates.length === 1) {
    return {
      valid: false,
      repairable: true,
      nextPath: candidates[0],
      candidates,
    }
  }

  return {
    valid: false,
    repairable: false,
    nextPath: storedPath,
    candidates,
  }
}

export function collectWikiReferences(content) {
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
  let ordinal = 0

  const visit = (node, sourceSectionPath) => {
    if (!node) return

    if (node.type === 'wiki-link' && node.id) {
      results.push({
        key: String(node.key || '') || ('reference-' + ordinal),
        ordinal: ordinal++,
        id: String(node.id || ''),
        title: String(node.title || ''),
        sectionPath: normalizeSectionPath(node.sectionPath),
        sourceSectionPath: normalizeSectionPath(sourceSectionPath),
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

export function analyzeWikiReferenceHealth(content, targets) {
  return collectWikiReferences(content).map(reference => {
    const target = getTargetById(targets, reference.id)

    if (!target || target.is_deleted) {
      return {
        ...reference,
        target: null,
        status: 'broken',
        repairable: false,
        issues: ['target-missing'],
        suggestedSectionPath: reference.sectionPath,
      }
    }

    const titleStale = String(reference.title || '') !== String(target.title || '')
    const section = sectionRepairForTarget(target, reference.sectionPath)
    const issues = []

    if (titleStale) issues.push('title-stale')
    if (!section.valid) {
      issues.push(section.repairable ? 'section-moved' : 'section-missing')
    }

    return {
      ...reference,
      target: {
        id: String(target.id || reference.id),
        title: String(target.title || reference.title || ''),
      },
      status: issues.length
        ? (titleStale || section.repairable ? 'repairable' : 'broken')
        : 'healthy',
      repairable: titleStale || section.repairable,
      issues,
      suggestedSectionPath: section.repairable
        ? section.nextPath
        : reference.sectionPath,
      sectionCandidates: section.candidates,
    }
  })
}

export function repairWikiReferences(content, targets) {
  let state
  try {
    state = typeof content === 'string' ? JSON.parse(content) : structuredClone(content)
  } catch {
    return {
      content: String(content || ''),
      changed: false,
      repairedCount: 0,
      unresolvedCount: 0,
    }
  }

  let repairedCount = 0
  let unresolvedCount = 0

  const walk = node => {
    if (!node || typeof node !== 'object') return

    if (node.type === 'wiki-link' && node.id) {
      const target = getTargetById(targets, String(node.id))
      if (!target || target.is_deleted) {
        unresolvedCount += 1
      } else {
        let changedNode = false
        const targetTitle = String(target.title || '')
        if (targetTitle && String(node.title || '') !== targetTitle) {
          node.title = targetTitle
          changedNode = true
        }

        const section = sectionRepairForTarget(target, node.sectionPath)
        if (!section.valid) {
          if (section.repairable) {
            node.sectionPath = section.nextPath
            changedNode = true
          } else {
            unresolvedCount += 1
          }
        }

        if (changedNode) repairedCount += 1
      }
    }

    for (const child of node.children || []) walk(child)
  }

  walk(state?.root)

  return {
    content: JSON.stringify(state),
    changed: repairedCount > 0,
    repairedCount,
    unresolvedCount,
  }
}
