# 4.90.1 — 安装程序兼容分支保护

承接已推送的 4.90.0 `1ddb1ae471e87ab05bed8ce302b392016cd0ad0f`；检索业务代码不变。

## 发现与判断

4.90.0 正式 CI `35946375229` 的完整前端、Go、SQLite、race、真实 HTTP 检索及 win-unpacked 后端检查通过，但 Windows 作业 `107465605846` 的 NSIS 静默安装连续两次退出，退出值 `-1073741819`，未完成安装、卸载和上传。

检查现有 app-builder-lib 24.13.3 模板后，发现它包含不区分系统版本的 Windows 7 known-folder 检测。上游 electron-builder PR #9564 已把该分支限制为 Windows 8 之前执行，并描述相同 oneClick=false、per-user 安装模式下的间歇崩溃。此处使用上游修复处理已确认存在的风险代码；没有本次 native crash dump，不能据此宣称已证明本次故障的唯一根因。

上游来源：https://github.com/electron-userland/electron-builder/pull/9564
修复变更：https://github.com/electron-userland/electron-builder/pull/9564/files

## 实现边界

- 锁定已有 electron-builder 24.13.3，不引入新的第三方依赖或大版本升级。
- `npm run build` 在调用 electron-builder 前运行 `prepare:installer`。
- 只接受 app-builder-lib 24.13.3 的已核验模板 SHA-256，添加 WinVer.nsh 和 `${IfNot} ${AtLeastWin8}` 版本条件。已有同一补丁则保持不变；不认识的版本或内容直接停止构建，不能盲目替换。
- 变更只作用于本次构建用的 node_modules NSIS 模板，不修改正文、数据库、注册表、安全策略、权限模式或用户自选 `/D` 安装路径。Windows 7 原分支保留，但不因此承诺应用支持 Windows 7。
- NSIS 原有安装 / 卸载与实际打包后端验收未删减，未增加成功兜底或把异常退出改成成功。
- 4.90.0 的失败运行保留，不将重跑视为根因修复。

## 本地检查

新增 11 项 Node 原生回归，覆盖原始和已处理模板、UTF-8 / CRLF、哈希、未知版本拒绝、修改内容拒绝、重复执行、临时文件清理及 `/D` / 权限模式代码保留。分别在准备模板前后运行通过。

4.90.1 需要自己的正式 CI，不能把 4.90.0 的后端成功或后续重跑结果当作本提交的安装通过证明。最终 CI 状态见本次交付的验收记录。
