import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inspectExportContent, renderExportDocument } from './local-export-document.js'
import { LOCAL_EXPORT_LIMITS as LIMIT, LocalExportError, checkExportOperation, exportName, exportStem, assertExportId } from './local-export-policy.js'
export { LOCAL_EXPORT_LIMITS, LocalExportError } from './local-export-policy.js'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const owns = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino && !b.isSymbolicLink()
const error = (code, message) => new LocalExportError(code, message)
const lower = value => value.normalize('NFC').toLocaleLowerCase('en-US')
const FORMAT = new Set(['markdown', 'docx'])

function apiBase(value) {
  let url
  try { url = new URL(value || process.env.API_BASE || 'http://127.0.0.1:27121') } catch { throw error('unavailable', '本地数据服务地址无效。') }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw error('unavailable', '导出仅连接已配置的本机数据服务。')
  return url.origin
}

async function readResponse(url, { signal, deadline, fetchImpl, limit, binary = false }) {
  checkExportOperation(signal, deadline)
  const controller = new AbortController(), abort = () => controller.abort()
  const end = Math.min(deadline, Date.now() + LIMIT.requestTimeoutMs)
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, Math.max(1, end - Date.now())); timer.unref?.()
  let response, reader
  try {
    response = await fetchImpl(url, { method: 'GET', signal: controller.signal, redirect: 'error', headers: { Accept: binary ? '*/*' : 'application/json' } })
    checkExportOperation(signal, deadline)
    if (Date.now() >= end || controller.signal.aborted) throw error('read-timeout', '本地数据读取超过 10 秒，请检查服务后重试。')
    if (!response?.ok) throw error('read-failed', '已保存正文或本地附件读取失败，请检查后重试。')
    const declared = response.headers?.get?.('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw error('too-large', '读取结果超过导出大小限制，未截断。')
    let bytes
    if (response.body?.getReader) {
      reader = response.body.getReader()
      const chunks = []; let length = 0
      while (true) {
        const part = await reader.read()
        checkExportOperation(signal, deadline)
        if (Date.now() >= end || controller.signal.aborted) throw error('read-timeout', '本地数据读取超过 10 秒，请检查服务后重试。')
        if (part.done) break
        length += part.value.byteLength
        if (length > limit) throw error('too-large', '读取结果超过导出大小限制，未截断。')
        chunks.push(Buffer.from(part.value))
      }
      bytes = Buffer.concat(chunks)
    } else if (typeof response.arrayBuffer === 'function') bytes = Buffer.from(await response.arrayBuffer())
    else if (!binary && typeof response.json === 'function') bytes = Buffer.from(JSON.stringify(await response.json()))
    else throw error('invalid-response', '本地数据服务返回的内容无法读取。')
    checkExportOperation(signal, deadline)
    if (Date.now() >= end || controller.signal.aborted) throw error('read-timeout', '本地数据读取超过 10 秒，请检查服务后重试。')
    if (bytes.length > limit) throw error('too-large', '读取结果超过导出大小限制，未截断。')
    if (binary) return { bytes, mime: (response.headers?.get?.('content-type') || '').split(';')[0].trim() }
    let decoded
    try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw error('invalid-response', '本地数据服务返回的 JSON 无效。') }
    if (!decoded || decoded.code !== 0 || !Object.prototype.hasOwnProperty.call(decoded, 'data')) throw error('invalid-response', '本地数据服务未确认读取成功。')
    return decoded.data
  } catch (cause) {
    checkExportOperation(signal, deadline)
    if (cause instanceof LocalExportError) throw cause
    if (controller.signal.aborted || Date.now() >= end) throw error('read-timeout', '本地数据读取超过 10 秒，请检查服务后重试。')
    throw error('read-failed', '本地数据读取失败，请检查数据服务后重试。')
  } finally {
    controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort', abort)
    if (reader) { try { await reader.cancel() } catch {} try { reader.releaseLock() } catch {} }
    else { try { await response?.body?.cancel?.() } catch {} }
  }
}

