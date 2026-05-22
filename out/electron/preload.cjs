// electron/preload.js
var import_electron = require("electron");
var base = process.env.API_BASE || "http://127.0.0.1:27121";
import_electron.contextBridge.exposeInMainWorld("__API_BASE__", base);
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  openFileDialog: () => import_electron.ipcRenderer.invoke("dialog:openFile"),
  saveFileDialog: () => import_electron.ipcRenderer.invoke("dialog:saveFile"),
  openDirectoryDialog: () => import_electron.ipcRenderer.invoke("dialog:openDirectory"),
  exportToDocx: (ids, targetDir, format) => import_electron.ipcRenderer.invoke("export:docx", { ids, targetDir, format }),
  importFiles: () => import_electron.ipcRenderer.invoke("import:files"),
  backupCreate: (targetDir) => import_electron.ipcRenderer.invoke("backup:create", { targetDir }),
  backupRestore: (backupFile) => import_electron.ipcRenderer.invoke("backup:restore", { backupFile }),
  backupList: (backupDir) => import_electron.ipcRenderer.invoke("backup:list", { backupDir })
});
