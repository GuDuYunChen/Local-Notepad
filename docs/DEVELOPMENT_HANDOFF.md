# 开发接续点

## 当前阶段

当前候选 **Phase 2F.41：S3 只读预检 Electron 原生桥**，见 `SYNC_S3_NATIVE_PROBE_BRIDGE_2F41.md`。沿用 feature/knowledge-os-phase2 / Draft PR #2，不合 master、不发布生产，产品4.195.1/schema14不变。

已验收基线 `e31216608e5e119e2c2013146b7c2460f19d1cb6` / tree `a65bd58bdea253a81c3185289020d3d7f86593a2`，2F.40最终验收评论5978940337。八PR、push完整UI/Windows、Desktop、源码绑定后端、双平台UI/实际服务、原生、桌面及NSIS均已独立核验；Windows GoFrame测试清理问题已在该HEAD修复并通过，不再回到旧46a577c失败。

本阶段为本地整合候选 `LOCAL_INTEGRATED_VERIFIED_REMOTE_PENDING`：原六文件桥与四文件scope补充均已取回并整合，不再报告附件缺失，也不再重新实现第二套桥。preload的s3ProbeRead经main的精确页面/窗口/frame scope进入固定127.0.0.1:27121的Node HTTP只读预检；取消/导航/退出抑制迟到结果，单并发与绝对截止，响应严格脱敏。没有设置UI、配置凭据持久化、List/写删/provider/自动同步或真实桶访问。

原候选复查六个反例已经保留并修复，见EXECUTION_NOTE_2F41.md；原2F.40验收不被这些未发布候选问题推翻。当前Node组合169/169（scope63+组合100+真实HTTP6）、保存退出80/80（66+14）通过；语法、精确树/补丁、保护路径及依赖锁检查另存记录。原桥7项Vitest及新增Vitest入口尚未执行，未执行真实Electron/Windows/完整后端，不把这些结果或旧e312166绿灯当新阶段完成。

远端2F.41仍未提交，新HEAD CI和原产物独立验收待完成；此前create_blob安全拒绝跨轮保留，未以本地修改/测试当作解除证据，也未换接口绕过。下一步只接续此完整候选，不直接发布旧六文件或四文件补充树。原46问题、12类助手事故及保存/退出/schema保护完整保留。原每小时任务保持启用，只更新prompt，不因单次写入受阻暂停。

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

## 当前候选补齐：真实 Node → Go 标准库预检契约

同一2F.41新增 `scripts/s3-probe-backend-cases.mjs` 与 `scripts/fixtures/s3-probe-backend/main.go`。在临时目录逐字节复制已验收的3份syncs3生产Go文件（read_client/read_probe/read_probe_http），仅用本地Go标准库编译；GOTOOLCHAIN=local、GO111MODULE=off、GOWORK=off、GOPROXY=off、GOSUMDB=off，不下载Go工具链或模块，不修改server源码。夹具ErrorLog写io.Discard，不创建文件日志；stdin关闭后有界Shutdown，父进程只管理自己启动的子进程。

测试经真实Node请求到未修改的Go ReadProbeHandler，再到本机临时合成S3：核对Unicode对象路径、单次签名GET、成功字节、403/404/302/500分类、不重定向/重试、超限/编码响应、Go配置/凭据/键拒绝、浏览器来源守卫，以及导航取消传到真实Go出站GET。另验证27121被本测试哨兵占用时夹具启动拒绝，向占用者请求数为0，不终止占用者。结果15项内部契约检查集中在1个集成测试中，不另加成15个顶层测试。原6项Node HTTP回环保留，此入口7项；与scope63、组合100共170个不同顶层用例。

同一个HTTP测试入口串行注册，避免多个Vitest文件同时抢固定27121；跨语言测试显式120秒预算，构建90秒上限，启动5秒上限，子进程20秒保护和2秒优雅关闭。端口已被外部进程占用会失败退出，不连接、停止或改用该进程。无外部真实桶和用户数据。

这项实际验证是Node IPC合成事件及Go标准库handler链路，**不是GoFrame适配层或真实Electron/Windows实测**。已有7项Vitest及新wrapper仍未执行。2F.41远端未提交、完整新HEAD CI/原产物验收未执行的状态没有改变，不能因本地跨语言测试通过绕过独立写入拒绝。

## 2F.41 Windows 夹具接续注意

packaged 页面钉定测试已移除 POSIX-only 的 synthetic app path 与写死 file URL：现在按宿主平台构造绝对 app path，再由 `pathToFileURL` 计算预期值。生产桥代码没有因此变化。这是发布前发现并修正的跨平台测试夹具问题，不是 2F.40 回归，也不能替代真实 Windows CI；后续新 HEAD 验收必须确认 Windows 上该 Electron 测试实际执行通过。
