# Phase 2F.50 — 有界记录与附件完整只读快照

基线 `37a4a76af78bdcfca4f0af1198edd5a34a39acfd` / tree `157b75837255f3d2c56ea6ee6640c1ba164acae0`，2F.49最终验收5998171414。先实际读取PR、任务和验收归档，恢复999份源码同树，复查没有新的已复现上一阶段阻塞。沿已确认的S3兼容只读路线，将整组记录与其中present附件的完整内容组合为一次有界读取，不注册provider或触碰本地真实数据。

## 实际交付

新增 `ReadS3Snapshot(ctx, client, S3ManifestReference, S3SnapshotReadLimits)`。在本调用内部先复用原ReadS3RecordSet完成清单、全部记录及既有关系规则检查，再从已验证的present附件元数据建立完整blob计划。相同内容hash只读取一次，多个附件名字仍各自保留记录；共享同一hash但声明不同大小会拒绝整个快照。数量、单blob与累计声明预算均在任何blob GET之前核完，不接受调用者修改的RecordSet/AttachmentPayload作为读取权限。

随后按hash字节顺序复用原GetVerifiedObject读 `blobs/<hash>`，每个内容必须同时满足SHA-256和准确大小，全部完成才返回 `S3Snapshot{RecordSet,Blobs}`。任何清单、记录、关系、预算、blob内容、HTTP或取消错误均返回零快照，不交付前面成功的记录或附件。purged附件只保留记录状态，不发blob GET；present零字节附件也必须实际读取并验证，404不能变成空附件。只读返回不是本地初始化、安装或删除许可。

不重复清单/记录读取，不按附件名字猜键，不使用ETag/远端checksum替代已验证摘要，不做自动重试、回退、latest/List/HEAD发现或回调。单次最多 `1 + Records.MaxRecords + MaxBlobs` 个签名GET，共享15秒或更短调用者截止；原下层派生context不能延长这一截止。各读取阶段、计划循环及交付前核对取消。

## 有界资源和返回值约定

原Records预算保持：最多1024条，单清单/记录1..32MiB，记录原始JSON总额1..64MiB。新增BlobBytes为1..32MiB，TotalBlobBytes为**不同hash的已验证blob字节总额**1..64MiB，MaxBlobs为1..1024；没有附件也须显式有效预算。共享同一hash按一次计数/计大小，而非按名字重复计算。预检使用剩余值扣减，避免巨大声明相加溢出。

blob GET的上限缩小到已验证声明大小；空对象因原GetObject要求正限额而使用1字节上限，但只有0字节能被接受。原读取器可在失败时读有限的超限哨兵字节，预算不是“失败网络从不多读一个字节”的承诺。成功输入上限最多清单32MiB+记录64MiB+不同blob64MiB，并非整个进程内存上限，JSON对象/map/运行时另需内存。

返回快照含私密正文、附件名和二进制内容，**不是脱敏IPC摘要或不可变授权**。Blobs以hash为键，同一内容只保存一个slice；调用方可变Go对象不被全局缓存或用于后续调用的可信依据。后续调用重新读取并验证。没有内存安全擦除保证。

## 明确不做的事情

没有文件安装、数据库/同步状态写入、apply授权、provider、可见S3设置界面、配置/凭据持久化、上传删除、自动同步或真实桶访问。没有新增正文内引用解析、附件解压或脚本执行；完整快照仅指钉定清单列出的记录和present附件blob，不声称所有正文链接目标存在，也不证明该代次最新。

pin必须来自独立可信来源，摘要/关系/大小校验不等于来源认证、凭据有效、归属、新鲜度或写/List权限。公开意图头不是认证，前端停止等待不等于原生I/O取消，不称完整S3同步。原ReadS3RecordSet、Attachment、Record、Manifest、GetVerifiedObject以及原HTTP/IPC/renderer语义逐字节不变。

## 发布前实际验证

新增独立 `s3_snapshot_test.go`，11顶层/39通过事件：现有DirRemote blob格式和签名精确GET、四种记录与purged、hash去重与稳定顺序、空blob真实读取、非法预算/pin/context离线、所有blob预算和冲突元数据零blob请求、记录/关系错误阻断、晚期摘要/大小/HTTP/编码/短读失败零快照、零声明不能接受非空正文、真实blob GET取消/截止、返回值修改不影响下一调用、并发预算隔离。