async function metadata(options) {
  const all = [], seen = new Set()
  for (let page = 1; page <= LIMIT.metadata / LIMIT.pageSize + 1; page++) {
    const batch = await readResponse(`${options.baseURL}/api/files?page=${page}&size=${LIMIT.pageSize}&compact=1`, { ...options, limit: LIMIT.responseBytes })
    if (!Array.isArray(batch) || batch.length > LIMIT.pageSize) throw error('invalid-metadata', '完整目录读取失败，未使用部分目录。')
    for (const item of batch) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.title !== 'string' || item.title.length > 2000 || typeof item.is_folder !== 'boolean' || typeof item.parent_id !== 'string' || item.is_deleted === true) throw error('invalid-metadata', '目录项目无效，请刷新后重新预览。')
      assertExportId(item.id); if (item.parent_id) assertExportId(item.parent_id)
      if (seen.has(item.id)) throw error('invalid-metadata', '目录读取包含重复项目，未使用不完整列表。')
      seen.add(item.id); all.push({ id: item.id, title: item.title, parent_id: item.parent_id, is_folder: item.is_folder })
      if (all.length > LIMIT.metadata) throw error('too-large', '目录超过 10,000 项，请缩小资料库后重试。')
    }
    if (batch.length < LIMIT.pageSize) return all
  }
  throw error('too-large', '目录超过读取预算，未使用部分目录。')
}

function selection(files, ids, format) {
  const byId = new Map(files.map(file => [file.id, file])), children = new Map(), selected = new Set(ids)
  for (const file of files) {
    if (!children.has(file.parent_id)) children.set(file.parent_id, [])
    children.get(file.parent_id).push(file)
  }
  const roots = ids.filter(id => {
    let item = byId.get(id), depth = 0; const visited = new Set()
    if (!item) throw error('missing-note', '所选笔记已不在完整目录中，请重新选择。')
    while (item.parent_id) {
      if (++depth > LIMIT.depth || visited.has(item.parent_id)) throw error('invalid-metadata', '所选目录存在循环或层级过深。')
      visited.add(item.parent_id)
      if (selected.has(item.parent_id)) return false
      item = byId.get(item.parent_id)
      if (!item || !item.is_folder) throw error('invalid-metadata', '所选笔记的父目录不完整，请重新选择。')
    }
    return true
  })
  const names = new Map(), notes = [], seen = new Set(), extension = format === 'docx' ? '.docx' : '.md'
  const allocate = (directory, title, folder) => {
    if (!names.has(directory)) names.set(directory, new Set())
    const set = names.get(directory), base = folder ? exportName(title) : exportStem(title)
    let stem = base, suffix = 2
    while (set.has(lower(folder ? stem : stem + extension)) || (!folder && set.has(lower(stem + '_assets')))) stem = `${base} (${suffix++})`
    set.add(lower(folder ? stem : stem + extension)); if (!folder) set.add(lower(stem + '_assets'))
    return { name: folder ? stem : stem + extension, assets: stem + '_assets' }
  }
  const visit = (file, directory, ancestors) => {
    if (ancestors.size >= LIMIT.depth || ancestors.has(file.id)) throw error('invalid-metadata', '所选目录存在循环或层级过深。')
    if (seen.has(file.id)) return
    seen.add(file.id)
    const name = allocate(directory, file.title, file.is_folder), relativePath = directory ? `${directory}/${name.name}` : name.name
    if (relativePath.length > 180) throw error('path-too-long', '导出路径超过 180 个字符，请减少目录层级或缩短标题。')
    if (file.is_folder) {
      const next = new Set(ancestors); next.add(file.id)
      for (const child of children.get(file.id) || []) visit(child, relativePath, next)
    } else {
      notes.push({ ...file, relativePath, assetDirectory: name.assets })
      if (notes.length > LIMIT.notes) throw error('too-many-notes', '每批最多导出 100 篇笔记，请缩小所选范围。')
    }
  }
  for (const id of roots) visit(byId.get(id), '', new Set())
  if (!notes.length) throw error('empty-selection', '所选范围没有可导出的笔记。')
  return notes
}

