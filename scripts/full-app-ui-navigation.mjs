import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { desktopNote } from './desktop-save-fixture.mjs'

// Actual installed application navigation. The only backend mutations are the
// explicitly owned fixtures in prepareNavigation. No React/storage injection,
// custom bridge, simulated page or native dialog dismissal is used here.
const source = name => 'src/components/' + name + '.jsx'
export const navigationRoutes = [
  { id: 'nav-sidebar', title: '主导航侧栏', source: source('WorkspaceSidebar'), root: '.workspace-sidebar', requiredStates: ['expanded', 'collapsed'] },
  { id: 'nav-library', title: '实际笔记列表和工具栏', source: source('FileList'), root: '.file-list', requiredStates: ['populated', 'long-title-filter', 'empty-filter'] },
  { id: 'nav-file-menus', title: '新建、资料库和右键菜单', source: source('FileListMenus'), root: '.file-list [role="menu"]', requiredStates: ['new', 'library', 'context'] },
  { id: 'nav-template-picker', title: '新建的真实模板入口', source: source('TemplateSelector'), root: '.template-selector', requiredStates: ['default'] },
  { id: 'nav-template-library', title: '我的模板库只读入口', source: source('TemplateLibrary'), root: '.template-library', requiredStates: ['default', 'empty-filter'] },
  { id: 'nav-naming', title: '命名与保存选项', source: source('NameDialog'), root: '.name-dialog', requiredStates: ['new-note', 'format-popup', 'invalid-name', 'long-name', 'rename-note', 'new-folder'] },
  { id: 'nav-reference-refactor', title: '改名前的真实引用影响检查', source: source('ReferenceRefactorDialog'), root: '.reference-refactor-dialog', requiredStates: ['rename-impact'] },
  { id: 'nav-file-selector', title: '导出、保存位置和批量选择', source: source('FileSelectorDialog'), root: '.selector-modal', requiredStates: ['export', 'save-location', 'batch-delete'] },
  { id: 'nav-confirm', title: '原有安全确认与取消', source: source('ConfirmDialog'), root: '.consumer-confirm-modal', requiredStates: ['move-to-trash', 'unpin', 'remove-recent', 'clear-recent'] },
  { id: 'nav-daily', title: '每日笔记', source: source('DailyNotesPanel'), root: '.daily-notes-panel', requiredStates: ['populated', 'previous-month', 'empty-filter'] },
  { id: 'nav-recent', title: '最近访问', source: source('RecentNotesPanel'), root: '.recent-workspace', requiredStates: ['populated', 'selected', 'empty-filter'] },
  { id: 'nav-pinned', title: '置顶笔记', source: source('PinnedNotesPanel'), root: '.pinned-workspace', requiredStates: ['populated', 'selected', 'scope-popup', 'order-popup', 'empty-filter'] },
  { id: 'nav-graph', title: '本地图谱及关系', source: source('GraphPanel'), root: '.local-graph', requiredStates: ['populated', 'selected', 'scope-popup', 'one-hop', 'empty-filter', 'zoomed'] },
  { id: 'nav-trash', title: '回收站主页面', source: source('TrashWorkspacePanel'), root: '.trash-workspace', requiredStates: ['populated', 'type-popup', 'order-popup', 'empty-filter', 'selected'] },
  { id: 'nav-trash-confirm', title: '回收站恢复和删除确认', source: source('TrashWorkspacePanel'), root: '.trash-workspace-dialog', requiredStates: ['restore', 'delete-locked'] },
  { id: 'nav-more-menu', title: '更多功能入口', source: source('WorkspaceSidebar'), root: '.workspace-sidebar-more-menu', requiredStates: ['default'] },
  { id: 'nav-backup', title: '备份中心和核对存档入口', source: source('BackupPanel'), root: '.backup-center-modal', requiredStates: ['database', 'restore-guide', 'review-shelf', 'review-tools'] },
  { id: 'nav-workspace-package', title: '工作区便携包的真实入口', source: source('WorkspacePackagePanel'), root: '.backup-center-workspace', requiredStates: ['available'] },
  { id: 'nav-shortcuts', title: '快捷键设置', source: source('ShortcutsModal'), root: '.local-shortcuts-settings', stateRoots: { 'discard-confirmation': '.local-shortcuts-confirmation' }, requiredStates: ['default', 'category-popup', 'empty-filter', 'recording', 'invalid-recording', 'draft', 'discard-confirmation'] },
  { id: 'nav-local-actions', title: '快捷操作', source: source('LocalActions'), root: '.local-actions', requiredStates: ['default', 'category-popup', 'empty-filter', 'filtered'] },
  { id: 'nav-quick-switcher', title: '快速搜索和切换', source: source('QuickSwitcher'), root: '.quick-switcher', requiredStates: ['default', 'title-results', 'body-results', 'empty-filter'] },
]

