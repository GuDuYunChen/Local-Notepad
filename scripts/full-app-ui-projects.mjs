// Verifier-owned actual installed-app navigation. All setup writes belong to
// this run's isolated backend; page state changes use the real UI.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { desktopNote } from './desktop-save-fixture.mjs'

const source = name => 'src/components/' + name + '.jsx'
const q = JSON.stringify
const sha = value => createHash('sha256').update(value).digest('hex')
const archivePrefix = 'localNotepad.evidenceReview.archive.v1:'
const aliasNames = ['合成人物青岚', '合成地点临河', '合成伏笔旧信']
const trackTitle = '合成角色弧光——跨卷成长与关系变化的长标题'
export const projectsRoutes = Object.freeze([
  { id: 'projects-picker', title: '项目选择与操作', source: source('ProjectWorkspacePanel'), root: '.project-workspace-toolbar', requiredStates: ['primary-project', 'alternate-project', 'actions'] },
  { id: 'projects-today', title: '今日创作与冲刺', source: source('ProjectTodayCenter'), root: '.view-today', requiredStates: ['today', 'calendar-review'] },
  { id: 'projects-board', title: '项目卷章看板', source: source('ProjectWorkspacePanel'), root: '.view-project', requiredStates: ['board', 'empty-filter', 'chapter-form', 'bulk-controls', 'volume-manager'] },
  { id: 'projects-planning', title: '项目计划', source: source('ProjectPlanningPanel'), root: '.project-planning-panel', requiredStates: ['goals', 'milestones-queue'] },
  { id: 'projects-analysis', title: '创作与 Session 分析', source: source('ProjectAnalyticsPanel'), root: '.view-analysis', requiredStates: ['analytics', 'session-empty'] },
  { id: 'projects-insights', title: '创作洞察与复盘', source: source('ProjectInsightsPanel'), root: '.project-insights-panel', requiredStates: ['overview', 'report'] },
  { id: 'projects-structure', title: '故事地图与索引', source: source('ProjectStructurePanel'), root: '.project-structure-panel', requiredStates: ['map', 'empty-filter', 'storyline-indexes'] },
  { id: 'projects-storylines', title: '轨迹编辑与生命周期诊断', source: source('ProjectStructurePanel'), root: '.project-storyline-system', requiredStates: ['selected-track', 'lifecycle', 'diagnostics'] },
  { id: 'projects-relation-create', title: '实体与关系表单', source: source('ProjectRelationGraphPanel'), root: '.project-relation-create-grid', requiredStates: ['entity-form', 'relation-form'] },
  { id: 'projects-relations', title: '实体关系详情与演化', source: source('ProjectRelationGraphPanel'), root: '.project-relation-workspace', requiredStates: ['entity-detail', 'relation-detail', 'evolution'], stateRoots: { evolution: '.project-relation-timeline' } },
  { id: 'projects-entities', title: '实际实体别名', source: source('ProjectEntityIntelligencePanel'), root: '.project-entity-alias-editor', requiredStates: ['aliases', 'empty-selection'] },
  { id: 'projects-entity-heatmap', title: '真实正文实体热力图', source: source('ProjectEntityIntelligencePanel'), root: '.project-entity-heatmap-card', requiredStates: ['populated'] },
  { id: 'projects-relation-suggestions', title: '真实共现候选', source: source('ProjectRelationSuggestionsPanel'), root: '.project-relation-suggestions', requiredStates: ['candidates', 'empty-filter'] },
  { id: 'projects-evidence', title: '实体正文证据', source: source('ProjectEntityEvidencePanel'), root: '.project-entity-evidence-browser', requiredStates: ['populated', 'empty-filter'] },
  { id: 'projects-review', title: '真实证据连续核对', source: source('EvidenceReviewBar'), root: '.evidence-review-bar', requiredStates: ['current', 'notes', 'end-confirmation'], stateRoots: { 'end-confirmation': '.consumer-confirm-modal' } },
  { id: 'projects-archives', title: '实际核对存档', source: source('EvidenceReviewArchives'), root: '.evidence-review-archives', requiredStates: ['populated', 'restore-confirmation', 'delete-confirmation'], stateRoots: { 'restore-confirmation': '.consumer-confirm-modal', 'delete-confirmation': '.consumer-confirm-modal' } },
  { id: 'projects-archive-comparison', title: '两份实际核对存档比较', source: source('EvidenceReviewArchiveComparison'), root: '.review-archive-comparison', requiredStates: ['comparison', 'empty-filter'] },
  { id: 'projects-archive-backup', title: '实际核对备份预检', source: source('EvidenceReviewBackup'), root: '.evidence-review-backup', requiredStates: ['preflight', 'invalid-file'] },
  { id: 'projects-focus-session', title: '实际专注 Session', source: source('FocusSessionBar'), root: '.focus-session-bar', requiredStates: ['focused', 'ordinary-view'] },
  { id: 'projects-session-history', title: '已手动结束的真实 Session 分析', source: source('FocusSessionAnalyticsPanel'), root: '.focus-session-analytics-panel', requiredStates: ['completed'] },
])