export async function prepareExportPlan({ ids, format, signal, deadline = Date.now() + LIMIT.timeoutMs, fetchImpl = globalThis.fetch, baseURL } = {}) {
  if (!FORMAT.has(format) || !Array.isArray(ids) || !ids.length || ids.length > LIMIT.roots || new Set(ids).size !== ids.length) throw error('invalid-request', '请选择 1–100 个不同项目，以及 Word 或 Markdown 格式。')
  ids.forEach(assertExportId)
  const options = { signal, deadline, fetchImpl, baseURL: apiBase(baseURL) }
  checkExportOperation(signal, deadline)
  const items = selection(await metadata(options), ids, format)
  let total = 0
  for (const item of items) {
    try {
      const file = await readResponse(`${options.baseURL}/api/files/${encodeURIComponent(item.id)}`, { ...options, limit: LIMIT.responseBytes })
      if (!file || file.id !== item.id || file.title !== item.title || file.parent_id !== item.parent_id || file.is_folder !== false || file.is_deleted === true || typeof file.content !== 'string') throw error('source-changed', '笔记身份或目录已变化，请重新预览。')
      total += Buffer.byteLength(file.content, 'utf8')
      if (total > LIMIT.batchContentBytes) throw error('too-large', '本批已保存正文合计超过 8 MiB，请减少所选笔记。')
      item.snapshot = inspectExportContent(file.content, format)
      if (!item.title) item.title = '未命名'
      item.preview = item.snapshot.preview; item.warnings = item.snapshot.warnings; item.status = 'ready'; item.message = '已保存正文已读取，等待导出。'
    } catch (cause) {
      if (cause instanceof LocalExportError && !['cancelled', 'timeout'].includes(cause.code)) throw error(cause.code, `“${item.title.slice(0, 80)}”：${cause.message} 本批未生成预览或导出文件。`)
      throw cause
    }
  }
  checkExportOperation(signal, deadline)
  return { format, createdAt: Date.now(), source: 'saved', state: 'prepared', items, baseURL: options.baseURL, fetchImpl,
    exportDirectory: '', directoryIdentity: null, directories: new Map(), outputAssetBytes: 0, running: false }
}

export function describeExportPlan(plan) {
  const counts = { total: plan.items.length, ready: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 }
  const items = plan.items.map(item => {
    counts[item.status]++
    return { id: item.id, title: item.title, relativePath: item.relativePath, preview: item.preview, status: item.status,
      message: item.message, warnings: [...item.warnings], ...(item.code ? { code: item.code } : {}),
      ...(item.receipt ? item.receipt : {}), ...(item.partialPath ? { partialPath: item.partialPath } : {}),
      ...(item.partialPaths?.length ? { partialPaths: [...item.partialPaths] } : {}) }
  })
  return { format: plan.format, createdAt: plan.createdAt, source: 'saved', state: plan.state, exportDirectory: plan.exportDirectory, items, counts }
}

async function assertDirectory(plan, directory) {
  const expected = plan.directories.get(directory)
  const actual = await fs.lstat(directory)
  if (!expected || !actual.isDirectory() || !owns(expected, actual) || await fs.realpath(directory) !== directory) throw error('destination-changed', '导出目录已变化，已停止写入。')
}

async function ensureDirectories(plan, relative, check) {
  let current = plan.exportDirectory
  await assertDirectory(plan, current); check()
  for (const part of relative.split('/').filter(Boolean)) {
    current = path.join(current, part)
    if (!plan.directories.has(current)) {
      check(); await fs.mkdir(current)
      const identity = await fs.lstat(current)
      if (!identity.isDirectory() || identity.isSymbolicLink()) throw error('destination-changed', '新导出目录已变化，未继续写入。')
      plan.directories.set(current, identity)
    }
    await assertDirectory(plan, current); check()
  }
  return current
}

