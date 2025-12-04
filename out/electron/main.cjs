var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main.js
var import_electron = require("electron");
var import_node_child_process = require("node:child_process");
var import_node_path = __toESM(require("node:path"), 1);
var mainWindow = null;
var backend = null;
function createWindow() {
  const isDev = !import_electron.app.isPackaged;
  const iconPath = isDev ? import_node_path.default.join(__dirname, "../../build/icon.ico") : import_node_path.default.join(import_electron.app.getAppPath(), "build/icon.ico");
  mainWindow = new import_electron.BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: "Notepad",
    icon: iconPath,
    // Windows 上传字符串路径兼容性通常更好
    webPreferences: {
      preload: import_node_path.default.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (isDev) {
    process.env.API_BASE = "http://127.0.0.1:27121";
    mainWindow.loadURL("http://localhost:5000");
    if (process.env.OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    process.env.API_BASE = "http://127.0.0.1:27121";
    const indexPath = import_node_path.default.join(import_electron.app.getAppPath(), "dist/index.html");
    startBackend();
    mainWindow.loadFile(indexPath);
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
import_electron.app.commandLine.appendSwitch("disable-features", "Autofill");
import_electron.app.whenReady().then(async () => {
  import_electron.app.commandLine.appendSwitch("lang", "zh-CN");
  const menu = import_electron.Menu.buildFromTemplate([
    {
      label: "\u6587\u4EF6",
      submenu: [{ role: "quit", label: "\u9000\u51FA" }]
    },
    {
      label: "\u7F16\u8F91",
      submenu: [
        { role: "undo", label: "\u64A4\u9500" },
        { role: "redo", label: "\u91CD\u505A" },
        { type: "separator" },
        { role: "cut", label: "\u526A\u5207" },
        { role: "copy", label: "\u590D\u5236" },
        { role: "paste", label: "\u7C98\u8D34" }
      ]
    },
    {
      label: "\u89C6\u56FE",
      submenu: [
        { role: "reload", label: "\u91CD\u65B0\u52A0\u8F7D" },
        { role: "toggleDevTools", label: "\u5F00\u53D1\u8005\u5DE5\u5177" }
      ]
    },
    {
      label: "\u5E2E\u52A9",
      submenu: [{ role: "about", label: "\u5173\u4E8E" }]
    }
  ]);
  import_electron.Menu.setApplicationMenu(menu);
  if (import_electron.app.isPackaged) {
    import_electron.app.setAsDefaultProtocolClient("notepad");
  }
  const gotLock = import_electron.app.requestSingleInstanceLock();
  if (!gotLock) {
    import_electron.app.quit();
    return;
  }
  import_electron.app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  createWindow();
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron.app.quit();
});
import_electron.app.on("before-quit", () => {
  if (backend) {
    backend.kill();
    backend = null;
  }
});
function startBackend() {
  if (backend) return;
  try {
    const exe = import_node_path.default.join(process.resourcesPath, "bin", "notepad-server.exe");
    backend = (0, import_node_child_process.spawn)(exe, { stdio: "ignore" });
  } catch (e) {
    import_electron.dialog.showErrorBox("\u540E\u7AEF\u542F\u52A8\u5931\u8D25", String(e));
  }
}
import_electron.ipcMain.handle("dialog:openFile", async () => {
  const res = await import_electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [
    { name: "Text/Markdown", extensions: ["txt", "md"] },
    { name: "All Files", extensions: ["*"] }
  ] });
  return res.canceled ? [] : res.filePaths;
});
import_electron.ipcMain.handle("dialog:saveFile", async () => {
  const res = await import_electron.dialog.showSaveDialog({ filters: [
    { name: "Text", extensions: ["txt"] },
    { name: "Markdown", extensions: ["md"] }
  ] });
  return res.canceled ? "" : res.filePath || "";
});
