// DOM fixture for real browser computed-style checks. It is not a full-app UI test.
export function createThemeFixture(cssUrls, iconUrl) {
  return `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8">
  ${cssUrls.map(url => `<link rel="stylesheet" href="${url}">`).join('\n')}
  <style>
  body{margin:0;font-family:system-ui,'Microsoft YaHei',sans-serif} .probe-layout{display:grid;grid-template-columns:240px 1fr;height:900px}
  .probe-sidebar{width:auto!important;min-width:0!important;max-width:none!important;padding:18px!important;position:static!important;display:block!important}
  .probe-main{padding:24px;overflow:auto}.probe-row{display:flex;align-items:center;gap:12px;margin:16px 0;flex-wrap:wrap}
  .probe-inplace{position:static!important;width:auto!important;min-width:0!important;max-width:none!important;inset:auto!important;transform:none!important}
  .probe-card{padding:18px;border:1px solid var(--line);border-radius:12px;margin:16px 0}.probe-logo{width:48px;height:48px}
  .probe-layout h1{font-size:23px;margin:0}.probe-layout h2{font-size:16px}.probe-layout p{line-height:1.7}
  .probe-code{position:relative;height:94px}.probe-code pre,.probe-code textarea{position:absolute;inset:0;margin:0;padding:12px;font:13px/1.7 monospace;width:100%;height:100%;box-sizing:border-box}
  .probe-code textarea{z-index:2;resize:none;border:0}.probe-layout .editor-input{min-height:0!important;padding:0!important;width:100%!important}
  .probe-field{min-height:36px;padding:6px 10px;border:1px solid;border-radius:6px}.probe-muted{color:var(--ink-muted)}
  </style></head><body><div class="app-shell probe-layout">
  <aside id="sidebar" class="workspace-sidebar file-sidebar probe-sidebar">
    <div class="workspace-sidebar-brand"><button class="workspace-brand-mark probe-logo" title="记事本"><img id="brand" src="${iconUrl}" alt="记事本产品标志"></button><div class="workspace-brand-copy"><strong>记事本</strong><span>我的本地空间</span></div></div>
    <div class="workspace-sidebar-nav"><button id="selected" class="workspace-sidebar-nav-item active">▣　笔记</button><button class="workspace-sidebar-nav-item">▤　项目</button><button class="workspace-sidebar-nav-item">▦　每日笔记</button><button class="workspace-sidebar-nav-item">◇　知识图谱</button></div>
    <div class="workspace-sidebar-library"><h2>我的知识库</h2><div class="list-item active">品牌与主题设计</div><div class="list-item">阅读笔记</div><div class="list-item">写作计划</div></div>
    <div class="workspace-sidebar-more-menu probe-inplace"><button>设置</button><button>备份与恢复</button><div class="workspace-sidebar-theme">外观　暗色 / 浅色</div></div>
  </aside><main class="workspace-content probe-main"><header class="consumer-document-header probe-inplace"><h1>品牌与暗色主题</h1><div id="headerActions" class="workspace-header-actions">保存　分享　更多</div></header>
  <p id="muted" class="probe-muted">阅读、写作与整理，让内容始终清晰。</p>
  <div class="probe-row"><button id="primary" class="btn primary">新建笔记</button><button class="btn">普通操作</button><button class="btn danger">移至回收站</button><button class="btn primary" disabled>不可用</button></div>
  <section class="editor-shell probe-card" id="document"><div class="editor-input"><p id="prose" class="editor-paragraph">正文与侧栏保持适度分层。<a class="editor-link" href="#">阅读来源</a>　<code class="inline-code">local-first</code></p>
  <p><span id="authorColor" style="color:rgb(205,95,65)">保留作者自己设置的文字颜色</span></p>
  <blockquote class="editor-quote">引用使用柔和文字和清晰边线，而不是整块刺眼白底。</blockquote>
  <div class="probe-code"><textarea id="codeInput" class="code-textarea" style="color:transparent;background-color:transparent;caret-color:#333">const notes = 'Local-Notepad';</textarea><pre id="codePreview" class="code-preview" style="color:#333;background-color:#f5f5f5">const notes = 'Local-Notepad';\n// 代码与光标都应清晰可见</pre></div>
  <div id="placeholder" class="editor-placeholder probe-inplace">开始记录新的想法……</div></div></section>
  <div class="probe-row"><input id="field" class="probe-field" placeholder="搜索笔记"><select class="probe-field"><option>全部来源</option><option>WikiLink</option></select></div>
  <div class="project-entity-alias-conflicts"><strong id="warning">同名实体需要人工确认</strong><div><span>请通过明确链接区分</span></div></div>
  <div id="dialog" class="modal probe-card probe-inplace"><h2>操作确认</h2><p>弹窗与底层画布分开，输入边界保持清楚。</p><button class="btn primary">确认</button></div>
  <div id="status" class="editor-status-bar probe-inplace">已保存　·　当前文档</div>
  </main></div></body></html>`
}

