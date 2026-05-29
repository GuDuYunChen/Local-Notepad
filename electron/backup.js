import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'

export async function handleBackup(backupDir) {
  void backupDir
  throw new Error('当前版本已禁用桌面端手工备份。应用使用 SQLite WAL 模式，直接复制在线数据库可能生成损坏备份，请使用应用自动备份目录中的备份文件。')
}

export async function handleRestore(backupFile) {
  void backupFile
  void ipcMain
  throw new Error('当前版本已禁用桌面端手工恢复。请先完全退出应用，再使用自动备份目录中的备份文件或恢复脚本进行离线恢复。')
}

export async function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) {
    return []
  }
  
  const files = fs.readdirSync(backupDir)
  return files
    .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
    .sort()
    .reverse()
    .map(f => ({
      name: f,
      path: path.join(backupDir, f),
      size: fs.statSync(path.join(backupDir, f)).size,
      date: new Date(f.replace('backup-', '').replace('.db', '').replace(/-/g, ':').replace(/T/, ' ')).toISOString()
    }))
}

function getDefaultDBPath() {
  const home = process.env.HOME || process.env.USERPROFILE
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'Notepad', 'data.db')
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Notepad', 'data.db')
  } else {
    return path.join(home, '.notepad', 'data.db')
  }
}
