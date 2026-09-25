import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspacePackageService } from './workspace-package.js'
import {
  RESTORE_PENDING_FILE,
  applyPendingWorkspaceRestore,
  createWorkspaceRestoreService,
  registerWorkspaceRestoreHandlers,
  rollbackAppliedWorkspaceRestore,
  stageWorkspaceRestore,
} from './workspace-restore.js'

const directories = []
afterEach(async () => {
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'notepad-restore-'))
  directories.push(root)
  const dataDir = path.join(root, 'data')
  await fs.mkdir(path.join(dataDir, 'backups'), { recursive: true })
  await fs.mkdir(path.join(dataDir, 'uploads'), { recursive: true })
  const oldDB = Buffer.alloc(4096, 11); Buffer.from('SQLite format 3\0', 'binary').copy(oldDB, 0)
  await fs.writeFile(path.join(dataDir, 'data.db'), oldDB)
  await fs.writeFile(path.join(dataDir, 'data.db-wal'), 'old-wal')
  await fs.writeFile(path.join(dataDir, 'data.db-shm'), 'old-shm')
  await fs.writeFile(path.join(dataDir, 'uploads', 'old.txt'), 'old attachment')

  const sourceRoot = path.join(root, 'source')
  const sourceData = path.join(sourceRoot, 'data')
  await fs.mkdir(path.join(sourceData, 'backups'), { recursive: true })
  await fs.mkdir(path.join(sourceData, 'uploads'), { recursive: true })
  const newDB = Buffer.alloc(4096, 23); Buffer.from('SQLite format 3\0', 'binary').copy(newDB, 0)
  const sourceBackupName = 'backup-manual-20260925-120000-aabbccddeeff.db'
  await fs.writeFile(path.join(sourceData, 'backups', sourceBackupName), newDB)
  await fs.writeFile(path.join(sourceData, 'uploads', 'new-a.txt'), 'new attachment a')
  await fs.writeFile(path.join(sourceData, 'uploads', '新资料.txt'), 'new attachment b')
  const sourceInfo = {
    name: sourceBackupName, size: newDB.length, sha256: digest(newDB), files: 9, schemaVersion: 10,
  }
  const packagePath = path.join(root, 'portable.lnw')
  const exporter = createWorkspacePackageService({
    dataDir: sourceData,
    appVersion: '4.183.0',
    runBackup: vi.fn(async () => sourceInfo),
    chooseDestination: vi.fn(async () => ({ canceled: false, filePath: packagePath })),
    chooseSource: vi.fn(async () => ({ canceled: false, filePaths: [packagePath] })),
    now: () => new Date('2026-09-25T12:00:00.000Z'),
  })
  expect((await exporter.exportPackage()).success).toBe(true)

  const inspectBackup = vi.fn(async args => {
    expect(args[0]).toBe('inspect')
    const filename = path.join(dataDir, 'backups', args[1])
    const bytes = await fs.readFile(filename)
    return {
      name: args[1], size: bytes.length, sha256: digest(bytes), files: 9, schemaVersion: 10,
    }
  })
  return {
    root, dataDir, oldDB, newDB, packagePath, inspectBackup,
    chooseSource: vi.fn(async () => ({ canceled: false, filePaths: [packagePath] })),
  }
}
async function makeService(f, overrides = {}) {
  const scheduleRestart = vi.fn()
  const service = createWorkspaceRestoreService({
    dataDir: f.dataDir,
    inspectBackup: f.inspectBackup,
    chooseSource: f.chooseSource,
    canRestore: () => true,
    scheduleRestart,
    now: () => new Date('2026-09-25T13:00:00.000Z'),
    randomId: () => 'a'.repeat(24),
    ...overrides,
  })
  return { service, scheduleRestart }
}

