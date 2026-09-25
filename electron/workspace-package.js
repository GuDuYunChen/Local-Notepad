import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

export const WORKSPACE_FORMAT = 'local-notepad-workspace'
export const WORKSPACE_VERSION = 1
export const WORKSPACE_EXTENSION = 'lnw'
export const WORKSPACE_MAGIC = Buffer.from('LNWPKG1\n', 'ascii')
export const WORKSPACE_HEADER_BYTES = 44
export const MAX_WORKSPACE_MANIFEST_BYTES = 8 * 1024 * 1024
export const MAX_WORKSPACE_ENTRIES = 100000
export const SUPPORTED_SCHEMA_VERSION = 12

const hex64 = /^[a-f0-9]{64}$/
const backupName = /^backup-(?:manual-)?[a-zA-Z0-9-]+\.db$/

function fail(message) { throw new Error(message) }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function sameStat(left, right) {
  return Boolean(left && right) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
}
function inside(root, target) {
  const relative = path.relative(root, target)
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}
function safeAttachmentName(name) {
  if (typeof name !== 'string' || !name || Buffer.byteLength(name, 'utf8') > 512 ||
      name === '.' || name === '..' || /[\/\\\0]/.test(name)) {
    fail('附件路径包含不安全名称，未创建便携包')
  }
  return name
}
function validateReceipt(info) {
  if (!isObject(info) || !backupName.test(info.name || '') || !hex64.test(info.sha256 || '') ||
      !Number.isSafeInteger(info.size) || info.size < 100 ||
      !Number.isSafeInteger(info.files) || info.files < 0 ||
      !Number.isInteger(info.schemaVersion) || info.schemaVersion < 1 ||
      info.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    fail('数据库快照校验回执不完整，未创建便携包')
  }
  return info
}
function validISO(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false
  return new Date(value).toISOString() === value
}
function validEntry(entry) {
  return isObject(entry) &&
    (entry.kind === 'database' || entry.kind === 'attachment') &&
    typeof entry.path === 'string' &&
    Number.isSafeInteger(entry.size) && entry.size >= 0 &&
    hex64.test(entry.sha256 || '')
}

export function validateWorkspaceManifest(value) {
  if (!isObject(value) || value.format !== WORKSPACE_FORMAT || value.version !== WORKSPACE_VERSION ||
      !validISO(value.createdAt) || typeof value.appVersion !== 'string' || value.appVersion.length > 100 ||
      !Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > MAX_WORKSPACE_ENTRIES ||
      !isObject(value.database) || !isObject(value.attachments)) {
    fail('工作区便携包清单格式或版本无效')
  }

  const seen = new Set()
  let databaseEntry = null
  let attachmentCount = 0
  let attachmentBytes = 0
  let totalBytes = 0

  value.entries.forEach((entry, index) => {
    if (!validEntry(entry)) fail('工作区便携包文件清单无效')
    if (seen.has(entry.path)) fail('工作区便携包包含重复路径')
    seen.add(entry.path)
    totalBytes += entry.size
    if (!Number.isSafeInteger(totalBytes)) fail('工作区便携包尺寸超过安全范围')

    if (entry.kind === 'database') {
      if (index !== 0 || databaseEntry || entry.path !== 'data.db' || entry.size < 100) {
        fail('工作区便携包数据库条目无效')
      }
      databaseEntry = entry
      return
    }

    if (!entry.path.startsWith('uploads/')) fail('工作区便携包附件路径无效')
    safeAttachmentName(entry.path.slice('uploads/'.length))
    attachmentCount += 1
    attachmentBytes += entry.size
    if (!Number.isSafeInteger(attachmentBytes)) fail('附件总大小超过安全范围')
  })

  if (!databaseEntry) fail('工作区便携包缺少数据库')
  if (!backupName.test(value.database.snapshot || '') ||
      value.database.entry !== 'data.db' ||
      value.database.size !== databaseEntry.size ||
      value.database.sha256 !== databaseEntry.sha256 ||
      !Number.isSafeInteger(value.database.files) || value.database.files < 0 ||
      !Number.isInteger(value.database.schemaVersion) || value.database.schemaVersion < 1 ||
      value.database.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    fail('工作区便携包数据库信息无效')
  }
  if (value.attachments.count !== attachmentCount ||
      value.attachments.totalBytes !== attachmentBytes) {
    fail('工作区便携包附件统计与文件清单不一致')
  }
  return value
}