const q = JSON.stringify
const sha = value => createHash('sha256').update(value).digest('hex')
const safeId = value => { assert.match(String(value), /^[A-Za-z0-9_-]+$/); return String(value) }
const routeFor = id => { const route = navigationRoutes.find(route => route.id === id); assert.ok(route); return route }
const noMatch = '无对应结果-ONLY-OWNED-NAVIGATION-000000'
const noteRoute = id => '/api/files/' + encodeURIComponent(safeId(id))

export async function prepareNavigation({ api, evaluate }) {
  const marker = 'NAV-' + randomUUID().slice(0, 8)
  const create = async (title, content, parent_id = '', is_folder = false) => {
    const result = await api('/api/files', { method: 'POST', body: q({ title, content, parent_id, is_folder }) })
    safeId(result.id)
    const saved = await api(noteRoute(result.id))
    assert.equal(saved.title, title); assert.equal(saved.content, content); assert.equal(saved.is_folder, is_folder)
    return saved
  }
  const folder = await create(marker + ' 合成目录与较长名称布局验证', '', '', true)
  let primary = await create(marker + ' 中文长标题笔记用于侧栏截断、菜单和确认窗口的真实布局检查.md', desktopNote('导航合成正文', marker + '-BODY-PRIMARY 保持原保存正文，不在页面观察中改写。'))
  await api(noteRoute(primary.id), { method: 'PUT', body: q({ is_pinned: true }) })
  primary = await api(noteRoute(primary.id)); assert.equal(primary.is_pinned, true)
  const alternate = await create(marker + ' 第二篇可打开笔记.md', desktopNote('另一篇合成正文', marker + '-BODY-ALTERNATE 此独立来源用于只读切换与最近访问。'))
  const child = await create(marker + ' 目录内部笔记.md', desktopNote('目录内部正文', marker + '-BODY-CHILD 保存位置保持不变。'), folder.id)
  const date = await evaluate("(()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')})()")
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
  const daily = await create(date, desktopNote('本机每日笔记合成来源', marker + '-BODY-DAILY 已存在的真实日期来源，不从日历创建新记录。'))
  const body = JSON.parse(desktopNote('图谱引用来源', marker + '-BODY-REFERENCE 只读核对实际引用索引。'))
  body.root.children.push({ type: 'paragraph', version: 1, format: '', indent: 0, direction: null,
    children: [{ type: 'wiki-link', version: 1, id: primary.id, title: primary.title, sectionPath: [] }] })
  const reference = await create(marker + ' 图谱引用来源.md', q(body))
  const trashed = await create(marker + ' 仅用于取消确认的回收站笔记.md', desktopNote('回收站合成来源', marker + '-BODY-TRASH 不恢复、不永久删除。'))
  await api(noteRoute(trashed.id), { method: 'DELETE' })
  const trash = await api('/api/files/trash')
  assert.ok(trash.some(file => file.id === trashed.id && file.is_deleted), 'The owned synthetic trash note must really exist')
  const notes = [primary, alternate, child, daily, reference]
  return { navigation: { marker, primary, alternate, child, folder, daily, reference, trashed, notes,
    expectedBodyMarker: marker + '-BODY-PRIMARY',
    allowedLocalChanges: ['Actual note visits update the original recent-history tracker', 'Sidebar expansion', 'Unsubmitted filter, selection and dialog drafts'],
    openCoverage: [
      { source: source('FileToolbar'), reason: 'No production import or render references this orphan component; the real toolbar is FileList.file-library-header.' },
      { source: source('WorkspacePackagePanel'), reason: 'Actual default package controls are observed; owned .lnw selection, package validation, staged restore preview and restart are not claimed by this safe navigation module.' },
      { source: source('BackupPanel'), reason: 'Database list and restore guide are observed; no manual backup, export, OS-folder window or existing-backup inspection is triggered.' },
      { source: source('EvidenceReviewBackup'), reason: 'Real backup/preflight tools are expanded; no owned JSON import or import-preview result is claimed here.' },
      { source: source('EvidenceReviewArchiveComparison'), reason: 'Real archive selectors are expanded and exercised; no two-archive comparison result or export is claimed here.' },
      { source: source('TrashWorkspacePanel'), reason: 'Restore/delete confirmations are cancelled; no operation result/history or ambiguous-write state is fabricated.' },
      { source: source('DailyNotesPanel'), reason: 'Existing date, calendar navigation and filtered empty state only; no creation timeout, uncertainty or retry record is fabricated.' },
      { source: source('TemplateLibrary'), reason: 'Only the actual template index and filtered empty state are read; no template creation, persisted draft, removal or recovery result is fabricated.' },
    ] }, noteIDs: notes.map(file => file.id) }
}

