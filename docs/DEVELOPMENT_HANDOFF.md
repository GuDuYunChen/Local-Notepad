# 开发接续点

## 当前阶段

当前候选 **Phase 2F.43：S3只读预检React生命周期绑定**，见`SYNC_S3_REACT_LIFETIME_2F43.md`。沿用feature/knowledge-os-phase2 / Draft PR #2，产品4.195.1/schema14不变，不合master或发布生产。

已验收基线`da46e76cef821273d50807f114513bcf9de83e11` / tree`59a44f3d263c124844b2a9d6c7f38b5263ab7f76`，2F.42验收评论5981504611。前阶段2247双平台完整UI、19实际服务、258独立Electron及原生/桌面/后端/NSIS已完成；不重跑旧CI、不因候选文档旧措辞推翻其验收。2F.41验收5981057926、2F.40验收5978940337继续有效。

本候选新增useS3ReadProbe及可观察绑定，原renderer会话不变。React已提交挂载建立会话，StrictMode重放不复用disposed会话；非敏感输入revision变化/显式invalidate使旧结果失效，卸载关闭所属会话。只在read才调用原生桥，不自动探测、不持久化凭据，不新增设置UI/provider/List/写删/自动同步。

新候选复查发现3个原生settle后、绑定消费前失效仍回传成功的反例，21/24失败证据保留；本轮已修补通知前后所属生命周期/epoch核对，原断言不改。新绑定24+原renderer98+原保存退出80合跑202/202，原S3 Node171/171通过。12项实际React挂载测试发布前仅语法核对，须新HEAD完整Vitest实际执行；不拿Node结果冒充React/Windows/真实GUI。

源码完成、当前HEAD完整CI和原始产物独立验收分别记录；未全过不得进入2F.44。原46问题/12助手事故、保存/回执/草稿/引用/退出及schema保护均保留。最终状态以最新PR及实际HEAD为准，不为验收文字再造源码提交。

## 2F.43 当前修补检查点

首次发布5bcbe35虽有PR双平台2283/19通过，但push SaveRecovery37213791978的Linux原报告两个HTTP回环在27121绑定失败，不能覆盖或宣布验收。本轮已针对夹具未等待自有ClientRequest关闭的确定反例补修，原8/9失败与修后9/9证据保留。仅测试helper/HTTP所有权跟踪及阶段文档变更，生产hook/绑定/session/main/Go与保存/退出不变；无端口重试、外部进程终止。原202项绑定/renderer/保存退出复测及172项S3通过。完整17CI和额外push SaveRecovery原始双平台报告也须绑定修补后的最终HEAD；预期完整UI2284、Electron259（新增1项），不沿用5bc成功。详见本阶段协议附录。

## 中断恢复

先读远程HEAD及PR，区分源码完成、当前提交CI通过、产物独立核验三个检查点。聊天没有最终输出不等于Git写入失败；写入没有回执先读取目标，不重复推送。不得按过期标题或历史文档重做已有阶段。

至少核对八条PR流程、push完整UI/Windows打包及独立桌面流程；PR测试合并的文件树要与实际分支核对。产物按ID、提交、平台和摘要选择，完整原始UI报告不能用身份小文件代替。只查询待完成项，不连续展开大响应或下载旧产物。

## 已知问题和助手执行失误

`KNOWN_ISSUES.md`及机器索引保留46条产品/环境/测试问题（38历史修复、3缓解、5持续或外部）；`ASSISTANT_EXECUTION_INCIDENTS.md`单独保留12类助手执行错误，不混作聊天故障根因。各轮具体操作失误保留于 `EXECUTION_NOTE_2F30.md` 至 `EXECUTION_NOTE_2F40.md`，不能把失败调用写成通过。

遵守 `STAGE_REVIEW_PROTOCOL.md`：同run检查至少间隔90秒，30次连接器调用前检查预算；长日志留文件，关键节点短交代。每个故障链最多一次有新证据的手工重试；工具安全拒绝不绕过。这些措施减少重复工作，不保证ChatGPT平台不中断。

## 构建与产品边界

使用 `npm ci --no-audit --no-fund`，保留完整package-lock。先执行 `node scripts/verify-dependency-lock.mjs`，依赖更新同时评审manifest和lock，不用npm install回退。`node scripts/stage-review.mjs catalog`只验证索引关系，不运行回归；CI快照全部绿色也仍需产物核验。

不擅自修改自动保存、Ctrl+S、保存回执/队列、引用维护或退出保护；章节结构变化暂停自动保存的旧规则已废止。测试使用隔离数据，不冒充用户现场。原生脚本和应用保存错误、npm下载故障、工具拒绝、聊天流中断分开判断。

升级前备份工作区和未确认正文；不要用4.189.0打开schema14。源码归档恢复不是clone成功；本地保留的测试依赖不是新执行npm ci。最终Windows/Go和完整UI结果以当前提交的实际CI与原始报告为准。

## 手动与小时任务

手动关键节点只更新既有小时任务prompt，不暂停、重建、重排或另开并行运行；确认HEAD、源码推送、CI变化和验收分别接续。提示中的进行中标记不是原子锁，更新和推送前核对实际HEAD；写入不明先读取，不覆盖其他执行者。权限偏好不覆盖独立安全检查，遇新拒绝停止相关动作、不换路径绕过。

## 2F.41已验收的保护不得回退

保留原桥精确页面/主窗口主frame、生命周期取消、7.5秒绝对截止及请求close前持有并发槽；保留Windows synthetic path修正和测试自有socket有界收尾。Go标准库夹具只能逐字节复制三份原生产文件，在独立临时目录module-off、GOTOOLCHAIN=local运行，不把完整GoFrame项目改为module-off。

原生桥和renderer会话均不改变保存/退出门禁。旧403/404不能解释成密码错误或凭据通过；只读结果不等于完整S3同步。旧阶段详细事实见2F.41协议、ELECTRON_TEST_EVIDENCE_2F41.md及验收评论5981057926，源码文档中的发布前候选措辞只作历史。
