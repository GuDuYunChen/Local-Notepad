# Phase 2F.54 — 本机原生意图约束的 S3 只读预览 HTTP 入口

基线 `4c7159d6ba4260e1281b0aeb9fa6f922c15c5bc3` / tree `fdd75882f8ae9ef425a40f40ebbffb0d192179c8`，2F.53验收6012433603保持。本轮复查原本地记录依据定向-race11顶层/63事件无新复现阻塞；沿既有只读路线接入真实服务入口，不重做内部读取链路或另造数据格式。

## 可调用能力及明确限制

现有GoFrame `SyncController.Register` 注册 `POST /api/sync/s3/preview`，路由生命周期复用一个 `S3PreviewHandler`。直接使用原 `BufferWriter` 和 `r.GetCtx()`，不经框架Parse/GetJson预读凭据正文。现有 `/api/sync/s3/probe` 的参数、结果、取消和并发规则不变。

复用2F.53 `ReadS3PlanOverviewFromRecords`：调用者提供完整本地Record JSON和共同基线、独立可信的清单pin以及所有预算；先验证本地记录、规范摘要和关系，再读取指定远端清单/记录，只返回脱敏候选统计。它不扫描本地数据库、不读取附件blob、不安装文件或更新同步状态。

**HTTP入口不是已接好的Electron IPC或可见S3设置界面。** 本阶段未修改renderer/preload/main，也不注册provider、apply、凭据配置保存、自动同步、上传删除或真实桶。候选数不是已执行同步，purge分类不是删除许可。完整本地快照/共同基线/pin仍由调用方负责来源、一致性与完整性；校验通过不证明远端最新、来源认证、凭据有效或写/List权限。

## 传输边界

请求须POST、对端与Host均为本机回环、仅一条 `X-Notepad-Read-Only: s3-preview`。复用原probe的原生意图门禁，提取为 `syncs3.NativeReadOnlyRequest`，原probe仍调用相同旧逻辑和 `s3-probe` 意图，二者不混用。Origin（包括null、空值）、Referer、任何Sec-Fetch-*一律拒绝；不信任Forwarded/X-Forwarded-For，不提供浏览器CORS。

公开意图头不是密码、会话认证或本机进程身份认证；其它本机进程也能构造它。该门禁不能被称为验证了真实Electron身份。敏感参数不得放到URL，拒绝query（包括空问号）、转义路径、绝对形式URL、fragment/userinfo/opaque目标。Content-Type须为单一application/json，最多允许UTF-8 charset；任何Content-Encoding或Trailer声明/实际trailer拒绝，不解压、不重定向、不队列重试。

请求正文由MaxBytesReader同时核宣布大小和实际流大小，最多2MiB。每个路由实例最多一个已接纳调用，忙时429且不读新正文；没有后台任务或隐式缓存。调用取消后只有原操作返回、自己的正文关闭后才放开slot，不伪称“取消信号到达”等于I/O已经收尾。

从正文读取前开始共享6秒context预算，包住解析、原6..15秒内层读取和回传；更短调用者截止继续生效。接入的原应用服务器已有10秒ReadTimeout/WriteTimeout，这些全局设置未改变。**context不是socket读取截止**：阻塞的入站Body.Read仍受服务器读取截止约束，不保证6秒时强行打断每条CPU指令或卡住的客户端上传。没有另起不可回收body读取goroutine，取消/超时后不启动迟到远端读取或交付迟到成功。

## 严格请求契约

根对象恰好五字段：`readOnly`必须为true，`connection`、`pin`、`basis`、`limits`必须存在且非null。所有对象逐层拒绝重复字段（含转义同名）、未知/大小写别名、非法UTF-8或不成对UTF-16转义、错误类型和尾随JSON。字符串不做trim、Unicode正规化或静默改写。

- connection：必需endpoint/bucket/region/accessKeyId/secretAccessKey字符串；prefix/sessionToken可选字符串。复用原NewReadClient配置及内存凭据校验，输入不写日志/磁盘。
- pin：恰好storeId、正整数generation、64位小写sha256；basis.storeId必须一致。
- basis：恰好storeId、localRecords、baseItems。后两项为明确的字符串映射，最多各128项；localRecords值为原完整Record JSON字符串，baseItems值为规范hash。不能拿缺失字段冒充空库；显式空映射也须实际验证远端清单。
- limits：下表八项全部显式正整数，不允许字符串数值、小数、指数记数或关闭预算回退。传输入口的上限比内部通用API更小，原内部上限未修改。

