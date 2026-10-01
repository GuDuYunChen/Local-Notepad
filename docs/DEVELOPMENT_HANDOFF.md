# 开发接续点

## 当前阶段

仓库 GuDuYunChen/Local-Notepad，分支 `feature/knowledge-os-phase2`，Draft PR #2。日常开发不合入 master。

本轮新增 **Phase 2F.32：离线文件首页、末页和直接跳页**，详情见 `SYNC_HISTORY_FILE_PAGINATION_2F32.md`。此前2F.28–2F.31的离线查看、全文件查找、概览和日期筛选均已存在，不重复开发。开发版本仍4.195.1、schema14；新功能按提交识别，旧同版本安装包不包含新提交。本文不是CI通过证明。

基线 `f8aae5d6f28e3344b815f0f9724bc41764de41c3` 的完整Windows job110357359008已成功，上轮原始报告和安装包已验收，没有遗留构建；本轮读取确认后不重跑。新HEAD必须独立验收，结果写PR或交付记录，不为验收状态再提交源码触发整套CI。

## 中断恢复

先读远程HEAD及PR，区分源码完成、当前提交CI通过、产物独立核验三个检查点。聊天没有最终输出不等于Git写入失败；写入没有回执先读取目标，不重复推送。不得按过期标题或历史文档重做已有阶段。

至少核对八条PR流程、push完整UI/Windows打包及独立桌面流程；PR测试合并的文件树要与实际分支核对。产物按ID、提交、平台和摘要选择，完整原始UI报告不能用身份小文件代替。只查询待完成项，不连续展开大响应或下载旧产物。

## 已知问题和助手执行失误

`KNOWN_ISSUES.md`及机器索引保留42条产品/环境问题；`ASSISTANT_EXECUTION_INCIDENTS.md`单独保留12类助手执行错误，不混作聊天故障根因。各轮具体操作失误保留于 `EXECUTION_NOTE_2F30.md`、`EXECUTION_NOTE_2F31.md`、`EXECUTION_NOTE_2F32.md`，不能把失败调用写成通过。

遵守 `STAGE_REVIEW_PROTOCOL.md`：同run检查至少间隔90秒，30次连接器调用前检查预算；长日志留文件，关键节点短交代。每个故障链最多一次有新证据的手工重试；工具安全拒绝不绕过。这些措施减少重复工作，不保证ChatGPT平台不中断。

## 构建与产品边界

使用 `npm ci --no-audit --no-fund`，保留完整package-lock。先执行 `node scripts/verify-dependency-lock.mjs`，依赖更新同时评审manifest和lock，不用npm install回退。`node scripts/stage-review.mjs catalog`只验证索引关系，不运行回归；CI快照全部绿色也仍需产物核验。

不擅自修改自动保存、Ctrl+S、保存回执/队列、引用维护或退出保护；章节结构变化暂停自动保存的旧规则已废止。测试使用隔离数据，不冒充用户现场。原生脚本和应用保存错误、npm下载故障、工具拒绝、聊天流中断分开判断。

升级前备份工作区和未确认正文；不要用4.189.0打开schema14。源码归档恢复不是clone成功；本地保留的测试依赖不是新执行npm ci。最终Windows/Go和完整UI结果以当前提交的实际CI与原始报告为准。
