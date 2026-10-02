# 开发接续点

## 当前阶段

当前候选 **Phase 2F.37：离线历史文件按记录精确限定**，见 `SYNC_HISTORY_FILE_RECORD_FILTER_2F37.md`。仍在 GuDuYunChen/Local-Notepad 的 `feature/knowledge-os-phase2` / Draft PR #2，不合 master；产品4.195.1/schema14不变。

基线5ed5b5219bb73f9d3739062df3733b6a65773665/tree 242a85f902c9844ef596c50ed8209344ac7821d6 的2F.36已完成独立验收：八条PR流程、push完整UI/Windows打包、独立桌面、PR测试树、双平台1963/1963完整UI与19/19实际服务、原生3布局21帧及每布局4项对象限定观察、桌面8检查/5PNG和Windows安装包均已按提交/产物/摘要核对。最终PR评论再次被工具安全策略拒绝，未绕过；远程PR描述因此仍停留在2F.35。2F.28–2F.36既有能力不重复开发。2F.37新HEAD仍须独立验收，源码文档不是绿灯证明，验收前不进入2F.38。

## 中断恢复

先读远程HEAD及PR，区分源码完成、当前提交CI通过、产物独立核验三个检查点。聊天没有最终输出不等于Git写入失败；写入没有回执先读取目标，不重复推送。不得按过期标题或历史文档重做已有阶段。

至少核对八条PR流程、push完整UI/Windows打包及独立桌面流程；PR测试合并的文件树要与实际分支核对。产物按ID、提交、平台和摘要选择，完整原始UI报告不能用身份小文件代替。只查询待完成项，不连续展开大响应或下载旧产物。

## 已知问题和助手执行失误

`KNOWN_ISSUES.md`及机器索引保留43条产品/环境/测试问题；`ASSISTANT_EXECUTION_INCIDENTS.md`单独保留12类助手执行错误，不混作聊天故障根因。各轮具体操作失误保留于 `EXECUTION_NOTE_2F30.md` 至 `EXECUTION_NOTE_2F36.md`，不能把失败调用写成通过。

遵守 `STAGE_REVIEW_PROTOCOL.md`：同run检查至少间隔90秒，30次连接器调用前检查预算；长日志留文件，关键节点短交代。每个故障链最多一次有新证据的手工重试；工具安全拒绝不绕过。这些措施减少重复工作，不保证ChatGPT平台不中断。

## 构建与产品边界

使用 `npm ci --no-audit --no-fund`，保留完整package-lock。先执行 `node scripts/verify-dependency-lock.mjs`，依赖更新同时评审manifest和lock，不用npm install回退。`node scripts/stage-review.mjs catalog`只验证索引关系，不运行回归；CI快照全部绿色也仍需产物核验。

不擅自修改自动保存、Ctrl+S、保存回执/队列、引用维护或退出保护；章节结构变化暂停自动保存的旧规则已废止。测试使用隔离数据，不冒充用户现场。原生脚本和应用保存错误、npm下载故障、工具拒绝、聊天流中断分开判断。

升级前备份工作区和未确认正文；不要用4.189.0打开schema14。源码归档恢复不是clone成功；本地保留的测试依赖不是新执行npm ci。最终Windows/Go和完整UI结果以当前提交的实际CI与原始报告为准。
