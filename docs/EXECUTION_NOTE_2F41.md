# 2F.41 候选整合与本地复查

## 已取回的真实输入

原六文件候选ZIP SHA256 `f12b23688b7c63be561da7f882f6437312f0f7d8885a5736bbf2680205a43324`、scope补充ZIP SHA256 `f9a52f44abf771544362e7cfdf62ee3277cdfe662d5cb70fb17b4c3f31ba834d`。本轮两者实际挂载可读，摘要/CRC一致；原补丁先check再应用，未从摘要重造。已挂载当前CI source11298923085重建948文件基线a65bd58，非clone，未重下旧包或安装依赖。

## 未发布原候选的六个本地反例

1. 空Content-Encoding被当作没有编码，接收为成功。
2. 403响应携带message=OK仍被接收。
3. 成功acceptedBytes超过本次maxBytes仍被接收。
4. 拒绝Content-Type后只resume而未销毁，请求未结束就释放slot，允许第二次调用。
5. 原IPC仅核主frame身份且只监听destroyed，导航后的旧成功仍返回。
6. 恶意对象反射getter/proxy异常令Promise拒绝，未转成固定错误。

这些为原2F.41未发布候选反例，不是用户现场泄露、不推翻2F.40，也不重复增加全局46问题编号。日志original-six-contract-failures.json保留。修补沿用同一bridge及scope，在最终169项Node中有对应回归；不删除原测试。

## 本轮执行纠正

新before-quit监听初次放在主文件顶部，原editor-quit.node源码切片会从第一个before-quit取至后端注释，意外纳入createWindow等无关代码，导致3项VM回归失败。已将仅取消probe的新监听放到probe注册旁，原before-quit处理函数逐字节不变，旧夹具和断言均未改；原66项保存回归复测全通过。保留首次63pass/3fail日志及最终66pass日志，不能将首次失败删去或当成2F.40旧故障。

首次执行verify-dependency-lock命令cwd为交付父目录，退出1；改为source目录后退出0，679锁条目，原manifest/lock未变；这是既有EXEC-04调用前提风险，非新的依赖缺陷。没有改锁或npm-install回退。

本轮source/index仅独立本地树，无本地commit；Git差异和补丁核验均显式比较a65bd58。所有旧错误证据和46问题/12助手事故保留，不承诺平台不中断。

## 限定结果

此前整合轮Node169/169、保存退出80/80通过（本轮新增跨语言契约后170/170，另重新执行保存退出80/80）；原7项Vitest与新增Vitest wrapper只经过语法/源码核对，未作为已执行Vitest；没有真实Electron/Windows/GoFrame或新HEAD CI。真实Node HTTP只用了合成127.0.0.1服务。全部新候选仍未远端提交或整阶段验收，不开始下一阶段。

此前原候选create_blob被安全检查拒绝；本轮没有新的解除证据，没有GitHub源码/PR写入或重复试写，不切换写接口/账号/代理/执行器。任务保持启用，关键进度只更新prompt；远端限制未变不能把本地候选当已完成发布。

## 当前候选补齐：真实 Node → Go 标准库预检契约

同一2F.41新增 `scripts/s3-probe-backend-cases.mjs` 与 `scripts/fixtures/s3-probe-backend/main.go`。在临时目录逐字节复制已验收的3份syncs3生产Go文件（read_client/read_probe/read_probe_http），仅用本地Go标准库编译；GOTOOLCHAIN=local、GO111MODULE=off、GOWORK=off、GOPROXY=off、GOSUMDB=off，不下载Go工具链或模块，不修改server源码。夹具ErrorLog写io.Discard，不创建文件日志；stdin关闭后有界Shutdown，父进程只管理自己启动的子进程。

测试经真实Node请求到未修改的Go ReadProbeHandler，再到本机临时合成S3：核对Unicode对象路径、单次签名GET、成功字节、403/404/302/500分类、不重定向/重试、超限/编码响应、Go配置/凭据/键拒绝、浏览器来源守卫，以及导航取消传到真实Go出站GET。另验证27121被本测试哨兵占用时夹具启动拒绝，向占用者请求数为0，不终止占用者。结果15项内部契约检查集中在1个集成测试中，不另加成15个顶层测试。原6项Node HTTP回环保留，此入口7项；与scope63、组合100共170个不同顶层用例。

同一个HTTP测试入口串行注册，避免多个Vitest文件同时抢固定27121；跨语言测试显式120秒预算，构建90秒上限，启动5秒上限，子进程20秒保护和2秒优雅关闭。端口已被外部进程占用会失败退出，不连接、停止或改用该进程。无外部真实桶和用户数据。

这项实际验证是Node IPC合成事件及Go标准库handler链路，**不是GoFrame适配层或真实Electron/Windows实测**。已有7项Vitest及新wrapper仍未执行。2F.41远端未提交、完整新HEAD CI/原产物验收未执行的状态没有改变，不能因本地跨语言测试通过绕过独立写入拒绝。

## Windows 跨平台测试夹具修正

发布前复查发现 `scripts/s3-probe-bridge-cases.mjs` 的 packaged 页面钉定测试把 `app.getAppPath()` 合成为 POSIX 绝对路径并写死 `file:///synthetic%20app/...` 期望值。生产代码本身使用宿主平台 `path.join` 与 `pathToFileURL`，但该测试在 Windows 上会把不合法的 POSIX 风格 app path 交给 `path.win32`，可能造成与真实 Windows `app.getAppPath()` 不同的 URL，从而产生测试夹具假失败。

现改为从当前宿主根目录用 `path.join(path.parse(process.cwd()).root, ...)` 生成合法的本机绝对 synthetic app path，并用 `pathToFileURL(path.join(...))` 计算宿主对应的预期 URL。生产 `main.js`、桥、scope、preload 字节均未因该修正改变；Linux 当前宿主仍执行同一页面钉定断言，Windows CI 将使用 Windows 路径语义执行。该修正只消除跨平台夹具假设，不把 Linux 运行冒充 Windows 实测。
