import path from 'node:path'

export function safeExportStem(title) {
  const safeTitle = String(title || 'Untitled').replace(/[\\/:*?"<>|]/g, '_')
  const ext = path.extname(safeTitle)
  const stem = ext ? safeTitle.slice(0, -ext.length) : safeTitle
  return stem || 'Untitled'
}

export function codeBlockText(node) {
  if (!node) return ''
  if (typeof node.code === 'string') return node.code
  if (!Array.isArray(node.children)) return ''
  return node.children.map(child => child?.text || '').join('')
}

export async function fetchAllFileMetadata(fetchImpl = fetch, baseUrl = process.env.API_BASE || 'http://127.0.0.1:27121') {
  const files = []
  const seen = new Set()
  const pageSize = 200

  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      size: String(pageSize),
      compact: '1',
    })
    const res = await fetchImpl(`${baseUrl}/api/files?${params.toString()}`)
    if (!res.ok) throw new Error(`Fetch file list failed: ${res.statusText}`)

    const body = await res.json()
    if (body.code !== 0) {
      throw new Error(body.detail || body.message || '读取文件列表失败')
    }

    const batch = Array.isArray(body.data) ? body.data : []
    for (const item of batch) {
      if (!item?.id || seen.has(item.id)) continue
      seen.add(item.id)
      files.push(item)
    }

    if (batch.length < pageSize) break
  }

  return files
}

export function indexChildrenByParent(files) {
  const map = new Map()
  for (const file of files || []) {
    const parentId = file?.parent_id || ''
    if (!map.has(parentId)) map.set(parentId, [])
    map.get(parentId).push(file)
  }
  return map
}
