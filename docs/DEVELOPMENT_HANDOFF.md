# 开发接续点

## 当前阶段：2F.47 钉定清单的单条记录读取

基线4ef54e56f02c1380f86eaac0fa89d276045bef92/treeec97f85d0e3d6f0113d00af2ff1efc926df024b4，2F.46完整验收5988418986继续有效；复查没有新的已复现阶段阻塞。新增ReadS3Record，先读原钉定Manifest，再读取精确所选条目的摘要对象；严格校验单条Record/嵌套载荷/状态/身份，缺失不伪造purged，全部失败零Record。详见SYNC_S3_PINNED_RECORD_2F47.md。

最多两个有界GET，整个过程共享截止；没有读取附件blob/关系依赖、完整树验证、apply或provider、UI/凭据持久化/上传删除/自动同步，不操作用户数据。只新增两份Go文件和协议、更新本交接，既有生产/测试/工作流/验收器/锁/schema14不变。

本地独立标准库-race新12顶层/116事件与原manifest12/84和S3 69/428通过；两个故意错误实现被断言拒绝。原Node202/S3Node174/stage-review62通过，非本地完整React/GoFrame/Windows。新HEAD全部17CI、四UI2296/19、双Electron261、Go1.24.11完整后端及原生/桌面/NSIS仍须实际独立验收，以最新PR/完整交付为准，不沿用旧绿灯。2F.47验收前不进入2F.48，下面各候选记录仅为历史。

## 历史阶段：2F.46 显式钉定 S3 清单读取

已验收基线 `7b83ab424cb9f769f68865bfb4ba21b513ddacd6` / tree `cb578214cd72c282f2774ea5fdb0854678e27637`，2F.45验收5987877620。真实HEAD、PR和验收归档已核，本次复查无新的已复现遗留阻塞，推进既有只读路线。详见 `SYNC_S3_PINNED_MANIFEST_2F46.md`。

新增syncengine.ReadS3Manifest，复用原GetVerifiedObject和现有Manifest类型；只读明确StoreID/Generation/SHA256钉定的清单。严格七字段、重复/无效编码/条目摘要校验，失败零Manifest；不把404当空仓库、不发现latest、不读取记录或应用数据。请求/解析共用有界截止。没有provider/UI/凭据持久化/List/写删/自动同步或真实桶访问。

仅新增两份Go文件和本阶段协议，既有生产/测试/CI/验收器不变。新增Go12顶层/84事件与原S3 69/428在独立临时标准库夹具-race通过；两个错误实现反例被拒绝。原Node202、174、stage-review62通过；不冒称本地完整GoFrame/Windows。新HEAD预期完整UI2296/19、Electron261、源码绑定Go1.24.11完整后端968事件，必须以实际当前报告验收，不沿用7b83旧绿灯。

源码发布/当前HEAD CI/原产物验收分开记录，最终状态以真实PR及交付为准。原46问题/12助手事故保持；后面2F.45/2F.44.1段落是发布前历史快照，不重复实施。2F.46验收完成前不进入2F.47。


## 历史阶段：2F.45 S3 完整对象 SHA-256 验证读取

已验收基线 `c6df4b6d6a171e13e099bd403853838d9a69589d` / tree `a2953560b590c1eb194f60d84e612c3ef9ca129a`，2F.44.1最终验收5986972515。复查未出现新的已复现阻塞，当前增加现有S3客户端的GetVerifiedObject方法，详见 `SYNC_S3_VERIFIED_READ_2F45.md`；后面的2F.44.1候选记录仅保留为历史，不重做旧回调修补。

调用方显式给出独立可信的预期SHA-256，复用单次GetObject，完整字节匹配才返回对象；格式错误零GET，不匹配零对象，不信任ETag/远端校验头、不自动重试。共用有界截止，读取后/摘要后再核context。没有修改原预检HTTP/IPC/renderer含义，没有UI/凭据保存/provider/List/写删/自动同步或真实桶访问。唯一原生产文件变化read_client.go，原GetObject函数不变；新增Go12顶层回归，原测试/工作流/验收器均保持。

本地独立标准库Go-race69顶层/428通过事件；原Node202+172及stage-review62分别通过，内部27Go检查不重复累计。隔离错误ETag实现被原三处不匹配断言拒绝。源码完成、当前HEAD全部17CI及原产物独立验收仍分开，以最新PR/验收记录为准，不提前说当前阶段通过。无依赖大升级、schema或保存保护变化。

## 本阶段第一提交的CI阻塞已在本地修补，待修补HEAD独立验收

第一提交4abac86的PR Linux原报告11323936249有两个HTTP用例EADDRINUSE（2292/2294），实际服务未执行；新增Go完整后端884通过不能覆盖失败。同阶段改为HTTP组只持有一个固定监听器，逐case排空自有请求/socket/timer、过期case能力拒绝，原Go测试前和afterAll显式收尾。原八个HTTPcase函数体及断言不变，新增两项真实网络回归。未取消/重跑正常CI，不bind重试/换端口/终止其他进程。

原helper的单监听器回归失败、修后HTTP+Go11通过；本地有限压力10组及占用者零请求验证通过，不冒称本地重现CI内核占用原因。完整UI预期2296/19、Electron261、NodeS3174；修补源码、全部当前HEADCI、原产物独立验收仍分开，最终状态以PR为准。详见本阶段协议末段，旧4abac86报告留作历史，不拿旧绿灯宣布本阶段通过。

## 历史修补快照：2F.44.1 旧输入版本的命令回调失效

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
