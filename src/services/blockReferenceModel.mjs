// Stable identities are scoped to a note. No block lookup by text or position.
export const BLOCK_STATE_KEY = 'localBlockId'
export const BLOCK_TYPES = new Set(['paragraph', 'heading', 'quote', 'list', 'code', 'code-block', 'table'])
export const BLOCK_BODY_BYTES = 2 * 1024 * 1024
export const BLOCK_TEXT_LIMIT = 20000
export const validBlockId = value => typeof value === 'string' && /^b-[a-f0-9]{32}$/.test(value)
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
export function requireBlockId(value) {
  if (!validBlockId(value)) fail('block-identity', '块引用标识无效，未猜测其他段落。')
  return value
}
function noteId(value) {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > 512 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value))
    fail('block-identity', '笔记标识无效。')
  return value
}
export function blockLocator(id, blockId) {
  return 'notepad://block/' + encodeURIComponent(noteId(id)) + '/' + requireBlockId(blockId)
}
export function parseBlockLocator(value) {
  if (typeof value !== 'string' || value.length > 4096) fail('block-locator', '请粘贴本应用生成的块引用地址。')
  try {
    // Chromium shipped with Electron 31 treats unregistered schemes as opaque
    // paths (host=''), unlike newer WHATWG URL implementations. This is a
    // private locator, never a navigation URL: accept only our canonical grammar.
    const text = value.trim(), parts = /^notepad:\/\/block\/([^/?#]+)\/(b-[a-f0-9]{32})$/.exec(text)
    if (!parts) throw Error()
    const id = decodeURIComponent(parts[1]), blockId = parts[2]
    if (blockLocator(id, blockId) !== text) throw Error()
    return Object.freeze({ id, blockId })
  } catch { fail('block-locator', '块引用地址无效；不会访问外部网址或猜测目标。') }
}
export function parseBlockDocument(content) {
  if (typeof content !== 'string' || content.length > BLOCK_BODY_BYTES || new TextEncoder().encode(content).length > BLOCK_BODY_BYTES)
    fail('block-limit', '来源正文超过 2 MiB 读取上限，未使用部分结果。')
  let doc
  try { doc = JSON.parse(content) } catch { fail('block-missing', '来源不是可定位的富文本正文。') }
  if (!doc?.root || doc.root.type !== 'root' || !Array.isArray(doc.root.children)) fail('block-shape', '来源正文结构无效。')
  const stack = [{ node: doc.root, depth: 0 }]; let total = 0
  while (stack.length) {
    const { node, depth } = stack.pop()
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 64 || ++total > 50000 || typeof node.type !== 'string' || ('children' in node && !Array.isArray(node.children))) fail('block-shape', '来源正文结构无效或超出安全上限。')
    for (const key of ['text', 'title', 'code', 'content', 'caption', 'alt', 'name', 'expression', 'url', 'mention'])
      if (key in node && typeof node[key] !== 'string') fail('block-shape', '来源块包含无效文本字段。')
    for (const child of node.children || []) stack.push({ node: child, depth: depth + 1 })
  }
  return doc
}
export function findReferenceBlock(content, id) {
  requireBlockId(id)
  const blocks = parseBlockDocument(content).root.children.filter(n => n.$?.[BLOCK_STATE_KEY] === id)
  if (blocks.length > 1) fail('block-ambiguous', '来源存在重复块标识，未擅自选择第一项。')
  if (!blocks.length) fail('block-missing', '来源块已删除或移出原笔记，未跳转到相似段落。')
  if (!BLOCK_TYPES.has(blocks[0].type)) fail('block-type', '这个来源块类型暂不支持安全嵌入。')
  return blocks[0]
}
export function referenceBlockText(block) {
  // Nested references remain labels: no recursive reads, scripts or media loads.
  let count = 0, total = 0
  const piece = value => { const s = String(value || ''); total += s.length; if (total > BLOCK_TEXT_LIMIT) fail('block-limit', '来源块超过 20,000 字符展示上限，未截断显示。'); return s }
  const walk = (node, depth = 0) => {
    if (depth > 64 || ++count > 2000) fail('block-limit', '来源块结构过大，未截断显示。')
    if (node.type === 'wiki-link') return piece('[引用：' + (node.title || '笔记') + (node.blockId ? '#^' + node.blockId : '') + ']')
    if (['text', 'code-highlight', 'inline-code'].includes(node.type)) return piece(node.text)
    if (node.type === 'linebreak') return piece('\n')
    if (node.type === 'tab') return piece('\t')
    if (node.type === 'code-block') return piece(node.code)
    if (node.type === 'formula') return piece(node.expression)
    if (node.type === 'callout' || node.type === 'todo') return piece(node.text)
    if (node.type === 'toggle') return piece(node.title + '\n' + node.content)
    if (['image', 'image-grid', 'video', 'attachment', 'embed'].includes(node.type)) return piece('[' + node.type + '：' + (node.caption || node.alt || node.name || node.title || '媒体内容，请打开来源查看') + ']')
    if (node.type === 'mention') return piece('@' + node.mention)
    if (node.type === 'divider') return piece('────────')
    if (!['paragraph', 'heading', 'quote', 'list', 'listitem', 'code', 'table', 'tablerow', 'tablecell', 'link', 'autolink', 'mark'].includes(node.type))
      fail('block-type', '来源块包含不支持的内容类型，未省略后假称完整展示。')
    const children = (node.children || []).map(child => walk(child, depth + 1))
    return children.join(node.type === 'tablerow' ? '\t' : ['list', 'table'].includes(node.type) ? '\n' : '')
  }
  const text = walk(block)
  if (text.length > BLOCK_TEXT_LIMIT) fail('block-limit', '来源块超过展示上限。')
  return text || '（空块）'
}
export function removeCopiedBlockIds(value) {
  const copy = structuredClone(value)
  const stack = [copy]; let count = 0
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (++count > 50000) fail('block-limit', '复制内容过大，未粘贴。')
    if (node.$ && typeof node.$ === 'object' && Object.hasOwn(node.$, BLOCK_STATE_KEY)) {
      delete node.$[BLOCK_STATE_KEY]
      if (!Object.keys(node.$).length) delete node.$
    }
    if (Array.isArray(node)) stack.push(...node)
    else if (Array.isArray(node.children)) stack.push(...node.children)
  }
  return copy
}
