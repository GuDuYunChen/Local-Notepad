import { TABLE_IMPORT_LIMITS } from '~/services/tableImportLimits'

export function readExcelTableRows(XLSX, data) {
  // sheetRows is an absolute worksheet row number, not a used-range budget.
  // Keep a sparse sheet such as A10002 intact; validate its actual rectangle
  // before sheet_to_json allocates the table's rows and cells below.
  const workbook = XLSX.read(data, {
    type: 'array', sheets: 0,
    cellFormula: false, cellHTML: false, bookVBA: false, bookDeps: false,
  })
  const name = workbook.SheetNames?.[0]
  const sheet = name && workbook.Sheets?.[name]
  if (!sheet) throw new Error('工作簿中没有可读取的工作表')
  const ref = sheet['!fullref'] || sheet['!ref']
  if (!ref) throw new Error('第一个工作表为空，没有可插入的表格')
  const range = XLSX.utils.decode_range(ref)
  const height = range.e.r - range.s.r + 1, width = range.e.c - range.s.c + 1
  if (![range.s.r, range.s.c, height, width].every(Number.isSafeInteger) ||
      range.s.r < 0 || range.s.c < 0 || height < 1 || width < 1) {
    throw new Error('工作表范围无效，未插入表格')
  }
  if (height * width > TABLE_IMPORT_LIMITS.cells) {
    throw new Error('表格超过 4000 单元格，请拆分文件后插入；内容未截断')
  }
  const source = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true })
  if (!source.length || source.length !== height) {
    throw new Error('工作表无法完整读取，未插入不完整表格')
  }
  let bytes = 0, lines = height, nodes = 1 + height
  const encoder = new TextEncoder()
  return source.map(row => {
    if (row.length > width) throw new Error('工作表列数不一致，未插入表格')
    return Array.from({ length: width }, (_, column) => {
      const value = String(row[column] ?? '')
      const parts = value.split(/\r\n?|\n/)
      bytes += encoder.encode(value).length
      lines += parts.length - 1
      nodes += 2 + parts.length - 1 + parts.filter(Boolean).length
      if (bytes > TABLE_IMPORT_LIMITS.contentBytes || lines > TABLE_IMPORT_LIMITS.lines || nodes > TABLE_IMPORT_LIMITS.nodes) {
        throw new Error('表格内容超过 2 MiB、10000 行或 20000 节点，请拆分文件后插入；内容未截断')
      }
      return value
    })
  })
}
