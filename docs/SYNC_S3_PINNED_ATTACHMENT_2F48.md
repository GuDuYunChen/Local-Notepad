# Phase 2F.48 — 钉定附件记录的完整 blob 读取

基线 `f9dd562e8568f5e90e09e08c991dea6cb876456b` / tree `4fc0d11bfe8c67e223105cd350d97fd66dcc745c`，2F.47完整验收5990100953。真实PR/HEAD及原验收归档已核；复查没有新复现的上一阶段产品阻塞，沿已确认只读消费路线推进，不重复实现清单/记录/摘要读取或固定端口夹具。

## 本阶段接口与保证

`ReadS3Attachment(ctx, client, S3RecordReference, S3AttachmentReadLimits{ManifestBytes, RecordBytes, BlobBytes})` 只接受显式钉定的附件ItemID；在请求前拒绝非附件命名空间、非规范编码及非法预算。先复用原ReadS3Record重新读取并验证清单和精确记录，再按已验证的AttachmentPayload.BlobHash读取既有 `blobs/<sha256>`。不接受调用方可修改的Record/元数据作为读取依据，也不把文件名拼入请求路径。

成功返回内部 `S3AttachmentObject{Metadata AttachmentPayload, Bytes []byte}`。附件内容必须同时符合已验证记录的SHA-256和声明大小；ETag或远端checksum头不能替代任一条件。即使声明大小为0，仍须实际读取并验证空blob。清单缺失、purged、HTTP404不是空附件，更不允许合成删除状态或写入空文件。错误均返回零结构，Bytes=nil且无文件名/元数据；固定错误不复制用户输入、路径、正文或实际/预期摘要。

三个调用方预算均为1..32MiB；已验证记录声明大小超过BlobBytes时在第三次GET之前拒绝。最多三次签名GET，输入合计最多96MiB（不是整个Go进程内存承诺）；清单、记录、blob读取及校验共享15秒或更短的调用者截止。每层错误、编码/短读/超限、摘要失败和取消保持原分类，不重试/重定向/HEAD/List；blob校验后再核context和精确大小才交付。每次重新读取，返回值修改不影响后续请求，没有隐式缓存。

复用既有DirRemote.SaveManifest/SaveObject/SaveBlobFile的真实字节格式与路径。支持空对象、含NUL/非UTF8的二进制以及UTF8文本，不归一化附件正文；文件名中的组合字符、空格和字面%2F沿原记录格式保留。

## 不在本阶段的功能

这是内部只读附件消费，不是可见S3设置UI或完整同步。成功内容和Metadata均为私密数据，不是脱敏IPC结果；不能直接日志输出或转接现有预检桥。没有创建本机文件、写数据库/同步状态、provider注册、apply、latest发现、关联记录/完整树验证、凭据配置持久化、上传删除、自动同步或真实桶访问。

接受内部名字不代表其适合直接用作某平台的本地文件名；任何后续安装必须另行验证目标/文件系统/覆盖规则。purged不授权删除用户数据。pin须独立可信；三段摘要一致不证明来源认证、版本最新、凭据有效、归属或List/写权限。公开意图头不是认证，前端停止等待不等于原生I/O已取消。

## 发布前验证与修正

新增独立s3_attachment_test.go共12顶层/73通过事件，使用原pinnedClient和临时DirRemote，不另起固定27121监听器。覆盖三段真实签名GET、既有格式及空/二进制往返；输入/三个预算离线拒绝；缺失/purged/恶意元数据零后续GET；三个摘要链的同长度篡改；摘要正确但声明大小错误；大小预检及响应超限；每段302/403/404/429/500与编码/截断拒绝；每段实际取消；第三段继承调用者截止；并发隔离；返回值修改不成为新权威，原记录API仍只读元数据。

本地Go1.23.2 linux/amd64在自有临时最小标准库模块逐字节复制相关生产文件，用GOTOOLCHAIN=local/GOPROXY=off/GOSUMDB=off/GOWORK=off且-race执行。syncengine36顶层/273事件（原24/200+新12/73）、syncs3原69/428全部通过，文件前后摘要一致。这不修改真实server/go.mod或将完整GoFrame项目module-off，不冒充本地SQLite/React/Windows实测。

首轮新测试的隐私辅助断言误把公共错误中的“附件”二字当作私密文件名，造成27条失败事件；没有产品泄露证据。已仅改该新辅助断言为合成文件名的精确片段，公共描述不再误报；原错误分类/零值断言和所有旧测试不变。首轮源码与失败日志保留。两份隔离错误实现分别移除大小检查、绕过blob摘要验证，均被同一组新断言拒绝；不是上一阶段新产品缺陷，不进入提交。

原保护202项通过，S3 scope63/bridge100/HTTP含Go11共174个不同用例通过，原stage-review62通过，内部27Go检查计入单个顶层用例。一次过长组合命令在读取部分Node输出后达到外层预算，没有将该部分输出计为完整通过；随后有界HTTP诊断导入原入口11项退出0且无活动句柄，分别执行scope/bridge，未改原测试、生产代码或CI门槛来消除执行安排问题。catalog/lock仅结构核验。没有clone、npm安装、模块/工具链下载或真实用户数据操作。

## 当前HEAD完整收尾门槛

发布后必须核对新HEAD全部17CI、四份PR/push×Windows/Linux完整UI/实际服务、双Electron、PR测试同树、Go1.24.11源码绑定完整后端及S3/controller、原生/桌面/NSIS。原UI2296/Electron261预计不变；Go预计1157事件（1084+73）和111份Go/锁文件，但数字必须以当前原始报告实测为准，旧用例删除0。不能沿用f9dd旧绿灯或只看源码完成。

只新增两份Go、本协议并更新HANDOFF，所有既有生产文件/旧测试/工作流/验收器、package/lock/schema14及自动保存/Ctrl+S/回执队列/草稿/引用/退出保护保持。原46问题/12助手事故索引不变，本轮具体反例和执行纠正独立留档。当前阶段完整通过前不进入2F.49，最终状态只写PR和交付，不为验收文字另造源码提交。不将项目验收说成ChatGPT投递超时根因已修。

本轮核对的官方资料（不升级依赖）：
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html
- https://pkg.go.dev/context#WithTimeout
