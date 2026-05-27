import { contextBridge, ipcRenderer } from 'electron'

const base = process.env.API_BASE || 'http://127.0.0.1:27121'
contextBridge.exposeInMainWorld('__API_BASE__', base)

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: () => ipcRenderer.invoke('dialog:saveFile'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  exportToDocx: (ids, targetDir, format) => ipcRenderer.invoke('export:docx', { ids, targetDir, format }),
  exportToPDF: (file, outputPath) => ipcRenderer.invoke('export:pdf', { file, outputPath }),
  exportToHTML: (file, outputPath) => ipcRenderer.invoke('export:html', { file, outputPath }),
  importFiles: () => ipcRenderer.invoke('import:files'),
  backupCreate: (targetDir) => ipcRenderer.invoke('backup:create', { targetDir }),
  backupRestore: (backupFile) => ipcRenderer.invoke('backup:restore', { backupFile }),
  backupList: (backupDir) => ipcRenderer.invoke('backup:list', { backupDir }),
  onReload: (callback) => ipcRenderer.on('app:reload', callback),
})
