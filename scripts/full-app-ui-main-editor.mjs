import assert from 'node:assert/strict'
import { exactTitleSearchResultIndex } from './full-app-ui-owned-search.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { navigationRoutes, prepareNavigation, verifyNavigationPages } from './full-app-ui-navigation.mjs'
import { desktopNote } from './desktop-save-fixture.mjs'

// Installed production UI only. Fixture documents use the public local API;
// observations never write editor state, dispatch application events or mount UI.
const stateRoots = {
  'editor-toolbar': { 'insert-menu': '.toolbar-insert-menu', 'format-menu': '.toolbar-format-menu', 'text-color': '[aria-label="文本颜色选择"]', highlight: '[aria-label="高亮颜色选择"]' },
  'editor-search': { confirmation: '.consumer-confirm-modal' },
  'editor-source': { discard: '.consumer-confirm-modal' },
  'editor-history': { 'restore-confirmation': '.consumer-confirm-modal' },
  'editor-attachment': { preview: '.attachment-preview-dialog' },
  'editor-code': { languages: '.language-selector-dropdown', empty: '.language-selector-dropdown' },
  'editor-commands': { 'block-menu': '.block-menu', 'wiki-completion': '.wiki-link-menu' },
  'editor-table-actions': { 'selection-mode': '.table-selection-modebar' },
}
const route = (id, title, source, root, requiredStates, editorExceptions = []) => ({ id, title, source, root, requiredStates, ...(stateRoots[id] ? { stateRoots: stateRoots[id] } : {}), ...(editorExceptions.length ? { editorExceptions: editorExceptions.map(selector => ({ selector, source, reason: 'Existing production code editor textarea; retains raw source editing and native selection semantics.' })) } : {}) })
export const editorRoutes = [
  route('editor-toolbar', '编辑工具栏', 'src/components/Editor/plugins/ToolbarPlugin.jsx', '.editor-toolbar', ['default', 'paragraph-popup', 'insert-menu', 'format-menu', 'font-popup', 'size-popup', 'text-color', 'highlight']),
  route('editor-table-insert', '表格插入选择', 'src/components/Editor/plugins/TableMenu.jsx', '.product-table-insert-menu', ['picker']),
  route('editor-floating', '选中文本格式', 'src/components/Editor/plugins/FloatingTextToolbarPlugin.jsx', '.floating-text-toolbar', ['selection']),
  route('editor-link', '链接操作', 'src/components/Editor/plugins/LinkInteractionPlugin.jsx', '.editor-link-popover', ['existing', 'invalid']),
  route('editor-link-create', '添加链接', 'src/components/Editor/plugins/ToolbarPlugin.jsx', '.toolbar-link-popover', ['draft']),
  route('editor-search', '文内查找与替换', 'src/components/Editor/plugins/SearchPlugin.jsx', '.document-search', ['matches', 'empty', 'replacement', 'confirmation']),
  route('editor-commands', '编辑器命令', 'src/components/Editor/plugins/CommandPalettePlugin.jsx', '.editor-command-palette', ['default', 'empty', 'block-menu', 'wiki-completion']),
  route('editor-view', '写作视图设置', 'src/components/Editor/plugins/EditorViewSettingsPlugin.jsx', '.editor-view-settings', ['default', 'font-popup']),
  route('editor-source', 'Markdown 源码', 'src/components/Editor/plugins/MarkdownSourcePlugin.jsx', '.markdown-source-panel', ['default', 'draft', 'discard'], ['.markdown-source-textarea']),
  route('editor-outline', '文档目录', 'src/components/Editor/plugins/DocumentOutlinePlugin.jsx', '.document-outline-panel', ['headings', 'empty']),
  route('editor-properties', '笔记详情与标签', 'src/components/InspectorPanel.jsx', '.inspector-panel', ['properties', 'tags', 'tag-empty']),
  route('editor-history', '笔记版本历史', 'src/components/VersionHistory.jsx', '.version-history', ['snapshots', 'preview', 'empty', 'restore-confirmation']),
  route('editor-backlinks', '反向来源', 'src/components/BacklinksPanel.jsx', '.backlinks-panel', ['sources', 'preview', 'empty']),
  route('editor-reference-health', '当前笔记引用', 'src/components/ReferenceHealthPanel.jsx', '.reference-health-panel', ['references']),
  route('editor-structure', '长文结构', 'src/components/LongFormStructurePanel.jsx', '.long-structure-panel', ['sections']),
  route('editor-block-reference', '块引用与嵌入', 'src/components/Editor/plugins/BlockReferencePlugin.jsx', '.block-reference-panel', ['default', 'display-popup', 'preview', 'invalid']),
  route('editor-wiki-preview', 'Wiki 引用预览', 'src/components/Editor/nodes/WikiLinkView.jsx', '.wiki-link-preview', ['preview']),
  route('editor-wiki-navigation', '不存在的本地引用提示', 'src/components/WikiNavigationStatus.jsx', '.wiki-navigation-status', ['missing-source']),
  route('editor-block-embed', '块内容嵌入', 'src/components/Editor/nodes/BlockEmbedView.jsx', '.block-reference-embed', ['loaded']),
  route('editor-table-actions', '表格单元格操作', 'src/components/Editor/plugins/TableActionMenuPlugin.jsx', '.table-action-menu', ['actions', 'selection-mode']),
  route('editor-resources', '当前笔记资源', 'src/components/Editor/plugins/ResourceManagerPlugin.jsx', '.editor-resource-panel', ['populated', 'empty']),
  route('editor-image', '图片工具', 'src/components/Editor/nodes/ImageNode.jsx', '.editor-image-block', ['selected']),
  route('editor-image-grid', '图片组工具', 'src/components/Editor/nodes/ImageGridNode.jsx', '.editor-image-grid-block', ['selected']),
  route('editor-attachment', '附件与预览', 'src/components/Editor/nodes/AttachmentNode.jsx', '.attachment-block', ['default', 'preview']),
  route('editor-todo', '待办内容', 'src/components/Editor/nodes/TodoNode.jsx', '.todo-block', ['default', 'edit']),
  route('editor-formula', '公式编辑', 'src/components/Editor/nodes/FormulaNode.jsx', '.formula-editor', ['default', 'draft']),
  route('editor-embed', '嵌入属性', 'src/components/Editor/nodes/EmbedNode.jsx', '.embed-block', ['default', 'draft']),
  route('editor-code', '代码块语言', 'src/components/Editor/nodes/CodeBlockNode.jsx', '.code-block-wrapper', ['default', 'languages', 'empty'], ['.code-textarea']),
  route('editor-callout', '提示块', 'src/components/Editor/nodes/CalloutNode.jsx', '.callout-block', ['default', 'icons']),
  route('editor-toggle', '折叠块', 'src/components/Editor/nodes/ToggleNode.jsx', '.toggle-block', ['expanded', 'collapsed']),
  route('editor-file-import', '本地文档导入预检', 'src/components/ImportWorkspace.jsx', '.local-import-workspace', ['empty', 'prepared', 'destination-popup', 'long-title']),
  route('editor-file-export', '本地文档导出预览', 'src/components/ExportWorkspace.jsx', '.export-workspace', ['selection', 'markdown-preview', 'word-preview']),
]
export const mainEditorRoutes = [...navigationRoutes, ...editorRoutes]
const q = JSON.stringify
const sha = value => createHash('sha256').update(value).digest('hex')
const miss = '不存在的合成匹配-NO-MATCH-750012'
const textNode = text => ({ detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 })
const element = (type, children, extra = {}) => ({ children, direction: null, format: '', indent: 0, type, version: 1, ...extra })
const paragraph = text => element('paragraph', [textNode(text)], { textFormat: 0, textStyle: '' })
const documentBody = nodes => q({ root: element('root', nodes) })

