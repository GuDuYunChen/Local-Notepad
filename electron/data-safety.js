import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const backupName = /^backup-(?:manual-)?[a-zA-Z0-9-]+\.db$/

export function validateBackupName(name) {
  if (typeof name !== 'string' || name.length > 180 || !backupName.test(name)) {
    throw new Error('无效备份名称；不能读取任意路径')
  }
  return name
}
async function hashFile(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}
const inside = (root, target) => {
  const relative = path.relative(root, target)
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

export async function runBackupCommand(binary, dataDir, args) {
  try { await fs.access(binary) } catch {
    throw new Error('数据安全工具尚未构建；开发环境请先运行 npm run build:backend，安装版请重新安装完整应用')
  }
  const { stdout } = await exec(binary, ['--data-safety', ...args], {
    env: { ...process.env, NOTEPAD_DATA: dataDir },
    timeout: 100000, maxBuffer: 128 * 1024, windowsHide: true,
  })
  let result
  try { result = JSON.parse(stdout) } catch { throw new Error('数据安全工具返回无效结果，请更新后端程序') }
  if (result?.success !== true) throw new Error(result?.message || '数据库操作未完成')
  const info = result.backup
  if (!info || !backupName.test(info.name) || !/^[a-f0-9]{64}$/.test(info.sha256) ||
    !Number.isSafeInteger(info.size) || info.size < 100 || !Number.isSafeInteger(info.files) || info.files < 0 ||
    !Number.isInteger(info.schemaVersion) || info.schemaVersion < 1 || info.schemaVersion > 10) {
    throw new Error('数据库校验回执不完整')
  }
  return info
}

// Paths come from the fixed backup folder and an OS save dialog, never renderer paths.
// All actions share a lock and never stop the running backend or alter manuscript data.
export function createDataSafetyService({ dataDir, run, chooseDestination }) {
  let busy = false
  async function exclusive(operation) {
    if (busy) return { success: false, message: '另一项数据库备份操作正在进行，请完成后重试' }
    busy = true
    try { return await operation() }
    catch (error) { return { success: false, message: error.message || '操作失败，原数据未改动' } }
    finally { busy = false }
  }
  async function sourcePath(name) {
    validateBackupName(name)
    const dir = path.join(dataDir, 'backups')
    const folder = await fs.lstat(dir)
    if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error('备份目录不安全或不可用')
    const source = path.join(dir, name)
    const stat = await fs.lstat(source)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('不接受符号链接或非普通备份文件')
    return source
  }
  return {
    create: () => exclusive(async () => ({ success: true, backup: await run(['create']) })),
    inspect: name => exclusive(async () => {
      await sourcePath(name)
      return { success: true, backup: await run(['inspect', name]) }
    }),
    export: name => exclusive(async () => {
      const source = await sourcePath(name)
      const info = await run(['inspect', name])
      const choice = await chooseDestination(name)
      if (choice?.canceled || !choice?.filePath) return { success: false, canceled: true }
      const target = path.resolve(choice.filePath)
      const parent = await fs.realpath(path.dirname(target))
      const root = await fs.realpath(dataDir)
      if (inside(root, path.join(parent, path.basename(target)))) {
        throw new Error('请另存到应用数据目录之外，避免与当前数据库或自动备份混淆')
      }
      // Re-check after the native dialog, which can remain open for any duration.
      await sourcePath(name)
      const fresh = await run(['inspect', name])
      if (fresh.sha256 !== info.sha256) throw new Error('选择保存位置期间备份已变化，请重新校验并导出')
      let file
      try { file = await fs.open(target, 'wx', 0o600) } catch (error) {
        if (error.code === 'EEXIST') throw new Error('目标文件已存在；为保护已有备份，请使用新的文件名')
        throw error
      }
      const owned = await file.stat()
      try {
        await pipeline(createReadStream(source), createWriteStream(target, { fd: file.fd, autoClose: false }))
        await file.sync()
        if (await hashFile(target) !== info.sha256 || await hashFile(source) !== info.sha256) {
          throw new Error('导出文件与已校验备份不一致，未确认导出成功')
        }
        await file.close(); file = null
        return { success: true, path: target, backup: info }
      } catch (error) {
        await file?.close().catch(() => {}); file = null
        // Only remove the incomplete output we created, never an existing/changed file.
        const now = await fs.lstat(target).catch(() => null)
        if (now && now.dev === owned.dev && now.ino === owned.ino) await fs.unlink(target).catch(() => {})
        throw error
      }
    }),
  }
}

export function registerDataSafetyHandlers(ipcMain, service, isTrusted) {
  for (const [channel, method] of [['backup:create', 'create'], ['backup:inspect', 'inspect'], ['backup:export', 'export']]) {
    ipcMain.handle(channel, async (event, name) => {
      if (!isTrusted(event)) return { success: false, message: '不接受来自其他页面的数据库操作' }
      return service[method](name)
    })
  }
}