export function verifyDarkThemeFixture() {
  let checks = 0
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks++ }
  const style = id => getComputedStyle(document.getElementById(id))
  const rgb = text => {
    const numbers = text.match(/[\d.]+/g)?.map(Number) || []
    if (text.startsWith('color(srgb')) return numbers.slice(0, 3).map(n => n * 255)
    return numbers.slice(0, 3)
  }
  const luminance = values => values.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126,.7152,.0722][i], 0)
  const ratio = (a, b) => {
    const values = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x)
    return (values[0] + .05) / (values[1] + .05)
  }
  const equalRgb = (actual, expected) => JSON.stringify(rgb(actual)) === JSON.stringify(expected)
  assert(document.documentElement.dataset.theme === 'dark', 'Dark theme must be active')
  assert(equalRgb(style('sidebar').backgroundColor, [21,27,36]), 'Sidebar uses secondary canvas')
  assert(equalRgb(style('document').backgroundColor, [27,35,48]), 'Document uses surface canvas')
  assert(equalRgb(style('dialog').backgroundColor, [35,46,61]), 'Dialog uses elevated surface')
  assert(equalRgb(style('selected').backgroundColor, [24,59,91]), 'Selection is distinct from hover')
  assert(ratio(style('prose').color, style('document').backgroundColor) >= 4.5, 'Prose contrast')
  assert(ratio(style('muted').color, style('document').backgroundColor) >= 4.5, 'Muted text contrast')
  assert(ratio(style('primary').color, style('primary').backgroundColor) >= 4.5, 'Primary button contrast')
  assert(ratio(style('field').borderTopColor, style('field').backgroundColor) >= 3, 'Input boundary contrast')
  assert(equalRgb(style('codePreview').backgroundColor, [17,25,35]), 'No hardcoded pale code background')
  assert(ratio(style('codePreview').color, style('codePreview').backgroundColor) >= 4.5, 'Code text contrast')
  assert(equalRgb(style('codeInput').caretColor, [234,242,255]), 'Code caret remains visible')
  assert(style('codeInput').color === 'rgba(0, 0, 0, 0)', 'No duplicate code text layer')
  assert(style('codeInput').backgroundColor === 'rgba(0, 0, 0, 0)', 'Code input does not cover preview')
  assert(style('status').opacity === '1', 'Save state is readable before hover')
  assert(style('headerActions').opacity === '1', 'Header actions are readable before hover')
  assert(style('placeholder').opacity === '1', 'Placeholder is not doubly dimmed')
  assert(equalRgb(style('authorColor').color, [205,95,65]), 'Explicit author color must be preserved')
  assert(document.getElementById('brand').naturalWidth === 256, 'Brand image decodes correctly')
  assert(style('brand').filter === 'none', 'Brand is not inverted in dark mode')
  return { checks, primaryContrast: ratio(style('primary').color, style('primary').backgroundColor), mutedContrast: ratio(style('muted').color, style('document').backgroundColor) }
}
