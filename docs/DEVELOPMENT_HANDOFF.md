# 开发接续点

## 当前候选：2F.53 完整本地记录依据的只读预览

基线5fd6be35b93cd385e8ae83b64e61e5aaeea95dd2/tree2231f57bb3a3b31f2ba8a7883fdbef977e32e325，2F.52验收6010131436保持。新增ReadS3PlanOverviewFromRecords，从完整本地Record JSON严格验证并用原引擎规范编码计算hash；本地记录、关系和字节预算全部校验后，调用原Overview一次。原hash-only API及分类/回收站/purge语义不改。详见SYNC_S3_RECORD_BASIS_2F53.md。

本地新Go定向-race11顶层63事件，原Overview10/34、Node保护202/S3入口174/stage62通过；raw-hash/关系绕过的隔离错误实现被原新断言拒绝。原生产/测试/CI/验收器/schema14/保存保护不变。源码、当前HEAD完整17CI、原始产物独立验收分开，JS2308/Electron273/Go1387只是核对目标，以最新PR验收为准；未完整验收不进入2F.54。

无数据库扫描或写入、blob读取、HTTP/IPC路由、provider、可见设置UI、凭据保存或真实桶访问。本地记录与共同基线必须是调用者提供的可信完整一致快照，函数不能自行证明完整性；统计不是apply或删除许可。

## 真实检查点和历史

恢复时先读实际远端HEAD、PR #2、最新任务，再读本文件。源码candidate/pending是发布前快照，不能推翻后来同HEAD的实际验收。若远端已推进，先核差异与真实回执，不重复实现、提交或覆盖并行进展。成功写入不因缺少聊天最终回复而失效；回执不明先读取目标。

2F.52/6010131436、2F.51/6009538641、2F.50/6008752192、2F.49/5998171414及更早全部阶段记录保留。完整历史和原始失败在历次交付归档；2F50/51旧完整归档曾在新会话不可见，不能按描述重造缺失日志。现有2F52包保留真实可用的2F49及更早归档，以及2F50/51源码协议和观察记录；准确恢复范围以交付RECOVERY为准。

先读AGENTS.md、KNOWN_ISSUES.md、ASSISTANT_EXECUTION_INCIDENTS.md、STAGE_REVIEW_PROTOCOL.md。机器索引是docs/quality/known-issues.json，46问题（38历史修复/3缓解/5持续或外部）和12助手事故不重复计数。具体新候选反例和执行纠正写当轮交付；文件存在/catalog的testsExecuted:false不等于测试通过。旧46a577c失败不重做、旧3c日志不可追回不猜同因。

## 固定保护和验收

仅feature/knowledge-os-phase2 / Draft PR #2，不修改或合入master，不强推、生产发布或操作真实用户数据。产品4.195.1/schema14不变，不用4.189.0打开schema14数据。保护自动保存、Ctrl+S、保存队列/回执、草稿、引用、退出保护；不恢复结构变化暂停自动保存，不删数据或破坏性迁移。

保留原桥精确主窗口/页面/主frame、导航取消、绝对截止和请求close前持槽；保留Windows合成路径、自有连接有界清理和HTTP组单监听器。前端停止等待不等于原生I/O取消。S3 pin需独立可信，403/404、摘要/关系/统计通过不证明来源、新鲜度、凭据有效或写/List权限，公开意图头不是认证，不称完整S3同步。

必须当前HEAD八PR、完整push UI/Windows、Desktop及额外push SaveRecovery；四完整UI/实际服务、双Electron、同源PR树、源码绑定Go1.24.11完整后端/S3/controller、新测试实际执行、品牌/原生/桌面/NSIS独立核验。不得用旧绿灯、身份小文件或预期数量冒充通过。品牌合成页裸h2原低对比度在原23判据之外，不宣称全产品可访问性通过。原测试/断言/门槛不降，最终状态写PR与交付，不造状态-only源码提交。

## 执行与恢复纪律

恢复索引后diff显式给基线tree，中文路径用git ls-files -z。优先已挂载/实际可见ID，不重下已核旧包或运行旧生成器重造。npm ci --no-audit --no-fund前核锁，不删锁/npm install回退/依赖大升级；真实GoFrame项目不module-off，只有自有标准库夹具可最小独立模块且GOTOOLCHAIN=local，不下载工具链或模块。

已知numeric run/joblogs/annotations/repo-artifacts集合/filename-scoped workflow-runs GET400、opaque日志、不可见旧fileID、失败公开下载/DNS/tarball路线不盲试。安全拒绝只停对应动作，不换接口/账户/代理/执行器绕过。update_ref不传不支持expected_sha，发布前重读ref、force=false。

只查未完成项，同run至少90秒，30外部调用前保存检查点评估，不机械停工。长日志留文件并短报关键实质节点，不重复clone/install/全PR大日志/已加载工具发现或不支持session。正常CI不取消或手工重跑。

关键节点仅更新既有任务prompt，更新前读最新任务和HEAD，不改schedule/DTSTART/timezone/启用状态/title，不run_now/重建/重排/操作单次启动器。工具、应用和ChatGPT投递故障分别记录；无平台内部证据不能承诺中断根因已修或永不中断。
