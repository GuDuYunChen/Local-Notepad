# 开发接续点

## 当前工作
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
