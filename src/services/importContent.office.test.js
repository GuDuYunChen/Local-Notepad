// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import { parseLocalImportFile } from '../../electron/import-parser.js'
import { normalizeImportedContent } from './importContent.js'

let directory
beforeAll(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-office-roundtrip-')) })
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))
const encode = text => 'NPIMPORT0CELLV1:' + Buffer.from(text, 'utf8').toString('base64')
const textOf = node => node.type === 'linebreak' ? '\n' : node.text ?? (node.children || []).map(textOf).join('')
const tablesOf = content => JSON.parse(content).root.children.filter(node => node.type === 'table')
const matrixOf = table => table.children.map(row => row.children.map(textOf))
const values = [
  ['原始值', '第二列'],
  ['C:\\temp\\file.txt', 'A\\|B'],
  ['$100$', 'literal <br> tag'],
  ['first\nsecond\n', '  left\t right  '],
  ['LOCALNOTEPADIMPORT0TOKENINLINEFORMULA0PLACEHOLDER', 'NPIMPORTCELLV1:5Lit5paH'],
  ['\ufeff中文🙂', '# title **bold** ---'],
  ['ends\\', 'A|B'],
  ['\r\nstart\rkeep\nend\n', ''],
]
const assertLiteral = table => {
  const visit = node => {
    expect(['table', 'tablerow', 'tablecell', 'paragraph', 'text', 'linebreak']).toContain(node.type)
    if (node.type === 'text') expect(node.format).toBe(0)
    for (const child of node.children || []) visit(child)
  }
  visit(table)
}
const officeItem = content => ({ title: 'sheet.xlsx', format: 'xlsx', contentType: 'markdown',
  tableCellEncoding: 'base64-utf8-v1', officeTextPrefix: 'NPIMPORT0', content })

