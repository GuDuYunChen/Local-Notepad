# 4.189.0 — Knowledge OS Phase 2E：Verified Activation

## 目标

把 WebDAV 从“配置保存后立即启用”改成严格的“验证通过才启用”，并让自动同步的启用规则由后端强制执行，而不是依赖 renderer 约定。

## WebDAV 保存顺序

1. 将 provider / endpoint / username 保存为 WebDAV，但保持 `sync_enabled=false`、`sync_auto_enabled=false`。
2. 若用户输入新密码，先通过 Electron safeStorage 保存/迁移凭据。
3. 执行 `POST /api/sync/check` 严格只读检查。
4. 只有检查成功，才写入 `sync_enabled=true`。
5. 任一步失败都不会把同步误标为已启用。

只读检查可在 sync disabled 状态运行，因此第一次配置不需要先“冒险启用”才能验证。

## 远端验证内容

- endpoint / URL 安全规则；
- WebDAV 认证；
- manifest 可读取性与 SHA-256；
- 已绑定 remote store identity；
- 远端对象键 / 结构；
- 文件夹层级循环；
- 重复标题 / 重复标签；
- file-tag 引用完整性；
- attachment blob 元数据。

连接检查不执行 MKCOL / PUT / DELETE / MOVE / COPY。

## 自动同步门槛

新增 `POST /api/sync/auto`：

- enabled=false：仅更新自动同步状态/间隔；
- enabled=true：要求当前 sync 已启用且 provider=webdav；
- 后端先执行同一套严格只读远端验证；
- 验证失败时 `sync_auto_enabled` 保持关闭；
- 通用 settings API 直接设置 `sync_auto_enabled=true` 会被拒绝。

## 切换远端

如果 endpoint 指向不同 store，而本机仍有旧 remote_store_id：

- 保存新配置后保持 disabled；
- read-only check 报告远端身份变化；
- “重新绑定远端”入口在 disabled 状态仍可见；
- 用户显式 rebind 后再测试并启用；
- 不删除本机或远端内容。

## 验收

功能 HEAD `85a4fbc2da88c8e65d6e4af0dab9eeaf61b873d3` 已通过：

- renderer / Electron build；
- full UI suite；
- Go backend tests；
- disabled-state read-only WebDAV check；
- failed auto verification cannot enable auto sync；
- search race / benchmark；
- Windows backend cross-build；
- backend HTTP smoke；
- Electron/editor tests；
- Windows portable workspace transactions；
- NSIS build；
- brand/dark-theme render；
- native reading storage；
- packaged Windows application smoke；
- installer artifact upload。

## Schema

无新增数据库字段，继续使用 schema 13。
