import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  processExport,
  exportCombinedManuscript,
  exportToPDF,
  exportToHTML,
} from './export.js'
import { parseImportPaths, selectAndParseFiles } from './import.js'
import { ensureBackupDir, getDefaultBackupDir, getDefaultDataDir, listBackups } from './backup.js'
import { spawnManagedBackend, stopChildProcess, waitForHttpService } from './backend-process.js'
import { createQuitSaveGate } from './quit-save.mjs'
import { createWebDAVSecretStore } from './webdav-secret.js'
import { createDataSafetyService, runBackupCommand, registerDataSafetyHandlers } from './data-safety.js'
import { createWorkspacePackageService, registerWorkspacePackageHandlers } from './workspace-package.js'
import {
  applyPendingWorkspaceRestore,
  createWorkspaceRestoreService,
  registerWorkspaceRestoreHandlers,
  rollbackAppliedWorkspaceRestore,
} from './workspace-restore.js'
import { classifyNavigation } from './navigation.js'
import { APP_ICON_DATA_URL } from '../src/assets/appIconData.js'

// 应用主进程：负责创建窗口、设置安全选项
let mainWindow = null
let backend = null
let allowQuit = false
let quitting = false
let quitPromise = null
let backendStartPromise = null
const rendererQuit = createQuitSaveGate({ ipcMain })
const approvedWindowCloses = new WeakSet()
let windowClosePromise = null
const webdavSecrets = createWebDAVSecretStore({ dataDir: getDefaultDataDir(), safeStorage })

async function createWindow(startupRestore = { status: 'none' }) {
  const isDev = !app.isPackaged
  const appIcon = nativeImage.createFromDataURL(APP_ICON_DATA_URL)

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: '#f6f6f8',
    title: 'Notepad',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const windowForClose = mainWindow
  // Intercept X / Alt+F4 before the renderer is destroyed, not window-all-closed.
  windowForClose.on('close', event => {
    if (allowQuit || approvedWindowCloses.has(windowForClose)) return
    event.preventDefault()
    if (process.platform !== 'darwin' || quitting) { app.quit(); return }
    // macOS close preserves the running application; Cmd+Q takes before-quit.
    if (windowClosePromise) return
    windowClosePromise = rendererQuit.prepare(windowForClose).then(() => {
      approvedWindowCloses.add(windowForClose)
      windowForClose.close()
    }).catch(error => {
      rendererQuit.release()
      dialog.showErrorBox('正文尚未确认保存，已取消关闭', String(error?.message || error))
    }).finally(() => { windowClosePromise = null })
  })
  mainWindow.on('closed', () => {
    rendererQuit.release()
    mainWindow = null
  })
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, isDev) === 'external') {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (quitting || windowClosePromise) { event.preventDefault(); return }
    const classification = classifyNavigation(url, isDev)
    if (classification === 'internal') return

    event.preventDefault()
    if (classification === 'external') {
      void shell.openExternal(url)
    }
  })

  if (isDev) {
    process.env.API_BASE = 'http://127.0.0.1:27121'
    await mainWindow.loadURL('http://localhost:5000')
    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    process.env.API_BASE = 'http://127.0.0.1:27121'
    // 使用 app.getAppPath() 获取应用根目录 (asar 内部根目录)，确保路径解析正确
    const indexPath = path.join(app.getAppPath(), 'dist/index.html')
    await startBackend()

    let backendReady = await waitForHttpService(`${process.env.API_BASE}/api/health`, {
      timeoutMs: 8000,
      intervalMs: 120,
    })
    let healthRollback = null
    if (!backendReady && startupRestore?.status === 'applied') {
      const failedChild = backend
      try {
        if (failedChild) await stopChildProcess(failedChild, 2500)
        if (backend === failedChild) backend = null
        healthRollback = await rollbackAppliedWorkspaceRestore({
          dataDir: getDefaultDataDir(),
          restore: startupRestore,
        })
        await startBackend()
        backendReady = await waitForHttpService(`${process.env.API_BASE}/api/health`, {
          timeoutMs: 8000,
          intervalMs: 120,
        })
      } catch (error) {
        dialog.showErrorBox(
          '工作区恢复回滚失败',
          String(error?.message || error) + '\n\n为避免继续写入不确定的数据状态，应用将退出。'
        )
        // A failed stop must not allow live data replacement or bypass shutdown.
        allowQuit = !backend
        app.quit()
        return
      }
    }

    if (!backendReady) {
      dialog.showErrorBox(
        '后端服务未就绪',
        healthRollback
          ? '恢复后的工作区未通过启动验证，已尝试回滚到恢复前数据，但本地数据服务仍未能启动。请检查恢复保留目录后再继续。'
          : '本地数据服务未能在 8 秒内启动。应用仍会打开，但文件功能可能暂时不可用。'
      )
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadFile(indexPath)
    }

    if (mainWindow && !mainWindow.isDestroyed() && backendReady) {
      if (healthRollback) {
        void dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '工作区恢复已自动回滚',
          message: '新工作区未通过后端启动验证，应用已恢复到恢复前的数据。',
          detail: '本次失败的数据保留在：' + healthRollback.failedDir,
        })
      } else if (startupRestore?.status === 'rolled-back') {
        void dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '工作区恢复未应用',
          message: '恢复过程中出现问题，原数据已自动回滚。',
          detail: String(startupRestore.error || '') + '\n恢复前数据记录：' + String(startupRestore.preservedDir || ''),
        })
      } else if (startupRestore?.status === 'applied') {
        void dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '工作区恢复完成',
          message: '正文数据库和附件已恢复，并通过本地服务启动验证。',
          detail: '恢复前的数据已永久保留在：' + startupRestore.preservedDir,
        })
      }
    }
  }

}
app.commandLine.appendSwitch('disable-features', 'Autofill')
app.commandLine.appendSwitch('lang', 'zh-CN')

