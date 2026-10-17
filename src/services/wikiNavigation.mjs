import { dailyRequest } from './dailyNotes.mjs'
import { extractHeadingReferences, normalizeSectionPath } from '../components/Editor/utils/referenceUtils.js'
import { extractLexicalText } from '../utils/lexicalText.js'

export const WIKI_READ_MS = 10000
export const WIKI_BODY_BYTES = 2 * 1024 * 1024
const bytes = value => new TextEncoder().encode(value).length
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const text = value => typeof value === 'string' && !Array.from(value).some(char => {
  const point = char.codePointAt(0)
  return point >= 0xd800 && point <= 0xdfff
})

export function wikiRequest(value) {
  if (!value || !text(value.id) || !value.id || bytes(value.id) > 512 || /[\u0000-\u001f\u007f]/.test(value.id))
    fail('identity', '引用目标标识无效，未发起跳转。')
  const path = value.headingPath === undefined ? [] : value.headingPath
  if (!Array.isArray(path) || path.length > 32 || path.some(part => !text(part) || !part.trim() || Array.from(part).length > 512 || /[\u0000-\u001f\u007f]/.test(part)))
    fail('path', '引用章节路径无效，未猜测或截断路径。')
  if (value.title !== undefined && (!text(value.title) || bytes(value.title) > 16384))
    fail('title', '引用标题无效。')
  return Object.freeze({ id: value.id, title: value.title || '关联笔记', headingPath: Object.freeze(normalizeSectionPath(path)) })
}

// Bound recursive legacy readers before they inspect imported rich text.
export function inspectWikiBody(content) {
  if (!text(content) || content.length > WIKI_BODY_BYTES || bytes(content) > WIKI_BODY_BYTES)
    fail('body-limit', '引用正文超过 2 MiB 安全读取上限，未采用部分内容。')
  let parsed
  try { parsed = JSON.parse(content) } catch { return { headings: [], excerpt: Array.from(content.replace(/\s+/g, ' ').trim()).slice(0, 180).join('') } }
  if (!parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, 'root'))
    return { headings: [], excerpt: Array.from(content.replace(/\s+/g, ' ').trim()).slice(0, 180).join('') }
  const stack = [{ node: parsed.root, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { node, depth } = stack.pop()
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 64 || ++count > 50000 || ('children' in node && !Array.isArray(node.children)))
      fail('body-shape', '引用正文结构无效，无法安全读取。')
    if ('text' in node && typeof node.text !== 'string') fail('body-shape', '引用正文文本格式无效。')
    for (const child of node.children || []) stack.push({ node: child, depth: depth + 1 })
  }
  if (!Array.isArray(parsed.root.children)) fail('body-shape', '引用正文根节点无效。')
  return { headings: extractHeadingReferences(parsed), excerpt: Array.from(extractLexicalText(content).replace(/\s+/g, ' ').trim()).slice(0, 180).join('') }
}

export function wikiFile(value, id) {
  if (!value || value.id !== id || !text(value.title) || bytes(value.title) > 16384 || value.title.startsWith('__tpl__') || value.is_folder !== false || value.is_deleted !== false || !Number.isSafeInteger(value.updated_at) || value.updated_at < 0)
    fail('target', '引用目标不存在、已删除或不是可用的普通笔记。')
  inspectWikiBody(value.content)
  return Object.freeze({ ...value })
}
export function wikiHeadingState(content, path) {
  if (!path.length) return 'note'
  const key = JSON.stringify(path)
  const matches = inspectWikiBody(content).headings.filter(heading => JSON.stringify(heading.path) === key)
  return matches.length === 1 ? 'found' : matches.length ? 'ambiguous' : 'missing'
}
export function requireWikiHeading(content, path) {
  const state = wikiHeadingState(content, path)
  if (state === 'missing') fail('heading-missing', '引用章节已改名或移除；未跳到其他位置。')
  if (state === 'ambiguous') fail('heading-ambiguous', '存在同名章节路径；未擅自选择第一项。')
  return state
}
export async function readWikiFile(api, request, signal, budget = WIKI_READ_MS) {
  const target = wikiRequest(request), end = performance.now() + budget
  const result = wikiFile(await dailyRequest(api, '/api/files/' + encodeURIComponent(target.id), { signal }, budget), target.id)
  if (signal?.aborted) fail('cancelled', '已停止读取引用。')
  if (performance.now() >= end) fail('timeout', '读取引用超时，请明确重试。')
  return result
}
export async function readWikiPreview(api, input, signal, budget = WIKI_READ_MS) {
  const request = wikiRequest(input), end = performance.now() + budget
  const file = await readWikiFile(api, request, signal, budget)
  const analysis = inspectWikiBody(file.content)
  let backlinkCount = null
  // A failed optional count must never masquerade as zero backlinks. It uses
  // the remaining shared deadline, not another unbounded request lifetime.
  const left = Math.min(2000, end - performance.now())
  if (left > 0) {
    try {
      const links = await dailyRequest(api, '/api/files/' + encodeURIComponent(request.id) + '/backlinks', { signal }, left)
      if (Array.isArray(links) && links.length <= 2000 && links.every(link => link && typeof link === 'object' && !Array.isArray(link))) backlinkCount = links.length
    } catch { /* optional count is explicitly unavailable */ }
  }
  if (signal?.aborted) fail('cancelled', '已停止读取预览。')
  const section = wikiHeadingState(file.content, request.headingPath)
  return Object.freeze({ title: file.title, excerpt: analysis.excerpt || '这篇笔记还没有正文内容。', updatedAt: file.updated_at, backlinkCount,
    titleChanged: file.title !== request.title, sectionMissing: ['missing', 'ambiguous'].includes(section), sectionState: section })
}