| 字段 | HTTP允许上限 |
|---|---:|
| localRecordBytes | 256KiB |
| totalLocalRecordBytes | 1MiB |
| maxLocalRecords | 128 |
| manifestBytes | 1MiB |
| recordBytes | 256KiB |
| totalRecordBytes | 4MiB |
| maxRecords | 128 |
| maxItems | 384 |

原本地raw/canonical取较大字节计费及远端剩余额度扣减继续生效。最多129次签名GET（1清单+128记录），实际仍受统一6秒和总额约束；不读blob。这些是输入/读取预算，不承诺整个进程峰值内存上限。

## 脱敏响应

恰好三字段 `code/message/data`。成功HTTP200/code0/messageOK，data为原五字段format/version/read_only/counts/kinds；只允许固定file/tag/file-tag/attachment顺序，所有非负计数、分组总和、分类总和及所请求maxItems再次核对。没有原Plan、Record、正文、ID、hash、端点或凭据。数量本身仍属于粗粒度活动信息，未来调用者应绑定输入代际并限制其展示。

失败data始终null，无部分成功、私密原始error/JSON解析文字或底层URL。405非POST；403非本机原生意图；415编码/媒体声明；400输入/连接配置；413正文超限；429忙；503不可用实例；408取消；504截止；422读取或完整性/关系/统计拒绝。取消保留固定分类，不将403/404对象响应解释成密码错误或凭据有效。全部响应no-store、nosniff、JSON，并去除已有Access-Control-Allow-*头。

## 实际验证及完成门槛

新标准库HTTP测试11顶层/131通过事件，本地Go1.23.2定向-race真实执行；含POST→原引擎→真实本机合成S3的四类记录、完整7次签名GET、错误/取消/大小拒绝；同时验证25个入站反例、逐层合法JSON中的重复/类型错误、单slot与迟到成功、原生意图前零正文读取、正文上限及关闭、原失败无私密回传、真实S3取消。两个隔离错误实现分别去掉本机门禁、透传私密错误，被同一新断言拒绝，不进入提交。

原syncs3标准库包-race69顶层/428事件通过，共用门禁未改变旧probe断言。原Node保护202、scope63/bridge100/HTTP11合计174、原stage-review62通过；HTTP里的27项内部Go检查包含于单个既有顶层用例，不另累计。catalog/lock仅结构检查，testsExecuted=false不能当应用测试。原JS/React测试文件未改。

新增真实GoFrame路由测试1顶层/9子场景（10通过事件），从原生产Register访问新路由，验证BufferWriter、上下文取消、浏览器/错误意图、query、readOnly/重复字段及失败零出站。**本地标准库夹具不执行GoFrame/controller测试**；此文件必须在源码绑定Go1.24.11完整后端CI实际运行才能验收，不拿本地Node或合成IPC代替。

新候选首次缺少复合字面量闭合括号导致编译失败，修后11/131通过；随后修正新重复字段夹具中空map尾逗号时一次局部文本替换漏改，出现unused comma编译失败，再按实际原字节修正后11/131通过。失败原stdout/stderr和修后结果留在交付；这两次均无测试执行，不累计为测试通过，不修改旧断言来掩盖，非上一阶段产品回归。初稿和改进后的新夹具原件留存。

发布后仍须当前HEAD八PR、完整push UI/Windows、独立Desktop、额外pushSave全部通过；四份完整UI2308/实际服务19、双Electron273、同树PR测试合并、源码绑定完整后端及新HTTP和controller、原probe、品牌/原生/桌面/NSIS独立核验。预计后端1528事件仅是核对目标，以原报告为准。未完成前不进入2F.55，不用4c715旧绿灯，不为状态另造源码提交。

## 历史保护

仅原feature分支/Draft PR2，产品4.195.1/schema14、保存/Ctrl+S/队列回执/草稿/引用/退出保护及依赖不变；不恢复结构变化暂停保存、不删数据/迁移。唯一旧生产调整是共享原native guard和同一controller内路由注册，旧测试/校验器/工作流逐字节不变。46问题和12助手事故索引保持，本轮具体执行纠正另外留档。真实用户数据、真实桶和生产部署均未操作。不能把应用修补或验收称为ChatGPT投递超时根因已修。

标准库接口参考（未据最新文档升级项目工具链或使用新版本独有API）：
- https://pkg.go.dev/net/http#MaxBytesReader
- https://pkg.go.dev/context#WithTimeout
- https://pkg.go.dev/encoding/json#Decoder
