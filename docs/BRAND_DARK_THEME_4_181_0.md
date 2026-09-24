# 4.181.0 — 产品图标与暗色主题层次

基线：`feature/ui-redesign-v1` / `d703cb5139f2b096285fda326196629e607582c8`。
只改品牌资源、展示样式和验证流程，不修改 master、数据库、正文、主题持久化或研究任务逻辑。

## 图标落地

沿用本次对话生成的深色笔记本、N 折带、蓝色书签与知识节点设计，整理成透明边缘的 256px 应用母版。
`src/assets/appIconData.js` 是运行时统一入口；编码资源分块存放于 `src/assets/brand/`，拼接后是同一份 PNG，SHA-256 为 `033c433097ed7f5422209a14f127ca8f465de0f0a753b04a31cc0d28b85e771a`。
既有侧栏和 Electron 窗口已引用该入口，因此不另维护一套图标。

`npm run prepare:brand` 从同一母版生成 `build/icon.png`、`build/icon.ico`、`build/icon.svg` 以及 `src/public/brand/` 下的同名文件。
ICO 包含 16、20、24、32、40、48、64、128、256px 九种尺寸，使用预乘透明度降采样，避免透明边缘出现黑边。
SVG 是内嵌 PNG 的兼容包装，不是可无限放大的纯矢量文件。
旧的已提交 ICO/SVG 被移除，生成文件加入忽略列表，防止新侧栏配旧安装包图标。开发、主进程构建、渲染构建和完整打包均自动准备资源。
Windows 打包继续使用 `build/icon.ico`，网页入口新增本地 favicon；不增加远程资源请求或第三方依赖。

## 暗色修正

新增最后加载的 `src/styles/dark-theme.css`，集中映射旧、新两套颜色变量。
画布、侧栏、文档与弹层分为 `#0F131A`、`#151B24`、`#1B2330`、`#232E3D`；悬停与选中使用不同底色，选中额外保留侧边线。
正文、次级信息和弱提示分级提亮；主按钮采用蓝底深色字，而不是对比度不足的浅蓝底白字。
输入框边界、键盘焦点、占位文字、保存状态、菜单和实体冲突提示均补充暗色规则。
修复 CodeBlockNode 内联浅灰预览背景与深色光标；保留透明编辑层，防止代码文本重复绘制。
不对整个页面做反色，不改用户明确设置的正文颜色。切回浅色时只撤销暗色覆盖；原有主题记忆逻辑不变。

## 本地验证与边界

- Node.js 核心检查 60/60 通过：颜色对比、变量映射、资源生成、PNG CRC、九种 ICO 尺寸、构建入口等。
- Chromium 隔离 DOM 样例 23/23 通过：使用选取的旧样式声明与新主题，检查实际计算颜色、代码层、悬停、焦点和深浅往返；不是完整应用验收。
- 隔离样例中主按钮文字对比约 7.00:1，弱提示对文档底色约 7.26:1。测试中的正文颜色组合按 4.5:1、控件边界按 3:1 检查；这不是整个应用的无障碍认证。
- 本地没有完整仓库依赖，未运行原有 React/Electron/Go 全量回归。新增核心检查已串入原 `test:ui`，原测试列表与依赖版本保留。

Windows CI 新增 `test:brand-render`：加载实际 Vite 构建 CSS，检查同一 DOM 样例的实际渲染、原生 PNG/ICO 解码与浅色恢复，并上传深浅截图。
该检查仍是生产样式的隔离样例，不等同于所有功能页面的人工验收。对应提交的完整构建、回归和打包结果，以 GitHub Actions 为准。
没有执行用户显示器的色彩校准，也没有进行商标注册或商标近似检索。

## 本地复验

```powershell
npm run test:brand
npm run test:ui
npm run test:editor
npm run test:electron
npm run build:main
npm run build:renderer
npm run test:brand-render
npm run build
```

直接运行裸 `vite` 或 `electron-builder` 绕过 npm 脚本时，应先执行 `npm run prepare:brand`；仓库现有 `pack-win.ps1` 调用 `npm run build`，无需额外处理。
