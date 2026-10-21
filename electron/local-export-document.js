import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel,
  Table, TableRow, TableCell, WidthType, ImageRun,
} from 'docx'
import path from 'node:path'
import { LOCAL_EXPORT_LIMITS as LIMIT, LocalExportError, exportName } from './local-export-policy.js'

const TEXT = new Set(['text', 'inline-code', 'code-highlight', 'tab'])
const CONTAINERS = new Set(['root', 'paragraph', 'heading', 'quote', 'list', 'listitem', 'table', 'tablerow', 'tablecell', 'link', 'autolink', 'code', 'mark'])
const LEAVES = new Set(['linebreak', 'code-block', 'image', 'image-grid', 'video', 'attachment', 'todo', 'divider', 'callout', 'toggle', 'formula', 'embed', 'mention', 'wiki-link'])
const string = (value, fallback = '') => value === undefined || value === null ? fallback : typeof value === 'string' ? value : (() => { throw new LocalExportError('invalid-document', '正文包含无效字段，未导出不完整内容。') })()
const safeText = value => string(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}[\]()#+.!|~$\-]/g, '\\$&')
const wiki = node => `[[${string(node.title, '未命名')}${node.sectionPath?.length ? '#' + node.sectionPath.join(' › ') : ''}]]`
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

function nodeText(node) {
  if (TEXT.has(node.type)) return node.type === 'tab' ? '\t' : string(node.text)
  if (node.type === 'linebreak') return '\n'
  if (node.type === 'wiki-link') return wiki(node)
  if (node.type === 'mention') return '@' + string(node.mention)
  if (node.type === 'code-block') return string(node.code)
  if (node.type === 'formula') return string(node.expression)
  if (node.type === 'toggle') return string(node.title) + '\n' + string(node.content)
  if (node.type === 'callout' || node.type === 'todo') return string(node.text)
  if (node.type === 'embed') return string(node.title) + ' ' + string(node.url)
  if (node.type === 'attachment') return string(node.name, '附件')
  if (node.type === 'image') return string(node.caption || node.alt, '图片')
  if (node.type === 'image-grid') return node.items.map(item => string(item.caption || item.alt, '图片')).join('\n')
  if (node.type === 'video') return '视频'
  return (node.children || []).map(nodeText).join(['root', 'list', 'table', 'tablerow'].includes(node.type) ? '\n' : '')
}

