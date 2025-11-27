## 项目概览
- 目标：构建跨平台桌面记事本，前端 Electron+React+Vite，后端 Go+GoFrame，SQLite 本地存储，前后端分离通过 REST 通信。
- 特性：富文本编辑（加粗/斜体/标题）、文件管理（新建/打开/保存/另存为）、搜索/替换、夜间模式、响应式与轻量动画。
- 交付：完整源码、三平台安装包、技术文档（架构/API/部署）、用户手册。

## 架构总览
- 前端：
  - Electron 主进程 `main` 管理窗口、生命周期与后端进程；`preload` 暴露安全 API（不启用 NodeIntegration，启用 contextIsolation）。
  - React 18 + TypeScript + Vite 渲染层；代码分割与懒加载；全局样式与主题变量；组件化。
- 后端：
  - Go 1.22+，GoFrame 2（`ghttp`）提供 REST API；SQLite 持久化。
  - 分层：API（handler）→ Service（业务）→ DAO（数据访问）→ Model（实体/DTO）。
- 进程通信：
  - Electron 主进程在启动时寻找可用端口，以环境变量启动后端（或 `--port` 参数）；渲染层通过 `http://127.0.0.1:<PORT>/api/...` 调用。
  - 仅使用 IPC 处理与 OS 相关的对话框及安全受限的文件路径选择；业务数据走 REST。
- 多平台：Windows（NSIS）、macOS（DMG/zip）、Linux（AppImage/deb/rpm）。

## 前端实现
- 技术栈：`React + TypeScript + Vite + CSS 变量`；尽量使用原生 CSS 过渡/关键帧实现轻量动画，避免过多第三方库。
- 富文本编辑：选用 Lexical（现代、轻量、可扩展），实现加粗/斜体/标题/有序无序列表；搜索/替换在编辑器内实现（基于 selection 与正则）。
- UI/东方审美：
  - 以留白、柔和配色与连贯动效为主；字体优先系统中文字体。
  - 夜间模式：CSS 变量 `--color-*`，`data-theme` 切换；用户设置持久化（后端 Settings API）。
- 响应式：栅格与弹性布局，断点（`sm/md/lg/xl`）适配不同分辨率；工具栏可折叠。
- 文件管理：
  - 应用库：通过后端 Files API 管理（新建/保存/打开/删除/另存为到本地路径）。
  - 本地文件：通过 `preload` 暴露 `openFileDialog/saveFileDialog` 获取路径，再调用后端读取/写入，确保权限与安全。
- 代码分割：路由与富文本编辑器组件懒加载；首屏只加载基础框架与列表视图。
- 全局样式：`src/styles/index.css` 抽取公共样式与主题变量；组件样式内聚，避免深层嵌套（≤4 层）。

## 后端实现
- 技术栈：Go + GoFrame + SQLite；模块划分：
  - `cmd/notepad-server/main.go`：读取环境变量端口、启动 HTTP 服务、优雅退出（监听 OS 信号），`context.Context` 管理时限与取消。
  - `internal/api`：HTTP handler（参数校验、错误码、结构化返回）。
  - `internal/service`：文件/设置/同步业务；goroutine 有退出机制。
  - `internal/dao`：SQLite 访问；迁移管理（初始化表）。
  - `internal/model`：实体与 DTO，中文注释说明类型与用途。
  - `pkg/errors`：`fmt.Errorf("前缀: %w", err)` 链式包装；避免暴露敏感信息。
  - `pkg/log`：统一日志（不记录敏感信息），顶层恢复 `panic/recover`。
- 配置：
  - 敏感配置走环境变量（如云端 token）；SQLite 数据文件放置于用户数据目录（如 `~/.notepad/data.db`）。
  - 依赖定期更新，`go vet`/`golangci-lint` 质量检查。

## 数据模型
- `files` 表：
  - `id`（TEXT/UUID，主键）
  - `title`（TEXT，标题）
  - `content`（TEXT，编辑器 JSON 或 Markdown）
  - `created_at`（INTEGER，Unix 秒）
  - `updated_at`（INTEGER，Unix 秒）
  - `tags`（TEXT，可选，JSON 数组）
- `settings` 表：
  - `id`（INTEGER，固定 1）
  - `theme`（TEXT，`light|dark`）
  - `editor_opts`（TEXT，JSON，如行高、字号）
  - `sync_enabled`（INTEGER，0/1）
  - `sync_endpoint`（TEXT，可选）

