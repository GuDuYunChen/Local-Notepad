# 开发接续点

## 当前候选：2F.58 只读预览展示组件

基线25a77f60233846bbd050abb7df35ba6135089ebd/tree3dabda99eea627c9da2379925d2928adbd375c35，2F57完整验收6031391401有效，原binding24/session83/保护202复查无新阻塞。新增S3PreviewPanel复用原useS3Preview，显式点击才读取；状态、失败、空统计、候选冲突和四类型表格明确呈现，不提供任何同步写入操作。输入身份/版本/disabled变化失效，旧点击token不能发请求。详见SYNC_S3_PREVIEW_PANEL_2F58.md。

本地同步组件模型5/5及过期命令反例通过，均非React/DOM；新增24真实React组件测试须新HEAD四完整UI实际执行。预计UI2590/Electron406/Go1528只是待核目标。原preview125/scope63/bridge100/HTTP19/stage62通过，旧测试/断言/工作流/验收器及保存/schema14/依赖不变。

组件尚未接入生产SettingsPanel，不能拿不完整本地快照或不可信pin制造可用预览。无数据库扫描写入、凭据表单/持久化、blob/provider/apply/上传删除/自动同步/真实桶。源码、当前CI及原产物独立验收分开，最终以最新PR为准，未全通过不进入2F59，不为状态造源码提交。

首提交93c0d5d的PR Linux原报告2589/2590，唯一失败为新CSS检查的Vite资源URL不能作为Node文件URL。已同阶段只修测试源码定位为原仓库根相对路径，原CSS断言/同名用例/生产源码/工作流不变。原失败包11465626591保留，修补HEAD四UI/17CI及原产物仍须完整验收，详见本阶段协议末段。

## 历史发布快照：2F.57 React 预览生命周期与命令版本约束

基线13e9a0de077eae3cfeeb7696c99c3e2e88a11312/tree185ee18047c1a12625771bdc625015556b2b4c9a，2F56完整验收6030696180有效；原session83复查无新阻塞。新增createS3PreviewBinding与useS3Preview(revision)，离线订阅/连接、稳定冻结快照、独立清理租约及已提交revision命令token。旧read零参数反射/零原生调用，旧invalidate不影响新结果；StrictMode、卸载和未提交Suspense明确分开。详见SYNC_S3_PREVIEW_REACT_LIFETIME_2F57.md。

新共享binding24本地通过；新真实React18已编写，必须当前HEAD四完整应用原报告实际执行，不拿隔离同步hook模型3/3冒充React。两个外部错误实现被同一断言拒绝，原session83/preview125/保护202/scope63/bridge100/HTTP19/stage62通过。全部旧生产/测试/断言/CI/验收器/依赖锁及保存/schema14不改。

没有接入生产设置表单、数据库或同步写入；调用方须在上下文变化时更新revision，需要即时失效时同步invalidate。前端超时/失效不证明原生I/O取消。同revision主动重查保留。源码/当前HEAD17CI/原产物验收分开，UI2566/Electron406/Go1528只是待核目标；最终以最新PR为准，不为状态造提交。

## 历史发布快照：2F.56 前端只读预览会话


基线ddb322b0e0bf3c98ef86deede5abaeace3ebe9f8/treeff6ea4e0bd6d888311a9cb2ee11a8126a6df84db，2F55完整验收6029118874有效，原preview125复查无新阻塞。新增createS3PreviewSession由services/api.js导出，仅显式read调用现有s3PreviewRead；复用原codec，字节计数去Node Buffer依赖，不放宽契约。独立快照、严格脱敏回复、代际失效/永久dispose、10秒绝对等待、原生Promise结束前保持会话slot，无自动重试或HTTP回退。详见SYNC_S3_PREVIEW_SESSION_2F56.md。

新Node/Vitest共享83首轮通过；原preview125、保护202、scope63、bridge100、组合HTTP19及stage62通过，两个故意错误实现被原新增断言拒绝。没有新React hook/订阅/设置UI或数据库写入，调用者须同步invalidate与离开时dispose。不能用旧确认闭包启动新read，停止前端等待不代表原生I/O结束。

当前HEAD17CI及原产物仍须独立核验，新83必须实际执行；UI2524/Electron406/Go1528仅待核目标。原保存/Ctrl+S/队列回执/草稿/引用/退出/schema14/锁/测试断言/工作流/验收器不变。源码candidate/pending是发布前记录，最终以最新PR和交付为准，不为状态再造提交。