const readArchives = evaluate => evaluate(`(()=>{const prefix=${q(archivePrefix)};return Object.keys(localStorage).filter(key=>key.startsWith(prefix)).sort().map(key=>({key,raw:localStorage.getItem(key)}))})()`)
const projectActions = ({ click, evaluate, until, shared }) => ({
  shown: selector => until(() => evaluate(`Boolean(document.querySelector(${q(selector)}))`), 'Project UI did not appear: ' + selector),
  absent: selector => until(() => evaluate(`!document.querySelector(${q(selector)})`), 'Project UI did not close: ' + selector),
  text: (selector, value) => until(() => evaluate(`document.querySelector(${q(selector)})?.textContent.includes(${q(value)})`), 'Project UI text missing: ' + value),
  button: (selector, text) => click({ selector: selector + ' button', text }),
  details: async (selector, open = true) => {
    const actual = await evaluate(`document.querySelector(${q(selector)})?.open`)
    assert.equal(typeof actual, 'boolean', 'Actual details control is missing: ' + selector)
    if (actual !== open) await click(selector + ' > summary')
    await until(() => evaluate(`document.querySelector(${q(selector)})?.open===${open}`), 'Actual details disclosure did not change')
  },
  structure: async projectID => {
    if (!(await evaluate("Boolean(document.querySelector('.project-workspace-panel'))"))) await shared.enterWorkspace('项目', '.project-workspace-panel')
    await shared.nativeSelect.choose('.project-workspace-panel [aria-label="选择项目"]', projectID)
    await click('.project-workspace-view-tabs [aria-keyshortcuts="Alt+6"]')
    await until(() => evaluate("Boolean(document.querySelector('.project-structure-panel'))"), 'Actual structure view did not mount')
  },
})

// Setup only: use the actual focused combobox's native keyboard opening path.
// The matrix below still tests pointer opening, Tab, repeated clicks and Escape.
export async function chooseProjectSetupAlias({ shared, evaluate, until, report, save }, requested) {
  const selector = '[aria-label="选择实体别名对象"]'
  assert.equal(typeof requested, 'string')
  const receipt = { selector, requested, scope: 'projects-setup-only', focusMethod: 'programmatic-focus',
    stage: 'ensure-visible', complete: false, openingKey: null, events: [] }
  ;(report.fullAppUi.setupInteractions ||= []).push(receipt); save()
  const record = stage => { receipt.stage = stage; save() }
  const check = state => {
    assert.equal(state?.count, 1, 'Project setup Select is missing or ambiguous')
    assert.equal(state.kind, 'shared'); assert.equal(state.disabled, false); assert.equal(state.multiple, false)
    assert.ok(typeof state.inputId === 'string' && state.inputId, 'Project setup Select has no actual combobox identity')
    if (receipt.before) assert.equal(state.inputId, receipt.before.inputId, 'Project setup combobox identity changed')
    return state
  }
  const trace = async () => {
    const observed = await evaluate(`({truncated:window.__fullAppUiTraceTruncated,events:window.__fullAppUiEvents.slice(${Number(receipt.firstEventIndex)})})`)
    receipt.events = observed.events; receipt.traceTruncated = observed.truncated; save()
    assert.equal(observed.truncated, false, 'Project setup interaction trace was truncated')
    assert.ok(Array.isArray(observed.events))
  }
  try {
    receipt.firstEventIndex = await evaluate('window.__fullAppUiEvents.length'); save()
    assert.ok(Number.isInteger(receipt.firstEventIndex) && receipt.firstEventIndex >= 0)
    await shared.ensureVisible(selector)
    receipt.before = await shared.nativeSelect.inspect(selector); save(); check(receipt.before)
    record('programmatic-focus')
    receipt.focus = await evaluate(`(() => {
      const matches=[...document.querySelectorAll(${q(selector)})];
      if(matches.length!==1)throw Error('Project setup Select identity is missing or ambiguous');
      const host=matches[0].closest('[data-ui-control="select"]'),fields=host?[...host.querySelectorAll('[role="combobox"]')]:[];
      if(fields.length!==1||fields[0].id!==${q(receipt.before.inputId)}||document.querySelectorAll('[id='+JSON.stringify(fields[0].id)+']').length!==1)throw Error('Project setup combobox identity changed before focus');
      const field=fields[0];if(field.matches(':disabled')||field.getAttribute('aria-disabled')==='true')throw Error('Project setup combobox became disabled');
      field.focus({preventScroll:true});
      return {method:'programmatic-focus',inputId:field.id,focused:document.activeElement===field,activeId:document.activeElement?.id||null};
    })()`)
    save(); assert.equal(receipt.focus.inputId, receipt.before.inputId); assert.equal(receipt.focus.focused, true)
    receipt.focusState = await shared.nativeSelect.inspect(selector); save(); check(receipt.focusState)
    assert.equal(receipt.focusState.focused, true, 'Actual project setup combobox did not retain focus')
    if (!receipt.focusState.expanded) {
      receipt.openingKey = 'ArrowDown'; record('native-keyboard-open')
      await shared.key('ArrowDown'); await trace()
    }
    record('await-own-popup')
    receipt.opened = await until(async () => {
      receipt.latestOpening = await shared.nativeSelect.inspect(selector); save()
      const state = check(receipt.latestOpening)
      assert.equal(state.focused, true, 'Actual project setup combobox lost focus before opening')
      return state.expanded && state.popupReady && state
    }, 'Actual project setup combobox did not open its own popup')
    save(); assert.ok(receipt.opened.popupId)
    record('original-option-pointer')
    receipt.committed = await shared.nativeSelect.choose(selector, requested); save(); check(receipt.committed)
    assert.equal(receipt.committed.value, requested); assert.equal(receipt.committed.expanded, false)
    await trace()
    receipt.trustedOpeningKey = receipt.openingKey === null ? null : receipt.events.some(event =>
      event.type === 'keydown' && event.key === 'ArrowDown' && event.trusted && event.id === receipt.before.inputId && event.role === 'combobox')
    receipt.trustedOwnOptionClick = receipt.events.some(event => event.type === 'click' && event.trusted &&
      event.option?.listboxId === receipt.opened.popupId && event.option.value === requested)
    save()
    if (receipt.openingKey !== null) assert.equal(receipt.trustedOpeningKey, true, 'Actual project setup opening key was not observed on its combobox')
    assert.equal(receipt.trustedOwnOptionClick, true, 'Actual project setup option pointer was not observed in its own popup')
    receipt.complete = true; record('complete'); return receipt.committed
  } catch (error) {
    receipt.error = { name: error.name, message: error.message, stack: error.stack }; record('failed')
    // Preserve the original input failure; reading its trace never replays it.
    if (Number.isInteger(receipt.firstEventIndex)) {
      try { await trace() } catch (traceError) { receipt.traceError = { name: traceError.name, message: traceError.message }; save() }
    }
    throw error
  }
}