// This inspection is performed before the user confirms the frozen preview.
// Unknown node types fail explicitly; an unsupported decorator is never dropped.
export function inspectExportContent(content, format) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > LIMIT.contentBytes) throw new LocalExportError('too-large', '单篇已保存正文超过 2 MiB，或正文类型无效；请缩小后重新预览。')
  let parsed, root, plain = false
  try { parsed = JSON.parse(content) } catch {}
  if (parsed && typeof parsed === 'object' && own(parsed, 'root')) root = parsed.root
  else { plain = true; root = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: content, format: 0 }] }] } }
  const warnings = new Set(), stack = [[root, 0]]
  let count = 0
  if (plain) warnings.add('旧格式正文按纯文本保留；不会重新解释其中的标记。')
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (++count > LIMIT.nodes || depth > LIMIT.depth) throw new LocalExportError('too-large', '正文结构超过 20,000 节点或 64 层，未截断导出。')
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.type !== 'string') throw new LocalExportError('invalid-document', '正文结构无效，请修复笔记后重新预览。')
    if (!TEXT.has(node.type) && !CONTAINERS.has(node.type) && !LEAVES.has(node.type)) throw new LocalExportError('unsupported-node', `正文包含暂不支持的“${node.type.slice(0, 60)}”节点；未省略该内容。`)
    if (CONTAINERS.has(node.type) && !Array.isArray(node.children)) throw new LocalExportError('invalid-document', '正文容器缺少完整子节点，未导出。')
    for (const key of ['text', 'code', 'src', 'caption', 'alt', 'name', 'url', 'title', 'expression', 'content', 'mention', 'icon', 'language']) if (own(node, key)) string(node[key])
    if (TEXT.has(node.type) && own(node, 'format') && (!Number.isSafeInteger(node.format) || node.format < 0 || node.format > 1023)) throw new LocalExportError('invalid-document', '正文文字样式无效，未导出。')
    if (node.type === 'wiki-link' && node.sectionPath !== undefined && (!Array.isArray(node.sectionPath) || node.sectionPath.length > 64 || node.sectionPath.some(value => typeof value !== 'string'))) throw new LocalExportError('invalid-document', 'Wiki 章节路径无效，未导出。')
    if (node.type === 'heading' && !/^h[1-6]$/.test(node.tag || '')) throw new LocalExportError('invalid-document', '标题级别无效，未导出。')
    if (node.type === 'list' && !['number', 'bullet', 'check'].includes(node.listType)) throw new LocalExportError('invalid-document', '列表类型无效，未导出。')
    if (node.type === 'tablecell') {
      for (const key of ['colSpan', 'rowSpan']) if (node[key] !== undefined && (!Number.isInteger(node[key]) || node[key] < 1 || node[key] > 100)) throw new LocalExportError('invalid-document', '表格合并范围无效，未导出。')
      if ((node.colSpan || 1) > 1 || (node.rowSpan || 1) > 1) warnings.add(format === 'markdown' ? 'Markdown 表格使用 HTML 表格保留合并单元格。' : 'Word 保留表格的文字和合并范围，版式可能与编辑器不同。')
    }
    if (['formula', 'embed', 'video', 'callout', 'toggle', 'wiki-link', 'mention'].includes(node.type)) warnings.add('公式保留表达式；嵌入、视频、提示与折叠块保留标题、文字或链接，不运行交互内容。')
    if (TEXT.has(node.type) && ((node.format || 0) & (32 | 64 | 128 | 256 | 512))) warnings.add('部分文字装饰或大小写显示按原文字保留，不改变正文内容。')
    if (node.style) warnings.add('字体、颜色与段落排版可能与编辑器不同；正文文字会保留。')
    if (node.type === 'image-grid') {
      if (!Array.isArray(node.items) || node.items.length > LIMIT.assets) throw new LocalExportError('too-large', '图集内容无效或超过 100 项。')
      for (const item of node.items) {
        if (!item || typeof item !== 'object' || typeof item.src !== 'string') throw new LocalExportError('invalid-document', '图集包含无效图片。')
        stack.push([{ ...item, type: 'image' }, depth + 1])
      }
      warnings.add('图集按图片顺序展开，保留图注。')
    }
    for (const child of node.children || []) stack.push([child, depth + 1])
  }
  if (root?.type !== 'root') throw new LocalExportError('invalid-document', '正文根节点无效，未导出。')
  return { root, plain, preview: nodeText(root).slice(0, 1200), warnings: [...warnings] }
}

