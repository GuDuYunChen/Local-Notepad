# 开发接续点

## 当前阶段

当前候选 **Phase 2F.38.1：S3响应编码重复字段漏检修补**，见 `SYNC_S3_ENCODING_GUARD_2F38_1.md`。仍在 GuDuYunChen/Local-Notepad 的 `feature/knowledge-os-phase2` / Draft PR #2，不合master、不发布生产；产品4.195.1/schema14不变。

基线4e3cebae1b99a80f48c5c30306b286b0bb8034ba / tree6ce3a2f21f27789aebdcb4f5e8bf6e3b8745b864的2F.38未完成独立验收。复查用原生产transport和loopback服务器发现SREAD-01：首行identity或空值遮住后续gzip声明，错误返回编码字节。先修补全部同名字段检查并保留红绿回归，未开始2F.39；不能把基线CI绿灯当作新缺陷不存在。当前候选20顶层Go测试（含子测试92通过事件）、race及vet通过不替代新HEAD全后端/Windows/原始产物验收。

2F.37/TEST-08已在4580f5c完成独立验收，见PR评论5952627874，不再重做旧修补。2F.38仍是未注册的独立S3只读基础，无设置UI、新路由、凭据持久化、List、写入删除或自动同步；既有WebDAV/正文保存/退出保护未修改。GitHub full_access由用户通过正式权限设置明确授权，实际是否写入以回执和远端HEAD为准。

新HEAD必须完成8PR、push完整UI/Windows打包、独立Desktop、PR测试树身份和原始UI/服务/原生/桌面/安装包核验，并确认完整后端go test ./...执行新增syncs3回归；上一阶段修补完整验收前不进入2F.39。

## 中断恢复

先读远程HEAD及PR，区分源码完成、当前提交CI通过、产物独立核验三个检查点。聊天没有最终输出不等于Git写入失败；写入没有回执先读取目标，不重复推送。不得按过期标题或历史文档重做已有阶段。

至少核对八条PR流程、push完整UI/Windows打包及独立桌面流程；PR测试合并的文件树要与实际分支核对。产物按ID、提交、平台和摘要选择，完整原始UI报告不能用身份小文件代替。只查询待完成项，不连续展开大响应或下载旧产物。

## 已知问题和助手执行失误

`KNOWN_ISSUES.md`及机器索引保留45条产品/环境/测试问题（36历史修复、3缓解、6持续或待验收）；`ASSISTANT_EXECUTION_INCIDENTS.md`单独保留12类助手执行错误，不混作聊天故障根因。各轮具体操作失误保留于 `EXECUTION_NOTE_2F30.md` 至 `EXECUTION_NOTE_2F38_1.md`，不能把失败调用写成通过。

遵守 `STAGE_REVIEW_PROTOCOL.md`：同run检查至少间隔90秒，30次连接器调用前检查预算；长日志留文件，关键节点短交代。每个故障链最多一次有新证据的手工重试；工具安全拒绝不绕过。这些措施减少重复工作，不保证ChatGPT平台不中断。

## 构建与产品边界

使用 `npm ci --no-audit --no-fund`，保留完整package-lock。先执行 `node scripts/verify-dependency-lock.mjs`，依赖更新同时评审manifest和lock，不用npm install回退。`node scripts/stage-review.mjs catalog`只验证索引关系，不运行回归；CI快照全部绿色也仍需产物核验。

不擅自修改自动保存、Ctrl+S、保存回执/队列、引用维护或退出保护；章节结构变化暂停自动保存的旧规则已废止。测试使用隔离数据，不冒充用户现场。原生脚本和应用保存错误、npm下载故障、工具拒绝、聊天流中断分开判断。

升级前备份工作区和未确认正文；不要用4.189.0打开schema14。源码归档恢复不是clone成功；本地保留的测试依赖不是新执行npm ci。最终Windows/Go和完整UI结果以当前提交的实际CI与原始报告为准。

## 手动与小时任务

手动关键节点只更新既有小时任务prompt，不暂停、重建、重排或另开并行运行；确认HEAD、源码推送、CI变化和验收分别接续。提示中的进行中标记不是原子锁，更新和推送前核对实际HEAD；写入不明先读取，不覆盖其他执行者。权限偏好不覆盖独立安全检查，遇新拒绝停止相关动作、不换路径绕过。
