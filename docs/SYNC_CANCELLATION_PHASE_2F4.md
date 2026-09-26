# Phase 2F.4 — 任务取消传递与分层超时

基于 66b71e11 / 4.189.0 / schema 13。本提交补齐受管任务到实际 WebDAV 请求的 context 链路，不修改数据库、恢复记录格式、三方合并、manifest 发布顺序或自动重放规则。

## 实际接线

RecoveryRunner 的 Run / AutoTick / Resolve 和只读入口创建派生 context；Engine.remoteWithPolicy 把它传给本次操作独有的 WebDAVRemote；所有原有请求由 http.NewRequestWithContext 创建。上层取消可传到连接、等待响应头、发送请求、读取响应体和读取重试等待。原有 NewWebDAVRemote 构造器保留 Background 行为供旧测试及显式内部调用；受管 Engine 不再走该默认路径。

## 分层预算

- 连接检查、同步预演、自动同步启用验证，以及任务内的只读预检：默认 30 秒。
- 受管 Run / AutoTick / Resolve：默认 10 分钟，包含预检与写入阶段，不在阶段切换时重新计时。
- 较短的调用者截止时间优先，内部预算不能延长它。测试覆盖仅可缩短的内部参数，没有新增用户配置字段。
- 2F.2 的单次读取重试继续使用共同截止时间；不会因为重试又获得完整任务时长。变更请求仍不自动重放。
- 这些是协作式 context 预算，不是对本地文件哈希、磁盘调用、JSON 处理或等待内部互斥锁的硬执行时间保证。

## 取消后的锁清理

数据请求取消后，锁释放使用独立的、总预算不超过 3 秒的 context，仅检查 owner.json 并在 token 匹配时尝试一次 DELETE。它不会继续上传、发布 manifest 或重启同步。读取所有权失败、内容无效或 token 不匹配时不删除。

写入 owner.json 失败后的清理也改为上述所有权检查，不再直接删除锁目录。所有权不明确时可能保留锁，交由后续核查；清理是尽力而为，不保证一定成功。现有远端锁租约、过期回收及检查与删除之间的跨设备竞争未在本提交解决，不能据此宣称获得分布式锁安全保证。

## 恢复状态保持保守

- 调用者在只读预检时取消：不进入 applying，不误记成功。
- 只有预检子预算超时，而整个任务 context 尚有效：沿用既有临时网络分类，保存只读阶段的退避。
- 进入 Engine.Run / Resolve 后取消或超时：沿用 applying / review_required 保护，不自动重跑，不宣称回滚。
- 附件下载收到部分数据后取消：不发布未完成目标，按原有逻辑移除临时文件。
- 调度器 context 取消可结束正在执行的网络预检，不再等完整 WebDAV 单请求超时。

## 明确未包含

没有新增 UI“取消同步”按钮或取消 API，也没有修改应用退出信号顺序。HTTP 断连是否触发调用者 context 由现有 HTTP 框架处理，本提交不保证关面板必然取消操作。没有改本地文件读取/哈希的取消能力，没有取消已提交的远端写入，也没有端到端事务回滚。旧内部 Engine API 绕过 RecoveryRunner 时不具有本阶段的任务预算。

## 验证

新增 12 个标准库可运行的测试，含 GET / PROPFIND / PUT 取消、重试等待取消、截断附件不发布、取消 PUT 后不再探测或重放、锁清理所有权检查与限时、预算继承、旧构造器兼容，以及真实 Engine 工厂到网络请求的 context 传递。工厂测试只用最小 SQL driver 返回配置行，不模拟或证明 SQLite 事务行为。

本地在隔离模块中使用实际生产源码运行上述测试，race 检查重复 20 轮通过；go vet 通过；Windows/amd64 测试二进制跨编译通过，未执行该 Windows 二进制。隔离模块不等于整仓库验证；未改动仓库 go.mod。

另新增 4 个使用仓库现有真实 SQLite fixture 的集成测试，其中写入取消测试包含主动取消和到期两个子场景，覆盖预检退避、取消后释放闸门、禁止自动重放不确定写入，以及调度器取消。这些由原有 go test ./... CI 收集，本地缺少完整依赖尚未执行。

完整 Go / React / Electron 回归与 Windows 打包以新提交 CI 结果为准。本阶段不将整个 Phase 2F 宣称完成。

实现参考：Go net/http NewRequestWithContext、context.WithTimeout、context.WithoutCancel 官方文档。
https://pkg.go.dev/net/http#NewRequestWithContext
https://pkg.go.dev/context#WithTimeout
https://pkg.go.dev/context#WithoutCancel
