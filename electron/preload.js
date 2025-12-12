import { contextBridge, ipcRenderer } from 'electron'

const base = process.env.API_BASE || 'http://127.0.0.1:27121'
contextBridge.exposeInMainWorld('__API_BASE__', base)

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: () => ipcRenderer.invoke('dialog:saveFile'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  exportToDocx: (ids, targetDir) => ipcRenderer.invoke('export:docx', { ids, targetDir }),
  importFiles: () => ipcRenderer.invoke('import:files'),
})
