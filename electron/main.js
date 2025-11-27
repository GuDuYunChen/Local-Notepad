import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'

// 应用主进程：负责创建窗口、设置安全选项
let mainWindow = null
let backend = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'Notepad',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const isDev = !app.isPackaged
  if (isDev) {
    process.env.API_BASE = 'http://127.0.0.1:27121'
    mainWindow.loadURL('http://localhost:5000')
    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    process.env.API_BASE = 'http://127.0.0.1:27121'
    const indexPath = path.resolve(process.cwd(), 'dist', 'index.html')
    startBackend()
    mainWindow.loadFile(indexPath)
  }

  mainWindow.on('closed', () => { mainWindow = null })
}
app.commandLine.appendSwitch('disable-features', 'Autofill')

app.whenReady().then(async () => {
  app.commandLine.appendSwitch('lang', 'zh-CN')
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
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [{ role: 'about', label: '关于' }],
    },
  ])
  Menu.setApplicationMenu(menu)
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('notepad')
  }
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (backend) {
    backend.kill()
    backend = null
  }
})

// 启动后端进程（生产模式）
function startBackend() {
  if (backend) return
  try {
    const exe = path.join(process.resourcesPath, 'bin', 'notepad-server.exe')
    backend = spawn(exe, { stdio: 'ignore' })
  } catch (e) {
    dialog.showErrorBox('后端启动失败', String(e))
  }
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
