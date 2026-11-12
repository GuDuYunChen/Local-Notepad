import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { desktopNote } from './desktop-save-fixture.mjs'
import { observeFullAppPage, observeFullAppOverflowViewport, withinActualClientPort, viewportFixedClipBoundary, validateFullAppPageSample } from './full-app-ui-shared.mjs'

// Real installed Search, collections and research UI. Only prepareResearch
// creates owned fixtures; all local records are created by their actual UI.
const source = name => 'src/components/' + name + '.jsx'
export const researchRoutes = [
  { id: 'research-search', title: '全局检索与上下文', source: source('GlobalSearchPanel'), root: '#search-mode-search', requiredStates: ['populated', 'source-popup', 'sort-popup', 'preview', 'empty'] },
  { id: 'research-presets', title: '常用检索', source: source('SearchPresetsPanel'), root: '.search-presets', requiredStates: ['populated', 'choice-popup', 'invalid-name', 'delete-confirmation'] },
  { id: 'research-preset-transfer', title: '常用检索备份预检', source: source('SearchPresetTransfer'), root: '.search-preset-transfer', requiredStates: ['default', 'invalid-file', 'preflight'] },
  { id: 'research-export', title: '结果清单与导出', source: source('SearchResultExportPanel'), root: '.search-result-export', requiredStates: ['default', 'selected', 'format-popup', 'long-name'] },
  { id: 'research-collections', title: '已保存资料集', source: source('SearchCollectionsPanel'), root: '.search-collections', requiredStates: ['populated', 'choice-popup', 'empty-selection', 'status-popup', 'empty-filter', 'delete-confirmation', 'review', 'invalid-import', 'import-preflight'] },
  { id: 'research-package', title: '资料集与阅读记录便携备份', source: source('CollectionPackageTransfer'), root: '.collection-package-transfer', requiredStates: ['default', 'invalid-file', 'preflight'] },
  { id: 'research-study', title: '资料集阅读进度', source: source('CollectionStudyPanel'), root: '.collection-study-panel', requiredStates: ['populated', 'status-popup', 'empty-filter', 'import-preflight'] },
  { id: 'research-annotation', title: '已存批注与未存草稿', source: source('CollectionStudyEditor'), root: '.collection-study-editor', requiredStates: ['saved', 'status-popup', 'long-draft', 'discard-confirmation'] },
  { id: 'research-hub', title: '跨资料集阅读工作台', source: source('CollectionStudyHub'), root: '.collection-study-hub', requiredStates: ['populated', 'collection-popup', 'status-popup', 'sort-popup', 'empty-filter'] },
  { id: 'research-batch', title: '批量阅读标记与撤销', source: source('CollectionStudyBatchPanel'), root: '.study-hub-batch', requiredStates: ['selected', 'status-popup', 'preflight', 'applied', 'undone'] },
  { id: 'research-compilation', title: '批注整理成研究笔记', source: source('StudyCompilationPanel'), root: '.study-compilation[aria-label="批注整理成研究笔记"]', requiredStates: ['form', 'directory-popup', 'group-popup', 'long-goal', 'preview'] },
  { id: 'research-tasks', title: '研究草稿与创建记录', source: source('ResearchTasksPanel'), root: '.research-tasks', requiredStates: ['populated', 'draft-preview', 'confirmation', 'remove-confirmation', 'confirmed-preview', 'checked-receipt'], stateRoots: { 'checked-receipt': '.study-compilation-result' } },
  { id: 'research-return', title: '从实际检索返回', source: source('SearchReturnBar'), root: '.search-return-bar[aria-label="检索返回导航"]', requiredStates: ['opened'] },
  { id: 'research-reading', title: '资料集连续阅读与批注', source: source('CollectionReadingBar'), root: '.collection-reading-bar', requiredStates: ['opened', 'next', 'annotation'] },
]

const q = JSON.stringify
const sha = value => createHash('sha256').update(value).digest('hex')
const PREFIX = Object.freeze({ presets: 'localNotepad.searchPreset.v1:', collections: 'localNotepad.searchCollection.v1:', study: 'localNotepad.collectionStudy.v1:', tasks: 'localNotepad.researchTask.v1:' })
const noMatch = '无对应结果-OWNED-RESEARCH-ONLY-643187'
const labels = Object.freeze({ collection: '资料集名称', preset: '保存检索名称', collectionSelect: '已保存资料集', presetSelect: '已保存检索' })
const field = label => '[aria-label=' + q(label) + ']'
const collectionNames = ['长篇资料集：中文与 English 名称、真实选项完整显示及窗口换行', '第二份本机资料集：切换后恢复历史条目与已存阅读进度']
const presetNames = ['标题检索：长中文名称和 English 条件完整保留', '另一个标题检索：只读选择与取消确认']
const draftTitle = '合成研究草稿：已存批注与来源完整预览'
const createdTitle = '合成研究创建结果：独立笔记与原来源保持不变'
const annotation = index => `第 ${index + 1} 条合成阅读批注。` + '中文说明与 English evidence 必须换行且保持全部来源信息，不把界面预览当作正文改写。\n'.repeat(8)
const goal = '核对合成材料的已存批注、来源与阅读状态。\n' + '较长研究目标只用于实际控件换行和滚动，不生成结论，也不覆盖原笔记。\n'.repeat(9)