export async function prepareProjects(ctx) {
  const { api, shared, evaluate, click, until, writeFixtureFile } = ctx
  const create = values => api('/api/files', { method: 'POST', body: JSON.stringify(values) })
  const project = await create({ title: '全应用界面验收——长篇创作项目与多卷章节导航及布局检查', is_folder: true, content: '' })
  const alternate = await create({ title: '另一个实际项目——切换后恢复原始卷章和索引', is_folder: true, content: '' })
  const volumes = []
  for (const title of ['第一卷——人物相遇与跨章节的长标题布局验证', '第二卷——地点与伏笔在真实索引中的交叉引用']) {
    volumes.push(await create({ title, parent_id: project.id, is_folder: true, content: '' }))
  }
  const notes = []
  for (const [index, title] of ['第一章 人物与项目开端的长标题', '第二章 地点变化与叙事转折', '第三章 未回收的伏笔线索', '第四章 最后的真实章节'].entries()) {
    notes.push(await create({ title: title + '.md', parent_id: volumes[Math.floor(index / 2)].id,
      content: desktopNote(title, 'full-app-project-' + index + ' — ' + aliasNames.join('、') + '在本章出现；这些是明确属于隔离验收数据的正文提及，页面观察不得改变此内容。') }))
  }
  const other = await create({ title: '独立项目的实际章节.md', parent_id: alternate.id,
    content: desktopNote('独立项目', 'full-app-project-alternate — 选择器切换应保持实际后端正文。') })
  const tags = []
  for (const [index, name] of ['人物', '地点', '伏笔'].entries()) {
    const tag = await api('/api/tags', { method: 'POST', body: JSON.stringify({ name }) })
    await api('/api/files/' + notes[index].id + '/tags', { method: 'POST', body: JSON.stringify({ file_id: notes[index].id, tag_id: tag.id }) })
    const actual = await api('/api/tags/' + tag.id + '/files')
    assert.ok(actual.some(file => file.id === notes[index].id), 'Synthetic project index did not persist')
    tags.push({ id: tag.id, name, noteID: notes[index].id })
  }
  const noteIDs = [...notes, other].map(file => file.id)
  const protectedNotes = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const ui = projectActions(ctx), entityIDs = notes.slice(0, 3).map(note => 'index:' + note.id)
  await ui.structure(project.id)
  await ui.shown('[aria-label="选择实体别名对象"]')
  for (const [index, alias] of aliasNames.entries()) {
    await chooseProjectSetupAlias(ctx, entityIDs[index])
    await shared.text('[aria-label="新增实体别名"]', alias)
    await ui.button('.project-entity-alias-add', '添加别名')
    await ui.shown('[aria-label=' + q('删除实体别名 ' + alias) + ']')
  }
  await shared.nativeSelect.choose('[aria-label="新建轨迹类型"]', 'character')
  await shared.nativeSelect.choose('[aria-label="关联现有索引"]', notes[0].id)
  await shared.text('[aria-label="轨迹名称"]', trackTitle)
  await ui.button('.project-storyline-create', '新建轨迹')
  await ui.shown('[aria-label="编辑轨迹名称"]')
  await shared.text('[aria-label="轨迹说明"]', '仅本机合成元数据：建立实际轨迹、生命周期节点和卷间诊断，不修改任何正文章节。')
  await shared.nativeSelect.choose('[aria-label="轨迹节点章节"]', notes[0].id)
  await shared.text('[aria-label="轨迹节点说明"]', '第一卷中首次确认的实际合成角色节点。')
  await ui.button('.project-storyline-event-form', '添加节点')
  await until(() => evaluate("document.querySelectorAll('.project-storyline-event').length===1"), 'Actual storyline event was not created')
  await shared.text('[aria-label="自定义实体名称"]', '合成守望者——较长世界观阵营名称')
  await shared.text('[aria-label="自定义实体说明"]', '真实实体表单创建的隔离项目元数据。')
  await ui.button('.project-relation-create-grid', '添加实体')
  await ui.text('.project-relation-detail', '合成守望者')
  await shared.nativeSelect.choose('[aria-label="关系源实体"]', entityIDs[0])
  await shared.nativeSelect.choose('[aria-label="关系目标实体"]', entityIDs[1])
  await shared.text('[aria-label="自定义关系标签"]', '本机合成人物与地点的长期关联')
  await shared.text('[aria-label="关系说明"]', '显式通过实际页面建立的关系，不把同章共现冒充已确认关系。')
  await ui.button('.project-relation-create-grid', '添加关系')
  // Select the real relation; the previously created entity still owns the detail pane.
  await click({ selector: '.project-relation-edges > g > text', text: '本机合成人物与地点的长期关联 · 关联' })
  await ui.shown('[aria-label="关系变化章节"]')
  await shared.nativeSelect.choose('[aria-label="关系变化章节"]', notes[3].id)
  await shared.text('[aria-label="关系变化说明"]', '第四章的实际合成关系演化记录。')
  await ui.button('.project-relation-evolution-form', '记录关系变化')
  await ui.shown('.project-relation-evolution-list > div')

  // Create two real snapshots through the normal evidence review UI. The
  // storage access below is read-only and records exactly those saved bytes.
  await chooseProjectSetupAlias(ctx, entityIDs[0])
  await until(() => evaluate("document.querySelectorAll('.project-entity-evidence-cards [data-evidence-chapter]').length===4"), 'Actual alias evidence did not cover all four owned chapters')
  const archiveBefore = await readArchives(evaluate); assert.deepEqual(archiveBefore, [], 'Project verifier requires its own empty archive shelf')
  await click('.project-entity-evidence-cards [data-evidence-chapter]:first-child header button')
  await ui.shown('.evidence-review-bar')
  await ui.button('.evidence-review-actions', '标记已核对')
  await ui.button('.evidence-review-bar .evidence-review-records-tools', '保存本地存档')
  await until(async () => (await readArchives(evaluate)).length === 1, 'First real review archive was not saved')
  await ui.details('.evidence-review-bar .evidence-review-records-details')
  await shared.text('.evidence-review-bar [aria-label="本章核对备注内容"]', '第二份存档中的较长合成备注：只记录本地核对元数据，原正文与实体关系结论保持不变。')
  await ui.button('.evidence-review-bar .evidence-review-note-editor', '标记待修改')
  await ui.button('.evidence-review-bar .evidence-review-records-tools', '保存本地存档')
  const archives = await until(async () => { const rows = await readArchives(evaluate); return rows.length === 2 && rows }, 'Second real review archive was not saved')
  const archived = archives.map(row => JSON.parse(row.raw))
  for (const archive of archived) {
    assert.equal(archive.data.projectId, project.id); assert.equal(archive.data.entityId, entityIDs[0])
    assert.deepEqual(new Set(archive.data.chapters.map(chapter => chapter.id)), new Set(notes.map(note => note.id)))
  }
  await ui.button('.evidence-review-bar .evidence-review-records-tools', '结束核对')
  await ui.shown('.consumer-confirm-modal')
  await ui.button('.consumer-confirm-modal', '确认结束并清除'); await ui.absent('.evidence-review-bar')
  const backup = Buffer.from(q({ format: 'local-notepad-evidence-review-backup', version: 1, exportedAt: new Date().toISOString(), archives: archived }))
  const validBackup = await writeFixtureFile({ name: 'owned-project-review-backup.json', bytes: backup })
  const invalidBackup = await writeFixtureFile({ name: 'owned-invalid-project-review-backup.json', bytes: Buffer.from('{"format":"invalid-owned-verifier-input"}') })
  for (const original of protectedNotes) assert.equal((await api('/api/files/' + original.id)).content, original.content, 'Actual setup metadata UI changed a protected chapter')
  return { kind: 'actual-backend-projects', projectID: project.id, alternateID: alternate.id,
    projectTitle: project.title, alternateTitle: alternate.title, volumeIDs: volumes.map(file => file.id),
    noteIDs, chapterIDs: notes.map(file => file.id), tags, entityIDs, aliasNames, trackTitle,
    archives: archives.map(row => ({ key: row.key, bytes: Buffer.byteLength(row.raw), sha256: sha(row.raw) })),
    archiveNamespaceSHA256: sha(q(archives)), validBackup, invalidBackup,
    setupActions: { actualEntityAliases: 3, actualCustomEntities: 1, actualRelations: 1, actualRelationEvents: 1, actualStorylines: 1, actualStorylineEvents: 1, actualArchives: 2, endedOwnReview: true },
    protectedNotes: protectedNotes.map(file => ({ id: file.id, contentSHA256: sha(file.content), recordSHA256: sha(q(file)), title: file.title, parent_id: file.parent_id })),
    permittedLocalState: ['selected project', 'active view', 'board and structure filters', 'unsubmitted chapter and storyline drafts', 'automatic project analytics snapshot', 'explicit actual-UI project metadata setup', 'owned transient review annotations; two actual setup archives remain unchanged', 'one real 25-minute planned focus session per matrix, manually ended without waiting or clock changes'],
    permittedNoteBodyWrites: [], forbiddenOperations: ['create chapter from page', 'delete', 'move', 'merge export', 'wait for a planned timer or accelerate any clock'] }
}

