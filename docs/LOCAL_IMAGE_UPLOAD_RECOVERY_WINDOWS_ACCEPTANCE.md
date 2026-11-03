# 4.248.1 Windows 图片插入恢复验收

本文件约束当前 PR #26 的 Windows 原生界面验收，不代表验收已经通过。

## 被测对象

- 应用版本：4.248.1
- 产品分支：fix/local-image-upload-recovery-4-248-1
- 验收入口：实际构建的 Electron renderer 中“插入内容 → 图片”，以及编辑器真实粘贴图片命令
- 后端：本次 Windows runner 构建的 notepad-server.exe
- 测试数据：runner 临时目录内生成的随机 JPEG 与隔离 NOTEPAD_DATA，不访问用户资料

## 必须覆盖的真实流程

Windows 专项步骤在 Windows runner 上生成大于2MB且小于10MB的合成 JPEG，启动实际 Go 后端与 Electron 窗口，并对真实构建 renderer 操作：

1. 打开真实笔记，确认工具栏图片入口可用。
2. 模拟压缩预览上传失败，确认原图仅上传一次且仍插入。
3. 模拟原图上传失败，确认正文不出现图片占位或伪成功。
4. 对同一文件执行明确重试，确认结果持久化。
5. 模拟编码异常和上传取消，确认操作有界结束且不写入正文。
6. 阅读模式切换和笔记切换期间完成中的任务不得写入。
7. 通过真实 PASTE_COMMAND 粘贴图片，确认相同恢复规则。
8. 使用原有 Ctrl+S 保存并从实际后端重新读取，核对图片及原有正文均保留。
9. 在704×455深色小窗口核对取消按钮可见、可聚焦并可操作。

## 通过条件

- 所有必需检查按预定顺序执行，报告 complete=true。
- Windows 报告 platform=win32、windowsAcceptance=true、installationTested=false。
- 两个上传链路和应用/后端正常关闭；报告绑定当前源文件、当前构建 renderer、当前 Windows 后端及合成 fixture 的摘要。
- 截图和逐项报告作为 PR #26 的 Windows artifact 保留。

此流程验收的是本次 Windows runner 上的真实 Electron 界面与本次构建后端；它不是安装后用户数据迁移测试。安装包和现有安装 smoke 另行记录，不将旧版本安装结果冒充为4.248.1验收。
