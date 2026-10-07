# Phase 2F.57 — React 只读预览生命周期与命令版本约束

基线 `13e9a0de077eae3cfeeb7696c99c3e2e88a11312` / tree `185ee18047c1a12625771bdc625015556b2b4c9a`。2F.56完整验收6030696180保留；原session83定向复查通过，未发现新的已复现阻塞。本阶段接上现有preview session，不重做codec、HTTP、原生桥或旧probe hook。

## 实际能力

新增 `createS3PreviewBinding` 和 `useS3Preview(revision)`，把现有session的等待、成功、失败、失效和关闭状态提供给React组件。订阅只发无参数通知，组件读取同一个冻结快照；没有状态变化时snapshot引用稳定。构造、连接、订阅、渲染和重渲染均不发原生调用，只有明确read才调用原session。

每次connect返回独立清理租约；清理先撤销旧owner，再关闭原session。旧清理不能关闭新owner，StrictMode setup/cleanup重放只创建新的离线session。断连read在检查参数之前固定拒绝。每个订阅拥有独立移除标识，重复注册同一函数不互相移除；通知中已取消的订阅不再调用，观察者异常不能变成读取Promise未处理拒绝。

binding在session反射输入前占用自己的等待标识，重复调用不覆盖等待视图。原session继续负责真实原生Promise的占用；前端超时后重试仍可能得到session-busy，不能假装原生I/O结束。收到结果后先通知，再在返回及消费者微任务中复核owner、输入代际和最新读取身份，观察者中的失效、断连或新read不能把旧ready交给调用者。所有校验与脱敏复用原session，binding不是另一份网络协议解析器。

hook使用useSyncExternalStore和layout effect。revision只能是非负安全整数，是不含秘密的输入/本地依据/pin上下文版本，不保存配置。每个渲染revision有独立token，只有layout提交后授权read/invalidate；A→B→A不复活旧回调。旧read在参数反射/原生发现前拒绝，旧invalidate不清除新结果或停止新等待。未提交的Suspense render不授权其命令，也不撤销仍显示的已提交版本；同revision普通重渲染保持命令引用稳定。卸载后旧回调永久关闭。

## 调用约定和范围

消费方在任何输入、可信本地依据或pin改变时更新revision；需要在延迟render之前停止采用结果时，在编辑处理器中同步调用当前invalidate。显式同revision invalidate仍允许当前命令再次主动预览；它不能自动识别调用方没有告知的输入变化。已经被外部调用者取走的结果不能远程撤回，调用者须约束其后续异步采用。

这是可复用React接入层，没有接入生产设置表单，也没有新增可见S3设置界面。新真实React测试中的窗口/原生入口仍是合成对象，不是实际Electron→Go→真实桶GUI全链路。没有数据库扫描写入、凭据配置持久化、blob读取、provider/apply、上传删除或自动同步。候选统计不是同步完成、凭据有效或写删许可；公开意图头不是认证。

所有旧生产文件、原测试/断言/工作流/验收器、package/lock、产品4.195.1/schema14及保存/Ctrl+S/队列回执/草稿/引用/退出规则保持。仅新增binding/hook及其测试、协议，更新HANDOFF。

## 发布前实际验证

24项新增共享Node/Vitest binding测试通过，覆盖离线构造/订阅/连接、快照稳定、断连零反射、同函数独立订阅、移除及抛错观察者、通知重入失效/断连/新read、消费者微任务、A→B→A、超时持槽、旧清理/晚到完成、完整固定失败与实例隔离。

18项新增真实React/ReactDOM测试单独保存，涵盖StrictMode、状态渲染、回调稳定、输入切换、旧命令、卸载、超时、缺桥零fetch、非法统计、拒绝分类和Suspense未提交render。当前本地没有项目依赖，未安装，不能将node --check或隔离同步hook模型当作真实React执行；必须由当前HEAD四份完整应用原报告实际证明。

本地独立同步hook模型3/3；去掉命令token检查的隔离错误hook使其中2项失败，去掉binding最终消费者核对的隔离错误实现使原定向断言失败。两者只在外部reviewers中，不入源码、非上一阶段真实故障或用户事故。保留原断言和失败输出。

原session83、preview125、保护202、scope63、bridge100、HTTP19和stage-review62均分别通过。原HTTP单个顶层Go用例含27内部probe检查，不额外累计。catalog/lock只结构检查，testsExecuted=false不当应用测试。无clone/npm安装/模块工具链下载/真实数据操作。

## 完成门槛

仅feature/knowledge-os-phase2 / Draft PR #2，不合master、强推或发布生产。源码、当前HEAD17CI、原产物独立验收分别记录；必须四份PR/push×Windows/Linux完整UI与19实际服务、双Electron、源码绑定Go1.24.11完整后端/S3/controller、品牌/原生/桌面/NSIS核验。42新增测试必须实际执行；预期UI2566、Electron406、Go1528只是检查目标，最终以真实原报告为准，不使用旧13e9绿灯。

最终验收写PR与交付，不为状态创建源码提交；未完整通过不进入2F.58。原46问题和12类助手事故及本轮具体执行纠正保持，不将项目验收说成ChatGPT投递超时根因已修。

参考：本轮读取React官方useSyncExternalStore、useLayoutEffect与StrictMode文档。遵循稳定快照、effect清理和提交后授权的约束；具体行为仍须本项目实际测试验证。
- https://react.dev/reference/react/useSyncExternalStore
- https://react.dev/reference/react/useLayoutEffect
- https://react.dev/reference/react/StrictMode
