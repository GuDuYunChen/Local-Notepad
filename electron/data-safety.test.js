import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDataSafetyService, registerDataSafetyHandlers, runBackupCommand, validateBackupName } from './data-safety.js'

const directories = []
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); vi.restoreAllMocks() })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'notepad-safety-')); directories.push(root)
  const dataDir = path.join(root, 'data'); await fs.mkdir(path.join(dataDir, 'backups'), { recursive: true })
  const name = 'backup-manual-20260923-120000-aabbccddeeff.db'
  const source = path.join(dataDir, 'backups', name); const bytes = Buffer.alloc(4096, 25); await fs.writeFile(source, bytes)
  const info = { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files: 3, schemaVersion: 9 }
  const target = path.join(root, 'exported.db')
  const run = vi.fn(async () => info), chooseDestination = vi.fn(async () => ({ filePath: target, canceled: false }))
  return { root, dataDir, name, source, bytes, info, target, run, chooseDestination,
    service: createDataSafetyService({ dataDir, run, chooseDestination }) }
}

describe('data safety desktop operations', () => {
  it('rejects arbitrary paths, control characters and invalid backup names', () => {
    for (const name of ['../data.db', 'data.db', '/etc/passwd', 'backup-a.db?x=y', 'backup-a\n.db', 'backup-..\\a.db', null, {}, 'backup-.db']) {
      expect(() => validateBackupName(name)).toThrow()
    }
    expect(validateBackupName('backup-20260923-120000.db')).toContain('backup-')
  })
  it('calls only the fixed create subcommand', async () => { const f = await fixture(); expect((await f.service.create()).success).toBe(true); expect(f.run).toHaveBeenCalledWith(['create']) })
  it('validates only a named regular backup', async () => { const f = await fixture(); expect(await f.service.inspect(f.name)).toEqual({ success: true, backup: f.info }); expect(f.run).toHaveBeenCalledWith(['inspect', f.name]) })
  it('rejects a missing source without calling the backend', async () => { const f = await fixture(); await fs.unlink(f.source); expect((await f.service.inspect(f.name)).success).toBe(false); expect(f.run).not.toHaveBeenCalled() })
  it('rejects directories disguised as DB files', async () => { const f = await fixture(); await fs.unlink(f.source); await fs.mkdir(f.source); expect((await f.service.inspect(f.name)).success).toBe(false) })
  it('rejects backup file symlinks', async () => {
    const f = await fixture(); await fs.unlink(f.source)
    // Linux CI supplies unprivileged symlinks. On Windows this suite runs before packaging on Linux.
    await fs.symlink(f.target, f.source); expect((await f.service.inspect(f.name)).success).toBe(false)
  })
  it('creates a real independently verified output and leaves the source untouched', async () => {
    const f = await fixture(); const result = await f.service.export(f.name)
    expect(result).toEqual({ success: true, path: f.target, backup: f.info })
    expect(await fs.readFile(f.target)).toEqual(f.bytes); expect(await fs.readFile(f.source)).toEqual(f.bytes)
    expect(f.run).toHaveBeenCalledTimes(2)
  })
  it('canceling the native dialog produces no file and no success', async () => {
    const f = await fixture(); f.chooseDestination.mockResolvedValue({ canceled: true })
    expect(await f.service.export(f.name)).toEqual({ success: false, canceled: true }); await expect(fs.stat(f.target)).rejects.toThrow()
  })
  it('never overwrites an existing destination even after native dialog confirmation', async () => {
    const f = await fixture(); await fs.writeFile(f.target, 'old backup')
    expect((await f.service.export(f.name)).message).toContain('已存在'); expect(await fs.readFile(f.target, 'utf8')).toBe('old backup')
  })
  it('refuses destinations inside the active data directory', async () => {
    const f = await fixture(); f.chooseDestination.mockResolvedValue({ filePath: path.join(f.dataDir, 'data.db') })
    expect((await f.service.export(f.name)).message).toContain('数据目录之外'); await expect(fs.stat(path.join(f.dataDir, 'data.db'))).rejects.toThrow()
  })
  it('also refuses a destination parent symlink pointing into the data directory', async () => {
    const f = await fixture(); const alias = path.join(f.root, 'alias'); await fs.symlink(f.dataDir, alias, 'dir')
    f.chooseDestination.mockResolvedValue({ filePath: path.join(alias, 'copy.db') }); expect((await f.service.export(f.name)).success).toBe(false)
  })
  it('revalidates after the save dialog and refuses changed source data', async () => {
    const f = await fixture(); f.run.mockResolvedValueOnce(f.info).mockResolvedValueOnce({ ...f.info, sha256: '1'.repeat(64) })
    expect((await f.service.export(f.name)).message).toContain('已变化'); await expect(fs.stat(f.target)).rejects.toThrow()
  })
  it('removes only its own partial output on post-copy hash mismatch', async () => {
    const f = await fixture(); await fs.writeFile(f.source, Buffer.alloc(4096, 77))
    expect((await f.service.export(f.name)).message).toContain('不一致'); await expect(fs.stat(f.target)).rejects.toThrow()
    expect(await fs.readFile(f.source)).toEqual(Buffer.alloc(4096, 77))
  })
  it('integrity failures never offer a save dialog', async () => {
    const f = await fixture(); f.run.mockRejectedValue(new Error('bad database'))
    expect((await f.service.export(f.name)).message).toBe('bad database'); expect(f.chooseDestination).not.toHaveBeenCalled()
  })
  it('locks concurrent operations and releases the lock after completion', async () => {
    const f = await fixture(); let resolve; f.run.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = f.service.create(); expect((await f.service.create()).message).toContain('正在进行')
    resolve(f.info); await pending; expect((await f.service.inspect(f.name)).success).toBe(true)
  })
  it('releases operation locks after a failure', async () => {
    const f = await fixture(); f.run.mockRejectedValueOnce(new Error('not ready'))
    expect((await f.service.create()).success).toBe(false); expect((await f.service.create()).success).toBe(true)
  })
  it('reports an unavailable native tool without running a shell', async () => {
    const f = await fixture(); await expect(runBackupCommand(path.join(f.root, 'missing.exe'), f.dataDir, ['create'])).rejects.toThrow('build:backend')
  })
  it('IPC rejects untrusted frames and exposes no restore or arbitrary-file operation', async () => {
    const handlers = new Map(); const service = { create: vi.fn(), inspect: vi.fn(), export: vi.fn() }
    registerDataSafetyHandlers({ handle: (key, fn) => handlers.set(key, fn) }, service, event => event.trusted === true)
    expect([...handlers.keys()]).toEqual(['backup:create', 'backup:inspect', 'backup:export'])
    expect((await handlers.get('backup:create')({ trusted: false })).success).toBe(false)
    expect(service.create).not.toHaveBeenCalled(); await handlers.get('backup:inspect')({ trusted: true }, 'backup-a.db')
    expect(service.inspect).toHaveBeenCalledWith('backup-a.db')
  })
})