// Own one navigation request at a time. The App opener still owns every
// save/discard/cancel decision; this controller never writes note content.
export function createWikiNavigator({ getContext, openFile, api, remember = () => {} }) {
  let active = null, state = null
  const listeners = new Set()
  const publish = value => { state = value && Object.freeze(value); for (const listener of listeners) listener() }
  const inSource = source => {
    const now = getContext()
    return now.workspace === 'notes' && now.currentId === source.currentId && now.epoch === source.epoch
  }
  const cancel = (clear = false) => {
    const operation = active
    active = null
    operation?.controller.abort()
    operation?.resolve(false)
    publish(clear ? null : state && { ...state, phase: 'stopped', message: '已停止打开，当前笔记和草稿未切换。' })
  }
  function start(input) {
    const current = getContext()
    const source = Object.freeze({ currentId: current.currentId, workspace: current.workspace, epoch: current.epoch })
    if (!source.currentId || source.workspace !== 'notes') return Promise.resolve(false)
    let request
    try { request = wikiRequest(input) } catch (error) {
      cancel(true); publish({ phase: 'error', message: error.message, request: null, source }); return Promise.resolve(false)
    }
    const key = JSON.stringify(request)
    if (active?.key === key && inSource(active.source)) return active.promise
    cancel(true)
    let resolve
    const promise = new Promise(done => { resolve = done })
    const operation = { key, source, request, controller: new AbortController(), promise, resolve, failure: null, file: null, headingContent: undefined }
    active = operation
    const valid = () => {
      if (active !== operation || operation.controller.signal.aborted || !inSource(source)) return false
      if (operation.headingContent !== undefined && getContext().content !== operation.headingContent) {
        operation.failure = { code: 'source-changed', message: '当前章节正文已变化，请重新打开引用；未覆盖草稿。' }
        return false
      }
      return true
    }
    publish({ phase: 'reading', message: '正在核对引用目标…', request, source })
    Promise.resolve().then(() => {
      if (!valid()) return false
      return openFile(request.id, {
        signal: operation.controller.signal,
        shouldSelect: valid,
        headingPath: request.headingPath,
        readFile: async (id, { signal }) => {
          try {
            if (id !== request.id) fail('identity', '引用目标标识发生变化。')
            const file = await readWikiFile(api, request, signal)
            if (!valid()) fail('cancelled', '来源已变化，停止打开。')
            const current = getContext()
            const body = id === current.currentId ? current.content : file.content
            requireWikiHeading(body, request.headingPath)
            if (id === current.currentId && request.headingPath.length) operation.headingContent = body
            operation.file = file
            publish({ phase: 'decision', message: '目标已核对，正在等待原有保存／放弃／取消决定。', request, source })
            return file
          } catch (error) { operation.failure = error; throw error }
        },
      })
    }).then(accepted => {
      if (active !== operation) return
      active = null
      resolve(accepted === true)
      if (accepted === true) {
        try { remember({ id: request.id, title: operation.file?.title || request.title, sectionPath: request.headingPath }) } catch { /* navigation already succeeded */ }
        publish(null)
      } else if (inSource(source)) {
        publish({ phase: operation.failure ? 'error' : 'cancelled', request, source,
          message: operation.failure?.message || '已取消打开，当前笔记和草稿保留。',
          canOpenBody: ['heading-missing', 'heading-ambiguous'].includes(operation.failure?.code) })
      } else publish(null)
    }).catch(error => {
      if (active !== operation) return
      active = null; resolve(false)
      publish(inSource(source) ? { phase: 'error', request, source, message: operation.failure?.message || '引用暂时无法打开，请重试。', canOpenBody: ['heading-missing', 'heading-ambiguous'].includes(operation.failure?.code) } : null)
    })
    return promise
  }
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    open: start,
    stop: () => cancel(false),
    close: () => cancel(true),
    contextChanged() { if (state && !inSource(state.source)) cancel(true) },
    retry(bodyOnly = false) {
      if (!state?.request || !inSource(state.source)) { cancel(true); return Promise.resolve(false) }
      return start({ ...state.request, ...(bodyOnly ? { headingPath: [] } : {}) })
    },
  }
}
