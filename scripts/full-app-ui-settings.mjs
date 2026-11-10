import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

// This module is an installed-application verifier. It never mounts a component,
// replaces a bridge or writes React/storage state. Only prepareSettings creates
// explicitly owned synthetic backend fixtures before the observation matrix.
export const settingsRoutes = [
  { id: 'settings-main', title: '设置主页', source: 'src/components/SettingsPanel.jsx', root: '.settings-panel', requiredStates: ['default', 'diagnostics'] },
  { id: 'appearance', title: '本地主题方案', source: 'src/components/AppearanceCenter.jsx', root: '.appearance-center', stateRoots: { 'discard-confirmation': '.appearance-center .appearance-confirm' }, requiredStates: ['default', 'long-draft', 'invalid-color', 'discard-confirmation'] },
  { id: 'tags', title: '标签工作台', source: 'src/components/TagWorkspace.jsx', root: '.tag-workspace', stateRoots: { 'draft-confirmation': '.tag-workspace [aria-label="确认标签工作台操作"]' }, requiredStates: ['populated', 'merge-popup', 'empty', 'draft-confirmation'] },
  { id: 'folders', title: '文件夹整理', source: 'src/components/FolderWorkspace.jsx', root: '.folder-workspace', stateRoots: { 'name-confirmation': '.folder-workspace [aria-label="确认目录操作"]' }, requiredStates: ['populated', 'empty', 'name-confirmation'] },
  { id: 'statistics', title: '笔记库统计', source: 'src/components/LibraryStatistics.jsx', root: '.library-statistics', stateRoots: { 'export-confirmation': '.library-statistics [aria-label="确认统计导出"]' }, requiredStates: ['populated', 'scope-popup', 'empty', 'export-confirmation'] },
  { id: 'comparison', title: '双笔记比较', source: 'src/components/NoteComparison.jsx', root: '.note-comparison', stateRoots: { 'export-confirmation': '.note-comparison [aria-label="确认笔记比较导出"]' }, requiredStates: ['sources', 'empty', 'comparison', 'mode-popup', 'export-confirmation'] },
  { id: 'history', title: '历史中心', source: 'src/components/HistoryReview.jsx', root: '.history-review', stateRoots: { 'export-confirmation': '.history-review [aria-label="确认导出历史对照"]' }, requiredStates: ['sources', 'snapshot', 'mode-popup', 'empty', 'export-confirmation'] },
  { id: 'duplicates', title: '重复笔记检查', source: 'src/components/DuplicateNotes.jsx', root: '.duplicate-notes', stateRoots: { 'export-confirmation': '.duplicate-notes [aria-label="确认重复报告导出"]' }, requiredStates: ['groups', 'members', 'sort-popup', 'empty', 'export-confirmation'] },
  { id: 'tasks', title: '待办任务中心', source: 'src/components/TaskCenter.jsx', root: '.task-center', stateRoots: { 'export-confirmation': '.task-center [aria-label="确认待办报告导出"]' }, requiredStates: ['populated', 'status-popup', 'empty', 'export-confirmation'] },
  { id: 'attachments', title: '附件检查中心', source: 'src/components/AttachmentAudit.jsx', root: '.attachment-audit', stateRoots: { 'export-confirmation': '.attachment-audit [aria-label="确认附件报告导出"]' }, requiredStates: ['populated', 'scope-popup', 'empty', 'export-confirmation'] },
  { id: 'trash-recovery', title: '回收站恢复', source: 'src/components/TrashRecovery.jsx', root: '.trash-recovery', stateRoots: { 'restore-confirmation': '.trash-recovery [aria-label="确认恢复操作"]' }, requiredStates: ['populated', 'type-popup', 'destination-popup', 'empty', 'restore-confirmation'] },
  { id: 'reference-health', title: '全库引用体检', source: 'src/components/LibraryReferenceHealthPanel.jsx', root: '.library-reference-health', requiredStates: ['default', 'diagnosis', 'repair-preview'] },
  { id: 'sync-presentation', title: '同步本地设置展示', source: 'src/components/SyncCenterPanel.jsx', root: '.sync-center-card', requiredStates: ['default', 'long-draft', 'restored'] },
  { id: 's3-read', title: 'S3 检查输入展示', source: 'src/components/S3ReadInspectionPanel.js', root: '.s3-inspection', requiredStates: ['default', 'long-draft', 'cleared'] },
  { id: 's3-overview', title: '本地只读盘点', source: 'src/components/S3LocalOverviewPanel.jsx', root: '.local-inventory', requiredStates: ['default', 'populated', 'offline-tools'] },
]

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const json = JSON.stringify
const noMatch = '不存在的界面验收筛选结果-ONLY-SYNTHETIC-000000'
const longDraft = '界面验收草稿：中文与长名称的换行、输入框和取消操作均应保持可用'
const by = (root, label) => `${root} [aria-label=${json(label)}]`
const identity = value => { assert.match(String(value), /^[A-Za-z0-9_-]+$/); return String(value) }
const filePath = id => '/api/files/' + encodeURIComponent(identity(id))
const sameConfiguration = settings => Object.fromEntries(Object.entries(settings).filter(([key]) =>
  /^(sync_enabled|sync_provider|sync_endpoint|sync_username|sync_password|sync_auto_enabled|sync_interval_minutes)$/.test(key)))

