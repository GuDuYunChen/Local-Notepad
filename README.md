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

## 打包与构建（生成本地安装包）

本项目支持生成 Windows 本地安装包（.exe），生成的安装包为**完全离线版本**，包含前端、Electron 容器及 Go 后端服务，用户可直接在本地安装使用，无需额外部署。

### 方式一：使用自动化脚本（推荐）
双击项目根目录下的 `pack-win.ps1` 脚本。
- 脚本会自动检查环境（Node.js, Go）、安装依赖、构建前后端并生成安装包。
- **产物位置**：`dist/Notepad-<version>-Setup.exe`
- **使用方式**：直接双击生成的 `.exe` 文件进行安装，安装后即可在桌面启动应用。

### 方式二：命令行手动打包
如果需要手动控制构建过程，可在终端依次执行：

1. **安装依赖**
   ```bash
   npm install
   ```

2. **执行构建**
   ```bash
   npm run build
   ```
   该命令会依次执行：
   - `npm run ci:build-backend-win`：编译 Go 后端服务
   - `npm run build:main`：编译 Electron 主进程
   - `npm run build:renderer`：编译 React 前端
   - `electron-builder`：打包生成 Windows 安装程序

3. **获取产物**
   构建完成后，安装包将生成在 `dist/` 目录下，文件名为 `Notepad-<version>-Setup.exe`。

### 注意事项
- **环境要求**：打包需在 Windows 环境下进行，且需预先安装 Go (≥1.20) 和 Node.js。
- **后端集成**：打包过程会自动将编译好的 `notepad-server.exe` 复制到安装包中，用户安装后应用会自动管理后端服务的启动与关闭。

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
