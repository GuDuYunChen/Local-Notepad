# Phase 2F.38.1 — S3响应编码重复字段漏检修补

基线为 `4e3cebae1b99a80f48c5c30306b286b0bb8034ba` / tree `6ce3a2f21f27789aebdcb4f5e8bf6e3b8745b864`。沿用 `feature/knowledge-os-phase2` / Draft PR #2，不合master、不发布生产。2F.38复查发现SREAD-01，先修补本阶段；没有进入2F.39，不能把原提交的绿色检查当成本缺陷已修复。

## 复现与原因

在原生产HTTP transport上使用临时loopback服务器，发送真实gzip正文和两行Content-Encoding。首行分别为identity、空字符串，第二行均为gzip。旧GetObject两次均错误返回成功、47字节编码正文和ETag，只发生一次GET。新增回归在旧代码非零失败，不是修改夹具来迎合现有实现，也不是用户现场或真实S3服务事故。

旧实现用Header.Get只读取同名字段的首值，较后的编码声明没有进入判断。HTTP允许列表字段分布于多行；Content-Encoding表示作用于表示数据的编码链，不能通过首行的identity或空值判断全部字段未编码。该基础包既定能力不包含解压，因而上述响应本应在返回对象前拒绝。

## 修补边界

改用Header.Values遍历全部Content-Encoding字段值，在读取正文前验证每一项。保留原狭窄兼容范围：无字段、空值和字面identity可读；任一其它非空值（包括gzip、br、未知编码及逗号组合）均返回原ErrBody。不新增解压、不扩展编码支持、不将不支持的多值编码静默当作原始正文。identity本身不是RFC建议的Content-Encoding用法，本次只是保留既有兼容行为，不声称实现完整编码协商。

拒绝时不向调用方返回对象字节或ETag，响应体关闭，错误不包含服务器提供的编码值或正文，不重试、不重定向、不写入。读取大小、总超时、TLS、凭据、键编码、签名、HTTP状态分类和既有只读边界均不变。网络栈可能已接收部分报文；“读取前拒绝”指不调用应用层Body.Read，不是承诺底层网络零接收。

只读包仍未注册同步provider，无UI/新HTTP路由、凭据保存、List、写入删除或自动同步。该缺陷目前影响基础包的响应判断，没有证据表明用户的现有WebDAV或工作区已经受到影响。

## 防复发测试

保留全部原16项顶层测试。新增4项顶层测试：

- 原生产transport的两组真实gzip重复字段回归；
- 16组字段组合及读取前拒绝、关闭一次、无对象/ETag、错误脱敏和一次请求检查；
- 4组真实HTTP普通正文兼容对照；
- 同名字段大小写不同的真实HTTP回归。

完整新增测试在旧实现得到15条通过/11条失败记录（包含父测试和子测试，不能与顶层数相加）；旧代码的错误不是测试超时。修补后独立标准库包 `GOTOOLCHAIN=local GO111MODULE=off go test -race -json -count=1 -timeout 45s` 在Go1.23.2通过20项顶层测试、含子测试92条通过事件，0失败、0跳过，go vet通过。没有移除原AWS固定签名样例或原取消、重定向、TLS、正文限制测试。

这是本地独立包与loopback验证，不是项目声明Go1.24.11的整个后端、Windows、完整应用、真实存储桶或生产验证。现有UI CI的 `go test ./...` 会发现新增测试，仍须核对新HEAD实际日志及原协议要求的8PR、push完整UI/Windows、Desktop、测试合并树和原始产物。源码推送也不等于阶段验收。

## 问题索引与依据

新增SREAD-01为本次复现的基础包缺陷；原44条问题逐项保留，候选45条为36历史修复、3缓解、6未解决或待验收。SREAD-01保持unresolved，待新提交独立验收后再改变状态。原12类助手执行失误单独保留，不把它们当作聊天断流根因。

Go官方Header.Get/Values说明：https://pkg.go.dev/net/http#Header.Get

RFC9110第5.3节重复字段与第8.4节Content-Encoding：https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4
