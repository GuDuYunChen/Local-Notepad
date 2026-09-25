import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import {
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  WORKSPACE_MAGIC,
  WORKSPACE_HEADER_BYTES,
  MAX_WORKSPACE_MANIFEST_BYTES,
  MAX_WORKSPACE_ENTRIES,
  SUPPORTED_SCHEMA_VERSION,
  inspectWorkspacePackage,
  validateWorkspaceManifest,
} from './workspace-package.js'

export const RESTORE_STAGE_FORMAT = 'local-notepad-workspace-restore-stage'
export const RESTORE_STAGE_VERSION = 1
export const RESTORE_PENDING_FORMAT = 'local-notepad-workspace-restore-pending'
export const RESTORE_PENDING_VERSION = 1
export const RESTORE_STAGE_DIR = 'workspace-restore-staging'
export const RESTORE_PENDING_FILE = 'workspace-restore-pending.json'
export const RESTORE_APPLYING_FILE = 'workspace-restore-applying.json'

const idPattern = /^[a-f0-9]{24}$/
const shaPattern = /^[a-f0-9]{64}$/
const importedBackupPattern = /^backup-manual-workspace-([a-f0-9]{24})\.db$/

function fail(message, name = 'Error') {
  const error = new Error(message)
  error.name = name
  throw error
}
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function safeName(name) {
  if (typeof name !== 'string' || !name || Buffer.byteLength(name, 'utf8') > 512 ||
      name === '.' || name === '..' || /[\/\\\0]/.test(name)) {
    fail('恢复包包含不安全的附件名称')
  }
  return name
}
function sameStat(left, right) {
  return Boolean(left && right) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
}
async function hashFile(filename, options = {}) {
  const hash = createHash('sha256')
  const streamOptions = {}
  if (Number.isSafeInteger(options.start)) streamOptions.start = options.start
  if (Number.isSafeInteger(options.end)) streamOptions.end = options.end
  for await (const chunk of createReadStream(filename, streamOptions)) hash.update(chunk)
  return hash.digest('hex')
}
function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
async function fsyncFile(filename) {
  const handle = await fs.open(filename, 'r+')
  try { await handle.sync() } finally { await handle.close() }
}
async function writeExclusive(filename, bytes, mode = 0o600) {
  const handle = await fs.open(filename, 'wx', mode)
  try {
    let offset = 0
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset)
      if (!bytesWritten) fail('恢复暂存文件写入中断')
      offset += bytesWritten
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
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
async function readPackageIndex(filename) {
  const absolute = path.resolve(filename)
  const before = await fs.lstat(absolute)
  if (!before.isFile() || before.isSymbolicLink()) fail('工作区便携包不是普通文件')
  if (before.size < WORKSPACE_HEADER_BYTES + 2) fail('工作区便携包过小或已损坏')
  const handle = await fs.open(absolute, 'r')
  try {
    const header = await readExact(handle, WORKSPACE_HEADER_BYTES, 0)
    if (!header.subarray(0, 8).equals(WORKSPACE_MAGIC)) fail('不是 Local-Notepad 工作区便携包')
    const length = header.readUInt32BE(8)
    if (length < 2 || length > MAX_WORKSPACE_MANIFEST_BYTES ||
        WORKSPACE_HEADER_BYTES + length > before.size) fail('工作区便携包清单长度无效')
    const manifestBytes = await readExact(handle, length, WORKSPACE_HEADER_BYTES)
    if (!createHash('sha256').update(manifestBytes).digest().equals(header.subarray(12, 44))) {
      fail('工作区便携包清单校验失败')
    }
    let manifest
    try { manifest = JSON.parse(manifestBytes.toString('utf8')) }
    catch { fail('工作区便携包清单不是有效 JSON') }
    validateWorkspaceManifest(manifest)
    const contentBytes = manifest.entries.reduce((sum, entry) => sum + entry.size, 0)
    if (WORKSPACE_HEADER_BYTES + length + contentBytes !== before.size) {
      fail('工作区便携包尺寸与清单不一致')
    }
    return { absolute, manifest, dataOffset: WORKSPACE_HEADER_BYTES + length, stat: before }
  } finally {
    await handle.close()
  }
}
async function copyRange(source, start, size, target, expectedSHA256) {
  const handle = await fs.open(target, 'wx', 0o600)
  const hash = createHash('sha256')
  let written = 0
  try {
    if (size > 0) {
      for await (const chunk of createReadStream(source, { start, end: start + size - 1 })) {
        hash.update(chunk)
        let offset = 0
        while (offset < chunk.length) {
          const result = await handle.write(chunk, offset, chunk.length - offset, written + offset)
          if (!result.bytesWritten) fail('恢复暂存写入中断')
          offset += result.bytesWritten
        }
        written += chunk.length
      }
    }
    if (written !== size) fail('恢复暂存文件大小与清单不一致')
    const digest = hash.digest('hex')
    if (digest !== expectedSHA256) fail('恢复暂存文件 SHA-256 与清单不一致')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await fs.rm(target, { force: true }).catch(() => {})
    throw error
  }
  await handle.close()
}
async function ensureSafeDirectory(dir, { create = false } = {}) {
  if (create) await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('恢复工作目录不安全或不可用')
  return dir
}
function validateStageReceipt(receipt) {
  if (!isObject(receipt) || receipt.format !== RESTORE_STAGE_FORMAT ||
      receipt.version !== RESTORE_STAGE_VERSION || !idPattern.test(receipt.id || '') ||
      !isObject(receipt.package) || !shaPattern.test(receipt.package.sha256 || '') ||
      !isObject(receipt.database) || !shaPattern.test(receipt.database.sha256 || '') ||
      receipt.database.backupName !== 'backup-manual-workspace-' + receipt.id + '.db' ||
      !Number.isSafeInteger(receipt.database.size) || receipt.database.size < 100 ||
      !Number.isSafeInteger(receipt.database.files) || receipt.database.files < 0 ||
      !Number.isInteger(receipt.database.schemaVersion) || receipt.database.schemaVersion < 1 ||
      receipt.database.schemaVersion > SUPPORTED_SCHEMA_VERSION ||
      !isObject(receipt.attachments) || !Array.isArray(receipt.attachments.entries) ||
      receipt.attachments.entries.length > MAX_WORKSPACE_ENTRIES - 1) {
    fail('恢复暂存回执格式无效')
  }
  let total = 0
  const seen = new Set()
  for (const entry of receipt.attachments.entries) {
    if (!isObject(entry) || entry.kind !== 'attachment' ||
        typeof entry.name !== 'string' || entry.path !== 'uploads/' + entry.name ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 || !shaPattern.test(entry.sha256 || '')) {
      fail('恢复暂存附件清单无效')
    }
    safeName(entry.name)
    if (seen.has(entry.name)) fail('恢复暂存附件清单包含重复文件')
    seen.add(entry.name)
    total += entry.size
    if (!Number.isSafeInteger(total)) fail('恢复暂存附件大小超过安全范围')
  }
  if (receipt.attachments.count !== receipt.attachments.entries.length ||
      receipt.attachments.totalBytes !== total) fail('恢复暂存附件统计不一致')
  return receipt
}
async function readReceipt(dataDir, id, expectedSHA256 = '') {
  if (!idPattern.test(id || '')) fail('恢复标识无效')
  const stageRoot = path.join(dataDir, RESTORE_STAGE_DIR, id)
  const receiptPath = path.join(stageRoot, 'restore.json')
  const stat = await fs.lstat(receiptPath)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('恢复暂存回执不可用')
  const bytes = await fs.readFile(receiptPath)
  const digest = hashBytes(bytes)
  if (expectedSHA256 && digest !== expectedSHA256) fail('恢复暂存回执校验失败')
  let receipt
  try { receipt = JSON.parse(bytes.toString('utf8')) }
  catch { fail('恢复暂存回执不是有效 JSON') }
  validateStageReceipt(receipt)
  if (receipt.id !== id) fail('恢复暂存回执标识不匹配')
  return { receipt, receiptPath, receiptSHA256: digest, stageRoot }
}
async function verifyAttachmentDirectory(dataDir, receipt, stageRoot) {
  const uploads = path.join(stageRoot, 'uploads')
  const stat = await fs.lstat(uploads)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('恢复暂存附件目录不安全')
  const entries = await fs.readdir(uploads, { withFileTypes: true })
  const expected = new Map(receipt.attachments.entries.map(entry => [entry.name, entry]))
  if (entries.length !== expected.size) fail('恢复暂存附件数量发生变化')
  for (const item of entries) {
    const spec = expected.get(item.name)
    if (!spec || !item.isFile() || item.isSymbolicLink()) fail('恢复暂存附件目录包含异常文件')
    const filename = path.join(uploads, item.name)
    const before = await fs.lstat(filename)
    const digest = await hashFile(filename)
    const after = await fs.lstat(filename)
    if (!sameStat(before, after) || before.size !== spec.size || digest !== spec.sha256) {
      fail('恢复暂存附件已变化：' + item.name)
    }
  }
  return uploads
}
async function verifyImportedBackup(dataDir, receipt, inspectBackup) {
  const backups = await ensureSafeDirectory(path.join(dataDir, 'backups'), { create: true })
  const match = importedBackupPattern.exec(receipt.database.backupName)
  if (!match || match[1] !== receipt.id) fail('恢复数据库备份名称无效')
  const filename = path.join(backups, receipt.database.backupName)
  const stat = await fs.lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('恢复数据库备份不可用')
  if (stat.size !== receipt.database.size || await hashFile(filename) !== receipt.database.sha256) {
    fail('恢复数据库备份已变化')
  }
  if (typeof inspectBackup === 'function') {
    const info = await inspectBackup(['inspect', receipt.database.backupName])
    if (!info || info.sha256 !== receipt.database.sha256 || info.size !== receipt.database.size ||
        info.files !== receipt.database.files || info.schemaVersion !== receipt.database.schemaVersion) {
      fail('恢复数据库未通过 SQLite 完整性或版本复检')
    }
  }
  return filename
}
async function verifyStagedRestore(dataDir, id, receiptSHA256, inspectBackup) {
  const loaded = await readReceipt(dataDir, id, receiptSHA256)
  const backupPath = await verifyImportedBackup(dataDir, loaded.receipt, inspectBackup)
  const uploadsPath = await verifyAttachmentDirectory(dataDir, loaded.receipt, loaded.stageRoot)
  return { ...loaded, backupPath, uploadsPath }
}
async function createImportedBackup(dataDir, id, stagedDatabase, databaseSpec) {
  const backups = await ensureSafeDirectory(path.join(dataDir, 'backups'), { create: true })
  const name = 'backup-manual-workspace-' + id + '.db'
  const target = path.join(backups, name)
  await fs.copyFile(stagedDatabase, target, fs.constants.COPYFILE_EXCL)
  try {
    await fsyncFile(target)
    const stat = await fs.lstat(target)
    const digest = await hashFile(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== databaseSpec.size || digest !== databaseSpec.sha256) {
      fail('导入数据库备份校验失败')
    }
    return { name, target }
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => {})
    throw error
  }
}
function publicPreview(receipt, receiptSHA256) {
  return {
    id: receipt.id,
    receiptSHA256,
    package: { ...receipt.package },
    database: { ...receipt.database },
    attachments: {
      count: receipt.attachments.count,
      totalBytes: receipt.attachments.totalBytes,
    },
  }
}
export async function stageWorkspaceRestore({
  dataDir,
  packagePath,
  inspectBackup,
  now = () => new Date(),
  randomId = () => randomBytes(12).toString('hex'),
} = {}) {
  if (typeof dataDir !== 'string' || !dataDir) fail('应用数据目录无效')
  if (typeof packagePath !== 'string' || !packagePath) fail('未选择工作区便携包')
  const id = randomId()
  if (!idPattern.test(id)) fail('恢复标识生成失败')
  await ensureSafeDirectory(dataDir, { create: true })
  const stagingParent = await ensureSafeDirectory(path.join(dataDir, RESTORE_STAGE_DIR), { create: true })
  const stageRoot = path.join(stagingParent, id)
  await fs.mkdir(stageRoot, { mode: 0o700 })
  let importedBackup = ''
  try {
    const inspected = await inspectWorkspacePackage(packagePath)
    const index = await readPackageIndex(packagePath)
    if (inspected.format !== WORKSPACE_FORMAT || inspected.version !== WORKSPACE_VERSION ||
        inspected.sha256 !== await hashFile(index.absolute)) fail('便携包在恢复预检期间发生变化')

    const uploadsDir = path.join(stageRoot, 'uploads')
    await fs.mkdir(uploadsDir, { mode: 0o700 })
    let offset = index.dataOffset
    let stagedDatabase = ''
    const attachmentEntries = []
    for (const entry of index.manifest.entries) {
      const target = entry.kind === 'database'
        ? path.join(stageRoot, 'data.db')
        : path.join(uploadsDir, safeName(entry.path.slice('uploads/'.length)))
      await copyRange(index.absolute, offset, entry.size, target, entry.sha256)
      offset += entry.size
      if (entry.kind === 'database') stagedDatabase = target
      else attachmentEntries.push({
        kind: 'attachment',
        name: path.basename(entry.path),
        path: entry.path,
        size: entry.size,
        sha256: entry.sha256,
      })
    }
    if (!stagedDatabase) fail('便携包缺少可恢复数据库')
    if (await hashFile(index.absolute) !== inspected.sha256) fail('便携包在恢复暂存期间发生变化')

    const imported = await createImportedBackup(dataDir, id, stagedDatabase, index.manifest.database)
    importedBackup = imported.target
    const info = await inspectBackup(['inspect', imported.name])
    if (!info || info.sha256 !== index.manifest.database.sha256 ||
        info.size !== index.manifest.database.size ||
        info.files !== index.manifest.database.files ||
        info.schemaVersion !== index.manifest.database.schemaVersion) {
      fail('便携包数据库未通过 SQLite 完整性与版本校验')
    }
    await fs.rm(stagedDatabase, { force: true })

    const receipt = validateStageReceipt({
      format: RESTORE_STAGE_FORMAT,
      version: RESTORE_STAGE_VERSION,
      id,
      preparedAt: now().toISOString(),
      package: {
        sha256: inspected.sha256,
        size: inspected.size,
        createdAt: inspected.createdAt,
        appVersion: inspected.appVersion,
      },
      database: {
        backupName: imported.name,
        sha256: info.sha256,
        size: info.size,
        files: info.files,
        schemaVersion: info.schemaVersion,
      },
      attachments: {
        count: attachmentEntries.length,
        totalBytes: attachmentEntries.reduce((sum, entry) => sum + entry.size, 0),
        entries: attachmentEntries,
      },
    })
    const bytes = Buffer.from(JSON.stringify(receipt), 'utf8')
    const receiptPath = path.join(stageRoot, 'restore.json')
    await writeExclusive(receiptPath, bytes)
    return publicPreview(receipt, hashBytes(bytes))
  } catch (error) {
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => {})
    if (importedBackup) await fs.rm(importedBackup, { force: true }).catch(() => {})
    throw error
  }
}
async function publishNoReplaceJSON(target, temp, value) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  await writeExclusive(temp, bytes)
  try {
    await fs.link(temp, target)
  } catch (error) {
    if (error.code === 'EEXIST') fail('已有一个工作区恢复事务正在等待或执行；请先重启应用完成或检查它')
    throw error
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {})
  }
}
async function writePendingMarker(dataDir, restore) {
  const marker = {
    format: RESTORE_PENDING_FORMAT,
    version: RESTORE_PENDING_VERSION,
    id: restore.id,
    receiptSHA256: restore.receiptSHA256,
    confirmedAt: new Date().toISOString(),
  }
  const target = path.join(dataDir, RESTORE_PENDING_FILE)
  const temp = path.join(dataDir, '.' + RESTORE_PENDING_FILE + '.' + restore.id + '.partial')
  await publishNoReplaceJSON(target, temp, marker)
  return marker
}
async function writeApplyingJournal(dataDir, staged, preservedDir, now) {
  const value = {
    format: 'local-notepad-workspace-restore-applying',
    version: 1,
    id: staged.receipt.id,
    receiptSHA256: staged.receiptSHA256,
    preservedDir: path.basename(preservedDir),
    startedAt: now().toISOString(),
  }
  const target = path.join(dataDir, RESTORE_APPLYING_FILE)
  const temp = path.join(dataDir, '.' + RESTORE_APPLYING_FILE + '.' + staged.receipt.id + '.partial')
  await publishNoReplaceJSON(target, temp, value)
  return target
}
function validateApplyingJournal(value) {
  if (!isObject(value) || value.format !== 'local-notepad-workspace-restore-applying' ||
      value.version !== 1 || !idPattern.test(value.id || '') ||
      !shaPattern.test(value.receiptSHA256 || '') ||
      typeof value.preservedDir !== 'string' ||
      !value.preservedDir.startsWith('workspace-restore-preserved-') ||
      path.basename(value.preservedDir) !== value.preservedDir) {
    fail('工作区恢复执行日志损坏', 'WorkspaceRestoreCriticalError')
  }
  return value
}
function validatePendingMarker(value) {
  if (!isObject(value) || value.format !== RESTORE_PENDING_FORMAT ||
      value.version !== RESTORE_PENDING_VERSION || !idPattern.test(value.id || '') ||
      !shaPattern.test(value.receiptSHA256 || '')) fail('待恢复标记损坏')
  return value
}
async function readPendingMarker(dataDir) {
  const filename = path.join(dataDir, RESTORE_PENDING_FILE)
  let stat
  try { stat = await fs.lstat(filename) }
  catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('待恢复标记不是安全的普通文件')
  let value
  try { value = JSON.parse(await fs.readFile(filename, 'utf8')) }
  catch { fail('待恢复标记不是有效 JSON') }
  return { filename, marker: validatePendingMarker(value) }
}
async function readApplyingJournal(dataDir) {
  const filename = path.join(dataDir, RESTORE_APPLYING_FILE)
  let stat
  try { stat = await fs.lstat(filename) }
  catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('工作区恢复执行日志不是安全的普通文件', 'WorkspaceRestoreCriticalError')
  }
  let value
  try { value = JSON.parse(await fs.readFile(filename, 'utf8')) }
  catch { fail('工作区恢复执行日志不是有效 JSON', 'WorkspaceRestoreCriticalError') }
  return { filename, journal: validateApplyingJournal(value) }
}