app.whenReady().then(async () => {
  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [{ role: 'quit', label: '退出' }],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => { if (!quitting && !windowClosePromise) mainWindow?.reload() } },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [{ role: 'about', label: '关于' }],
    },
  ])
  Menu.setApplicationMenu(menu)
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  let startupRestore = { status: 'none' }
  if (app.isPackaged) {
    try {
      startupRestore = await applyPendingWorkspaceRestore({
        dataDir: getDefaultDataDir(),
        inspectBackup: runDataSafety,
      })
    } catch (error) {
      dialog.showErrorBox(
        '工作区恢复需要人工检查',
        String(error?.message || error) + '\n\n为避免创建空数据库或继续写入，应用不会启动本地数据服务。'
      )
      allowQuit = true
      app.quit()
      return
    }
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  await createWindow(startupRestore)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow({ status: 'none' })
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (allowQuit) return
  event.preventDefault()
  if (quitPromise) return
  quitting = true
  quitPromise = (async () => {
    // Keep the window and backend alive until the renderer confirms all tracked
    // editor content is saved. Failure must not send a backend shutdown command.
    await rendererQuit.prepare(mainWindow)
    // A pending secret load must not spawn a child after shutdown starts.
    await backendStartPromise
    const child = backend
    if (child) {
      const receipt = await stopChildProcess(child, 2500)
      if (receipt.forced || receipt.clean === false) console.warn('后端异常结束；同步恢复记录保留')
      if (backend === child) backend = null
    }
    allowQuit = true
    app.quit()
  })().catch(error => {
    quitting = false
    rendererQuit.release()
    dialog.showErrorBox('退出未完成，窗口已保留', String(error?.message || error))
  }).finally(() => { quitPromise = null })
})

// 启动后端进程（生产模式）
async function startBackend() {
  if (quitting || backend) return
  if (backendStartPromise) return backendStartPromise
  backendStartPromise = (async () => {
    try {
      const backendBin = process.platform === 'win32' ? 'notepad-server.exe' : 'notepad-server'
      const exe = path.join(process.resourcesPath, 'bin', backendBin)
      const env = { ...process.env }
      try {
        const secret = await webdavSecrets.load()
        if (secret) env.NOTEPAD_WEBDAV_PASSWORD = secret
        else delete env.NOTEPAD_WEBDAV_PASSWORD
      } catch (error) {
        delete env.NOTEPAD_WEBDAV_PASSWORD
        console.error('WebDAV secure secret unavailable:', error)
      }
      if (quitting) return
      backend = spawnManagedBackend(spawn, exe, { env })
      backend.on('error', (err) => {
        dialog.showErrorBox('后端启动失败', `无法启动后端服务: ${err.message}`)
      })
    } catch (e) {
      dialog.showErrorBox('后端启动失败', String(e))
    }
  })()
  try { await backendStartPromise } finally { backendStartPromise = null }
}

