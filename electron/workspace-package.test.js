import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  createWorkspacePackageService,
  encodeWorkspaceHeader,
  inspectWorkspacePackage,
  registerWorkspacePackageHandlers,
  validateWorkspaceManifest,
} from './workspace-package.js'

const directories = []
afterEach(async () => {
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function fixture({ attachments = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'notepad-workspace-'))
  directories.push(root)
  const dataDir = path.join(root, 'data')
  const backupDir = path.join(dataDir, 'backups')
  const uploadDir = path.join(dataDir, 'uploads')
  await fs.mkdir(backupDir, { recursive: true })
  if (attachments) await fs.mkdir(uploadDir, { recursive: true })

  const db = Buffer.alloc(4096, 23)
  const name = 'backup-manual-20260924-120000-aabbccddeeff.db'
  await fs.writeFile(path.join(backupDir, name), db)
  const info = { name, size: db.length, sha256: digest(db), files: 7, schemaVersion: 10 }

  const files = attachments ? [
    ['image-1.png', Buffer.from('png-content')],
    ['资料.txt', Buffer.from('attachment-content')],
  ] : []
  for (const [filename, bytes] of files) await fs.writeFile(path.join(uploadDir, filename), bytes)

  const target = path.join(root, 'workspace.lnw')
  const runBackup = vi.fn(async () => info)
  const chooseDestination = vi.fn(async () => ({ canceled: false, filePath: target }))
  const chooseSource = vi.fn(async () => ({ canceled: false, filePaths: [target] }))
  const service = createWorkspacePackageService({
    dataDir,
    appVersion: '4.182.0',
    runBackup,
    chooseDestination,
    chooseSource,
    now: () => new Date('2026-09-24T12:00:00.000Z'),
  })
  return { root, dataDir, backupDir, uploadDir, target, db, info, files, runBackup, chooseDestination, chooseSource, service }
}

describe('workspace portable package', () => {
  it('exports a verified database snapshot and all flat attachments', async () => {
    const f = await fixture()
    const result = await f.service.exportPackage()
    expect(result.success).toBe(true)
    expect(result.package.format).toBe(WORKSPACE_FORMAT)
    expect(result.package.version).toBe(WORKSPACE_VERSION)
    expect(result.package.database).toMatchObject({ files: 7, schemaVersion: 10, sha256: f.info.sha256 })
    expect(result.package.attachments).toEqual({
      count: 2,
      totalBytes: f.files.reduce((sum, [, bytes]) => sum + bytes.length, 0),
    })
    expect(result.package.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(f.runBackup).toHaveBeenCalledWith(['create'])
    expect((await fs.readFile(path.join(f.backupDir, f.info.name))).equals(f.db)).toBe(true)
  })

  it('supports workspaces with no attachment directory', async () => {
    const f = await fixture({ attachments: false })
    const result = await f.service.exportPackage()
    expect(result.success).toBe(true)
    expect(result.package.attachments).toEqual({ count: 0, totalBytes: 0 })
  })

  it('inspects an exported package without writing to the active data directory', async () => {
    const f = await fixture()
    await f.service.exportPackage()
    const before = await fs.readdir(f.dataDir)
    const result = await f.service.inspectPackage()
    expect(result.success).toBe(true)
    expect(result.package.database.sha256).toBe(f.info.sha256)
    expect(await fs.readdir(f.dataDir)).toEqual(before)
  })

  it('detects package corruption in attachment bytes', async () => {
    const f = await fixture()
    await f.service.exportPackage()
    const handle = await fs.open(f.target, 'r+')
    try {
      const stat = await handle.stat()
      await handle.write(Buffer.from([0xff]), 0, 1, stat.size - 1)
    } finally { await handle.close() }
    await expect(inspectWorkspacePackage(f.target)).rejects.toThrow('内容校验失败')
  })

  it('detects manifest corruption before reading package content', async () => {
    const f = await fixture()
    await f.service.exportPackage()
    const handle = await fs.open(f.target, 'r+')
    try { await handle.write(Buffer.from([0xff]), 0, 1, 44) }
    finally { await handle.close() }
    await expect(inspectWorkspacePackage(f.target)).rejects.toThrow('清单校验失败')
  })

  it('rejects unsafe or duplicate manifest paths', () => {
    const base = {
      format: WORKSPACE_FORMAT,
      version: WORKSPACE_VERSION,
      createdAt: '2026-09-24T12:00:00.000Z',
      appVersion: '4.182.0',
      database: { entry: 'data.db', snapshot: 'backup-manual-a.db', size: 100, sha256: 'a'.repeat(64), files: 1, schemaVersion: 10 },
      attachments: { count: 1, totalBytes: 1 },
      entries: [
        { kind: 'database', path: 'data.db', size: 100, sha256: 'a'.repeat(64) },
        { kind: 'attachment', path: 'uploads/../escape', size: 1, sha256: 'b'.repeat(64) },
      ],
    }
    expect(() => validateWorkspaceManifest(base)).toThrow('附件路径')
    const duplicate = structuredClone(base)
    duplicate.entries[1].path = 'data.db'
    expect(() => validateWorkspaceManifest(duplicate)).toThrow()
  })

  it('rejects unsupported future database schemas', () => {
    const manifest = {
      format: WORKSPACE_FORMAT,
      version: WORKSPACE_VERSION,
      createdAt: '2026-09-24T12:00:00.000Z',
      appVersion: '9.0.0',
      database: { entry: 'data.db', snapshot: 'backup-manual-a.db', size: 100, sha256: 'a'.repeat(64), files: 1, schemaVersion: 999 },
      attachments: { count: 0, totalBytes: 0 },
      entries: [{ kind: 'database', path: 'data.db', size: 100, sha256: 'a'.repeat(64) }],
    }
    expect(() => encodeWorkspaceHeader(manifest)).toThrow('数据库信息')
  })

  it('never overwrites an existing destination', async () => {
    const f = await fixture()
    await fs.writeFile(f.target, 'existing')
    const result = await f.service.exportPackage()
    expect(result.success).toBe(false)
    expect(result.message).toContain('已存在')
    expect(await fs.readFile(f.target, 'utf8')).toBe('existing')
  })

  it('canceling export creates no portable file', async () => {
    const f = await fixture()
    f.chooseDestination.mockResolvedValue({ canceled: true })
    expect(await f.service.exportPackage()).toEqual({ success: false, canceled: true })
    await expect(fs.stat(f.target)).rejects.toThrow()
  })

  it('canceling inspection does not report success', async () => {
    const f = await fixture()
    f.chooseSource.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await f.service.inspectPackage()).toEqual({ success: false, canceled: true })
  })

  it('rejects attachment subdirectories instead of silently omitting them', async () => {
    const f = await fixture()
    await fs.mkdir(path.join(f.uploadDir, 'nested'))
    const result = await f.service.exportPackage()
    expect(result.success).toBe(false)
    expect(result.message).toContain('子目录')
    await expect(fs.stat(f.target)).rejects.toThrow()
  })

  it('rejects an export destination inside the active data directory', async () => {
    const f = await fixture()
    f.chooseDestination.mockResolvedValue({ canceled: false, filePath: path.join(f.dataDir, 'copy.lnw') })
    const result = await f.service.exportPackage()
    expect(result.success).toBe(false)
    expect(result.message).toContain('数据目录之外')
  })

  it('serializes concurrent package operations', async () => {
    const f = await fixture()
    let resolve
    f.runBackup.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = f.service.exportPackage()
    expect((await f.service.inspectPackage()).message).toContain('正在进行')
    resolve(f.info)
    await pending
  })

  it('IPC exposes only native-dialog export and inspection to trusted frames', async () => {
    const handlers = new Map()
    const service = { exportPackage: vi.fn(), inspectPackage: vi.fn() }
    registerWorkspacePackageHandlers({ handle: (key, fn) => handlers.set(key, fn) }, service, event => event.trusted === true)
    expect([...handlers.keys()]).toEqual(['workspace:export', 'workspace:inspect'])
    expect((await handlers.get('workspace:export')({ trusted: false })).success).toBe(false)
    expect(service.exportPackage).not.toHaveBeenCalled()
    await handlers.get('workspace:inspect')({ trusted: true })
    expect(service.inspectPackage).toHaveBeenCalledTimes(1)
  })
})
