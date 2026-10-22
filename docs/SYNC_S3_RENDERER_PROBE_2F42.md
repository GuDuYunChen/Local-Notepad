# Phase 2F.42 — 显式 S3 只读预检的 renderer 调用层

基线 `1cfb12bf2899e5eff6864c4ea5347ee2171d2f88` / tree `746b0aa7694ed1517dd46e6264d2411257ab6f90`。2F.41 的源码、当前提交 CI 和原始产物独立验收已在 PR #2 评论5981057926完成；不重做旧阶段或追回不可读旧日志。仅 feature/knowledge-os-phase2 / Draft PR #2，4.195.1 / schema14不变。

## 本阶段交付

沿已确认的一次性显式只读预检路线，新增 `src/services/s3ReadProbe.mjs`，由现有 `src/services/api.js` 重新导出 `createS3ReadProbeSession`。这是 renderer 的可复用调用与结果解释层，不是新的 S3 设置界面。导入、创建会话、查看快照、清除结果都不会联网；只在调用 `session.read(payload)` 时读取当前 `window.electronAPI.s3ProbeRead` 并调用一次。缺少原生桥直接返回固定不可用状态，不使用通用 api()/fetch、XMLHttpRequest 或浏览器直连回退。

请求沿用原桥的八个必需字段及两个可选字段，`readOnly` 必须为true，`maxBytes` 为1..1048576，完整JSON最多64KiB UTF8。仅复制普通对象的自有可枚举数据属性，不执行getter/toJSON、不保存原始配置或凭据、不改写键、前缀、空格或Unicode。格式错误零调用；更深的S3配置、签名和目标语义仍由原main/Go校验，不伪称renderer已验证连接。

结果只保留固定状态、固定中文提示、服务HTTP状态，以及经完整契约校验的outcome/httpStatus/acceptedBytes。拒绝未知字段、额外正文/端点/凭据、访问器、类型或状态矛盾、成功字节超本次限额、失败部分字节。接受空对象的完整成功。403/404、临时token、公开对象成功都不证明凭据有效，也不推断List/写权限或同步完成。异常不复制错误原文。

## 生命周期与调用契约

- `read(payload)`：显式一次调用，返回冻结的脱敏结果；无队列、无自动重试。原始main传输并发/7.5秒截止/close前持槽保持不变。
- `snapshot()`：只返回当前冻结视图，不保存端点、对象键、凭据或原响应。
- `invalidate()`：输入变化、对象替换或离开调用上下文时清除结果并使旧调用失效。A→B→A不会复活旧成功。**只停止采纳结果，不声称已经取消原生I/O。**
- `dispose()`：永久停止这个会话，清空结果；未来read不再调用原生桥。未来界面接入必须在卸载时调用，不能用重建会话绕过主进程并发保护。

renderer等待上限10秒，允许原桥7.5秒结束及投递余量。等待超时、invalidate或dispose都会结束调用者的等待，但在原生Promise真正settle前保留该会话并发槽；从不因本地停止等待就声称传输结束。原生Promise永不settle时会话保持不可重入，不能以重复点击修复未知投递结果。迟到成功/拒绝被消费但不改写已失效状态。没有新增IPC取消通道或修改原生桥。

调用层不会自动监视尚不存在的表单或导航组件；实际调用者必须在输入变化时invalidate、卸载时dispose。本阶段通过现有服务入口交付，不新增可见控件、设置持久化、provider、List、PUT/DELETE、自动同步或真实桶访问。不承诺安全擦除JavaScript或原生克隆内存。

## 发布前验证与历史防复发

新增98项独立用例，同一cases入口分别由Node与Vitest注册；覆盖输入/UTF8限额、原生缺失、精确请求、零字节、完整响应矩阵、私密数据拒绝、Promise拒绝/thenable、单并发、A→B→A、截止、dispose及原main IPC scope导航拒绝的互操作。测试只用合成凭据、合成IPC事件；没有访问外部桶，不冒充真实Electron GUI。

首轮新候选97通过/1失败：恶意输入Proxy反射重入时，在占用会话前序列化会产生两次native调用。已把并发占用移到输入反射之前，保留原断言，修补后98/98。此为本阶段未发布候选的反例，不推翻已验收2F.41、不重复增加全局缺陷编号。原98项与保存/草稿/退出80项合跑178/178通过；原S3 Node171/171（其中单个Go集成用例含15项内部契约）通过，数字不重复累计。日志保留在本轮交付，catalog与lock仅结构检查，不当测试。

原46问题与12类助手事故记录逐字节保留；不改正文保存、Ctrl+S、回执队列、引用、退出保护、electron/server生产代码、原测试/断言/验证器、依赖及schema。无本地依赖安装/clone，Node验证不替代新HEAD完整Vitest/React、Go1.24.11、Windows和原始产物验收。原CI自动发现新增Vitest文件；须核对全量报告确实含98项、旧用例无删除，而非只看绿灯。

源码提交后仍要求原八PR、push完整UI/Windows、独立Desktop、PR测试同树、双平台完整UI/实际服务、源码绑定完整后端/S3/controller、原生/桌面/NSIS独立核验；不修改原验证器或降低门槛。最终状态只写PR及交付记录，不为“已验收”另造源码提交。
