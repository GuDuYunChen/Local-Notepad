# Phase 2F.56 — 前端原生只读预览会话

基线 ddb322b0e0bf3c98ef86deede5abaeace3ebe9f8 / tree ff6ea4e0bd6d888311a9cb2ee11a8126a6df84db，2F.55完整验收6029118874继续保留。先核真实PR/ref及历史46问题、12助手事故，原preview共享125复查通过，无新复现阻塞。本阶段只补前端预览会话，不重做原生桥、旧换行修补或后端。

## 实际能力

通过现有services/api.js无网络副作用地导出createS3PreviewSession，提供read、snapshot、invalidate、dispose。导入、创建和读取快照不发请求；只有显式read才调用既有electronAPI.s3PreviewRead一次。没有api()/fetch回退、通用IPC、重试队列、存储或数据库访问。

主进程和前端复用原s3-preview-codec：仅将UTF-8字节计数改为标准TextEncoder，不复制或放宽请求/统计契约。原输入Unicode完整性拒绝仍先执行，不让编码替换孤立代理项。原五组字段及2MiB/记录预算、精确字符串和本次maxItems保持；JSON正文再解析成独立IPC数据快照，不持有调用方可变映射。Go仍是记录规范编码、关系、可信依据及出站连接政策的最终权威。

原生返回值先按有界深度、节点数、数组长度和自有可枚举数据属性复制，拒绝getter/toJSON/符号、非普通原型、稀疏数组、附加数组键或循环；然后复用原完整状态配对及四类统计行列总和验证。不采纳外加身份/正文/错误详情，结果重建并递归冻结。只有白名单代码和固定中文提示进入快照，失败零summary。候选统计不代表同步完成、凭据有效或写入/删除权限。

会话在输入反射之前占用slot，并保持到原生Promise真正settle，包含返回值反射/验证期间。忙时不读取第二份payload。invalidate/dispose和10秒最大前端等待只撤销结果采用，不声称取消原生I/O；即使前端已停止等待，原生未返回仍不放开会话slot。主进程仍独立保持ClientRequest实际close门禁，两个层次不能混为一谈。

反射、序列化、桥发现和回复解析共用单调绝对等待预算；定时器没机会执行时，前后deadline核对仍拒绝迟到成功。每次明确读/失效都会替换代际；A→B→A不能复活旧成功，原生settlement与消费者微任务之间再次核对代际。dispose永久关闭当前会话，晚到返回值不再反射。结果已经被调用方取走后无法远程撤回，调用者仍须约束自己的后续异步操作。

## 范围边界

这是前端服务层，不是React生命周期hook、订阅绑定或可见输入表单。未来调用者必须在输入/本地依据/pin变化时同步invalidate，离开上下文时dispose，且不能保留旧确认闭包去发起一项新的read；不能拿旧probe hook冒充preview绑定。getBridge/时钟/调度选项仅供可信本地调用或测试，不是允许renderer修改主进程网络配置的接口。

无数据库扫描或写入、配置凭据持久化、附件blob、provider/apply、上传删除、自动同步或真实桶。pin及完整本地依据仍须可靠提供；公开意图头不是认证。没有安全内存擦除、总进程内存上限或逐CPU指令中止恶意Proxy的承诺。不改变自动保存、Ctrl+S、保存队列/回执、草稿、引用、退出保护、schema14或依赖。

## 发布前真实验证

83项新增Node/Vitest共享测试首轮全部通过，包括精确快照/Unicode和字节预算、每层请求/回复getter零执行、计数校验及本次maxItems、固定失败、缺桥零回退、Proxy反射重入、A→B→A、超时后持槽、卸载晚到、settlement微任务失效、三阶段绝对截止、同步timer、并发隔离和空统计。子进程移除Buffer并将fetch设为失败后，实际导入新session与共享codec并完成一次合成原生调用；它不是实际浏览器或Electron GUI测试。

原共享preview125、保护202、scope63、probe bridge100、组合HTTP19及原stage-review62分别通过。HTTP单个Go顶层用例内27契约不额外累计；catalog/lock仅结构检查，testsExecuted=false不当应用测试。原HTTP单监听器和Windows LF/CRLF用例保持。未clone、npm安装、下载Go模块/工具链或操作真实数据。

两份故意错误实现分别删除消费者微任务代际复核、绕过统计校验，均被同一新增断言拒绝；不是上一阶段生产缺陷或用户数据事故。原产品测试与断言不改。具体执行准备失误单列交付，不伪造缺失stderr。

## 完成门槛

源码完成、当前HEAD的17CI、原始产物独立验收分别记录。必须八PR、完整push UI/Windows、Desktop和额外pushSave；四完整UI/19实际服务、双Electron、PR测试同树、源码绑定Go1.24.11后端/S3/controller、品牌/原生/桌面/NSIS独立核验。新83必须实际执行，预计UI2524、Electron406、后端1528，最终只认原报告而不是预期数量。保留所有旧用例/断言/工作流/验收器，不用ddb旧绿灯代替。

仅feature/knowledge-os-phase2 / Draft PR2，不改或合master、强推、生产发布。未完整验收前不进入2F.57；最终状态写PR和交付，不追加状态-only源码提交。历史46问题/12助手事故和更早证据保留，不把产品验收说成ChatGPT投递超时根因已修。

编码依据：WHATWG Encoding Standard的TextEncoder接口（https://encoding.spec.whatwg.org/#interface-textencoder），本轮实际查阅；与Node字节计数的兼容性另有当前测试，而非仅凭文档推断。
