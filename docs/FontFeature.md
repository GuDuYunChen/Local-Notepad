# 字体切换功能文档

## 1. 功能概述
本项目已集成6款免费商用字体（阿里妈妈系列及钉钉进步体），并提供字体即时切换、本地记忆和快捷键支持。

## 2. 支持的字体列表
| 显示名称 | 字体族名 (Font Family) | 说明 |
| :--- | :--- | :--- |
| 阿里妈妈灵动体 | AlimamaAgileVF | 包含Thin到Black的可变字体支持 |
| 阿里妈妈刀隶体 | AlimamaDaoLiTi | 锋利有力的隶书风格 |
| 阿里妈妈东方大楷 | AlimamaDongFangDaKai | 传统与现代结合的楷书 |
| 阿里妈妈方圆体 | AlimamaFangYuanTiVF | 圆润柔和的字体 |
| 阿里妈妈数黑体 | AlimamaShuHeiTi | 适合数字与科技感的黑体 |
| 钉钉进步体 | DingTalkJinBuTi | 清晰易读的现代黑体 |
| 淘宝买菜体 | TaoBaoMaiCaiTi | 手写风格字体 |
| Arial | Arial | 系统默认西文 |
| 宋体 | SimSun | 系统默认中文宋体 |
| 黑体 | SimHei | 系统默认中文黑体 |
| 微软雅黑 | Microsoft YaHei | Windows默认UI字体 |
| Times New Roman | Times New Roman | 标准衬线体 |

## 3. 用户操作指南

### 3.1 切换字体
1. 在编辑器顶部的工具栏中找到"文本"分组。
2. 点击第一个下拉菜单（默认为当前字体名称）。
3. 从列表中选择所需的字体。
4. 选中的字体将立即应用到当前光标位置或选中的文本。

### 3.2 快捷键
- **Ctrl + Shift + F**：快速聚焦到字体选择下拉菜单。聚焦后可使用键盘上下键选择字体，按Enter确认。

### 3.3 字体记忆
系统会自动记录您最后一次选择的字体。下次打开编辑器时，将自动恢复该字体设置。

## 4. 开发接口说明

### 4.1 CSS 字体定义
所有字体均在 `src/styles/index.css` 中通过 `@font-face` 定义。字体文件位于 `src/assets/fonts/` 目录下。

示例：
```css
@font-face {
  font-family: 'AlimamaDaoLiTi';
  src: url('../assets/fonts/AlimamaDaoLiTi/AlimamaDaoLiTi/AlimamaDaoLiTi.woff2') format('woff2');
  font-display: swap;
}
```

### 4.2 添加新字体
若需添加新字体，请遵循以下步骤：
1. 将字体文件放入 `src/assets/fonts/`。
2. 在 `src/styles/index.css` 中添加 `@font-face` 规则。
3. 在 `src/components/Editor/plugins/ToolbarPlugin.jsx` 的 `FontOptions` 数组中添加配置项：
   ```javascript
   { label: '显示名称', value: 'FontFamilyName' }
   ```

### 4.3 字体加载策略
- 使用 `font-display: swap` 确保字体加载期间文字可见（会先显示后备字体，加载完成后替换）。
- 支持 `woff2`, `woff`, `ttf` 格式，优先使用 `woff2` 以获得更好的压缩率。

## 5. 兼容性与降级
- 支持所有主流现代浏览器（Chrome, Edge, Firefox, Safari）。
- 如果字体文件加载失败，浏览器将自动回退到系统默认字体（如 sans-serif 或 serif）。
