# Phase 2F.44.1 — 旧输入版本命令回调失效修补

基线 `6d662b9d46abd657324628571a31101eabd2e963` / tree `f718d9c9b533f55bebff4f09757814ece92108c7`，2F.44 当时的验收记录5985557594及全部历史证据保留。仅 feature/knowledge-os-phase2 / Draft PR #2，产品4.195.1/schema14不变。本轮先处理复查中新发现的既有hook边界问题，不进入2F.45或叠加新的功能面。

## 实际反例与影响

原 `useS3ReadProbe` 在每个revision中都直接返回同一个 `binding.read` 和 `binding.invalidate`。revision提交时虽会清除旧结果，但上一个版本保存的命令回调没有失效。因此，旧确认闭包在新版本提交之后仍可通过旧read启动一次读取，并把结果发布到当前版本；旧invalidate也能清掉新版本的成功结果或取消新版本的前端等待。A→B→A重复数值不能被当作同一代上下文。

本地使用隔离的同步hook生命周期模型加载原生产hook，三个原始断言均失败：旧read没有在参数反射之前拒绝、A→B→A后旧read复活、旧invalidate清除了新成功。该模型不是真实ReactDOM，失败也不是用户现场或真实桶访问。本轮独立测试文件新增的10个真实React/ReactDOM回归与原12项在当前HEAD完整CI中另行验收，不能用本地模型替代。

## 修补

每个渲染revision建立独立的不含参数的token；只有layout effect真正提交该revision后才将token标为可调用。read和invalidate捕获各自token，调用时先核对已提交身份；不匹配只返回固定、冻结、无摘要的 `stale-input`，在检查payload或发现原生桥之前结束。此拒绝不发布到当前binding，不抹掉当前成功/失败或pending状态。未挂载或已卸载仍返回disposed。

不在render期间写入已提交身份。被放弃/挂起的新render不能授权其命令，也不能提前撤销仍显示的已提交版本。普通同revision重渲染保持两个回调引用稳定；revision改变后两个引用都改变。真正卸载清理撤销身份，新挂载不会复活旧组件的回调。StrictMode沿用原connect/disconnect处理。

显式调用当前invalidate仍只使结果失效，不永久撤销同revision的当前read，也不声称原生I/O已取消。调用方仍应在输入变化时先invalidate、再更新非敏感revision；本修补不自动推断对象参数或监视尚不存在的设置表单。原session、binding、main、Go的并发/超时/取消规则不改。

## 回归范围与门槛

`src/hooks/useS3ReadProbe.commandScope.test.js`新增10项真实React测试覆盖：旧read零参数反射/零原生调用；A→B→A；旧invalidate不得清成功或取消新pending；完成后旧read不重放；回调仅在revision变化时换代；同revision显式失效后仍可主动重查；旧组件回调在新挂载后仍关闭；Suspense transition未提交命令拒绝且已提交命令不受影响；当前403解释不被旧命令覆盖。原12项与全部既有断言逐字节保留。

本地修补后三个同步模型反例通过，原绑定24+renderer98+保存/草稿/退出80合计202通过；原S3 Node172通过（单个Go用例内部27检查已包含，不重复累计）；原stage-review62通过。catalog/lock只做结构核对。本地未安装React/Vitest或项目依赖，不声称已在本机运行真实React或Windows。新HEAD预期完整UI2294（2284+10），Electron259不变，须核对PR/push×Windows/Linux四份完整用例多重集、实际服务19项、新22项hook测试实际执行及旧用例删除0。

发布前源码、提交后CI、原始产物独立验收分开记录。八PR、完整push UI/Windows、独立Desktop和额外push SaveRecovery均需通过；PR测试同树、Go1.24.11完整后端/S3/controller、原生/桌面/未签名NSIS独立核验门槛不变。最终验收写PR和交付，不为状态再造源码提交。

## 保护与证据

唯一生产变更为该hook；不改session/binding/HTTP桥/Go生产代码，不改自动保存、Ctrl+S、队列回执、草稿、引用、退出保护、schema14、依赖锁、原验收器或CI门槛。原46问题及12助手事故索引逐字节保留，本缺口及本轮反例单列本文件，不把候选验证或执行错误累加成新的全局问题数。无配置或凭据持久化、设置UI、provider/List/上传删除/自动同步或真实桶访问。403/404或对象可读不证明凭据有效或写/List权限。

同步模型原失败、修后输出、真实React新增测试及当前HEAD原始报告均保留。未获得平台内部错误码，不能把此次修补称为ChatGPT投递超时根因修复。

实现依据：React官方useRef文档禁止在render期间更新ref；Suspense文档说明transition可保留已显示的提交内容以及layout effect的清理/重建。
- https://react.dev/reference/react/useRef
- https://react.dev/reference/react/Suspense