## 历史发布快照：2F.55 主窗口生命周期约束的原生预览桥

已验收基线316060674c72315a2fbc59b515c7a7b8e6622de0/tree1e723f72bbd0caadbd054e7015a949207dee514e，2F54最终验收6020109507。原HTTP定向11/131完整复查无新阻塞。新增electronAPI.s3PreviewRead及独立主frame scope，固定本机POST/严格codec/单slot/7.5秒截止/请求close收尾，main、preload仅追加入口，原probe/quit门禁不改。详见SYNC_S3_PREVIEW_BRIDGE_2F55.md。

新共享Node/Vitest125及同一原固定HTTP监听器8用例通过，原HTTP含Go组合19/19，旧用例不删不改，原scope63/bridge100/保存保护202/stage62通过。两隔离错误实现被原断言拒绝。首次基线组合外层超时未算通过，后续单独完整回执及首部分日志均保留。当前HEAD完整CI和原产物验收仍须另证，预计UI2441/19、Electron406、后端1528，以真实原报告为准。

无可见S3界面/输入表单、renderer预览状态绑定、凭据配置保存/provider/apply/数据库操作/blob/上传删除/自动同步或真实桶。公开意图不是认证，统计不是同步完成或删除许可。源码candidate/pending仅发布前快照，最终以当前HEAD的PR验收及交付为准。

## 历史发布快照：2F.54 本机意图约束的只读预览HTTP入口

基线4c7159d6ba4260e1281b0aeb9fa6f922c15c5bc3/treefdd75882f8ae9ef425a40f40ebbffb0d192179c8，2F.53验收6012433603保持。原记录依据定向-race11/63复查无新阻塞。现有SyncController增加POST /api/sync/s3/preview，复用完整本地记录依据与脱敏Overview，只返回固定候选统计。原probe共用的门禁等价提取，新路由不同意图s3-preview、2MiB正文、明确记录/字节上限、单slot、共享6秒context及既有服务器10秒入站截止。详见SYNC_S3_PREVIEW_HTTP_2F54.md。

无数据库扫描写入、blob、renderer/IPC/可见S3界面/provider/apply/凭据保存或真实桶。公开意图不是进程认证，完整本地依据与pin须调用者可信提供，统计不是同步或删除许可。原保存/退出/schema14/依赖与所有旧测试/工作流/验收器不变。

本地新HTTP-race11顶层131事件、原syncs3-race69/428、原Node202/S3174/stage62通过；两隔离错误实现被拒绝。两次新候选编译错误及新空map重复字段夹具纠正已保留，不作已执行测试。真实GoFrame新路由1顶层9子场景必须在当前HEAD完整后端另行实际执行。源码、17CI、四UI/实际服务、双Electron、后端/品牌/原生/桌面/NSIS独立验收分开，以最新PR和最终交付为准，未通过不进入2F.55。

## 真实检查点和历史

恢复时先读实际远端HEAD、PR #2、最新任务，再读本文件。源码candidate/pending是发布前快照，不能推翻后来同HEAD的实际验收。若远端已推进，先核差异与真实回执，不重复实现、提交或覆盖并行进展。成功写入不因缺少聊天最终回复而失效；回执不明先读取目标。

2F.53/6012433603、2F.52/6010131436、2F.51/6009538641、2F.50/6008752192、2F.49/5998171414及更早全部阶段记录保留。完整历史和原始失败在历次交付归档；2F50/51旧完整归档曾在新会话不可见，不能按描述重造缺失日志。现有2F52包保留真实可用的2F49及更早归档，以及2F50/51源码协议和观察记录；准确恢复范围以交付RECOVERY为准。

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


## 本阶段首提交的 Windows VM 夹具失败

b8240e0完整UI的新增preload用例在Windows为2440/2441，原始失败artifact11429185554保留。原import剥离正则不接受CRLF，同源码换行反例复现后，只修新测试准备并显式执行LF/CRLF两种输入，保留原全部断言及生产文件。共享用例仍125，新总数不变；修补HEAD完整CI与原产物必须通过后才能验收，不把已通过保存专项当全UI通过。详见本阶段协议末段。
