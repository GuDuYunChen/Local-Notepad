# Phase 2F.41 — S3 只读预检 Electron 原生桥（本地整合候选）

基线 `e31216608e5e119e2c2013146b7c2460f19d1cb6` / tree `a65bd58bdea253a81c3185289020d3d7f86593a2`，2F.40 已按 PR #2 评论5978940337完整验收。仅 feature/knowledge-os-phase2 / Draft PR #2，不合 master、不发布生产、不操作真实用户数据。产品4.195.1、schema14及依赖锁不变。

## 当前状态

`LOCAL_INTEGRATED_VERIFIED_REMOTE_PENDING`：已从原六文件候选与四文件scope补充实际取回源码，整合并修正本地反例；不是只根据摘要重新实现。远端尚未提交此候选，没有2F.41新HEAD的CI或原产物验收。原候选的工具写入拒绝记录保留，本地修改和测试并不解除该限制。

## 一次明确的只读调用

preload 仅增加 `electronAPI.s3ProbeRead(payload)` → `sync:s3-probe:read`，不暴露通用request、目标URL、header或同步启动API。main使用Node http.request固定POST `http://127.0.0.1:27121/api/sync/s3/probe`，凭据只在本机JSON body，不进URL/query/header/日志。目标、计时器和预期页面由main确定，renderer不能更换。不要放宽2F.40的Origin/Referer/Sec-Fetch守卫以允许浏览器直连。

没有设置UI、配置/凭据持久化、provider注册、List/上传/删除/自动同步，不自动访问任何真实桶。主进程只发送本机HTTP，真正S3 GET仍由既有ProbeRead完成。本地测试均为合成数据和本机假服务，不是实际GoFrame或真实桶验证。

## 来源与生命周期

createS3ProbeScope与原桥合并使用：校验当前主窗口、WebContents、主frame以及main固定的精确页面。生产页面由pathToFileURL(app.getAppPath()/dist/index.html)生成；开发页面为精确http://localhost:5000/。拒绝其他本地HTML、其他frame、远程页面、userinfo/query、销毁状态和原生getter异常。允许应用fragment但导航事件使旧lease失效。

导航/reload、render-process-gone、webContents销毁、原生close/closed、退出或7.5秒截止取消当前probe；返回结果前再次mayDeliver检查，旧文档不能收到旧成功数据。scope取消不提前释放底层并发槽。main的before-quit附加监听只取消可选probe，原save/quit gate、prepare/receipt/失败保留窗口逻辑逐字节保留；不调整已有共享trustedMainFrame谓词的其他用途。

## 输入与响应边界

输入快照只读取普通对象自有可枚举数据描述符，拒绝访问器、symbol、未知/缺失字段、toJSON、错误类型、孤立UTF16代理及超限JSON；maxBytes为1..1048576安全整数、readOnly必须true、JSON最多64KiB。不trim、归一化或改写对象键/凭据。

传输采用7.5秒绝对计时器而非socket-idle超时，slow-drip不能延长截止；单并发无队列，早期拒绝会销毁response/request，ClientRequest close之前不开放新请求。输入/原生异常只返回固定错误，不透传原始message。

响应最多64KiB，保留rawHeaders识别重复/空Content-Encoding及重复Content-Type/Length；要求JSON/UTF8、正文完整、Content-Length对应、无trailers、无重复JSON键，code/message/data字段精确。HTTP状态与message、ProbeOutcome及底层httpStatus组合按现有Go契约校验；成功acceptedBytes不能超过本次maxBytes，失败必须零部分字节。只返回success/status/code及outcome/httpStatus/acceptedBytes，未知字段、端点、键、ETag、正文或凭据都不会透传。

临时JSON/凭据由运行时内存管理，不承诺安全擦除内存。

这是本机原生进程受信任的有限桥，不是多用户身份认证、也不是对已被攻陷的可信renderer进行隔离。意图头公开；本机服务身份没有新增认证。403/404或可读对象不能证明凭据有效，也不推断List/写权限；本阶段不是完整S3同步。

## 本地验证及剩余门槛

在Node22.16.0执行scope63项、transport/IPC/main/preload合成组合100项、真实Node HTTP回环6项，最终169/169通过、0失败/跳过。63属于补充模块原用例，计入169不能重复相加；6项真实HTTP包括固定POST与无浏览器头、403/404、绝对截止、截断和导航取消，未运行真实Electron窗口或GoFrame。

原保存/退出/草稿Node66项及明确放弃Node14项，最终80/80通过。首次候选额外before-quit监听放置过早，导致原退出源码切片夹具3项失败；已移动新监听至probe注册处，原退出函数/夹具/断言均未改，66项复测全部通过。依赖锁首次校验命令cwd错误已保留，改为真实source目录后原校验通过，未修改锁或安装依赖。

保留原桥7项Vitest测试（只补齐fake IncomingMessage complete/close、适配scope并增强取消断言），并提供scope及组合/回环Vitest入口。此环境没有安装Vitest/Electron，未执行这些Vitest入口、React/完整应用、Go1.24.11或Windows。不能用169/80本地Node结果代替新HEAD完整CI和原产物验收。

将来正常发布完整候选后，仍须八PR、push完整UI/Windows、独立Desktop、同树PR测试合并、完整UI/实际服务、源码绑定后端及全部S3/controller、原生/桌面/安装包独立核验。原验证器不改、不删测试降门槛，完成前不进入2F.42。

## 当前候选补齐：真实 Node → Go 标准库预检契约

同一2F.41新增 `scripts/s3-probe-backend-cases.mjs` 与 `scripts/fixtures/s3-probe-backend/main.go`。在临时目录逐字节复制已验收的3份syncs3生产Go文件（read_client/read_probe/read_probe_http），仅用本地Go标准库编译；GOTOOLCHAIN=local、GO111MODULE=off、GOWORK=off、GOPROXY=off、GOSUMDB=off，不下载Go工具链或模块，不修改server源码。夹具ErrorLog写io.Discard，不创建文件日志；stdin关闭后有界Shutdown，父进程只管理自己启动的子进程。

测试经真实Node请求到未修改的Go ReadProbeHandler，再到本机临时合成S3：核对Unicode对象路径、单次签名GET、成功字节、403/404/302/500分类、不重定向/重试、超限/编码响应、Go配置/凭据/键拒绝、浏览器来源守卫，以及导航取消传到真实Go出站GET。另验证27121被本测试哨兵占用时夹具启动拒绝，向占用者请求数为0，不终止占用者。结果15项内部契约检查集中在1个集成测试中，不另加成15个顶层测试。原6项Node HTTP回环保留，此入口7项；与scope63、组合100共170个不同顶层用例。

同一个HTTP测试入口串行注册，避免多个Vitest文件同时抢固定27121；跨语言测试显式120秒预算，构建90秒上限，启动5秒上限，子进程20秒保护和2秒优雅关闭。端口已被外部进程占用会失败退出，不连接、停止或改用该进程。无外部真实桶和用户数据。

这项实际验证是Node IPC合成事件及Go标准库handler链路，**不是GoFrame适配层或真实Electron/Windows实测**。已有7项Vitest及新wrapper仍未执行。2F.41远端未提交、完整新HEAD CI/原产物验收未执行的状态没有改变，不能因本地跨语言测试通过绕过独立写入拒绝。
