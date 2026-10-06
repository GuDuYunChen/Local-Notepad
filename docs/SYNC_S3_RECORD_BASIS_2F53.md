# Phase 2F.53 — 从完整本地记录生成只读预览依据

基线 `5fd6be35b93cd385e8ae83b64e61e5aaeea95dd2` / tree `2231f57bb3a3b31f2ba8a7883fdbef977e32e325`，2F.52完整验收6010131436保留。本轮复用已挂载的完整2F52验收包及f74源码归档恢复1012文件同树，没有重下载、clone或重做旧CI；原Overview定向-race10顶层/34通过事件复查没有新已复现阻塞。

## 接口和语义

新增 `ReadS3PlanOverviewFromRecords(ctx, client, pin, S3PlanRecordBasis, S3PlanRecordLimits)`。调用者提供同仓库的完整本地Record JSON字符串表和完整共同基线hash表，先在本地完成严格记录/关系验证，再调用原ReadS3PlanOverview一次。它补上“调用方必须自行计算本地hash”的集成步骤，不修改原hash-only API或分类器。

每个本地JSON先经原decodeS3Record核对精确ID、四类既有载荷、重复/大小写/未知字段、null及Unicode歧义，再使用原encodeRecord计算规范摘要。空白、字段顺序、等价JSON转义不制造正文冲突；正文字符串本身不trim/归一化。附件元数据复用原编码键，purged及回收站保留原含义。完整缓存+nil remote复用原validateRemoteStructure，在任何GET前拒绝孤儿、循环、活跃重名和无效标签关系，不允许回退联网，不泄露原私密错误文本。

所有参数显式有界：本地记录1..1024项、单条1..32MiB、累计1..64MiB；每条按原始JSON与原引擎规范编码两者较大值计费，先查全体原始输入预算，避免借助未转义JSON绕过编码膨胀。原远端单对象/累计/数量及三方并集预算独立保持。输入预算不是进程总内存保证，关系检查仍有1024项CPU上限且前后核context，不承诺逐指令取消。整个本地验证、远端读取和统计共享15秒或更短调用者截止。

本地JSON采用不可变Go字符串并在网络前复制map条目，基线hash也复制。调用者不得在复制期间并发修改输入map；首次GET后修改原map不能改变本次依据。函数不能凭输入本身证明其来自数据库、完整或最新，调用者仍须提供可信的一致完整快照。非nil空map是明确空集；原missing-with-base可能产生purge候选，但不是执行删除的许可。

输出沿用原五字段脱敏统计；没有私密正文、身份或hash。局部失败不返回部分统计，取消保留标准sentinel，输入/关系错误固定拒绝。没有数据库扫描、文件/数据库/同步状态写入、附件blob读取、HTTP/IPC路由、provider、可见设置UI、凭据持久化、上传删除、自动同步或真实桶访问；数量不等于传输完成、来源认证/新鲜度或写/List权限。

## 实际本地验证

独立新Go回归11顶层/63通过事件，包含真实签名读取、六份记录/四类互操作、规范编码一致性、原分类矩阵、严格JSON/非法依据离线拒绝、完整关系离线拒绝、原始/规范字节预算和1024边界、输入修改隔离、实际GET取消、302/403/404/500失败与原回收站/空集语义。原测试文件/断言均未修改。

Go1.23.2 linux/amd64自有最小标准库模块逐字节复制相关源码，定向 `go test -race -json -count=1 -timeout 45s -run ^TestReadS3PlanOverviewFromRecords ./internal/syncengine` 通过；GOTOOLCHAIN=local/GOPROXY=off/GOSUMDB=off/GOWORK=off，无模块或工具链下载，不改真实GoFrame项目模块。两份故意错误实现分别直接hash原始JSON和跳过本地关系验证，均被相同新断言拒绝；只是测试有效性证明，不是用户数据事故或上阶段回归。

原Node保护202、S3scope63+bridge100+HTTP11=174、stage-review62全通过。HTTP单个Go顶层用例含27内部检查，不另累计；catalog/lock仅结构检查。无npm依赖安装或用户数据操作。

## 发布与独立验收门槛

源码、本HEAD CI、原产物独立验收分开；必须原17CI、八PR、完整pushUI/Windows、独立Desktop及额外pushSaveRecovery。四完整UI/实际服务、双Electron、PR同树、Go1.24.11完整后端及新增11真实执行/原S3/controller、品牌/原生/桌面/NSIS仍按原门槛。原JS2308/Electron273保持，后端1324+63=1387只是核对目标，不能当新HEAD通过证据。

仅feature/knowledge-os-phase2 / Draft PR2，未验收不进入2F.54，不改合master/强推/生产发布。新增生产文件而非重写旧调用层，全部既有生产/测试/CI/验收器、产品4.195.1/schema14/package锁与自动保存/Ctrl+S/队列回执/草稿/引用/退出保护保持；不恢复结构变化暂停保存、不删数据/破坏性迁移。46问题/12助手事故原索引保留，具体本轮执行事实单列交付。最终状态只写PR及交付，不为状态另造源码提交。

参考：本轮读取Go官方encoding/json和context文档；不因在线文档新版本改变本仓固定工具链或采用新JSON API。继续用原严格扫描器及原编码器验证项目实际行为。
- https://pkg.go.dev/encoding/json
- https://pkg.go.dev/context