本地Go1.23.2 linux/amd64在自有临时最小标准库模块逐字节复制相关生产与测试，用GOTOOLCHAIN=local/GOPROXY=off/GOSUMDB=off/GOWORK=off，无模块/工具链下载；定向 `-race -run ^TestReadS3Snapshot` 11/39通过。随后新Snapshot与原RecordSet/Attachment定向合跑35顶层/161事件通过（包含前述11/39，不累计两次）。未重跑已知耗时的旧大清单组合命令，完整GoFrame项目的go.mod/go.sum没有改动，也不把此范围称为完整后端/Windows验证。

两个隔离错误实现分别跳过blob总额检查和跳过最终大小核对，均被新原断言拒绝；不是上一阶段真实产品缺陷或用户数据泄露，没有进入提交。原Node保护202、S3三个入口63+100+11共174、stage-review62全通过；27内部Go检查计入HTTP中的一个顶层用例，不另累计。catalog/lock只是结构检查，不当应用测试；无clone/npm安装、依赖升级或真实桶。

## 当前HEAD验收门槛

源码完成、当前HEAD全部17CI和原始产物独立核验分别记录。必须八PR、完整push UI/Windows、独立Desktop、额外push SaveRecovery；四份完整UI2296/19、双Electron261、PR测试同树、Go1.24.11完整后端/S3/controller、新Go11实际执行/旧用例无删除、原生/桌面/未签名NSIS独立核验。原Go1206+39=预计1245、115份Go/锁绑定，只是核对目标，不能用预期数字或旧绿灯认定通过。最终状态写PR/交付，不造状态-only源码提交，本阶段完整验收前不进入2F.51。

仅feature/knowledge-os-phase2 / Draft PR #2，不改或合master、不强推/生产发布/操作真实数据。产品4.195.1/schema14、保存/Ctrl+S/队列回执/草稿/引用/退出保护、原生产/测试/断言/CI/验收器和锁保持。46问题及12助手事故索引原样保留，本轮具体执行纠正另存交付，不把产品验收说成ChatGPT投递超时根因已修。

官方协议依据（本轮查阅，不引入新依赖）：
- https://pkg.go.dev/context#WithTimeout
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html


## 同阶段 Windows 原生品牌夹具修补

中断接续后，真实HEAD cfd6105的push UI run37341829499 / Windows job111872626937
在品牌主题渲染检查45秒超时。原可读job日志确认：loadFile尚未完成时watchdog退出，
随后ERR_FAILED；两张PNG都没有生成，后续原生/packagedApp/NSIS上传被跳过。
后端1245通过事件和PR成功不能覆盖此失败。保留选定原日志逐行转录与步骤回执，
没有将转录称为完整原日志文件，也没有无依据手工重跑该job。

复查确认该夹具原先没有隔离Electron默认userData/sessionData，且超时时无可恢复的
阶段报告。使用真实脚本顶层、模拟Electron生命周期的两个反例，原实现0/2，修后2/2；
这只是同步控制契约，不是复现Windows内部启动卡顿。此次**不能证明**原超时由哪个
Chromium内部等待、缓存或操作系统事件造成，也没有将日志中的Windows路径展示形式
擅自认定为原因。

修补只为这份测试创建独立临时userData/sessionData，在whenReady之前设置；不读取、
迁移、清除调用者默认用户目录。临时profile仅为测试所有，退出后由runner临时目录
清理，不承诺安全擦除。原loadFile、show:false、sandbox/contextIsolation/nodeIntegration、
全部20个原深色断言、hover/focus/light三项检查、两份原PNG捕获保持；未关闭沙盒、
改产品样式或把45秒预算放宽。完整成功仍须23项检查、两张实际PNG及其摘要/尺寸。

新增有限阶段报告checks.json，记录ready/资源/窗口/页面加载/字体/两次捕获/回切；
主frame加载失败、renderer退出、超时、报告写失败均失败退出，一次失败不可被迟到
成功覆盖。没有重试页面加载或重放检查。原always上传步骤仅增加checks.json路径，
不改变后续步骤条件、原测试选择、并发或超时。实际新Windows运行若仍失败，必须
依据新阶段报告继续修补，不能因为增加了诊断代码便判定原阻塞已通过。

独立新增12项Node/Vitest生命周期回归，真实默认目录隔离使用自有临时路径，
其余为明确模拟进程/计时器的契约检查，不冒充GUI。预期完整UI2308、Electron273
（旧2296/261各加12），Go1245保持；这些只是验收目标，必须最终HEAD原报告证明。
本次修补不改已发布S3快照生产实现、任何保存/回执/队列/引用/退出/schema14/依赖。
本阶段仍须完整新HEAD CI及原始产物接受；不进入2F.51。
