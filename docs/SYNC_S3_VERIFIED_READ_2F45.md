# Phase 2F.45 — 按预期 SHA-256 接受 S3 完整对象

基线 `c6df4b6d6a171e13e099bd403853838d9a69589d` / tree `a2953560b590c1eb194f60d84e612c3ef9ca129a`。2F.44.1完整验收评论5986972515、原失败/修补证据保留。本次复查没有新的已复现阻塞，沿既有S3兼容只读基础路线增加内容完整性读取能力，不重复开发hook或追加一套竞争端口夹具。

## 可调用的产品能力

在现有 `syncs3.ReadClient` 上增加 `GetVerifiedObject(ctx, key, limit, expectedSHA256)`。调用方显式提供64位小写十六进制SHA-256；无默认值、大小写/空白归一化或关闭验证回退。格式错误在任何GET之前拒绝。它调用原GetObject一次，完整读取后对原始字节计算SHA-256；匹配才返回现有Object，失败均返回零Object（Bytes=nil、ETag为空）。新增固定错误ErrExpectedDigest/ErrDigestMismatch不包含端点、键、正文或实际/预期摘要。

单次签名GET、精确对象键/前缀、临时token、证书验证、禁止代理/重试/重定向、32MiB上限及失败零部分对象均沿用原读取器。整个读取与验证共享15秒最大预算或更短的调用者截止；完整读取后和计算摘要后再次检查context，不把取消后的字节交给调用者。计算不支持逐CPU指令中止，但输入最多32MiB，结果在取消/截止已被观察到时拒绝交付。原GetObject实现不变。

**预期摘要必须来自独立可信来源。** 与同一不可信响应提供的值比较不能证明来源真实；本接口不从ETag或x-amz-checksum-*响应头取得期望值。匹配不证明清单有效、远端版本新鲜、凭据有效、对象归属或List/写权限。ETag仅作为成功Object的不透明元数据返回，不能升级为校验凭据。没有SHA-256保密性或JavaScript/Go安全内存擦除承诺。

这是后续只读同步对象消费可复用的内部客户端方法，**本阶段没有注册S3 provider、解析manifest、安装对象或改动现有HTTP/IPC/renderer预检契约**。现有ProbeRead仍然只证明本次字节完整读取，不偷偷变成已验证摘要或清单。没有新设置UI、配置/凭据持久化、List/HEAD/上传删除/自动同步或真实桶访问。

## 发布前实际验证

独立 `read_verified_test.go` 新增12项顶层Go测试（含子场景54个通过事件），复用原客户端和真实httptest服务器：空对象/abc/换行固定向量；非法摘要零GET；首/中/末摘要差异；伪ETag/校验头不能覆盖字节不匹配；不归一化正文；14种HTTP拒绝及传输错误；大小/短读/后续编码声明；非法输入、nil客户端和已取消context；body.Close期间取消不交付成功；调用者截止；真实签名Unicode/token/GET取消；并发调用期望隔离；原byte-only预检含义不变。

本地Go1.23.2 linux/amd64在syncs3标准库独立包执行 `GOTOOLCHAIN=local GO111MODULE=off GOWORK=off GOPROXY=off GOSUMDB=off go test -race -json -count=1 -timeout 90s .`，69顶层/428通过事件、0失败/skip。没有更改完整项目go.mod/go.sum或下载工具链/模块。这不代替Go1.24.11源码绑定完整后端验收。

一次隔离反例将新方法故意改成信任ETag：原首/中/末三处摘要不匹配断言全部拒绝该实现。反例不是用户缺陷或真实数据泄露，未进入源码提交。原绑定24+renderer98+保存/草稿/退出80同条命令202/202，原S3 Node172/172（单个Go顶层用例含原27内部检查）、原stage-review62/62通过。catalog/lock仅结构检查，testsExecuted=false不当应用测试。无clone或npm依赖安装。

原所有测试文件/断言、工作流和验收器保持；仅新增Go回归。原3份标准库生产文件布局不变，既有跨语言夹具逐字节复制更新后的read_client.go继续验证原HTTP契约，不重建桥或另起固定端口服务。

## 完成门槛和保护

发布后新HEAD仍须17条CI、八PR、完整push UI/Windows、Desktop及额外push SaveRecovery成功；四份完整UI/实际服务、双Electron、PR测试同树、Go1.24.11完整后端及全部S3/controller、原生/桌面/NSIS独立核验。预期原UI2294、Electron259不变；新增Go12必须实际执行，完整Go通过事件预期884，最终按真实原报告核对，不能仅用预期数字认定通过。不得用c6df旧绿灯替代。

仅feature/knowledge-os-phase2 / Draft PR2，不改或合master、不强推/生产发布或操作真实数据。产品4.195.1/schema14、自动保存/Ctrl+S/队列回执/草稿/引用/退出保护、src/electron、package/lock和46问题/12助手事故索引不变；不恢复结构变化暂停保存，不删数据或破坏性迁移。本阶段验收前不进入2F.46，最终状态写PR与交付而非再造状态-only提交。

协议参考（本轮已查阅的官方资料）：
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
- https://pkg.go.dev/crypto/sha256
