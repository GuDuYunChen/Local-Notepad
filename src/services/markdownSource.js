const UNSUPPORTED_LABELS = {
  image: '图片',
  'image-grid': '图片组',
  video: '视频',
  attachment: '附件',
  'wiki-link': 'Wiki 链接',
  mention: '提及',
  callout: '提示块',
  toggle: '折叠块',
  embed: '嵌入内容',
  todo: '旧版待办块',
  'inline-code': '旧版行内代码节点',
}

const SAFE_TYPES = new Set([
  'root',
  'paragraph',
  'heading',
  'quote',
  'list',
  'listitem',
  'text',
  'link',
  'autolink',
  'table',
  'tablerow',
  'tablecell',
  'formula',
  'divider',
  'code-block',
  'code',
  'linebreak',
])

const BOLD = 1
const ITALIC = 2
const STRIKETHROUGH = 4
const UNDERLINE = 8
const CODE = 16
const UNSUPPORTED_FORMAT_MASK = UNDERLINE | 32 | 64 | 128
const BACKTICK = String.fromCharCode(96)
const FENCE = BACKTICK.repeat(3)

function escapeMarkdownText(value) {
  return String(value || '')
    .replace(/([\\*_{}\[\]<>])/g, '\\$1')
    .replaceAll(BACKTICK, '\\' + BACKTICK)
}

function serializeText(node) {
  const raw = String(node.text || '')
  if (!raw) return ''

  const format = Number(node.format) || 0
  if (format & CODE) {
    const fence = raw.includes(BACKTICK) ? BACKTICK.repeat(2) : BACKTICK
    return fence + raw + fence
  }

  let text = escapeMarkdownText(raw)
  if (format & STRIKETHROUGH) text = '~~' + text + '~~'
  if (format & ITALIC) text = '*' + text + '*'
  if (format & BOLD) text = '**' + text + '**'
  return text
}

function serializeInline(node) {
  if (!node) return ''

  if (node.type === 'text') return serializeText(node)
  if (node.type === 'linebreak') return '  \n'
  if (node.type === 'formula') return '$' + String(node.expression || '') + '$'

  if (node.type === 'link' || node.type === 'autolink') {
    const label = (node.children || []).map(serializeInline).join('')
    const url = String(node.url || '')
    return '[' + label + '](' + url.replace(/\)/g, '\\)') + ')'
  }

  return (node.children || []).map(serializeInline).join('')
}

function serializeList(node, depth = 0) {
  const listType = node.listType || 'bullet'
  const lines = []

  for (const item of node.children || []) {
    if (item.type !== 'listitem') continue

    const nestedLists = []
    const inlineChildren = []

    for (const child of item.children || []) {
      if (child.type === 'list') nestedLists.push(child)
      else inlineChildren.push(child)
    }

    const indent = '  '.repeat(depth)
    const checked = Boolean(item.checked)
    const marker = listType === 'number'
      ? '1. '
      : listType === 'check'
        ? (checked ? '- [x] ' : '- [ ] ')
        : '- '

    lines.push(indent + marker + inlineChildren.map(serializeInline).join('').trimEnd())

    for (const nested of nestedLists) {
      lines.push(serializeList(nested, depth + 1))
    }
  }

  return lines.filter(Boolean).join('\n')
}

function serializeTable(node) {
  const rows = node.children || []
  if (!rows.length) return ''

  const rowValues = rows.map(row => (
    (row.children || []).map(cell => {
      const value = (cell.children || []).map(child => {
        if (child.type === 'paragraph') return (child.children || []).map(serializeInline).join('')
        return serializeInline(child)
      }).join(' ')
      return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
    })
  ))

  const width = Math.max(...rowValues.map(row => row.length), 0)
  if (!width) return ''

  const normalized = rowValues.map(row => [
    ...row,
    ...Array(Math.max(0, width - row.length)).fill(''),
  ])

  const output = [
    '| ' + normalized[0].join(' | ') + ' |',
    '| ' + Array(width).fill('---').join(' | ') + ' |',
  ]

  for (const row of normalized.slice(1)) {
    output.push('| ' + row.join(' | ') + ' |')
  }

  return output.join('\n')
}

function serializeBlock(node) {
  if (!node) return ''

  switch (node.type) {
    case 'paragraph':
      return (node.children || []).map(serializeInline).join('')

    case 'heading': {
      const tag = String(node.tag || '')
      const levelFromTag = Number(tag.replace('h', ''))
      const level = Math.min(6, Math.max(1, Number(node.level) || levelFromTag || 1))
      return '#'.repeat(level) + ' ' + (node.children || []).map(serializeInline).join('')
    }

    case 'quote': {
      const value = (node.children || []).map(serializeInline).join('')
      return value.split('\n').map(line => '> ' + line).join('\n')
    }

    case 'list':
      return serializeList(node)

    case 'code-block':
      return FENCE + String(node.language || '') + '\n' + String(node.code || '') + '\n' + FENCE

    case 'code': {
      const value = (node.children || []).map(child => String(child.text || child.code || '')).join('')
      return FENCE + String(node.language || '') + '\n' + value + '\n' + FENCE
    }

    case 'table':
      return serializeTable(node)

    case 'formula':
      return node.displayMode
        ? '$$\n' + String(node.expression || '') + '\n$$'
        : '$' + String(node.expression || '') + '$'

    case 'divider':
      return '---'

    default:
      return (node.children || []).map(serializeBlock).join('\n\n')
  }
}

function collectCompatibilityIssues(node, issues) {
  if (!node) return

  if (!SAFE_TYPES.has(node.type)) {
    issues.add(UNSUPPORTED_LABELS[node.type] || node.type || '未知节点')
  }

  if (node.type === 'text') {
    const format = Number(node.format) || 0
    if (format & UNSUPPORTED_FORMAT_MASK) issues.add('下划线/上下标/高亮格式')
    if (String(node.style || '').trim()) issues.add('自定义字体、字号、颜色或高亮样式')
  }

  if (node.type === 'tablecell') {
    const children = node.children || []
    if (children.some(child => child.type !== 'paragraph')) {
      issues.add('复杂表格单元格')
    }
  }

  for (const child of node.children || []) {
    collectCompatibilityIssues(child, issues)
  }
}

export function analyzeMarkdownSourceCompatibility(serializedState) {
  const state = typeof serializedState === 'string'
    ? JSON.parse(serializedState)
    : serializedState

  const issues = new Set()
  collectCompatibilityIssues(state?.root, issues)

  const markdown = (state?.root?.children || [])
    .map(serializeBlock)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()

  return {
    markdown,
    editable: issues.size === 0,
    issues: [...issues],
  }
}
