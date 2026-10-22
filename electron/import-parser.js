import fs from 'node:fs'
import path from 'node:path'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import WordExtractor from 'word-extractor'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { LOCAL_IMPORT_EXTENSIONS, LOCAL_IMPORT_LIMITS as LIMIT, LocalImportError } from './import-policy.js'
import { inspectOfficeArchive } from './import-archive.js'

const refuse = (code, message) => { throw new LocalImportError(code, message) }
// Office cells are literal document data, not Markdown. Keep their complete
// UTF-8 value out of every Markdown transform, including formula extraction.
const officeText = (value, prefix, kind = 'CELL') => {
  const text = String(value ?? '')
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
    refuse('invalid-text', '表格包含无效 Unicode 字符，请在原程序中另存后重试')
  }
  return prefix + kind + 'V1:' + Buffer.from(text, 'utf8').toString('base64')
}

function literalPrefix(source) {
  const used = new Set()
  // Table row parsing consumes backslash escapes. Choose a prefix absent even
  // after that step, so ordinary Word text cannot impersonate an encoded table.
  for (const match of source.replace(/\\/g, '').matchAll(/NPIMPORT(\d+)/g)) used.add(match[1])
  let index = 0
  while (used.has(String(index))) index++
  return 'NPIMPORT' + index
}

function wordNodeText(node) {
  if (node.type === 'text') return node.value || ''
  if (node.type === 'tab') return '\t'
  if (node.type === 'break') return node.breakType === 'line' ? '\n' : ''
  const content = (node.children || []).map(wordNodeText).join('')
  return node.type === 'paragraph' ? content + '\n' : content
}

function wordTableValues(document) {
  const tables = []
  const visit = (node, insideTable = false) => {
    if (node.type === 'table') {
      if (insideTable) refuse('invalid-document', '嵌套 Word 表格无法完整转换，请先改为普通表格后导入')
      tables.push(node.children.map(row => row.children.map(cell => wordNodeText(cell).replace(/\n$/, ''))))
    }
    for (const child of node.children || []) visit(child, insideTable || node.type === 'table')
  }
  visit(document)
  return tables
}

function markdownTable(rows, prefix) {
  if (!rows.length) return '（空工作表）'
  const width = Math.max(1, ...rows.map(row => row.length))
  if (rows.length > LIMIT.rows || width > LIMIT.columns || rows.length * width > LIMIT.cells) {
    refuse('too-large', '表格超过 10000 行、200 列或 200000 单元格，请先拆分源文件')
  }
  const line = row => '| ' + Array.from({ length: width }, (_, i) => officeText(row[i], prefix)).join(' | ') + ' |'
  const separator = '| ' + Array(width).fill('---').join(' | ') + ' |'
  return [line(rows[0]), separator, ...rows.slice(1).map(line)].join('\n')
}

function wordMarkdown(html, warnings, prefix, tables) {
  let tableIndex = 0
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  service.use(gfm)
  // Imported previews are editor data. Do not retain executable HTML or ask
  // embedded images to read bytes; external Office file access stays disabled.
  service.remove(['script', 'style', 'iframe', 'object', 'embed', 'img'])
  service.addRule('localImportTable', {
    filter: 'table',
    replacement: (_content, table) => {
      if (table.querySelector('table')) refuse('invalid-document', '嵌套 Word 表格无法完整转换，请先改为普通表格后导入')
      // Read the actual Word document model captured before HTML processing.
      // Turndown collapses HTML whitespace before applying this replacement.
      const rows = tables[tableIndex++]
      if (!rows) refuse('invalid-document', 'Word 表格结构无法完整对应，请在原程序中另存后重试')
      if (table.querySelector('[colspan], [rowspan]')) warnings.push('合并单元格已转为普通表格，请在预览中核对列对应关系')
      return '\n\n' + markdownTable(rows, prefix) + '\n\n'
    },
  })
  const content = service.turndown(html)
  if (tableIndex !== tables.length) refuse('invalid-document', 'Word 表格结构无法完整对应，请在原程序中另存后重试')
  return content
}

