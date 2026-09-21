export function compareLibraryItems(a, b) {
  const pinnedDelta = Number(Boolean(b?.is_pinned)) - Number(Boolean(a?.is_pinned))
  if (pinnedDelta !== 0) return pinnedDelta

  const sortDelta = Number(b?.sort_order || 0) - Number(a?.sort_order || 0)
  if (sortDelta !== 0) return sortDelta

  const createdDelta = Number(b?.created_at || 0) - Number(a?.created_at || 0)
  if (createdDelta !== 0) return createdDelta

  return String(b?.id || '').localeCompare(String(a?.id || ''))
}

export function buildLibraryTree(flatItems) {
  const map = {}
  const roots = []

  for (const item of Array.isArray(flatItems) ? flatItems : []) {
    map[item.id] = { ...item, children: [] }
  }

  for (const item of Array.isArray(flatItems) ? flatItems : []) {
    const node = map[item.id]
    if (!node) continue

    if (item.parent_id && map[item.parent_id]) {
      map[item.parent_id].children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortRecursive = nodes => {
    nodes.sort(compareLibraryItems)
    for (const node of nodes) sortRecursive(node.children)
  }

  sortRecursive(roots)
  return roots
}

export function findFirstFileInTree(nodes) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node.is_folder) return node
    const nested = findFirstFileInTree(node.children)
    if (nested) return nested
  }
  return null
}

export function findFirstFileInFolder(tree, folderId) {
  let target = null

  const visit = nodes => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (node.id === folderId) {
        target = node
        return
      }

      visit(node.children)
      if (target) return
    }
  }

  visit(tree)

  if (!target?.children?.length) return null
  return findFirstFileInTree(target.children)
}

export function getFolderPathLabel(items, folderId) {
  if (!folderId) return '根目录'

  const byId = new Map((Array.isArray(items) ? items : []).map(item => [item.id, item]))
  const parts = []
  let current = byId.get(folderId)
  const seen = new Set()

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(current.title)
    current = current.parent_id ? byId.get(current.parent_id) : null
  }

  return parts.join(' / ') || '根目录'
}
