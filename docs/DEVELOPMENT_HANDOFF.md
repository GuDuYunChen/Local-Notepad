# 开发接续点

## 当前阶段

当前候选 **Phase 2F.39：显式S3只读对象预检**，见 `SYNC_S3_READ_PROBE_2F39.md`。沿用GuDuYunChen/Local-Notepad的feature/knowledge-os-phase2 / Draft PR #2，不合master、不发布生产，产品4.195.1/schema14不变。

基线0b93e7ac14c6f07321724dc81217505570e0fdb8 / tree262ac6eba0f677355a450fd9af452cef270b62a5已独立验收，SREAD-01/02修补保留。验收评论5954433635的错误模块日志证明由评论5954554287更正：排除不一致的push日志/路径文件返回，按Git树与blob确认真实module notepad-server、go1.22、toolchain go1.24.11；同树PR job110865092273实际go test ./...通过syncs3。八PR、push完整UI/Windows、Desktop以及双平台1971UI/19服务、原生21帧、桌面8检查5PNG和安装包均有独立核验。差异原因未知，不将错误片段继续作为证明。

新增ProbeRead是显式调用的只读基础API：只对调用者选定键执行一次现有有界签名GET，返回不含正文/ETag/键/端点/凭据的分类摘要。失败不当成连接成功；403/404不推断密钥正确或错误；没有探测对象写入、HEAD/List替代、重定向、重试或自动同步。尚未增加设置UI/HTTP路由、注册provider或保存凭据，不能声称完整S3同步可用。本候选仍须新HEAD的全部CI和原始产物验收，完成前不进入2F.40。

原2F.35–2F.37及TEST-08验收保留，不重复开发或下载旧证据。GitHub专属full_access按用户授权正常设置；手动与原小时任务关键节点同步prompt，不改变调度/启用状态。时间展示仅洛杉矶。

## 中断恢复

先读远程HEAD及PR，区分源码完成、当前提交CI通过、产物独立核验三个检查点。聊天没有最终输出不等于Git写入失败；写入没有回执先读取目标，不重复推送。不得按过期标题或历史文档重做已有阶段。

至少核对八条PR流程、push完整UI/Windows打包及独立桌面流程；PR测试合并的文件树要与实际分支核对。产物按ID、提交、平台和摘要选择，完整原始UI报告不能用身份小文件代替。只查询待完成项，不连续展开大响应或下载旧产物。

## 已知问题和助手执行失误

`KNOWN_ISSUES.md`及机器索引保留46条产品/环境/测试问题（38历史修复、3缓解、5持续或外部）；`ASSISTANT_EXECUTION_INCIDENTS.md`单独保留12类助手执行错误，不混作聊天故障根因。各轮具体操作失误保留于 `EXECUTION_NOTE_2F30.md` 至 `EXECUTION_NOTE_2F39.md`，不能把失败调用写成通过。

遵守 `STAGE_REVIEW_PROTOCOL.md`：同run检查至少间隔90秒，30次连接器调用前检查预算；长日志留文件，关键节点短交代。每个故障链最多一次有新证据的手工重试；工具安全拒绝不绕过。这些措施减少重复工作，不保证ChatGPT平台不中断。

## 构建与产品边界

使用 `npm ci --no-audit --no-fund`，保留完整package-lock。先执行 `node scripts/verify-dependency-lock.mjs`，依赖更新同时评审manifest和lock，不用npm install回退。`node scripts/stage-review.mjs catalog`只验证索引关系，不运行回归；CI快照全部绿色也仍需产物核验。

不擅自修改自动保存、Ctrl+S、保存回执/队列、引用维护或退出保护；章节结构变化暂停自动保存的旧规则已废止。测试使用隔离数据，不冒充用户现场。原生脚本和应用保存错误、npm下载故障、工具拒绝、聊天流中断分开判断。

升级前备份工作区和未确认正文；不要用4.189.0打开schema14。源码归档恢复不是clone成功；本地保留的测试依赖不是新执行npm ci。最终Windows/Go和完整UI结果以当前提交的实际CI与原始报告为准。

## 手动与小时任务

手动关键节点只更新既有小时任务prompt，不暂停、重建、重排或另开并行运行；确认HEAD、源码推送、CI变化和验收分别接续。提示中的进行中标记不是原子锁，更新和推送前核对实际HEAD；写入不明先读取，不覆盖其他执行者。权限偏好不覆盖独立安全检查，遇新拒绝停止相关动作、不换路径绕过。
