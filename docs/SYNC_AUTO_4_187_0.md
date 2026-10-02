# 4.187.0 — Knowledge OS Phase 2C：Automatic Sync

## 目标

把 Phase 2B 已验证的 WebDAV transport 从“需要用户每次手动执行”推进到适合日常使用的后台自动同步，同时不削弱现有冲突和事务边界。

## 调度语义

- 仅 WebDAV provider 可以开启自动同步。
- 支持 1–1440 分钟后端有效区间；C 端 UI 提供 1 / 5 / 15 / 30 / 60 分钟常用选项。
- 应用启动后延迟 15 秒首次检查，每 30 秒仅检查是否到期，不等于每 30 秒同步。
- 最近同步时间未达到用户设置间隔时不运行。
- 本机存在 open conflict 时自动同步直接跳过。
- 手动同步和自动同步共享同一个 Engine mutex，单实例内不会并发运行。
- 自动同步网络/transport 错误写入 sync_state 的 last_status / last_error，不中断编辑。

## 安全切换

- 关闭同步会同时关闭自动同步。
- provider 或 endpoint 改变时自动同步被暂停。
- “重新绑定远端”会清空旧 base / remote identity、supersede 旧冲突，同时暂停自动同步。
- 重新绑定不会删除任何本机笔记、附件或远端对象。

## Schema 13

settings 新增：

- sync_auto_enabled INTEGER DEFAULT 0
- sync_interval_minutes INTEGER DEFAULT 5

backup、.lnw package/restore 和 Windows data-safety guards 同步提升到 schema 13。

## 保留的手动能力

- 预演同步仍严格只读。
- 手动执行同步始终可用。
- 冲突中心仍只接受用户明确选择，不会由后台任务自动裁决。
