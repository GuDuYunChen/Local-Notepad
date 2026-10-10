# Phase 2F.47 — 从钉定清单读取单条 S3 记录

基线 `4ef54e56f02c1380f86eaac0fa89d276045bef92` / tree `ec97f85d0e3d6f0113d00af2ff1efc926df024b4`，2F.46验收5988418986。复查没有新的已复现阶段阻塞，推进既有只读消费路线；不重复实现清单解析、摘要客户端或固定端口夹具。

## 本阶段接口

`ReadS3Record(ctx, client, S3RecordReference{Manifest, ItemID}, S3RecordReadLimits{ManifestBytes, RecordBytes})` 先调用原ReadS3Manifest重新读取和核验指定清单，再从其Items精确选取ItemID，使用已验证条目摘要通过原GetVerifiedObject读取 `objects/<sha256>.json`。不接受调用方可以修改的Manifest.Items替代真实清单，不把条目ID拼入路径，不发现latest/List，不使用ETag或远端checksum替代内容摘要。

两份对象各有明确的1..32MiB预算，最多一份清单和一份记录GET，合计最多64MiB输入；整个GET/摘要/JSON解释共用15秒或更短的调用者截止。清单失败时不读记录；条目缺失返回固定ErrS3RecordMissing，不合成purged、不搜索其他键或初始化空仓库。原HTTP/摘要/超限/取消错误保持原分类且失败返回零Record，无部分载荷或元数据。成功Record包含私密正文，只是内部数据，不能直接作为脱敏IPC结果。

复用原Record及四种载荷格式：file、tag、file-tag、attachment以及无载荷purged。只接受五个基础字段及对应唯一载荷；嵌套载荷必须包含现有序列化的全部字段。复用2F.46的JSON/Token扫描，拒绝每一层的重复成员（含转义别名）、未知/大小写别名字段、null、类型错误、无效UTF8/UTF16。Record.ID必须精确等于选中条目，Kind与条目命名空间一致；调用原normalizeRecord核查既有载荷/状态规则，错误原文不向外复制。

身份不trim、大小写折叠或Unicode归一化；身份长度和控制字符限制与钉定清单一致。file-tag分隔身份拒绝包含冒号的分量和含糊的purged键；附件名需通过既有safeAttachmentName且键为精确小写编码。正文字符串保持原值，不擅自清除换行、NUL、空格或组合字符。新入口严格拒绝不明确记录，不迁移/重写现有对象或改变DirRemote行为。

**这只验证所选单条记录，不是完整远端结构验证或apply授权。** 未检查父子目录环/孤儿、标签关系、删除级联、引用正文、附件blob内容，也不读取它们。没有provider注册、可见设置UI、配置凭据持久化、安装/写入本机、上传删除、自动同步或真实桶访问。purged仅是读到的状态，不能据此直接删除用户数据。清单pin仍需独立可信来源，不证明最新版本、来源认证、凭据有效或写/List权限。

## 实际发布前验证

新增独立 `s3_record_test.go`：12顶层、116通过事件，覆盖原encodeRecord/DirRemote对象与清单的八种状态往返、真实签名两次GET/临时token/路径、缺失条目、非法依据与预算零网络、双摘要链与错误身份、四类载荷与purged、重复/别名/Unicode、每个嵌套字段missing/null/type、两段预算及HTTP302/403/404/500拒绝、真实选中GET取消、并发选择隔离、返回载荷修改不影响下次读取，以及解析前截止。

本地Go1.23.2在自有临时最小标准库模块逐字节复制现有syncengine/syncs3/syncjob生产文件、原S3测试及2F.46/本轮测试，使用GOTOOLCHAIN=local/GOPROXY=off/GOSUMDB=off/GOWORK=off，-race实际通过syncengine24顶层/200事件和syncs3原69顶层/428事件。不是修改完整server/go.mod、真实项目module-off或本地GoFrame/SQLite运行。文件前后摘要相同，无模块/工具链下载。

两个隔离错误实现分别去掉Record.ID匹配、将缺失条目伪造成purged，都被新原断言拒绝；反例不进入提交，不当上一阶段产品缺陷或用户数据泄露。原Node保护202、S3 Node174、stage-review62实际通过；内部27Go检查已含于单个既有Node顶层用例，不重复计数。catalog/lock只是结构核验。没有clone/npm依赖安装，所有旧测试/断言/工作流/验收器不变。

## 完整收尾门槛

发布后的新HEAD仍须17条CI、八PR、完整push UI/Windows、Desktop及额外push SaveRecovery全部成功，四份完整UI/19实际服务、双Electron、PR测试同树、Go1.24.11完整后端及全部S3/controller、原生/桌面/NSIS原始产物独立核验。预计UI2296/Electron261不变，Go通过事件1084（原968+新增116）、109份Go/锁文件；最终必须以实际原报告核对，不能凭预期或旧HEAD绿灯验收。

仅feature/knowledge-os-phase2 / Draft PR2；不改或合master、不强推/发布生产/访问真实数据。产品4.195.1/schema14、自动保存/Ctrl+S/队列回执/草稿/引用/退出保护、所有既有生产文件、原测试/CI/验收器、package/lock和46问题/12助手事故保持。只新增两份Go与本协议、更新HANDOFF。当前阶段全部通过后才进入2F.48；最终状态写PR/交付，不另造状态-only源码提交。

参考本轮核对的官方文档（不升级Go/JSON库）：
- https://pkg.go.dev/encoding/json
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html
