import {
  createEditor,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import {
  TableCellNode,
  TableNode,
  TableRowNode,
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
} from '@lexical/table'
import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import { DividerNode, $createDividerNode } from '~/components/Editor/nodes/DividerNode'
import { FormulaNode, $createFormulaNode } from '~/components/Editor/nodes/FormulaNode'
import { CodeBlockNode, $createCodeBlockNode, validateLanguage } from '~/components/Editor/nodes/CodeBlockNode'

const IMPORT_NODES = [
  HeadingNode,
  QuoteNode,
  ListItemNode,
  ListNode,
  CodeHighlightNode,
  CodeNode,
  AutoLinkNode,
  LinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  DividerNode,
  FormulaNode,
  CodeBlockNode,
]
const validOfficePrefix = value => typeof value === 'string' && value === value.trim() && /^NPIMPORT(?:0|[1-9][0-9]{0,5})$/.test(value)

function createImportEditor() {
  return createEditor({
    namespace: 'ImportNormalizer',
    nodes: IMPORT_NODES,
    onError(error) {
      throw error
    },
  })
}


// Choose a prefix absent from the actual source, in one bounded scan. Literal
// text resembling old placeholders must survive conversion unchanged.
function markerPrefix(source) {
  const used = new Set()
  for (const match of source.matchAll(/LOCALNOTEPADIMPORT(\d+)TOKEN/g)) used.add(match[1])
  let index = 0
  while (used.has(String(index))) index++
  return `LOCALNOTEPADIMPORT${index}TOKEN`
}

function boundedSource(value) {
  const source = String(value || '').replace(/\r\n?/g, '\n')
  if (new TextEncoder().encode(source).length > 2 * 1024 * 1024 || source.split('\n').length > 10000) {
    throw new Error('正文超过 2 MiB 或 10000 行，请拆分文件后导入；内容未截断')
  }
  return source
}

function checkMarkdownComplexity(source) {
  let count = 0
  for (const character of source) {
    if ('|*_$`[]~<>'.includes(character) && ++count > 20000) {
      throw new Error('正文格式标记过多，请拆分文件后导入；内容未截断')
    }
  }
}

function extractMarkdownCodeBlocks(markdown, prefix) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  const output = []

  for (let index = 0; index < lines.length;) {
    const start = lines[index].match(/^\s*```([^\s`]*)\s*$/)
    if (!start) {
      output.push(lines[index])
      index += 1
      continue
    }

    const language = validateLanguage(start[1] || 'plaintext')
    const codeLines = []
    let cursor = index + 1
    let closed = false

    while (cursor < lines.length) {
      if (/^\s*```\s*$/.test(lines[cursor])) {
        closed = true
        break
      }
      codeLines.push(lines[cursor])
      cursor += 1
    }

    if (!closed) {
      // No closing fence exists in the remaining source. Re-scanning that
      // suffix for every later opening fence would be quadratic.
      for (; index < lines.length; index++) output.push(lines[index])
      break
    }

    const marker = prefix + 'CODEBLOCK' + blocks.length + 'PLACEHOLDER'
    blocks.push({
      marker,
      language,
      code: codeLines.join('\n'),
    })

    output.push('')
    output.push(marker)
    output.push('')
    index = cursor + 1
  }

  return {
    markdown: output.join('\n'),
    blocks,
  }
}

function restoreMarkdownCodeBlocks(blocks) {
  if (!blocks.length) return

  const byMarker = new Map(blocks.map(block => [block.marker, block]))
  for (const node of $getRoot().getChildren()) {
    const block = byMarker.get(node.getTextContent().trim())
    if (!block) continue
    node.replace($createCodeBlockNode(block.code, block.language))
  }
}

function extractMarkdownFormulas(markdown, prefix, bounded) {
  const source = String(markdown || '').replace(/\r\n/g, '\n')
  const blockFormulas = []
  const inlineFormulas = []

  const withBlocks = source.replace(
    /(^|\n)\s*\$\$\s*\n([\s\S]*?)\n\s*\$\$\s*(?=\n|$)/g,
    (match, separator, expression) => {
      if (bounded && blockFormulas.length >= 2000) throw new Error('公式超过 2000 项，请拆分文件后导入')
      const marker = prefix + 'BLOCKFORMULA' + blockFormulas.length + 'PLACEHOLDER'
      blockFormulas.push({ marker, expression: expression.trim() })
      return separator + '\n' + marker + '\n'
    }
  )

  const markdownWithMarkers = withBlocks.replace(
    /(^|[^\\$])\$([^\n$]+?)\$/g,
    (match, separator, expression) => {
      if (bounded && blockFormulas.length + inlineFormulas.length >= 2000) throw new Error('公式超过 2000 项，请拆分文件后导入')
      const marker = prefix + 'INLINEFORMULA' + inlineFormulas.length + 'PLACEHOLDER'
      inlineFormulas.push({ marker, expression: expression.trim() })
      return separator + marker
    }
  )

  return {
    markdown: markdownWithMarkers,
    blockFormulas,
    inlineFormulas,
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, match => '\\' + match)
}

function restoreMarkdownFormulas(blockFormulas, inlineFormulas) {
  const blockMap = new Map(blockFormulas.map(item => [item.marker, item.expression]))
  const inlineMap = new Map(inlineFormulas.map(item => [item.marker, item.expression]))

  const root = $getRoot()

  for (const node of root.getChildren()) {
    const marker = node.getTextContent().trim()
    const expression = blockMap.get(marker)
    if (expression !== undefined) {
      node.replace($createFormulaNode({ expression, displayMode: true }))
    }
  }

  if (!inlineMap.size) return

  const visit = node => {
    if ($isTextNode(node)) {
      const text = node.getTextContent()
      const matchedMarkers = [...inlineMap.keys()].filter(marker => text.includes(marker))
      if (!matchedMarkers.length) return

      const pattern = new RegExp(
        '(' + matchedMarkers.map(escapeRegExp).join('|') + ')',
        'g'
      )
      const parts = text.split(pattern).filter(Boolean)
      const replacements = []

      for (const part of parts) {
        const expression = inlineMap.get(part)
        if (expression !== undefined) {
          replacements.push($createFormulaNode({ expression, displayMode: false }))
        } else {
          const textNode = $createTextNode(part)
          if (typeof node.getFormat === 'function') textNode.setFormat(node.getFormat())
          if (typeof node.getStyle === 'function') textNode.setStyle(node.getStyle())
          replacements.push(textNode)
        }
      }

      if (replacements.length) {
        node.replace(replacements[0])
        let previous = replacements[0]
        for (const replacement of replacements.slice(1)) {
          previous.insertAfter(replacement)
          previous = replacement
        }
      }
      return
    }

    for (const child of node.getChildren?.() || []) visit(child)
  }

  for (const child of root.getChildren()) visit(child)
}

function parseTableRow(line) {
  let source = String(line || '').trim()
  if (!source.includes('|')) return null
  if (source.startsWith('|')) source = source.slice(1)
  if (source.endsWith('|')) source = source.slice(0, -1)

  const cells = []
  let current = ''
  let escaped = false

  for (const char of source) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function isTableSeparator(line) {
  const cells = parseTableRow(line)
  return Boolean(
    cells?.length &&
    cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
  )
}

function extractMarkdownTables(markdown, prefix, bounded, officeFormat, officeTextPrefix) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const tables = []
  const output = []
  let cellCount = 0
  const checkCells = row => {
    cellCount += row.length
    if (bounded && cellCount > 4000) throw new Error('表格合计超过 4000 单元格，请拆分文件后导入；未创建不完整表格')
  }

  for (let index = 0; index < lines.length;) {
    const header = parseTableRow(lines[index])
    const hasTableStart = (
      header?.length &&
      (officeFormat !== 'docx' || header.every(cell => cell.startsWith(officeTextPrefix + 'CELLV1:'))) &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    )

    if (!hasTableStart) {
      output.push(lines[index])
      index += 1
      continue
    }

    const rows = [header]
    checkCells(header)
    index += 2

    while (index < lines.length) {
      const row = parseTableRow(lines[index])
      if (!row?.length || !lines[index].includes('|')) break
      checkCells(row)
      rows.push(row)
      index += 1
    }

    const marker = `${prefix}TABLE${tables.length}PLACEHOLDER`
    tables.push({ marker, rows })
    output.push('')
    output.push(marker)
    output.push('')
  }

  return {
    markdown: output.join('\n'),
    tables,
  }
}

function extractMarkdownDividers(markdown, prefix) {
  const lines = String(markdown || '').split('\n')
  const dividers = []
  const output = lines.map((line, index) => {
    const trimmed = line.trim()
    const isDivider = trimmed === '---' || trimmed === '***' || trimmed === '___'
    const previousBlank = index === 0 || lines[index - 1].trim() === ''
    const nextBlank = index === lines.length - 1 || lines[index + 1].trim() === ''

    if (!isDivider || !previousBlank || !nextBlank) return line

    const marker = `${prefix}DIVIDER${dividers.length}PLACEHOLDER`
    dividers.push(marker)
    return marker
  })

  return {
    markdown: output.join('\n'),
    dividers,
  }
}

function appendTableCellContent(paragraph, value, literal = false) {
  const source = String(value || '')
  if (!source) return

  if (literal) {
    source.split('\n').forEach((part, index) => {
      if (index) paragraph.append($createLineBreakNode())
      if (part) paragraph.append($createTextNode(part))
    })
    return
  }

  const parts = source.split(/(<br\s*\/?>)/gi).filter(Boolean)
  for (const part of parts) {
    if (/^<br\s*\/?>$/i.test(part)) {
      paragraph.append($createLineBreakNode())
    } else {
      paragraph.append($createTextNode(part))
    }
  }
}

function createTableFromRows(rows, literal = false) {
  const table = $createTableNode()

  rows.forEach((row) => {
    const rowNode = $createTableRowNode()
    row.forEach((value) => {
      const cellNode = $createTableCellNode()
      const paragraph = $createParagraphNode()
      appendTableCellContent(paragraph, value, literal)
      cellNode.append(paragraph)
      rowNode.append(cellNode)
    })
    table.append(rowNode)
  })

  return table
}

function restoreMarkdownDividers(dividers) {
  if (!dividers.length) return

  const markers = new Set(dividers)
  const children = $getRoot().getChildren()

  children.forEach((node) => {
    if (!markers.has(node.getTextContent().trim())) return
    node.replace($createDividerNode())
  })
}

function restoreMarkdownTables(tables, literal = false) {
  if (!tables.length) return

  const tableByMarker = new Map(tables.map(table => [table.marker, table]))
  const children = $getRoot().getChildren()

  children.forEach((node) => {
    const marker = node.getTextContent().trim()
    const table = tableByMarker.get(marker)
    if (!table) return
    node.replace(createTableFromRows(table.rows, literal))
  })
}

function decodeOfficeText(encodedText, prefix) {
  try {
    if (!encodedText.startsWith(prefix)) throw new Error('missing encoding')
    const encoded = encodedText.slice(prefix.length)
    if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('invalid base64')
    const binary = atob(encoded)
    if (btoa(binary) !== encoded) throw new Error('noncanonical base64')
    const data = Uint8Array.from(binary, character => character.charCodeAt(0))
    // A BOM is valid literal text, not an encoding header to discard.
    return { value: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data), bytes: data.length }
  } catch {
    throw new Error('Office 表格转换数据无效，请重新选择原文件；未创建不完整正文')
  }
}

function decodeOfficeTables(tables, source, bounded, officeTextPrefix) {
  let lines = source.split('\n').length, bytes = 0, nodes = 0
  return tables.map(table => {
    nodes += 1 + table.rows.length
    return { ...table, rows: table.rows.map(row => row.map(cell => {
      const decoded = decodeOfficeText(cell, officeTextPrefix + 'CELLV1:')
      const value = decoded.value
      bytes += decoded.bytes
      const parts = value.split('\n')
      lines += parts.length - 1
      nodes += 2 + parts.length - 1 + parts.filter(Boolean).length
      if (bounded && (lines > 10000 || bytes > 2 * 1024 * 1024 || nodes > 20000)) {
        throw new Error('Office 表格解码后超过 2 MiB、10000 行或 20000 节点，请拆分文件后导入；内容未截断')
      }
      return value
    })) }
  })
}

function officeSheetNames(source, officeFormat, officeTextPrefix) {
  if (!['xlsx', 'xls'].includes(officeFormat)) return null
  const names = new Map()
  for (const line of source.split('\n')) {
    if (!line.startsWith('## ')) continue
    const marker = line.slice(3)
    const { value } = decodeOfficeText(marker, officeTextPrefix + 'SHEETV1:')
    if (value.length > 31 || !value || names.has(marker) || names.size >= 20) {
      throw new Error('Office 工作表名称转换数据无效，请重新选择原文件')
    }
    names.set(marker, value)
  }
  return names
}

function restoreOfficeSheetNames(names) {
  if (!names) return
  let restored = 0
  for (const node of $getRoot().getChildren()) {
    if (node.getType() !== 'heading') continue
    const marker = node.getTextContent()
    if (node.getTag() !== 'h2' || !names.has(marker)) throw new Error('Office 工作表标题无法完整恢复，请重新选择原文件')
    node.clear()
    appendTableCellContent(node, names.get(marker), true)
    restored++
  }
  if (restored !== names.size) throw new Error('Office 工作表标题无法完整恢复，请重新选择原文件')
}

export function plainTextToLexical(text, { bounded = false } = {}) {
  const source = bounded ? boundedSource(text) : String(text || '')
  const editor = createImportEditor()
  editor.update(() => {
    const root = $getRoot()
    root.clear()

    const lines = source.replace(/\r\n/g, '\n').split('\n')
    for (const line of lines) {
      const paragraph = $createParagraphNode()
      if (line) paragraph.append($createTextNode(line))
      root.append(paragraph)
    }

    if (lines.length === 0) {
      root.append($createParagraphNode())
    }
  }, { discrete: true })

  return JSON.stringify(editor.getEditorState().toJSON())
}

export function markdownToLexical(markdown, { bounded = false, tableCellEncoding, officeFormat, officeTextPrefix } = {}) {
  if (tableCellEncoding !== undefined && tableCellEncoding !== 'base64-utf8-v1') {
    throw new Error('Office 表格转换版本无法识别，请重新选择原文件')
  }
  if (tableCellEncoding && (!['docx', 'xlsx', 'xls'].includes(officeFormat) || !validOfficePrefix(officeTextPrefix))) {
    throw new Error('Office 表格转换信息缺失或无效，请重新选择原文件')
  }
  const source = bounded ? boundedSource(markdown) : String(markdown || '')
  const prefix = markerPrefix(source)
  const editor = createImportEditor()
  const extractedCode = extractMarkdownCodeBlocks(source, prefix)
  if (bounded) checkMarkdownComplexity(extractedCode.markdown)
  // Office has no Markdown dollar-formula syntax. Ordinary currency and text
  // remain literal while actual Word headings, emphasis and lists still parse.
  const extractedFormulas = tableCellEncoding
    ? { markdown: extractedCode.markdown, blockFormulas: [], inlineFormulas: [] }
    : extractMarkdownFormulas(extractedCode.markdown, prefix, bounded)
  const extractedTables = extractMarkdownTables(extractedFormulas.markdown, prefix, bounded, officeFormat, officeTextPrefix)
  const extractedDividers = extractMarkdownDividers(extractedTables.markdown, prefix)
  const literalTables = tableCellEncoding ? decodeOfficeTables(extractedTables.tables, source, bounded, officeTextPrefix) : null
  const sheetNames = tableCellEncoding ? officeSheetNames(source, officeFormat, officeTextPrefix) : null

  editor.update(() => {
    $convertFromMarkdownString(extractedDividers.markdown, TRANSFORMERS)
    if (!literalTables) restoreMarkdownTables(extractedTables.tables)
    restoreMarkdownDividers(extractedDividers.dividers)
    restoreMarkdownCodeBlocks(extractedCode.blocks)
    restoreMarkdownFormulas(
      extractedFormulas.blockFormulas,
      extractedFormulas.inlineFormulas
    )
    // Restore literal Office cells last. Their text may itself resemble any
    // generated formula/code/table marker and must never be scanned again.
    if (literalTables) restoreMarkdownTables(literalTables, true)
    restoreOfficeSheetNames(sheetNames)
  }, { discrete: true })

  return JSON.stringify(editor.getEditorState().toJSON())
}

export function normalizeImportedContent(item) {
  const title = String(item?.title || '')
  const ext = title.toLowerCase().match(/(\.[^.]+)$/)?.[1] || ''
  const content = String(item?.content || '')
  const contentType = item?.contentType || (ext === '.txt' || ext === '.doc' ? 'text' : 'markdown')
  const officeFormat = item?.format || ext.slice(1)
  const office = ['docx', 'xlsx', 'xls'].includes(officeFormat)
  const tableCellEncoding = item?.tableCellEncoding
  const officeTextPrefix = item?.officeTextPrefix
  if ((office && tableCellEncoding !== 'base64-utf8-v1') ||
      (office && !validOfficePrefix(officeTextPrefix)) ||
      (officeTextPrefix !== undefined && !office) ||
      (tableCellEncoding !== undefined && (!office || contentType !== 'markdown' || tableCellEncoding !== 'base64-utf8-v1'))) {
    throw new Error('Office 表格转换信息缺失或无效，请重新选择原文件')
  }

  if (contentType === 'text') {
    return plainTextToLexical(content, { bounded: true })
  }

  return markdownToLexical(content, { bounded: true, tableCellEncoding, officeFormat, officeTextPrefix })
}
