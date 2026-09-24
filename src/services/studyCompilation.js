import { api } from './api'
import { collectionStudyHub } from './collectionStudyHub'
import { collectionStudy, STUDY_STATUS_LABELS } from './collectionStudy'
import { searchCollections } from './searchCollections'
import { collectionStudyDrafts, studyDraftKey } from './collectionStudyDrafts'

export const MAX_COMPILATION_ITEMS = 200
export const MAX_COMPILATION_BYTES = 2 * 1024 * 1024
const LIMITATION = '由已保存的人工批注整理，不是原文摘录、自动总结或事实核验。来源标题与目录为历史信息；正文未被复制，原批注与阅读状态未改动。'
const fail = message => { throw new Error(message) }
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const checkAlive = options => { if (options.signal?.aborted || options.isCurrent?.() === false) fail('操作已取消，未发送创建请求') }
const bounded = text => { if (new TextEncoder().encode(text).length > MAX_COMPILATION_BYTES) fail('研究笔记超过 2 MiB，未截断；请减少所选批注'); return text }
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~\-])/g, '\\$1').replace(/\r\n?/g, '\n')
const textNode = text => ({ type: 'text', version: 1, text, format: 0, detail: 0, mode: 'normal', style: '' })
const inline = value => String(value).replace(/\r\n?/g, '\n').split('\n').flatMap((line, index) => index ? [{ type: 'linebreak', version: 1 }, textNode(line)] : [textNode(line)])
const block = (value, tag) => ({ type: tag ? 'heading' : 'paragraph', version: 1, children: inline(value), direction: null, format: '', indent: 0, ...(tag ? { tag } : {}) })
function normalizeConfig(config) {
  if (typeof config.title !== 'string' || !config.title.trim() || config.title.length > 120 || /[<>:"/\\|?*\x00-\x1f]/.test(config.title)) fail('请输入 1 至 120 字的研究笔记名称，不能含路径符号或控制字符')
  const title = config.title.trim().replace(/\.md$/i, '')
  if (!title) fail('研究笔记名称不能为空')
  if (typeof config.goal !== 'string' || config.goal.length > 2000 || config.goal.includes('\0')) fail('研究目标最多 2000 个字符')
  if (typeof config.parentId !== 'string' || config.parentId.length > 255 || /[\x00-\x1f]/.test(config.parentId)) fail('目标目录标识无效')
  if (!['collection', 'status'].includes(config.group)) fail('请选择资料集或阅读状态分组')
  return { title: title + '.md', goal: config.goal, parentId: config.parentId, group: config.group }
}

export function buildStudyCompilation(rows, config, preparedAt, loadedAt) {
  const normalized = normalizeConfig(config)
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_COMPILATION_ITEMS) fail('每次请选择 1 至 200 条已存批注，未自动截断')
  const groups = new Map()
  for (const row of rows) {
    const key = normalized.group === 'status' ? row.status : row.collectionKey
    if (!groups.has(key)) groups.set(key, { key, title: normalized.group === 'status' ? STUDY_STATUS_LABELS[row.status] : row.collectionName, items: [] })
    // Whitelist fields. Neither a raw collection nor a mutable caller object reaches the document.
    groups.get(key).items.push({ collectionId: row.collectionId, collectionName: row.collectionName, id: row.id,
      title: row.title, folderPath: row.folderPath, ordinal: row.ordinal, status: row.status, note: row.note, updatedAt: row.updatedAt })
  }
  const children = [block(normalized.title.replace(/\.md$/, ''), 'h1'), block(LIMITATION),
    block(`整理时间：${preparedAt}；来源快照：${loadedAt}；已存批注 ${rows.length} 条，来自 ${new Set(rows.map(row => row.collectionId)).size} 份资料集。`),
    block('研究目标', 'h2'), block(normalized.goal || '（待填写）'), block('我的结论与下一步', 'h2'), block('（请在阅读和核对来源后填写；以下内容仅整理你的已存批注。）')]
  const markdown = ['# ' + escape(normalized.title.replace(/\.md$/, '')), '', LIMITATION, '', `整理时间：${preparedAt}`, `来源快照：${loadedAt}`, `条目：${rows.length}`, '', '## 研究目标', '', escape(normalized.goal || '（待填写）'), '', '## 我的结论与下一步', '', '（待填写；未自动生成结论。）', '']
  for (const group of groups.values()) {
    children.push(block(group.title, 'h2')); markdown.push('## ' + escape(group.title), '')
    for (const row of group.items) {
      const provenance = `资料集：${row.collectionName}（${row.collectionId}）\n原序号：${row.ordinal}；历史目录：${row.folderPath || '根目录'}\n笔记 ID：${row.id}；人工状态：${STUDY_STATUS_LABELS[row.status]}\n批注保存时间：${row.updatedAt || '未知'}`
      children.push(block(row.title || '未命名', 'h3'), block(provenance),
        { ...block(''), children: [textNode('来源笔记：'), { type: 'wiki-link', version: 1, id: row.id, title: row.title || '未命名', sectionPath: [] }] },
        block(row.note), block(''))
      markdown.push('### ' + escape(row.title || '未命名'), '', escape(provenance), '', ...row.note.replace(/\r\n?/g, '\n').split('\n').map(line => '> ' + escape(line)), '')
    }
  }
  const content = bounded(JSON.stringify({ root: { type: 'root', version: 1, children, direction: null, format: '', indent: 0 } }))
  return freeze({ ...normalized, preparedAt, loadedAt, count: rows.length, groups: [...groups.values()], content, markdown: bounded(markdown.join('\n')) })
}

// Creation uses the existing create-only endpoint. Once a POST is sent, this
// preview is never retried automatically: a lost response is not proof of failure.
export function createStudyCompilation({ hub = collectionStudyHub, sourceStore = searchCollections,
  studyStore = collectionStudy, drafts = collectionStudyDrafts, request = api, now = () => new Date() } = {}) {
  const receipts = new WeakMap()
  const validate = receipt => {
    hub.assertCurrent(receipt.model)
    for (const group of receipt.groups) {
      studyStore.assertCurrent(group.snapshot, sourceStore)
      for (const id of group.ids) if (drafts.get(studyDraftKey(group.snapshot, id))) fail('所选批注有未保存草稿，请先保存或处理草稿；不会使用旧批注代替草稿')
    }
  }
  return {
    async prepare(model, keys, config, options = {}) {
      checkAlive(options); hub.assertCurrent(model)
      if (model.issues.length) fail('工作台存在未读取或未关联记录，请先处理提示，未生成不完整研究笔记')
      if (!Array.isArray(keys) || !keys.length || keys.length > MAX_COMPILATION_ITEMS || new Set(keys).size !== keys.length) fail('每次请选择 1 至 200 条不同的已存批注')
      const chosen = new Set(keys), rows = model.rows.filter(row => chosen.has(row.key))
      if (rows.length !== keys.length) fail('所选条目已不在来源快照中，请刷新重选')
      if (rows.some(row => !row.note.trim())) fail('选择中包含没有已存批注的条目，请仅选择有批注的资料；没有自动跳过')
      const groups = new Map()
      for (const row of rows) {
        if (!groups.has(row.collectionKey)) groups.set(row.collectionKey, { entry: row.entry, ids: [] })
        groups.get(row.collectionKey).ids.push(row.id)
      }
      for (const group of groups.values()) { checkAlive(options); group.snapshot = await studyStore.load(group.entry, sourceStore) }
      const receipt = { model, groups: [...groups.values()], phase: 'ready' }
      checkAlive(options); validate(receipt)
      const preview = buildStudyCompilation(rows, config, now().toISOString(), model.loadedAt)
      receipts.set(preview, receipt)
      return preview
    },
    assertCurrent(preview) {
      const receipt = receipts.get(preview)
      if (!receipt) fail('研究笔记预览无效，请重新生成')
      validate(receipt); return preview
    },
    async create(preview, options = {}) {
      const receipt = receipts.get(preview)
      if (!receipt) fail('研究笔记预览无效，请重新生成')
      if (receipt.phase === 'confirmed') return receipt.result
      if (receipt.phase !== 'ready') fail('此预览已提交或结果尚未确认，不会重复创建；请先检查资料库')
      receipt.phase = 'validating'
      try {
        checkAlive(options); validate(receipt)
        if (preview.parentId) {
          const folder = await request('/api/files/' + encodeURIComponent(preview.parentId), { signal: options.signal })
          if (!folder || folder.id !== preview.parentId || folder.is_folder !== true || folder.is_deleted) fail('目标目录已删除或不可用，未改存根目录')
        }
        checkAlive(options); validate(receipt)
      } catch (failure) { receipt.phase = 'ready'; throw failure }
      receipt.phase = 'sending'
      const controller = new AbortController()
      const cancel = () => controller.abort()
      options.signal?.addEventListener('abort', cancel, { once: true })
      if (options.signal?.aborted) controller.abort()
      const timer = setTimeout(cancel, 15000)
      try {
        const file = await request('/api/files', { method: 'POST', body: JSON.stringify({ title: preview.title, content: preview.content, parent_id: preview.parentId, is_folder: false }), signal: controller.signal })
        if (!file || typeof file.id !== 'string' || !file.id || file.title !== preview.title || file.content !== preview.content || file.is_folder !== false || file.is_deleted || (file.parent_id || '') !== preview.parentId) fail('创建响应不完整')
        receipt.result = freeze({ id: file.id, title: file.title, parentId: preview.parentId, count: preview.count })
        receipt.phase = 'confirmed'
        return receipt.result
      } catch (failure) {
        receipt.phase = 'uncertain'
        throw Object.assign(new Error('创建结果尚未确认，可能已经写入。请先在资料库查找“' + preview.title + '”，不要重复提交；预览仍可下载。' + (failure.message ? ' 原因：' + failure.message : '')), { mayHaveCreated: true })
      } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel) }
    },
  }
}