async function restartBackendForWebDAVSecret() {
  if (!app.isPackaged) return { restarted: false, restartRequired: true }
  if (quitting) throw new Error('应用正在退出，凭据将在下次启动时生效')
  await backendStartPromise
  const child = backend
  if (child) await stopChildProcess(child, 2500)
  if (backend === child) backend = null
  if (quitting) throw new Error('应用正在退出，凭据将在下次启动时生效')
  await startBackend()
  const ready = await waitForHttpService(`${process.env.API_BASE || 'http://127.0.0.1:27121'}/api/health`, {
    timeoutMs: 8000,
    intervalMs: 120,
  })
  if (!ready) throw new Error('安全凭据已保存，但本地数据服务重启失败')
  return { restarted: true, restartRequired: false }
}

// IPC 对话框：打开文件与保存文件
ipcMain.handle('dialog:openFile', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [
    { name: 'Text/Markdown', extensions: ['txt', 'md'] },
    { name: 'All Files', extensions: ['*'] }
  ] })
  return res.canceled ? [] : res.filePaths
})

ipcMain.handle('dialog:saveFile', async () => {
  const res = await dialog.showSaveDialog({ filters: [
    { name: 'Text', extensions: ['txt'] },
    { name: 'Markdown', extensions: ['md'] }
  ] })
  return res.canceled ? '' : (res.filePath || '')
})

ipcMain.handle('file:saveContentAs', async (event, { suggestedName = 'note.md', content = '' } = {}) => {
  try {
    const result = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    await fs.writeFile(result.filePath, String(content ?? ''), 'utf8')
    return { success: true, path: result.filePath }
  } catch (error) {
    console.error(error)
    return { success: false, canceled: false, message: error.message }
  }
})

ipcMain.handle('dialog:openDirectory', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return res.canceled ? '' : (res.filePaths[0] || '')
})

ipcMain.handle('export:docx', async (event, { ids, targetDir, format = 'docx' }) => {
  try {
    const errors = await processExport(ids, targetDir, format)
    return { success: true, errors }
  } catch (e) {
    console.error(e)
    return { success: false, message: e.message }
  }
})

ipcMain.handle('export:combined-manuscript', async (
  event,
  { ids = [], targetDir, format = 'docx', title = '合并稿' } = {}
) => {
  try {
    const outputPath = await exportCombinedManuscript(
      ids,
      targetDir,
      format,
      title,
    )
    return { success: true, path: outputPath }
  } catch (e) {
    console.error(e)
    return { success: false, message: e.message }
  }
})

ipcMain.handle('export:pdf', async (event, { file, outputPath }) => {
  try {
    const path = await exportToPDF(file, outputPath)
    return { success: true, path }
  } catch (e) {
    console.error(e)
    return { success: false, message: e.message }
  }
})

ipcMain.handle('export:html', async (event, { file, outputPath }) => {
  try {
    const path = await exportToHTML(file, outputPath)
    return { success: true, path }
  } catch (e) {
    console.error(e)
    return { success: false, message: e.message }
  }
})

ipcMain.handle('import:files', async () => {
    try {
        const results = await selectAndParseFiles()
        return { success: true, results }
    } catch (e) {
        console.error(e)
        return { success: false, message: e.message }
    }
})

ipcMain.handle('import:paths', async (event, { paths = [] } = {}) => {
  try {
    const results = await parseImportPaths(paths)
    return { success: true, results }
  } catch (e) {
    console.error(e)
    return { success: false, message: e.message }
  }
})

ipcMain.handle('app:diagnostics', async () => ({
  success: true,
  version: app.getVersion(),
  electron: process.versions.electron || '',
  chrome: process.versions.chrome || '',
  node: process.versions.node || '',
  platform: process.platform,
  arch: process.arch,
  packaged: app.isPackaged,
}))

ipcMain.handle('app:openFolder', async (event, { kind } = {}) => {
  try {
    const dataDir = getDefaultDataDir()
    const allowed = {
      data: dataDir,
      backups: path.join(dataDir, 'backups'),
      uploads: path.join(dataDir, 'uploads'),
      syncLab: path.join(dataDir, 'sync-lab-remote'),
    }
    const target = allowed[kind]
    if (!target) {
      return { success: false, message: '不支持的目录类型' }
    }

    await fs.mkdir(target, { recursive: true })
    const error = await shell.openPath(target)
    if (error) return { success: false, message: error }
    return { success: true, path: target }
  } catch (error) {
    console.error(error)
    return { success: false, message: error.message }
  }
})

