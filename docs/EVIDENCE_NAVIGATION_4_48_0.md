# 4.48.0 — 从正文证据定位回编辑器

基线：feature/ui-redesign-v1，d203fe9e4b83e63790bfaeb7cf7f1358d078ed55（4.47.0）。
上一版 Actions 35842452243 的 renderer-build 和 windows-package 均已成功；Windows 安装包构建、打包后应用检查和安装包上传都已完成。

## 使用

项目 → 实体智能分析 → 正文证据回看：每条原名／别名节选及 WikiLink 标签下新增“定位此处”。
普通“打开章节”保留原行为，并取消尚未消费的证据定位请求。

- 可编辑正文会选中指定的那一次命中，而不是总跳到第一个同名词；明确链接选中对应 WikiLink 节点。
- 原文节点路径和 UTF-16 偏移由当前编辑器内容重新解析。NFC、组合字符跨格式节点、连续空白归一化、加粗拆字、表格与段落边界均有回归覆盖。
- 使用原有大纲揭示事件展开目标所在的折叠章节，滚动后给目标节点临时视觉提示。
- 只读模式只滚动／标示目标文本节点，不修改选区或正文；不承诺在只读模式选中节点内的精确字符范围。

## 防止错误跳转

只有文档 ID 与实际内容加载提交完成信号均匹配时才执行；不靠固定延时猜测正文是否加载完成。
手动证据定位优先于保存的阅读位置恢复，普通打开时仍保留原有会话恢复。
正文可见文本已经变化时，旧证据立即失败并提示刷新；不以模糊匹配猜测另一个位置。
WikiLink 的正文结构、链接身份与序号也必须一致，移除、重排或改名后不会静默跳到其他链接。

定位请求只驻留内存，最多保留一个，新的请求替换旧请求；消费、失败取消或 30 秒过期后清理。
已过期请求不会在后续打开同名文档时重放。单个过期快照不会写入 localStorage 或通过网络发送。
源码面板打开时拒绝抢走焦点，并保留未应用的 Markdown 源码；用户需关闭源码面板后重新定位。
无法无损映射的装饰器文字、半个字素或特殊旧格式只提示手动核对，不重写正文。
没有修改关系评分、实体计数、数据库结构或 master。

## 已执行的本地验证

- Node.js 22.16.0：新增定位核心与请求生命周期测试 29/29 通过。
- 其中包含 1,000 组确定性格式／Unicode 场景，以原有扫描器样例验证定位映射。
- 参与验证的原扫描器 Git blob SHA 已核对：b969206f7ed2ee0790682ec1beff448a1c25f534。
- Editor.jsx、DocumentSessionPlugin.jsx、ProjectEntityEvidencePanel.jsx 与 package.json 的完整基线均通过 Git blob SHA 校验后再修改。
- TypeScript 解析器检查 11 个 JS／JSX／MJS 模块的语法通过；这不是类型检查或应用构建。

新增 6 项证据按钮测试和 11 项真实 Lexical／React 集成测试，并接入原有 UI／编辑器测试命令。
本地容器无法解析 github.com 与 registry.npmjs.org，因此未在本地运行依赖完整安装的 Vitest／Vite／Electron／Windows 测试。
本版是否通过，以本次提交对应 Actions 的实际结果为准，不能沿用上一版结果。
实际 Windows 桌面、高 DPI、深浅主题和折叠布局的人工视觉验收仍需单独完成。

## 复验命令

```powershell
npm run test:entity-core
npm run test:ui
npm run test:editor
npm run test:electron
npm run build:renderer
npm run build:main
```

没有新增第三方依赖，未删减任何既有回归测试。