describe('actual Office file to editor literal cell roundtrip', () => {
  it.each([['xlsx', 'xlsx'], ['xls', 'biff8']])('preserves every value and column in actual %s across all sheets', async (extension, bookType) => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(values), '成本$100$')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['另一张'], ['$x$']]), '_名称_')
    const filename = path.join(directory, 'literal.' + extension)
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType })
    fs.writeFileSync(filename, bytes)
    const parsed = await parseLocalImportFile(filename)
    const content = normalizeImportedContent(parsed)
    const tables = tablesOf(content)
    expect(tables.map(matrixOf)).toEqual([values, [['另一张'], ['$x$']]])
    const headings = JSON.parse(content).root.children.filter(node => node.type === 'heading')
    expect(headings.map(textOf)).toEqual(['成本$100$', '_名称_'])
    for (const heading of headings) expect(heading.children).toHaveLength(1)
    for (const heading of headings) expect(heading.children[0].format).toBe(0)
    for (const table of tables) assertLiteral(table)
    expect(fs.readFileSync(filename).equals(bytes)).toBe(true)
  })

  it('preserves DOCX cell text, paragraph and explicit line breaks, with surrounding rich structure', async () => {
    const wordValues = values.slice(0, -1)
    const paragraph = text => new Paragraph({ children: text.split('\n').map((part, index) =>
      new TextRun({ text: part, ...(index ? { break: 1 } : {}) })) })
    const document = new Document({ sections: [{ children: [
      new Paragraph({ text: 'Word正文标题', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun({ text: '仍保留粗体', bold: true })] }),
      new Paragraph('正文 $100$ 为文字'),
      new Table({ rows: wordValues.map(row => new TableRow({ children: row.map(value =>
        new TableCell({ children: [paragraph(value)] })) })) }),
      new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('第一段'), new Paragraph('第二段')] })] })] }),
      paragraph('| literal |\n| --- |\n| pipe |'),
      paragraph('| ' + encode('$literal$') + ' |\n| --- |\n| ' + encode('literal') + ' |'),
    ] }] })
    const filename = path.join(directory, 'literal.docx')
    fs.writeFileSync(filename, await Packer.toBuffer(document))
    const content = normalizeImportedContent(await parseLocalImportFile(filename))
    const tables = tablesOf(content)
    expect(tables.map(matrixOf)).toEqual([wordValues, [['第一段\n第二段']]])
    for (const table of tables) assertLiteral(table)
    const state = JSON.parse(content)
    expect(state.root.children[0]).toMatchObject({ type: 'heading', tag: 'h1' })
    expect(state.root.children[1].children[0]).toMatchObject({ text: '仍保留粗体', format: 1 })
    expect(textOf(state.root.children[2])).toBe('正文 $100$ 为文字')
    expect(textOf(state.root.children.at(-2))).toBe('| literal |\n| --- |\n| pipe |')
    expect(textOf(state.root.children.at(-1))).toBe('| ' + encode('$literal$') + ' |\n| --- |\n| ' + encode('literal') + ' |')
  })

  it('decodes cell placeholders only after every other Markdown restoration', () => {
    const literal = 'LOCALNOTEPADIMPORT0TOKENINLINEFORMULA0PLACEHOLDER'
    const content = normalizeImportedContent(officeItem('outside $x$\n\n| ' + encode(literal) + ' |\n| --- |'))
    const table = tablesOf(content)[0]
    expect(matrixOf(table)).toEqual([[literal]])
    assertLiteral(table)
    expect(textOf(JSON.parse(content).root.children[0])).toBe('outside $x$')
    expect(JSON.parse(content).root.children[0].children.some(node => node.type === 'formula')).toBe(false)
  })

  it('keeps token-looking Markdown text literal and retains original Markdown table semantics', () => {
    const token = encode('$literal$')
    const table = tablesOf(normalizeImportedContent({ title: 'note.md', contentType: 'markdown',
      content: '| text |\n| --- |\n| ' + token + ' |\n| a<br>b |' }))[0]
    expect(matrixOf(table)).toEqual([['text'], [token], ['a\nb']])
  })

  it.each(['NPIMPORT0CELLV1:Zg=', 'NPIMPORT0CELLV1:Zh==', 'NPIMPORT0CELLV1:_w==', 'NPIMPORT0CELLV1:/w==',
    'NPIMPORT0CELLV1:Z g==', 'NPIMPORT0CELLV1:Zg==extra', 'missing'])('rejects malformed or noncanonical Office cell %s before creating content', cell => {
    expect(() => normalizeImportedContent(officeItem('| ' + cell + ' |\n| --- |'))).toThrow(/表格转换数据无效/)
  })

  it('rejects hidden decoded line/node expansion before creating editor nodes', () => {
    const content = '| ' + encode('\n'.repeat(10001)) + ' |\n| --- |'
    expect(() => normalizeImportedContent(officeItem(content))).toThrow(/解码后超过/)
    const header = '| ' + [encode('a'), encode('b'), encode('c'), encode('d')].join(' | ') + ' |'
    const row = '| ' + Array(4).fill(encode('a\nb\nc')).join(' | ') + ' |'
    expect(() => normalizeImportedContent(officeItem(header + '\n| --- | --- | --- | --- |\n' + Array(999).fill(row).join('\n')))).toThrow(/解码后超过/)
  })

  it('requires exact Office format and encoding metadata', () => {
    for (const item of [
      { ...officeItem('text'), tableCellEncoding: undefined },
      { ...officeItem('text'), tableCellEncoding: 'v2' },
      { ...officeItem('text'), contentType: 'text' },
      { ...officeItem('text'), officeTextPrefix: undefined },
      { ...officeItem('text'), officeTextPrefix: 'NPIMPORT01' },
      { ...officeItem('text'), officeTextPrefix: 'NPIMPORT0\n' },
      { ...officeItem('text'), title: 'note.md', format: 'md' },
    ]) expect(() => normalizeImportedContent(item)).toThrow(/转换信息缺失或无效/)
    expect(matrixOf(tablesOf(normalizeImportedContent(officeItem('| ' + encode('') + ' |\n| --- |')))[0])).toEqual([['']])
  })
})