// Scroll observation/restoration only. Keep the actual focus and native input
// sequence intact; never change layout to make the dialog shell reachable.
export function researchShellScrollState(restore) {
  const headers = [...document.querySelectorAll('.global-search-header')]
  if (headers.length !== 1 || !headers[0].closest('.global-search-panel')) throw Error('Actual research shell missing or ambiguous')
  const header = headers[0], nodes = []
  if (header.querySelectorAll('#global-search-title').length !== 1 ||
      header.querySelectorAll('[aria-label="关闭全局检索"]').length !== 1) throw Error('Actual research shell title or close owner missing')
  for (let node = header; node; node = node.parentElement) nodes.push(node)
  const identity = node => ({ tag: node.tagName, id: node.id, className: String(node.className),
    clientWidth: node.clientWidth, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight })
  if (restore) {
    if (!Array.isArray(restore) || restore.length !== nodes.length ||
        nodes.some((node, index) => JSON.stringify(identity(node)) !== JSON.stringify(restore[index].owner))) throw Error('Actual research shell scroll owner changed before restoration')
    nodes.forEach((node, index) => {
      if (node.scrollLeft !== restore[index].left || node.scrollTop !== restore[index].top)
        node.scrollTo({ left: restore[index].left, top: restore[index].top, behavior: 'instant' })
    })
  }
  const active = document.activeElement
  return { positions: nodes.map(node => ({ owner: identity(node), left: node.scrollLeft, top: node.scrollTop })),
    focus: active ? { tag: active.tagName, id: active.id, label: active.getAttribute('aria-label') } : null,
    nativeInputs: window.__fullAppUiEvents.filter(event => ['click', 'keydown', 'change'].includes(event.type)).length }
}

export async function verifyResearchShellReachability(ctx, receipt) {
  const { evaluate, shared, matrix, save } = ctx
  Object.assign(receipt, { matrix, observationOnly: true, complete: false, restored: false })
  receipt.before = await evaluate(`(${researchShellScrollState.toString()})()`); save()
  const read = () => evaluate(`(${observeFullAppPage.toString()})(${q({ root: '.global-search-header',
    anchors: ['#global-search-title', '[aria-label="关闭全局检索"]'] })},${withinActualClientPort.toString()},${observeFullAppOverflowViewport.toString()},${viewportFixedClipBoundary.toString()})`)
  let failed = false
  try {
    await shared.ensureVisible('.global-search-header')
    receipt.visible = await read(); save(); validateFullAppPageSample(receipt.visible, matrix)
    await shared.frame()
    receipt.afterPaint = await read(); save(); validateFullAppPageSample(receipt.afterPaint, matrix)
  } catch (error) {
    failed = true; receipt.error = String(error.stack || error); save(); throw error
  } finally {
    try {
      await evaluate(`(${researchShellScrollState.toString()})(${q(receipt.before.positions)})`)
      await shared.frame()
      receipt.afterRestore = await evaluate(`(${researchShellScrollState.toString()})()`); save()
      assert.deepEqual(receipt.afterRestore.focus, receipt.before.focus, 'Research shell observation changed the original focus')
      assert.equal(receipt.afterRestore.nativeInputs, receipt.before.nativeInputs, 'Research shell observation added native input')
      assert.equal(receipt.afterRestore.positions.length, receipt.before.positions.length)
      receipt.afterRestore.positions.forEach((position, index) => {
        const before = receipt.before.positions[index]
        assert.deepEqual(position.owner, before.owner, 'Research shell scroll owner changed')
        assert.ok(Math.abs(position.left - before.left) <= 1 && Math.abs(position.top - before.top) <= 1,
          'Research shell did not restore the original scroll position')
      })
      receipt.restored = true
    } catch (error) {
      receipt.restorationError = String(error.stack || error)
      if (!failed) throw error
    } finally { save() }
  }
  receipt.complete = true; save(); return receipt
}

