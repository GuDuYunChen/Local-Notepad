# 4.182.0 — Knowledge OS Phase 1A：工作区便携包

基线：`master` / 4.181.0，开发分支 `feature/knowledge-os-phase1`。

## 本阶段目标

先补齐数据可搬运性，不进入同步、E2EE 或 AI：

- 复用现有 SQLite `VACUUM INTO` 一致性快照；
- 将已保存正文数据库与用户数据目录下的 `uploads` 附件写入单个 `.lnw` v1 文件；
- 清单 SHA-256 + 每个数据库/附件条目的 SHA-256；
- 流式写盘，不把全部附件读进内存；
- 只通过 Electron 原生打开/保存对话框选择文件，不接受 renderer 传入任意路径；
- 目标文件存在时绝不覆盖；
- 附件目录出现符号链接、子目录、特殊文件或校验期间变化时拒绝导出，避免静默遗漏；
- 可对任意 `.lnw` 做只读结构与逐文件校验；
- 当前阶段不在运行中自动恢复/覆盖数据库或附件，恢复事务留给 Phase 1B。

## 已有附件安全基础

4.181.0 的后端已经使用 `resolveUploadPath(data.db)` 将附件放在数据库同目录的 `uploads`，并会尝试迁移旧的根目录 `uploads/` 与 `server/uploads/`。本阶段没有重写这套迁移，而是把附件纳入可验证的迁移/备份介质。

## 同期修复

后端 schema 已到 10，但 Electron 数据安全桥和备份中心仍把 `schemaVersion > 9` 视为非法。4.182.0 将支持上限同步到 10，避免真实手动快照被 UI 误判失败。

## .lnw v1 容器

二进制布局：

1. 8 字节 magic：`LNWPKG1\n`
2. 4 字节 big-endian JSON 清单长度
3. 32 字节清单 SHA-256
4. UTF-8 JSON 清单
5. 按清单顺序连续保存数据库与附件原始字节

清单固定以 `data.db` 为第一个条目，附件只能位于扁平的 `uploads/<name>`。检查器拒绝路径穿越、重复路径、额外尾随字节、未来数据库 schema 和任何条目哈希不一致。

## 明确不包含

- 未保存编辑器草稿；
- 当前窗口临时状态；
- 浏览器 localStorage 中独立保存的“核对存档”。

产品 UI 会明确提示，不把部分备份描述成完整恢复点。

## 验证门槛

- `electron/workspace-package.test.js`：容器、路径安全、损坏检测、取消/不覆盖、并发锁、IPC 信任边界；
- `WorkspacePackagePanel.test.jsx`：显式导出、只读校验、取消、异常回执、重复操作、附件目录入口；
- 原有 `test:ui`、`test:electron`、后端、Windows 打包与 package smoke 必须继续通过。