export async function ensureNavigationSidebar({ evaluate, click, until }, expanded) {
  const selector = '.workspace-sidebar [aria-label=' + q(expanded ? '展开侧边栏' : '折叠侧边栏') + ']'
  if (await evaluate(`Boolean(document.querySelector(${q(selector)}))`)) await click(selector)
  await until(() => evaluate(`document.querySelector('.workspace-sidebar')?.classList.contains('collapsed')===${!expanded}`), 'Actual sidebar did not change expansion state')
  if (!expanded) return

  const observe = () => evaluate(`(() => {
    const sidebar=document.querySelector('.workspace-sidebar'), library=sidebar?.querySelector('.file-list');
    const expand=sidebar?.querySelector('button[aria-label="展开侧边栏"]'), bounds=expand?.getBoundingClientRect();
    return {present:Boolean(sidebar),collapsed:Boolean(sidebar?.classList.contains('collapsed')),narrow:innerWidth<=720,
      library:Boolean(library),tree:Boolean(library?.querySelector('.tree-list')),loading:Boolean(library?.querySelector(':scope > .placeholder')),
      expandVisible:Boolean(bounds&&bounds.width>0&&bounds.height>0)};
  })()`)
  const ready = state => state.present && !state.collapsed && state.library && state.tree && !state.loading
  let correctiveExpansionRequested = false
  await until(async () => {
    let state = await observe()
    if (ready(state)) {
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
      state = await observe()
      if (ready(state)) return true
    }
    // The first expansion was observed above. FileList's initial real selection
    // can fold the narrow sidebar again; correct only that observed transition.
    if (!correctiveExpansionRequested && state.narrow && state.collapsed && state.expandVisible) {
      correctiveExpansionRequested = true
      await click(selector)
    }
    return false
  }, 'Actual navigation surface missing: .file-list')
}