function linkTarget(raw) {
  const value = string(raw)
  if (!value) return ''
  try {
    const url = new URL(value)
    if (['http:', 'https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password) return value
  } catch {}
  return ''
}

const htmlEscape = value => string(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const destination = value => String(value).replace(/[\s()<>"\\]/g, char => encodeURIComponent(char))
function fenced(text, language = '') {
  let width = 3
  for (const match of String(text).matchAll(/`+/g)) width = Math.max(width, match[0].length + 1)
  const fence = '`'.repeat(width)
  return `${fence}${/^[a-z0-9+#._-]{0,80}$/i.test(language) ? language : ''}\n${text}\n${fence}`
}
function inlineCode(text) {
  let width = 1
  for (const match of text.matchAll(/`+/g)) width = Math.max(width, match[0].length + 1)
  const fence = '`'.repeat(width)
  const pad = text.startsWith('`') || text.endsWith('`') || /^ .* $/.test(text) ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

export async function renderExportDocument(snapshot, format, { readAsset, check, assetDirectory }) {
  const { root, plain } = snapshot
  const assets = [], bySource = new Map(), usedNames = new Set()
  const imageType = (bytes, mime) => {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg'
    if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'gif'
    if (bytes.subarray(0, 2).toString() === 'BM') return 'bmp'
    if (format === 'markdown' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp'
    if (format === 'markdown' && bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'ico'
    throw new LocalExportError('unsupported-image', '图片格式无法可靠写入该格式；请使用 Markdown 或将图片另存为 PNG/JPEG 后重新预览。')
  }
  const asset = async (src, suggested, image = false) => {
    check()
    if (bySource.has(src)) {
      const item = bySource.get(src)
      if (image && !item.type) item.type = imageType(item.bytes, item.mime)
      return item
    }
    if (assets.length >= LIMIT.assets) throw new LocalExportError('too-many-assets', '单篇附件超过 100 项，未导出不完整文档。')
    const result = await readAsset(src)
    check()
    const bytes = Buffer.from(result.bytes)
    let name = exportName(suggested || result.name || '附件'), index = 2
    const extension = path.extname(name), stem = extension ? name.slice(0, -extension.length) : name
    while (usedNames.has(name.toLocaleLowerCase('en-US'))) name = `${stem} (${index++})${extension}`
    usedNames.add(name.toLocaleLowerCase('en-US'))
    const item = { name, bytes, mime: result.mime, type: image ? imageType(bytes, result.mime) : null,
      relativePath: `${assetDirectory}/${name}` }
    bySource.set(src, item); assets.push(item)
    return item
  }
  const allImages = new Map(), allFiles = new Map()
  async function load(node) {
    check()
    if (node.type === 'image') allImages.set(node, await asset(node.src, undefined, true))
    if (node.type === 'image-grid') for (const item of node.items) allImages.set(item, await asset(item.src, undefined, true))
    if (node.type === 'attachment' || node.type === 'video') allFiles.set(node, await asset(node.src, node.name))
    for (const child of node.children || []) await load(child)
  }
  await load(root)
  const mdInline = nodes => (nodes || []).map(node => {
    if (TEXT.has(node.type)) {
      const value = node.type === 'tab' ? '\t' : string(node.text), f = node.format || 0
      if (node.type === 'inline-code' || f & 16) return inlineCode(value)
      let text = safeText(value)
      if (f & 4) text = `~~${text}~~`
      if (f & 8) text = `<u>${text}</u>`
      if (f & 2) text = `*${text}*`
      if (f & 1) text = `**${text}**`
      return text
    }
    if (node.type === 'linebreak') return '  \n'
    if (node.type === 'link' || node.type === 'autolink') {
      const text = mdInline(node.children), target = linkTarget(node.url)
      return target ? `[${text}](${destination(target)})` : `${text}${node.url ? ' (' + safeText(node.url) + ')' : ''}`
    }
    if (node.type === 'wiki-link') return safeText(wiki(node))
    if (node.type === 'mention') return safeText('@' + string(node.mention))
    if (node.type === 'formula') return inlineCode(string(node.expression))
    if (node.type === 'image') { const item = allImages.get(node); return `![${safeText(node.caption || node.alt || '图片')}](${destination(item.relativePath)})` }
    if (node.children) return mdInline(node.children)
    throw new LocalExportError('unsupported-layout', `“${node.type}”节点所在位置不支持导出，未省略。`)
  }).join('')
  const mdBlocks = nodes => nodes.map(node => {
    check()
    switch (node.type) {
      case 'paragraph': return mdInline(node.children)
      case 'heading': return '#'.repeat(Number(node.tag[1])) + ' ' + mdInline(node.children)
      case 'quote': return mdInline(node.children).split('\n').map(line => '> ' + line).join('\n')
      case 'list': return mdList(node)
      case 'code': return fenced(nodeText(node), string(node.language))
      case 'code-block': return fenced(string(node.code), string(node.language))
      case 'table': return mdTable(node)
      case 'image': return mdInline([node]) + (node.caption ? '\n\n' + safeText(node.caption) : '')
      case 'image-grid': return node.items.map(item => `![${safeText(item.alt || item.caption || '图片')}](${destination(allImages.get(item).relativePath)})${item.caption ? '\n\n' + safeText(item.caption) : ''}`).join('\n\n')
      case 'attachment': case 'video': { const item = allFiles.get(node); return `[${safeText(node.name || (node.type === 'video' ? '视频' : '附件'))}](${destination(item.relativePath)})` }
      case 'todo': return `- [${node.checked ? 'x' : ' '}] ${safeText(node.text)}`
      case 'divider': return '---'
      case 'callout': return `${safeText(node.icon)} ${safeText(node.text)}`.trim().split('\n').map(line => '> ' + line).join('\n')
      case 'toggle': return `**${safeText(node.title)}**\n\n${safeText(node.content)}`
      case 'formula': return node.displayMode ? fenced(string(node.expression), 'latex') : inlineCode(string(node.expression))
      case 'embed': { const target = linkTarget(node.url); return target ? `[${safeText(node.title || node.url)}](${destination(target)})` : safeText(node.title) + '\n\n' + safeText(node.url) }
      default: if (TEXT.has(node.type) || ['link', 'autolink', 'wiki-link', 'mention', 'linebreak', 'mark'].includes(node.type)) return mdInline([node])
        throw new LocalExportError('unsupported-layout', `“${node.type}”节点所在位置不支持导出，未省略。`)
    }
  }).join('\n\n')
  function mdList(node, depth = 0) {
    let number = Number.isSafeInteger(node.start) && node.start > 0 ? node.start : 1
    return node.children.map(item => {
      if (item.type !== 'listitem') throw new LocalExportError('invalid-document', '列表包含无效项目。')
      const ordinary = item.children.filter(child => child.type !== 'list')
      const text = ordinary.map(child => child.type === 'paragraph' ? mdInline(child.children) : mdInline([child])).join(' ')
      const prefix = '  '.repeat(depth), marker = node.listType === 'number' ? `${number++}.` : node.listType === 'check' ? `- [${item.checked ? 'x' : ' '}]` : '-'
      return `${prefix}${marker} ${text}` + item.children.filter(child => child.type === 'list').map(child => '\n' + mdList(child, depth + 1)).join('')
    }).join('\n')
  }
  function mdTable(node) {
    if (!node.children.length) return ''
    if (node.children.some(row => row.type !== 'tablerow' || row.children.some(cell => cell.type !== 'tablecell'))) throw new LocalExportError('invalid-document', '表格结构无效。')
    if (node.children.some(row => row.children.some(cell => (cell.colSpan || 1) > 1 || (cell.rowSpan || 1) > 1))) {
      // Markdown cannot represent merged cells. The owned HTML below escapes
      // all text/attributes and retains local assets and links inside cells.
      return htmlTable(node)
    }
    const width = Math.max(...node.children.map(row => row.children.length))
    if (!width || width > 100 || node.children.length > 1000) throw new LocalExportError('too-large', '导出表格超过 1,000 行或 100 列。')
    const rows = node.children.map(row => '| ' + Array.from({ length: width }, (_, i) => row.children[i] ? mdBlocks(row.children[i].children).replace(/\n/g, '<br>') : '').join(' | ') + ' |')
    rows.splice(1, 0, '| ' + Array(width).fill('---').join(' | ') + ' |')
    return rows.join('\n')
  }
  function htmlTable(node) {
    if (node.children.length > 1000 || node.children.some(row => row.type !== 'tablerow' || row.children.length > 100 || row.children.some(cell => cell.type !== 'tablecell'))) throw new LocalExportError('invalid-document', '表格结构无效或超过导出范围。')
    return '<table>\n' + node.children.map(row => '<tr>' + row.children.map(cell => `<td colspan="${cell.colSpan || 1}" rowspan="${cell.rowSpan || 1}">${cell.children.map(htmlCell).join('')}</td>`).join('') + '</tr>').join('\n') + '\n</table>'
  }
  function htmlCell(node) {
    check()
    if (TEXT.has(node.type)) {
      let text = htmlEscape(node.type === 'tab' ? '\t' : node.text), f = node.format || 0
      if (node.type === 'inline-code' || f & 16) return `<code>${text}</code>`
      if (f & 4) text = `<s>${text}</s>`
      if (f & 8) text = `<u>${text}</u>`
      if (f & 2) text = `<em>${text}</em>`
      if (f & 1) text = `<strong>${text}</strong>`
      return text
    }
    const inner = () => (node.children || []).map(htmlCell).join('')
    switch (node.type) {
      case 'paragraph': return `<p>${inner()}</p>`
      case 'heading': return `<${node.tag}>${inner()}</${node.tag}>`
      case 'quote': return `<blockquote>${inner()}</blockquote>`
      case 'linebreak': return '<br>'
      case 'mark': return inner()
      case 'link': case 'autolink': { const target = linkTarget(node.url); return target ? `<a href="${htmlEscape(target)}">${inner()}</a>` : inner() + htmlEscape(node.url) }
      case 'wiki-link': return htmlEscape(wiki(node))
      case 'mention': return htmlEscape('@' + string(node.mention))
      case 'list': { const tag = node.listType === 'number' ? 'ol' : 'ul'; return `<${tag}${tag === 'ol' ? ` start="${Number.isSafeInteger(node.start) && node.start > 0 ? node.start : 1}"` : ''}>${inner()}</${tag}>` }
      case 'listitem': return `<li>${node.checked === undefined ? '' : node.checked ? '☑ ' : '☐ '}${inner()}</li>`
      case 'code': case 'code-block': return `<pre><code>${htmlEscape(node.type === 'code' ? nodeText(node) : node.code)}</code></pre>`
      case 'table': return htmlTable(node)
      case 'image': { const item = allImages.get(node); return `<img src="${htmlEscape(item.relativePath)}" alt="${htmlEscape(node.alt || node.caption || '图片')}">${node.caption ? '<p>' + htmlEscape(node.caption) + '</p>' : ''}` }
      case 'image-grid': return node.items.map(item => `<img src="${htmlEscape(allImages.get(item).relativePath)}" alt="${htmlEscape(item.alt || item.caption || '图片')}">${item.caption ? '<p>' + htmlEscape(item.caption) + '</p>' : ''}`).join('')
      case 'attachment': case 'video': return `<a href="${htmlEscape(allFiles.get(node).relativePath)}">${htmlEscape(node.name || (node.type === 'video' ? '视频' : '附件'))}</a>`
      case 'todo': return `<p>${node.checked ? '☑' : '☐'} ${htmlEscape(node.text)}</p>`
      case 'divider': return '<hr>'
      case 'callout': return `<blockquote>${htmlEscape((node.icon || '') + ' ' + node.text)}</blockquote>`
      case 'toggle': return `<p><strong>${htmlEscape(node.title)}</strong></p><pre>${htmlEscape(node.content)}</pre>`
      case 'formula': return `<code>${htmlEscape(node.expression)}</code>`
      case 'embed': return `<p>${htmlEscape(node.title)} ${htmlEscape(node.url)}</p>`
      default: throw new LocalExportError('unsupported-layout', `“${node.type}”节点不能放在表格中导出，未省略。`)
    }
  }

  const docInline = nodes => (nodes || []).flatMap(node => {
    if (TEXT.has(node.type)) {
      const f = node.format || 0
      return new TextRun({ text: node.type === 'tab' ? '\t' : string(node.text), bold: !!(f & 1), italics: !!(f & 2), strike: !!(f & 4),
        underline: f & 8 ? {} : undefined, font: node.type === 'inline-code' || f & 16 ? 'Consolas' : undefined })
    }
    if (node.type === 'linebreak') return new TextRun({ break: 1 })
    if (node.type === 'link' || node.type === 'autolink') {
      const children = docInline(node.children), target = linkTarget(node.url)
      return target ? new ExternalHyperlink({ link: target, children }) : [...children, new TextRun(node.url ? ` (${node.url})` : '')]
    }
    if (node.type === 'wiki-link') return new TextRun(wiki(node))
    if (node.type === 'mention') return new TextRun('@' + string(node.mention))
    if (node.type === 'formula') return new TextRun({ text: string(node.expression), font: 'Consolas' })
    if (node.type === 'image') return docImage(node)
    if (node.children) return docInline(node.children)
    throw new LocalExportError('unsupported-layout', `“${node.type}”节点所在位置不支持 Word 导出，未省略。`)
  })
  function docImage(node) {
    const item = allImages.get(node), width = Math.max(1, Math.min(580, Number(node.width) || 400))
    const height = Math.max(1, Math.min(750, Number(node.height) || width * 0.75))
    return new ImageRun({ type: item.type, data: item.bytes, transformation: { width, height }, altText: { title: string(node.alt || node.caption, '图片'), description: string(node.caption || node.alt, '图片'), name: item.name } })
  }
  function docBlocks(nodes) {
    return nodes.flatMap(node => {
      check()
      switch (node.type) {
        case 'paragraph': return new Paragraph({ children: docInline(node.children) })
        case 'heading': return new Paragraph({ heading: HeadingLevel[`HEADING_${node.tag[1]}`], children: docInline(node.children) })
        case 'quote': return new Paragraph({ indent: { left: 360 }, children: docInline(node.children) })
        case 'list': return docList(node)
        case 'code': case 'code-block': return string(node.type === 'code' ? nodeText(node) : node.code).split('\n').map(line => new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }))
        case 'table': {
          if (node.children.length > 1000 || node.children.some(row => row.type !== 'tablerow' || row.children.length > 100 || row.children.some(cell => cell.type !== 'tablecell'))) throw new LocalExportError('invalid-document', '表格结构无效或超过导出范围。')
          return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: node.children.map(row => new TableRow({ children: row.children.map(cell => {
            const children = docBlocks(cell.children)
            return new TableCell({ columnSpan: cell.colSpan || 1, rowSpan: cell.rowSpan || 1, children: children.length ? children : [new Paragraph('')] })
          }) })) })
        }
        case 'image': return [new Paragraph({ children: [docImage(node)] }), ...(node.caption ? [new Paragraph(string(node.caption))] : [])]
        case 'image-grid': return node.items.flatMap(item => [new Paragraph({ children: [docImage(item)] }), ...(item.caption ? [new Paragraph(string(item.caption))] : [])])
        case 'attachment': case 'video': { const item = allFiles.get(node); return new Paragraph({ children: [new ExternalHyperlink({ link: destination(item.relativePath), children: [new TextRun({ text: string(node.name, node.type === 'video' ? '视频' : '附件'), style: 'Hyperlink' })] })] }) }
        case 'todo': return new Paragraph(`${node.checked ? '☑' : '☐'} ${string(node.text)}`)
        case 'divider': return new Paragraph('────────────────')
        case 'callout': return new Paragraph((string(node.icon) + ' ' + string(node.text)).trim())
        case 'toggle': return [new Paragraph({ children: [new TextRun({ text: string(node.title), bold: true })] }), ...string(node.content).split('\n').map(line => new Paragraph(line))]
        case 'formula': return new Paragraph({ children: [new TextRun({ text: string(node.expression), font: 'Consolas' })] })
        case 'embed': return new Paragraph(string(node.title) + (node.title ? '\n' : '') + string(node.url))
        default: if (TEXT.has(node.type) || ['link', 'autolink', 'wiki-link', 'mention', 'linebreak', 'mark'].includes(node.type)) return new Paragraph({ children: docInline([node]) })
          throw new LocalExportError('unsupported-layout', `“${node.type}”节点所在位置不支持 Word 导出，未省略。`)
      }
    })
  }
  function docList(node, depth = 0) {
    let number = Number.isSafeInteger(node.start) && node.start > 0 ? node.start : 1
    return node.children.flatMap(item => {
      if (item.type !== 'listitem') throw new LocalExportError('invalid-document', '列表包含无效项目。')
      const children = item.children.filter(child => child.type !== 'list').flatMap(child => child.type === 'paragraph' ? docInline(child.children) : docInline([child]))
      const prefix = node.listType === 'number' ? `${number++}. ` : node.listType === 'check' ? `${item.checked ? '☑' : '☐'} ` : '• '
      return [new Paragraph({ indent: { left: 360 * depth }, children: [new TextRun(prefix), ...children] }), ...item.children.filter(child => child.type === 'list').flatMap(child => docList(child, depth + 1))]
    })
  }
  check()
  const bytes = format === 'markdown'
    ? Buffer.from(plain ? root.children[0].children[0].text : mdBlocks(root.children) + '\n', 'utf8')
    : await Packer.toBuffer(new Document({ sections: [{ children: docBlocks(root.children) }] }))
  check()
  if (bytes.length > LIMIT.outputBytes) throw new LocalExportError('too-large', '单篇导出结果超过 32 MiB，未写入不完整文件。')
  // DOCX embeds image bytes, but copies other attachments alongside the file.
  const outputAssets = format === 'docx' ? assets.filter(item => [...allFiles.values()].includes(item)) : assets
  return { bytes, assets: outputAssets }
}
