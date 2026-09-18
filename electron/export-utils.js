import fs from 'node:fs'
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


export function headingLevel(node) {
  const tag = String(node?.tag || '')
  const fromTag = /^h([1-6])$/.exec(tag)
  if (fromTag) return Number(fromTag[1])

  const level = Number(node?.level)
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1
}

export function plainTextFromNode(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'linebreak') return '\n'
  if (node.type === 'code-block') return codeBlockText(node)
  if (node.type === 'todo') return node.text || ''
  if (node.type === 'wiki-link') return node.title ? `[[${node.title}]]` : ''
  if (!Array.isArray(node.children)) return ''
  return node.children.map(plainTextFromNode).join('')
}


export function listItemText(item) {
  if (!item || !Array.isArray(item.children)) return ''
  return item.children
    .filter(child => child?.type !== 'list')
    .map(child => plainTextFromNode(child))
    .filter(Boolean)
    .join(' ')
}


function isLocalHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

export function isLocalUploadUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) &&
      isLocalHost(url.hostname) &&
      url.pathname.startsWith('/uploads/')
  } catch {
    return false
  }
}

function mimeFromSource(src) {
  const pathname = (() => {
    try { return new URL(src).pathname } catch { return src }
  })().toLowerCase()

  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.bmp')) return 'image/bmp'
  if (pathname.endsWith('.ico')) return 'image/x-icon'
  return 'image/jpeg'
}

export async function localUploadToDataUri(src, fetchImpl = globalThis.fetch) {
  if (!isLocalUploadUrl(src)) return src

  try {
    const response = await fetchImpl(src)
    if (!response?.ok) return src

    const bytes = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers?.get?.('content-type')?.split(';')[0]?.trim()
    const mime = contentType || mimeFromSource(src)
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return src
  }
}

export async function embedLocalImagesInLexical(content, fetchImpl = globalThis.fetch) {
  let state
  try {
    state = JSON.parse(content || '')
  } catch {
    return content
  }

  const rewrite = async (src) => {
    if (!src || String(src).startsWith('data:')) return src
    return localUploadToDataUri(src, fetchImpl)
  }

  const walk = async (node) => {
    if (!node) return

    if (node.type === 'image') {
      node.src = await rewrite(node.src)
    } else if (node.type === 'image-grid') {
      for (const item of node.items || []) {
        item.src = await rewrite(item.src)
      }
    } else if (node.type === 'video' && node.poster) {
      node.poster = await rewrite(node.poster)
    }

    for (const child of node.children || []) {
      await walk(child)
    }
  }

  await walk(state.root)
  return JSON.stringify(state)
}


function safeAssetFilename(src, index = 0) {
  try {
    const url = new URL(src)
    const raw = decodeURIComponent(path.basename(url.pathname))
    const safe = raw.replace(/[\\/:*?"<>|]/g, '_')
    return safe || `asset-${index + 1}`
  } catch {
    return `asset-${index + 1}`
  }
}

export async function materializeLocalAssetsInLexical(
  content,
  outputDir,
  assetDirName,
  fetchImpl = globalThis.fetch
) {
  let state
  try {
    state = JSON.parse(content || '')
  } catch {
    return content
  }

  const assetDir = path.join(outputDir, assetDirName)
  const written = new Map()
  let assetIndex = 0

  const rewrite = async (src) => {
    if (!isLocalUploadUrl(src)) return src
    if (written.has(src)) return written.get(src)

    try {
      const response = await fetchImpl(src)
      if (!response?.ok) return src

      fs.mkdirSync(assetDir, { recursive: true })
      let filename = safeAssetFilename(src, assetIndex++)
      let target = path.join(assetDir, filename)
      let suffix = 1
      const ext = path.extname(filename)
      const stem = ext ? filename.slice(0, -ext.length) : filename

      while (fs.existsSync(target)) {
        filename = `${stem}-${suffix++}${ext}`
        target = path.join(assetDir, filename)
      }

      fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()))
      const relative = `./${assetDirName}/${filename}`.replace(/\\/g, '/')
      written.set(src, relative)
      return relative
    } catch {
      return src
    }
  }

  const walk = async (node) => {
    if (!node) return
    if (node.type === 'image') {
      node.src = await rewrite(node.src)
    } else if (node.type === 'image-grid') {
      for (const item of node.items || []) {
        item.src = await rewrite(item.src)
      }
    } else if (node.type === 'video') {
      node.src = await rewrite(node.src)
      if (node.poster) node.poster = await rewrite(node.poster)
    }

    for (const child of node.children || []) {
      await walk(child)
    }
  }

  await walk(state.root)
  return JSON.stringify(state)
}
