import {
  createEditor,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
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
]

function createImportEditor() {
  return createEditor({
    namespace: 'ImportNormalizer',
    nodes: IMPORT_NODES,
    onError(error) {
      throw error
    },
  })
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

function extractMarkdownTables(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const tables = []
  const output = []

  for (let index = 0; index < lines.length;) {
    const header = parseTableRow(lines[index])
    const hasTableStart = (
      header?.length &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    )

    if (!hasTableStart) {
      output.push(lines[index])
      index += 1
      continue
    }

    const rows = [header]
    index += 2

    while (index < lines.length) {
      const row = parseTableRow(lines[index])
      if (!row?.length || !lines[index].includes('|')) break
      rows.push(row)
      index += 1
    }

    const marker = `LOCALNOTEPADTABLE${tables.length}PLACEHOLDER`
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

function extractMarkdownDividers(markdown) {
  const lines = String(markdown || '').split('\n')
  const dividers = []
  const output = lines.map((line, index) => {
    const trimmed = line.trim()
    const isDivider = trimmed === '---' || trimmed === '***' || trimmed === '___'
    const previousBlank = index === 0 || lines[index - 1].trim() === ''
    const nextBlank = index === lines.length - 1 || lines[index + 1].trim() === ''

    if (!isDivider || !previousBlank || !nextBlank) return line

    const marker = `LOCALNOTEPADDIVIDER${dividers.length}PLACEHOLDER`
    dividers.push(marker)
    return marker
  })

  return {
    markdown: output.join('\n'),
    dividers,
  }
}

function createTableFromRows(rows) {
  const table = $createTableNode()

  rows.forEach((row) => {
    const rowNode = $createTableRowNode()
    row.forEach((value) => {
      const cellNode = $createTableCellNode()
      const paragraph = $createParagraphNode()
      if (value) paragraph.append($createTextNode(value))
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

function restoreMarkdownTables(tables) {
  if (!tables.length) return

  const tableByMarker = new Map(tables.map(table => [table.marker, table]))
  const children = $getRoot().getChildren()

  children.forEach((node) => {
    const marker = node.getTextContent().trim()
    const table = tableByMarker.get(marker)
    if (!table) return
    node.replace(createTableFromRows(table.rows))
  })
}

export function plainTextToLexical(text) {
  const editor = createImportEditor()
  editor.update(() => {
    const root = $getRoot()
    root.clear()

    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
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

export function markdownToLexical(markdown) {
  const editor = createImportEditor()
  const extractedTables = extractMarkdownTables(markdown)
  const extractedDividers = extractMarkdownDividers(extractedTables.markdown)

  editor.update(() => {
    $convertFromMarkdownString(extractedDividers.markdown, TRANSFORMERS)
    restoreMarkdownTables(extractedTables.tables)
    restoreMarkdownDividers(extractedDividers.dividers)
  }, { discrete: true })

  return JSON.stringify(editor.getEditorState().toJSON())
}

export function normalizeImportedContent(item) {
  const title = String(item?.title || '')
  const ext = title.toLowerCase().match(/(\.[^.]+)$/)?.[1] || ''
  const content = String(item?.content || '')
  const contentType = item?.contentType || (ext === '.txt' || ext === '.doc' ? 'text' : 'markdown')

  if (contentType === 'text') {
    return plainTextToLexical(content)
  }

  return markdownToLexical(content)
}