function actions(ctx) {
  const { evaluate, click, until, shared } = ctx
  const exists = selector => evaluate(`Boolean(document.querySelector(${q(selector)}))`)
  const present = selector => until(() => evaluate(`(()=>{const n=document.querySelector(${q(selector)});return Boolean(n&&n.getClientRects().length&&getComputedStyle(n).display!=='none')})()`), 'Actual research UI missing: ' + selector)
  const absent = selector => until(async () => !(await exists(selector)), 'Actual research UI did not close: ' + selector)
  const text = (root, value) => until(() => evaluate(`document.querySelector(${q(root)})?.innerText.includes(${q(value)})`), 'Actual research text missing: ' + value)
  const hit = async selector => { await shared.ensureVisible(selector); await click(selector) }
  const press = (root, value) => click({ selector: root + ' button', text: value })
  const enabled = (root, value) => evaluate(`(()=>{const all=[...document.querySelectorAll(${q(root + ' button')})].filter(node=>node.textContent.trim()===${q(value)});if(all.length!==1)throw Error('Actual research action missing or ambiguous');return !all[0].matches(':disabled')})()`)
  const details = async (root, open = true) => {
    await present(root + ' > summary')
    if (await evaluate(`document.querySelector(${q(root)}).open!==${open}`)) await hit(root + ' > summary')
    await until(() => evaluate(`document.querySelector(${q(root)}).open===${open}`), 'Actual details state did not change')
  }
  const choose = async (selector, value) => { await shared.ensureVisible(selector); return shared.nativeSelect.choose(selector, value) }
  const snapshot = async () => evaluate(`(()=>{const prefixes=${q(Object.values(PREFIX))};return Object.keys(localStorage).filter(key=>prefixes.some(prefix=>key.startsWith(prefix))).sort().map(key=>({key,raw:localStorage.getItem(key)}))})()`)
  const entries = async name => (await snapshot()).filter(item => item.key.startsWith(PREFIX[name]))
  const selectCollection = async key => { await hit('#search-tab-collections'); await choose(field(labels.collectionSelect), key); await present('.search-collections-context') }
  const results = count => until(() => evaluate(`document.querySelectorAll('[data-search-result]').length===${count}&&document.querySelector('.global-search-content')?.getAttribute('aria-busy')==='false'`), 'Actual query result did not settle')
  const search = async marker => {
    await shared.openSearch(); await hit('#search-tab-search'); await press('.global-search-filters', '重置')
    await shared.text(field('全局检索关键词'), marker); await choose(field('检索命中位置'), 'title'); await results(3)
  }
  return { exists, present, absent, text, hit, press, enabled, details, choose, snapshot, entries, selectCollection, results, search }
}

// These are input files for the production import readers, never a storage write.
// The bytes come from the records created above by the real installed UI.
export function buildResearchImportFixtures({ presets, collection, study }, exportedAt) {
  assert.ok(Array.isArray(presets) && presets.length === 2)
  const read = (entry, prefix, format) => {
    assert.equal(typeof entry?.key, 'string'); assert.equal(typeof entry?.raw, 'string')
    const value = JSON.parse(entry.raw)
    assert.equal(value.format, format); assert.equal(value.version, 1)
    assert.equal(entry.key, prefix + (value.id || value.collectionId))
    return value
  }
  const presetValues = presets.map(entry => read(entry, PREFIX.presets, 'local-notepad-search-preset'))
  const sourceCollection = read(collection, PREFIX.collections, 'local-notepad-search-collection')
  const sourceStudy = read(study, PREFIX.study, 'local-notepad-collection-study')
  assert.equal(sourceStudy.collectionId, sourceCollection.id)
  assert.equal(sourceStudy.reportSHA256, sha(q(sourceCollection.report)))
  assert.equal(sourceCollection.report.count, sourceCollection.report.items.length)
  const ids = new Set(sourceCollection.report.items.map(item => item.id))
  assert.equal(ids.size, 3)
  assert.equal(sourceStudy.records.length, 2)
  for (const record of sourceStudy.records) assert.ok(ids.has(record.id) && typeof record.note === 'string' && record.note.length > 0)
  for (const value of [...presetValues, sourceCollection]) assert.ok(Array.from(value.name).length <= 48 && value.name.trim())
  assert.equal(new Date(exportedAt).toISOString(), exportedAt)
  const studyBackup = { ...sourceStudy, format: 'local-notepad-collection-study-backup' }
  const payload = { collection: sourceCollection, study: studyBackup }
  return {
    invalid: '{',
    presets: q({ format: 'local-notepad-search-presets', version: 1, exportedAt, presets: presetValues }),
    collection: collection.raw,
    study: q(studyBackup),
    package: q({ format: 'local-notepad-collection-package', version: 1, exportedAt, ...payload,
      integrity: { algorithm: 'SHA-256', digest: sha(q(payload)) } }),
  }
}

