import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function getDefaultDataDir() {
  const configured = process.env.NOTEPAD_DATA?.trim()
  if (configured) return configured

  const home = os.homedir()
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'Notepad')
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Notepad')
  }
  return path.join(home, '.notepad')
}

export function getDefaultBackupDir() {
  return path.join(getDefaultDataDir(), 'backups')
}

export function ensureBackupDir() {
  const backupDir = getDefaultBackupDir()
  fs.mkdirSync(backupDir, { recursive: true })
  return backupDir
}

export function parseBackupTimestamp(filename, fallbackDate = null) {
  const match = /^backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/.exec(filename)
  if (match) {
    const [, year, month, day, hour, minute, second] = match
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  if (fallbackDate instanceof Date && !Number.isNaN(fallbackDate.getTime())) {
    return fallbackDate.toISOString()
  }
  return ''
}

export async function listBackups(backupDir = '') {
  const resolvedDir = backupDir || getDefaultBackupDir()
  if (!fs.existsSync(resolvedDir)) return []

  const files = fs.readdirSync(resolvedDir)
  return files
    .filter(file => file.startsWith('backup-') && file.endsWith('.db'))
    .sort()
    .reverse()
    .map(file => {
      const filePath = path.join(resolvedDir, file)
      const stat = fs.statSync(filePath)
      return {
        name: file,
        path: filePath,
        size: stat.size,
        date: parseBackupTimestamp(file, stat.mtime),
      }
    })
}