## API 设计
- 统一响应：`{ "code": <int>, "message": <string>, "data": <object|null> }`，`code=0` 表示成功。
- Files：
  - `GET /api/files`：分页/搜索参数（`q`, `page`, `size`）。
  - `POST /api/files`：创建（title, content）。
  - `GET /api/files/{id}`：读取。
  - `PUT /api/files/{id}`：更新（title?, content?）。
  - `DELETE /api/files/{id}`：删除。
  - `POST /api/files/{id}/save-as`：另存为到本地路径（参数 `path`）。
  - `POST /api/files/import`：从本地路径导入（参数 `path`）。
- Settings：
  - `GET /api/settings`
  - `PUT /api/settings`（完整替换或增量更新）
- Sync（可选云端）：
  - `POST /api/sync/push`：推送本地变更。
  - `POST /api/sync/pull`：拉取云端变更。
  - `GET /api/sync/status`：最近一次同步状态。
- 参数校验：GoFrame Validator；防注入、防越权；错误返回结构化错误码与中文信息。

## 错误处理与日志
- 顶层中间件：统一捕获、记录、转换错误为结构化响应；禁止忽略错误。
- 错误包装：所有内部错误 `fmt.Errorf("模块: %w", err)` 保留调用链，避免泄露敏感上下文（如 SQL）。
- 日志：
  - 级别化（info/warn/error）；请求日志包含 request ID、方法、耗时与结果码。
  - 不记录密码/token/文档内容；必要时记录摘要或长度。

## 安全与隐私
- Electron：`contextIsolation: true`，`nodeIntegration: false`；`preload` 白名单 API；CSP 与 `https:`/`file:` 资源限制。
- 后端：输入校验、速率限制、超时控制；本地仅监听 `127.0.0.1`；可配置端口。
- 数据：SQLite 文件权限限制；可选对 `content` 做轻量加密（如 AES-GCM，密钥存于系统安全存储或用户提供）。
- 日志与错误信息：避免敏感数据泄露；用户隐私优先。

## 跨平台打包
- 前端：Electron Builder 集成 Vite（`electron-builder` + `vite`）；产出 `nsis`/`dmg`/`AppImage`。
- 后端：Go 交叉编译生成平台二进制（`windows-amd64`, `darwin-arm64`, `linux-amd64` 等）。
- 集成：打包脚本在构建阶段将对应平台后端二进制复制到 `resources/bin/<platform>/<arch>/notepad-server`，主进程按平台选择并启动。
- 安装与卸载：注册快捷方式与文件关联（可选）；确保应用退出时优雅关闭后端进程。

## 性能优化
- 快启：
  - 后端延迟初始化耗时模块；SQLite 连接池与 `PRAGMA`（如 `journal_mode=WAL`）提升并发读写。
  - 前端首屏仅加载列表与必要状态；编辑器组件懒加载。
- 渲染优化：React `memo`/`useCallback`，避免不必要重渲；搜索/替换在前端流式处理。
- 资源优化：图片与图标使用 SVG；CSS 变量与原生动画降低体积。

## 测试与验证
- 前端：组件测试（React Testing Library），E2E（Playwright）覆盖文件管理与编辑器操作、夜间模式。
- 后端：单元测试（service/dao）、集成测试（API），`go vet`/`lint` 检查；SQLite 临时库用于测试。
- 预览：开发模式提供本地预览与热重载；CI 构建产物与基础用例自动验证。

## 文档与交付
- 技术文档：
  - 架构设计说明（模块划分、流程图、生命周期）。
  - API 文档：OpenAPI/Swagger（生成与同步更新）。
  - 部署指南：开发/打包/发布步骤，环境变量说明。
- 用户手册：安装、界面说明、文件管理、搜索替换、夜间模式、同步（如启用）。
- 交付物：源码（前后端）、安装包（Win/macOS/Linux）、文档与手册。

## 实施步骤
1. 初始化前端与 Electron 项目骨架；设置主进程、安全策略与 `preload`。
2. 集成 React/Vite 与基础路由、全局样式/主题切换、布局与工具栏。
3. 接入 Lexical 编辑器与基础格式；实现搜索/替换与快捷键。
4. 初始化后端（GoFrame + SQLite）；完成数据模型与迁移；实现 Files/Settings API 与错误/日志中间件。
5. 打通 Electron 主进程与后端端口启动；前端调用 REST 流程；实现文件导入/另存为本地。
6. 性能与安全收敛：代码分割、WAL、CSP、输入校验；完善测试用例。
7. 打包：Go 交叉编译 + Electron Builder 三平台集成；出产安装包。
8. 生成 OpenAPI 文档与技术/用户文档；最终验收与交付。

## 确认事项
- 是否需要启用内容加密与云同步（默认关闭，可后续开启）？
- 文件内容存储格式偏好（JSON/markdown）与导出格式需求？
- 是否需要文件关联与默认打开（双击本地文件唤起应用）？

请确认是否按此方案实施，我将据此开始搭建与实现。