export async function prepareSettings(ctx) {
  const { api, readAsset } = ctx
  assert.equal(typeof readAsset, 'function', 'The owned runner must verify real uploaded attachment bytes')
  const marker = 'FULL-UI-' + randomUUID().slice(0, 8)
  const post = (route, value) => api(route, { method: 'POST', body: json(value) })
  const note = async (title, content, parent_id = '') => {
    const created = await post('/api/files', { title: `${marker} ${title}`, content, parent_id, is_folder: false })
    assert.ok(created?.id); identity(created.id)
    const saved = await api(filePath(created.id))
    assert.equal(saved.content, content); assert.equal(saved.is_folder, false)
    return saved
  }
  const folder = await post('/api/files', { title: `${marker} 很长的资料目录名称用于检查路径与控件布局`, is_folder: true, parent_id: '' })
  assert.ok(folder?.id && folder.is_folder); identity(folder.id)
  const a = await note('比较甲：较长标题与中文标点用于检查多行文字的显示', '# 第一篇合成笔记\n\n保留的共同段落\n\n甲侧不同内容。', folder.id)
  const b = await note('比较乙：仅本机验收笔记', '# 第二篇合成笔记\n\n保留的共同段落\n\n乙侧不同内容。')
  let historyNote = await note('历史来源', '# 历史保存正文\n\n第一份真实快照。')
  const oldHistory = historyNote.content
  await api(filePath(historyNote.id) + '/versions/snapshot', { method: 'POST' })
  await api(filePath(historyNote.id), { method: 'PUT', body: json({ content: '# 当前保存正文\n\n更新后的本机合成内容。' }) })
  historyNote = await api(filePath(historyNote.id))
  const versions = await api(filePath(historyNote.id) + '/versions')
  const historyVersion = versions.find(item => item.content === oldHistory)
  assert.ok(historyVersion?.id, 'The real retained snapshot must exist before history UI coverage')
  const duplicateBody = '# 完全相同的合成正文\n\n两篇独立的普通笔记。\n'
  const duplicates = [await note('重复分组一', duplicateBody), await note('重复分组二', duplicateBody)]
  const todoNote = await note('待办来源', '# 本机待办\n\n- [ ] 未完成的较长合成任务，检查中文换行和来源标题\n- [x] 已完成的合成任务\n')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=', 'base64')
  const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), marker + '.png')
  const upload = await api('/api/upload', { method: 'POST', body: form })
  assert.match(upload.url, /^\/uploads\/[A-Za-z0-9_-]+\.png$/)
  const downloaded = await readAsset(upload.url)
  assert.deepEqual(Buffer.from(downloaded), png, 'The actual stored attachment must match the original fixture bytes')
  const attachmentNote = await note('附件来源', `# 合成附件\n\n![一张真实上传的合成图片](${upload.url})\n`)
  const referenceBody = json({ root: { type: 'root', version: 1, format: '', indent: 0, direction: null, children: [
    { type: 'paragraph', version: 1, format: '', indent: 0, direction: null, children: [
      { type: 'wiki-link', version: 1, id: a.id, title: '本机验收的旧标题', sectionPath: [] },
    ] },
  ] } })
  const referenceNote = await note('引用体检来源', referenceBody)
  const trashNote = await note('仅供预览取消的回收站笔记', '# 本机回收站合成数据\n\n禁止在视觉检查中实际恢复或永久删除。')
  await api(filePath(trashNote.id), { method: 'DELETE' })
  const trash = await api('/api/files/trash')
  assert.ok(trash.some(item => item.id === trashNote.id && item.is_deleted), 'Only the just-created synthetic note may enter trash')
  const tags = [
    await post('/api/tags', { name: `${marker} 中文较长分类名称用于布局检查`, color: '#7057d9' }),
    await post('/api/tags', { name: `${marker} 未使用的合成分类`, color: '#287448' }),
  ]
  for (const tag of tags) identity(tag.id)
  await post(filePath(a.id) + '/tags', { file_id: a.id, tag_id: tags[0].id })
  const notes = [a, b, historyNote, ...duplicates, todoNote, attachmentNote, referenceNote]
  const settings = { marker, notes, comparison: [a, b], historyNote, historyVersionId: String(historyVersion.id),
    duplicates, todoNote, tags, folders: [folder], trashNotes: [trashNote], referenceNote,
    attachment: { url: upload.url, filename: upload.url.split('/').at(-1), bytes: png.length, sha256: digest(png), noteId: attachmentNote.id } }
  return { settings, noteIDs: notes.map(item => item.id) }
}