async function hashFile(filename, options = {}) {
  const hash = createHash('sha256')
  const streamOptions = {}
  if (Number.isSafeInteger(options.start)) streamOptions.start = options.start
  if (Number.isSafeInteger(options.end)) streamOptions.end = options.end
  for await (const chunk of createReadStream(filename, streamOptions)) hash.update(chunk)
  return hash.digest('hex')
}

async function inspectStableFile(filename, message) {
  const before = await fs.lstat(filename)
  if (!before.isFile() || before.isSymbolicLink()) fail(message)
  const sha256 = await hashFile(filename)
  const after = await fs.lstat(filename)
  if (!sameStat(before, after)) fail('文件在校验期间发生变化，请重试')
  return { stat: after, sha256 }
}

async function scanAttachments(dataDir) {
  const root = path.join(dataDir, 'uploads')
  let stat
  try { stat = await fs.lstat(root) }
  catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('附件目录不是安全的普通目录，未创建便携包')
  }

  const dirEntries = await fs.readdir(root, { withFileTypes: true })
  if (dirEntries.length > MAX_WORKSPACE_ENTRIES - 1) fail('附件数量超过便携包安全上限')

  const result = []
  for (const entry of [...dirEntries].sort((a, b) => a.name.localeCompare(b.name))) {
    safeAttachmentName(entry.name)
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail('附件目录包含子目录、符号链接或特殊文件；为避免静默遗漏，未创建便携包')
    }
    const filename = path.join(root, entry.name)
    const checked = await inspectStableFile(filename, '附件不是普通文件，未创建便携包')
    result.push({
      name: entry.name,
      path: 'uploads/' + entry.name,
      source: filename,
      size: checked.stat.size,
      sha256: checked.sha256,
    })
  }
  return result
}

function buildManifest({ backup, attachments, appVersion, now }) {
  validateReceipt(backup)
  const databaseEntry = {
    kind: 'database',
    path: 'data.db',
    size: backup.size,
    sha256: backup.sha256,
  }
  const attachmentEntries = attachments.map(item => ({
    kind: 'attachment',
    path: item.path,
    size: item.size,
    sha256: item.sha256,
  }))
  const manifest = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    createdAt: now().toISOString(),
    appVersion: String(appVersion || ''),
    database: {
      entry: 'data.db',
      snapshot: backup.name,
      size: backup.size,
      sha256: backup.sha256,
      files: backup.files,
      schemaVersion: backup.schemaVersion,
    },
    attachments: {
      count: attachmentEntries.length,
      totalBytes: attachmentEntries.reduce((sum, item) => sum + item.size, 0),
    },
    entries: [databaseEntry, ...attachmentEntries],
  }
  return validateWorkspaceManifest(manifest)
}

export function encodeWorkspaceHeader(manifest) {
  validateWorkspaceManifest(manifest)
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8')
  if (manifestBytes.length < 2 || manifestBytes.length > MAX_WORKSPACE_MANIFEST_BYTES) {
    fail('工作区便携包清单超过安全大小')
  }
  const header = Buffer.alloc(WORKSPACE_HEADER_BYTES)
  WORKSPACE_MAGIC.copy(header, 0)
  header.writeUInt32BE(manifestBytes.length, 8)
  createHash('sha256').update(manifestBytes).digest().copy(header, 12)
  return Buffer.concat([header, manifestBytes])
}

async function readExact(handle, length, position) {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset)
    if (!bytesRead) fail('工作区便携包被截断')
    offset += bytesRead
  }
  return buffer
}