export async function prepareResearch(ctx) {
  const { api, evaluate, shared, writeFixtureFile } = ctx, ui = actions(ctx), marker = 'RESEARCH-' + randomUUID().slice(0, 8)
  for (const name of [...collectionNames, ...presetNames]) assert.ok(Array.from(name).length <= 48)
  const create = async values => {
    const created = await api('/api/files', { method: 'POST', body: q(values) })
    assert.match(created.id, /^[A-Za-z0-9_-]+$/)
    const actual = await api('/api/files/' + created.id)
    for (const [key, value] of Object.entries(values)) assert.equal(actual[key], value)
    return actual
  }
  const folder = await create({ title: marker + ' 合成研究来源目录', is_folder: true, parent_id: '', content: '' })
  const notes = []
  for (let index = 0; index < 3; index++) notes.push(await create({ title: `${marker} 第 ${index + 1} 篇较长中文资料标题与上下文预览.md`, is_folder: false, parent_id: folder.id,
    content: desktopNote('合成研究来源 ' + (index + 1), '研究合成正文保持原样。\n' + '此处含较长中文与 English 段落，用于实际搜索上下文与连续阅读的显示。\n'.repeat(12)) }))
  assert.deepEqual(await ui.snapshot(), [], 'Research group requires its own fresh local-record namespace')
  await ui.search(marker); await ui.details('.search-presets')
  for (const name of presetNames) {
    await shared.text(field(labels.preset), name); await ui.press('.search-presets-tools', '保存当前检索')
    await ctx.until(async () => (await ui.entries('presets')).some(entry => JSON.parse(entry.raw).name === name), 'Real UI did not save preset')
  }
  await ui.details('.search-presets', false); await ui.details('.search-result-export')
  for (const name of collectionNames) {
    await shared.text(field(labels.collection), name); await ui.press('.search-result-export', '保存全部为资料集')
    await ctx.until(async () => (await ui.entries('collections')).some(entry => JSON.parse(entry.raw).name === name), 'Real UI did not save collection')
  }
  const collections = await ui.entries('collections'), presets = await ui.entries('presets')
  assert.equal(collections.length, 2); assert.equal(presets.length, 2)
  const primary = collections.find(entry => JSON.parse(entry.raw).name === collectionNames[0]), alternate = collections.find(entry => entry !== primary)
  const collection = JSON.parse(primary.raw); assert.equal(collection.report.count, 3)
  assert.deepEqual(new Set(collection.report.items.map(item => item.id)), new Set(notes.map(note => note.id)))
  await ui.selectCollection(primary.key); await ui.details('.collection-study-panel')
  const studyItems = collection.report.items.slice(0, 2)
  for (const [index, item] of studyItems.entries()) {
    await ui.press('.collection-study-list', '编辑批注：' + item.title); await ui.present('.collection-study-editor')
    await ui.choose(field('当前资料阅读状态'), index ? 'revisit' : 'read')
    await shared.text(field('当前资料批注'), annotation(index)); await ui.press('.collection-study-editor', '保存批注与进度')
    await ui.text('.collection-study-editor', '当前显示已存记录')
    await ctx.until(async () => (await ui.entries('study')).some(entry => JSON.parse(entry.raw).records.some(record => record.id === item.id && record.note === annotation(index))), 'Real saved annotation missing')
  }
  const study = (await ui.entries('study')).find(entry => entry.key === PREFIX.study + collection.id); assert.ok(study)
  await ui.hit('#search-tab-study'); await ui.text('.collection-study-hub', '刷新阅读工作台')
  await ctx.until(() => evaluate("document.querySelectorAll('.study-hub-rows article').length===2"), 'Saved annotations missing from actual hub')
  await ui.press('.study-hub-batch', '选择本页批注'); await ui.details('.study-compilation[aria-label="批注整理成研究笔记"]')
  await shared.text(field('研究笔记名称'), draftTitle); await shared.text(field('研究目标'), goal)
  await ui.choose(field('研究笔记存放目录'), folder.id)
  await ui.press('.study-compilation[aria-label="批注整理成研究笔记"]', '预览所选批注研究笔记')
  await ui.present('[aria-label="研究笔记完整预览"]')
  await ui.press('.study-compilation[aria-label="批注整理成研究笔记"]', '保存研究预览草稿')
  await ctx.until(async () => (await ui.entries('tasks')).length === 1, 'Real research draft was not stored')
  await shared.text(field('研究笔记名称'), createdTitle)
  await ui.press('.study-compilation[aria-label="批注整理成研究笔记"]', '预览所选批注研究笔记')
  await ui.present('[aria-label="研究笔记完整预览"]')
  await ui.press('.study-compilation[aria-label="批注整理成研究笔记"]', '确认创建独立研究笔记')
  await ui.present('.study-compilation-result')
  const tasks = await ctx.until(async () => { const all = await ui.entries('tasks'); return all.length === 2 && all.some(entry => JSON.parse(entry.raw).receipt) && all }, 'Actual research task did not confirm its real backend creation')
  const confirmedTask = tasks.find(entry => JSON.parse(entry.raw).receipt), draftTask = tasks.find(entry => !JSON.parse(entry.raw).receipt)
  const savedTask = JSON.parse(confirmedTask.raw), result = await api('/api/files/' + savedTask.receipt.file_id)
  assert.equal(result.title, createdTitle + '.md'); assert.ok(result.content.includes(annotation(0).slice(0, 12)))
  await ui.press('.study-compilation[aria-label="批注整理成研究笔记"]', '开始另一份研究笔记')
  await shared.closeSearch()
  const rawInputs = buildResearchImportFixtures({ presets, collection: primary, study }, new Date().toISOString()), files = {}
  for (const [name, raw] of Object.entries(rawInputs)) files[name] = await writeFixtureFile({ name: 'research-' + name + '.json', bytes: Buffer.from(raw) })
  return { research: { marker, folder, notes, primary, alternate, presets, study, studyItems, draftTask, confirmedTask, createdNote: result, files,
    setupRecordsSHA256: sha(q(await ui.snapshot())), fixturesCreatedVia: 'real installed UI and owned local API' }, noteIDs: [...notes.map(note => note.id), result.id] }
}