async function readAsset(src, options, budget) {
  if (typeof src !== 'string' || !src || src.length > LIMIT.contentBytes) throw error('invalid-asset', '附件地址无效，未省略附件继续导出。')
  let result
  if (src.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg|gif|bmp|webp|svg\+xml|x-icon));base64,([A-Za-z0-9+/]*={0,2})$/.exec(src)
    if (!match || match[2].length % 4 !== 0) throw error('invalid-asset', '内嵌图片编码无效，未导出不完整文档。')
    const bytes = Buffer.from(match[2], 'base64')
    if (bytes.toString('base64') !== match[2]) throw error('invalid-asset', '内嵌图片编码不规范，未导出。')
    result = { bytes, mime: match[1], name: `image-${hash(bytes).slice(0, 12)}.${match[1].split('/')[1].replace('jpeg', 'jpg').replace('+xml', '')}` }
  } else {
    let url, name
    try {
      url = new URL(src, options.baseURL)
      const base = new URL(options.baseURL)
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== base.port || url.username || url.password || url.hash || url.search || !url.pathname.startsWith('/uploads/')) throw new Error()
      name = decodeURIComponent(url.pathname.slice('/uploads/'.length))
      if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f\x7f]/.test(name) || name.length > 255) throw new Error()
      // Read only from the configured local service, even when an old note used
      // a different loopback spelling. No renderer URL is used as a new origin.
      url = new URL('/uploads/' + encodeURIComponent(name), options.baseURL)
    } catch { throw error('external-asset', '图片或附件不是当前本地附件；请先保存到本机或移除失效资源，再重新预览。未访问外部地址。') }
    result = { ...await readResponse(url.href, { ...options, limit: LIMIT.assetBytes, binary: true }), name }
  }
  checkExportOperation(options.signal, options.deadline)
  if (result.bytes.length > LIMIT.assetBytes || budget.bytes + result.bytes.length > LIMIT.batchAssetBytes) throw error('too-large', '单个附件超过 16 MiB，或本批附件合计超过 64 MiB；未截断附件。')
  budget.bytes += result.bytes.length
  return result
}

async function writeExclusive(filename, bytes, written, plan, check) {
  check(); await assertDirectory(plan, path.dirname(filename)); check()
  let handle
  try {
    handle = await fs.open(filename, 'wx', 0o600)
    const identity = await handle.stat(), record = { filename, identity, bytes }
    written.push(record)
    check(); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null
    // Read-back is needed even when cancellation arrived during a started I/O.
    // It does not start another output write or claim that an abort rolled back.
    const actual = await fs.lstat(filename)
    if (!owns(identity, actual) || actual.size !== bytes.length) throw error('write-unconfirmed', '导出文件写入身份或大小未确认，未记为成功。')
    const read = await fs.readFile(filename)
    if (read.length !== bytes.length || hash(read) !== hash(bytes)) throw error('write-unconfirmed', '导出文件读回校验失败，未记为成功。')
    check()
  } finally { if (handle) { try { await handle.close() } catch {} } }
}

async function cleanupWritten(written) {
  const residualPaths = []
  for (const entry of [...written].reverse()) {
    try {
      const actual = await fs.lstat(entry.filename)
      if (!owns(entry.identity, actual) || !actual.isFile() || actual.size > entry.bytes.length) {
        residualPaths.push(entry.filename); continue
      }
      const bytes = await fs.readFile(entry.filename)
      if (!bytes.equals(entry.bytes.subarray(0, bytes.length))) {
        residualPaths.push(entry.filename); continue
      }
      await fs.unlink(entry.filename)
    } catch (cause) {
      if (cause?.code !== 'ENOENT') residualPaths.push(entry.filename)
    }
  }
  return { complete: residualPaths.length === 0, residualPaths }
}

