import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import * as XLSX from 'xlsx'

// Files created solely for the owned Windows acceptance process. The renderer
// receives these through its real file input or Chromium's native file drag.
export function createLocalImportDesktopFixtures(out) {
  const directory = path.join(out, 'local-import-fixtures')
  mkdirSync(directory, { recursive: false })
  const files = {}, manifest = []
  const put = (key, filename, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
    const file = path.join(directory, filename)
    writeFileSync(file, bytes, { flag: 'wx' })
    files[key] = file
    manifest.push({ key, filename: 'local-import-fixtures/' + filename, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  put('markdown', '导入99富文本.md', [
    '# 导入主标题99', '', '中文正文 import99-markdown-body。', '',
    '```javascript', 'const import99 = "代码保留";', '```', '',
    '| 项目 | 数值 |', '| --- | --- |', '| 表格99 | 42 |', '',
    '$$', 'x^2 + y^2 = z^2', '$$', '',
  ].join('\n'))
  put('text', '导入99纯文本.txt', '中文纯文本 import99-text-body\n第二行保持原文。\n')
  const workbook = XLSX.utils.book_new()
  for (const [sheet, marker, number, literalRows] of [
    ['成本$100$', 'import99-sheet-one', 101, [
      ['Windows 路径', 'C:\\temp\\file.txt'], ['反斜杠与管道', 'A\\|B'], ['字面金额', '$100$'],
    ]],
    ['_名称_', 'import99-sheet-two', 202, [
      ['字面 HTML', 'literal <br> tag'], ['内嵌换行', '首行99\n次行99'], ['占位符样文本', 'NPIMPORTCELLV1:5Lit5paH'],
    ]],
  ]) {
    XLSX.utils.book_append_sheet(workbook,
      XLSX.utils.aoa_to_sheet([['中文列', '数值'], [marker, number], ...literalRows]), sheet)
  }
  assert.deepEqual(workbook.SheetNames, ['成本$100$', '_名称_'])
  put('workbook', '导入99工作簿.xlsx', XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }))
  put('malformed', '导入99损坏.docx', 'This owned DOCX fixture is deliberately not a ZIP archive.\n')
  for (const [key, filename, marker] of [
    ['unknown', '导入99回执查回.txt', 'import99-unknown-body'],
    ['stale', '导入99失效目录.txt', 'import99-stale-parent-body'],
    ['stopFirst', '导入99停止首项.txt', 'import99-stop-first'],
    ['stopNext', '导入99停止后项.txt', 'import99-stop-next'],
    ['closeFirst', '导入99关闭首项.txt', 'import99-close-first'],
    ['closeNext', '导入99关闭后项.txt', 'import99-close-next'],
    ['drag', '导入99拖入.txt', 'import99-drag-body'],
  ]) put(key, filename, marker + '\n')
  return { directory, files, manifest }
}
