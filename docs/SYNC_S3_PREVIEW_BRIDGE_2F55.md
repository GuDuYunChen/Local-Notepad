# Phase 2F.55 — 受主窗口生命周期约束的原生 S3 预览桥

基线 `316060674c72315a2fbc59b515c7a7b8e6622de0` / tree `1e723f72bbd0caadbd054e7015a949207dee514e`，完整验收6020109507保持。先读真实PR/ref及历史46问题、12助手事故，复查原HTTP11顶层/131事件完成，无新复现产品阻塞；不重做旧路由或原Go读取链路。

## 完整的本阶段能力

`electronAPI.s3PreviewRead(payload)`只暴露一个显式invoke，通道`sync:s3-preview:read`；不暴露原始ipcRenderer或任意URL/headers/timeout。main注册单实例服务及独立的原`createS3ProbeScope`，精确要求当前主窗口webContents、主frame、固定应用URL及未进入退出状态。原probe拥有自己的slot不变。导航/reload/崩溃/销毁/关闭及before-quit取消preview；返回前再次核对同一lease，替换窗口不能接收旧成功。新增before-quit监听放在注册旁，只取消preview，不改变原保存退出门禁。

生产服务固定POST `http://127.0.0.1:27121/api/sync/s3/preview`，不依赖renderer的API_BASE，不接受转向/代理/浏览器fetch回退。公开意图`s3-preview`与原probe分开，敏感参数只在JSON正文中，固定no-store/Connection:close、独立http ClientRequest。最多2MiB请求、16KiB响应、16KiB响应头，7.5秒单调绝对截止从参数反射前开始，包含编码/网络/解析；慢滴和被阻塞事件循环之后的迟到成功拒绝。不宣称能逐CPU指令中止恶意Proxy或限制整个IPC结构化克隆的峰值内存。

先保留并发槽再检查任何输入属性，避免旧Proxy重入事故；忙时不排队或反射新payload。直接调用的getter/Proxy异常固定拒绝。停止等待后销毁自己的HTTP请求/响应，但**直到ClientRequest实际close才放开slot**，成功end也不提前放开。没有close不能伪造已清理。原文和分块在完成时去引用，不承诺安全内存擦除。

## 请求和响应契约

新codec逐层只复制普通对象/null原型的自有可枚举数据属性，拒绝getter、符号、未知字段、数组/类型不符和无效Unicode；不执行toJSON，不trim或正规化传输字符串。五组字段和八预算与2F54对应；pin generation必须是JS正安全整数，不截断Go int64。连接字符串在本桥限制16KiB，Go配置/凭据政策仍为最终权威。本地映射按显式数量/UTF8单条和总字节上限预检，完整JSON再核2MiB。Record JSON保留为不可变字符串，由原Go严格解析/规范hash/关系检查，不另造不一致的JS记录解析器。

响应必须完整、UTF8严格解码、无BOM、重复字段（含转义别名）或深度歧义。以rawHeaders检查重复Content-Type/Content-Length、冲突分帧、任何Content-Encoding/Trailer及真实trailer；不接受部分JSON或非200的成功包装。成功只采纳固定format/version/read_only/counts/kinds，固定四kind顺序，所有计数是非负安全整数且不超过本次maxItems，各行分类和总行逐列均吻合。重新构造并递归冻结，绝不透传后端附加ID/正文/凭据。

错误只允许原HTTP状态与固定message精确配对，data必须null；未知/矛盾输出成为native-preview-invalid-response。传输错误/取消/截止为固定本机分类，不透传异常字符串。403/404或任意统计均不证明凭据有效、写/List权限、来源认证或同步完成。统计仍是粗粒度活动信息，不是公开遥测。

**这是原生IPC入口，不是可见S3设置界面或已接好的输入表单。** 尚未使用原probe的renderer hook去伪装preview；未来preview调用者仍须在输入变化/离开上下文时抑制旧结果。主frame校验约束该IPC，不把Go公开意图头声称为进程认证。没有数据库扫描写入、blob、provider/apply、设置/凭据持久化、上传删除、自动同步或真实桶；完整本地依据/基线/pin由调用者可靠提供，候选计数和purge不授权真实数据修改。

## 实测与独立反例

