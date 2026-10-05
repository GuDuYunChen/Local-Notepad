# 开发接续点

## 当前阶段：2F.48 钉定附件记录的完整 blob 读取

基线f9dd562e8568f5e90e09e08c991dea6cb876456b/tree4fc0d11bfe8c67e223105cd350d97fd66dcc745c，2F.47完整验收5990100953。复查无新复现的上一阶段产品阻塞。本阶段ReadS3Attachment复用原ReadS3Record和GetVerifiedObject，重新验证清单/精确附件元数据，再读blobs/<hash>；摘要及声明大小同时匹配才返回私密内部对象。详见 `SYNC_S3_PINNED_ATTACHMENT_2F48.md`。

最多三次有界GET，共享15秒或更短截止；三个预算均1..32MiB，声明过大零blobGET，空附件仍实际验证空blob。缺失/purged/404均不是空附件，错误零Bytes/Metadata。没有文件安装、数据库/同步状态写入、完整树验证、provider/UI/凭据保存/上传删除/自动同步或真实桶访问；旧记录API、所有既有生产/测试/工作流/锁/schema14不变。

本地独立标准库-race新12顶层/73事件与原清单/记录24/200、S369/428通过；大小和摘要绕过的两个隔离错误实现被拒绝。首轮新隐私辅助断言误匹配公共“附件”文字的失败与纠正、组合命令外层预算及有界原入口诊断均留档，未改旧断言/门槛。原保护202、S3合计174、stage62通过，非本地完整React/GoFrame/Windows。新HEAD全部17CI、四UI2296+19、双Electron261、完整Go预计1157事件/111源码绑定及原生/桌面/NSIS仍须独立核验。以真实PR及最终交付为准，2F.48完成前不进入2F.49。

## 历史与恢复

先读真实HEAD、PR #2和最新检查点；区分源码完成、当前HEAD的CI、原始产物独立验收。写回执不明先读目标，不重复推送或覆盖并行进展。源码协议candidate/pending是发布前快照，不能推翻后来同HEAD的实际验收；完整历史快照与失败原件保留在历次ACCEPTED归档，不再在本文件堆叠过期“等待验收”。

历史验收：2F.47/5990100953；2F.46/5988418986；2F.45/5987877620；2F.44.1/5986972515；2F.44/5985557594；2F.43/5985192841；2F.42/5981504611；2F.41/5981057926；2F.40/5978940337；2F.39/39.1/5955810680。相应SYNC_S3_*协议、ELECTRON_TEST_EVIDENCE_2F41.md及交付保留原范围和修补。旧3c日志不可追回不能猜同因，不重做46a577c旧Windows失败。

读 `AGENTS.md`、`KNOWN_ISSUES.md`、`ASSISTANT_EXECUTION_INCIDENTS.md` 和 `STAGE_REVIEW_PROTOCOL.md`。机器索引真实路径 `docs/quality/known-issues.json`，保留46问题（38历史修复/3缓解/5持续或外部）和12助手事故，不将存在回归文件当测试通过。新候选反例和执行失误单列当轮交付，不重复累加全局编号。

## 不可削弱的保护

仅feature/knowledge-os-phase2 / Draft PR #2，不修改或合入master、不强推、生产发布或操作真实用户数据。产品4.195.1/schema14不变；不得用4.189.0打开schema14数据。自动保存、Ctrl+S、保存队列/回执、草稿、引用、退出保护保持，不恢复结构变化暂停自动保存、不删数据或破坏性迁移。

保留原生桥精确主窗口/页面/主frame、导航取消、7.5秒绝对截止和请求close前持槽；保留Windows合成路径、自有客户端/服务端有界清理及HTTP组单监听器。前端停止等待不是原生I/O取消。S3摘要pin须独立可信，403/404或对象可读不证明凭据有效、归属、最新或写/List权限；公开意图头不是认证，不称完整S3同步。

## 执行纪律

恢复源码索引后比较必须显式给基线tree；使用git ls-files -z处理中文路径。不要重下已核源包/产物或运行旧生成器重造。npm ci --no-audit --no-fund前核原锁，不删锁/npm install回退/依赖大升级；完整GoFrame项目不module-off，只有独立标准库夹具可最小模块或module-off且GOTOOLCHAIN=local，不下载工具链或模块。

已知失败的numeric run/joblogs/annotations/repo-artifacts集合/filename-scoped workflow-runs GET400、opaque日志、失效fileID、公开下载/DNS/tarball路线不重试。安全拒绝只停止对应动作，不换接口/账户/代理/执行器绕过。update_ref不传不支持的expected_sha，发布前重读HEAD、force=false。

只查未完成项，同run至少90秒，30外部调用前保存检查点评估；长日志写文件，关键节点短汇报，不重复clone/install/全PR大日志或发现已加载工具。正常CI不取消或手工重跑。必须八PR、完整push UI/Windows、Desktop及额外push SaveRecovery，四UI/实际服务、同源PR树、源码绑定Go1.24.11后端/S3/controller、原生/桌面/NSIS全部独立核验，不以旧绿灯或身份小文件替代。

关键节点只改既有任务prompt，不改schedule/DTSTART/timezone/启用状态/title，不run_now、重建、重排或操作单次启动器。更新前读最新任务与HEAD，进行中提示不是永久锁。工具故障、应用问题、ChatGPT投递错误分别记录，不承诺平台永不中断。
