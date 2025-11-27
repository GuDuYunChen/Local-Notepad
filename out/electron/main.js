"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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

// node_modules/electron/index.js
var require_electron = __commonJS({
  "node_modules/electron/index.js"(exports2, module2) {
    var fs = require("fs");
    var path2 = require("path");
    var pathFile = path2.join(__dirname, "path.txt");
    function getElectronPath() {
      let executablePath;
      if (fs.existsSync(pathFile)) {
        executablePath = fs.readFileSync(pathFile, "utf-8");
      }
      if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
        return path2.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || "electron");
      }
      if (executablePath) {
        return path2.join(__dirname, "dist", executablePath);
      } else {
        throw new Error("Electron failed to install correctly, please delete node_modules/electron and try installing again");
      }
    }
    module2.exports = getElectronPath();
  }
});

// electron/main.ts
var import_electron = __toESM(require_electron(), 1);
var import_node_child_process = require("node:child_process");
var import_node_path = __toESM(require("node:path"), 1);
var mainWindow = null;
var backend = null;
function createWindow() {
  mainWindow = new import_electron.BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: "Notepad",
    webPreferences: {
      preload: import_node_path.default.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const isDev = !import_electron.app.isPackaged;
  if (isDev) {
    process.env.API_BASE = "http://127.0.0.1:27121";
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    process.env.API_BASE = "http://127.0.0.1:27121";
    const indexPath = import_node_path.default.resolve(process.cwd(), "dist", "index.html");
    startBackend();
    mainWindow.loadFile(indexPath);
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
import_electron.app.whenReady().then(async () => {
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
