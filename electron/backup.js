import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'

export async function handleBackup(backupDir) {
  const dbPath = process.env.NOTEPAD_DB_PATH || getDefaultDBPath()
  
  if (!fs.existsSync(dbPath)) {
    throw new Error('数据库文件不存在')
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = path.join(backupDir, `backup-${timestamp}.db`)
  
  fs.copyFileSync(dbPath, backupPath)
  return { success: true, path: backupPath }
}

export async function handleRestore(backupFile) {
  if (!fs.existsSync(backupFile)) {
    throw new Error('备份文件不存在')
  }
  
  const dbPath = process.env.NOTEPAD_DB_PATH || getDefaultDBPath()
  const dbDir = path.dirname(dbPath)
  
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  
  const tempPath = dbPath + '.tmp.restore'
  fs.copyFileSync(backupFile, tempPath)
  fs.renameSync(tempPath, dbPath)
  
  const walPath = dbPath + '-wal'
  const shmPath = dbPath + '-shm'
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
  
  if (ipcMain) {
    ipcMain.emit('db:restored')
  }
  
  return { success: true }
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