export async function executeExportPlan(plan, { targetDir, signal, deadline = Date.now() + LIMIT.timeoutMs, onProgress, retryFailed = false } = {}) {
  if (!plan || !FORMAT.has(plan.format) || !Array.isArray(plan.items) || plan.running) throw error('busy', '导出计划无效或仍在执行，请先查回结果。')
  if (retryFailed && plan.items.some(item => item.status === 'failed' && (item.partialPath || item.partialPaths?.length))) {
    throw error('cleanup-incomplete', '部分导出文件仍未确认清理。请先检查每个残留路径并手动处理，再重新预览；系统不会覆盖这些文件。')
  }
  const eligible = plan.items.filter(item => retryFailed ? item.status === 'failed' : ['ready', 'cancelled'].includes(item.status))
  if (!eligible.length) return describeExportPlan(plan)
  if (typeof targetDir !== 'string' || !path.isAbsolute(targetDir) || targetDir.includes('\0')) throw error('invalid-destination', '请选择有效的本地导出目录。')
  const check = () => checkExportOperation(signal, deadline), notify = () => { try { onProgress?.(describeExportPlan(plan)) } catch {} }
  plan.running = true
  const budget = { bytes: plan.outputAssetBytes }
  try {
    check()
    const destination = await fs.realpath(targetDir)
    if (!(await fs.stat(destination)).isDirectory()) throw error('invalid-destination', '所选位置不是目录。')
    if (plan.destination && plan.destination !== destination) throw error('destination-changed', '已经开始的导出不能切换目录，请完成或关闭当前批次。')
    if (!plan.exportDirectory) {
      check(); plan.destination = destination
      plan.exportDirectory = await fs.mkdtemp(path.join(destination, 'Notepad-export-'))
      plan.directoryIdentity = await fs.lstat(plan.exportDirectory)
      plan.directories.set(plan.exportDirectory, plan.directoryIdentity)
    }
    await assertDirectory(plan, plan.exportDirectory); check()
    plan.state = 'running'; notify()
    for (const item of eligible) {
      if (signal?.aborted || Date.now() >= deadline) break
      const written = [], beforeAssets = budget.bytes
      item.status = 'running'; item.message = '正在准备附件并写入文件…'; delete item.code; notify()
      try {
        const rendered = await renderExportDocument(item.snapshot, plan.format, { check, assetDirectory: item.assetDirectory,
          readAsset: src => readAsset(src, { signal, deadline, fetchImpl: plan.fetchImpl, baseURL: plan.baseURL }, budget) })
        check()
        const parentRelative = path.posix.dirname(item.relativePath), parent = await ensureDirectories(plan, parentRelative === '.' ? '' : parentRelative, check)
        for (const asset of rendered.assets) {
          const directory = await ensureDirectories(plan, (parentRelative === '.' ? '' : parentRelative + '/') + item.assetDirectory, check)
          await writeExclusive(path.join(directory, asset.name), asset.bytes, written, plan, check)
        }
        const outputPath = path.join(parent, path.posix.basename(item.relativePath))
        await writeExclusive(outputPath, rendered.bytes, written, plan, check)
        item.receipt = { outputPath, bytes: rendered.bytes.length, sha256: hash(rendered.bytes), assetCount: rendered.assets.length }
        delete item.partialPath
        delete item.partialPaths
        item.status = 'succeeded'; item.message = '文档及附件已写入，并完成读回校验。'
        plan.outputAssetBytes = budget.bytes
      } catch (cause) {
        const cleanup = await cleanupWritten(written)
        budget.bytes = beforeAssets
        const cancellation = signal?.aborted || cause?.code === 'cancelled', timedOut = Date.now() >= deadline || cause?.code === 'timeout'
        item.status = cancellation || timedOut ? 'cancelled' : 'failed'
        item.code = cancellation ? 'cancelled' : timedOut ? 'timeout' : cause instanceof LocalExportError ? cause.code : 'write-failed'
        item.message = cause instanceof LocalExportError ? cause.message : '导出文件无法可靠写入；请检查权限、磁盘空间或同名文件后重试。'
        if (cleanup.complete) {
          delete item.partialPath
          delete item.partialPaths
        } else {
          item.partialPaths = cleanup.residualPaths
          if (cleanup.residualPaths.length) item.partialPath = cleanup.residualPaths[0]
          item.status = 'failed'; item.code = 'cleanup-incomplete'
          item.message += ' 以下部分输出未能确认清理，请先检查列出的实际路径；系统不会覆盖已有文件。'
        }
      }
      notify()
      if (signal?.aborted || Date.now() >= deadline) break
    }
    const stopped = signal?.aborted || Date.now() >= deadline
    if (stopped) for (const item of eligible) if (item.status === 'ready' || item.status === 'running' || (retryFailed && item.status === 'failed' && !item.code)) { item.status = 'cancelled'; item.code = 'cancelled'; item.message = '本项尚未完成导出；可显式继续。' }
    plan.state = stopped ? 'cancelled' : plan.items.every(item => item.status === 'succeeded') ? 'completed' : 'partial'
    notify()
    return describeExportPlan(plan)
  } catch (cause) {
    plan.state = signal?.aborted || Date.now() >= deadline ? 'cancelled' : 'partial'
    notify()
    if (cause instanceof LocalExportError) throw cause
    throw error('invalid-destination', '导出目录无法读取或创建，请检查权限及磁盘状态。')
  } finally { plan.running = false }
}
