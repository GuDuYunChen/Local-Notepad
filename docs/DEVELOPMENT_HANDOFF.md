# 开发接续点

## 当前阶段

当前候选 **Phase 2F.42：显式S3只读预检renderer调用层**，见 `SYNC_S3_RENDERER_PROBE_2F42.md`。沿用 feature/knowledge-os-phase2 / Draft PR #2，不合master、不发布生产，产品4.195.1/schema14不变。

已验收基线 `1cfb12bf2899e5eff6864c4ea5347ee2171d2f88` / tree `746b0aa7694ed1517dd46e6264d2411257ab6f90`，2F.41完整验收评论5981057926。此前3c01ffe已发布原桥，3189ee5补Electron原始报告，1cfb12b修复夹具自有连接收尾；八PR、push完整UI/Windows、Desktop、双平台2149完整UI及19实际服务、源码绑定后端、原生和NSIS已独立核验。旧日志不可读不是当前阻塞，不用旧失败推翻新HEAD验收。2F.40验收5978940337继续有效。

本候选在现有services/api.js提供惰性的createS3ReadProbeSession，显式read才通过既有原生桥发起一次只读检查；请求快照、严格脱敏响应和固定提示，invalidate/dispose抑制迟到结果。renderer停止等待不等于原生取消，原生Promise结束前不开放会话新调用。没有设置UI、配置或凭据持久化、provider/List/上传删除/自动同步及真实桶访问。

发布前新98项及原保存退出80项通过，原S3 Node171项通过；保留首轮Proxy重入反例97/98与修补后的原断言。新阶段源码完成、当前HEAD的CI和产物独立验收仍分开，以最新PR及实际HEAD为准，不能沿用1cfb12b绿灯。原46问题及12类助手事故完整保留。

## 中断恢复

先读远程HEAD及PR，区分源码完成、当前提交CI通过、产物独立核验三个检查点。聊天没有最终输出不等于Git写入失败；写入没有回执先读取目标，不重复推送。不得按过期标题或历史文档重做已有阶段。

至少核对八条PR流程、push完整UI/Windows打包及独立桌面流程；PR测试合并的文件树要与实际分支核对。产物按ID、提交、平台和摘要选择，完整原始UI报告不能用身份小文件代替。只查询待完成项，不连续展开大响应或下载旧产物。

## 已知问题和助手执行失误

`KNOWN_ISSUES.md`及机器索引保留46条产品/环境/测试问题（38历史修复、3缓解、5持续或外部）；`ASSISTANT_EXECUTION_INCIDENTS.md`单独保留12类助手执行错误，不混作聊天故障根因。各轮具体操作失误保留于 `EXECUTION_NOTE_2F30.md` 至 `EXECUTION_NOTE_2F40.md`，不能把失败调用写成通过。

遵守 `STAGE_REVIEW_PROTOCOL.md`：同run检查至少间隔90秒，30次连接器调用前检查预算；长日志留文件，关键节点短交代。每个故障链最多一次有新证据的手工重试；工具安全拒绝不绕过。这些措施减少重复工作，不保证ChatGPT平台不中断。

## 构建与产品边界

使用 `npm ci --no-audit --no-fund`，保留完整package-lock。先执行 `node scripts/verify-dependency-lock.mjs`，依赖更新同时评审manifest和lock，不用npm install回退。`node scripts/stage-review.mjs catalog`只验证索引关系，不运行回归；CI快照全部绿色也仍需产物核验。

不擅自修改自动保存、Ctrl+S、保存回执/队列、引用维护或退出保护；章节结构变化暂停自动保存的旧规则已废止。测试使用隔离数据，不冒充用户现场。原生脚本和应用保存错误、npm下载故障、工具拒绝、聊天流中断分开判断。

升级前备份工作区和未确认正文；不要用4.189.0打开schema14。源码归档恢复不是clone成功；本地保留的测试依赖不是新执行npm ci。最终Windows/Go和完整UI结果以当前提交的实际CI与原始报告为准。

## 手动与小时任务

手动关键节点只更新既有小时任务prompt，不暂停、重建、重排或另开并行运行；确认HEAD、源码推送、CI变化和验收分别接续。提示中的进行中标记不是原子锁，更新和推送前核对实际HEAD；写入不明先读取，不覆盖其他执行者。权限偏好不覆盖独立安全检查，遇新拒绝停止相关动作、不换路径绕过。

## 2F.41已验收的保护不得回退

保留原桥精确页面/主窗口主frame、生命周期取消、7.5秒绝对截止及请求close前持有并发槽；保留Windows synthetic path修正和测试自有socket有界收尾。Go标准库夹具只能逐字节复制三份原生产文件，在独立临时目录module-off、GOTOOLCHAIN=local运行，不把完整GoFrame项目改为module-off。

原生桥和renderer会话均不改变保存/退出门禁。旧403/404不能解释成密码错误或凭据通过；只读结果不等于完整S3同步。旧阶段详细事实见2F.41协议、ELECTRON_TEST_EVIDENCE_2F41.md及验收评论5981057926，源码文档中的发布前候选措辞只作历史。
