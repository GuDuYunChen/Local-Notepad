# 2F.65 / 4.198.0 — 本地概览前端会话与 React 绑定

## 基线和历史复查

基线071d88f48da4d3dda2f0c6ee2ad1d02a363932f2，tree37f97ca62b0e9ad94fdf5f62116a32c53f1e3524，应用4.197.0，最终验收6075140759有效。原46条问题及12类执行事故分别复核，catalog只检查关联，不计测试。保存、草稿、退出和版本基线91项通过，未发现需重做的上一阶段阻塞。不重复旧发布、错误候选或成功CI。

## 交付范围

新增createS3LocalOverviewBinding和useS3LocalOverview。只有明确read({readOnly:true})才调用固定原生方法s3LocalOverviewRead；构造、订阅、挂载、StrictMode回放和revision变化均不隐式读取。原生入口缺失直接给固定拒绝，不走浏览器HTTP。结果复用既有codec白名单重新校验、复制并递归冻结，只保留数量/容量，CompleteForPreview=false。

binding先占槽再进行反射或通知，重复操作不读取输入、不覆盖当前显示。10秒绝对等待截止在调用前、返回校验前后均检查；超时或invalidate只撤销显示资格，不能冒称底层I/O已取消。原生Promise未结算前保留槽位，包括同一binding的disconnect/connect回放；不排队、重试、持久化或缓存。新的binding不能代替主进程自身的连接close保护。

连接租约及不可复用的epoch区分A→B→A；通知后、返回Promise边界再次核对结果资格。关闭、参数变更、迟到成功/失败、读取期间重入和观察者异常均有测试。所有错误使用固定文案、null统计，不转发异常、getter或私密原文。

React通过useSyncExternalStore使用稳定快照，useLayoutEffect只在提交后激活revision令牌。已保存的旧read/invalidate在版本切换后拒绝，不影响新上下文；被Suspense放弃的渲染不能撤销当前可见页面。编辑事件应同步invalidate，再提交非秘密revision变化。

本阶段交付可复用会话及hook，不注册生产Go路由或main/preload入口，不接设置页；不是完整S3同步上线，也不在真实用户库上执行盘点。宿主接线的权限、资源生命周期和界面触发仍属后续范围。原HTTP、原生桥及所有既有保存/退出行为保持。

## 本地验证与版本

新42项共享Node/Vitest绑定回归全部通过，与原预览/作用域/保存/版本共303项Node回归通过，0失败/跳过。三份独立错误副本分别取消结果采用复核、提前释放槽位、跳过返回白名单，被原断言拒绝；错误副本仅在隔离目录。React专项测试保留StrictMode、revision、取消、卸载、超时及Suspense情形，须由新HEAD完整UI运行，不冒称已在本地无依赖环境执行。

按新功能显式运行version:minor，4.197.0→4.198.0，提交前previous-version检查通过。三个应用版本一致，679依赖节点/resolved/integrity及schema14不变；不修改旧测试、断言、工作流、保存/Ctrl+S/队列回执/草稿/引用/退出保护。

源码从已挂载归档与精确交付文件恢复，Git索引树与当前基线一致；5个未改动Go/说明文件仅以已知Git blob身份进入索引，没有假称本地完整Go检出或测试。普通Git一次读取DNS失败后停止；不提取凭据或改代理。新hook测试生成首次辅助断言过宽，在写文件前停止，纠正的是生成器精确标识检查，不是删除测试。原失败观察另存日志。

## 验收要求

本文为提交前事实快照。须核当前HEAD原工作流、同树PR、四份完整UI且新增绑定/hook实际执行、实际服务、双Electron、完整Go、Windows桌面/品牌/原生及真正4.198.0安装包内部版本。最终状态写PR #2和交付，不为状态再次提交源码。

仅feature/knowledge-os-phase2 / Draft PR #2，不合master、不强推、不打tag或生产发布、不操作真实用户数据/桶，不新建Work/Codex或自动任务。既有临时PR只用于完整锁对象装配，辅助历史不进入产品并关闭未合并。聊天断流及外部故障不能由本次交付宣称根治。
