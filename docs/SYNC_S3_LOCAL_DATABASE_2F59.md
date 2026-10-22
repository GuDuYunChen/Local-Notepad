# Phase 2F.59 — SQLite 一致只读数据库快照

基线9898e9955256a1511b92cf338bdeee65234e4fc5/tree08cf177f0c7592500eb0ed7a5786bb2080854498，2F58.1验收6034328733有效。真实PR/ref及接续记录一致，原5项拒绝契约复查通过，无新复现阻塞。历史46问题、12助手事故和全部旧失败记录复用，不重做415修补或上轮CI。

## 能力与完整性边界

新增ReadS3LocalDatabaseSnapshot(ctx, db, limits)，使用一个自有SQLite只读事务读取files、tags、file_tags、sync_state的共同基线身份及sync_base。三类数据库记录包含文件夹、回收站、置顶与原时间/排序字段；复用原Record编码及严格记录/关系校验。不会调用会创建和扫描uploads目录的旧localRecordsWith，不打开文件路径、不读取附件正文、不联网，不初始化状态或写数据。

返回S3LocalDatabaseSnapshot是私密内部数据，不是IPC摘要，也不是完整S3PlanRecordBasis。DatabaseRecords仅覆盖数据库三类对象，CompleteForPreview始终false；即使数据库为空，也不能据此认定本地附件为空。StoredRemoteStoreID/Revision只描述现有sync_base的归属，不是独立可信S3 pin，不能自动把WebDAV共同基线重新绑定成S3。仍须另行解决完整附件依据和可信pin，不能将本阶段结果直接挂生产设置页或当作purge许可。

一个只读/serializable事务保证所有查询在相同数据库读取上下文，不用分页接口或多次池化查询拼接。只接受schema14和read_uncommitted=0；不支持的驱动选项直接拒绝，不回退弱隔离，不改调用者DB连接池/PRAGMA配置。只执行固定SELECT及读PRAGMA，结束前Rollback，不调用Commit，不关闭借用DB。SQLite快照是读取时点的数据，不保证返回后仍是最新状态；数据库驱动必须支持事务和context语义。

## 边界、失败与预算

显式预算：三类记录合计1..128，共同基线另1..128，单记录1..256KiB、规范编码累计1..1MiB。每表LIMIT剩余额度+1检测超额，不悄悄截断；每个文本字段在SELECT中限制UTF-8字节后再Scan，不把超大正文直接带回应用。NULL、无效UTF-8、非法布尔标志、重复ID/基线、无效hash、孤儿/循环/重名均固定拒绝；原关系校验无远端回退。记录编码后的膨胀也计入预算。字段拒绝与无效记录共用固定错误，不泄露数据库错误文本。

整个事务/查询/编码/结构检查共用5秒或更早caller截止。任何查询、Scan、迭代、Rows.Close、Rollback、校验或取消失败均返回零快照，不交付部分map；context取消保持标准sentinel。预算不是SQLite引擎/运行时总内存保证，也不承诺逐CPU指令终止不配合的驱动。结果不缓存，修改返回map不影响数据库或下次读取。

没有HTTP/IPC路由、生产SettingsPanel接入、凭据表单/持久化、provider/apply、数据库写入、附件读取、上传删除或自动同步。代码只增加读取能力，实际执行仅在自有合成测试数据库；不读取用户真实库。自动保存、Ctrl+S、保存队列回执、草稿、引用、退出保护、4.195.1/schema14及原依赖锁不变。

## 实际测试与独立验收

新增标准库database/sql驱动契约测试9顶层/61通过事件，本地Go1.23.2在自有最小模块逐字节复制生产代码，定向-race通过。测试驱动为合成数据，不冒称真实SQLite；覆盖事务选项、7次固定查询、自有Rollback、快照分离、空数据库范围、全部预算/负面输入、所有资源失败、取消和关系反例。删除超额拒绝、删除关系校验的两个独立错误实现被同一新断言拒绝，未入提交，不是产品现场事故。

另加5项真实SQLite顶层测试（含11子场景），使用项目原modernc驱动和自有testDB：只读URI实际拒绝UPDATE；WAL写者在读取files后提交，新快照仍读到同一旧时点的tags/base，下一次显式读取看到新提交；SQL文本预算/规范膨胀/总额超限零结果；schema、隔离和损坏记录拒绝；无自动迁移、无借用DB关闭。观察连接仅插入写者时序，所有SQL结果和事务由原驱动产生。须由当前HEAD完整后端原报告实际运行，不以本地合成驱动替代。

本地原binding24/session83/preview125/保护202/scope63/bridge100/HTTP19/stage62通过；catalog/lock只是结构检查。原HTTP内27Go probe检查含于一个顶层用例，不额外加算。本地未安装npm或下载Go模块/工具链，真实GoFrame模块不改。本地真实SQLite测试尚未执行，后续当前HEAD原CI才是其证明。

完成必须当前HEAD17CI、四UI/19实际服务、双Electron、源码绑定Go1.24.11完整后端及全部新旧测试、PR测试同树、品牌/原生/桌面/NSIS独立核验。旧UI2595/Electron406保持；新后端预计1528+77=1605，127份Go/锁源码，数量仅待核目标。源码完成不是ACCEPTED；未全部通过不进入2F60，不删原测试/断言/工作流/验收器，不造状态-only提交。

仅feature/knowledge-os-phase2 / Draft PR2，master不改不合、不强推、不生产发布。历史归档和当轮独立反例分开，平台投递问题不与产品测试混同，不承诺永不中断。

参考：本轮查阅Go database/sql的BeginTx/Rollback（https://pkg.go.dev/database/sql）和SQLite事务隔离说明（https://www.sqlite.org/isolation.html）。采用项目固定工具链，不以线上文档较新版本引入依赖升级；实际驱动行为仍需原CI测试。

## 同阶段 Windows 只读 URI 夹具修补

eb4496a首提交的PR Windows保存回归在完整UI2595/2595之后，于完整Go测试失败，后续实际服务步骤没有执行。原失败ZIP11473495522及新失败job112723503461的原始输出已实际取得；唯一本阶段失败名为TestS3LocalDatabaseSQLiteReadOnlyAndCanonical，公开固定错误出现在第83行。Linux完整1605通过不能覆盖Windows失败。

独立复现原URL.String构造：Windows盘符路径D:/...成为file://D:/...，D:被解析成authority，而非本地盘符路径。SQLite要求盘符前置/。只修测试的URI构造，新增跨平台形状用例在所有runner验证空authority、精确路径、特殊字符转义和唯一mode=ro；旧构造被同一断言拒绝，修后本地通过。真实只读连接的原全部断言保留，仍须在Windows重新执行实际SQLite及禁止UPDATE验证。产品读取器、原SQL/安全错误、WAL断言、全部旧用例、工作流和门槛不变，未删除或跳过失败测试。

新增URI检查1顶层（内部5种路径不另累计），修补后完整后端待核1606通过事件/128份Go与锁文件；新本地数据库范围合计15顶层/78事件。现有9顶层61事件+5真实SQLite顶层16事件保留，不重复累计。必须修补HEAD完整17CI及原产物通过再验收，不能用首提交绿灯。SQLite URI依据https://www.sqlite.org/uri.html#the_uri_path。