export async function verifyProjectsPages(ctx) {
  const { shared, click, evaluate, until, setup, api } = ctx
  assert.equal(setup.kind, 'actual-backend-projects')
  const picker = '.project-workspace-panel [aria-label="选择项目"]'
  const capture = async (routeId, stateId, anchors, requiredText = []) => {
    const route = projectsRoutes.find(item => item.id === routeId)
    assert.ok(route?.requiredStates.includes(stateId))
    return shared.captureState({ routeId, stateId, root: route.stateRoots?.[stateId] || route.root, anchors, requiredText,
      // The real board/map are intentional horizontally scrollable regions.
      // The shared observer still requires each recorded control to be reachable.
      allowHorizontalScroll: routeId === 'projects-board' ? ['.project-workspace-board'] :
        routeId === 'projects-structure' ? ['.project-story-map'] :
        routeId === 'projects-entity-heatmap' ? ['.project-entity-heatmap'] : [] })
  }
  const tab = async (id, number) => {
    const selector = '.project-workspace-view-tabs [aria-keyshortcuts="Alt+' + number + '"]'
    await click(selector)
    await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify('.view-' + id)})) && document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed')==='true'`), 'Actual project tab did not open: ' + id)
  }
  const pick = async id => {
    await shared.nativeSelect.choose(picker, id)
    await until(async () => (await shared.nativeSelect.inspect(picker)).value === id, 'Actual project selection did not commit')
  }
  const shown = selector => until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), 'Project region did not appear: ' + selector)
  const safeButton = async (selector, text) => click({ selector, text })

  await shared.enterWorkspace('项目', '.project-workspace-panel')
  await shown(picker); await pick(setup.projectID)
  await shared.focus(picker, { routeId: 'projects-picker', stateId: 'primary-project' })
  await shared.select(picker, { routeId: 'projects-picker', stateId: 'primary-project', value: setup.alternateID, restore: true, captureScene: false })
  assert.equal((await shared.nativeSelect.inspect(picker)).value, setup.projectID)
  await capture('projects-picker', 'primary-project', [picker, '.project-actions-trigger'], ['项目工作台'])
  await pick(setup.alternateID)
  await capture('projects-picker', 'alternate-project', [picker, '.project-workspace-kind'], ['项目工作台'])
  await pick(setup.projectID)
  await click('.project-actions-trigger'); await shown('.project-actions-menu')
  await capture('projects-picker', 'actions', ['.project-actions-menu-section > span', '.project-actions-trigger'], ['初始化项目模板', '刷新项目数据'])
  await click('.project-actions-trigger')
  await until(() => evaluate("!document.querySelector('.project-actions-menu')"), 'Project actions did not close')

  await tab('today', 1)
  await shared.focus('.project-today-center-actions button:first-child', { routeId: 'projects-today', stateId: 'today' })
  await capture('projects-today', 'today', ['.project-today-center-head > div:first-child > strong', '.project-today-center-actions button:first-child'], ['今日创作中心'])
  await shared.focus('[aria-label="今日写作复盘"]', { routeId: 'projects-today', stateId: 'calendar-review' })
  await capture('projects-today', 'calendar-review', ['.calendar-card > header > div:first-child > strong', '[aria-label="今日写作复盘"]', '.sprint-card > header > div > strong'], ['写作冲刺'])

  await tab('project', 2)
  const query = '[aria-label="搜索项目章节"]'
  await shown('.project-workspace-board')
  assert.equal(await evaluate("document.querySelectorAll('.project-volume-column').length"), 2)
  await shared.focus(query, { routeId: 'projects-board', stateId: 'board' })
  await shared.select('[aria-label="按章节状态筛选"]', { routeId: 'projects-board', stateId: 'board', value: 'draft', restore: true, captureScene: false })
  await shared.select('[aria-label="按卷筛选"]', { routeId: 'projects-board', stateId: 'board', value: setup.volumeIDs[1], restore: true, captureScene: false })
  await capture('projects-board', 'board', [query, '[aria-label="按卷筛选"]', '.project-volume-column:first-child .project-volume-copy > strong'], ['创作进度'])
  await shared.text(query, 'definitely-no-project-chapter-full-app')
  await until(() => evaluate("!document.querySelector('.project-volume-column')"), 'Actual board filter did not produce an empty state')
  await capture('projects-board', 'empty-filter', [query, '.project-board-filter-summary > strong'])
  await shared.text(query, ''); await shown('.project-volume-column')
  await click('.project-board-create-toggle'); await shown('.project-board-createbar')
  await shared.select('[aria-label="新建目标卷"]', { routeId: 'projects-board', stateId: 'chapter-form', value: setup.volumeIDs[1], restore: true, captureScene: false })
  await shared.focus('[aria-label="批量新增章节标题"]', { routeId: 'projects-board', stateId: 'chapter-form' })
  await capture('projects-board', 'chapter-form', ['[aria-label="批量新增章节标题"]', '[aria-label="新建目标卷"]'], ['批量创建'])
  await click('.project-board-create-toggle')
  await click('.project-board-select-toggle'); await shown('.project-board-bulkbar')
  await capture('projects-board', 'bulk-controls', ['.project-board-bulk-summary > strong'], ['选择当前结果'])
  await click('.project-board-select-toggle')
  await click('.project-volume-column:first-child .project-volume-settings'); await shown('.project-volume-manager')
  await shared.focus('.project-volume-manager [aria-label="卷名称"]', { routeId: 'projects-board', stateId: 'volume-manager' })
  await capture('projects-board', 'volume-manager', ['.project-volume-manager-head strong', '.project-volume-manager [aria-label="卷名称"]'], ['卷管理'])
  await safeButton('.project-volume-manager-head button', '关闭')

  await tab('planning', 3)
  await shared.focus('[aria-label="每日写作目标"]', { routeId: 'projects-planning', stateId: 'goals' })
  await capture('projects-planning', 'goals', ['[aria-label="每日写作目标"]', '[aria-label="项目完稿截止日期"]'], ['创作计划'])
  assert.ok(await evaluate("document.querySelectorAll('.project-milestone-row').length===2 && document.querySelectorAll('.project-queue-open').length>0"))
  await capture('projects-planning', 'milestones-queue', ['.project-milestone-row:first-child .project-milestone-copy > strong', '.project-plan-card.queue > header strong'])

  await tab('analysis', 4)
  await shared.focus('[aria-label="单章目标字数"]', { routeId: 'projects-analysis', stateId: 'analytics' })
  await capture('projects-analysis', 'analytics', ['.project-analytics-head strong', '[aria-label="单章目标字数"]'], ['创作分析'])
  // The alternate owned project never starts a Session. This preserves a
  // genuine empty-history state after the primary project gains real records.
  await pick(setup.alternateID)
  await shown('.focus-session-analytics-empty')
  await capture('projects-analysis', 'session-empty', ['.focus-session-analytics-empty > strong'], ['还没有 Session 数据'])
  await pick(setup.projectID)

  await tab('insights', 5)
  await shared.focus('.project-insights-period button:first-child', { routeId: 'projects-insights', stateId: 'overview' })
  await capture('projects-insights', 'overview', ['.project-insights-head > div:first-child > strong', '.project-insights-overview > div:first-child > span'], ['创作洞察与自动复盘'])
  await safeButton('.project-insights-period button', '30 天')
  await safeButton('.project-insight-report button', '预览报告'); await shown('.project-insight-report-preview')
  await capture('projects-insights', 'report', ['.project-insight-report > header strong'], ['自动月度复盘'])
  await safeButton('.project-insight-report button', '收起报告')

  await tab('structure', 6)
  await shown('.project-structure-indexes')
  await until(() => evaluate("document.querySelectorAll('.project-structure-indexes > article > div > button').length===3"), 'Actual project indexes did not load all three tagged notes')
  const structureQuery = '[aria-label="搜索故事地图"]'
  await shared.focus(structureQuery, { routeId: 'projects-structure', stateId: 'map' })
  await shared.select('[aria-label="故事地图索引筛选"]', { routeId: 'projects-structure', stateId: 'map', value: 'characters', restore: true, captureScene: false })
  await capture('projects-structure', 'map', [structureQuery, '.project-structure-indexes > article:first-child > header > strong'], ['长篇结构总览'])
  await shared.text(structureQuery, 'definitely-no-story-chapter-full-app')
  await until(() => evaluate("document.querySelector('.project-structure-filter-summary strong')?.textContent==='0'"), 'Actual structure filter did not produce zero chapters')
  await capture('projects-structure', 'empty-filter', [structureQuery, '.project-structure-filter-summary > strong'])
  await shared.text(structureQuery, '')
  await shared.select('[aria-label="新建轨迹类型"]', { routeId: 'projects-structure', stateId: 'storyline-indexes', value: 'character', restore: true, captureScene: false })
  await shared.focus('[aria-label="轨迹名称"]', { routeId: 'projects-structure', stateId: 'storyline-indexes' })
  await capture('projects-structure', 'storyline-indexes', ['[aria-label="轨迹名称"]', '.project-structure-indexes > article:first-child > header > strong'], ['故事线与生命周期', '人物'])
  await verifyProjectDetails(ctx, capture)
  await verifyProjectFocusSession(ctx, capture)

  for (const expected of setup.protectedNotes) {
    const actual = await api('/api/files/' + expected.id)
    assert.equal(createHash('sha256').update(actual.content).digest('hex'), expected.contentSHA256, 'Page observations changed a project note body')
    assert.equal(actual.title, expected.title); assert.equal(actual.parent_id, expected.parent_id)
    assert.equal(sha(q(actual)), expected.recordSHA256, 'Project page observations changed the complete original note record')
  }
  await click('.project-workspace-toolbar [aria-label="返回笔记"]')
  await until(() => evaluate("!document.querySelector('.project-workspace-panel')"), 'Actual project workspace did not close')
}

