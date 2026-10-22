# Phase 2F.40 — 受限本机 S3 只读预检 HTTP 入口

基线88583d0ba55cce3f3cfe36566d8c2e79e3eb942a / tree058eb0063be7728823a416ee73ecd9fcd6ef5618；2F.39/2F.39.1先完成独立验收（PR评论5955810680），才开始本阶段。feature/knowledge-os-phase2 / Draft PR #2，不合master、不发布生产。产品4.195.1/schema14不改。

## 可调用能力与边界

新增已注册路由 `POST /api/sync/s3/probe`，沿用现有 `/api` 同步控制器组。原生本机客户端可显式检查一个已有对象是否能完整读取；不是检查桶写入权限，不会写入探针文件，不保存凭据或配置，也不会调用现有恢复/同步任务。尚无设置UI、Electron IPC桥或S3 provider注册，本阶段不能宣称完整S3同步可用。

请求须来自实际loopback连接，Host为localhost或loopback IP，不能依赖X-Forwarded-*伪造来源。需要单一 `X-Notepad-Read-Only: s3-probe` 意图头。Origin（包括空值/null/本地开发来源）、Referer或任意Sec-Fetch-*字段均拒绝；CORS不是授权，响应移除allow-origin/allow-credentials。这个公开意图头不是口令，本机原生进程是受信任调用者；不是多用户鉴权方案。将来renderer接入必须另行设计受控原生桥，不能简单允许null Origin。

Content-Type只能application/json（可带charset=utf-8），拒绝重复Content-Type及任何Content-Encoding。URL只能精确路由，不接受查询参数、绝对形式目标或替代编码路径，避免凭据落入URL。原日志只记录方法/路径/耗时，本入口不记录输入或对象正文。网络客户端本身和调用者日志仍需妥善处理凭据，不能承诺安全擦除或操作系统内存转储保护。

## 严格输入

JSON上限64KiB，未知字段、重复字段、大小写别名、非对象、额外JSON值、null及错误类型均拒绝。readOnly必须为布尔true。maxBytes必须为十进制JSON整数，范围1–1048576，不接受字符串、小数、指数或隐式转换。

必须字段：endpoint、bucket、region、accessKeyId、secretAccessKey、key、maxBytes、readOnly。prefix和sessionToken可省略，默认空字符串；字段拼写精确。字符串不修剪、不折叠大小写或归一化；无效UTF-8/孤立UTF-16代理转义拒绝，合法Unicode保持对象身份。配置、桶、区域、键和凭据其余要求仍由已验收底层模块检查。

每个已注册处理器只允许一个在途请求，不排队，占用时429且不读取本次输入或发起探测。入站仍受现有服务10秒读取限制；出站自开始探测起6秒context上限，继承请求取消及现有生命周期上下文。底层GET继续拒绝重定向、重试、不可信TLS、不支持响应编码、部分/超限正文。

## 响应

全部响应为JSON `{code,message,data}`，Cache-Control:no-store、nosniff。仅完整成功返回HTTP200、code0和ProbeResult（outcome/readable、HTTPStatus、acceptedBytes）；不返回正文、ETag、键、端点、Authorization或凭据。上游读取失败为422、probe-not-readable和脱敏分类，守卫错误400/403/405/413/415/429/503的数据为空。未知错误原文和部分成功摘要不透传。

403/404不证明密钥有效或错误；公开可读对象成功不验证请求凭据，也不证明List/write、manifest有效或同步完成。取消/超时、网络/TLS、重定向、超限和正文拒绝沿用ProbeRead分类。HTTP guard通过不是S3预检通过。

## 实现与验收

标准库处理器与GoFrame注册分离。绑定使用已固定GoFrame v2.7.4的 `Response.BufferWriter`（保留状态、响应缓冲和外部生命周期），不直接RawWriter绕过框架；将r.GetCtx传给标准库Request，不用Parse/GetJson预先读取或改写JSON。controller测试通过真正Register和临时GoFrame监听端口，验证成功、浏览器拒绝、无意图头、查询拒绝和生命周期取消。测试只用临时loopback服务器与合成凭据，不访问用户桶或数据库。

新增15项syncs3顶层测试；原42项保持。独立标准库首轮race测试为57顶层、374含子测试通过事件（两数不可相加）；GoFrame控制器集成1顶层/6子场景已加入完整后端测试，当前容器无项目依赖，不能报其已执行。最终本轮日志与当前提交实际CI另记，不凭此文档宣布阶段通过。

新HEAD须完成原8PR、push完整UI/Windows、独立Desktop、同树PR测试、双平台UI/实际服务/原生/桌面/安装包，以及源码绑定完整后端产物的独立核验。尤其确认controller实际集成及全部S3用例，不用旧绿灯或本地标准库测试代替。正常运行的CI不取消重跑。无依赖/lock、数据库、原WebDAV、保存/草稿/引用/退出逻辑改动。