export async function verifySettingsPages(ctx) {
  const { api, evaluate, click, until, shared, setup, matrix } = ctx
  const fixture = setup.settings
  assert.ok(fixture?.comparison?.length === 2 && fixture.attachment?.url && fixture.historyVersionId, 'Complete real Settings fixtures are required')
  const roots = Object.fromEntries(settingsRoutes.map(route => [route.id, route.root]))
  const rootOf = (routeId, stateId) => { assert.ok(roots[routeId]); return settingsRoutes.find(route => route.id === routeId).stateRoots?.[stateId] ?? roots[routeId] }
  const exists = selector => evaluate(`Boolean(document.querySelector(${json(selector)}))`)
  const present = selector => until(() => exists(selector), 'Actual Settings surface did not mount: ' + selector)
  const absent = selector => until(async () => !(await exists(selector)), 'Actual Settings surface did not close: ' + selector)
  const ready = selector => until(() => evaluate(`(()=>{const n=document.querySelector(${json(selector)});return !!n&&!n.disabled&&!n.closest('fieldset:disabled')})()`), 'Actual control did not become ready: ' + selector)
  const contains = (root, text) => until(() => evaluate(`document.querySelector(${json(root)})?.textContent.includes(${json(text)}) === true`), 'Expected current Settings text is missing: ' + text)
  const press = (root, text) => click({ selector: root + ' button', text })
  const type = async (selector, value) => { await ready(selector); await shared.ensureVisible(selector); await shared.text(selector, value) }
  const shot = (routeId, stateId, anchors, requiredText = [], extra = {}) => shared.captureState({ routeId, stateId, root: rootOf(routeId, stateId), anchors, requiredText, ...extra })
  const open = async (routeId, label, control) => {
    await press('.settings-panel', label); await present(rootOf(routeId))
    if (control) await ready(control)
  }
  const close = async (routeId, label) => { await press(rootOf(routeId), label); await absent(rootOf(routeId)) }
  const empty = async (routeId, selector, text, restore = '') => {
    await type(selector, noMatch); await contains(rootOf(routeId), text)
    await shot(routeId, 'empty', [selector], [text]); await type(selector, restore)
  }
  const confirmAndCancel = async (routeId, opener, dialogLabel, cancel, stateId = 'export-confirmation') => {
    const root = rootOf(routeId), dialog = by(root, dialogLabel)
    await press(root, opener); await present(dialog)
    await shot(routeId, stateId, [dialog + ' button:first-of-type'], [cancel])
    await press(dialog, cancel); await absent(dialog)
  }
  const untouched = async () => ({
    notes: await Promise.all(fixture.notes.map(note => api(filePath(note.id)))),
    folders: await Promise.all(fixture.folders.map(folder => api(filePath(folder.id)))),
    tags: await api('/api/tags'), links: await api(filePath(fixture.comparison[0].id) + '/tags'),
    trash: await api('/api/files/trash'), versions: await api(filePath(fixture.historyNote.id) + '/versions'),
    sync: sameConfiguration(await api('/api/settings')),
  })
  // The production toggle has a decorative arrow span, and Ant Design may
  // wrap both spans. Bind the unique actual button but check the exact leaf
  // label (not the wrapper or decorative glyph) and pre/post ARIA state.
  const toggleDiagnostics = async (label, expectedExpanded) => {
    const selector = '.settings-panel .settings-advanced-toggle'
    await until(() => evaluate(`(()=>{const b=document.querySelector(${json(selector)});return !!b&&!b.disabled&&[...b.querySelectorAll('span')].some(span=>span.childElementCount===0&&span.textContent.trim()===${json(label)})&&b.getAttribute('aria-expanded')===${json(String(!expectedExpanded))}})()`), 'Actual diagnostic toggle label or initial state mismatch: ' + label)
    await click(selector)
    await until(() => evaluate(`document.querySelector(${json(selector)})?.getAttribute('aria-expanded')===${json(String(expectedExpanded))}`), 'Actual diagnostic toggle did not change state: ' + label)
  }
  const before = await untouched()
  assert.equal(Boolean(before.sync.sync_enabled), false, 'The synthetic Settings profile must have sync disabled')
  await shared.openSettings()
  await contains('.settings-panel', '本地数据正常')
  await shared.focus('.settings-toolbar [aria-label="返回笔记"]', { routeId: 'settings-main', stateId: 'default' })
  await shot('settings-main', 'default', ['.settings-toolbar [aria-label="返回笔记"]'], ['常用选项和本地数据都集中在这里。'])
  await toggleDiagnostics('高级诊断', true); await present('.settings-advanced-panel')
  await shot('settings-main', 'diagnostics', ['.settings-advanced-header'], ['本机诊断信息'])
  await toggleDiagnostics('收起高级诊断', false); await absent('.settings-advanced-panel')

  // Theme editing stays in the original uncommitted draft, then is discarded.
  await open('appearance', '管理主题方案', '.appearance-center button[data-appearance-close]')
  await shared.focus('.appearance-center button[data-appearance-close]', { routeId: 'appearance', stateId: 'default' })
  await shot('appearance', 'default', ['.appearance-center button[data-appearance-close]'], ['本地主题方案'])
  await press('.appearance-center', '复制为自定义方案')
  await type(by('.appearance-center', '方案名称'), longDraft)
  await shot('appearance', 'long-draft', [by('.appearance-center', '方案名称'), by('.appearance-center', '浅色强调色')], [longDraft])
  const originalColor = await evaluate(`document.querySelector(${json(by('.appearance-center', '浅色强调色'))}).value`)
  await type(by('.appearance-center', '浅色强调色'), 'invalid')
  await contains('.appearance-center [role="alert"]', '颜色必须是六位十六进制值')
  await shot('appearance', 'invalid-color', [by('.appearance-center', '浅色强调色'), '.appearance-feedback-area'], ['颜色必须是六位十六进制值'])
  await type(by('.appearance-center', '浅色强调色'), originalColor)
  await press('.appearance-center', '关闭主题方案中心'); await present('.appearance-confirm')
  await shot('appearance', 'discard-confirmation', ['.appearance-confirm'], ['继续编辑'])
  await press('.appearance-confirm', '继续编辑'); await absent('.appearance-confirm')
  await press('.appearance-center', '关闭主题方案中心'); await present('.appearance-confirm')
  await press('.appearance-confirm', '确认'); await absent('.appearance-center')

  await open('tags', '打开标签工作台', by('.tag-workspace', '工作台标签名称'))
  await click(`.tag-workspace [data-workspace-tag=${json(identity(fixture.tags[0].id))}]`)
  await contains('.tag-workspace-notes', fixture.comparison[0].title)
  await shared.focus(by('.tag-workspace', '工作台查找标签'), { routeId: 'tags', stateId: 'populated' })
  await shot('tags', 'populated', [by('.tag-workspace', '工作台查找标签'), '.tag-workspace-list'], [fixture.tags[0].name])
  await shared.select(by('.tag-workspace', '合并目标标签'), { routeId: 'tags', stateId: 'merge-popup', value: fixture.tags[1].id, restore: true })
  await empty('tags', by('.tag-workspace', '工作台查找标签'), '没有符合筛选条件的标签。')
  await type(by('.tag-workspace', '工作台标签名称'), '尚未保存的本机验收标签')
  await confirmAndCancel('tags', '创建标签', '确认标签工作台操作', '取消', 'draft-confirmation')
  await type(by('.tag-workspace', '工作台标签名称'), '')
  await close('tags', '关闭标签工作台')

  await open('folders', '打开文件夹整理', by('.folder-workspace', '文件夹内容查找'))
  await present(`.folder-workspace [data-folder-item=${json(identity(fixture.folders[0].id))}]`)
  await shared.focus(by('.folder-workspace', '文件夹内容查找'), { routeId: 'folders', stateId: 'populated' })
  await shot('folders', 'populated', [by('.folder-workspace', '文件夹内容查找'), `.folder-workspace [data-folder-item=${json(identity(fixture.folders[0].id))}] > button`], [fixture.folders[0].title])
  await empty('folders', by('.folder-workspace', '文件夹内容查找'), '当前目录没有符合查找条件的项目。')
  await type(by('.folder-workspace', '整理文件夹名称'), '仅预览取消的较长文件夹名称')
  await confirmAndCancel('folders', '预览名称操作', '确认目录操作', '取消操作', 'name-confirmation')
  await type(by('.folder-workspace', '整理文件夹名称'), '')
  await close('folders', '关闭文件夹整理')

  await open('statistics', '打开笔记库统计', by('.library-statistics', '统计标题查找'))
  await contains('.statistics-notes', fixture.comparison[0].title)
  await shared.focus(by('.library-statistics', '统计标题查找'), { routeId: 'statistics', stateId: 'populated' })
  await shot('statistics', 'populated', ['.statistics-cards', by('.library-statistics', '统计范围')], ['普通笔记'])
  await shared.select(by('.library-statistics', '统计范围'), { routeId: 'statistics', stateId: 'scope-popup', value: 'untagged', restore: true })
  await empty('statistics', by('.library-statistics', '统计标题查找'), '没有符合条件的普通笔记。')
  await confirmAndCancel('statistics', '导出统计', '确认统计导出', '取消导出')
  await close('statistics', '关闭笔记库统计')

  await open('comparison', '打开双笔记比较', by('.note-comparison', '比较笔记查找'))
  await shared.focus(by('.note-comparison', '比较笔记查找'), { routeId: 'comparison', stateId: 'sources' })
  await shot('comparison', 'sources', [by('.note-comparison', '比较笔记查找'), '.note-comparison-selection'], ['尚未选择'])
  await empty('comparison', by('.note-comparison', '比较笔记查找'), '没有匹配的普通笔记。')
  for (let side = 0; side < 2; side++) {
    const note = fixture.comparison[side]
    await type(by('.note-comparison', '比较笔记查找'), note.title)
    await press(`.note-comparison [data-compare-note=${json(identity(note.id))}]`, side ? '设为右侧' : '设为左侧')
  }
  await press('.note-comparison', '开始比较'); await ready(by('.note-comparison', '笔记比较模式'))
  await present('.note-comparison-lines')
  await shot('comparison', 'comparison', [by('.note-comparison', '笔记比较模式'), '.note-comparison-line-head'], ['保存文本差异'], { allowHorizontalScroll: ['.note-comparison-lines'] })
  await shared.select(by('.note-comparison', '笔记比较模式'), { routeId: 'comparison', stateId: 'mode-popup', value: 'raw', restore: true })
  await confirmAndCancel('comparison', '导出比较报告', '确认笔记比较导出', '取消导出')
  await close('comparison', '关闭双笔记比较')

  await open('history', '打开历史中心', by('.history-review', '历史中心查找笔记'))
  await present(`.history-review [data-history-file=${json(identity(fixture.historyNote.id))}]`)
  await shared.focus(by('.history-review', '历史中心查找笔记'), { routeId: 'history', stateId: 'sources' })
  await shot('history', 'sources', [by('.history-review', '历史中心查找笔记')], ['选择笔记'])
  await click(`.history-review [data-history-file=${json(identity(fixture.historyNote.id))}]`)
  const version = `.history-review [data-history-version=${json(fixture.historyVersionId)}]`
  await ready(version); await click(version)
  await ready(by('.history-review', '历史对照模式')); await present('.history-review-diff')
  await shot('history', 'snapshot', [by('.history-review', '历史对照模式'), '.history-review-row.headings'], [fixture.historyNote.title], { allowHorizontalScroll: ['.history-review-diff'] })
  await shared.select(by('.history-review', '历史对照模式'), { routeId: 'history', stateId: 'mode-popup', value: 'raw', restore: true })
  await empty('history', by('.history-review', '历史中心查找快照'), '没有匹配快照')
  await confirmAndCancel('history', '导出历史对照报告', '确认导出历史对照', '取消导出')
  await close('history', '关闭历史中心')

  await open('duplicates', '打开重复笔记检查', by('.duplicate-notes', '重复笔记查找'))
  await type(by('.duplicate-notes', '重复笔记查找'), fixture.marker + ' 重复分组')
  await until(() => evaluate("document.querySelectorAll('.duplicate-notes-groups [data-duplicate-group]').length === 1"), 'The owned duplicate pair must form exactly one filtered group')
  await shared.focus(by('.duplicate-notes', '重复笔记查找'), { routeId: 'duplicates', stateId: 'groups' })
  await shot('duplicates', 'groups', ['.duplicate-notes-groups button', by('.duplicate-notes', '重复分组排序')], ['保存正文相同'])
  await press('.duplicate-notes-groups', '查看整组')
  await present(`.duplicate-notes [data-duplicate-note=${json(identity(fixture.duplicates[0].id))}]`)
  await shot('duplicates', 'members', [`.duplicate-notes [data-duplicate-note=${json(identity(fixture.duplicates[0].id))}] button`], [fixture.duplicates[0].title, fixture.duplicates[1].title])
  await press('.duplicate-notes', '返回分组')
  await shared.select(by('.duplicate-notes', '重复分组排序'), { routeId: 'duplicates', stateId: 'sort-popup', value: 'updated', restore: true })
  await empty('duplicates', by('.duplicate-notes', '重复笔记查找'), '没有符合条件的完全相同正文组。')
  await confirmAndCancel('duplicates', '导出重复报告', '确认重复报告导出', '取消导出')
  await close('duplicates', '关闭重复笔记检查')

  await open('tasks', '打开待办任务中心', by('.task-center', '待办查找'))
  await present(`.task-center [data-task-note=${json(identity(fixture.todoNote.id))}]`)
  await shared.focus(by('.task-center', '待办查找'), { routeId: 'tasks', stateId: 'populated' })
  await shot('tasks', 'populated', [`.task-center [data-task-note=${json(identity(fixture.todoNote.id))}][data-done="false"] button`, by('.task-center', '待办状态')], ['未完成的较长合成任务'])
  await shared.select(by('.task-center', '待办状态'), { routeId: 'tasks', stateId: 'status-popup', value: 'all', restore: true })
  await empty('tasks', by('.task-center', '待办查找'), '当前筛选没有已识别的未完成待办。')
  await confirmAndCancel('tasks', '导出待办报告', '确认待办报告导出', '取消导出')
  await close('tasks', '关闭待办任务中心')

  await open('attachments', '打开附件检查中心', by('.attachment-audit', '附件名称查找'))
  await contains('.attachment-audit-items', fixture.attachment.filename)
  await press('.attachment-audit-items', fixture.attachment.filename)
  await contains('.attachment-audit-sources', fixture.notes.find(note => note.id === fixture.attachment.noteId).title)
  await shared.focus(by('.attachment-audit', '附件名称查找'), { routeId: 'attachments', stateId: 'populated' })
  await shot('attachments', 'populated', [by('.attachment-audit', '附件名称查找'), '.attachment-audit-sources h3'], [fixture.attachment.filename])
  await shared.select(by('.attachment-audit', '附件检查范围'), { routeId: 'attachments', stateId: 'scope-popup', value: 'available', restore: true })
  await empty('attachments', by('.attachment-audit', '附件名称查找'), '没有符合条件的附件条目。')
  await confirmAndCancel('attachments', '导出检查报告', '确认附件报告导出', '取消导出')
  await close('attachments', '关闭附件检查中心')

  await open('trash-recovery', '打开回收站恢复', by('.trash-recovery', '恢复项目查找'))
  const trashed = `.trash-recovery [data-recovery-item=${json(identity(fixture.trashNotes[0].id))}]`
  await present(trashed)
  await shared.focus(by('.trash-recovery', '恢复项目查找'), { routeId: 'trash-recovery', stateId: 'populated' })
  await shot('trash-recovery', 'populated', [trashed, by('.trash-recovery', '恢复项目类型')], [fixture.trashNotes[0].title])
  await shared.select(by('.trash-recovery', '恢复项目类型'), { routeId: 'trash-recovery', stateId: 'type-popup', value: 'note', restore: true })
  await empty('trash-recovery', by('.trash-recovery', '恢复项目查找'), '没有匹配的普通回收站项目。')
  await click('.trash-recovery input[name="recovery-mode"]:not(:checked)')
  await ready(by('.trash-recovery', '恢复目标文件夹'))
  await shared.select(by('.trash-recovery', '恢复目标文件夹'), { routeId: 'trash-recovery', stateId: 'destination-popup', value: fixture.folders[0].id, restore: true })
  await click(trashed + ' input[type="checkbox"]')
  await confirmAndCancel('trash-recovery', '预览整批恢复', '确认恢复操作', '取消操作', 'restore-confirmation')
  await close('trash-recovery', '关闭恢复工作台')

  // Read-only reference diagnosis exposes the real repair preview but never
  // invokes its snapshot/write action.
  await present('.library-reference-health')
  await shared.focus('.library-reference-health-head > button', { routeId: 'reference-health', stateId: 'default' })
  await shot('reference-health', 'default', ['.library-reference-health-head'], ['全库引用体检'])
  await press('.library-reference-health', '开始扫描')
  await present('.library-reference-health-summary')
  await contains('.library-reference-diagnosis-list', fixture.referenceNote.title)
  await shot('reference-health', 'diagnosis', ['.library-reference-health-summary', '.library-reference-health-toolbar'], ['可安全修复'])
  await press('.library-reference-health', '预览安全修复'); await present('.library-reference-repair-preview')
  await shot('reference-health', 'repair-preview', ['.library-reference-repair-header'], ['修复前差异预览', fixture.referenceNote.title])
  await press('.library-reference-health', '收起修复预览'); await absent('.library-reference-repair-preview')

  // Connection UI is exercised only as local uncommitted input. No credentials
  // are entered, no sync switch is changed and no check/probe action is clicked.
  await ready(by('.sync-center-card', 'WebDAV 端点'))
  const endpoint = by('.sync-center-card', 'WebDAV 端点')
  const oldEndpoint = await evaluate(`document.querySelector(${json(endpoint)}).value`)
  await shared.focus(endpoint, { routeId: 'sync-presentation', stateId: 'default' })
  await shot('sync-presentation', 'default', [endpoint, by('.sync-center-card', 'WebDAV 密码')], ['本地实验室', 'WebDAV'])
  await type(endpoint, 'https://synthetic.invalid/本机界面验收/较长的目标地址/不保存也不请求')
  await shot('sync-presentation', 'long-draft', [endpoint, by('.sync-center-card', 'WebDAV 密码')], ['有尚未保存的配置'])
  await type(endpoint, oldEndpoint)
  await until(() => evaluate(`!document.querySelector('.sync-center-card .sync-draft-notice')`), 'Uncommitted sync field was not restored')
  await shot('sync-presentation', 'restored', [endpoint], ['同步中心'])

  await press('.s3-inspection', '打开云端只读检查'); await ready('.s3-inspection input[name="endpoint"]')
  await shared.focus('.s3-inspection input[name="endpoint"]', { routeId: 's3-read', stateId: 'default' })
  await shot('s3-read', 'default', ['.s3-inspection-intro', '.s3-inspection input[name="endpoint"]'], ['只检查一个指定对象，不启用同步'])
  await type('.s3-inspection input[name="endpoint"]', 'https://synthetic.invalid')
  await type('.s3-inspection input[name="bucket"]', 'synthetic-bucket')
  await type('.s3-inspection input[name="key"]', '中文目录/一个较长的合成对象名称/不发起读取.json')
  await shot('s3-read', 'long-draft', ['.s3-inspection input[name="key"]', '.s3-inspection input[name="endpoint"]'], ['指定读取目标'])
  await press('.s3-inspection', '清空全部输入')
  assert.equal(await evaluate("[...document.querySelectorAll('.s3-inspection input[name]')].every(n=>n.value===(n.name==='maxBytes'?'1048576':''))"), true)
  await shot('s3-read', 'cleared', ['.s3-inspection-actions', '.s3-inspection-result'], ['本面板的目标与凭据输入已清空'])
  await press('.s3-inspection', '关闭并清空'); await absent('.s3-inspection-body')

  await shared.focus('.local-inventory > .local-inventory-actions > button', { routeId: 's3-overview', stateId: 'default' })
  await shot('s3-overview', 'default', ['.local-inventory > .local-inventory-actions > button', '.local-inventory-status'], ['本地只读盘点'])
  await press('.local-inventory-actions', '读取本地统计')
  await present('.local-inventory-totals')
  await shot('s3-overview', 'populated', ['.local-inventory-totals', '.local-inventory > .local-inventory-table'], ['本次盘点已完成'])
  await click('.local-inventory [data-local-report-file] > summary')
  await click('.local-inventory [data-offline-pair] > summary')
  await until(() => evaluate("document.querySelector('.local-inventory [data-local-report-file]').open && document.querySelector('.local-inventory [data-offline-pair]').open"), 'Actual local report tools did not expand')
  await shot('s3-overview', 'offline-tools', ['.local-inventory [data-local-report-file] > summary', '.local-inventory [data-offline-batch-toggle]'], ['读取范围与上限'])
  await shared.closeSettings()
  const after = await untouched()
  assert.deepEqual(after, before, 'Viewing/cancelling Settings routes must not modify fixtures, tags, trash, history or sync configuration')
  ctx.report.fullAppUi.settingsChecks ??= []
  ctx.report.fullAppUi.settingsChecks.push({ matrix, allRoutesVisited: settingsRoutes.map(route => route.id),
    unchanged: true, beforeSHA256: digest(json(before)), afterSHA256: digest(json(after)),
    attachment: fixture.attachment,
    exercisedActions: 'Local UI navigation, uncommitted noncredential text, filters, read-only local snapshots and cancelled confirmations',
    excludedActions: ['Sync execution or preview', 'Native cloud probe', 'Credential input', 'Apply/confirm a write or download'] })
  ctx.save()
}