async function verifyProjectFocusSession(ctx, capture) {
  const { shared, setup, click, evaluate, until, report, save, matrix } = ctx, ui = projectActions(ctx)
  const history = () => evaluate(`JSON.parse(localStorage.getItem('localNotepad.focusSessions.v1')||'{}')[${q(setup.projectID)}]||[]`)
  const before = await history()
  await click('.project-workspace-view-tabs [aria-keyshortcuts="Alt+1"]')
  await ui.shown('.project-today-task-list > div:first-child [title="25 分钟专注"]')
  await click('.project-today-task-list > div:first-child [title="25 分钟专注"]')
  await ui.shown('.focus-session-bar')
  await ui.text('.focus-session-actions', '显示界面')
  await shared.focus('.focus-session-actions > button:first-child', { routeId: 'projects-focus-session', stateId: 'focused' })
  await capture('projects-focus-session', 'focused', ['.focus-session-actions > button:first-child'], ['专注 Session'])
  await ui.button('.focus-session-actions', '显示界面')
  await ui.text('.focus-session-actions', '继续专注')
  await capture('projects-focus-session', 'ordinary-view', ['.focus-session-actions > button:first-child'], ['专注 Session'])
  await ui.button('.focus-session-actions', '结束 Session'); await ui.absent('.focus-session-bar')
  const after = await until(async () => { const rows = await history(); return rows.length === before.length + 1 && rows }, 'Actual manual Session did not retain one real history record')
  const created = after.filter(row => !before.some(previous => previous.id === row.id))
  assert.equal(created.length, 1)
  const record = created[0]
  assert.equal(record.projectId, setup.projectID); assert.ok(setup.chapterIDs.includes(record.noteId))
  assert.equal(record.durationMinutes, 25); assert.equal(record.reason, 'manual'); assert.equal(record.completedTimer, false)
  assert.equal(record.wordDelta, 0); assert.ok(record.endedAt >= record.startedAt)
  assert.equal(record.elapsedSeconds, Math.floor((record.endedAt - record.startedAt) / 1000))
  assert.ok(record.elapsedSeconds < 25 * 60, 'This gate must not wait for the planned writing timer')
  ;(report.fullAppUi.projectSessions ||= []).push({ ...matrix, record, priorCount: before.length, afterCount: after.length, actualClock: true, manuallyEnded: true }); save()
  await ui.structure(setup.projectID)
  await click('.project-workspace-view-tabs [aria-keyshortcuts="Alt+4"]')
  await ui.shown('.focus-session-analytics-grid')
  await shared.focus('.focus-trend-switch > button:first-child', { routeId: 'projects-session-history', stateId: 'completed' })
  await capture('projects-session-history', 'completed', ['.focus-session-analytics-head strong', '.focus-trend-switch > button:first-child'], ['Session 分析与复盘', '少于 5 分钟的 Session 保留历史'])
}