125项新增Node/Vitest共享用例覆盖请求层层反射/映射/预算、精确响应/四类和冲突计数、固定POST、Promise与ClientRequest分离收尾、Proxy重入、绝对截止、迟到事件、rawHeaders/UTF8/JSON、原scope身份与导航、main注册与preload的真实源码VM执行。VM是合成Electron对象，不冒称真实Electron GUI交互。

另8项真实固定回环HTTP用例：完整敏感请求仅body、精确错误、拒绝redirect、截断、慢滴、IPC导航取消传到真实ClientRequest。复用原整组HTTP单监听器及自有请求/socket/timer清理，只给其run增加测试用serviceFactory参数；默认还是原probe工厂，旧HTTP用例文件和所有断言逐字节不变。新用例在原Go测试之前同一串行入口执行，不增加竞争监听器或改端口/bind重试。组合HTTP为原11+新增8=19，其中原Go顶层的27内部检查不重复累计；这些27仍是probe契约，不冒充新的preview→Go整链路。新preview网络端是合成本机HTTP响应，原真实GoFrame preview路由和引擎在完整后端另行验证。

发布前首次新增共享125/125、真实HTTP19/19（含旧Go27）、原scope63/bridge100、原保护202、原stage-review62通过。故意省略分组总和核对及返回前窗口复核的两份隔离错误实现分别被原新增断言拒绝，未入提交，非用户数据事故。catalog/lock只做结构校验。新生产/测试JS语法、原保护路径及完整patch同树独立核对后才发布。

基线首次组合命令外层90秒中断，原11/131各用例输出虽完成但无package终态/退出回执，未计为完整通过；确认自有进程已结束后，单独定向同测试取得退出0和11/131完整结果，首部分日志保留。无clone/npm安装/模块工具链下载。没有改旧测试或延长其门槛。

## 完成门槛

源码发布与完整验收分开。当前HEAD仍须八PR、完整push UI/Windows、独立Desktop及额外pushSave；四完整UI/19实际服务、双Electron、同树PR测试、Go1.24.11源码绑定完整后端/原S3/preview及probe controller、品牌/原生/桌面/NSIS独立核验。新增125+8共133应实际执行；预期UI2441（2308+133）、Electron406（273+133），Go1528不变，以原报告为准，不能用目标数/旧绿灯宣布通过。未验收前不进入2F56。

仅feature/knowledge-os-phase2 / Draft PR2，不改合master/强推/生产发布或操作真实数据。产品4.195.1/schema14、原保存/Ctrl+S/队列回执/草稿/引用/退出、依赖及所有原测试/断言/CI/验收器保持。原main/preload只加新入口，不重写旧桥或共享trustedMainFrame；不恢复结构变化暂停保存。最终状态写PR和交付，不造状态-only源码提交。

本轮查阅Electron官方IPC sender校验/隔离建议：https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages 。Node22 HTTP文档本轮web路由不可访问，不声称已查阅该页或据此升级依赖；ClientRequest行为用本轮真实Node测试核对。历史46问题/12助手事故及具体执行失误单列留存，不把产品修补称为ChatGPT投递超时根因已修。

## 同阶段 Windows 测试夹具修补

第一提交b8240e0688ca95fd91a8c00795a61744eee0f234的push Discard run37497822890/Windows job112386806563在完整UI中2440/2441，新增preload VM用例报“Cannot use import statement outside a module”。原弃稿、真实App保存/退出专项已通过，不能用这些绿灯覆盖完整UI失败。原包11429185554和原失败报告保留，没有取消或重跑该CI。

原新测试使用`/^import .*\n/`删除开头import再送VM，不能匹配CRLF行尾。用当前同一生产preload源码只替换换行生成CRLF输入，原同名断言复现相同SyntaxError；这不是取回CI生产preload的原字节（失败归档只保留测试源，未包含该生产文件）。现只修本阶段新增测试的准备步骤，按`[^\r\n]*\r?\n`删除首行，并在同一原用例中显式执行LF与CRLF两种文本。原所有invoke/无隐式请求/无通用IPC断言保留，额外确认import已去除；不改生产preload、桥、Go、工作流或Git换行设置。原同名CRLF反例修后通过，新增共享125全部通过。两种换行属于同一个顶层测试，不虚增数量。

当前阶段仍需修补HEAD全部CI/原产物重新验收，不用第一提交绿灯替代。新共享仍125、真实HTTP新增8，完整UI目标2441/Electron406/后端1528不变；尚未进入2F56。