export async function verifyNavigationPages(ctx) {
  const { evaluate, click, cdp, until, shared, api, setup, matrix } = ctx
  const fixture = setup.navigation
  assert.ok(fixture?.primary?.id && fixture?.daily?.id && fixture?.trashed?.id)
  const exists = selector => evaluate(`Boolean(document.querySelector(${q(selector)}))`)
  const present = selector => until(() => exists(selector), 'Actual navigation surface missing: ' + selector)
  const absent = selector => until(async () => !(await exists(selector)), 'Actual navigation surface did not close: ' + selector)
  const textVisible = (root, text) => until(() => evaluate(`document.querySelector(${q(root)})?.innerText.includes(${q(text)})===true`), 'Actual navigation text missing: ' + text)
  const button = (root, text) => click({ selector: root + ' button', text })
  const shot = (routeId, stateId, anchors, requiredText = []) => {
    const route = routeFor(routeId)
    return shared.captureState({ routeId, stateId, root: route.stateRoots?.[stateId] ?? route.root, anchors, requiredText })
  }
  const focus = (routeId, stateId, selector) => shared.focus(selector, { routeId, stateId })
  const row = file => '.file-list [data-file-id=' + q(safeId(file.id)) + ']'
  const ensureSidebar = expanded => ensureNavigationSidebar(ctx, expanded)
  const notes = async () => {
    await shared.closeSearch(); await shared.closeSettings()
    await click('.workspace-sidebar [aria-label="笔记"]'); await ensureSidebar(true)
    await until(() => evaluate("!document.querySelector('.file-list > .placeholder')"), 'Actual file tree did not finish reading')
  }
  // FileList debounces its actual backend read. An old matching row alone is
  // not completion evidence: require the expected included AND excluded owned
  // records after loading finishes, without adding an artificial sleep.
  const filterLibrary = async (value, included, excluded = []) => {
    await shared.text('.file-list input[aria-label="搜索笔记"]', value)
    await until(() => evaluate(`(()=>{const root=document.querySelector('.file-list');return !!root?.querySelector('.tree-list')&&!root.querySelector(':scope > .placeholder')&&root.querySelector('input[aria-label="搜索笔记"]')?.value===${q(value)}&&${q(included.map(file => file.id))}.every(id=>root.querySelector('[data-file-id='+JSON.stringify(id)+']'))&&${q(excluded.map(file => file.id))}.every(id=>!root.querySelector('[data-file-id='+JSON.stringify(id)+']'))})()`), 'Actual debounced file results did not match the current owned query')
  }
  const openNote = async file => {
    await notes(); await filterLibrary('', [fixture.primary, fixture.alternate])
    await filterLibrary(file.title, [file], [file.id === fixture.primary.id ? fixture.alternate : fixture.primary])
    await click(row(file) + ' .title')
    const marker = file.id === fixture.primary.id ? fixture.expectedBodyMarker : fixture.marker + '-BODY-ALTERNATE'
    await until(() => evaluate(`(()=>{const n=document.querySelector('.editor-input');return !!n?.isContentEditable&&n.innerText.includes(${q(marker)})&&!document.querySelector('.editor-quit-veil')})()`), 'Actual editor did not finish opening the owned navigation note')
  }
  const more = async () => {
    await shared.closeSearch(); await shared.closeSettings(); await shared.collapseSidebar()
    if (!(await exists('.workspace-sidebar-more-menu'))) await click('.workspace-sidebar [aria-label="更多功能"]')
    await present('.workspace-sidebar-more-menu')
  }
  const rightClick = async selector => {
    await shared.ensureVisible(selector)
    const point = await evaluate(`(()=>{const ns=[...document.querySelectorAll(${q(selector)})];if(ns.length!==1)throw Error('Ambiguous context target');const n=ns[0],b=n.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,h=document.elementFromPoint(x,y);if(!h||!(h===n||n.contains(h)))throw Error('Context target obscured');return{x,y}})()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none' })
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'right', clickCount: 1 })
    await present('.file-context-menu')
  }
  const menuLabel = text => click({ selector: '.file-list [role="menu"] .menu-item-label', text })
  const cancelConfirm = async (state, expected) => {
    await present('.consumer-confirm-modal'); await textVisible('.consumer-confirm-modal', expected)
    if (state === 'move-to-trash') await focus('nav-confirm', state, '.consumer-confirm-modal button:first-of-type')
    await shot('nav-confirm', state, ['#consumer-confirm-title', '.consumer-confirm-modal button:first-of-type'], [expected])
    await button('.consumer-confirm-modal', '取消'); await absent('.consumer-confirm-modal')
  }
  const selectorCancel = async state => {
    await present('.selector-modal')
    if (state === 'save-location') await focus('nav-file-selector', state, '.selector-modal [aria-label="关闭"]')
    await shot('nav-file-selector', state, ['#selector-dialog-title', '.selector-modal [aria-label="关闭"]'])
    await button('.selector-modal', '取消'); await absent('.selector-modal')
  }
  const empty = async (routeId, selector, text) => {
    await shared.text(selector, noMatch); await textVisible(routeFor(routeId).root, text)
    await shot(routeId, 'empty-filter', [selector], [text]); await shared.text(selector, '')
  }
  const protectedData = async () => ({ notes: await Promise.all(fixture.notes.map(file => api(noteRoute(file.id)))),
    folder: await api(noteRoute(fixture.folder.id)), trash: await api('/api/files/trash'), templates: await api('/api/template-library') })
  const before = await protectedData()
  const shortcutsBefore = await evaluate("localStorage.getItem('local-notepad.shortcuts.v1')")
  const templateDraftBefore = await evaluate("localStorage.getItem('localNotepad.templateDraft.v1')")

  // Actual note entry owns recent-history tracking; no localStorage seeding.
  await openNote(fixture.alternate); await openNote(fixture.primary); await notes()
  await filterLibrary('', [fixture.primary, fixture.alternate])
  await focus('nav-sidebar', 'expanded', '.workspace-sidebar [aria-label="更多功能"]')
  await shot('nav-sidebar', 'expanded', ['.workspace-sidebar [aria-label="笔记"]', '.workspace-sidebar [aria-label="更多功能"]'])
  await ensureSidebar(false)
  await focus('nav-sidebar', 'collapsed', '.workspace-sidebar [aria-label="展开侧边栏"]')
  await shot('nav-sidebar', 'collapsed', ['.workspace-sidebar [aria-label="展开侧边栏"]', '.workspace-sidebar [aria-label="每日笔记"]'])
  await ensureSidebar(true); await present(row(fixture.primary))
  await focus('nav-library', 'populated', '.file-list input[aria-label="搜索笔记"]')
  await shot('nav-library', 'populated', ['.file-list input[aria-label="搜索笔记"]', row(fixture.primary) + ' .title'], [fixture.marker])
  await filterLibrary(fixture.primary.title, [fixture.primary], [fixture.alternate])
  await shot('nav-library', 'long-title-filter', ['.file-list input[aria-label="搜索笔记"]', row(fixture.primary) + ' .title'], [fixture.marker])
  await filterLibrary(noMatch, [], fixture.notes)
  await textVisible('.file-list', '没有找到匹配的笔记')
  await shot('nav-library', 'empty-filter', ['.file-list input[aria-label="搜索笔记"]'], ['没有找到匹配的笔记'])
  await filterLibrary('', [fixture.primary, fixture.alternate])

  await click('.file-list [aria-label="新建"]'); await present('.file-list [role="menu"][aria-label="新建"]')
  await focus('nav-file-menus', 'new', '.file-list [role="menu"] button:first-child')
  await shot('nav-file-menus', 'new', ['.file-list [role="menu"] button:first-child'], ['新建笔记', '新建文件夹'])
  await menuLabel('新建笔记'); await present('.template-selector')
  await focus('nav-template-picker', 'default', '.template-selector [aria-label="关闭"]')
  await shot('nav-template-picker', 'default', ['#template-title', '.template-selector .primary-template'], ['空白笔记'])
  await button('.template-selector', '管理我的模板'); await present('.template-library')
  await until(() => evaluate("/\\d+ 个模板/.test(document.querySelector('.template-library-index')?.innerText||'')&&!document.querySelector('.template-library-index [role=alert]')"), 'Actual template index did not finish its readonly load')
  const templateSearch = '.template-library-index input:not([type="checkbox"])'
  await focus('nav-template-library', 'default', templateSearch)
  await shot('nav-template-library', 'default', ['#template-library-title', templateSearch], ['我的模板库'])
  await empty('nav-template-library', templateSearch, '没有匹配的模板。')
  await button('.template-library', '返回模板选择'); await absent('.template-library'); await present('.template-selector')
  assert.equal(await evaluate("localStorage.getItem('localNotepad.templateDraft.v1')"), templateDraftBefore, 'Readonly template navigation must not create or replace a persisted draft')
  await click('.template-selector .primary-template'); await present('.name-dialog')
  await focus('nav-naming', 'new-note', '.name-dialog-input')
  await shot('nav-naming', 'new-note', ['#name-dialog-title', '.name-dialog-input'], ['新建笔记'])
  await click('.name-dialog-options-toggle'); await present('.name-dialog-options')
  await shared.select('.name-dialog [data-ui-control="select"] [role="combobox"]', { routeId: 'nav-naming', stateId: 'format-popup', value: '.txt', restore: true })
  await button('.name-dialog-options', '更改'); await selectorCancel('save-location')
  await shared.text('.name-dialog-input', 'invalid:name')
  await button('.name-dialog', '确定'); await textVisible('.name-dialog .modal-error', '名称不能包含')
  await shot('nav-naming', 'invalid-name', ['.name-dialog-input', '.name-dialog .modal-error'], ['名称不能包含'])
  await shared.text('.name-dialog-input', '仅为界面验收而输入的较长中文草稿名称不会保存到数据库')
  await shot('nav-naming', 'long-name', ['.name-dialog-input', '.name-dialog-options-toggle'], ['新建笔记'])
  await button('.name-dialog', '取消'); await absent('.name-dialog')
  await click('.file-list [aria-label="新建"]'); await menuLabel('新建文件夹'); await present('.name-dialog')
  await shared.text('.name-dialog-input', '仅预览而不创建的长名称目录')
  await shot('nav-naming', 'new-folder', ['.name-dialog-input'], ['新建文件夹'])
  await button('.name-dialog', '取消'); await absent('.name-dialog')

  await rightClick(row(fixture.primary) + ' .title')
  await shot('nav-file-menus', 'context', ['.file-context-menu button:first-child'], ['重命名', '移到回收站'])
  await menuLabel('重命名'); await present('.name-dialog')
  await shared.text('.name-dialog-input', fixture.primary.title.replace(/\.md$/, '') + '—未提交修改')
  await shot('nav-naming', 'rename-note', ['.name-dialog-input'], ['重命名笔记'])
  await button('.name-dialog', '取消'); await absent('.name-dialog')
  // The real onBeforeRename chain reads incoming Wiki references before any
  // title PUT. Keep the original rename/cancel case above and separately enter
  // that real impact review, then cancel before either title or source writes.
  await rightClick(row(fixture.primary) + ' .title'); await menuLabel('重命名'); await present('.name-dialog')
  await shared.text('.name-dialog-input', fixture.primary.title.replace(/\.md$/, '') + '—引用预检后取消')
  await button('.name-dialog', '确定'); await present('.reference-refactor-dialog')
  await textVisible('.reference-refactor-source-list', fixture.reference.title)
  await focus('nav-reference-refactor', 'rename-impact', '.reference-refactor-dialog [aria-label="关闭"]')
  await shot('nav-reference-refactor', 'rename-impact', ['#reference-refactor-title', '.reference-refactor-actions button:first-child'], ['改名前检查引用影响', fixture.primary.title, fixture.reference.title, '标题需同步'])
  await button('.reference-refactor-dialog', '取消'); await absent('.reference-refactor-dialog'); await absent('.name-dialog')
  assert.deepEqual(await api(noteRoute(fixture.primary.id)), before.notes.find(note => note.id === fixture.primary.id), 'Cancelling the original pre-rename review must not write its target')
  await rightClick(row(fixture.alternate) + ' .title'); await menuLabel('移到回收站')
  await cancelConfirm('move-to-trash', fixture.alternate.title)
  await click('.file-list [aria-label="更多笔记操作"]'); await present('.file-more-menu')
  await shot('nav-file-menus', 'library', ['.file-more-menu [data-local-export-entry]'], ['批量整理'])
  await click('.file-more-menu [data-local-export-entry]'); await selectorCancel('export')
  await click('.file-list [aria-label="更多笔记操作"]')
  await click('.file-more-menu .menu-item.danger'); await selectorCancel('batch-delete')

  await shared.enterWorkspace('每日笔记', '.daily-notes-panel')
  await textVisible('.daily-recent-list', fixture.daily.title)
  await focus('nav-daily', 'populated', '.daily-notes-panel [aria-label="查找每日笔记"]')
  await shot('nav-daily', 'populated', ['.daily-notes-panel [aria-label="查找每日笔记"]', '.daily-workspace-heading'], [fixture.daily.title])
  const month = await evaluate("document.querySelector('.daily-workspace-heading').innerText")
  await click('.daily-notes-panel [aria-label="上个月"]')
  await until(() => evaluate(`document.querySelector('.daily-workspace-heading').innerText!==${q(month)}`), 'Actual daily month did not change')
  await shot('nav-daily', 'previous-month', ['.daily-workspace-heading', '.daily-notes-panel [aria-label="下个月"]'])
  await click('.daily-notes-panel [aria-label="下个月"]')
  await empty('nav-daily', '.daily-notes-panel [aria-label="查找每日笔记"]', '没有匹配日期的记录')

  await shared.enterWorkspace('最近访问', '.recent-workspace')
  const recentRow = '.recent-workspace [data-recent-note-id=' + q(fixture.primary.id) + ']'
  await present(recentRow)
  await focus('nav-recent', 'populated', '.recent-workspace [aria-label="查找访问记录"]')
  await shot('nav-recent', 'populated', ['.recent-workspace [aria-label="查找访问记录"]', recentRow], [fixture.primary.title])
  await click(recentRow); await present('.recent-detail h3')
  await shot('nav-recent', 'selected', ['.recent-detail h3', '.recent-detail button:first-of-type'], [fixture.primary.title])
  await button('.recent-detail', '仅移除这条历史…'); await cancelConfirm('remove-recent', '仅移除这条访问历史？')
  await button('.recent-workspace', '清空访问历史…'); await cancelConfirm('clear-recent', '清空本机访问历史？')
  await empty('nav-recent', '.recent-workspace [aria-label="查找访问记录"]', '没有匹配的访问记录')

  await shared.enterWorkspace('置顶笔记', '.pinned-workspace')
  const pinnedRow = '.pinned-workspace [data-pinned-note-id=' + q(fixture.primary.id) + ']'
  await present(pinnedRow)
  await focus('nav-pinned', 'populated', '.pinned-workspace [aria-label="查找置顶笔记"]')
  await shot('nav-pinned', 'populated', [pinnedRow, '.pinned-workspace [aria-label="查找置顶笔记"]'], [fixture.primary.title])
  await shared.select('.pinned-workspace [aria-label="置顶显示范围"]', { routeId: 'nav-pinned', stateId: 'scope-popup', value: 'all', restore: true })
  await shared.select('.pinned-workspace [aria-label="置顶笔记排序"]', { routeId: 'nav-pinned', stateId: 'order-popup', value: 'title', restore: true })
  await click(pinnedRow)
  await shot('nav-pinned', 'selected', ['.pinned-detail h3', '.pinned-detail button:first-of-type'], [fixture.primary.title])
  await button('.pinned-detail', '取消这篇笔记置顶…'); await cancelConfirm('unpin', '取消这篇笔记置顶？')
  await empty('nav-pinned', '.pinned-workspace [aria-label="查找置顶笔记"]', '没有匹配的笔记')

  await shared.enterWorkspace('知识图谱', '.local-graph')
  const graphRow = '.local-graph [data-graph-note-id=' + q(fixture.reference.id) + ']'
  await shared.text('.local-graph [aria-label="搜索知识图谱中的笔记"]', fixture.marker)
  await present(graphRow); await present('.local-graph svg [data-graph-node-id]')
  await focus('nav-graph', 'populated', '.local-graph [aria-label="搜索知识图谱中的笔记"]')
  await shot('nav-graph', 'populated', ['.local-graph [aria-label="搜索知识图谱中的笔记"]', '.local-graph-stats'], [fixture.marker])
  await shared.select('.local-graph [aria-label="图谱关系范围"]', { routeId: 'nav-graph', stateId: 'scope-popup', value: 'connected', restore: true })
  await click(graphRow); await textVisible('.local-graph-detail', fixture.primary.title)
  await shot('nav-graph', 'selected', ['.local-graph-detail h3', '.local-graph-detail button:first-of-type'], [fixture.reference.title, fixture.primary.title])
  await button('.local-graph-detail', '查看一跳关联'); await textVisible('.local-graph-stats', '聚焦一跳关系')
  await shot('nav-graph', 'one-hop', ['.local-graph-stats', '.local-graph-detail h3'], ['聚焦一跳关系'])
  await button('.local-graph', '清除筛选'); await present('.local-graph svg [data-graph-node-id]')
  const transform = await evaluate("document.querySelector('.graph-svg > g')?.getAttribute('transform')")
  await click('.local-graph [aria-label="放大图谱"]')
  await until(() => evaluate(`document.querySelector('.graph-svg > g')?.getAttribute('transform')!==${q(transform)}`), 'Actual graph zoom did not change its drawing transform')
  await shot('nav-graph', 'zoomed', ['.local-graph [aria-label="放大图谱"]', '.local-graph-stats'])
  await button('.local-graph', '重置视图')
  await empty('nav-graph', '.local-graph [aria-label="搜索知识图谱中的笔记"]', '没有匹配笔记')

  await more()
  await focus('nav-more-menu', 'default', '.workspace-sidebar-more-menu button:first-child')
  await shot('nav-more-menu', 'default', ['.workspace-sidebar-more-menu button:first-child'], ['备份与恢复', '快捷键'])
  await button('.workspace-sidebar-more-menu', '回收站'); await present('.trash-workspace')
  const trashRow = '.trash-workspace [data-trash-id=' + q(fixture.trashed.id) + ']'
  await present(trashRow)
  await focus('nav-trash', 'populated', '.trash-workspace [aria-label="查找已删除项目"]')
  await shot('nav-trash', 'populated', ['.trash-workspace [aria-label="查找已删除项目"]', trashRow + ' .trash-item-title'], [fixture.trashed.title])
  await shared.select('.trash-workspace [aria-label="回收站类型"]', { routeId: 'nav-trash', stateId: 'type-popup', value: 'note', restore: true })
  await shared.select('.trash-workspace [aria-label="回收站排序"]', { routeId: 'nav-trash', stateId: 'order-popup', value: 'title', restore: true })
  await empty('nav-trash', '.trash-workspace [aria-label="查找已删除项目"]', '没有匹配的项目')
  await present(trashRow); await click(trashRow + ' input[type="checkbox"]')
  await shot('nav-trash', 'selected', ['.trash-select-all', trashRow + ' .trash-item-title'], ['恢复所选'])
  await button('.trash-workspace', '恢复所选'); await present('.trash-workspace-dialog')
  await focus('nav-trash-confirm', 'restore', '.trash-workspace-dialog button:first-child')
  await shot('nav-trash-confirm', 'restore', ['#trash-confirm-title', '.trash-workspace-dialog button:first-child'], [fixture.trashed.title, '确认恢复'])
  await button('.trash-workspace-dialog', '取消'); await absent('.trash-workspace-dialog')
  await button('.trash-workspace', '永久删除所选'); await present('.trash-workspace-dialog')
  assert.equal(await evaluate("[...document.querySelectorAll('.trash-workspace-dialog button')].find(n=>n.textContent.trim()==='确认永久删除')?.disabled"), true)
  await shared.text('.trash-workspace-dialog [aria-label="输入永久删除确认"]', '仅验证取消，不执行删除')
  assert.equal(await evaluate("[...document.querySelectorAll('.trash-workspace-dialog button')].find(n=>n.textContent.trim()==='确认永久删除')?.disabled"), true)
  await shot('nav-trash-confirm', 'delete-locked', ['.trash-workspace-dialog [aria-label="输入永久删除确认"]', '#trash-confirm-title'], ['永久删除无法撤销'])
  await button('.trash-workspace-dialog', '取消'); await absent('.trash-workspace-dialog')
  await button('.trash-workspace', '取消选择')

  await more(); await button('.workspace-sidebar-more-menu', '备份与恢复'); await present('.backup-center-modal')
  await until(() => evaluate("document.querySelector('.backup-list')?.getAttribute('aria-busy')==='false'"), 'Actual database backup list has not settled')
  await textVisible('.backup-list', '份数据库备份')
  await focus('nav-backup', 'database', '.backup-center-modal [aria-label="关闭备份中心"]')
  await shot('nav-backup', 'database', ['#backup-dialog-title', '#backup-tab-database'], ['正文数据库备份', '工作区便携包'])
  await focus('nav-workspace-package', 'available', '.backup-center-workspace .backup-center-actions button:first-child')
  await shot('nav-workspace-package', 'available', ['.backup-center-workspace h3', '.backup-center-workspace .backup-center-actions button:first-child'], ['.lnw v1', '预检恢复 .lnw'])
  await click('.backup-center-restore-guide > summary')
  await shot('nav-backup', 'restore-guide', ['.backup-center-restore-guide > summary'], ['正文数据库备份'])
  await click('#backup-tab-reviews'); await present('.backup-center-modal .evidence-review-archives')
  await shot('nav-backup', 'review-shelf', ['.backup-center-counts', '.evidence-review-archives-tools button'], ['所有项目的核对存档'])
  await click('.backup-center-modal .evidence-review-backup > summary')
  await click('.backup-center-modal .review-archive-comparison > summary')
  await shared.select('.backup-center-modal [aria-label="对比基准存档"]', { routeId: 'nav-backup', stateId: 'review-tools', value: '', restore: true, captureScene: false })
  await shot('nav-backup', 'review-tools', ['.backup-center-modal .evidence-review-backup > summary', '.backup-center-modal [aria-label="对比基准存档"]'], ['整包备份与导入预检', '对比两份核对存档'])
  await click('.backup-center-modal [aria-label="关闭备份中心"]'); await absent('.backup-center-modal')

  await more(); await button('.workspace-sidebar-more-menu', '快捷键'); await present('.local-shortcuts-settings')
  await focus('nav-shortcuts', 'default', '.local-shortcuts-settings [aria-label="搜索快捷键"]')
  await shot('nav-shortcuts', 'default', ['#shortcuts-dialog-title', '.local-shortcuts-settings [aria-label="搜索快捷键"]'], ['当前快捷键已生效'])
  await shared.select('.local-shortcuts-settings [aria-label="操作分类"]', { routeId: 'nav-shortcuts', stateId: 'category-popup', value: '全局', restore: true })
  await empty('nav-shortcuts', '.local-shortcuts-settings [aria-label="搜索快捷键"]', '没有匹配的操作')
  await click('.local-shortcuts-settings [data-shortcut-edit="quickSwitch"]'); await present('#shortcut-recorder')
  await shot('nav-shortcuts', 'recording', ['#shortcut-recorder'], ['为“快速切换笔记”设置快捷键'])
  await click('#shortcut-recorder'); await shared.key('a')
  await textVisible('#shortcut-recording-feedback', '需要搭配 Ctrl')
  await shot('nav-shortcuts', 'invalid-recording', ['#shortcut-recorder', '#shortcut-recording-feedback'], ['需要搭配 Ctrl'])
  await button('.local-shortcuts-recorder-actions', '取消录入'); await absent('#shortcut-recorder')
  await click('.local-shortcuts-settings [aria-label="清除快速切换笔记快捷键"]')
  await textVisible('.local-shortcuts-status', '项修改待应用')
  await shot('nav-shortcuts', 'draft', ['.local-shortcuts-settings [data-shortcut-edit="quickSwitch"]', '.local-shortcuts-status'], ['待应用'])
  await click('.local-shortcuts-settings [aria-label="关闭快捷键设置"]'); await present('.local-shortcuts-confirmation')
  await shot('nav-shortcuts', 'discard-confirmation', ['.local-shortcuts-confirmation button:first-child'], ['还有未应用的修改'])
  await button('.local-shortcuts-confirmation', '放弃修改并关闭'); await absent('.local-shortcuts-settings')
  assert.equal(await evaluate("localStorage.getItem('local-notepad.shortcuts.v1')"), shortcutsBefore, 'Discarded shortcut drafts must preserve exact persisted bytes')

  await shared.collapseSidebar(); await click('.workspace-sidebar [aria-label="打开快捷操作"]'); await present('.local-actions')
  await focus('nav-local-actions', 'default', '.local-actions [aria-label="查找本地功能"]')
  await shot('nav-local-actions', 'default', ['.local-actions [aria-label="查找本地功能"]', '.local-actions [aria-label="关闭快捷操作"]'], ['快捷操作'])
  await shared.select('.local-actions [aria-label="本地功能分类"]', { routeId: 'nav-local-actions', stateId: 'category-popup', value: '查找', restore: true })
  await empty('nav-local-actions', '.local-actions [aria-label="查找本地功能"]', '没有匹配的本地功能')
  await shared.text('.local-actions [aria-label="查找本地功能"]', '快速切换笔记')
  await present('.local-actions [data-local-action="quickSwitch"]')
  await shot('nav-local-actions', 'filtered', ['.local-actions [aria-label="查找本地功能"]', '.local-actions [data-local-action="quickSwitch"]'], ['快速切换笔记'])
  await click('.local-actions [data-local-action="quickSwitch"]'); await absent('.local-actions'); await present('.quick-switcher')
  await until(() => evaluate("document.querySelector('#quick-switcher-results')?.getAttribute('aria-busy')==='false'"), 'Actual QuickSwitcher default read did not finish')
  await present('#quick-result-' + fixture.primary.id)
  await focus('nav-quick-switcher', 'default', '.quick-switcher [aria-label="搜索标题或正文"]')
  await shot('nav-quick-switcher', 'default', ['.quick-switcher [aria-label="搜索标题或正文"]'], ['最近修改 · 置顶优先'])
  await shared.text('.quick-switcher [aria-label="搜索标题或正文"]', fixture.primary.title)
  await present('#quick-result-' + fixture.primary.id)
  await textVisible('#quick-result-' + fixture.primary.id + ' .quick-switcher-result-title', fixture.primary.title)
  await shot('nav-quick-switcher', 'title-results', ['.quick-switcher [aria-label="搜索标题或正文"]', '#quick-result-' + fixture.primary.id], [fixture.primary.title])
  await shared.text('.quick-switcher [aria-label="搜索标题或正文"]', fixture.expectedBodyMarker)
  await textVisible('#quick-result-' + fixture.primary.id, '正文命中')
  await shot('nav-quick-switcher', 'body-results', ['.quick-switcher [aria-label="搜索标题或正文"]', '#quick-result-' + fixture.primary.id], ['正文命中'])
  await empty('nav-quick-switcher', '.quick-switcher [aria-label="搜索标题或正文"]', '没有找到匹配的笔记')
  await click('.quick-switcher [aria-label="关闭快速搜索"]'); await absent('.quick-switcher')
  await notes(); await filterLibrary('', [fixture.primary, fixture.alternate]); await shared.collapseSidebar()
  const after = await protectedData()
  assert.deepEqual(after, before, 'Navigation, drafts and cancelled confirmations must not change any owned note, folder, pin or trash record')
  assert.equal(await evaluate("localStorage.getItem('localNotepad.templateDraft.v1')"), templateDraftBefore)
  ctx.report.fullAppUi.navigationChecks ??= []
  ctx.report.fullAppUi.navigationChecks.push({ matrix, noteIDs: fixture.notes.map(file => file.id), unchanged: true,
    beforeSHA256: sha(q(before)), afterSHA256: sha(q(after)), shortcutsBytesUnchanged: true, templateDraftBytesUnchanged: true,
    actualRecentVisits: [fixture.alternate.id, fixture.primary.id], openCoverage: fixture.openCoverage,
    boundary: 'Actual controls and readonly local navigation only; no backend mutations after setup, no native file dialogs or sync actions.' })
  ctx.save()
}
