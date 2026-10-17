# 4.188.0 — Knowledge OS Phase 2D：OS-protected WebDAV Credentials

## 目标

Phase 2D 解决 Phase 2B/2C 的主要安全债：WebDAV 密码虽然不经 API 回显，但此前仍可能以明文形式存在 SQLite 与工作区备份中。

## 桌面打包版

- Electron 使用 `safeStorage.encryptString/decryptString` 保护 WebDAV 密码。
- 密文独立保存在应用数据目录 `secrets/webdav-password.bin`。
- 凭据文件不属于 `.lnw` 工作区包的数据库/附件集合。
- Electron 启动 Go 后端时通过 `NOTEPAD_WEBDAV_PASSWORD` 运行期环境变量注入解密后的 secret。
- Go `Engine.WebDAVPassword` 优先于旧版 SQLite `sync_password`，后者仅作升级兼容 fallback。
- 保存安全 secret 后，打包版重启本地后端并清空 SQLite 中旧的 `sync_password`。
- 清除密码会同时清理 safeStorage 密文和 SQLite legacy 字段。

## 平台安全边界

- Windows/macOS/Linux 均依赖 Electron safeStorage 的平台实现。
- 如果 Electron 报告存储后端为 Linux `basic_text`，应用将其视为“未加密”，拒绝保存新密码。
- safeStorage 不可用时，在任何 endpoint/provider 修改发生之前就拒绝保存，避免半完成配置。
- 凭据目录与文件都拒绝符号链接；密文大小和明文长度有硬限制。
- renderer 只能通过受信任主 frame IPC 调用 status/save/clear，不直接接触凭据文件。

## 迁移

- 旧数据库中的明文 password 不会被强制删除，以免升级后立即失去 WebDAV 访问。
- 同步中心会标明“旧版工作区密码”。
- 用户重新输入一次密码并保存后，打包版完成 safeStorage 迁移并清空 SQLite 明文。
- 开发模式若 Electron 不负责启动 Go 后端，会明确标记 restartRequired，并保留兼容 DB 副本用于当前开发后端。

## 已验证行为

- OS-protected secret store：save / replace / load / clear。
- 拒绝 unavailable safeStorage。
- 拒绝 Linux `basic_text` fallback。
- 拒绝 symlink credential file。
- renderer 在安全存储不可用时不先修改 WebDAV settings。
- Go runtime secret 能覆盖错误的 legacy DB password 并完成真实 WebDAV 同步。
- Phase 2C 自动同步、严格只读 preview、远端 rebind 和冲突中心语义保持不变。

## Schema

Phase 2D 不增加数据库 schema；仍为 schema 13。这样 4.187.0 数据可以直接被 4.188.0 打开，而新的安全 secret 独立于 workspace database 生命周期。