describe('staged workspace restore', () => {
  it('preflights the package into a verified backup plus staged attachments', async () => {
    const f = await fixture()
    const restore = await stageWorkspaceRestore({
      dataDir: f.dataDir, packagePath: f.packagePath, inspectBackup: f.inspectBackup,
      now: () => new Date('2026-09-25T13:00:00.000Z'), randomId: () => 'a'.repeat(24),
    })
    expect(restore.database).toMatchObject({ files: 9, schemaVersion: 10, sha256: digest(f.newDB) })
    expect(restore.attachments.count).toBe(2)
    expect(await fs.readFile(path.join(f.dataDir, 'data.db'))).toEqual(f.oldDB)
    expect(await fs.readFile(path.join(f.dataDir, 'backups', restore.database.backupName))).toEqual(f.newDB)
    expect((await fs.readdir(path.join(f.dataDir, 'workspace-restore-staging', restore.id, 'uploads'))).sort()).toEqual(['new-a.txt', '新资料.txt'].sort())
  })

  it('confirm writes a durable marker and schedules restart without live replacement', async () => {
    const f = await fixture()
    const { service, scheduleRestart } = await makeService(f)
    const prepared = await service.prepare()
    const confirmed = await service.confirm(prepared.restore.id)
    expect(confirmed).toMatchObject({ success: true, restartRequired: true })
    expect(scheduleRestart).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(path.join(f.dataDir, 'data.db'))).toEqual(f.oldDB)
    const marker = JSON.parse(await fs.readFile(path.join(f.dataDir, RESTORE_PENDING_FILE), 'utf8'))
    expect(marker.id).toBe(prepared.restore.id)
  })

  it('cancel removes only the issued stage and imported restore backup', async () => {
    const f = await fixture()
    const { service } = await makeService(f)
    const prepared = await service.prepare()
    const backup = path.join(f.dataDir, 'backups', prepared.restore.database.backupName)
    expect(await fs.stat(backup)).toBeTruthy()
    expect((await service.cancel(prepared.restore.id)).success).toBe(true)
    await expect(fs.stat(backup)).rejects.toThrow()
    await expect(fs.stat(path.join(f.dataDir, 'workspace-restore-staging', prepared.restore.id))).rejects.toThrow()
    expect(await fs.readFile(path.join(f.dataDir, 'data.db'))).toEqual(f.oldDB)
  })

  it('rejects confirm in development mode without writing a pending marker', async () => {
    const f = await fixture()
    const { service } = await makeService(f, { canRestore: () => false })
    const prepared = await service.prepare()
    const result = await service.confirm(prepared.restore.id)
    expect(result.success).toBe(false)
    expect(result.message).toContain('正式桌面安装版')
    await expect(fs.stat(path.join(f.dataDir, RESTORE_PENDING_FILE))).rejects.toThrow()
  })

  it('applies a pending restore before backend startup and preserves the old state', async () => {
    const f = await fixture()
    const { service } = await makeService(f)
    const prepared = await service.prepare()
    await service.confirm(prepared.restore.id)
    const result = await applyPendingWorkspaceRestore({
      dataDir: f.dataDir, inspectBackup: f.inspectBackup,
      now: () => new Date('2026-09-25T14:00:00.000Z'),
    })
    expect(result.status).toBe('applied')
    expect(await fs.readFile(path.join(f.dataDir, 'data.db'))).toEqual(f.newDB)
    expect(await fs.readFile(path.join(f.dataDir, 'uploads', 'new-a.txt'), 'utf8')).toBe('new attachment a')
    expect(await fs.readFile(path.join(result.preservedDir, 'data.db'))).toEqual(f.oldDB)
    expect(await fs.readFile(path.join(result.preservedDir, 'uploads', 'old.txt'), 'utf8')).toBe('old attachment')
    expect(await fs.readFile(path.join(result.preservedDir, 'data.db-wal'), 'utf8')).toBe('old-wal')
    await expect(fs.stat(path.join(f.dataDir, RESTORE_PENDING_FILE))).rejects.toThrow()
  })

  it('automatically rolls back if a failure occurs after preserving old data', async () => {
    const f = await fixture()
    const { service } = await makeService(f)
    const prepared = await service.prepare()
    await service.confirm(prepared.restore.id)
    const result = await applyPendingWorkspaceRestore({
      dataDir: f.dataDir, inspectBackup: f.inspectBackup,
      now: () => new Date('2026-09-25T14:00:00.000Z'),
      faultInjector: phase => { if (phase === 'after-preserve') throw new Error('synthetic failure') },
    })
    expect(result.status).toBe('rolled-back')
    expect(result.error).toContain('synthetic failure')
    expect(await fs.readFile(path.join(f.dataDir, 'data.db'))).toEqual(f.oldDB)
    expect(await fs.readFile(path.join(f.dataDir, 'uploads', 'old.txt'), 'utf8')).toBe('old attachment')
    await expect(fs.stat(path.join(f.dataDir, RESTORE_PENDING_FILE))).rejects.toThrow()
  })

  it('rolls an applied workspace back after backend health validation fails', async () => {
    const f = await fixture()
    const { service } = await makeService(f)
    const prepared = await service.prepare()
    await service.confirm(prepared.restore.id)
    const applied = await applyPendingWorkspaceRestore({
      dataDir: f.dataDir, inspectBackup: f.inspectBackup,
      now: () => new Date('2026-09-25T14:00:00.000Z'),
    })
    const rolled = await rollbackAppliedWorkspaceRestore({
      dataDir: f.dataDir, restore: applied,
      now: () => new Date('2026-09-25T14:05:00.000Z'),
    })
    expect(rolled.status).toBe('rolled-back-health')
    expect(await fs.readFile(path.join(f.dataDir, 'data.db'))).toEqual(f.oldDB)
    expect(await fs.readFile(path.join(f.dataDir, 'uploads', 'old.txt'), 'utf8')).toBe('old attachment')
    expect(await fs.readFile(path.join(rolled.failedDir, 'data.db'))).toEqual(f.newDB)
  })

  it('refuses a tampered stage before moving active data', async () => {
    const f = await fixture()
    const { service } = await makeService(f)
    const prepared = await service.prepare()
    await service.confirm(prepared.restore.id)
    await fs.writeFile(path.join(f.dataDir, 'workspace-restore-staging', prepared.restore.id, 'uploads', 'new-a.txt'), 'tampered')
    await expect(applyPendingWorkspaceRestore({
      dataDir: f.dataDir, inspectBackup: f.inspectBackup,
    })).rejects.toThrow('已变化')
    expect(await fs.readFile(path.join(f.dataDir, 'data.db'))).toEqual(f.oldDB)
  })

  it('serializes prepare/confirm operations and requires an issued preview', async () => {
    const f = await fixture()
    let resolve
    f.chooseSource.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const { service } = await makeService(f)
    const pending = service.prepare()
    expect((await service.confirm('a'.repeat(24))).message).toContain('正在进行')
    resolve({ canceled: true, filePaths: [] })
    await pending
    expect((await service.confirm('a'.repeat(24))).message).toContain('预检已失效')
  })

  it('IPC exposes only staged prepare/confirm/cancel to trusted renderer frames', async () => {
    const handlers = new Map()
    const service = { prepare: vi.fn(), confirm: vi.fn(), cancel: vi.fn() }
    registerWorkspaceRestoreHandlers({ handle: (key, fn) => handlers.set(key, fn) }, service, event => event.trusted === true)
    expect([...handlers.keys()]).toEqual([
      'workspace:restore:prepare', 'workspace:restore:confirm', 'workspace:restore:cancel',
    ])
    expect((await handlers.get('workspace:restore:prepare')({ trusted: false })).success).toBe(false)
    await handlers.get('workspace:restore:confirm')({ trusted: true }, 'a'.repeat(24))
    expect(service.confirm).toHaveBeenCalledWith('a'.repeat(24))
  })
})
