# 2F.85 同模块验收修补：真实签名被夹具误拒绝

接续 d23d810944d95a5516fbefb2cb4d88ef4373858f / 4.218.0，仍是完整云端只读检查模块，不创建下一功能阶段。上一版4.217.2验收6118419287不重做。

## 原始失败与确定根因

Windows Desktop run38217527227/job114705653029、原产物11732741334的SHA-256为865dbec332b1edbdf6ff0392370c18f6936557c6cf40328bb07871f971316780。原报告保留complete:false；s3-inspection只完成入口/非法表单一项，随后等待readable失败。完整checks.json里的失败界面实际已经返回对象HTTP400，不能把12秒等待当成云请求始终无响应。

原Go read_client.go（blob7415e1b8a71fc0f43a72a1c15310299e5741af5b）的signRead生成不带逗号后空格的Authorization；新Node测试服务却要求恰好一个空格。签名尚未验证就返回400，旧11个夹具自测都自行生成带空格的头，漏掉了真实生产格式。不是用户凭据错误或保存功能失败。

HTTP认证参数使用列表语法，分隔符允许可选空格/水平制表符；参考RFC9110 §5.6.1/§11.4：https://www.rfc-editor.org/rfc/rfc9110.html 。AWS SigV4参数说明：https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-auth-using-authorization-header.html 。修补只允许分隔处的SP/HTAB，不接受CR/LF；精确目标、空GET正文、host、凭据范围、必需签名头、令牌、SHA256及HMAC验证原样保留。

## 修补范围及反例

仅修改s3-inspection-fixture.mjs的授权分隔符匹配，另在原共享Node/Vitest注册器增加5项回归。保留全部旧11项及原生Windows整模块用例、所有预算、工作流和生产源码。新测试覆盖紧凑分隔、HTAB/OWS、错误签名/范围/重复字段/CRLF和真实HTTP紧凑头。

精确旧夹具执行新16项：12通过/4失败；修补后16/16，0跳过。另把完整原Go读取器按Git blob核对后，在隔离Go1.23.2标准库模块编译并调用真实Node HTTP夹具：旧夹具首次零字节读取稳定返回400；修补后10场景全部通过，10请求/10签名核验，包括空/非空、403、404、重定向拒绝、503、编码拒绝、超限、真实截止和手动恢复。原模块核心65/65重新执行通过。

该本地Go检查使用原完整读取器，但不等于完整后端、Electron、Windows或真实云厂商验收；隔离模块的go.mod及调用程序只在交付证据里，不替换项目工具链。当前候选仍须新HEAD原始CI、生产Settings→preload→main→Go、停止/忙拒绝/迟到隔离、清空关闭及旧保存退出全部通过，不能沿用旧绿灯。

## 版本与历史

这是同一未验收4.218.0候选的测试修补，不是另一个用户功能。package.json、package-lock.json、679依赖节点、schema14、全部生产源码和工作流不改；不重试旧CI、不增加临时分支或PR、不合master、不发布或打标签、不访问真实用户数据。不为最终状态再造提交。

46条历史产品/环境记录和12类助手执行事故继续分开保留；本次自签夹具漏测生产格式归入既有EXEC-06/测试前提事故，旧失败证据不抹除。没有证据证明ChatGPT断流根因已解决。本轮本地DNS失败后没有反复clone或安装依赖；源码按精确blob恢复而非伪造完整checkout。最终状态写PR和交付报告。