async function readWorkspaceHeader(filename) {
  const before = await fs.lstat(filename)
  if (!before.isFile() || before.isSymbolicLink()) fail('工作区便携包不是普通文件')
  if (before.size < WORKSPACE_HEADER_BYTES + 2) fail('工作区便携包过小或已损坏')

  const handle = await fs.open(filename, 'r')
  try {
    const header = await readExact(handle, WORKSPACE_HEADER_BYTES, 0)
    if (!header.subarray(0, 8).equals(WORKSPACE_MAGIC)) fail('不是 Local-Notepad 工作区便携包')
    const length = header.readUInt32BE(8)
    if (length < 2 || length > MAX_WORKSPACE_MANIFEST_BYTES ||
        WORKSPACE_HEADER_BYTES + length > before.size) {
      fail('工作区便携包清单长度无效')
    }
    const manifestBytes = await readExact(handle, length, WORKSPACE_HEADER_BYTES)
    const expected = header.subarray(12, 44)
    const actual = createHash('sha256').update(manifestBytes).digest()
    if (!actual.equals(expected)) fail('工作区便携包清单校验失败，文件可能损坏')
    let manifest
    try { manifest = JSON.parse(manifestBytes.toString('utf8')) }
    catch { fail('工作区便携包清单不是有效 JSON') }
    validateWorkspaceManifest(manifest)

    const contentBytes = manifest.entries.reduce((sum, entry) => sum + entry.size, 0)
    const expectedSize = WORKSPACE_HEADER_BYTES + length + contentBytes
    if (!Number.isSafeInteger(expectedSize) || expectedSize !== before.size) {
      fail('工作区便携包尺寸与清单不一致')
    }
    return {
      manifest,
      dataOffset: WORKSPACE_HEADER_BYTES + length,
      stat: before,
      manifestBytes,
    }
  } finally {
    await handle.close()
  }
}

export async function inspectWorkspacePackage(filename) {
  const absolute = path.resolve(filename)
  const header = await readWorkspaceHeader(absolute)

  const databaseHandle = await fs.open(absolute, 'r')
  try {
    const signature = await readExact(databaseHandle, 16, header.dataOffset)
    if (!signature.equals(Buffer.from('SQLite format 3\0', 'binary'))) {
      fail('工作区便携包中的数据库不是 SQLite 文件')
    }
  } finally {
    await databaseHandle.close()
  }

  let offset = header.dataOffset
  for (const entry of header.manifest.entries) {
    let digest
    if (entry.size === 0) {
      digest = createHash('sha256').digest('hex')
    } else {
      digest = await hashFile(absolute, { start: offset, end: offset + entry.size - 1 })
    }
    if (digest !== entry.sha256) {
      fail('工作区便携包内容校验失败：' + entry.path)
    }
    offset += entry.size
  }

  const after = await fs.lstat(absolute)
  if (!sameStat(header.stat, after)) fail('工作区便携包在校验期间发生变化，请重试')
  const packageSHA256 = await hashFile(absolute)
  const finalStat = await fs.lstat(absolute)
  if (!sameStat(after, finalStat)) fail('工作区便携包在最终校验期间发生变化，请重试')

  const manifest = header.manifest
  return {
    format: manifest.format,
    version: manifest.version,
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    size: finalStat.size,
    sha256: packageSHA256,
    database: { ...manifest.database },
    attachments: { ...manifest.attachments },
  }
}

async function writeChunk(handle, chunk, position) {
  let offset = 0
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(
      chunk,
      offset,
      chunk.length - offset,
      position + offset,
    )
    if (!bytesWritten) fail('工作区便携包写入中断')
    offset += bytesWritten
  }
  return position + chunk.length
}

async function copyIntoFile(source, handle, position) {
  let cursor = position
  for await (const chunk of createReadStream(source)) {
    cursor = await writeChunk(handle, chunk, cursor)
  }
  return cursor
}

async function resolveSnapshot(dataDir, info) {
  validateReceipt(info)
  const root = path.join(dataDir, 'backups')
  const folder = await fs.lstat(root)
  if (!folder.isDirectory() || folder.isSymbolicLink()) fail('数据库备份目录不安全或不可用')
  const filename = path.join(root, info.name)
  const checked = await inspectStableFile(filename, '数据库快照不是普通文件')
  if (checked.stat.size !== info.size || checked.sha256 !== info.sha256) {
    fail('数据库快照与后端校验回执不一致')
  }
  return filename
}

