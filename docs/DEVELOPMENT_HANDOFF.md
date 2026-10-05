# 开发接续点

## 当前阶段：2F.49 有界整组记录读取与关系预检

已验收基线4b9a32d00806b1050808e15b29325175ea6a4dde/treeeaa897355f988f2a20fad10071cb20c6eaabef12，2F.48验收5997162499继续有效。复查无新复现的上一阶段阻塞。本阶段ReadS3RecordSet一次验证钉定清单，再按稳定顺序验证其中全部记录，复用原结构验证器检查父目录/循环/重名/标签关系，任何失败零集合。详见 `SYNC_S3_RECORD_SET_2F49.md`。

显式数量1..1024、单清单/单记录1..32MiB、记录累计1..64MiB预算，共享15秒或更短截止。清单数量及全键预检在记录GET前完成；按剩余额限制每次GET。原关系规则不更改，完整cache禁用远端回退，私密错误固定化。无附件blob读取、数据库/同步状态/文件写入、apply/provider/UI/凭据保存/自动同步或真实桶操作，成功集合不是本地写入权限。

本地新Go独立-race12顶层/49事件、原Node202及分开S3入口174、stage62通过；两个关系/总预算绕过的隔离错误实现被拒绝。首次组合Go的外层预算超时仅保留部分输出、不称完整通过，分离新测试完成；新HEAD完整Go1.24.11及四UI/双Electron/原生桌面/NSIS仍须验收。预计原Go1157增加49、旧JS用例不变，以实际原报告为准，不沿用旧绿灯。本阶段完成前不进入2F.50。

## 历史与恢复

先读真实HEAD、PR #2和最新检查点；区分源码完成、当前HEAD的CI、原始产物独立验收。写回执不明先读目标，不重复推送或覆盖并行进展。源码协议candidate/pending是发布前快照，不能推翻后来同HEAD的实际验收；完整历史快照与失败原件保留在历次ACCEPTED归档，不再在本文件堆叠过期“等待验收”。

历史验收：2F.48/5997162499；2F.47/5990100953；2F.46/5988418986；2F.45/5987877620；2F.44.1/5986972515；2F.44/5985557594；2F.43/5985192841；2F.42/5981504611；2F.41/5981057926；2F.40/5978940337；2F.39/39.1/5955810680。相应SYNC_S3_*协议、ELECTRON_TEST_EVIDENCE_2F41.md及交付保留原范围和修补。旧3c日志不可追回不能猜同因，不重做46a577c旧Windows失败。

读 `AGENTS.md`、`KNOWN_ISSUES.md`、`ASSISTANT_EXECUTION_INCIDENTS.md` 和 `STAGE_REVIEW_PROTOCOL.md`。机器索引真实路径 `docs/quality/known-issues.json`，保留46问题（38历史修复/3缓解/5持续或外部）和12助手事故，不将存在回归文件当测试通过。新候选反例和执行失误单列当轮交付，不重复累加全局编号。

## 不可削弱的保护

仅feature/knowledge-os-phase2 / Draft PR #2，不修改或合入master、不强推、生产发布或操作真实用户数据。产品4.195.1/schema14不变；不得用4.189.0打开schema14数据。自动保存、Ctrl+S、保存队列/回执、草稿、引用、退出保护保持，不恢复结构变化暂停自动保存、不删数据或破坏性迁移。

保留原生桥精确主窗口/页面/主frame、导航取消、7.5秒绝对截止和请求close前持槽；保留Windows合成路径、自有客户端/服务端有界清理及HTTP组单监听器。前端停止等待不是原生I/O取消。S3摘要pin须独立可信，403/404或对象可读不证明凭据有效、归属、最新或写/List权限；公开意图头不是认证，不称完整S3同步。

## 执行纪律

恢复源码索引后比较必须显式给基线tree；使用git ls-files -z处理中文路径。不要重下已核源包/产物或运行旧生成器重造。npm ci --no-audit --no-fund前核原锁，不删锁/npm install回退/依赖大升级；完整GoFrame项目不module-off，只有独立标准库夹具可最小模块或module-off且GOTOOLCHAIN=local，不下载工具链或模块。

已知失败的numeric run/joblogs/annotations/repo-artifacts集合/filename-scoped workflow-runs GET400、opaque日志、失效fileID、公开下载/DNS/tarball路线不重试。安全拒绝只停止对应动作，不换接口/账户/代理/执行器绕过。update_ref不传不支持的expected_sha，发布前重读HEAD、force=false。

只查未完成项，同run至少90秒，30外部调用前保存检查点评估；长日志写文件，关键节点短汇报，不重复clone/install/全PR大日志或发现已加载工具。正常CI不取消或手工重跑。必须八PR、完整push UI/Windows、Desktop及额外push SaveRecovery，四UI/实际服务、同源PR树、源码绑定Go1.24.11后端/S3/controller、原生/桌面/NSIS全部独立核验，不以旧绿灯或身份小文件替代。

关键节点只改既有任务prompt，不改schedule/DTSTART/timezone/启用状态/title，不run_now、重建、重排或操作单次启动器。更新前读最新任务与HEAD，进行中提示不是永久锁。工具故障、应用问题、ChatGPT投递错误分别记录，不承诺平台永不中断。
