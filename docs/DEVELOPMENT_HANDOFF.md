# 开发接续点

## 当前工作
- 当前修补：复核a6675cf时用故障注入发现stdout/stderr未处理的error会终止测试进程，并发现主动清理时迟到输出误判；先修窗口助手异常管道，见`DESKTOP_WINDOW_PIPE_ERRORS.md`。仍不改产品或进入2F.30。下列a6675cf正常路径已经验收，不能重复当成未执行。

- 本轮：先修复1e734eb遗留的Desktop Save失败（运行36814764840，窗口查询PowerShell超时），见`DESKTOP_WINDOW_HELPER_RECOVERY.md`。上一轮八PR/完整打包成功不等于桌面验收通过。
- 已替换为编辑前预热、异步复用的窗口助手；不改产品4.195.1/schema14或推进2F.30。以新HEAD的独立桌面和原有CI结果验收，不通过修改状态文档再触发额外源码提交。
- 本轮接续修补：历史问题索引与短CI状态核验（见 `KNOWN_ISSUES.md`、`STAGE_REVIEW_PROTOCOL.md`）。产品仍为4.195.1，不叠加新界面功能。
- 仓库：GuDuYunChen/Local-Notepad。
- 开发分支：feature/knowledge-os-phase2；沿用 Draft PR #2，不合入 master。
- 已实现功能：Phase 2F.29，离线历史 JSON 全文件查找、类型/处理结果交集及分页。
- 本次稳定性修补：4.195.1，提交完整依赖锁、CI 改用 npm ci、增加锁校验；不启动 Phase 2F.30。
- 数据库仍为 schema 14；不调整自动保存、Ctrl+S、引用维护或退出确认协议。
- 版本以根 package.json 为准；最新提交以远程分支为准；本文件不是 CI 通过证明。

## 中断后如何接续
先读取远程分支 HEAD、PR #2 和该 HEAD 对应的检查。不能把聊天没有最终回复当作 Git 提交失败，也不能按过期 PR 标题重新开发已经存在的功能。

PR 检查与 push 检查分开核对。至少检查八条 PR 流程、push 的 UI Redesign CI 完整 Windows 打包、Desktop Save End-to-End CI。PR 测试合并的树应与实际分支树一致。下载报告时按提交、平台和成功重试选择，不能把同名的 175 字节身份文件当作完整 UI 报告。

检查点在推送后、验收后分别写进 PR 评论；记录 HEAD、版本、已完成、剩余检查、失败类别和产物 ID。不把所有状态压到一条长回复的最后。最终答复必须区分：已推送、CI 已通过、产物已下载核验，三者不是同一件事。

## 构建与依赖
标准安装：`npm ci --no-audit --no-fund`。
预检：`node scripts/verify-dependency-lock.mjs`。
校验器回归：`node --test scripts/dependency-lock.node.mjs`。

依赖更新必须同时评审 package.json 与 package-lock.json，再用干净的 Linux 和 Windows 安装/测试。不要删除锁文件，不要让 CI 降级为 npm install，不用忽略测试、强制退出或伪造保存回执来取得绿色状态。

## 尚需独立处理的限制
依赖锁固定版本和完整性，不保证 npm 服务永远可用；注册表 404 应保留原始失败日志，区分下载失败与产品断言失败。
聊天端“无法思考”的内部原因未取得错误码/服务日志，不能被本仓库的修补宣称修复。
源码归档可恢复代码，但不是 Git 历史；没有完成 clone 就不要报告克隆成功。
原生 UI 使用隔离合成数据，不能冒充用户本机现场验收。升级前备份工作区及未确认正文，不用旧 4.189.0 打开 schema 14。

## 最近已确证的不同失败类别

4.195.1前npm tarball 404发生在安装阶段；桌面运行36807975236首轮PowerShell窗口查询ETIMEDOUT，同提交第二轮通过；上轮PR评论被工具安全状态检查拦截，未写成功，远程标题仍旧。聊天“无法思考”的内部根因未知。这些不是已证明的同一因果。每次恢复先读取远端，不根据本段推断最新状态。

## 索引与短快照

`node scripts/stage-review.mjs catalog` 核验历史问题关联路径，不运行回归。`node scripts/stage-review.mjs ci <runs.json> <fresh-branch-head>` 整理Actions原始快照，不发请求或重试。CI完整仍输出artifact-verification-required，不等于阶段通过。按STAGE_REVIEW_PROTOCOL分三个检查点，长日志写文件，写入拦截时保留本地接续而不绕过。

## 助手自身执行问题（与产品缺陷分开）

见 `ASSISTANT_EXECUTION_INCIDENTS.md`：现记录12类助手操作失误，执行有限轮询、单次有依据重试和分段交代。1e734eb已修补stage-review的PR范围检查；本轮处理其独立桌面验收中复发的同步PowerShell查询问题，不重复修改核验器或开发2F.30。产品仍4.195.1，最新HEAD以远程为准，验收以该HEAD的PR检查点和实际产物为准。
