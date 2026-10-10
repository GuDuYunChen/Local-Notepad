# Phase 2F.7.3 — 修复新建数据库设置读取失败

保持 4.189.0 / schema 13 / feature/knowledge-os-phase2；PR #2 保持 Draft，不合并 master。

## 先修复前阶段，不进入新功能

Phase 2F.7.2 提交 fac5aaea 的 PR CI #1216 已通过退出保存 Node 30 项、React 15 项、缓存/回执回归、常规 UI、同步活动和 Go 后端测试，但真实后端退出测试在设置写入时失败。后续搜索、HTTP、Electron/编辑器和 Windows 打包不能据此宣称通过。

诊断提交 f3d2c612 仅在原断言中加入测试 API 回执，不删改验收条件。PR CI #1218（run 36229792650，job 108370660574）报告：`sql: Scan error on column index 2, name "sync_enabled": converting NULL to int64 is unsupported`，失败发生在进入不确定写入阶段之前。

## 根因与正式修复

启动迁移创建的 settings.sync_enabled 允许 NULL，初始记录只写 id 与 theme。SettingsDAO.Get 却将未经默认处理的 sync_enabled 扫描至 int，令新建数据库或历史空值记录的读取及部分更新失败。既有逻辑测试预填了 sync_enabled=1，未覆盖这个真实启动状态。

正式代码只修改 SettingsDAO.Get 的一个 SELECT 表达式：`sync_enabled` 改为 `COALESCE(sync_enabled,0)`。未知旧值默认为关闭；明确的 0/1 不改变。GET 不写数据库，不批量重置偏好，不调整迁移版本、同步算法、凭据策略或退出时限。

本次从不可变 f3d2c612 读取的 DAO 源文件在本地重算 Git blob 为 1f4366a910ba99bedb4d566dd6c3a8732791e595，与远端一致后才作最小修改。

## 回归覆盖

新增 settings_nullable_test.go，五个 Go 测试函数、七个叶子场景：

- NULL、明确关闭、明确开启三种记录正确读取，并检查 GET 不回写原值。
- 仅 id/theme 的初始行可以读取、首次修改主题并再次读取；同步保持关闭。
- 旧空值记录的主题部分更新保留端点、provider 和编辑器偏好。
- 空值兼容不绕过自动同步开启的连接验证限制；拒绝操作不改原行。
- 无效 editor_opts 仍拒绝读取/覆盖，不借修复空值吞掉其它数据错误。

真实进程 suite 保留四个原测试，增加第五个新建数据库 HTTP 场景：健康就绪后直接 GET 设置、PUT 主题、再次 GET 核对持久化及同步关闭，最后通过父进程协议干净退出。该 suite 已由原 CI 在 Linux 和 Windows 调用，不另设省略后续检查的快速通过路径。

## 验证界限

本地已完成：原文件 blob 摘要核对、最小生产 diff 检查、新 Go 测试 gofmt/语法格式检查、Node 语法检查，以及 SQLite NULL/default/明确值读取的只读语义实验。

本地没有完整 Go/React 依赖，未声称新增 Go 或真实进程测试本地通过。以修复提交的 PR 与 push CI 运行结果决定验收；尤其 Windows 打包必须检查 push 工作流，PR 工作流不执行该任务。完整回归未绿之前不进入下一业务阶段。
