# Phase 2F.62.1 — 本地附件名称歧义修补

基线 e1dea6f1f9a4257e8ae41821b5753328d94e565a / tree 135aa510143d902e053d6829e833113b4856d92d。2F.62 原验收评论 6050349994 保留。本次接续先恢复同树源码、核对原验收及 46 条历史问题/12 类助手执行失误，再复查本地读取。没有重做已交付阶段，没有开始 2F.63。

## 已复现的缺口

原附件枚举仅按字节完全相等排重，因此 Linux 临时目录内 report.txt / REPORT.txt 可同时进入 snapshot、candidate 和 overview。另在内部投影中，规范 Record 解码不足以重新证明本地读取器的可移植名称约束；规范编码的 CON.txt、尾点、尾空格、冒号和问号名称仍能进入统计。只操作自有测试数据，没有用户文件覆盖或真实同步事故的证据；原 S3 生产设置入口仍未接入。

在旧生产源码上新增回归实际运行：21 个失败叶场景（6 个真实 Linux 读取路径、10 个大小写折叠投影、5 个名称投影）及 3 个父测试失败，原日志保留。旧定向基线 37 顶层/187 通过事件无失败。并非把此前全部验收判作未发生，也不是 ChatGPT 流恢复故障。

## 修补行为

两个旧生产文件变化。目录首次和最终枚举统一使用 s3LocalAttachmentNameAvailable，先执行原名称约束，再以 strings.EqualFold 检查本清单已有名称；完全重名也拒绝。不采用 ToLower 比较，覆盖 Kelvin 符号、长 s 和 sigma/final-sigma 等简单 Unicode 折叠。初始冲突只开目录，正文未读就整份拒绝；最终枚举出现冲突也丢弃整份结果。内部概览重新执行相同名称及集合约束，不能让畸形内部候选绕过读取器。

不改名、不规范化、不合并、不去重取第一份，不按相同内容豁免冲突；原始文件名、内容和借入能力保持。沿用固定错误、零部分结果、清理及共用截止。seen 由原最多 128 个附件的预算约束，逐项检查 context；没有额外 I/O、缓存、重试、凭据、网络、写删或新端口。

这是保守的简单 Unicode 折叠政策，不是 NTFS 精确排序规则、Unicode 规范化、8.3 别名或硬链接认证。ß/ss、预组合/分解重音仍按此明确范围区分，未来目标文件系统的实际碰撞检查仍不可省略。CompleteForPreview 始终 false；不以盘点授权跨平台写入或同步。

## 实测及验收边界

最终标准库隔离模块 Go1.23.2 linux/amd64，原生产包逐字节复制并保存摘要；go test -p=2 -race -json ./internal/syncengine -count=1 -timeout=40s 实际 43 顶层/226 通过事件，0 fail/skip（旧 187 + 新 39）。6 个新顶层测试分别覆盖实际初始枚举、最终枚举、内部别名、名称约束、合法区分、共享政策。真实 Linux 测试由 _linux_test.go 平台选择，跨平台内部契约不依赖 Windows 创建大小写双文件，不新增 t.Skip。

本地 Node：保存/草稿/退出/缓存及自有进程收尾 125/125；原 preview binding/session/bridge、probe scope/bridge 和阶段核验器 457/457；真实 Go 拒绝响应共享契约 5/5。均保留原断言。catalog 只核历史索引完整性，不算回归执行。

本地首次 Go 冷编译、HTTP/拒绝测试合并调用曾被执行时间预算中断，未产出完整报告，不算通过；保留原残留输出。Go 限制编译并行后完成，拒绝测试拆为独立任务后完成。不将执行环境超时当产品失败，不修改原测试超时或工作流以掩盖。

本地未安装 npm 依赖、下载 Go 工具链/模块或执行 Windows 应用。必须待新 HEAD 的原工作流、Go1.24.11 全后端、双平台完整 UI、真实服务、Electron、Desktop 及原始安装包/截图完成核验，才可最终验收；本文件是提交前事实快照，不提前宣称远端通过。原 46 项索引、12 类事故、旧测试/断言/工作流/锁、4.195.1/schema14 和保存保护字节不变；本次新缺口在本文及 PR 单独追踪，未冒充已并入旧索引。

仅 feature/knowledge-os-phase2 / Draft PR #2，不合 master，不强推、不生产发布、不操作真实用户库、文件或桶。最终状态写 PR/交付，不为一句状态另造提交。

参考：Microsoft Naming Files, Paths, and Namespaces（https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file）；Go strings.EqualFold（https://pkg.go.dev/strings#EqualFold）。Windows 默认不区分大小写的依据与本项目保守政策区分记录。
