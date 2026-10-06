# 开发接续点

## 当前阶段：2F.52 S3 只读预览脱敏统计

已验收基线f74c3a63b5a83987c43fee1590db2769dd24f635/treef5ca881d54ba883df2d0ca6e95e5fc80d7d7009f，2F.51最终验收6009538641。按真实PR与任务接续，不退回落后聊天。新增ReadS3PlanOverview，复用原Plan读取和分类，不额外联网；仅返回固定四类数量，拒绝计数/分类矛盾并隐藏原身份/hash/正文及私密错误。动作名只表示候选数量，不执行同步或授权apply。详见SYNC_S3_PLAN_OVERVIEW_2F52.md。

本地新增10顶层/34Go通过事件；保留首两轮新夹具附件键/新kind标识失败及发布前修正，不改原校验器或断言掩盖问题。原Plan12/45复查通过。原保护Node202/S3174/stage62与新HEAD17CI、四UI/实际服务、双Electron、119源码绑定完整后端、品牌/原生/桌面/NSIS均须分别核验；候选/源码完成不等于ACCEPTED。原生产、保存回执/引用/退出/schema14/锁/测试/CI/验收器不变，无可见UI/凭据保存/数据库扫描写入/blob读取/自动同步/真实桶。

## 历史：2F.51 S3 只读差异预览

已验收基线8c01d05a866bc374d6fbc594122f7568df30fe69/tree61d0546624b21b77548c5a26bdeeb107817d9e05，2F.50完整验收6008752192。真实分支比旧聊天更靠前，本次未重做2F.49/50。新增ReadS3Plan，显式完整本地/共同基线hash表与同仓库pin，复用原RecordSet和classifyItem；只读有界、错误零Plan、所有动作名仅为比较分类。无数据库扫描/写入、blob读取、apply/provider/UI/凭据保存或真实桶。详见SYNC_S3_PLAN_PREVIEW_2F51.md。

本地新Go定向-race12顶层/45事件、原Node202/174及stage62通过；仍须当前HEAD17CI与所有原始产物独立验收，不用旧绿灯，未验收不进入2F.52。生产仅新增s3_plan.go；原保存/回执/引用/退出/schema14/锁/测试/CI/验收器保持。历史2F50候选/阻塞措辞以其后来实际验收为准，不能当当前仍失败。

## 历史：2F.50 有界记录与附件完整只读快照

已验收基线37a4a76af78bdcfca4f0af1198edd5a34a39acfd/tree157b75837255f3d2c56ea6ee6640c1ba164acae0，2F.49验收5998171414保持。复查没有新的已复现上一阶段阻塞。新增ReadS3Snapshot复用原整组记录/关系校验，再读取所有present附件的不同hash内容；相同hash只GET一次，所有元数据预算预检完成才发blob请求，任何晚期失败零快照。详见 `SYNC_S3_SNAPSHOT_2F50.md`。

原Records预算不变，新增单blob1..32MiB、不同blob累计1..64MiB、数量1..1024，共享15秒或更短截止。相同hash不同大小拒绝；零字节需实际GET，purged不读blob。返回私密可变对象不是IPC或apply权限；无文件/数据库/同步状态写入、provider/UI/凭据保存/上传删除/自动同步或真实桶。只有新增生产文件，既有读取API/保存和退出规则字节不变。

本地新Go定向-race11顶层/39事件，和原RecordSet/Attachment合跑35/161（包含新11，不重复累计）；原保护Node202、S3三入口174、stage62通过。两份故意总额/大小绕过的隔离错误实现被拒绝。catalog/lock只是结构验证。新HEAD仍须完整17CI及四UI/双Electron/115源码绑定Go1.24.11后端/原生桌面/NSIS独立验收，预计Go1245仅为核对目标，不能用旧绿灯认定通过。本阶段完成前不进入2F.51。

## 历史与恢复

先读真实HEAD、PR #2和最新检查点；区分源码完成、当前HEAD的CI、原始产物独立验收。写回执不明先读目标，不重复推送或覆盖并行进展。源码协议candidate/pending是发布前快照，不能推翻后来同HEAD的实际验收；完整历史快照与失败原件保留在历次ACCEPTED归档，不再在本文件堆叠过期“等待验收”。

