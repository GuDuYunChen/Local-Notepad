# 开发接续点

## 当前修补：2F.44.1 旧输入版本的命令回调失效

基线 `6d662b9d46abd657324628571a31101eabd2e963` / tree `f718d9c9b533f55bebff4f09757814ece92108c7`，2F.44当时的验收评论5985557594与历史证据保留。复查发现原hook返回共享read/invalidate，旧revision保存的回调仍能发起读取或影响新结果。本轮先修既有边界，不进入2F.45；详见 `SYNC_S3_HOOK_COMMAND_SCOPE_2F44_1.md`。

只改hook命令代际门禁：render创建token，layout effect提交身份；旧read/invalidate先拒绝、不检查输入、不调用原生或改写当前状态。A→B→A不复活旧回调，Suspense未提交render不取得权限，同revision回调稳定。原session/binding和所有保存/退出/凭据规则保持。独立文件新增10项真实React回归，原12项测试文件逐字节保留。

本地同步hook模型原3反例全部失败、修后3通过；202绑定/renderer/保存退出、172 S3和62原验收器回归通过。这不是本地React实测。新HEAD仍须四份完整UI2294/19、两个文件合计22项hook实际执行、Electron259、完整后端/Windows/原生/桌面及原产物独立核验。最终状态以最新PR及验收记录为准，不提前宣称CI通过，不为状态再造源码提交。

## 恢复和历史依据

先读真实远程HEAD、PR #2和最新接续记录，不按旧标题或发布前候选措辞重做。源码完成、当前HEAD的CI通过、原始产物独立核验分开记录；回执不明先读目标，不重复写入或覆盖并行进展。

既有验收：2F.44评论5985557594；2F.43评论5985192841；2F.42评论5981504611；2F.41评论5981057926；2F.40评论5978940337；2F.39/39.1评论5955810680。阶段协议及交付归档保留全部原始失败/修补/验收证据。旧3c日志不可追回不能猜同因，46a577c旧Windows失败不重做。详见各 `SYNC_S3_*` 文档及 `ELECTRON_TEST_EVIDENCE_2F41.md`。

`KNOWN_ISSUES.md`和`quality/known-issues.json`保留46问题（38历史修复、3缓解、5持续或外部），`ASSISTANT_EXECUTION_INCIDENTS.md`保留12类助手失误。新回调缺口及本轮原反例单列修补协议；不重复计数或删除旧证据。必须读 `AGENTS.md`、上述索引和 `STAGE_REVIEW_PROTOCOL.md`。catalog只检查文件关联，`testsExecuted:false`不能当测试通过。

## 固定保护

只在 `feature/knowledge-os-phase2` / Draft PR #2开发，不合或修改master，不强推、生产发布或操作用户真实数据。产品4.195.1/schema14保持，不能使用4.189.0打开schema14数据库。自动保存、Ctrl+S、保存队列和回执、草稿、引用、退出保护不得削弱；不恢复章节结构变化暂停自动保存的旧规则，不删数据或破坏性迁移。

保留原桥精确主窗口/页面/主frame、导航取消、7.5秒绝对截止和请求close前持槽；保留Windows路径与测试自有客户端/服务端有界收尾。真实Go项目不可module-off，只有独立标准库夹具允许逐字节复制原三文件、GO111MODULE=off及GOTOOLCHAIN=local，不下载工具链/模块。

S3仍只有显式只读预检，无配置/凭据持久化、设置UI、provider/List/上传删除/自动同步或真实桶访问。前端停止等待不等于原生I/O已取消；403/404和可读对象不证明凭据有效或List/写权限，公开意图头不是认证，不称完整S3同步。

## 执行与验收

使用原锁；npm ci --no-audit --no-fund前先运行verify-dependency-lock，不删锁、不npm install回退或依赖大升级。无新证据不重试失败DNS/tarball/旧日志接口/失效fileID，不重复clone/install。安全拒绝只停对应动作，不换接口、账户、代理或执行器绕过。update_ref不传已知运行时不支持的expected_sha，发布前重读ref并force=false。

只查待完成run，同run至少90秒，30外部调用前保存检查点评估。长日志留文件，关键节点简短汇报。必须核八PR、完整push UI/Windows、独立Desktop及额外push SaveRecovery；PR测试树同源，四份完整UI/实际服务、源码绑定Go1.24.11后端/S3/controller、原生/桌面/NSIS独立核验，不能靠旧绿灯或身份小文件。

手动关键节点只更新既有任务prompt，不改schedule/DTSTART/timezone/启用状态/title，不run_now、重建、重排或另开并行运行。更新前读取最新任务和HEAD；进行中提示不是永久锁。工具错误、应用故障和ChatGPT投递超时分别记录，不承诺平台永不中断。
