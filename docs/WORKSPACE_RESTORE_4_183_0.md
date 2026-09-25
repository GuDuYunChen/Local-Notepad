# 4.183.0 — Knowledge OS Phase 1B：安全工作区恢复

基线：4.182.0 .lnw 导出/校验能力，开发分支 feature/knowledge-os-phase1。

## 恢复协议

1. 用户选择 .lnw；
2. 全包逐文件 SHA-256 复检；
3. 数据库抽取为独立 backup-manual-workspace-<id>.db；
4. 使用既有 Go --data-safety inspect 再做 SQLite integrity_check、表结构与 schema 校验；
5. 附件写入 app-owned staging，所有文件再次逐个校验；
6. UI 只显示预检结果，当前 data.db / WAL / SHM / uploads 尚未变化；
7. 用户第二次明确确认后，写入不可覆盖的 pending marker；
8. Electron 返回确认成功后自动重启；
9. 新实例取得 single-instance lock 后、启动本地后端前再次复检 marker、receipt、数据库和全部附件；
10. 当前 DB/WAL/SHM/uploads 用同文件系统 rename 移入 workspace-restore-preserved-*；
11. 发布恢复数据库和附件并再次校验；
12. 只有成功后才删除 pending marker。

## 回滚

- 发布过程中任一步失败：新状态移到 workspace-restore-failed-*，原数据按逆序移回；
- 恢复文件发布成功但本地后端 8 秒健康检查失败：停止失败后端，把新状态移到 workspace-restore-health-failed-*，再恢复原数据并重新启动后端；
- 自动回滚本身若失败，抛出 WorkspaceRestoreCriticalError，应用不启动数据服务，要求人工检查保留目录，避免继续写入不确定状态。

恢复前数据不会自动删除。导入的数据库快照也作为手动 backup 保留。

## 安全边界

- Renderer 不能提供任意磁盘路径；所有 .lnw 来源均由 Electron native open dialog 选择；
- confirm 只接受当前进程刚签发的 24 位随机 restore id；
- 正式安装版才允许 confirm；开发环境只允许预检；
- pending marker 使用 no-replace hard-link publish，已有 pending 恢复不会被覆盖；
- 附件仅接受 .lnw v1 的扁平 uploads/<filename>，拒绝路径穿越、符号链接、额外条目和 hash 变化；
- 未保存草稿、窗口临时状态和独立核对存档不在 .lnw 中，UI 明确提示。

## 验证

- electron/workspace-restore.test.js：预检、取消、正式版门槛、pending marker、startup apply、中途故障回滚、health rollback、tamper rejection、并发锁和 IPC 信任边界；
- WorkspacePackagePanel.test.jsx：两步确认、取消、卸载清理、异常回执、浏览器降级；
- Windows push CI 额外直接运行 portable/restore transaction tests，再进入 NSIS package smoke。
