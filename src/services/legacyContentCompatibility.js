function normalizeTextBreakNode(node) {
  const text = String(node?.text || '')
  if (!/<br\s*\/?>/i.test(text)) return [node]

  const parts = text.split(/(<br\s*\/?>)/gi).filter(Boolean)
  return parts.map(part => {
    if (/^<br\s*\/?>$/i.test(part)) {
      return {
        type: 'linebreak',
        version: 1,
      }
    }

    return {
      ...node,
      text: part,
    }
  })
}

export function normalizeLegacyTableBreakMarkup(content) {
  const source = String(content || '')
  if (!source || !source.includes('<br')) return source

  let state
  try {
    state = JSON.parse(source)
  } catch {
    return source
  }

  let changed = false

  const visit = (node, insideTableCell = false) => {
    if (!node || typeof node !== 'object') return

    const inCell = insideTableCell || node.type === 'tablecell'
    if (!Array.isArray(node.children)) return

    const nextChildren = []

    for (const child of node.children) {
      if (
        inCell &&
        child?.type === 'text' &&
        /<br\s*\/?>/i.test(String(child.text || ''))
      ) {
        nextChildren.push(...normalizeTextBreakNode(child))
        changed = true
        continue
      }

      visit(child, inCell)
      nextChildren.push(child)
    }

    if (changed || nextChildren.some((child, index) => child !== node.children[index])) {
      node.children = nextChildren
    }
  }

  visit(state.root, false)
  return changed ? JSON.stringify(state) : source
}
