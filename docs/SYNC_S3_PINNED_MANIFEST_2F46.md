# Phase 2F.46 — 显式钉定的 S3 同步清单读取

基线 `7b83ab424cb9f769f68865bfb4ba21b513ddacd6` / tree `cb578214cd72c282f2774ea5fdb0854678e27637`；2F.45完整验收评论5987877620保持。先读取真实HEAD/PR、上轮原始验收包及历史问题/助手事故，未发现需要回退上一阶段的已复现阻塞；本阶段推进既有只读同步路线中的manifest消费，不重复实现摘要读取或端口夹具。

## 交付接口与范围

在现有 `syncengine` 增加 `ReadS3Manifest(ctx, client, reference, limit)`，返回已有 `Manifest` 类型。reference明确给出StoreID、正整数Generation、64位小写SHA256；调用方必须独立建立这些读取依据，不能把不可信列表/响应中自报的摘要当作认证。固定读取客户端prefix下的 `manifests/<20位generation>-<sha256>.json`，不接受额外URL或猜测目标路径。复用上一阶段的 `GetVerifiedObject`，只有完整字节与预期摘要一致后才解释清单。

复用现有清单格式 `local-notepad-sync-manifest` / version1，不创造第二套类型或迁移现有清单。与已有DirRemote.SaveManifest生成的原始字节互操作已实际测试。新读取器要求恰好format/version/store_id/generation/updated_at/device_id/items七个字段；StoreID与Generation必须精确匹配显式依据，Revision仅来自已验证的SHA256，不取ETag或JSON自报revision。

拒绝重复字段/重复条目ID（包括转义后的等价名字）、大小写别名、未知字段、缺失/null/错误类型、多段或无效JSON、无效UTF8和不配对UTF16转义。条目值须为64位小写摘要，身份为1..1024字节的非全空白有效UTF8且无控制字符；不trim/归一化/大小写折叠ID。updated_at必须为RFC3339Nano可解析时间，但不根据当前时钟猜测新鲜度。有效空items是一个明确存在的清单，不是“远端不存在”。

调用方指定1..32MiB字节限额，条目上限100000；超限明确拒绝，不截断清单。整个GET/摘要/JSON解释共用15秒或更短调用者截止，解析循环及交付前检查context。Go标准库单次扫描不能逐指令抢占，但输入有界且取消后不交付成功。每个错误返回零Manifest，绝不返回“可初始化空仓库”的提示。原S3错误分类保留；新参数/解析错误只含固定文字，不含键、正文、摘要或底层异常原文。

**这不是SyncRemote/provider注册、最新清单发现、完整同步预演或数据应用。** 没有读取manifest指向的record/blob、没有校验目录关系/删除语义，不能据此授权apply；后续消费仍须完整结构验证。没有List/HEAD/上传删除、写入本机或同步元数据、设置UI、配置凭据持久化、自动同步或真实桶访问。显式指定旧generation不会被当作“已确认最新”。摘要匹配和403/404不证明凭据有效/归属/新鲜度或写List权限。

## 发布前实际验证

新文件 `server/internal/syncengine/s3_manifest_test.go` 有12顶层、84条通过事件。包含原DirRemote序列化互操作、真实本机签名GET及临时token/精确prefix、空清单、非法依据零网络、摘要篡改优先拒绝、七字段类型/身份、重复/转义/非法编码、100000条边界及超限、HTTP错误不初始化或重试、并发依据隔离，以及取消实际传到自有GET。只使用合成身份和临时目录/httptest，未打开仓库内示例data.db或用户数据库。

本地Go1.23.2在独立临时标准库夹具中逐字节复制三个现有包的生产文件，保留syncs3全部原测试及本次新增清单测试，以独立最小module构建（不是修改真实server/go.mod，也不将真实项目module-off）。GOTOOLCHAIN=local/GOPROXY=off/GOSUMDB=off/GOWORK=off，无模块/工具链下载；`go test -race -json -count=1 -timeout 90s ./internal/syncengine ./internal/syncs3`实际通过新12/84与原S3 69/428，复制前后摘要相同。这不是GoFrame/SQLite完整项目运行。

两个独立故意错误实现分别取消StoreID匹配、允许重复items，均被原新增断言拒绝，日志保留；不是发现用户数据泄露或声称上一阶段存在同样缺陷。原Node绑定24+renderer98+保存/草稿/退出80合计202通过，S3Node174和原stage-review62分别通过；27个内部Go检查已含于单个既有顶层用例，不重复累计。catalog/lock只是结构检查。没有clone/npm依赖安装或降低旧测试门槛。

## 发布及独立验收门槛

源码完成、当前HEAD完整CI、原始产物独立验收分开记录。必须保留八PR、push完整UI/Windows、Desktop及额外push SaveRecovery，17不同run和原阶段验证器。四份完整UI仍预计2296/19，双Electron261，所有旧用例应保留；新增Go12/84必须在源码绑定的Go1.24.11完整后端实际执行（预计107源码/锁文件、968通过事件），原S3 69/428及真实GoFrame controller六子场景继续执行。这些是核对目标，不是预先宣布CI通过。

PR测试树应与真实分支一致；原生/桌面/NSIS原产物继续独立验收。失败先定位并在本阶段解决，不取消/重跑正常CI，不拿旧绿灯替代新HEAD。最终结论写PR与交付，不为状态另造源码提交。2F.46完整验收前不进入2F.47。

仅feature/knowledge-os-phase2 / Draft PR #2；不改或合master、强推、生产发布或操作用户真实数据。原生产文件、src/electron/server既有文件、package/lock/schema14、保存/Ctrl+S/回执队列/草稿/引用/退出保护和原测试/工作流/验收器保持。46问题、12助手事故及全部历史失败/验收证据保留；不承诺ChatGPT投递不中断。

实现参考（不升级当前Go工具链或JSON库）：
- https://pkg.go.dev/encoding/json — Token及v1的重复名字/编码默认行为。
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html — 对象内容校验。
