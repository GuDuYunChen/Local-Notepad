# 已发现问题与防复发索引

本轮收录44条有仓库文档或本会话依据的问题/风险：历史已修复36条、已有缓解3条、持续或外部未解决5条。这不是44个新缺陷，也不是整个项目的穷尽清单。

基线：`a9a56ba` / 4.195.1。每项的详细防复发规则、来源和回归文件见 `quality/known-issues.json`。历史修复状态来自对应阶段记录，不冒充本轮重新执行；测试路径存在不等于测试通过。

## 不能恢复的旧规则

4.189.1之前“章节结构变化暂停自动保存/先引用确认”的设计已经废止。结构变化照常保存正文；引用维护独立；真正未确认写入继续保护退出。早期schema13文档不能作为把schema14数据库交给4.189.0的依据。

## 目录

| 编号／阶段 | 已发现问题 |
|---|---|
| SAVE-01 · 4.189.0 | [明确放弃后退出登记未释放，卸载又把草稿写回](EDITOR_EXIT_DISCARD_HOTFIX.md) |
| SAVE-02 · 4.189.0 | [撤销回原文仍被标脏，恢复草稿被误当作数据库基线](EDITOR_EXIT_DISCARD_HOTFIX.md) |
| SAVE-03 · 4.189.1 | [章节结构变化暂停自动保存，Ctrl+S被引用预检查阻塞](EDITOR_SAVE_RECOVERY_HOTFIX.md) |
| SAVE-04 · 4.189.1 | [超时或迟到请求不能证明回滚，可能重写更新正文](EDITOR_SAVE_RECOVERY_HOTFIX.md) |
| BACKUP-01 · 4.189.1 | [schema14迁移后便携包和备份检查仍使用13上限](EDITOR_SAVE_RECOVERY_HOTFIX.md) |
| SAVE-05 · 4.189.2 | [已保存旧缓存及250ms回调遮住数据库新正文](EDITOR_SAVE_REVIEW_41892.md) |
| SAVE-06 · 4.189.2 | [数据库冲突后反复提交同一个已拒绝请求](EDITOR_SAVE_REVIEW_41892.md) |
| SAVE-07 · 4.189.2 | [历史成功回执误判为当前数据库仍已保存](EDITOR_SAVE_REVIEW_41892.md) |
| SAVE-08 · 4.189.3 | [显式保留同正文绕过数据库再次比较](EDITOR_SAVE_DECISION_41893.md) |
| SAVE-09 · 4.189.3 | [离开编辑器后迟到的采用请求清除草稿](EDITOR_SAVE_DECISION_41893.md) |
| SAVE-10 · 4.189.3 | [采用失败提示藏在弹窗背后](EDITOR_SAVE_DECISION_41893.md) |
| SAVE-11 · 4.189.4 | [草稿过期不显示，但退出登记仍阻塞](EDITOR_DRAFT_RECOVERY_41894.md) |
| SAVE-12 · 4.189.4 | [重新打开时丢失原请求或替换编辑基线](EDITOR_DRAFT_RECOVERY_41894.md) |
| SAVE-13 · 4.189.4 | [关闭切换自动保存后快速切换漏写草稿](EDITOR_DRAFT_RECOVERY_41894.md) |
| SAVE-14 · 4.189.4 | [存储额度受限时磁盘旧缓存遮住内存新内容](EDITOR_DRAFT_RECOVERY_41894.md) |
| SAVE-15 · 4.189.5 | [加载占位空正文或交错旧GET覆盖真实草稿](EDITOR_LOAD_SAVE_LIFECYCLE_41895.md) |
| SAVE-16 · 4.189.5 | [卸载后后续队列继续发PUT](EDITOR_LOAD_SAVE_LIFECYCLE_41895.md) |
| SAVE-17 · 4.189.5 | [正文GET无限等待或接受错误笔记/正文类型](EDITOR_LOAD_SAVE_LIFECYCLE_41895.md) |
| SAVE-18 · 4.189.6 | [A→B→A最后请求被错误去重，数据库停在B](EDITOR_SAVE_QUEUE_41896.md) |
| SAVE-19 · 4.189.6 | [队尾未完成就显示已保存或清除退出登记](EDITOR_SAVE_QUEUE_41896.md) |
| SYNC-01 · 2F.13.1 | [浏览先行时旧确认闭包仍可进入冲突处理](SYNC_QUEUE_BROWSE_GUARD_2F13_1.md) |
| SYNC-02 · 2F.12.1 | [删除类型/对象键或附件名与编码身份不一致却未标风险](SYNC_CONFLICT_RISK_IDENTITY_2F12_1.md) |
| SYNC-03 · 2F.14.1 | [诊断白名单漏掉真实恢复状态，状态变化提示丢失](SYNC_DIAGNOSTIC_STATUS_2F14_1.md) |
| SYNC-04 · 2F.15.1 | [等待/旧状态标题遮住阻断警示和读取依据](SYNC_OVERVIEW_RETENTION_2F15_1.md) |
| HISTORY-01 · 4.190.1 | [中文候选提前筛选并在字符上限处截断](HISTORY_SEARCH_COMPOSITION_4_190_1.md) |
| HISTORY-02 · 4.191.1 | [条件A→B→A复活旧下载成功/失败提示](SYNC_HISTORY_EXPORT_FEEDBACK_4_191_1.md) |
| UI-01 · 2F.10 | [深色差异标题、当前位置或表头不清晰](SYNC_CONFLICT_DIFF_2F10.md) |
| UI-02 · 4.192.0 | [窄窗口概览过高，完整来源说明被挤出可视区](SYNC_HISTORY_SUMMARY_2F26.md) |
| TEST-01 · 2F.11.1 | [绿色CI/退出码0，但原生只跑一张图且complete:false](SYNC_QUEUE_RENDER_RECOVERY_2F11_1.md) |
| TEST-02 · 桌面验收 | [手写Lexical夹具被规范化产生意外脏状态](DESKTOP_SAVE_ACCEPTANCE.md) |
| TEST-03 · 桌面验收 | [关闭命令发送给Chromium辅助窗口而非主窗口](DESKTOP_SAVE_ACCEPTANCE.md) |
| TEST-04 · 4.190–4.194 | [旧测试把所有dt视作主色或禁止全部input](SYNC_HISTORY_SUMMARY_2F26.md) |
| TEST-05 · 4.194.0 | [截图边缘对齐/异步FileReader测试时序造成校验失败](SYNC_HISTORY_FILE_VIEWER_2F28.md) |
| TEST-06 · 4.195.0 | [错误期望清除筛选抹掉旧文件失败来源，误判组合结束事件](SYNC_HISTORY_FILE_SELECTION_2F29.md) |
| TEST-07 · 2F.33.1 | [原生排序测试未建立实际900高窗口，只有7帧而非21帧](SYNC_HISTORY_FILE_ORDER_VIEWPORT_2F33_1.md) |
| TEST-08 · 2F.37 | [零匹配证据错误要求0/0或1/1页；4580f5c已完成独立验收](EXECUTION_NOTE_2F37.md) |
| BUILD-01 · 4.195.1 | [npm electron-to-chromium@1.5.443下载404，测试尚未开始](DEVELOPMENT_HANDOFF.md) |
| ENV-01 · 环境相关 | [当前会话容器曾无法解析GitHub/npm，gh缺失](DEVELOPMENT_HANDOFF.md) |
| ENV-02 · 桌面首轮记录 | [PowerShell窗口查询曾ETIMEDOUT，同提交重试通过](DEVELOPMENT_HANDOFF.md) |
| TOOL-01 · 上轮工具回执 | [PR写入被工具安全状态检查拦截，远程标题未更新](DEVELOPMENT_HANDOFF.md) |
| CHAT-01 · 用户持续反馈 | [无法思考/流恢复超时/Failed to fetch反复中断](DEVELOPMENT_HANDOFF.md) |
| HANDOFF-01 · 本轮接续修补 | [PR标题落后，缺少最终聊天回复导致重复开发风险](DEVELOPMENT_HANDOFF.md) |
| LIMIT-01 · 持续边界 | [内存回退不能保证断电恢复；歧义引用/连续重构不自动猜测](EDITOR_SAVE_RECOVERY_HOTFIX.md) |
| EVIDENCE-01 · 本轮接续修补 | [PR专用检查、旧提交或只有身份的小文件被误当完整验收](DEVELOPMENT_HANDOFF.md) |

## 检查入口

执行 `node scripts/stage-review.mjs catalog` 检查索引关联完整性；它不运行回归，明确返回 `testsExecuted:false`。恢复和有限重试规则见 `STAGE_REVIEW_PROTOCOL.md`，开发入口为 `AGENTS.md` 与 `DEVELOPMENT_HANDOFF.md`。

npm404、工具写入拦截、PowerShell窗口查询超时和聊天“无法思考”分开记录。没有内部错误码，不声称已找到或修复聊天中断根因。有限输出、分段检查点只降低重复工作和单次失败影响，不保证平台不中断。

TEST-07为本次补入统一索引的既有问题：bcdfe9d的原始Windows报告已独立通过21帧/尺寸/摘要核验。43条由原42条加此1条组成，不重复计数；助手12类执行失误仍单列。

TEST-08是此前自动轮已发现、本轮补入索引的同一测试契约问题，不重复新建缺陷。原43项内容保持不变；TEST-08已在4580f5c的当前提交原生21帧、双平台UI/实际服务、桌面与安装包完成独立验收（PR #2评论5952627874），本次随实际S3基础开发更新为historical-fixed，数量不增加。助手12类记录不变，本轮接续与过期状态风险归入既有EXEC-06/EXEC-07。