export async function verifyResearchPages(ctx) {
  const { shared, evaluate, until, setup, api, report, save } = ctx, fixture = setup.research, ui = actions(ctx)
  assert.ok(fixture?.primary && fixture.files)
  const route = id => { const found = researchRoutes.find(item => item.id === id); assert.ok(found); return found }
  const shot = (routeId, stateId, anchors, requiredText = []) => shared.captureState({ routeId, stateId, anchors, requiredText })
  const focus = (routeId, stateId, selector) => shared.focus(selector, { routeId, stateId })
  const popup = (routeId, stateId, selector, value) => shared.select(selector, { routeId, stateId, value })
  const before = await ui.snapshot(), records = { matrix: ctx.matrix, before, complete: false, mutations: [] }
  ;(report.fullAppUi.researchRecords ||= []).push(records); save()
  const ownedPresets = fixture.presets
  await ui.search(fixture.marker)
  for (const root of ['.search-presets', '.search-result-export']) await ui.details(root, false)
  await shot('research-search', 'populated', [field('全局检索关键词')], ['3 篇笔记'])
  await focus('research-search', 'populated', field('全局检索关键词'))
  await popup('research-search', 'source-popup', field('检索命中位置'), 'body'); await ui.results(3)
  await popup('research-search', 'sort-popup', field('检索结果排序'), 'updated'); await ui.results(3)
  await ui.hit('[data-search-result]:first-child')
  await ui.text('.global-search-preview', '打开笔记')
  await shot('research-search', 'preview', ['.global-search-preview h3'])
  await shared.text(field('全局检索关键词'), noMatch); await ui.results(0)
  await shot('research-search', 'empty', [field('全局检索关键词')], ['当前范围没有匹配的笔记'])
  await shared.text(field('全局检索关键词'), fixture.marker); await ui.results(3)

  await ui.details('.search-presets')
  await ui.choose(field(labels.presetSelect), ownedPresets[0].key)
  await shot('research-presets', 'populated', [field(labels.preset)])
  await focus('research-presets', 'populated', field(labels.preset))
  await popup('research-presets', 'choice-popup', field(labels.presetSelect), ownedPresets[1].key)
  await shared.text(field(labels.preset), ' '); await ui.press('.search-presets-tools', '保存当前检索')
  await ui.present('.search-presets > [role="alert"]')
  await shot('research-presets', 'invalid-name', [field(labels.preset)], ['长度无效'])
  await shared.text(field(labels.preset), '')
  await ui.press('.search-presets-tools', '删除此检索'); await ui.present('[aria-label="确认删除已保存检索"]')
  await shot('research-presets', 'delete-confirmation', ['[aria-label="确认删除已保存检索"] button:first-of-type'])
  await ui.press('[aria-label="确认删除已保存检索"]', '取消删除')

  await shot('research-preset-transfer', 'default', ['.search-preset-transfer > p'])
  await focus('research-preset-transfer', 'default', '.search-preset-transfer button:first-of-type')
  await shared.chooseFile(field('选择常用检索备份'), fixture.files.invalid)
  await ui.present('.search-preset-transfer [role="alert"]')
  await shot('research-preset-transfer', 'invalid-file', ['.search-preset-transfer [role="alert"]'])
  await shared.chooseFile(field('选择常用检索备份'), fixture.files.presets)
  await ui.present('.search-preset-import-preview')
  await shot('research-preset-transfer', 'preflight', ['.search-preset-import-preview > p:first-child'])
  await ui.press('.search-preset-transfer', '取消导入预检'); await ui.details('.search-presets', false)

  await ui.details('.search-result-export')
  if (await ui.enabled('.search-result-export', '清空选择')) await ui.press('.search-result-export', '清空选择')
  await shot('research-export', 'default', [field(labels.collection)])
  await focus('research-export', 'default', field(labels.collection))
  await ui.press('.search-result-export', '加入本页结果')
  await shot('research-export', 'selected', [field(labels.collection)])
  await popup('research-export', 'format-popup', field('检索清单导出格式'), 'json')
  await shared.text(field(labels.collection), collectionNames[0])
  await shot('research-export', 'long-name', [field(labels.collection)])
  await shared.text(field(labels.collection), ''); await ui.press('.search-result-export', '清空选择'); await ui.details('.search-result-export', false)

  await ui.selectCollection(fixture.primary.key)
  records.shellReachability = {}; save()
  await verifyResearchShellReachability(ctx, records.shellReachability)
  for (const root of ['.collection-package-transfer', '.collection-study-panel', '.search-collections-review-report', '.search-collections-import']) await ui.details(root, false)
  await shot('research-collections', 'populated', [field(labels.collectionSelect)])
  await focus('research-collections', 'populated', field(labels.collectionSelect))
  await popup('research-collections', 'choice-popup', field(labels.collectionSelect), fixture.alternate.key)
  const clearBefore = await ui.snapshot()
  await ui.choose(field(labels.collectionSelect), '')
  await ui.absent('.search-collections-context')
  await shot('research-collections', 'empty-selection', [field(labels.collectionSelect)], ['命名并保存'])
  assert.deepEqual(await ui.snapshot(), clearBefore, 'Empty Select choice must preserve actual stored collections and reading records')
  await ui.choose(field(labels.collectionSelect), fixture.primary.key)
  await popup('research-collections', 'status-popup', field('资料集变化筛选'), 'historical')
  await shared.text(field('搜索资料集条目'), noMatch)
  await shot('research-collections', 'empty-filter', [field('搜索资料集条目')], ['没有符合当前筛选的条目'])
  await shared.text(field('搜索资料集条目'), '')
  await ui.press('.search-collections-tools', '删除此资料集')
  await ui.present('[aria-label="确认删除资料集"]')
  await shot('research-collections', 'delete-confirmation', ['[aria-label="确认删除资料集"] button:first-of-type'])
  await ui.press('[aria-label="确认删除资料集"]', '取消删除资料集')
  await ui.press('.search-collections-tools', '检查当前变化')
  await ui.text('.search-collections-context', '未变化 3')
  await ui.details('.search-collections-review-report')
  await shot('research-collections', 'review', ['.search-collections-review-report > summary'])
  await ui.details('.search-collections-review-report', false); await ui.details('.search-collections-import')
  await shared.chooseFile(field('选择资料集备份'), fixture.files.invalid)
  await ui.present('.search-collections > [role="alert"]')
  await shot('research-collections', 'invalid-import', ['.search-collections > [role="alert"]'])
  await shared.chooseFile(field('选择资料集备份'), fixture.files.collection)
  await ui.present('[aria-label="资料集导入预检"]')
  await shot('research-collections', 'import-preflight', ['[aria-label="资料集导入预检"] button:first-of-type'])
  await ui.press('[aria-label="资料集导入预检"]', '取消资料集导入'); await ui.details('.search-collections-import', false)

  await ui.details('.collection-package-transfer')
  await shot('research-package', 'default', ['.collection-package-transfer > summary'])
  await focus('research-package', 'default', '.collection-package-transfer button:first-of-type')
  await shared.chooseFile(field('选择资料集便携备份'), fixture.files.invalid)
  await ui.present('.collection-package-transfer [role="alert"]')
  await shot('research-package', 'invalid-file', ['.collection-package-transfer [role="alert"]'])
  await shared.chooseFile(field('选择资料集便携备份'), fixture.files.package)
  await ui.present('[aria-label="便携备份恢复预检"]')
  await shot('research-package', 'preflight', ['[aria-label="便携备份恢复预检"] button:first-of-type'])
  await ui.press('.collection-package-transfer', '取消便携备份恢复'); await ui.details('.collection-package-transfer', false)

  await ui.details('.collection-study-panel')
  await ui.text('.collection-study-panel', '有批注 2')
  await shot('research-study', 'populated', [field('搜索资料批注')])
  await focus('research-study', 'populated', field('搜索资料批注'))
  await popup('research-study', 'status-popup', field('资料集阅读筛选'), 'read')
  await shared.text(field('搜索资料批注'), noMatch)
  await shot('research-study', 'empty-filter', [field('搜索资料批注')], ['没有符合条件的已存阅读记录'])
  await shared.text(field('搜索资料批注'), '')
  await ui.details('.collection-study-panel > details')
  await shared.chooseFile(field('选择阅读记录备份'), fixture.files.study)
  await ui.present('[aria-label="阅读记录导入预检"]')
  await shot('research-study', 'import-preflight', ['[aria-label="阅读记录导入预检"] button:first-of-type'])
  await ui.press('.collection-study-panel', '取消阅读记录导入'); await ui.details('.collection-study-panel > details', false)
  await ui.press('.collection-study-list', '编辑批注：' + fixture.studyItems[0].title)
  await ui.text('.collection-study-editor', '当前显示已存记录')
  await shot('research-annotation', 'saved', [field('当前资料批注')])
  await focus('research-annotation', 'saved', field('当前资料批注'))
  await popup('research-annotation', 'status-popup', field('当前资料阅读状态'), 'revisit')
  await shared.text(field('当前资料批注'), annotation(0) + '仅本轮未保存草稿，下一步通过真实确认舍弃。')
  await shot('research-annotation', 'long-draft', [field('当前资料批注')])
  await ui.press('.collection-study-editor', '舍弃未存批注'); await ui.present('[aria-label="确认舍弃批注"]')
  await shot('research-annotation', 'discard-confirmation', ['[aria-label="确认舍弃批注"] button:first-of-type'])
  await ui.press('[aria-label="确认舍弃批注"]', '确认舍弃未存批注')
  await until(() => evaluate(`document.querySelector(${q(field('当前资料批注'))})?.value===${q(annotation(0))}`), 'Discard did not restore the saved annotation')
  await ui.details('.collection-study-panel', false)

  await ui.hit('#search-tab-study'); await ui.press('.collection-study-hub', '刷新阅读工作台')
  await until(() => evaluate("document.querySelectorAll('.study-hub-rows article').length===2"), 'Actual annotation hub did not settle')
  for (const root of ['.research-tasks', '.study-compilation[aria-label="批注整理成研究笔记"]']) await ui.details(root, false)
  await shot('research-hub', 'populated', [field('跨资料集批注关键词')])
  await focus('research-hub', 'populated', field('跨资料集批注关键词'))
  await popup('research-hub', 'collection-popup', field('阅读工作台资料集筛选'), fixture.primary.key)
  await popup('research-hub', 'status-popup', field('阅读工作台状态筛选'), 'read')
  await popup('research-hub', 'sort-popup', field('阅读工作台排序'), 'collection')
  await shared.text(field('跨资料集批注关键词'), noMatch)
  await shot('research-hub', 'empty-filter', [field('跨资料集批注关键词')])
  await shared.text(field('跨资料集批注关键词'), '')
  await until(() => evaluate("document.querySelectorAll('.study-hub-rows article').length===2"), 'Actual annotation filters did not restore both rows')

  await ui.press('.study-hub-batch', '选择本页批注')
  await shot('research-batch', 'selected', [field('批量阅读目标状态')])
  await focus('research-batch', 'selected', field('批量阅读目标状态'))
  await popup('research-batch', 'status-popup', field('批量阅读目标状态'), 'unread')
  await ui.choose(field('批量阅读目标状态'), 'unread')
  await ui.press('.study-hub-batch', '预检批量标记'); await ui.present('[aria-label="批量标记预检"]')
  await ui.details('.study-hub-batch-preview > details')
  await shot('research-batch', 'preflight', ['.study-hub-batch-preview > p:first-child'])
  const batchBefore = await ui.entries('study')
  await ui.press('.study-hub-batch', '确认批量标记'); await ui.present('[aria-label="本轮标记结果"]')
  await ui.text('.study-hub-batch', '本轮可尝试撤销 2 条')
  await shot('research-batch', 'applied', ['[aria-label="本轮标记结果"] button:first-of-type'])
  const batchApplied = await ui.entries('study')
  assert.ok(JSON.parse(batchApplied[0].raw).records.every(item => item.status === 'unread'))
  await ui.press('.study-hub-batch', '撤销本轮标记')
  await ui.text('.study-hub-batch', '本次已撤销 2 条')
  await shot('research-batch', 'undone', ['[aria-label="本轮标记结果"] button:last-of-type'])
  const batchUndone = await ui.entries('study')
  const semanticStudy = rows => rows.map(row => { const value = JSON.parse(row.raw); return { key: row.key, collectionId: value.collectionId, reportSHA256: value.reportSHA256, bookmark: value.bookmark, records: value.records.map(({ id, status, note }) => ({ id, status, note })) } })
  assert.deepEqual(semanticStudy(batchUndone), semanticStudy(batchBefore), 'Actual batch undo changed saved annotation text, bookmark or status')
  records.mutations.push({ kind: 'owned-status-batch-and-real-undo', before: batchBefore, applied: batchApplied, after: batchUndone, semanticRestored: true })
  await ui.press('.study-hub-batch', '结束本轮并保留当前状态')
  await ui.press('.study-hub-batch', '选择本页批注')

  const compilation = '.study-compilation[aria-label="批注整理成研究笔记"]'
  await ui.details(compilation)
  if (await evaluate(`Boolean([...document.querySelectorAll(${q(compilation + ' button')})].find(node=>node.textContent.trim()==='开始另一份研究笔记'))`)) await ui.press(compilation, '开始另一份研究笔记')
  await shared.text(field('研究笔记名称'), '预览中的较长合成研究笔记名称：只核对不创建新正文')
  await shot('research-compilation', 'form', [field('研究笔记名称')])
  await focus('research-compilation', 'form', field('研究笔记名称'))
  await popup('research-compilation', 'directory-popup', field('研究笔记存放目录'), fixture.folder.id)
  await popup('research-compilation', 'group-popup', field('研究笔记分组'), 'status')
  await shared.text(field('研究目标'), goal)
  await shot('research-compilation', 'long-goal', [field('研究目标')])
  await ui.press(compilation, '预览所选批注研究笔记'); await ui.present('[aria-label="研究笔记完整预览"]')
  await shot('research-compilation', 'preview', ['[aria-label="研究笔记完整预览"] header h4'])
  await ui.details(compilation, false)

  await ui.details('.research-tasks')
  await ui.press('.research-tasks', '刷新研究任务')
  await shot('research-tasks', 'populated', ['.research-tasks > summary'])
  await focus('research-tasks', 'populated', '.research-tasks > button')
  const taskButton = async title => {
    const selector = await evaluate(`(()=>{const all=[...document.querySelectorAll('.research-task-list button')],matches=all.filter(node=>node.querySelector('strong')?.textContent===${q(title)});if(matches.length!==1)throw Error('Owned research task missing or ambiguous');return '.research-task-list button:nth-child('+(all.indexOf(matches[0])+1)+')'})()`)
    await ui.hit(selector); await ui.present('[aria-label="已存研究任务预览"]')
  }
  await taskButton(draftTitle + '.md')
  await shot('research-tasks', 'draft-preview', ['[aria-label="已存研究任务预览"] > h4'])
  await ui.hit('.research-task-confirm input')
  await shot('research-tasks', 'confirmation', ['.research-task-confirm'])
  await ui.hit('.research-task-confirm input')
  await ui.press('.research-tasks', '移除本地研究任务记录')
  await ui.present('[aria-label="已存研究任务预览"] [role="alert"]')
  await shot('research-tasks', 'remove-confirmation', ['[aria-label="已存研究任务预览"] [role="alert"] button:last-of-type'])
  await ui.press('.research-tasks', '取消移除研究任务')
  await taskButton(createdTitle + '.md')
  await shot('research-tasks', 'confirmed-preview', ['[aria-label="已存研究任务预览"] > h4'])
  const taskBefore = await ui.entries('tasks')
  await ui.press('.research-tasks', '查回此任务创建结果')
  await ui.text('.research-tasks', '已查回此任务对应的笔记')
  await ui.present('.study-compilation-result')
  await shot('research-tasks', 'checked-receipt', ['.study-compilation-result > [role="status"]'])
  const taskAfter = await ui.entries('tasks')
  const semanticTasks = rows => rows.map(row => { const { updatedAt, ...value } = JSON.parse(row.raw); return { key: row.key, value } })
  assert.deepEqual(semanticTasks(taskAfter), semanticTasks(taskBefore), 'Checking an existing research receipt changed its task payload or identity')
  assert.deepEqual(await api('/api/files/' + fixture.createdNote.id), fixture.createdNote)
  records.mutations.push({ kind: 'actual-existing-research-receipt-check', before: taskBefore, after: taskAfter, unchangedPayload: true })
  await ui.details('.research-tasks', false)

  await ui.search(fixture.marker); await ui.hit('[data-search-result]:first-child')
  await ui.press('.global-search-preview', '打开笔记'); await ui.absent('.global-search-panel')
  await ui.present(route('research-return').root)
  await shot('research-return', 'opened', [route('research-return').root + ' button:first-of-type'])
  // Establish native keyboard traversal from the actual inert return-bar heading.
  // The original trusted Tab sweep and all visible-focus assertions are unchanged.
  await ui.hit(route('research-return').root + ' > div > strong')
  await focus('research-return', 'opened', route('research-return').root + ' button:first-of-type')
  await ui.press(route('research-return').root, '返回检索结果'); await ui.present('.global-search-panel')
  await ui.selectCollection(fixture.primary.key)
  await ui.choose(field('资料集变化筛选'), 'all'); await shared.text(field('搜索资料集条目'), '')
  await ui.hit('[data-collection-note]:first-child button'); await ui.absent('.global-search-panel')
  await ui.present('.collection-reading-bar')
  await shot('research-reading', 'opened', ['.collection-reading-bar > div > strong'])
  await focus('research-reading', 'opened', '.collection-reading-bar > button:nth-of-type(2)')
  await ui.press('.collection-reading-bar', '下一资料')
  await ui.text('.collection-reading-bar', '第 2 / 3 篇')
  await shot('research-reading', 'next', ['.collection-reading-bar > div > strong'])
  await ui.details('.collection-reading-study')
  await ui.text('.collection-reading-study', '阅读记录')
  await shot('research-reading', 'annotation', ['.collection-reading-study > summary'])
  // The embedded editor's Select is observed without changing its saved record.
  await shared.selectPreview('.collection-reading-study ' + field('当前资料阅读状态'), { routeId: 'research-reading', stateId: 'annotation', captureScene: false })
  await ui.press('.collection-reading-bar', '返回资料集'); await ui.present('.global-search-panel'); await shared.closeSearch()
  await ui.press('.collection-reading-bar', '结束资料集阅读'); await ui.absent('.collection-reading-bar')
  records.readingOriginEndedThroughActualUi = true

  const after = await ui.snapshot()
  for (const name of ['presets', 'collections']) assert.deepEqual(after.filter(item => item.key.startsWith(PREFIX[name])), before.filter(item => item.key.startsWith(PREFIX[name])), 'Read/cancel UI changed ' + name)
  assert.deepEqual(semanticStudy(after.filter(item => item.key.startsWith(PREFIX.study))), semanticStudy(before.filter(item => item.key.startsWith(PREFIX.study))))
  assert.deepEqual(semanticTasks(after.filter(item => item.key.startsWith(PREFIX.tasks))), semanticTasks(before.filter(item => item.key.startsWith(PREFIX.tasks))))
  records.after = after; records.unchangedCollectionsAndPresets = true; records.annotationContentAndStatusRestored = true; records.taskPayloadsUnchanged = true; records.complete = true; save()
}
