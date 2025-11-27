# Notepad 桌面应用

## 项目介绍
- 采用 React + Vite 作为渲染进程，Electron 作为桌面容器，后端为 Go 可执行程序（本地服务）。
- 支持富文本编辑、图片/视频/Excel 插入、文件列表管理、自动保存等功能。

## 开发运行
- 安装依赖：`npm install`
- 启动开发：`npm run dev`
  - 将同时启动 Vite、Electron（开发模式）与主进程构建监视。

## 构建
- 构建 Electron 主/预加载脚本：`npm run build:main`
- 构建渲染进程：`npm run build:renderer`

## 一键打包（生成 Windows 安装包 exe）
- 前置要求：
  - Windows 环境
  - Node.js ≥ 18 与 npm
  - Go ≥ 1.20（用于构建后端服务）
- 方式一：双击脚本（推荐）
  1. 在项目根目录双击 `pack-win.ps1`。
  2. 脚本会自动安装依赖并执行打包，完成后自动打开产物所在文件夹。
  3. 安装包文件名：`dist/Notepad-<version>-Setup.exe`。
  - 若遇到 PowerShell 执行策略限制，可在终端执行：
    - `powershell -ExecutionPolicy Bypass -File ./pack-win.ps1`
- 方式二：命令行打包
  1. `npm install`
  2. `npm run build`
     - 包含：构建后端（Go）、构建 Electron 主进程与渲染进程、执行 `electron-builder` 生成安装包。

## 部署
- 打包生成的 `Notepad-<version>-Setup.exe` 直接分发给用户安装。
- 应用安装后会随安装包携带后端服务可执行文件，并在应用启动时自动运行。

## 常见问题
- 打包失败：
  - 请检查是否已安装 Go（命令 `go version`）、Node.js 与 npm。
  - 如依赖安装失败，尝试删除 `node_modules` 后重新执行 `npm install`。
- 安装包未生成：
  - 确认 `dist` 目录下是否存在 `.exe`；若不存在，请查看命令行输出错误信息并重试。

## 版本与产物
- Electron Builder 配置见 `package.json` 中 `build` 字段（NSIS 安装包，artifactName 为 `Notepad-${version}-Setup.exe`）。
- 安装包与解压产物默认输出到 `dist` 目录。
