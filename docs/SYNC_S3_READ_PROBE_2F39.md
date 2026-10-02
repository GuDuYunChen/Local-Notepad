# Phase 2F.39 — 显式S3只读对象预检

基线0b93e7ac14c6f07321724dc81217505570e0fdb8 / tree262ac6eba0f677355a450fd9af452cef270b62a5。feature/knowledge-os-phase2 / Draft PR #2，master、产品4.195.1、schema14不变。

## 目标和边界

衔接2F.38的只读层，为后续显式连接检查提供结构化预检API，而不是继续堆叠历史筛选按钮。新增 `syncs3.ProbeRead(ctx, cfg, credentials, key, limit)`，仅在调用者明确调用时，对选定对象键进行一次现有GetObject签名GET及有界完整读取；配置构造不自动探测。调用方必须明确提供已有的小对象键及大小预算，支持1字节至32MiB，沿用15秒请求预算及context取消。

结果只含 `outcome`、可获知时的 `httpStatus`、`acceptedBytes`。成功仅表示这一次完整接受了这个对象，不能证明凭据正确、桶可列举、可写、支持全部S3协议、对象属于有效manifest或工作区两端一致。公开对象可能无需有效凭据即可读取。结果不含正文、ETag、键、端点、Authorization或凭据；失败的acceptedBytes为0不等于网络没有接收数据。HTTPStatus为0表示底层错误未带状态，不表示没有收到响应。

没有新增UI/HTTP路由、provider注册、凭据保存、List、HEAD替代、上传删除、锁或自动同步；用户现在不会看到S3设置按钮。基础API不会先写一个测试对象，也不会在指定键失败后猜测其它键。未连接任何用户桶/AWS/第三方服务。没有改现有WebDAV、编辑器、保存/退出保护、数据库、依赖或工作流。

## 分类规则

`readable`只对应GetObject完整成功，HTTP200，acceptedBytes可为0（空对象仍是有效完整读取）。非200不冒充成功，包括204、206、304。

本地配置/限额无效、凭据格式无效、键无效分别返回invalid-config、invalid-credentials、invalid-key，不发出请求。401/403返回access-denied，不断言“密码错误”；404返回not-found，不把它当成配置或权限通过。301/302/303/307/308为redirect-refused，304及其它非200为http-failure；429/5xx不自动重试。超限、正文/编码拒绝、网络/TLS错误、取消和截止期限分别分类。错误只保留既有安全哨兵或新的纯状态HTTPError，不透传未知异常或包装层原文。

AWS说明：不存在的对象可能因ListBucket权限差异返回404或403，匿名可读对象也不能证明提交凭据有效。不能用简化的“403就是密码错、404就是连接成功”做预检。

## 测试

新增14项顶层测试，覆盖真实HTTP完整/空/限额对象、精确UTF-8键与前缀、签名及临时token存在、18种非200状态、跨源重定向目标零访问、配置/凭据/键/限额拒绝、提前取消/过期、真实正文取消/超时、声明及chunked超限、短读、重复编码、TLS不信任、响应关闭/应用层零Body.Read、错误包装脱敏、并发独立及nil/零值。测试只用公开样例或合成凭据和本机httptest，错误输出不打印私密标记原文。原28项S3顶层测试完整保留。

本地Go1.23.2独立标准库包race测试共42项顶层/275含子测试通过事件，两者不相加；vet通过。并非项目toolchain go1.24.11的完整后端、React、Windows或安装包实测。现有CI的server/go test ./...自动发现新增测试，但新HEAD仍须核对实际执行日志和完整8PR/push UI+Windows/Desktop/原始产物；源码提交不等于验收完成。历史Node560、保存保护80、阶段核验62属于本候选另行回归，结果在实际日志和PR更新中记录。

## 前置验收证据与更正

八PR全成功；push UI37015446008的Linux110865063639/Windows110866059075步骤成功，Desktop37015445983成功。PR测试合并dcee2b63633fa9768957b8580ca7690f55080ef5与源tree262ac6e一致。

后端执行采用PR job110865092273：同测试树、Go1.24.11、server目录go test ./...实际返回 `ok notepad-server/internal/syncs3 0.406s`。首次push job日志返回local-notepad/server模块路径，与真实模块不符，已排除；路径fetch_file也曾返回不同go.mod，亦排除。按server tree448374352223edc76fc6cb19869aaeb1c1d039b5及go.mod blob ae5dac55b08ce045a2808fca2a14ccb2ace26403（1776B）确认源码与本地逐字节一致：module notepad-server、go1.22、toolchain go1.24.11。差异来源未知，不能宣称工具故障已修复。PR评论5954554287更正5954433635，保留错误历史，不使用不匹配证据。

SaveRecovery Linux11230036723/Windows11229723741各1971/1971完整UI（155文件）及19/19实际服务，无失败跳过、提交与平台换行后的lock摘要匹配。原生11229069907用原verifyRecordFilterReport通过3布局21帧及12项记录限定/全部继承门槛，最低对比度4.803804812765521；仅目视窄窗口empty原图，不冒称21张逐一人工检查。Desktop11230255981原校验器通过8检查5PNG和两次正常原生退出。以上为隔离证据，不是用户现场。

安装包11229304323：ZIP104014796B，SHA256 f2fc3fea56da051e7efbbf26fee61b291c9f89f2524dddd3b5b5f74cf036d5c2；EXE104012206B，SHA256 0a584be9390308da9c3a34e02d041343169bbf485189cbbfe279fa4baa347a13，未签名，仅为2F.38.2。SREAD01/02在该完整候选验收后更新历史修复，其余44项问题记录不改动。

## 协议参考

https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html

https://go.dev/src/net/http/client.go

上述参考解释协议语义；本地合成测试不等于访问真实服务。