ipcMain.handle('backup:list', async () => {
  try {
    const backupDir = getDefaultBackupDir()
    const backups = await listBackups(backupDir)
    return { success: true, backups, directory: backupDir }
  } catch (e) {
    console.error(e)
    return { success: false, message: e.message }
  }
})

ipcMain.handle('backup:openFolder', async () => {
  try {
    const backupDir = ensureBackupDir()
    const error = await shell.openPath(backupDir)
    if (error) return { success: false, message: error }
    return { success: true, directory: backupDir }
  } catch (e) {
    console.error(e)
    return { success: false, message: e.message }
  }
})

// These bridges expose only native-dialog backup/package creation and read-only
// inspection. Neither path performs a live database or attachment replacement.
const trustedMainFrame = event => Boolean(
  mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
  event.senderFrame === mainWindow.webContents.mainFrame
)
ipcMain.handle('sync:webdav-secret:status', async event => {
  if (!trustedMainFrame(event)) throw new Error('不可信的 WebDAV 凭据状态请求')
  const status = await webdavSecrets.status()
  return { success: true, ...status, managed: app.isPackaged }
})
ipcMain.handle('sync:webdav-secret:save', async (event, password) => {
  if (!trustedMainFrame(event)) throw new Error('不可信的 WebDAV 凭据写入请求')
  await webdavSecrets.save(String(password ?? ''))
  const restart = await restartBackendForWebDAVSecret()
  return { success: true, stored: true, ...restart }
})
ipcMain.handle('sync:webdav-secret:clear', async event => {
  if (!trustedMainFrame(event)) throw new Error('不可信的 WebDAV 凭据清理请求')
  await webdavSecrets.clear()
  const restart = await restartBackendForWebDAVSecret()
  return { success: true, stored: false, ...restart }
})

const runDataSafety = args => {
  const filename = process.platform === 'win32' ? 'notepad-server.exe' : 'notepad-server'
  const binary = app.isPackaged ? path.join(process.resourcesPath, 'bin', filename) :
    path.join(app.getAppPath(), 'server', 'bin', filename)
  return runBackupCommand(binary, getDefaultDataDir(), args)
}
const dataSafety = createDataSafetyService({
  dataDir: getDefaultDataDir(),
  run: runDataSafety,
  chooseDestination: name => dialog.showSaveDialog(mainWindow, {
    title: '另存已校验的数据库备份', defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: 'SQLite 数据库备份', extensions: ['db'] }],
  }),
})
registerDataSafetyHandlers(ipcMain, dataSafety, trustedMainFrame)

const chooseWorkspacePackage = title => dialog.showOpenDialog(mainWindow, {
  title,
  properties: ['openFile'],
  filters: [{ name: 'Local-Notepad 工作区便携包', extensions: ['lnw'] }],
})
const workspacePackages = createWorkspacePackageService({
  dataDir: getDefaultDataDir(),
  appVersion: app.getVersion(),
  runBackup: runDataSafety,
  chooseDestination: suggestedName => dialog.showSaveDialog(mainWindow, {
    title: '导出 Local-Notepad 工作区便携包',
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: [{ name: 'Local-Notepad 工作区便携包', extensions: ['lnw'] }],
  }),
  chooseSource: () => chooseWorkspacePackage('校验 Local-Notepad 工作区便携包'),
})
registerWorkspacePackageHandlers(ipcMain, workspacePackages, trustedMainFrame)

const workspaceRestore = createWorkspaceRestoreService({
  dataDir: getDefaultDataDir(),
  inspectBackup: runDataSafety,
  chooseSource: () => chooseWorkspacePackage('预检并恢复 Local-Notepad 工作区便携包'),
  canRestore: () => app.isPackaged,
  scheduleRestart: () => {
    setTimeout(() => {
      if (!app.isPackaged) return
      app.relaunch()
      app.quit()
    }, 450)
  },
})
registerWorkspaceRestoreHandlers(ipcMain, workspaceRestore, trustedMainFrame)