function readSource(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.length > 32768 || filePath.includes('\0')) {
    refuse('invalid-path', '请选择本机上的有效文件路径')
  }
  if (/^\\\\(?:[.?]\\|[^\\]+\\)/.test(filePath)) refuse('invalid-path', '请先把共享或设备路径中的文件保存到本机普通目录')
  const ext = path.extname(filePath).toLowerCase()
  if (!LOCAL_IMPORT_EXTENSIONS.includes(ext)) refuse('unsupported', '仅支持 Markdown、TXT、Word 和 Excel 文件')
  let fd
  try {
    const before = fs.lstatSync(filePath)
    if (!before.isFile()) refuse('not-file', '所选路径不是普通文件，请选择文件本身')
    if (before.size > LIMIT.fileBytes) refuse('too-large', '文件超过 50 MiB，请先缩小源文件')
    if (before.size === 0) refuse('empty', '文件为空，没有可导入的正文')
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0))
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.size !== before.size || opened.ino !== before.ino || opened.dev !== before.dev) {
      refuse('changed', '文件在读取前发生变化，请重新选择')
    }
    const buffer = Buffer.alloc(opened.size + 1)
    let count = 0
    while (count < buffer.length) {
      const n = fs.readSync(fd, buffer, count, buffer.length - count, null)
      if (!n) break
      count += n
    }
    const after = fs.fstatSync(fd)
    if (count !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      refuse('changed', '文件在读取时发生变化，请重新选择')
    }
    return { ext, buffer: buffer.subarray(0, count) }
  } catch (error) {
    if (error instanceof LocalImportError) throw error
    refuse('unreadable', '文件不存在、无法读取或已被占用，请检查后重新选择')
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function decodeText(buffer) {
  let encoding = 'utf-8'
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'utf-16le'
  if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'utf-16be'
  let value
  try { value = new TextDecoder(encoding, { fatal: true }).decode(buffer) }
  catch { refuse('invalid-text', '文本编码无法识别，请另存为 UTF-8 或带 BOM 的 UTF-16') }
  if (value.includes('\0')) refuse('invalid-text', '文件含二进制内容，请另存为普通文本')
  return value.replace(/\r\n?/g, '\n')
}

function spreadsheet(buffer, warnings, prefix) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false,
    bookVBA: false, bookDeps: false, sheetRows: LIMIT.rows + 1 })
  if (!workbook.SheetNames.length) refuse('invalid-document', '工作簿中没有可读取的工作表')
  if (workbook.SheetNames.length > LIMIT.sheets) refuse('too-large', '工作簿超过 20 个工作表，请先拆分源文件')
  let cells = 0
  const parts = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name]
    if (!sheet) refuse('invalid-document', '部分工作表无法读取，未导入不完整工作簿')
    const ref = sheet['!fullref'] || sheet['!ref']
    if (ref) {
      const range = XLSX.utils.decode_range(ref)
      const rows = range.e.r - range.s.r + 1, columns = range.e.c - range.s.c + 1
      cells += rows * columns
      if (!Number.isSafeInteger(cells) || rows > LIMIT.rows || columns > LIMIT.columns || cells > LIMIT.cells) {
        refuse('too-large', '工作簿超过 10000 行、200 列或合计 200000 单元格，请先拆分源文件')
      }
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true })
    if (sheet['!merges']?.length) warnings.push('合并单元格保留左上角内容，其余位置为空，请核对列对应关系')
    return '## ' + officeText(name, prefix, 'SHEET') + '\n\n' + markdownTable(rows, prefix)
  })
  warnings.push(`已读取全部 ${workbook.SheetNames.length} 个工作表；公式使用文件中保存的结果，图表、图片、宏和外部数据连接不导入`)
  return parts.join('\n\n')
}

// Production runs this only in a disposable worker. No writes or networking.
export async function parseLocalImportFile(filePath) {
  const { ext, buffer } = readSource(filePath)
  if ((ext === '.docx' || ext === '.xlsx') && buffer.subarray(0, 4).toString('hex') !== '504b0304') {
    refuse('invalid-document', '文件格式与扩展名不符，请在原程序中另存后重试')
  }
  if (ext === '.docx' || ext === '.xlsx') inspectOfficeArchive(buffer)
  if ((ext === '.doc' || ext === '.xls') && buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') {
    refuse('invalid-document', '旧版 Office 文件格式无效，请在原程序中另存后重试')
  }
  const warnings = []
  let content, contentType = 'markdown', officeTextPrefix
  try {
    if (ext === '.docx') {
      let tables
      const result = await mammoth.convertToHtml({ buffer }, { externalFileAccess: false,
        transformDocument: document => {
          officeTextPrefix = literalPrefix(wordNodeText(document))
          tables = wordTableValues(document)
          return document
        },
        convertImage: mammoth.images.imgElement(async () => ({ src: '' })) })
      content = wordMarkdown(result.value, warnings, officeTextPrefix, tables)
      warnings.push('Word 已转换正文和常见格式；图片、页眉页脚、批注、修订和页面布局不导入，请核对预览')
      if (result.messages?.length) warnings.push('转换器提示部分格式无法保留，请核对正文内容')
    } else if (ext === '.doc') {
      contentType = 'text'
      content = (await new WordExtractor().extract(buffer)).getBody()
      warnings.push('旧版 Word 仅导入正文文本；图片、批注、样式和页面布局不导入')
    } else if (ext === '.xlsx' || ext === '.xls') {
      officeTextPrefix = 'NPIMPORT0'
      content = spreadsheet(buffer, warnings, officeTextPrefix)
    }
    else {
      contentType = ext === '.txt' ? 'text' : 'markdown'
      content = decodeText(buffer)
      if (ext === '.md') warnings.push('导入 Markdown 正文和常见格式；图片和 HTML 按文本处理，不下载外部资源')
    }
  } catch (error) {
    if (error instanceof LocalImportError) throw error
    refuse('invalid-document', '文档无法解析，可能已损坏、加密或格式与扩展名不符，请另存后重试')
  }
  if (typeof content !== 'string' || !content.trim()) refuse('empty', '文件没有可导入的正文')
  if (Buffer.byteLength(content, 'utf8') > LIMIT.contentBytes) refuse('too-large', '转换正文超过 2 MiB，请先拆分源文件')
  return { title: path.basename(filePath), originalPath: filePath, format: ext.slice(1), content,
    ...(officeTextPrefix ? { tableCellEncoding: 'base64-utf8-v1', officeTextPrefix } : {}),
    contentType, success: true, warnings: [...new Set(warnings)] }
}