async function verifyProjectDetails(ctx, capture) {
  const { shared, setup, click, evaluate, until } = ctx, ui = projectActions(ctx)
  const focus = (routeId, stateId, selector) => shared.focus(selector, { routeId, stateId })
  const select = (routeId, stateId, selector, value) => shared.select(selector, { routeId, stateId, value, restore: true, captureScene: false })
  const choose = shared.nativeSelect.choose
  const noMatch = '不存在的项目验收结果-ONLY-OWNED-934821'
  await click('.project-storyline-list > button:first-child')
  await ui.text('.project-storyline-editor-head', setup.trackTitle)
  await focus('projects-storylines', 'selected-track', '[aria-label="编辑轨迹名称"]')
  await capture('projects-storylines', 'selected-track', ['[aria-label="编辑轨迹名称"]', '[aria-label="轨迹说明"]'], [setup.trackTitle])
  await select('projects-storylines', 'lifecycle', '[aria-label="轨迹节点章节"]', setup.chapterIDs[3])
  await shared.selectPreview('[aria-label="轨迹生命周期阶段"]', { routeId: 'projects-storylines', stateId: 'lifecycle', captureScene: false })
  await capture('projects-storylines', 'lifecycle', ['[aria-label="轨迹节点说明"]', '.project-storyline-event > button:first-child'])
  await capture('projects-storylines', 'diagnostics', ['.project-storyline-diagnostics > header strong', '.project-storyline-matrix-row > button'], ['剧情线交叉与节奏诊断'])

  await focus('projects-relation-create', 'entity-form', '[aria-label="自定义实体名称"]')
  await select('projects-relation-create', 'entity-form', '[aria-label="自定义实体类型"]', 'object')
  await shared.text('[aria-label="自定义实体说明"]', '只用于布局观察的长草稿，不再次创建实体。'.repeat(6))
  await capture('projects-relation-create', 'entity-form', ['[aria-label="自定义实体名称"]', '[aria-label="自定义实体说明"]'], ['补充世界观实体'])
  await shared.text('[aria-label="自定义实体说明"]', '')
  await select('projects-relation-create', 'relation-form', '[aria-label="关系源实体"]', setup.entityIDs[0])
  await select('projects-relation-create', 'relation-form', '[aria-label="关系目标实体"]', setup.entityIDs[1])
  await select('projects-relation-create', 'relation-form', '[aria-label="新建关系类型"]', 'ally')
  await capture('projects-relation-create', 'relation-form', ['[aria-label="关系说明"]', '[aria-label="自定义关系标签"]'], ['建立关系'])

  await click('.project-relation-node.type-character')
  await focus('projects-relations', 'entity-detail', '.project-relation-detail > header > button')
  await capture('projects-relations', 'entity-detail', ['.project-relation-detail > header > button', '.project-relation-detail header strong'])
  await click('.project-relation-edges > g > text')
  await ui.shown('[aria-label="关系变化章节"]')
  await select('projects-relations', 'relation-detail', '[aria-label="关系变化章节"]', setup.chapterIDs[0])
  await select('projects-relations', 'relation-detail', '[aria-label="关系变化类型"]', 'strengthen')
  await select('projects-relations', 'relation-detail', '[aria-label="变化后的关系类型"]', 'ally')
  await capture('projects-relations', 'relation-detail', ['[aria-label="关系变化说明"]', '.project-relation-current-state > strong'])
  await capture('projects-relations', 'evolution', ['.project-relation-timeline-chapter'], ['关系演化时间轴'])

  await choose('[aria-label="选择实体别名对象"]', setup.entityIDs[0])
  await focus('projects-entities', 'aliases', '[aria-label="新增实体别名"]')
  await select('projects-entities', 'aliases', '[aria-label="选择实体别名对象"]', setup.entityIDs[1])
  await capture('projects-entities', 'aliases', ['[aria-label="新增实体别名"]', '[aria-label=' + q('删除实体别名 ' + setup.aliasNames[0]) + ']'], [setup.aliasNames[0]])
  await choose('[aria-label="选择实体别名对象"]', '')
  await capture('projects-entities', 'empty-selection', ['[aria-label="选择实体别名对象"]'])
  await choose('[aria-label="选择实体别名对象"]', setup.entityIDs[0])
  await focus('projects-entity-heatmap', 'populated', '[aria-label="实体热力图显示数量"]')
  await select('projects-entity-heatmap', 'populated', '[aria-label="实体热力图显示数量"]', '12')
  await until(() => evaluate("document.querySelectorAll('.project-entity-heatmap-row:not(.head)').length>=3"), 'Actual entity heatmap has no populated rows')
  await capture('projects-entity-heatmap', 'populated', ['[aria-label="实体热力图显示数量"]'], ['实体出场热力图'])

  await choose('[aria-label="关系建议最少共现章节"]', '2')
  await choose('[aria-label="关系建议最低置信度"]', 'exploratory')
  await ui.shown('.project-relation-suggestion-list > article')
  await focus('projects-relation-suggestions', 'candidates', '[aria-label="关系建议最少共现章节"]')
  await select('projects-relation-suggestions', 'candidates', '[aria-label="关系建议最少共现章节"]', '3')
  await select('projects-relation-suggestions', 'candidates', '[aria-label="关系建议最低置信度"]', 'medium')
  await capture('projects-relation-suggestions', 'candidates', ['[aria-label="关系建议最少共现章节"]', '[aria-label="关系建议最低置信度"]'], ['关系自动发现'])
  await choose('[aria-label="关系建议最少共现章节"]', '5')
  await ui.shown('.project-relation-suggestion-empty')
  await capture('projects-relation-suggestions', 'empty-filter', ['[aria-label="关系建议最少共现章节"]'])
  await choose('[aria-label="关系建议最少共现章节"]', '2')

  await ui.button('.project-entity-evidence-filters', '重置筛选')
  await focus('projects-evidence', 'populated', '[aria-label="搜索实体证据章节"]')
  await select('projects-evidence', 'populated', '[aria-label="实体证据来源筛选"]', 'alias')
  await select('projects-evidence', 'populated', '[aria-label="实体证据卷筛选"]', q(setup.volumeIDs[1]))
  await until(() => evaluate("document.querySelectorAll('.project-entity-evidence-cards [data-evidence-chapter]').length===4"), 'Actual evidence filters were not restored')
  await capture('projects-evidence', 'populated', ['[aria-label="搜索实体证据章节"]', '.project-entity-evidence-cards [data-evidence-chapter]:first-child header button'])
  await shared.text('[aria-label="搜索实体证据章节"]', noMatch)
  await until(() => evaluate("!document.querySelector('.project-entity-evidence-cards [data-evidence-chapter]')"), 'Actual evidence query did not empty the result')
  await capture('projects-evidence', 'empty-filter', ['[aria-label="搜索实体证据章节"]'], ['没有符合当前筛选的证据'])
  await shared.text('[aria-label="搜索实体证据章节"]', '')
  const locateLabel = await evaluate("document.querySelector('.project-entity-evidence-cards [data-evidence-chapter]:first-child .project-entity-evidence-excerpt .project-entity-evidence-locate')?.getAttribute('aria-label')")
  assert.ok(locateLabel?.startsWith('定位正文证据 '), 'Actual source-created evidence locator is missing')
  await click('[aria-label=' + q(locateLabel) + ']')
  await ui.shown('.evidence-review-bar')
  await until(() => evaluate("(()=>{const node=document.querySelector('.editor-input .editor-evidence-target');if(!node)return false;const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&box.bottom>0&&box.top<innerHeight})()"), 'The actual Locate action did not reveal its owned saved-text evidence')
  await focus('projects-review', 'current', '.evidence-review-return')
  await capture('projects-review', 'current', ['.evidence-review-return'], ['证据章节'])
  await ui.details('.evidence-review-bar .evidence-review-records-details')
  await shared.text('.evidence-review-bar [aria-label="本章核对备注内容"]', '本组合仅用来检查真实备注输入与取消确认；结束时清除此临时核对，不覆盖两份准备存档。'.repeat(3))
  await select('projects-review', 'notes', '.evidence-review-bar [aria-label="核对清单状态"]', 'noted')
  await capture('projects-review', 'notes', ['.evidence-review-bar [aria-label="本章核对备注内容"]', '.evidence-review-bar [aria-label="核对清单搜索"]'])
  await ui.button('.evidence-review-bar .evidence-review-records-tools', '结束核对')
  await ui.shown('.consumer-confirm-modal')
  await capture('projects-review', 'end-confirmation', ['.consumer-confirm-modal .consumer-modal-actions button:first-child'], ['结束本轮核对？'])
  await ui.button('.consumer-confirm-modal', '保留并继续'); await ui.absent('.consumer-confirm-modal')
  await ui.button('.evidence-review-bar .evidence-review-records-tools', '结束核对')
  await ui.button('.consumer-confirm-modal', '确认结束并清除'); await ui.absent('.evidence-review-bar')
  await ui.structure(setup.projectID)
  await choose('[aria-label="选择实体别名对象"]', setup.entityIDs[0])

  await ui.details('.project-entity-evidence-browser .evidence-review-archives')
  await focus('projects-archives', 'populated', '[aria-label="存档查看范围"]')
  await select('projects-archives', 'populated', '[aria-label="存档查看范围"]', 'all')
  await until(() => evaluate("document.querySelectorAll('.evidence-review-archives-body > ul > li').length===2"), 'The two real setup archives are not visible')
  await capture('projects-archives', 'populated', ['[aria-label="存档查看范围"]', '.evidence-review-archives-body > ul > li:first-child > strong'])
  const actions = '.evidence-review-archives-body > ul > li:first-child .evidence-review-archives-actions'
  await ui.button(actions, '恢复此存档'); await ui.shown('.consumer-confirm-modal')
  await capture('projects-archives', 'restore-confirmation', ['.consumer-confirm-modal .consumer-modal-actions button:first-child'], ['恢复核对存档？'])
  await ui.button('.consumer-confirm-modal', '取消'); await ui.absent('.consumer-confirm-modal')
  await ui.button(actions, '删除此存档'); await ui.shown('.consumer-confirm-modal')
  await capture('projects-archives', 'delete-confirmation', ['.consumer-confirm-modal .consumer-modal-actions button:first-child'], ['删除这份本地存档？'])
  await ui.button('.consumer-confirm-modal', '取消'); await ui.absent('.consumer-confirm-modal')

  await ui.details('.review-archive-comparison')
  const base = '[aria-label="对比基准存档"]', target = '[aria-label="对比目标存档"]'
  await focus('projects-archive-comparison', 'comparison', base)
  await select('projects-archive-comparison', 'comparison', base, setup.archives[0].key)
  await choose(base, setup.archives[0].key)
  await select('projects-archive-comparison', 'comparison', target, setup.archives[1].key)
  await choose(target, setup.archives[1].key)
  await ui.button('.review-compare-actions', '开始对比'); await ui.shown('.review-compare-row')
  await select('projects-archive-comparison', 'comparison', '[aria-label="存档对比变化筛选"]', 'changed')
  await capture('projects-archive-comparison', 'comparison', [base, '[aria-label="搜索存档对比"]'], ['共同 4 章'])
  await shared.text('[aria-label="搜索存档对比"]', noMatch)
  await until(() => evaluate("!document.querySelector('.review-compare-row')"), 'Actual comparison filter did not empty the result')
  await capture('projects-archive-comparison', 'empty-filter', ['[aria-label="搜索存档对比"]'], ['当前筛选没有章节'])
  await shared.text('[aria-label="搜索存档对比"]', ''); await ui.details('.review-archive-comparison', false)

  await ui.details('.evidence-review-backup')
  await focus('projects-archive-backup', 'preflight', '.evidence-review-backup-tools > button:first-child')
  await shared.chooseFile('[aria-label="预检核对备份文件"]', setup.validBackup)
  await ui.shown('.evidence-review-backup-preview')
  await ui.text('.evidence-review-backup-preview', '文件共 2 份；将新增 0 份；重复跳过 2 份')
  assert.equal(await evaluate("document.querySelector('.evidence-review-backup-confirm')?.disabled"), true, 'Duplicate preflight must not offer a new import')
  await capture('projects-archive-backup', 'preflight', ['.evidence-review-backup-preview h4', '.evidence-review-backup-confirm'])
  await ui.button('.evidence-review-backup', '关闭导入预检')
  await shared.chooseFile('[aria-label="预检核对备份文件"]', setup.invalidBackup)
  await ui.shown('.evidence-review-backup [role="alert"]')
  await capture('projects-archive-backup', 'invalid-file', ['.evidence-review-backup [role="alert"]'], ['没有导入任何存档'])
  await ui.button('.evidence-review-backup', '关闭导入预检')
  await ui.details('.evidence-review-backup', false); await ui.details('.project-entity-evidence-browser .evidence-review-archives', false)
  const archives = await readArchives(evaluate)
  assert.equal(sha(q(archives)), setup.archiveNamespaceSHA256, 'Page review changed the actual two original archive byte strings')
  for (const [index, row] of archives.entries()) {
    assert.equal(row.key, setup.archives[index].key); assert.equal(Buffer.byteLength(row.raw), setup.archives[index].bytes); assert.equal(sha(row.raw), setup.archives[index].sha256)
  }
}
