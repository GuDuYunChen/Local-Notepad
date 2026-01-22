# Notepad 桌面应用

## 项目介绍

- 采用 React + Vite 作为渲染进程，Electron 作为桌面容器，后端为 Go 可执行程序（本地服务）。
- 支持富文本编辑、图片/视频/Excel 插入、文件列表管理、自动保存等功能。

## 开发运行

- 安装依赖：`npm install`
- 启动开发：`npm run dev`
  - 将同时启动 Vite、Electron（开发模式）与主进程构建监视。
  - cd/server    go run ./cmd/notepad-server/main.go

## 构建

- 构建 Electron 主/预加载脚本：`npm run build:main`
- 构建渲染进程：`npm run build:renderer`

## 打包与构建（生成本地安装包）

本项目支持生成 Windows 本地安装包（.exe），生成的安装包为**完全离线版本**，包含前端、Electron 容器及 Go 后端服务，用户可直接在本地安装使用，无需额外部署。

### 方式一：使用自动化脚本（推荐）

双击项目根目录下的 `pack-win.bat` 脚本（或者右键 `pack-win.ps1` 选择“使用 PowerShell 运行”）。

- **注意**：Windows 默认会将 `.ps1` 文件关联到记事本打开，直接双击可能无法运行。请使用新提供的 `pack-win.bat` 批处理文件，或者右键点击 `.ps1` 文件选择运行。
- 脚本会自动检查环境（Node.js, Go）、安装依赖、构建前后端并生成安装包。
- **产物位置**：`release/Notepad-<version>-Setup.exe`
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
   构建完成后，安装包将生成在 `release/` 目录下，文件名为 `Notepad-<version>-Setup.exe`。

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

## 数据存储说明

本项目的数据存储分为两部分：**核心数据**（文本、设置）和**附件数据**（图片、视频）。

### 1. 核心数据（文本笔记、设置）

应用使用 SQLite 数据库存储所有文本内容和配置信息。该文件位于系统的用户数据目录下，**不会**随应用卸载而删除（除非手动清理），方便数据迁移和备份。

- **Windows**: `C:\Users\<用户名>\AppData\Roaming\Notepad\data.db`
  - *快捷访问方式*：在文件资源管理器地址栏输入 `%APPDATA%\Notepad` 回车即可。
- **macOS**: `~/Library/Application Support/Notepad/data.db`
- **Linux**: `~/.notepad/data.db`

**备份建议**：定期复制备份 `data.db` 文件即可保存所有文字资料。系统已内置自动备份机制，详情见下文“数据备份与恢复”。

### 2. 附件数据（图片、视频）

插入文档的图片、视频等媒体文件默认存储在**应用安装目录**下的 `uploads` 文件夹中。

- **位置**：`<安装目录>\uploads\`
- **注意**：
  - 由于存储在安装目录，**卸载应用时可能会被连带删除**。
  - 建议定期手动备份该文件夹，或在卸载前将其复制到其他位置。

## 数据备份与恢复

### 自动备份机制

为了防止数据丢失，应用内置了自动数据库备份功能：

1.  **触发时机**：应用（后端服务）启动时立即执行一次备份检查，之后每8小时自动执行。
2.  **备份频率**：每 **8小时** 执行一次全量热备份。
3.  **保留策略**：系统只保留**最近 100 份**备份文件，旧的备份会自动清理。
4.  **备份位置**：
    - 备份文件存放在数据目录下的 `backups` 文件夹中。
    - **Windows**: `%APPDATA%\Notepad\backups\`
    - 文件名格式：`backup-YYYYMMDD-HHMMSS.db`

### 如何恢复数据

如果需要将数据恢复到某个备份时间点，请按照以下步骤操作：

1.  **完全关闭应用**，确保后台没有 `Notepad.exe` 或 `notepad-server.exe` 进程在运行。
2.  打开数据目录（Windows 下可在资源管理器地址栏输入 `%APPDATA%\Notepad`）。
3.  找到当前的数据库文件 `data.db`，将其重命名为 `data.db.old`（作为保险）。
4.  进入 `backups` 文件夹，选择一个你需要恢复的备份文件（例如 `backup-20231001-120000.db`）。
5.  将该备份文件**复制**到上一级目录（即 `Notepad` 根目录）。
6.  将复制过来的文件重命名为 `data.db`。
7.  重新启动应用，数据即恢复完成。

## 版本与产物

- Electron Builder 配置见 `package.json` 中 `build` 字段（NSIS 安装包，artifactName 为 `Notepad-${version}-Setup.exe`）。
- 安装包与解压产物默认输出到 `dist` 目录。