历史验收：2F.49/5998171414；2F.48/5997162499；2F.47/5990100953；2F.46/5988418986；2F.45/5987877620；2F.44.1/5986972515；2F.44/5985557594；2F.43/5985192841；2F.42/5981504611；2F.41/5981057926；2F.40/5978940337；2F.39/39.1/5955810680。相应SYNC_S3_*协议、ELECTRON_TEST_EVIDENCE_2F41.md及交付保留原范围和修补。旧3c日志不可追回不能猜同因，不重做46a577c旧Windows失败。

读 `AGENTS.md`、`KNOWN_ISSUES.md`、`ASSISTANT_EXECUTION_INCIDENTS.md` 和 `STAGE_REVIEW_PROTOCOL.md`。机器索引真实路径 `docs/quality/known-issues.json`，保留46问题（38历史修复/3缓解/5持续或外部）和12助手事故，不将存在回归文件当测试通过。新候选反例和执行失误单列当轮交付，不重复累加全局编号。

## 不可削弱的保护

仅feature/knowledge-os-phase2 / Draft PR #2，不修改或合入master、不强推、生产发布或操作真实用户数据。产品4.195.1/schema14不变；不得用4.189.0打开schema14数据。自动保存、Ctrl+S、保存队列/回执、草稿、引用、退出保护保持，不恢复结构变化暂停自动保存、不删数据或破坏性迁移。

保留原生桥精确主窗口/页面/主frame、导航取消、7.5秒绝对截止和请求close前持槽；保留Windows合成路径、自有客户端/服务端有界清理及HTTP组单监听器。前端停止等待不是原生I/O取消。S3摘要pin须独立可信，403/404或对象可读不证明凭据有效、归属、最新或写/List权限；公开意图头不是认证，不称完整S3同步。

## 执行纪律

恢复源码索引后比较必须显式给基线tree；使用git ls-files -z处理中文路径。不要重下已核源包/产物或运行旧生成器重造。npm ci --no-audit --no-fund前核原锁，不删锁/npm install回退/依赖大升级；完整GoFrame项目不module-off，只有独立标准库夹具可最小模块或module-off且GOTOOLCHAIN=local，不下载工具链或模块。

已知失败的numeric run/joblogs/annotations/repo-artifacts集合/filename-scoped workflow-runs GET400、opaque日志、失效fileID、公开下载/DNS/tarball路线不重试。安全拒绝只停止对应动作，不换接口/账户/代理/执行器绕过。update_ref不传不支持的expected_sha，发布前重读HEAD、force=false。

只查未完成项，同run至少90秒，30外部调用前保存检查点评估；长日志写文件，关键节点短汇报，不重复clone/install/全PR大日志或发现已加载工具。正常CI不取消或手工重跑。必须八PR、完整push UI/Windows、Desktop及额外push SaveRecovery，四UI/实际服务、同源PR树、源码绑定Go1.24.11后端/S3/controller、原生/桌面/NSIS全部独立核验，不以旧绿灯或身份小文件替代。

关键节点只改既有任务prompt，不改schedule/DTSTART/timezone/启用状态/title，不run_now、重建、重排或操作单次启动器。更新前读最新任务与HEAD，进行中提示不是永久锁。工具故障、应用问题、ChatGPT投递错误分别记录，不承诺平台永不中断。


## 2F.50 当前同阶段 Windows 夹具修补
cfd6105的Windows品牌检查在原45秒内未完成loadFile，后续验收步骤被跳过，不能用
后端或PR绿灯覆盖。现修补该测试的默认用户目录隔离和阶段失败证据缺口，原视觉
断言/捕获/预算/沙盒及所有产品代码不变；详见2F.50协议末段。新12项生命周期
测试须由新HEAD实际CI执行，完整UI目标2308/Electron273/后端1245仅为预期。
原卡顿内部根因未证实，不盲重跑旧job；新HEADWindows和全部独立产物未完成前
不得称2F.50ACCEPTED或进入2F.51。最终状态以PR和实际验收记录为准。
