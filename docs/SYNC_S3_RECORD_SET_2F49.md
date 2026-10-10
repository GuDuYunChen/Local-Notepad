# Phase 2F.49 — 有界整组记录读取与既有关系预检

基线 `4b9a32d00806b1050808e15b29325175ea6a4dde` / tree `eaa897355f988f2a20fad10071cb20c6eaabef12`，2F.48完整验收5997162499。复查未发现新的已复现上一阶段产品阻塞。沿既有只读路线把单条记录读取扩展为一个钉定版本的整组记录消费，不创建可写provider或重复实现已有HTTP/IPC桥。

## 能力和失败边界

新增 `ReadS3RecordSet(ctx, client, S3ManifestReference, S3RecordSetReadLimits)`。先复用ReadS3Manifest读一次并验证独立可信的清单pin，随后按ItemID原始字节排序，逐条GetVerifiedObject及decodeS3Record。只把已验证hash拼入objects路径，不按标题/ID猜文件名，不为每条记录重读清单，没有缓存、latest/List发现、回调或自动重试。只有全部记录与既有关系规则都通过后才返回 `S3RecordSet{Manifest,Records}`；任何错误均为零集合，不能交付先成功的半份记录。

预算全部显式：ManifestBytes和RecordBytes各1..32MiB，TotalRecordBytes为全部记录原始JSON字节之和（不含清单），范围1..64MiB；MaxRecords为1..1024。收到清单后先检查数量及所有键，超限/非法键零记录GET。每次读取限额取单记录上限和剩余总额的较小值，已用完时不发下一请求。最多1+MaxRecords次GET；读取/摘要/解析/关系检查共用15秒或更短调用者截止。最多96MiB成功输入不是整个进程内存上限；解析结构和Go运行时另需内存。

数量上限1024也限制原结构验证器最坏的深链遍历成本。关系检查复用原 `validateRemoteStructure`，完整本地cache含每个清单键，remote传nil以禁止回退I/O：父项须为present文件夹、无自引用/循环、未删除文件的同父目录标题不重复、标签名不重复、file-tag两端存在及种类正确，保留原回收站/purged语义。原验证器内部含私密诊断，调用层只返回固定ErrS3RecordSetStructure而不包装原错误。该CPU检查器没有逐步取消回调，检查前后核context，只有最后核对通过才交付；不承诺逐CPU指令打断。

空集合只有在清单真实读取、摘要及身份验证之后才可返回，并非本地初始化或删除许可。purged保留为记录状态，不执行删除。成功集合包含私密正文和可变Go map，不是脱敏IPC结果/不可变授权；后续调用重新读取，不接受调用者修改的集合为权威。

## 明确没有交付的范围

附件仅读取已验证元数据，不读取blob或证明其存在；正文内引用没有被额外解析。没有文件安装、数据库/同步状态更新、apply、provider注册、可见S3设置UI、凭据配置持久化、上传删除、自动同步或真实桶访问。现有单条Record/Attachment/Manifest API和旧保存/退出规则不改。符合既有关系规则也不代表允许应用到用户当前数据库。

pin须独立可信，版本为显式选择，不保证最新或来源认证。摘要匹配/403/404不证明凭据有效、归属或写/List权限。公开意图头不是认证，前端停止等待不等于原生I/O取消，不称完整S3同步。

## 发布前实际测试

新独立Go文件12顶层/49通过事件，复用原DirRemote序列化和pinnedClient临时服务器：一次清单/确定顺序/四种记录及purged；空集合；非法预算与pin离线；全键和数量预检；精确总字节/差一字节/剩余额耗尽/单条限额；后期摘要/身份/重复JSON/HTTP失败零集合；原父目录/循环/重名/标签关系规则；回收站语义；真实GET取消/共享截止；返回值修改与并发隔离。原所有测试/断言/工作流/验收器字节不变。

本地Go1.23.2独立标准库模块 `-race -run ^TestReadS3RecordSet` 实际12/49通过；原保护Node202、原S3三个入口63+100+11共174、原stage-review62通过。HTTP单个Go用例内27项不重复累计。故意跳过关系验证或总预算扣减的两个隔离错误实现被同一新断言拒绝，不是旧产品缺陷、不入提交。catalog/lock只检查结构，不当测试。

首次本地组合Go命令达到外层120秒预算，留下未完成的原大清单用例和部分JSON；没有Go失败事件也没有总退出回执，不能当完整通过或猜根因。核对自有进程已退出后分离新测试完成；没有改变原测试超时、断言或远端CI来处理执行安排问题。旧完整测试覆盖仍以新HEAD的完整Go1.24.11 CI原报告为准，本地没有安装React/GoFrame依赖、clone或模块/工具链下载。

## 发布后完成门槛

源码完成不等于验收。当前HEAD全部17CI、四份PR/push×Windows/Linux完整UI2296及实际服务19、双Electron261、PR测试同树、Go1.24.11完整后端/S3/controller、新12项实际执行、原生/桌面/NSIS必须独立核验。原Go1157+新49=预计1206，只是核对目标，不得拿预期或旧绿灯当结果；113份Go/锁绑定也须真实报告证实。最终状态写PR和交付，不造状态-only提交；阶段完成前不进入2F.50。

产品4.195.1/schema14和46问题/12助手事故保持，自动保存/Ctrl+S/队列回执/草稿/引用/退出保护不变，不恢复结构变化暂停自动保存，不删数据/迁移/依赖升级。仅原feature分支/Draft PR2，不改master/强推/生产发布或用户真实数据。

参考：Go context派生截止语义 https://pkg.go.dev/context#WithTimeout ；S3内容完整性 https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html 。不引入依赖或更换原工具链。
