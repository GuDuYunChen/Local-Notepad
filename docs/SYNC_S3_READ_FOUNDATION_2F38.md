# Phase 2F.38 — S3兼容只读访问基础

基线4580f5c6bc58b76e6cc858f9a70f1883431d4274 / tree626b7f9217190ba8ee282900fa1a046ec24d06f6。沿用feature/knowledge-os-phase2 / Draft PR #2，不合master，不发布生产；产品4.195.1/schema14不变。

## 前置验收及阶段目标

2F.37及TEST-08已完成当前提交独立验收，见PR #2评论5952627874。八PR、push UI37007281376（Linux110838420323/Windows110839738207）、Desktop37007281308成功。PR测试合并2907e46a313129fd4d12615dca2d86e17fb451f6的源码归档重建为同一tree。原生11227080029使用原校验器通过3布局21帧/12项记录限定操作，最低采样对比度4.803804812765521；SaveRecovery Linux11227030046和Windows11226976073各1971/1971完整UI及19/19实际服务；Desktop11225849721原校验器通过8检查5PNG。Windows包11226876942，ZIP SHA256 84af25ce38dd70b5f826ac3ff98222e1e48083c096fdb46c1d286726a1d5bf17，EXE SHA256 483b973626819e5b3db1a9653fad9eb029dbe175d48a9efe8fb32e3c5ab93c35，未签名。以上是基线的证据，不替代新HEAD验收；隔离测试不是用户现场。

本阶段回到已确认多端同步路线中的S3兼容方向，而不是继续增加历史筛选按钮。目标是建立可被后续显式连接预检复用的、受限且可测试的只读访问层。交付位于server/internal/syncs3；没有注册provider或暴露新的HTTP接口，普通用户现在不会看到新的S3开关或发生额外网络访问。

## 支持范围

NewReadClient接收显式Endpoint、Bucket、Region、Prefix及内存Credentials；GetObject(ctx,key,limit)只执行GET并返回完整有界字节和不透明ETag。当前为root endpoint的path-style S3；不做环境凭据发现、region发现、代理转发或重定向跟随，不从响应推断备用端点。

端点默认要求HTTPS并保留证书验证；仅localhost或字面loopback地址允许HTTP供本地兼容服务/隔离测试。禁止URL内凭据、查询、片段、非根路径以及无效端口。对象键使用UTF-8逐字节百分号编码，不做Unicode/大小写/重复斜线归一化；明确拒绝不支持的绝对键、点段、控制字符、反斜线和超过1024字节的组合键，而非悄悄重写。前缀由显式配置提供。

仅实现空请求体的AWS SigV4 header GET签名，可签临时session token；不提供签名URL、写入或通用方法签名API。凭据仅在内存，JSON及fmt格式化不包含其值；错误不带原响应XML、URL、Authorization或底层异常原文。这不是加密存储/内存擦除保证，也不保护调用方原始字符串。

每次最多读取调用方指定大小，上限32MiB；响应头预算64KiB，请求总时限15秒，连接/TLS/响应头均有有限预算，支持context取消。拒绝3xx、错误状态、编码响应、超限、短读或部分读失败，失败不返回部分对象；403不解释成“文件不存在”或“密码错误”，404仅表明本次HTTP状态。ETag仅透传，不是内容哈希或来源真实性证明。禁用环境代理、压缩及keep-alive以避免复用失效连接的透明重发，不做应用层自动重试。

## 尚未交付

没有S3设置界面、凭据保存/轮换、provider注册、List分页、manifest模式/完整性验证、PUT/DELETE、条件写入/CAS、锁租约、双向合并或自动同步；没有实际连接用户桶、AWS或第三方S3服务。path-style签名库的本地通过不等于全部兼容服务支持。后续接入必须完成这些对应边界和用户显式操作设计，不能用本阶段宣布“完整S3同步可用”。当前使用标准库的受限实现以避免新增SDK/依赖大升级，后续扩大协议面时须重新评估官方SDK；不得把本包当通用S3 SDK。

## 测试和当前状态

新包16项顶层Go测试，含嵌套反例共66条通过事件，数字不相加。覆盖官方独立签名样例、端点/凭据/键边界、session token、精确编码、16种非成功状态不重试、跨源重定向拒绝、实际loopback HTTP、取消、正文大小/编码/完整性、错误脱敏、未信任TLS证书拒绝以及零值客户端不崩溃。仅使用公开样例凭据和临时httptest，不用用户账号。

本地命令：在server/internal/syncs3执行`GOTOOLCHAIN=local GO111MODULE=off go test -race -json -timeout 45s`。这是Go1.23.2、标准库独立包/race验证；不是项目go.mod声明toolchain go1.24.11的完整后端构建。未修改go.mod/go.sum来规避工具链。现有UI Redesign CI的server/go test ./...会自动发现本包；新HEAD须确认实际日志执行这些测试，并保留全部原CI/Windows/桌面验收门槛。没有本地npm ci、完整React/Electron/Go服务或Windows实测。

## 协议参考

AWS官方SigV4单块header签名与GET Object样例：
https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html

AWS对象键规则：
https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html

测试中的AKIAIOSFODNN7EXAMPLE及配套密钥是第一份官方文档的公开样例，不是真实访问凭据。样例期望签名f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41独立固定，不能用被测函数自产期望值。
