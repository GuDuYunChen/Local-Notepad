import { contextBridge, ipcRenderer, webUtils } from 'electron'

const base = process.env.API_BASE || 'http://127.0.0.1:27121'
contextBridge.exposeInMainWorld('__API_BASE__', base)

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: () => ipcRenderer.invoke('dialog:saveFile'),
  saveContentAs: (payload) => ipcRenderer.invoke('file:saveContentAs', payload),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  exportToDocx: (ids, targetDir, format) => ipcRenderer.invoke('export:docx', { ids, targetDir, format }),
  exportCombinedManuscript: (ids, targetDir, format, title) => ipcRenderer.invoke(
    'export:combined-manuscript',
    { ids, targetDir, format, title }
  ),
  exportToPDF: (file, outputPath) => ipcRenderer.invoke('export:pdf', { file, outputPath }),
  exportToHTML: (file, outputPath) => ipcRenderer.invoke('export:html', { file, outputPath }),
  importFiles: () => ipcRenderer.invoke('import:files'),
  importPaths: (paths) => ipcRenderer.invoke('import:paths', { paths }),
  getPathForFile: (file) => webUtils?.getPathForFile ? webUtils.getPathForFile(file) : (file?.path || ''),
  backupCreate: () => ipcRenderer.invoke('backup:create'),
  backupInspect: name => ipcRenderer.invoke('backup:inspect', name),
  backupExport: name => ipcRenderer.invoke('backup:export', name),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupOpenFolder: () => ipcRenderer.invoke('backup:openFolder'),
  workspaceExport: () => ipcRenderer.invoke('workspace:export'),
  workspaceInspect: () => ipcRenderer.invoke('workspace:inspect'),
  workspacePrepareRestore: () => ipcRenderer.invoke('workspace:restore:prepare'),
  workspaceConfirmRestore: id => ipcRenderer.invoke('workspace:restore:confirm', id),
  workspaceCancelRestore: id => ipcRenderer.invoke('workspace:restore:cancel', id),
  appDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  openAppFolder: (kind) => ipcRenderer.invoke('app:openFolder', { kind }),
  webdavSecretStatus: () => ipcRenderer.invoke('sync:webdav-secret:status'),
  webdavSecretSave: password => ipcRenderer.invoke('sync:webdav-secret:save', password),
  webdavSecretClear: () => ipcRenderer.invoke('sync:webdav-secret:clear'),
  onQuitPrepare: callback => {
    const handler = (_event, value) => callback({ id: value?.id })
    ipcRenderer.on('editor:quit:prepare', handler)
    return () => ipcRenderer.removeListener('editor:quit:prepare', handler)
  },
  onQuitRelease: callback => {
    const handler = (_event, value) => callback({ id: value?.id })
    ipcRenderer.on('editor:quit:release', handler)
    return () => ipcRenderer.removeListener('editor:quit:release', handler)
  },
  reportQuitResult: value => ipcRenderer.send('editor:quit:result', {
    id: value?.id, ready: value?.ready === true, code: value?.code,
  }),
  onReload: (callback) => ipcRenderer.on('app:reload', callback),
})