async function activePathState(filename, kind) {
  try {
    const stat = await fs.lstat(filename)
    if (stat.isSymbolicLink()) fail('当前数据路径包含符号链接，拒绝自动恢复')
    if (kind === 'file' && !stat.isFile()) fail('当前数据库路径不是普通文件，拒绝自动恢复')
    if (kind === 'dir' && !stat.isDirectory()) fail('当前附件路径不是目录，拒绝自动恢复')
    return stat
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
function preservedName(now, id, suffix = '') {
  const stamp = now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return 'workspace-restore-preserved-' + stamp + '-' + id.slice(0, 8) + suffix
}
async function moveIfExists(source, target, kind, rename, moved) {
  if (!await activePathState(source, kind)) return false
  await rename(source, target)
  moved.push({ source, target, kind })
  return true
}
async function restoreMovedOriginals(moved, rename) {
  for (let index = moved.length - 1; index >= 0; index -= 1) {
    const item = moved[index]
    if (await activePathState(item.source, item.kind)) {
      fail('回滚目标已存在，无法安全覆盖', 'WorkspaceRestoreCriticalError')
    }
    await rename(item.target, item.source)
  }
}
async function moveNewStateAside(dataDir, failedDir, rename) {
  await fs.mkdir(failedDir, { mode: 0o700 })
  for (const [name, kind] of [['data.db','file'],['data.db-wal','file'],['data.db-shm','file'],['uploads','dir']]) {
    const source = path.join(dataDir, name)
    if (!await activePathState(source, kind)) continue
    await rename(source, path.join(failedDir, name))
  }
}
async function verifyActiveState(dataDir, receipt) {
  const database = path.join(dataDir, 'data.db')
  const dbStat = await activePathState(database, 'file')
  if (!dbStat || dbStat.size !== receipt.database.size || await hashFile(database) !== receipt.database.sha256) {
    fail('恢复后的数据库校验失败')
  }
  const uploads = path.join(dataDir, 'uploads')
  const entries = await fs.readdir(uploads, { withFileTypes: true })
  if (entries.length !== receipt.attachments.entries.length) fail('恢复后的附件数量校验失败')
  const expected = new Map(receipt.attachments.entries.map(entry => [entry.name, entry]))
  for (const item of entries) {
    const spec = expected.get(item.name)
    if (!spec || !item.isFile() || item.isSymbolicLink()) fail('恢复后的附件目录包含异常文件')
    const filename = path.join(uploads, item.name)
    const stat = await fs.lstat(filename)
    if (stat.size !== spec.size || await hashFile(filename) !== spec.sha256) {
      fail('恢复后的附件校验失败：' + item.name)
    }
  }
}
export async function recoverInterruptedWorkspaceRestore({
  dataDir,
  now = () => new Date(),
  rename = fs.rename,
} = {}) {
  const applying = await readApplyingJournal(dataDir)
  if (!applying) return null
  const preservedDir = path.join(dataDir, applying.journal.preservedDir)
  try {
    await ensureSafeDirectory(preservedDir)
  } catch (error) {
    fail(
      '检测到未完成工作区恢复，但恢复前数据目录不可用：' + (error?.message || error),
      'WorkspaceRestoreCriticalError',
    )
  }

  let failedDir = ''
  try {
    for (const [name, kind] of [['data.db','file'],['data.db-wal','file'],['data.db-shm','file'],['uploads','dir']]) {
      const preserved = path.join(preservedDir, name)
      if (!await activePathState(preserved, kind)) continue
      const active = path.join(dataDir, name)
      if (await activePathState(active, kind)) {
        if (!failedDir) {
          failedDir = path.join(
            dataDir,
            'workspace-restore-interrupted-failed-' +
              now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') +
              '-' + applying.journal.id.slice(0, 8),
          )
          await fs.mkdir(failedDir, { mode: 0o700 })
        }
        await rename(active, path.join(failedDir, name))
      }
      await rename(preserved, active)
    }
    if (!await activePathState(path.join(dataDir, 'data.db'), 'file')) {
      fail('中断恢复后没有可用的原数据库', 'WorkspaceRestoreCriticalError')
    }
    const pending = path.join(dataDir, RESTORE_PENDING_FILE)
    await fs.rm(pending, { force: true })
    await rename(
      applying.filename,
      path.join(preservedDir, 'restore-interrupted-applying.json'),
    )
    await fs.writeFile(
      path.join(preservedDir, 'interrupted.txt'),
      'An interrupted workspace restore was rolled back at ' + now().toISOString(),
      'utf8',
    )
    return {
      status: 'rolled-back-interrupted',
      id: applying.journal.id,
      preservedDir,
      failedDir,
      error: '检测到上次恢复在进程退出前未完成，已优先恢复原工作区。',
    }
  } catch (error) {
    fail(
      '检测到未完成工作区恢复，且自动恢复原数据失败：' + (error?.message || error) +
      '；请保持应用关闭并检查 ' + preservedDir,
      'WorkspaceRestoreCriticalError',
    )
  }
}

export async function applyPendingWorkspaceRestore({
  dataDir,
  inspectBackup,
  now = () => new Date(),
  rename = fs.rename,
  faultInjector = null,
} = {}) {
  const interrupted = await recoverInterruptedWorkspaceRestore({ dataDir, now, rename })
  if (interrupted) return interrupted
  const pending = await readPendingMarker(dataDir)
  if (!pending) return { status: 'none' }
  const staged = await verifyStagedRestore(
    dataDir,
    pending.marker.id,
    pending.marker.receiptSHA256,
    inspectBackup,
  )

  const activeDatabase = path.join(dataDir, 'data.db')
  if (!await activePathState(activeDatabase, 'file')) {
    fail('当前数据库不存在；为避免把恢复失败误变成空白工作区，拒绝自动恢复')
  }
  await activePathState(path.join(dataDir, 'data.db-wal'), 'file')
  await activePathState(path.join(dataDir, 'data.db-shm'), 'file')
  await activePathState(path.join(dataDir, 'uploads'), 'dir')

  let preservedDir = path.join(dataDir, preservedName(now, staged.receipt.id))
  let counter = 0
  while (true) {
    try { await fs.mkdir(preservedDir, { mode: 0o700 }); break }
    catch (error) {
      if (error.code !== 'EEXIST' || counter++ > 20) throw error
      preservedDir = path.join(dataDir, preservedName(now, staged.receipt.id, '-' + counter))
    }
  }

  const moved = []
  let publishedDatabase = false
  let publishedUploads = false
  const partialDatabase = path.join(dataDir, '.workspace-restore-' + staged.receipt.id + '.db.partial')
  try {
    const audit = {
      format: 'local-notepad-workspace-restore-audit',
      version: 1,
      id: staged.receipt.id,
      packageSHA256: staged.receipt.package.sha256,
      backupName: staged.receipt.database.backupName,
      appliedAt: now().toISOString(),
    }
    await writeExclusive(path.join(preservedDir, 'restore.json'), Buffer.from(JSON.stringify(audit), 'utf8'))
    const applyingFile = await writeApplyingJournal(dataDir, staged, preservedDir, now)

    for (const [name, kind] of [['data.db','file'],['data.db-wal','file'],['data.db-shm','file'],['uploads','dir']]) {
      await moveIfExists(path.join(dataDir, name), path.join(preservedDir, name), kind, rename, moved)
    }
    if (typeof faultInjector === 'function') await faultInjector('after-preserve')

    await fs.copyFile(staged.backupPath, partialDatabase, fs.constants.COPYFILE_EXCL)
    await fsyncFile(partialDatabase)
    if (await hashFile(partialDatabase) !== staged.receipt.database.sha256) fail('恢复数据库暂存复制校验失败')
    await rename(partialDatabase, activeDatabase)
    publishedDatabase = true

    const activeUploads = path.join(dataDir, 'uploads')
    await rename(staged.uploadsPath, activeUploads)
    publishedUploads = true
    if (typeof faultInjector === 'function') await faultInjector('after-publish')

    await verifyActiveState(dataDir, staged.receipt)
    // Remove pending first. If the process dies before the applying journal is
    // removed, next startup rolls back to the preserved original state.
    await fs.rm(pending.filename, { force: true })
    await fs.rm(path.join(dataDir, RESTORE_APPLYING_FILE), { force: true })
    await fs.rm(staged.receiptPath, { force: true })
    await fs.rm(staged.stageRoot, { recursive: true, force: true }).catch(() => {})

    return {
      status: 'applied',
      id: staged.receipt.id,
      preservedDir,
      backupName: staged.receipt.database.backupName,
      packageSHA256: staged.receipt.package.sha256,
      hadDatabase: moved.some(item => path.basename(item.source) === 'data.db'),
    }
  } catch (error) {
    await fs.rm(partialDatabase, { force: true }).catch(() => {})
    const failedDir = path.join(dataDir, 'workspace-restore-failed-' + staged.receipt.id)
    try {
      if (publishedDatabase || publishedUploads) await moveNewStateAside(dataDir, failedDir, rename)
      await restoreMovedOriginals(moved, rename)
      await fs.rename(pending.filename, path.join(preservedDir, 'restore-failed-pending.json')).catch(async () => {
        await fs.rm(pending.filename, { force: true })
      })
      const applyingFile = path.join(dataDir, RESTORE_APPLYING_FILE)
      await fs.rename(applyingFile, path.join(preservedDir, 'restore-failed-applying.json')).catch(async () => {
        await fs.rm(applyingFile, { force: true })
      })
      await fs.writeFile(path.join(preservedDir, 'failure.txt'), String(error?.message || error), 'utf8').catch(() => {})
      return {
        status: 'rolled-back',
        id: staged.receipt.id,
        preservedDir,
        failedDir: (publishedDatabase || publishedUploads) ? failedDir : '',
        error: error?.message || String(error),
      }
    } catch (rollbackError) {
      fail(
        '工作区恢复失败且自动回滚未完成：' + (rollbackError?.message || rollbackError) +
        '；请保持应用关闭并检查 ' + preservedDir,
        'WorkspaceRestoreCriticalError',
      )
    }
  }
}
export async function rollbackAppliedWorkspaceRestore({
  dataDir,
  restore,
  now = () => new Date(),
  rename = fs.rename,
} = {}) {
  if (!restore || restore.status !== 'applied' || !idPattern.test(restore.id || '')) {
    fail('缺少可回滚的工作区恢复记录')
  }
  const preservedDir = path.resolve(restore.preservedDir || '')
  const root = path.resolve(dataDir)
  const relative = path.relative(root, preservedDir)
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) ||
      !path.basename(preservedDir).startsWith('workspace-restore-preserved-')) {
    fail('恢复前数据目录无效')
  }
  await ensureSafeDirectory(preservedDir)
  if (!await activePathState(path.join(preservedDir, 'data.db'), 'file')) {
    fail('恢复前数据库副本缺失，不能自动回滚', 'WorkspaceRestoreCriticalError')
  }
  const failedDir = path.join(
    dataDir,
    'workspace-restore-health-failed-' +
      now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') +
      '-' + restore.id.slice(0, 8),
  )
  const movedOld = []
  try {
    await moveNewStateAside(dataDir, failedDir, rename)
    for (const [name, kind] of [['data.db','file'],['data.db-wal','file'],['data.db-shm','file'],['uploads','dir']]) {
      const preserved = path.join(preservedDir, name)
      if (!await activePathState(preserved, kind)) continue
      const active = path.join(dataDir, name)
      await rename(preserved, active)
      movedOld.push({ source: active, target: preserved, kind })
    }
    if (!movedOld.some(item => path.basename(item.source) === 'data.db')) {
      fail('恢复前数据库未成功回滚', 'WorkspaceRestoreCriticalError')
    }
    await fs.writeFile(
      path.join(failedDir, 'health-failure.txt'),
      'Restored workspace failed backend health validation and was rolled back at ' + now().toISOString(),
      'utf8',
    )
    return { status: 'rolled-back-health', failedDir, preservedDir }
  } catch (error) {
    fail(
      '恢复后的工作区无法启动，且回滚失败：' + (error?.message || error) +
      '；请保持应用关闭并检查 ' + preservedDir,
      'WorkspaceRestoreCriticalError',
    )
  }
}
export function createWorkspaceRestoreService({
  dataDir,
  inspectBackup,
  chooseSource,
  canRestore = () => true,
  scheduleRestart = () => {},
  now = () => new Date(),
  randomId,
} = {}) {
  let busy = false
  const issued = new Map()
  async function exclusive(operation) {
    if (busy) return { success: false, message: '另一项工作区恢复操作正在进行，请完成后重试' }
    busy = true
    try { return await operation() }
    catch (error) { return { success: false, message: error.message || '工作区恢复操作失败，原数据未改动' } }
    finally { busy = false }
  }
  return {
    prepare: () => exclusive(async () => {
      if (typeof chooseSource !== 'function' || typeof inspectBackup !== 'function') fail('工作区恢复服务不可用')
      const choice = await chooseSource()
      const packagePath = choice?.filePaths?.[0]
      if (choice?.canceled || !packagePath) return { success: false, canceled: true }
      const restore = await stageWorkspaceRestore({
        dataDir,
        packagePath,
        inspectBackup,
        now,
        randomId,
      })
      issued.set(restore.id, restore.receiptSHA256)
      return { success: true, restore }
    }),
    confirm: id => exclusive(async () => {
      if (!canRestore()) fail('安全恢复只在正式桌面安装版中执行；开发环境不会替换当前数据')
      const receiptSHA256 = issued.get(id)
      if (!receiptSHA256) fail('恢复预检已失效，请重新选择 .lnw 文件')
      const staged = await verifyStagedRestore(dataDir, id, receiptSHA256, inspectBackup)
      const activeDB = await activePathState(path.join(dataDir, 'data.db'), 'file')
      if (!activeDB) fail('当前数据库不存在，拒绝安排自动恢复')
      await writePendingMarker(dataDir, { id, receiptSHA256 })
      issued.delete(id)
      scheduleRestart()
      return { success: true, restartRequired: true, restore: publicPreview(staged.receipt, receiptSHA256) }
    }),
    cancel: id => exclusive(async () => {
      const receiptSHA256 = issued.get(id)
      if (!receiptSHA256) return { success: true, canceled: true }
      const staged = await verifyStagedRestore(dataDir, id, receiptSHA256, inspectBackup)
      await fs.rm(staged.stageRoot, { recursive: true, force: true })
      await fs.rm(staged.backupPath, { force: true })
      issued.delete(id)
      return { success: true, canceled: true }
    }),
  }
}
export function registerWorkspaceRestoreHandlers(ipcMain, service, isTrusted) {
  for (const [channel, method] of [
    ['workspace:restore:prepare', 'prepare'],
    ['workspace:restore:confirm', 'confirm'],
    ['workspace:restore:cancel', 'cancel'],
  ]) {
    ipcMain.handle(channel, async (event, id) => {
      if (!isTrusted(event)) return { success: false, message: '不接受来自其他页面的工作区恢复操作' }
      return service[method](id)
    })
  }
}
