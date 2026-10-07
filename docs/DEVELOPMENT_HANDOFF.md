# 开发接续点

## 当前修补候选：2F.58.1 预览拒绝响应契约

基线39a33075d9136a74d84e0025be4eb542eca5f9f4/treeb4e553f5813140092e56326153a91e70d7d254b8。2F58验收6033462258保留。复查真实Go handler发现415/encoded-or-trailer-request-refused未列入原JS白名单，被误分类为native-preview-invalid-response；原代码反例失败，固定白名单修补后新增5项共享回归通过，其中一项含18份真实Go拒绝响应。详见SYNC_S3_PREVIEW_REFUSAL_2F58_1.md。

只有旧生产codec添加一个精确415/null错误码，旧固定别名保留。无成功数据政策、Go/browser guard、连接/超时、原生桥/session/hook/panel行为变更。原测试/断言/CI/验收器/锁保持；旧源码失败和新回归证据分别保存，不称用户数据事故。

本地新5、原binding24/session83/preview125/保护202/scope63/bridge100/HTTP19/stage62通过。当前HEAD全部17CI及原产物仍须完整验收，预期UI2595/Electron406/Go1528不是通过证据。未进入2F59。最终状态以最新PR/交付为准，candidate是发布前快照，不为状态另造源码提交。

## 历史与真实检查点

先读真实ref、PR #2和最新接续任务，再读本文。成功写入不因缺少最终聊天而失效；回执不明先读目标，不重复提交或覆盖并行进展。此前发布候选的长段落保存在Git历史及上轮完整交付，阶段协议没有删除。不要按旧标题重做已验收阶段。

2F58验收6033462258（功能6032592466、CSS定位修补6032748225）；2F57/6031391401；2F56/6030696180；2F55/6029118874；2F54/6020109507；2F53/6012433603；2F52/6010131436；2F51/6009538641；2F50/6008752192；2F49/5998171414和更早失败、修补、验收记录均保留。2F50/51完整旧ZIP曾不可见，不按描述重造日志。最新交付RECOVERY说明真正恢复范围。

先读AGENTS.md、KNOWN_ISSUES.md、ASSISTANT_EXECUTION_INCIDENTS.md和STAGE_REVIEW_PROTOCOL.md。机器索引docs/quality/known-issues.json含46问题（38历史修复/3缓解/5持续或外部），助手12类事故另列。本轮具体缺口单列协议，不重复编号；catalog/testsExecuted:false只检查关联，不是执行测试。旧46a577c失败不重做，旧3c日志不可追回不猜同因。

## 固定保护与生产边界

仅feature/knowledge-os-phase2 / Draft PR #2，不修改或合入master、不强推、不生产发布、不操作真实用户数据/真实桶。产品4.195.1/schema14保持，不用4.189.0打开schema14数据库。保护自动保存、Ctrl+S、保存队列回执、草稿、引用、退出保护；不恢复结构变化暂停自动保存，不删数据或破坏性迁移。

保持精确主窗口/页面/主frame、导航取消、绝对截止及请求close前持槽；保留Windows合成路径、LF/CRLF兼容、自有连接有界收尾和HTTP组单监听器。前端停止等待不是原生I/O取消。公开意图不是认证，pin须独立可信，完整本地依据不能由不完整查询或假数据代替。摘要/统计不证明新鲜度、凭据有效、写/List权限，purge候选不授权删除。

S3PreviewPanel仍未挂生产SettingsPanel；生产完整本地快照及可信pin的接入尚未完成。没有可写provider、数据库扫描写入、凭据配置持久化、blob/上传删除/自动同步或真实桶访问。现有React测试使用合成原生返回，不能和各自Go/桌面证据拼成未执行的完整S3GUI链路。

## 当前HEAD验收与防中断纪律

必须八PR、完整push UI/Windows、独立Desktop及额外pushSave；四份完整UI/19实际服务、双Electron、同源PR测试树、源码绑定Go1.24.11完整后端/S3/controller、新用例实际执行、品牌/原生/桌面/NSIS独立核验。不得用旧绿灯、身份小文件或预期数量代替原始产物。品牌原23判据不是全产品无障碍认证，原桌面截图不是新S3面板像素验收。原测试/门槛不删不降。

恢复时优先已挂载或真实可见文件ID，旧包不重下、不运行旧实现生成器。Git恢复索引没有HEAD时diff显式指定基线tree，中文路径git ls-files -z。元数据先核dict/list再读取，不按旧工作目录名称猜归档路径。长日志落文件，输出只报真实节点。

npm ci --no-audit --no-fund前核原锁，不删锁/npm install回退/依赖大升级。真GoFrame模块不module-off；只有自有标准库夹具可临时最小模块且GOTOOLCHAIN=local，不下载工具链模块。新Go拒绝矩阵不绑定任何端口，不新增固定端口竞争服务。

已知numeric run/joblogs/annotations/repo-artifacts集合/filename-scoped workflow-runs GET400、opaque日志、失效fileID及失败公开下载/DNS/tarball链不盲试。安全拒绝只停对应动作，不换接口/账户/代理/执行器绕过；update_ref不传不支持expected_sha，发布前重读ref且force=false。正常CI不取消或手动重跑，同run至少90秒，30外部调用前保存检查点评估，不机械停工；只查未完成项。

任务关键节点只改原prompt，更新前读最新任务和HEAD，不改schedule/DTSTART/timezone/启用状态/title，不run_now/重建/重排。工具、应用与ChatGPT投递故障分开记录，不能承诺平台根因已修或永不中断。