function suggestedWorkspaceName(now) {
  const stamp = now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return 'Local-Notepad-Workspace-' + stamp + '.' + WORKSPACE_EXTENSION
}

export function createWorkspacePackageService({
  dataDir,
  appVersion = '',
  runBackup,
  chooseDestination,
  chooseSource,
  now = () => new Date(),
} = {}) {
  let busy = false
  async function exclusive(operation) {
    if (busy) return { success: false, message: '另一项工作区便携包操作正在进行，请完成后重试' }
    busy = true
    try { return await operation() }
    catch (error) { return { success: false, message: error.message || '工作区便携包操作失败，原数据未改动' } }
    finally { busy = false }
  }

  return {
    exportPackage: () => exclusive(async () => {
      if (typeof runBackup !== 'function' || typeof chooseDestination !== 'function') {
        fail('桌面便携包服务不可用')
      }
      const backup = validateReceipt(await runBackup(['create']))
      const snapshot = await resolveSnapshot(dataDir, backup)
      const attachments = await scanAttachments(dataDir)
      const manifest = buildManifest({ backup, attachments, appVersion, now })
      const header = encodeWorkspaceHeader(manifest)
      const choice = await chooseDestination(suggestedWorkspaceName(now))
      if (choice?.canceled || !choice?.filePath) return { success: false, canceled: true }

      const target = path.resolve(choice.filePath)
      const parent = await fs.realpath(path.dirname(target))
      const root = await fs.realpath(dataDir)
      if (inside(root, path.join(parent, path.basename(target)))) {
        fail('请将工作区便携包保存到应用数据目录之外')
      }

      let handle
      let owned
      try {
        try { handle = await fs.open(target, 'wx', 0o600) }
        catch (error) {
          if (error.code === 'EEXIST') fail('目标便携包已存在；为保护已有文件，请使用新的文件名')
          throw error
        }
        owned = await handle.stat()
        let position = 0
        position = await writeChunk(handle, header, position)
        position = await copyIntoFile(snapshot, handle, position)
        for (const attachment of attachments) {
          position = await copyIntoFile(attachment.source, handle, position)
        }
        const expectedBytes = header.length + backup.size +
          attachments.reduce((sum, attachment) => sum + attachment.size, 0)
        if (position !== expectedBytes) fail('工作区便携包写入字节数与清单不一致')
        await handle.sync()
        await handle.close(); handle = null

        const inspected = await inspectWorkspacePackage(target)
        if (inspected.database.sha256 !== backup.sha256 ||
            inspected.attachments.count !== attachments.length) {
          fail('便携包写入后校验结果与源数据不一致')
        }
        return { success: true, path: target, package: inspected, backup }
      } catch (error) {
        await handle?.close().catch(() => {})
        handle = null
        const current = await fs.lstat(target).catch(() => null)
        if (owned && current && current.dev === owned.dev && current.ino === owned.ino) {
          await fs.unlink(target).catch(() => {})
        }
        throw error
      }
    }),

    inspectPackage: () => exclusive(async () => {
      if (typeof chooseSource !== 'function') fail('桌面便携包校验服务不可用')
      const choice = await chooseSource()
      const filename = choice?.filePaths?.[0]
      if (choice?.canceled || !filename) return { success: false, canceled: true }
      return { success: true, path: filename, package: await inspectWorkspacePackage(filename) }
    }),
  }
}

export function registerWorkspacePackageHandlers(ipcMain, service, isTrusted) {
  for (const [channel, method] of [
    ['workspace:export', 'exportPackage'],
    ['workspace:inspect', 'inspectPackage'],
  ]) {
    ipcMain.handle(channel, async event => {
      if (!isTrusted(event)) return { success: false, message: '不接受来自其他页面的工作区文件操作' }
      return service[method]()
    })
  }
}
