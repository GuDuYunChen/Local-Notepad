import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getDefaultBackupDir,
  getDefaultDataDir,
  listBackups,
  parseBackupTimestamp,
} from './backup.js'

const originalDataDir = process.env.NOTEPAD_DATA

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.NOTEPAD_DATA
  else process.env.NOTEPAD_DATA = originalDataDir
})

describe('automatic backup helpers', () => {
  it('respects NOTEPAD_DATA when resolving the backup directory', () => {
    process.env.NOTEPAD_DATA = path.join(os.tmpdir(), 'notepad-custom-data')
    expect(getDefaultDataDir()).toBe(process.env.NOTEPAD_DATA)
    expect(getDefaultBackupDir()).toBe(path.join(process.env.NOTEPAD_DATA, 'backups'))
  })

  it('parses backup filenames as local timestamps', () => {
    const parsed = new Date(parseBackupTimestamp('backup-20260918-153045.db'))
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(8)
    expect(parsed.getDate()).toBe(18)
    expect(parsed.getHours()).toBe(15)
    expect(parsed.getMinutes()).toBe(30)
    expect(parsed.getSeconds()).toBe(45)
  })

  it('falls back to file mtime for an unexpected backup filename', () => {
    const fallback = new Date('2026-09-18T10:20:30.000Z')
    expect(parseBackupTimestamp('backup-legacy.db', fallback)).toBe(fallback.toISOString())
  })

  it('lists only database backups newest first with valid dates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-backups-'))
    try {
      fs.writeFileSync(path.join(dir, 'backup-20260918-010203.db'), 'older')
      fs.writeFileSync(path.join(dir, 'backup-20260918-040506.db'), 'newer-content')
      fs.writeFileSync(path.join(dir, 'ignore.txt'), 'ignore')

      const backups = await listBackups(dir)
      expect(backups).toHaveLength(2)
      expect(backups[0].name).toBe('backup-20260918-040506.db')
      expect(backups[1].name).toBe('backup-20260918-010203.db')
      expect(backups[0].size).toBe(Buffer.byteLength('newer-content'))
      expect(Number.isNaN(new Date(backups[0].date).getTime())).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('verified snapshot listing', () => {
  it('parses manual and collision-safe automatic timestamps', () => {
    for (const name of ['backup-manual-20260923-120000-aabbccddeeff.db', 'backup-20260923-120000-aabbccddeeff.db']) {
      const date = new Date(parseBackupTimestamp(name)); expect(date.getFullYear()).toBe(2026); expect(date.getHours()).toBe(12)
    }
  })
  it('does not list directories with backup-looking names', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-safe-'))
    try { fs.mkdirSync(path.join(dir, 'backup-folder.db')); expect(await listBackups(dir)).toEqual([]) }
    finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
