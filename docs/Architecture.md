# 架构设计

## 概览
- 前端：Electron 主进程 + Preload + React 渲染层（Vite 构建）。
- 后端：GoFrame HTTP 服务，SQLite 本地数据，REST 通信。

## 进程通信
- 渲染层通过 `__API_BASE__` 调用后端（仅 127.0.0.1）。
- IPC 仅用于文件对话框等 OS 交互，业务数据走 REST。

## 模块划分
- 前端：组件化、全局样式、代码分割与懒加载。
- 后端：API/Service/Model/DAO 分层，错误与日志中间件。

## 数据模型
- files(id,title,content,created_at,updated_at,tags)
- settings(id,theme,editor_opts,sync_enabled,sync_endpoint)

## 安全与性能
- Electron 安全策略；后端 WAL、超时控制；前端首屏最小化加载。

