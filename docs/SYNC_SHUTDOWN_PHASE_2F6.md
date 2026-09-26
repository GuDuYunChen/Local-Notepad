# Phase 2F.6 — 受管后端退出与收尾屏障

基于 ecb6931f / 4.189.0 / schema 13。不修改数据库、恢复记录格式、远端锁租约、三方合并或自动重放规则。

## 已接入桌面与后端

- Electron 通过 `spawnManagedBackend` 创建独有 stdin 管道和 `NOTEPAD_PARENT_STDIN=1`。退出、凭据重启和恢复回滚前停止旧后端均走同一 stop helper。
- 私有管道只接受固定一行 `LOCAL_NOTEPAD_SHUTDOWN_V1`；EOF/管道失效也请求收尾。未显式启用的普通 CLI 不监听 stdin。没有新增 HTTP 关机接口或 renderer 控制通道。
- 受管子进程先获得至少 10 秒收尾机会，不在 Windows 上一开始发送会强制结束进程的 SIGTERM。逾期才发送 SIGKILL，额外最多 1 秒确认退出。
- `child.killed` 不作为“已退出”证据。未观察到退出则拒绝 stop Promise，阻止后续后端重启/工作区替换。发信号、写管道成功和 error 事件都不等于退出确认。
- 并发 stop 调用共享同一 Promise。重复 before-quit 不能绕过等待；退出期间的异步密码加载不得新建子进程。退出无法确认时保留旧 child 引用，不直接批准退出。

## 服务收尾次序

1. GoFrame 使用 Start 而非 Run/Wait，应用拥有唯一的退出信号处理路径，不让框架的独立退出处理抢先结束 main。
2. 收到父进程命令、管道关闭、SIGINT/SIGTERM 或服务根 context 取消后，先封闭 HTTP 新请求入口和受管同步入口。
3. 已接受的 HTTP 本地保存不因封闭入口被主动取消；受管同步及设置操作收到取消信号，应用级备份/清理与同步调度器也收到停止信号。
4. 等待任务的 defer、锁清理、恢复记录处理、已接受的 HTTP handler、后台循环与 HTTP 停止过程完成，然后才允许 main 正常返回并关闭数据库。
5. 总等待预算 8 秒；HTTP 停止内部预算 3 秒。超时异常退出，不并发执行常规 DB.Close，不清除恢复记录，不宣称同步成功或回滚。

`syncjob.Lifecycle` 的 Seal 只封闭入口，Stop 额外取消已接受的调用；通道只在每个调用显式 finish 后关闭，取消信号本身不会让等待结束。RecoveryRunner 的网络任务、AutoTick 初步读取、设置/重新绑定和状态读取均纳入收尾计数。

## 安全边界

- 正常收尾完成只是调用已返回，不是“全部写入已撤销”。已进入写入阶段的取消仍保持 applying/review_required，重启后不自动重跑。
- 自动同步开关不在退出时清空；下次启动仍由持久化恢复记录决定是否允许执行。
- 强制退出、断电、磁盘卡死和外部进程结束不能保证清理完成；本次不声称断电持久性或分布式锁安全。
- 未新增编辑器未保存草稿的退出确认/刷新协议。只保证让后端已经接受的本地请求在预算内收尾，不保证 renderer 尚未发送的内容已保存。
- 正常 CLI 不受父管道管理；Windows 外部 SIGTERM/任务管理器强杀不等于私有管道正常收尾。
- 未修改既有 HTTP 长请求响应期限、远端锁回收、凭据迁移事务和备份恢复算法。

## 验证

本地 15 项标准库 Go 测试（Lifecycle 9、父管道/等待 6），race 重复 20 轮通过，go vet 通过；独立 Windows/amd64 测试二进制跨编译，不在本地执行 Windows 二进制。

本地 13 项 Node 测试通过：实际 stop/spawn helper、退出确认/超时/错误、重复退出，以及提取实际 Electron before-quit/startBackend 函数测试。不是完整 Electron 界面运行验证。

新增 3 个 Runner 集成测试函数（其中网络取消含只读/写入两个子场景）；4 个真实后端进程测试覆盖父命令、父管道 EOF、非受管 CLI 和写入中退出保留恢复记录，分别接入 Linux 和 Windows CI。保留并更新原 Electron 停止测试以验证“实际退出”而非旧的假成功约定。

本地无法联网取得完整仓库依赖，真实 SQLite/GoFrame 进程、Vitest、Electron 和 Windows 打包仍以本次 CI 实际结果为准。包版本仍为 4.189.0，本阶段不表示整个 Phase 2F 已验收完成。

参考：Node.js child_process.kill / killed 官方说明；GoFrame v2.7.4 Server.Start / Run / Shutdown 实现；Go context 取消语义。
https://nodejs.org/api/child_process.html#subprocesskillsignal
https://raw.githubusercontent.com/gogf/gf/v2.7.4/net/ghttp/ghttp_server.go
https://raw.githubusercontent.com/gogf/gf/v2.7.4/net/ghttp/ghttp_server_admin.go
