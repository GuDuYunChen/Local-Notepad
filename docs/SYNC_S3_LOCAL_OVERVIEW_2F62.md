# Phase 2F.62 — 本地只读候选的无身份概览

基线0f20eaf5e7f41e61ecb1ad2ee3b89763dbcbff5e/tree0588e478e55bb7aeec71b5e699eb9bf50957e426，2F61验收6041276622有效。真实PR/ref与最新任务一致；已恢复1064原源码SHA/Gitblob及117文件完整验收包，读取AGENTS、HANDOFF、46问题和12助手事故与阶段协议。无新的已复现前阶段产品阻塞，不重跑旧CI。

## 本阶段能力

新增ReadS3LocalOverview，直接调用已验收ReadS3LocalCandidate取得自己的D1/A1/D2/A2结果，再形成不含身份和正文的本地数量概览。公开函数不接受外部拼接的candidate，不将调用者提供的计数当作依据。不再进行额外数据库或文件观察；读取、清理、解码与计数共用5秒或更早caller截止。

固定结果包含format/version、只读标识、已观察一致标识、始终false的complete_for_preview、记录总量/规范JSON总字节、附件总字节、基线条目数和四个固定种类行。每行只有kind/records/record_bytes。file含目录与回收站文件；attachment是附件元数据，正文总字节按附件名称相加，不去重为不同blob数量。没有上传/下载/purge计数、动作按钮、远端身份/版本、对象名/路径、正文、hash、凭据或任意错误文本。

内部投影在返回统计前重新验证稳定/不完整标识、所有原组件和联合预算、身份/基线格式、严格Record JSON及原规范编码字节、present状态、完整关系图与附件字节总和。原读取器应该只生成规范记录；若内部结果不满足约定，必须拒绝而非“修正”数据以凑统计。所有失败返回零概览和固定错误/context sentinel，不能露出已累计的半份统计。

输出只用值字段和固定数组，不保留候选私密map/切片/指针；复制结果不会共享统计可变引用。JSON和fmt只包含上述固定字段，但粗粒度数量仍可能透露使用情况，不是可公开遥测。没有提供一个公开纯转换器让调用者伪造“已实读”的候选。

## 不能夸大的边界

这是本地盘点概览，不是原有S3远端计划统计，不授权同步或写删。ObservedStable不等于跨数据库/文件系统原子快照，CompleteForPreview始终false，空结果也不产生初始化/删除许可。没有建立独立可信pin或挂接生产SettingsPanel/HTTP/IPC；后续接入须另行完成真正的数据一致性及授权，不凭统计绕过它们。

所有实际读取仍仅由可信调用方显式发起，借入DB/root不关闭；没有缓存、轮询、隐式读取、重试、路径查找、DML、配置/凭据持久化、provider/apply、上传删除或真实桶。开发测试只使用自有临时数据。本阶段不操作真实用户文件或数据库。

## 当前真实本地验证

Go1.23.2自有标准库最小模块复制原生产包，GOTOOLCHAIN=local，GOPROXY/GOSUMDB/GOWORK=off，无下载。定向-race38顶层188通过事件：原30/143加新8/45，全部0fail。覆盖实际原读取器调用次数与清理、固定四类计数/JSON字段、Unicode规范字节、fmt/JSON无私密字段、空库存仍不完整、21种内部不变量反例、12种预算反例、取消/输入I/O前拒绝及观察漂移零统计。

单独go1.24集成用例使用原固定SQLite驱动mode=ro和真实os.Root，检查概览与拒绝UPDATE/保留正文/借入root存活；本地1.23没有执行它，必须新HEAD固定Go1.24.11 Linux/Windows完整后端证明。预计完整后端1738通过事件/141Go锁源码仅供核对，不是已执行证据。

去掉附件总字节一致性检查、去掉稳定/完整标识检查的两个独立错误副本，被相同新增断言拒绝。第二个副本初次用false||false代替条件被go vet阻止，未执行测试；仅纠正独立副本的构造为删除该条件后实际触发原测试失败，初stderr及两次记录保留。未改被验收生产源、测试断言、go vet或工作流。

原Node保护202、binding24/session83/preview125/scope63/bridge100/HTTP19/refusal5/stage62均通过；HTTP单例27probe及refusal单例18内部场景不重复累计。catalog/lock仅结构核对/testsExecuted=false，不是应用测试；没有npm安装/Go模块工具链下载，不将本地标准库当完整React/SQLite/os.Root/GoFrame/Windows。

## 发布及验收门禁

仅feature/knowledge-os-phase2 / Draft PR2。原所有生产/测试/工作流/断言/验收器/依赖锁不改，保存/Ctrl+S/队列回执/草稿/引用/退出/schema14/4.195.1保护保持。源码、当前HEAD17CI、原始产物独立验收和交付分开。八PR、完整pushUI/Windows、独立Desktop和额外pushSave、四UI2595/19实际服务、双Electron406、源码绑定Go1.24.11完整后端/S3/controller、新用例实际执行、PR测试同树、品牌/原生/桌面/NSIS仍全部要求。

不删用例、不加skip、不改门槛、不用0f20旧绿灯；当前完整通过才进入2F63，最终状态写PR/交付，不造状态-only提交。历史2F59原生helper超时、2F60前置模型超时及ChatGPT投递中断分别保持原因未知，不把一次成功写成根治。