export async function prepareMainEditor(ctx) {
  const nav = await prepareNavigation(ctx)
  const editor = await prepareEditor(ctx)
  const fileWorkspace = { markdown: await ctx.writeFixtureFile({ name: 'owned-ui-import.md', bytes: Buffer.from('# 合成本地导入文档\n\n只预检此文件，不确认创建笔记。\n\n' + '较长中文段落用于检查真实转换预览与输入框，不会写入用户笔记。\n'.repeat(8)) }) }
  return { ...nav, ...editor, fileWorkspace, noteIDs: [...nav.noteIDs, ...editor.noteIDs] }
}

export async function prepareEditor(ctx) {
  const { api, readAsset } = ctx, marker = 'EDITOR-' + randomUUID().slice(0, 8)
  const post = (path, value) => api(path, { method: 'POST', body: q(value) })
  const notes = {}, assetReceipts = []
  const make = async (name, nodes) => {
    const content = typeof nodes === 'string' ? nodes : documentBody(nodes)
    const note = await post('/api/files', { title: `${marker} ${name}`, content, is_folder: false, parent_id: '' })
    assert.match(note.id, /^[A-Za-z0-9_-]+$/)
    const saved = await api('/api/files/' + note.id)
    assert.equal(saved.content, content); notes[name] = saved; return saved
  }
  const upload = async (name, mime, bytes) => {
    const form = new FormData(); form.append('file', new Blob([bytes], { type: mime }), name)
    const saved = await api('/api/upload', { method: 'POST', body: form })
    assert.match(saved.url, /^\/uploads\/[^/\\?#]+$/)
    const actual = Buffer.from(await readAsset(saved.url)); assert.deepEqual(actual, bytes)
    assetReceipts.push({ url: saved.url, name, mime, bytes: bytes.length, sha256: sha(bytes) }); return saved.url
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=', 'base64')
  const imageURL = await upload(marker + '.png', 'image/png', png)
  const attachmentBytes = Buffer.from('仅本机合成附件。\n这段较长中文用于核对附件预览、换行与关闭按钮。\n' + '重复预览行：原文保持不变。\n'.repeat(12))
  const attachmentURL = await upload(marker + '.txt', 'text/plain', attachmentBytes)
  const blockId = 'b-' + randomUUID().replaceAll('-', '')
  const missingId = 'missing-' + randomUUID()
  const body = [paragraph('界面验收正文：选择这段文字检查浮动工具栏，不改变原文。'),
    element('heading', [textNode('第一章：较长中文章节标题与阅读导航')], { tag: 'h1' }),
    { ...paragraph('可读取的来源块内容，核对真实块预览。'), $: { localBlockId: blockId } },
    element('heading', [textNode('第二章：引用、资源与本地内容')], { tag: 'h2' }),
    element('paragraph', [element('link', [textNode('当前文档内的章节链接')], { url: '#local-ui-fixture', rel: null, target: null, title: '本机合成章节链接' })], { textFormat: 0, textStyle: '' })]
  const basic = await make('基本编辑正文', body)
  await api('/api/files/' + basic.id + '/versions/snapshot', { method: 'POST' })
  await api('/api/files/' + basic.id, { method: 'PUT', body: q({ content: documentBody([...body, paragraph('当前正文新增的保留段落；历史快照不含这一句。')]) }) })
  notes['基本编辑正文'] = await api('/api/files/' + basic.id)
  await make('源码', [element('heading', [textNode('可无损表示的合成章节')], { tag: 'h1' }), paragraph('源码草稿只用于展示和取消，不改变原始正文。')])
  await make('菜单草稿撤销', desktopNote('本机合成菜单验收', '临时输入触发符后使用真实撤销，恢复这段原文。'))
  const versions = await api('/api/files/' + basic.id + '/versions')
  const version = versions.find(item => item.content === basic.content); assert.ok(version?.id)
  const tag = await post('/api/tags', { name: `${marker} 较长中文分类`, color: '#6157d7' }); assert.ok(tag.id)
  await post('/api/files/' + basic.id + '/tags', { file_id: basic.id, tag_id: tag.id })
  const wiki = embedded => ({ type: 'wiki-link', version: 1, id: basic.id, title: basic.title, sectionPath: [], ...(embedded ? { blockId, embedded: true } : {}) })
  await make('引用来源', [paragraph('合成的反向引用来源。'), element('paragraph', [wiki(false)], { textFormat: 0, textStyle: '' }), element('paragraph', [wiki(true)], { textFormat: 0, textStyle: '' }), element('paragraph', [{ type: 'wiki-link', version: 1, id: missingId, title: '不存在的本机合成目标', sectionPath: [] }], { textFormat: 0, textStyle: '' })])
  await make('表格', [element('table', [0, 1].map(row => element('tablerow', [0, 1, 2].map(col => element('tablecell', [paragraph(`第 ${row + 1} 行 ${col + 1} 列`) ], { colSpan: 1, rowSpan: 1, headerState: row === 0 ? 1 : 0, backgroundColor: null }))))), paragraph('表格后的合成段落。')])
  await make('图片', [{ type: 'image', version: 2, src: imageURL, originalSrc: imageURL, alt: '本机合成图片', width: 260, height: 160, caption: '较长图片说明：检查标题与操作工具的布局', align: 'center' }])
  await make('图片组', [{ type: 'image-grid', version: 2, columns: 2, gap: 8, items: [1, 2].map(n => ({ id: marker + '-' + n, src: imageURL, originalSrc: imageURL, alt: '合成图片 ' + n, caption: '图片组中的较长说明 ' + n })) }])
  await make('附件', [{ type: 'attachment', version: 1, src: attachmentURL, name: marker + '-较长中文附件名称.txt', size: attachmentBytes.length, mime: 'text/plain' }])
  await make('待办', [{ type: 'todo', version: 1, checked: false, text: '较长的合成待办事项，只检查输入和按钮，不切换完成状态。' }])
  await make('公式', [{ type: 'formula', version: 1, expression: 'E=mc^2', displayMode: true }])
  await make('嵌入', [{ type: 'embed', version: 1, url: 'https://example.invalid/local-ui-fixture', title: '不支持的合成链接，仅显示占位，不访问外部内容' }])
  await make('代码', [{ type: 'code-block', version: 1, code: '// 仅本机合成代码\nconst note = "中文与长行显示";\nconsole.log(note);', language: 'javascript' }])
  await make('提示', [{ type: 'callout', version: 1, icon: '💡', text: '提示内容：不修改正文，检查图标选择及长中文输入区。' }])
  await make('展开块', [{ type: 'toggle', version: 2, title: '较长的折叠块标题，用于检查标题输入区域', content: '展开的合成正文。\n保持原始保存内容。', collapsed: false }])
  await make('收起块', [{ type: 'toggle', version: 2, title: '已经收起的合成内容块', content: '未展开的合成正文。', collapsed: true }])
  return { mainEditor: { marker, notes, assetReceipts, versionId: String(version.id), tag, blockId, missingId, sourceAddress: 'notepad://block/' + basic.id + '/' + blockId }, noteIDs: Object.values(notes).map(note => note.id) }
}

export async function verifyMainEditorPages(ctx) {
  await verifyNavigationPages(ctx)
  const { api, evaluate, click, until, cdp, shared, setup } = ctx
  const fixture = setup.mainEditor; assert.ok(fixture?.notes && fixture.sourceAddress)
  const roots = Object.fromEntries(editorRoutes.map(item => [item.id, item.root]))
  const exists = selector => evaluate(`Boolean(document.querySelector(${q(selector)}))`)
  const present = selector => until(() => exists(selector), 'Actual editor UI missing: ' + selector)
  const absent = selector => until(async () => !(await exists(selector)), 'Actual editor UI did not close: ' + selector)
  const text = (root, value) => until(() => evaluate(`document.querySelector(${q(root)})?.textContent.includes(${q(value)})`), 'Actual editor text missing: ' + value)
  const press = (root, value) => click({ selector: root + ' button', text: value })
  const hit = async selector => { await shared.ensureVisible(selector); await click(selector) }
  const shot = (routeId, stateId, anchors, extra = {}) => shared.captureState({ routeId, stateId, root: roots[routeId], anchors, ...extra })
  const focus = (routeId, stateId, selector) => shared.focus(selector, { routeId, stateId })
  const popup = (routeId, stateId, selector) => { assert.equal(typeof shared.selectPreview, 'function'); return shared.selectPreview(selector, { routeId, stateId }) }
  const clean = () => until(() => evaluate(`!document.querySelector('.editor-unapplied-draft-pill,.save-state.error,.save-state.saving,.quit-save-veil')&&!document.querySelector('.content')?.textContent.includes('正在加载编辑器…')`), 'Editor has an unsettled or unapplied draft')
  const closeInspector = async () => { if (await exists('.inspector-panel')) { await hit('.inspector-panel [aria-label="关闭详情"]'); await absent('.inspector-panel') } }
  const openNote = async name => {
    const note = fixture.notes[name]; assert.ok(note, 'Unregistered owned editor fixture: ' + name)
    await clean(); await closeInspector(); await shared.openSearch(); await hit('#search-tab-search')
    await press('.global-search-filters', '重置')
    await shared.text('[aria-label="全局检索关键词"]', note.title)
    // The global search legitimately includes related notes whose *body*
    // contains this fixture title. Require exactly one result with the exact
    // visible title, after the real search has settled, not a singleton list.
    const ownedSearchIndex = () => evaluate(`(() => {
      if (document.querySelector('.global-search-content')?.getAttribute('aria-busy') !== 'false') return -1
      const titles = [...document.querySelectorAll('.global-search-results > [data-search-result]')].map(row => row.querySelector('.global-search-result-title')?.textContent.trim())
      return (${exactTitleSearchResultIndex.toString()})(titles, ${q(note.title)})
    })()`)
    try {
      await until(async () => (await ownedSearchIndex()) >= 0, 'Unique owned editor fixture did not appear in actual Search')
    } catch (error) {
      // Failure-only, read-only diagnostics. Preserve the original exact
      // exact-title uniqueness, deadline, trusted input and thrown error.
      const receipt = { expectedId: note.id, expectedTitle: note.title, complete: false }
      ;(ctx.report.fullAppUi.editorSearchFailures ||= []).push(receipt); ctx.save()
      try {
        receipt.renderer = await evaluate(`(() => {
          const query = document.querySelector('[aria-label="全局检索关键词"]')
          const selectors = ['检索目录范围', '检索命中位置', '检索修改时间', '检索结果排序']
          return {
            query: query?.value ?? null,
            summary: document.querySelector('.global-search-summary')?.textContent.trim() ?? null,
            busy: document.querySelector('.global-search-content')?.getAttribute('aria-busy') ?? null,
            notices: [...document.querySelectorAll('.global-search-notice')].map(node => node.textContent.trim()),
            results: [...document.querySelectorAll('[data-search-result]')].map(node => ({
              title: node.querySelector('.global-search-result-title')?.textContent.trim() ?? null,
              text: node.textContent.trim().slice(0, 160)
            })),
            filters: selectors.map(name => {
              const field = document.querySelector('[aria-label="' + name + '"]')
              return { name, value: field?.closest('[data-ui-control="select"]')?.getAttribute('data-ui-value') ?? null }
            })
          }
        })()`)
        const saved = await api('/api/files/' + encodeURIComponent(note.id))
        receipt.savedNote = { id: saved?.id, title: saved?.title, is_folder: saved?.is_folder, is_deleted: saved?.is_deleted }
        const params = new URLSearchParams({ q: note.title, source: 'all', folder_id: '', pinned: '0',
          match_case: '0', since: '0', sort: 'relevance', page: '1', size: '20' })
        try {
          const found = await api('/api/search?' + params.toString())
          receipt.directSearch = { query: found?.query, total: found?.total, scanned: found?.scanned,
            results: found?.items?.map(item => ({ id: item.id, title: item.title })).slice(0, 20) }
        } catch (diagnostic) {
          receipt.directSearchError = String(diagnostic?.message || diagnostic)
        }
        receipt.complete = true
      } catch (diagnostic) {
        receipt.diagnosticError = String(diagnostic?.message || diagnostic)
      } finally {
        ctx.save()
      }
      throw error
    }
    const chosenIndex = await ownedSearchIndex()
    assert.ok(Number.isInteger(chosenIndex) && chosenIndex >= 0, 'Exact owned title became ambiguous before click')
    const row = `.global-search-results > [data-search-result]:nth-of-type(${chosenIndex + 1})`
    assert.equal(await evaluate(`document.querySelector(${q(row)})?.querySelector('.global-search-result-title')?.textContent.trim()`),
      note.title, 'Chosen search row does not belong to the exact owned note')
    await hit(row)
    await until(() => evaluate(`document.querySelector('.global-search-preview h3')?.textContent.trim()===${q(note.title)}`),
      'Exact owned search result did not become the real preview')
    await press('.global-search-preview', '打开笔记')
    await absent('.global-search-panel')
    await until(() => evaluate(`document.querySelector('.workspace-title-button')?.textContent.trim()===${q(note.title)}&&Boolean(document.querySelector('.editor-input'))&&!document.querySelector('.content.switching')`), 'Selected owned note did not finish loading')
    if (await exists('[aria-label="切换到编辑模式"]')) await hit('[aria-label="切换到编辑模式"]')
    await present('.editor-toolbar'); await shared.collapseSidebar(); await clean()
    assert.equal((await api('/api/files/' + note.id)).content, note.content, 'Opening a page changed its saved body')
  }
  const inspector = async tab => {
    if (!(await exists('.inspector-panel'))) await hit('button[aria-label="笔记详情"]')
    await present('.inspector-panel'); await hit('#inspector-tab-' + tab)
    await present('#inspector-panel-' + tab)
  }
  const selectText = async () => {
    await hit('.editor-input > p:first-of-type'); await shared.key('Home'); await shared.key('End', 8)
    await until(() => evaluate('Boolean(window.getSelection()?.toString().length)'), 'Real keyboard did not select editor text')
  }
  const doubleClick = async selector => {
    await shared.ensureVisible(selector)
    const point = await evaluate(`(()=>{const n=document.querySelector(${q(selector)}),r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);if(!(h===n||n.contains(h)))throw Error('Double-click target is obscured');return{x,y}})()`)
    for (const clickCount of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount })
  }

  await openNote('基本编辑正文')
  await shot('editor-toolbar', 'default', ['.editor-toolbar [aria-label="段落类型"]'])
  await focus('editor-toolbar', 'default', '.editor-toolbar [aria-label="加粗"]')
  await popup('editor-toolbar', 'paragraph-popup', '.editor-toolbar [aria-label="段落类型"]')
  await hit('.editor-toolbar [aria-label="插入内容"]'); await present('.toolbar-insert-menu')
  await shot('editor-toolbar', 'insert-menu', ['.toolbar-insert-menu .table-insert-trigger'], { root: '.toolbar-insert-menu' })
  await hit('.table-insert-trigger'); await present('.product-table-insert-menu')
  await shot('editor-table-insert', 'picker', ['.tm-grid-cell[aria-label="1 行 1 列"]'])
  await focus('editor-table-insert', 'picker', '.tm-grid-cell[aria-label="1 行 1 列"]')
  await hit('.editor-toolbar [aria-label="插入内容"]'); await absent('.toolbar-insert-menu')
  await hit('.editor-toolbar [aria-label="更多格式"]'); await present('.toolbar-format-menu')
  await shot('editor-toolbar', 'format-menu', ['.toolbar-format-menu [aria-label="字体"]'], { root: '.toolbar-format-menu' })
  await popup('editor-toolbar', 'font-popup', '.toolbar-format-menu [aria-label="字体"]')
  await popup('editor-toolbar', 'size-popup', '.toolbar-format-menu [aria-label="字号"]')
  await press('.toolbar-format-menu .text-color-group', '文字颜色'); await present('[aria-label="文本颜色选择"]')
  await shot('editor-toolbar', 'text-color', ['[aria-label="文本颜色选择"] button:first-child'], { root: '[aria-label="文本颜色选择"]' })
  await press('.toolbar-format-menu .text-color-group', '文字颜色')
  await press('.toolbar-format-menu .text-color-group', '高亮'); await present('[aria-label="高亮颜色选择"]')
  await shot('editor-toolbar', 'highlight', ['[aria-label="高亮颜色选择"] button:first-child'], { root: '[aria-label="高亮颜色选择"]' })
  await hit('.editor-toolbar [aria-label="更多格式"]'); await absent('.toolbar-format-menu')

  await selectText(); await present('.floating-text-toolbar')
  await shot('editor-floating', 'selection', ['.floating-text-toolbar [aria-label="加粗"]'])
  await focus('editor-floating', 'selection', '.floating-text-toolbar [aria-label="加粗"]')
  await selectText(); await hit('.editor-toolbar [aria-label="添加链接"]'); await present('.toolbar-link-popover')
  await shot('editor-link-create', 'draft', ['[aria-label="链接地址或章节锚点"]'])
  await focus('editor-link-create', 'draft', '[aria-label="链接地址或章节锚点"]')
  await shared.key('Escape'); await absent('.toolbar-link-popover')
  await hit('.editor-input a.editor-link'); await present('.editor-link-popover')
  await shot('editor-link', 'existing', ['.editor-link-popover [aria-label="链接地址"]'])
  await focus('editor-link', 'existing', '.editor-link-popover [aria-label="链接地址"]')
  await shared.text('.editor-link-popover [aria-label="链接地址"]', 'javascript:invalid-only-do-not-save')
  await press('.editor-link-popover', '应用'); await present('.editor-link-popover-error')
  await shot('editor-link', 'invalid', ['.editor-link-popover [aria-label="链接地址"]'])
  await shared.key('Escape'); await absent('.editor-link-popover')

  await hit('[aria-label="文内查找与替换"]'); await present('.document-search')
  await shared.text('[aria-label="查找内容"]', '正文'); await until(() => evaluate('/^[1-9][0-9]*\\/[1-9]/.test(document.querySelector(".search-count")?.textContent||"")'), 'Actual body matches did not load')
  await shot('editor-search', 'matches', ['[aria-label="查找内容"]']); await focus('editor-search', 'matches', '[aria-label="查找内容"]')
  await shared.text('[aria-label="查找内容"]', miss); await text('.search-count', '0 处')
  await shot('editor-search', 'empty', ['[aria-label="查找内容"]'])
  await shared.text('[aria-label="查找内容"]', '正文'); await press('.document-search', '显示替换')
  await shared.text('[aria-label="替换内容"]', '只作取消预览的替换草稿')
  await shot('editor-search', 'replacement', ['[aria-label="替换内容"]'])
  await press('.document-search', '全部替换…'); await present('[role="dialog"]')
  await shot('editor-search', 'confirmation', ['.consumer-confirm-modal .consumer-modal-actions button:first-child'], { root: '.consumer-confirm-modal', requiredText: ['确认全部替换？'] })
  await press('[role="dialog"]', '取消'); await hit('[aria-label="关闭文内查找"]'); await absent('.document-search')

  await hit('[aria-label="编辑器命令"]'); await present('.editor-command-palette')
  await shot('editor-commands', 'default', ['[aria-label="搜索编辑器命令"]']); await focus('editor-commands', 'default', '[aria-label="搜索编辑器命令"]')
  await shared.text('[aria-label="搜索编辑器命令"]', miss); await text('.editor-command-empty', '没有匹配')
  await shot('editor-commands', 'empty', ['[aria-label="搜索编辑器命令"]']); await shared.key('Escape'); await absent('.editor-command-palette')
  await hit('.editor-input > p:first-of-type'); await present('.block-handle')
  await hit('.block-handle'); await present('.block-menu')
  const blockCopy = '.block-menu button:nth-of-type(3)', blockPaste = '.block-menu button:nth-of-type(4)'
  const beforeBlockCopy = await evaluate(`document.querySelector(${q(blockPaste)}).disabled`)
  if (ctx.matrix.theme === 'light' && ctx.matrix.viewport.width === 704) assert.equal(beforeBlockCopy, true, 'The fresh actual App must start without an internal block clipboard')
  const firstBlockEvent = await evaluate('window.__fullAppUiEvents.length')
  await shared.hover(blockCopy); await present(blockCopy)
  await shot('editor-commands', 'block-menu', ['.block-menu .block-menu-item:first-child'], { root: '.block-menu' })
  await hit(blockCopy); await absent('.block-menu')
  await hit('.editor-input > p:first-of-type'); await present('.block-handle'); await hit('.block-handle'); await present(blockPaste)
  assert.equal(await evaluate(`document.querySelector(${q(blockPaste)}).disabled`), false, 'The actual copy action did not populate the original internal block clipboard')
  const blockEvents = await evaluate(`window.__fullAppUiEvents.slice(${firstBlockEvent})`)
  assert.ok(blockEvents.some(event => event.type === 'mouseover' && event.trusted) && blockEvents.some(event => event.type === 'click' && event.trusted))
  ;(ctx.report.fullAppUi.blockMenuInteractions ||= []).push({ ...ctx.matrix, routeId: 'editor-commands', stateId: 'block-menu', initiallyPasteDisabled: beforeBlockCopy, pasteAvailableAfterCopy: true, nativePointerRetainedMenu: true, events: blockEvents }); ctx.save()
  await hit('.editor-input > p:first-of-type'); await absent('.block-menu')
  await openNote('菜单草稿撤销')
  const menuNote = fixture.notes['菜单草稿撤销']
  const beforeMenuText = await evaluate('document.querySelector(".editor-input").innerText')
  const firstMenuEvent = await evaluate('window.__fullAppUiEvents.length')
  await hit('.editor-input > p:last-child'); await shared.key('End')
  await cdp.send('Input.insertText', { text: '[[' })
  await until(() => evaluate('document.querySelectorAll(".wiki-link-menu button").length>=2'), 'Actual Wiki completion needs owned local results')
  await shot('editor-commands', 'wiki-completion', ['.wiki-link-menu button:first-of-type'], { root: '.wiki-link-menu' })
  const selectedWiki = () => evaluate('document.querySelector(".wiki-link-menu [aria-selected=true]")?.textContent')
  const wikiBefore = await selectedWiki(); assert.ok(wikiBefore)
  await shared.key('ArrowDown')
  await until(async () => { const selected = await selectedWiki(); return selected && selected !== wikiBefore }, 'Real ArrowDown did not move the Wiki selection')
  const wikiAfter = await selectedWiki()
  await shared.key('Escape'); await absent('.wiki-link-menu')
  await shared.key('z', 2)
  await until(() => evaluate(`document.querySelector('.editor-input').innerText===${q(beforeMenuText)}&&!document.querySelector('.workspace-save-chip.dirty,.editor-unapplied-draft-pill')`), 'Native Undo did not restore the exact original editor content and clean state')
  assert.deepEqual(await api('/api/files/' + menuNote.id), menuNote, 'Wiki menu inspection changed a saved note')
  const menuEvents = await evaluate(`window.__fullAppUiEvents.slice(${firstMenuEvent})`)
  for (const name of ['ArrowDown', 'Escape', 'z']) assert.ok(menuEvents.some(event => event.type === 'keydown' && event.key === name && event.trusted), 'Missing trusted Wiki keyboard event: ' + name)
  assert.equal(menuEvents.some(event => event.type === 'keydown' && ['Tab', 'Enter'].includes(event.key)), false, 'Wiki inspection must not commit an option')
  ;(ctx.report.fullAppUi.editorMenuInteractions ||= []).push({ routeId: 'editor-commands', stateId: 'wiki-completion', ...ctx.matrix, selectedBefore: wikiBefore, selectedAfter: wikiAfter, escapeClosed: true, nativeUndoRestored: true, savedNoteUnchanged: true, events: menuEvents }); ctx.save()
  await openNote('基本编辑正文')
  await hit('.editor-toolbar [aria-label="写作视图设置"]'); await present('.editor-view-settings')
  await shot('editor-view', 'default', ['.editor-view-settings [aria-label="关闭"]']); await focus('editor-view', 'default', '.editor-view-settings [aria-label="关闭"]')
  await popup('editor-view', 'font-popup', '.editor-view-settings [data-ui-control="select"] [role="combobox"]')
  await hit('.editor-view-settings [aria-label="关闭"]'); await absent('.editor-view-settings')
  await openNote('源码')
  await hit('.editor-toolbar [aria-label="Markdown 源码"]'); await present('.markdown-source-panel')
  await shot('editor-source', 'default', ['.markdown-source-actions button:last-child'])
  await focus('editor-source', 'default', '.markdown-source-actions button:last-child')
  assert.equal(await evaluate('document.querySelector(".markdown-source-textarea").readOnly'), false)
  await shared.text('.markdown-source-textarea', '# 未应用的长中文源码草稿\n\n' + '只核对输入与放弃，正文保持原样。'.repeat(20))
  await shot('editor-source', 'draft', ['.markdown-source-textarea'])
  await press('.markdown-source-actions', '关闭'); await present('[role="dialog"]')
  await shot('editor-source', 'discard', ['.consumer-confirm-modal .consumer-modal-actions button:last-child'], { root: '.consumer-confirm-modal', requiredText: ['放弃未应用的源码更改？'] })
  await press('[role="dialog"]', '放弃更改并关闭'); await absent('.markdown-source-panel')
  await openNote('基本编辑正文')
  await hit('[aria-label="文档目录"]'); await present('.document-outline-panel')
  await shot('editor-outline', 'headings', ['[aria-label="查找章节"]']); await focus('editor-outline', 'headings', '[aria-label="查找章节"]')
  await shared.text('[aria-label="查找章节"]', miss); await shot('editor-outline', 'empty', ['[aria-label="查找章节"]'])
  await hit('[aria-label="关闭文档目录"]'); await absent('.document-outline-panel')

  // Remaining node and inspector routes follow below; every state must have a
  // real native observation before the ledger can report completion.
  await verifyEditorInspector({ ...ctx, fixture, openNote, inspector, closeInspector, shot, focus, hit, press, present, absent, text })
  await verifyEditorNodes({ ...ctx, fixture, openNote, shot, focus, hit, press, present, absent, text, doubleClick, popup })
  await verifyFileWorkspaces({ ...ctx, fixture, openNote, shot, focus, hit, press, present, absent, text, popup })
  await clean(); await closeInspector()
  for (const note of Object.values(fixture.notes)) assert.equal((await api('/api/files/' + note.id)).content, note.content, 'Editor UI inspection changed owned saved content: ' + note.title)
  for (const asset of fixture.assetReceipts) assert.equal(sha(Buffer.from(await ctx.readAsset(asset.url))), asset.sha256, 'Actual editor asset changed')
}

async function verifyFileWorkspaces(ctx) {
  const { fixture, openNote, shot, focus, hit, press, present, absent, text, popup, shared, evaluate, until } = ctx
  const readImports = () => evaluate(`Object.keys(localStorage).filter(key=>key.startsWith('localNotepad.localImportIntent.v1:')).sort().map(key=>({key,raw:localStorage.getItem(key)}))`)
  const before = await readImports()
  const menu = async () => {
    const expand = '.workspace-sidebar button[aria-label="展开侧边栏"]'
    if (await evaluate(`Boolean(document.querySelector(${q(expand)}))`)) await hit(expand)
    await present('.file-list'); await hit('.file-list button[aria-label="更多笔记操作"]'); await present('.file-more-menu')
  }
  await openNote('基本编辑正文'); await menu(); await hit('[data-local-import-entry]')
  await present('.local-import-workspace')
  await until(() => evaluate('!document.querySelector("[data-local-import-ledger-refresh]").disabled'), 'Actual local import records are not ready')
  await shot('editor-file-import', 'empty', ['[data-local-import-close]']); await focus('editor-file-import', 'empty', '[data-local-import-close]')
  await shared.chooseFile('[data-local-import-input]', ctx.setup.fileWorkspace.markdown)
  await present('[data-local-import-state="prepared"]')
  await text('[data-local-import-preview]', '只预检此文件，不确认创建笔记')
  await until(async () => {
    if (!(await evaluate('document.querySelectorAll("[data-local-import-row]").length===1'))) return false
    const destination = await shared.nativeSelect.inspect('[data-local-import-destination]')
    return destination.count === 1 && destination.kind === 'shared' && destination.disabled === false
  }, 'Import must finish with one complete prepared row and a ready actual destination control')
  await shot('editor-file-import', 'prepared', ['[data-local-import-title]'])
  await popup('editor-file-import', 'destination-popup', '[data-local-import-destination]')
  const title = await evaluate('document.querySelector("[data-local-import-title]").value')
  await shared.text('[data-local-import-title]', '只作预览的较长中文导入标题，不提交或创建新笔记。'.repeat(3))
  await shot('editor-file-import', 'long-title', ['[data-local-import-title]'])
  await shared.text('[data-local-import-title]', title)
  await hit('[data-local-import-close]'); await absent('.local-import-workspace')
  assert.deepEqual(await readImports(), before, 'Import preview created or modified an intent record')
  await menu(); await hit('[data-local-export-entry]'); await present('.selector-modal')
  const selectAll = await evaluate('document.querySelector(".selector-toolbar button").textContent.trim()')
  if (selectAll === '全选') await press('.selector-toolbar', '全选')
  await press('.selector-toolbar', '取消全选'); await text('.selector-counter', '已选择 0 项')
  const checkbox = await evaluate(`(()=>{const rows=[...document.querySelectorAll('.selector-tree .tree-item')];const matches=rows.filter(row=>row.querySelector('.title')?.textContent===${q(fixture.notes['基本编辑正文'].title)});if(matches.length!==1)throw Error('Owned export fixture row missing or ambiguous');let n=matches[0].querySelector('input[type="checkbox"]');if(!n||n.disabled)throw Error('Owned export fixture unavailable');const parts=[];while(n&&n!==document.documentElement){parts.unshift(n.tagName.toLowerCase()+':nth-child('+([...n.parentElement.children].indexOf(n)+1)+')');n=n.parentElement}return 'html > '+parts.join(' > ')})()`)
  await hit(checkbox); await text('.selector-counter', '已选择 1 项'); await press('.selector-modal', '下一步')
  await absent('.selector-modal'); await present('.export-workspace')
  await shot('editor-file-export', 'selection', ['[data-local-export-prepare]']); await focus('editor-file-export', 'selection', '[data-local-export-prepare]')
  const preview = async state => {
    await hit('[data-local-export-prepare]')
    await until(() => evaluate('document.querySelectorAll("[data-local-export-item]").length===1&&!document.querySelector("[data-local-export-choose]")?.disabled'), 'Actual native export preview did not settle')
    assert.equal(await evaluate('document.querySelector("[data-local-export-start]").disabled'), true, 'Preview must not acquire an export destination')
    await hit('.export-items details > summary'); await shot('editor-file-export', state, ['[data-local-export-choose]'])
  }
  await preview('markdown-preview')
  await hit('.export-workspace input[value="docx"]'); await present('[data-local-export-prepare]')
  await preview('word-preview')
  await hit('[aria-label="关闭导出工作台"]'); await absent('.export-workspace')
  assert.deepEqual(await readImports(), before)
}

async function verifyEditorInspector(ctx) {
  const { fixture, openNote, inspector, closeInspector, shot, focus, hit, press, present, absent, text, shared, evaluate } = ctx
  await openNote('基本编辑正文'); await inspector('properties')
  await present('[aria-label="管理标签"]')
  await shot('editor-properties', 'properties', ['[aria-label="管理标签"]']); await focus('editor-properties', 'properties', '[aria-label="管理标签"]')
  await hit('[aria-label="管理标签"]'); await present('[aria-label="查找标签"]')
  await text('.note-tag-options', fixture.tag.name)
  await shot('editor-properties', 'tags', ['[aria-label="查找标签"]'])
  await shared.text('[aria-label="查找标签"]', miss); await text('.note-tag-panel', '没有匹配的标签')
  await shot('editor-properties', 'tag-empty', ['[aria-label="查找标签"]'])
  await hit('[aria-label="关闭标签管理"]'); await absent('.note-tag-panel')
  await inspector('history'); await present('[aria-label="查找历史快照"]')
  await shot('editor-history', 'snapshots', ['[aria-label="查找历史快照"]']); await focus('editor-history', 'snapshots', '[aria-label="查找历史快照"]')
  await hit('[data-version-id=' + q(fixture.versionId) + ']'); await present('.version-preview')
  await shot('editor-history', 'preview', ['.version-restore-action'])
  await press('.version-history', '恢复此快照正文'); await present('.consumer-confirm-modal')
  await shot('editor-history', 'restore-confirmation', ['.consumer-confirm-modal .consumer-modal-actions button:first-child'], { root: '.consumer-confirm-modal', requiredText: ['恢复所选历史正文？'] })
  await press('.consumer-confirm-modal', '取消'); await absent('.consumer-confirm-modal')
  await shared.text('[aria-label="查找历史快照"]', miss); await text('.version-list', '没有匹配的快照')
  await shot('editor-history', 'empty', ['[aria-label="查找历史快照"]'])
  await inspector('backlinks'); await present('[aria-label="查找反向来源"]')
  await shot('editor-backlinks', 'sources', ['[aria-label="查找反向来源"]']); await focus('editor-backlinks', 'sources', '[aria-label="查找反向来源"]')
  await hit('[data-backlink-source=' + q(fixture.notes['引用来源'].id) + ']'); await present('.backlink-detail')
  await shot('editor-backlinks', 'preview', ['.backlink-detail .btn.primary'])
  await shared.text('[aria-label="查找反向来源"]', miss)
  await ctx.until(() => evaluate('document.querySelectorAll("[data-backlink-source]").length===0'), 'Backlink filter did not empty')
  await shot('editor-backlinks', 'empty', ['[aria-label="查找反向来源"]'])
  await inspector('structure'); await present('.long-structure-panel')
  const firstStructure = await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.long-structure-tree button')];const index=nodes.findIndex(n=>!n.disabled);if(index<0)throw Error('No active long-form structure control');return index})()`)
  // Use an exact existing button via its source aria-label rather than assigning an ID.
  const structureLabel = await evaluate(`document.querySelectorAll('.long-structure-tree button')[${firstStructure}].getAttribute('aria-label')`)
  assert.ok(structureLabel)
  const structureControl = '.long-structure-tree [aria-label=' + q(structureLabel) + ']'
  await shot('editor-structure', 'sections', [structureControl]); await focus('editor-structure', 'sections', structureControl)
  await closeInspector(); await openNote('引用来源'); await inspector('references'); await present('.reference-health-panel')
  await shot('editor-reference-health', 'references', ['.reference-health-actions button'])
  // There are two references; use the first row's real action for keyboard proof.
  await focus('editor-reference-health', 'references', '.reference-health-item:first-child .reference-health-item-actions button:first-child')
  await closeInspector()
}

async function verifyEditorNodes(ctx) {
  const { fixture, openNote, shot, focus, hit, press, present, absent, text, shared, evaluate, cdp, doubleClick, popup } = ctx
  await openNote('基本编辑正文'); await hit('.block-reference-entry > button'); await present('.block-reference-panel')
  const blockInput = '.block-reference-panel input[placeholder="notepad://block/…"]'
  await shot('editor-block-reference', 'default', [blockInput]); await focus('editor-block-reference', 'default', blockInput)
  await popup('editor-block-reference', 'display-popup', '.block-reference-panel [role="combobox"]')
  await shared.text(blockInput, fixture.sourceAddress); await press('.block-reference-panel', '读取来源块')
  await text('.block-reference-preview', '可读取的来源块内容')
  await shot('editor-block-reference', 'preview', [blockInput])
  await shared.text(blockInput, 'notepad://block/invalid'); await press('.block-reference-panel', '读取来源块')
  await text('.block-reference-panel [role="alert"]', '无效')
  await shot('editor-block-reference', 'invalid', [blockInput])
  await hit('[aria-label="关闭块引用"]'); await absent('.block-reference-panel')
  await openNote('引用来源'); await text('.block-reference-embed pre', '可读取的来源块内容')
  await shot('editor-block-embed', 'loaded', ['.block-reference-embed footer button:first-child'])
  await focus('editor-block-embed', 'loaded', '.block-reference-embed footer button:first-child')
  await shared.hover('.editor-input .wiki-link[data-wiki-target-id=' + q(fixture.notes['基本编辑正文'].id) + ']')
  await present('.wiki-link-preview [data-wiki-control="true"]')
  await shot('editor-wiki-preview', 'preview', ['.wiki-link-preview [data-wiki-control="true"]'])
  await focus('editor-wiki-preview', 'preview', '.wiki-link-preview [data-wiki-control="true"]')
  await shared.key('Escape'); await hit('.editor-input > p:first-of-type')
  await hit('.editor-input .wiki-link[data-wiki-target-id=' + q(fixture.missingId) + ']')
  await present('.wiki-navigation-status [role="alert"]')
  await shot('editor-wiki-navigation', 'missing-source', ['[aria-label="关闭引用导航提示"]'])
  await focus('editor-wiki-navigation', 'missing-source', '[aria-label="关闭引用导航提示"]')
  await hit('[aria-label="关闭引用导航提示"]'); await absent('.wiki-navigation-status')

  await openNote('表格'); await hit('.editor-input table tr:first-child > :first-child')
  await present('.table-action-menu-trigger'); await hit('.table-action-menu-trigger'); await present('.table-action-menu')
  const tableAction = '.product-table-menu-section:first-child .table-action-menu-item:first-of-type'
  await shot('editor-table-actions', 'actions', [tableAction])
  await focus('editor-table-actions', 'actions', tableAction)
  await press('.table-action-menu', '多选单元格…'); await absent('.table-action-menu'); await present('.table-selection-modebar')
  await shot('editor-table-actions', 'selection-mode', ['.table-selection-modebar .primary'], { root: '.table-selection-modebar' })
  await press('.table-selection-modebar', '完成'); await absent('.table-selection-modebar')

  await openNote('图片'); await hit('.editor-image-stage img'); await present('.editor-image-toolbar')
  await shot('editor-image', 'selected', ['[aria-label="图片说明"]'])
  await focus('editor-image', 'selected', '[aria-label="图片说明"]')
  await hit('.editor-resource-toggle'); await present('.editor-resource-panel')
  await shot('editor-resources', 'populated', ['[aria-label="搜索资源"]']); await focus('editor-resources', 'populated', '[aria-label="搜索资源"]')
  await shared.text('[aria-label="搜索资源"]', miss); await text('.editor-resource-empty', '没有匹配')
  await shot('editor-resources', 'empty', ['[aria-label="搜索资源"]'])
  await hit('[aria-label="关闭资源面板"]'); await absent('.editor-resource-panel')
  await openNote('图片组'); await hit('.editor-image-grid-card:first-child img'); await present('.editor-image-grid-toolbar')
  await shot('editor-image-grid', 'selected', ['[aria-label="图片 1 说明"]'])
  await focus('editor-image-grid', 'selected', '[aria-label="图片 1 说明"]')
  await openNote('附件'); await present('.attachment-preview-button')
  await shot('editor-attachment', 'default', ['.attachment-preview-button']); await focus('editor-attachment', 'default', '.attachment-preview-button')
  await hit('.attachment-preview-button'); await present('.attachment-preview-dialog')
  await text('.attachment-text-preview', '仅本机合成附件')
  await shot('editor-attachment', 'preview', ['.attachment-preview-close'], { root: '.attachment-preview-dialog' })
  await hit('.attachment-preview-close'); await absent('.attachment-preview-dialog')
  await openNote('待办'); await shot('editor-todo', 'default', ['.todo-text-button']); await focus('editor-todo', 'default', '.todo-text-button')
  await hit('.todo-text-button'); await present('.todo-input'); await shot('editor-todo', 'edit', ['.todo-input'])
  await shared.key('Escape'); await absent('.todo-input')
  assert.equal((await ctx.api('/api/files/' + fixture.notes['待办'].id)).content, fixture.notes['待办'].content, 'Unchanged Todo cancellation wrote saved content')
  await openNote('公式'); await doubleClick('.formula-rendered'); await present('.formula-editor')
  await shot('editor-formula', 'default', ['.formula-editor textarea']); await focus('editor-formula', 'default', '.formula-editor textarea')
  await shared.text('.formula-editor textarea', '\\sum_{i=1}^{n} i + \\frac{a}{b} + \\sqrt{x}')
  await shot('editor-formula', 'draft', ['.formula-editor textarea']); await press('.formula-editor', '取消'); await absent('.formula-editor')
  await openNote('嵌入'); await hit('[aria-label="编辑嵌入内容"]'); await present('.embed-editing')
  await shot('editor-embed', 'default', ['.embed-editing input[type="url"]']); await focus('editor-embed', 'default', '.embed-editing input[type="url"]')
  await shared.text('.embed-editing input[type="text"]', '只保留在未应用草稿中的较长嵌入标题，不创建外部连接。'.repeat(4))
  await shot('editor-embed', 'draft', ['.embed-editing input[type="text"]']); await press('.embed-edit-actions', '取消'); await absent('.embed-editing')
  await openNote('代码'); await shot('editor-code', 'default', ['.language-selector-button']); await focus('editor-code', 'default', '.language-selector-button')
  await hit('.language-selector-button'); await present('.language-selector-dropdown')
  await shot('editor-code', 'languages', ['.language-selector-search'], { root: '.language-selector-dropdown' })
  await shared.text('.language-selector-search', miss); await text('.language-selector-list', 'No languages found')
  await shot('editor-code', 'empty', ['.language-selector-search'], { root: '.language-selector-dropdown' }); await hit('.language-selector-button'); await absent('.language-selector-dropdown')
  await openNote('提示'); await shot('editor-callout', 'default', ['[aria-label="选择提示图标"]']); await focus('editor-callout', 'default', '[aria-label="选择提示图标"]')
  await hit('[aria-label="选择提示图标"]'); await present('.callout-icon-picker')
  await shot('editor-callout', 'icons', ['.callout-icon-option:first-child']); await hit('[aria-label="选择提示图标"]'); await absent('.callout-icon-picker')
  await openNote('展开块'); await shot('editor-toggle', 'expanded', ['[aria-label="折叠块标题"]']); await focus('editor-toggle', 'expanded', '[aria-label="折叠块标题"]')
  await openNote('收起块'); await shot('editor-toggle', 'collapsed', ['[aria-label="折叠块标题"]'])
}
