// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { deflateRawSync } from 'node:zlib'
import * as XLSX from 'xlsx'
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import { parseLocalImportFile } from './import-parser.js'
import { parseImportPaths, registerLocalImportHandlers } from './import.js'
import { LOCAL_IMPORT_LIMITS as LIMIT } from './import-policy.js'
import { inspectOfficeArchive } from './import-archive.js'

let directory
const source = (name, contents) => {
  const filename = path.join(directory, name)
  fs.writeFileSync(filename, contents)
  return filename
}
const tableValues = result => [...result.content.matchAll(/NPIMPORT\d+CELLV1:([A-Za-z0-9+/]*={0,2})/g)]
  .map(match => Buffer.from(match[1], 'base64').toString('utf8'))
beforeAll(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-test-')) })
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))
afterEach(() => vi.useRealTimers())

describe('local document conversion', () => {
  it('bounds actual ZIP expansion even when its directory lies about uncompressed size', () => {
    const original = Buffer.alloc(LIMIT.archiveEntryBytes + 1, 65), packed = deflateRawSync(original)
    const name = Buffer.from('document.xml'), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(1, 22); local.writeUInt16LE(name.length, 26)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(1, 24); central.writeUInt16LE(name.length, 28)
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + packed.length, 16)
    const archive = Buffer.concat([local, name, packed, central, name, end])
    expect(() => inspectOfficeArchive(archive)).toThrow(/解压内容超过/)
    expect(() => inspectOfficeArchive(Buffer.from('PK\x03\x04truncated'))).toThrow(/压缩结构/)
  })
  it('preserves Chinese Markdown, code, formula and tables without writing source data', async () => {
    const body = '# 入口\n\n中文正文\n\n```js\nconst n = 1\n```\n\n$$x^2$$\n\n| 一 | 二 |\n| --- | --- |\n| 甲 | 乙 |'
    const filename = source('示例.md', body)
    expect(await parseLocalImportFile(filename)).toMatchObject({ success: true, content: body, contentType: 'markdown' })
    expect(fs.readFileSync(filename, 'utf8')).toBe(body)
  })

  it('decodes UTF-8 BOM and Windows UTF-16 BOM strictly', async () => {
    expect((await parseLocalImportFile(source('utf8.txt', Buffer.from('\ufeff中文\r\n第二行')))).content).toBe('中文\n第二行')
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文\r\n第二行', 'utf16le')])
    expect((await parseLocalImportFile(source('utf16.txt', le))).content).toBe('中文\n第二行')
    const be = Buffer.from(le).swap16()
    expect((await parseLocalImportFile(source('utf16be.txt', be))).content).toBe('中文\n第二行')
  })

  it.each([
    ['empty.txt', '', 'empty'], ['blank.md', ' \n\t', 'empty'],
    ['bad-utf8.txt', Buffer.from([0xc0, 0xff]), 'invalid-text'],
    ['binary.txt', Buffer.from('abc\0xyz'), 'invalid-text'],
    ['bad.docx', 'not a zip', 'invalid-document'], ['bad.doc', 'not a word file', 'invalid-document'],
    ['bad.xlsx', 'not an actual workbook', 'invalid-document'], ['bad.xls', 'not an actual workbook', 'invalid-document'],
    ['unsupported.pdf', '%PDF', 'unsupported'],
  ])('returns a specific failure for %s', async (name, body, code) => {
    await expect(parseLocalImportFile(source(name, body))).rejects.toMatchObject({ code })
  })

  it('refuses missing, directory, oversize and unsafe paths before conversion', async () => {
    await expect(parseLocalImportFile(path.join(directory, 'missing.md'))).rejects.toMatchObject({ code: 'unreadable' })
    const folder = path.join(directory, 'folder.md'); fs.mkdirSync(folder)
    await expect(parseLocalImportFile(folder)).rejects.toMatchObject({ code: 'not-file' })
    const large = source('large.txt', '')
    fs.truncateSync(large, LIMIT.fileBytes + 1)
    await expect(parseLocalImportFile(large)).rejects.toMatchObject({ code: 'too-large' })
    await expect(parseLocalImportFile('../unsafe.txt')).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('imports every worksheet and preserves cached formula values, empty sheets and merged-cell warnings', async () => {
    const workbook = XLSX.utils.book_new()
    const one = XLSX.utils.aoa_to_sheet([['名称', '值'], ['第一张标记', 7]])
    one.B2.f = '3+4'
    one['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
    XLSX.utils.book_append_sheet(workbook, one, '中文一')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['第二张标记', '值'], ['另一个内容', 'x|y']]), '中文二')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), '空表')
    const filename = path.join(directory, '多工作表.xlsx')
    XLSX.writeFile(workbook, filename)
    const result = await parseLocalImportFile(filename)
    const names = [...result.content.matchAll(/^## NPIMPORT\d+SHEETV1:([A-Za-z0-9+/]*={0,2})$/gm)]
      .map(match => Buffer.from(match[1], 'base64').toString('utf8'))
    expect(names).toEqual(['中文一', '中文二', '空表'])
    expect(result.content).toContain('（空工作表）')
    expect(result.tableCellEncoding).toBe('base64-utf8-v1')
    expect(tableValues(result)).toEqual(['名称', '值', '第一张标记', '7', '第二张标记', '值', '另一个内容', 'x|y'])
    expect(result.warnings.join(' ')).toContain('全部 3 个工作表')
    expect(result.warnings.join(' ')).toContain('合并单元格')
  })

  it('rejects a workbook over the row budget instead of silently truncating it', async () => {
    const workbook = XLSX.utils.book_new()
    const sheet = { A1: { t: 's', v: 'start' }, A10002: { t: 's', v: 'must not disappear' }, '!ref': 'A1:A10002' }
    XLSX.utils.book_append_sheet(workbook, sheet, 'too long')
    const filename = path.join(directory, 'rows.xlsx'); XLSX.writeFile(workbook, filename)
    await expect(parseLocalImportFile(filename)).rejects.toMatchObject({ code: 'too-large' })
  })

  it('converts actual DOCX paragraphs and tables to previewable text without raw table HTML', async () => {
    const document = new Document({ sections: [{ children: [new Paragraph('Word中文正文'),
      new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('表头一')] }),
        new TableCell({ children: [new Paragraph('表头二')] })] }), new TableRow({ children: [
        new TableCell({ children: [new Paragraph('表格正文')] }), new TableCell({ children: [new Paragraph('第二列')] })] })] })] }] })
    const result = await parseLocalImportFile(source('actual.docx', await Packer.toBuffer(document)))
    expect(result.content).toContain('Word中文正文')
    expect(result.tableCellEncoding).toBe('base64-utf8-v1')
    expect(tableValues(result)).toEqual(['表头一', '表头二', '表格正文', '第二列'])
    expect(result.content).not.toMatch(/<table/i)
  })
})

describe('worker isolation and batch ownership', () => {
  class LocalWorker extends EventEmitter {
    constructor(_script, { workerData }) {
      super()
      parseLocalImportFile(workerData.filePath).then(result => this.emit('message', { ok: true, result }),
        error => this.emit('message', { ok: false, code: error.code, message: error.message }))
    }
    terminate() { return Promise.resolve(0) }
    unref() {}
  }
  it('keeps valid results before and after an unreadable file', async () => {
    const files = [source('before.md', 'before'), path.join(directory, 'gone.md'), source('after.txt', 'after')]
    const results = await parseImportPaths(files, { workerPath: '/isolated-test', WorkerClass: LocalWorker })
    expect(results.map(item => item.success || item.code)).toEqual([true, 'unreadable', true])
    expect(results.map(item => item.originalPath)).toEqual(files)
  })

  it('stops the active worker and never starts later files after cancellation', async () => {
    const workers = []
    class WaitingWorker extends EventEmitter {
      constructor() { super(); workers.push(this) }
      terminate = vi.fn().mockResolvedValue(0)
      unref() {}
    }
    const controller = new AbortController()
    const operation = parseImportPaths([path.join(directory, 'wait.txt'), path.join(directory, 'later.txt')],
      { workerPath: '/test', WorkerClass: WaitingWorker, signal: controller.signal })
    controller.abort()
    expect((await operation).map(item => item.code)).toEqual(['cancelled', 'cancelled'])
    expect(workers).toHaveLength(1)
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(() => workers[0].emit('error', new Error('late failure'))).not.toThrow()
  })

  it('enforces a timeout and handles worker exit without dropping the batch', async () => {
    vi.useFakeTimers()
    const workers = []
    class WaitingWorker extends EventEmitter {
      constructor() { super(); workers.push(this) }
      terminate() { return Promise.resolve(0) }
      unref() {}
    }
    const operation = parseImportPaths([path.join(directory, 'wait.txt'), path.join(directory, 'exit.txt')],
      { workerPath: '/test', WorkerClass: WaitingWorker, timeoutMs: 25 })
    await vi.advanceTimersByTimeAsync(25)
    workers[1].emit('exit', 1)
    expect((await operation).map(item => item.code)).toEqual(['timeout', 'invalid-document'])
  })

  it('rejects a late successful message even before the timeout callback gets a turn', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    let worker
    class WaitingWorker extends EventEmitter {
      constructor() { super(); worker = this }
      terminate() { return Promise.resolve(0) }
      unref() {}
    }
    const filename = path.join(directory, 'late.txt')
    const operation = parseImportPaths([filename], { workerPath: '/test', WorkerClass: WaitingWorker, timeoutMs: 25 })
    vi.setSystemTime(1026)
    worker.emit('message', { ok: true, result: { originalPath: filename, success: true, content: 'late', contentType: 'text' } })
    expect((await operation)[0].code).toBe('timeout')
  })

  it('bounds batch length and combined converted content', async () => {
    await expect(parseImportPaths(Array(21).fill('/file.md'), { workerPath: '/test' })).rejects.toMatchObject({ code: 'too-many-files' })
    const results = await parseImportPaths([source('limit-a.txt', 'a'.repeat(LIMIT.contentBytes)), source('limit-b.txt', 'b')],
      { workerPath: '/test', WorkerClass: LocalWorker })
    expect(results[0].success).toBe(true)
    expect(results[1].code).toBe('too-large')
  })
})

function bridgeFixture(parse) {
  const handlers = new Map(), contents = new EventEmitter(), owner = new EventEmitter()
  const url = 'file:///test/dist/index.html'
  contents.isDestroyed = () => false; contents.getURL = () => url; contents.mainFrame = { url }
  owner.isDestroyed = () => false; owner.webContents = contents
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/native.md'] }) }
  let current = owner, closing = false
  registerLocalImportHandlers({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog,
    getWindow: () => current, getExpectedURL: () => url, isClosing: () => closing, workerPath: '/worker', parse })
  return { handlers, owner, contents, event, dialog, replace: () => { current = null }, close: () => { closing = true } }
}

describe('native importer IPC source guard', () => {
  it('uses real selection and only gives paths to the trusted current document', async () => {
    const parse = vi.fn().mockResolvedValue([]), f = bridgeFixture(parse)
    expect(await f.handlers.get('import:files')(f.event, { requestId: 'one' })).toMatchObject({ success: true })
    expect(f.dialog.showOpenDialog.mock.calls[0][0]).toBe(f.owner)
    expect(parse.mock.calls[0][0]).toEqual(['/native.md'])
    for (const event of [{ ...f.event, sender: {} }, { ...f.event, senderFrame: { url: 'https://wrong.example' } }]) {
      expect(await f.handlers.get('import:paths')(event, { paths: ['/secret.txt'] })).toMatchObject({ success: false })
    }
    expect(parse).toHaveBeenCalledOnce()
  })

  it('refuses overlap and foreign cancellation, then aborts only its own request', async () => {
    let finish, signal
    const f = bridgeFixture((_paths, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve }) })
    const first = f.handlers.get('import:paths')(f.event, { requestId: 'first', paths: ['/a.txt'] })
    expect(await f.handlers.get('import:paths')(f.event, { requestId: 'second', paths: ['/b.txt'] })).toMatchObject({ success: false })
    expect(f.handlers.get('import:cancel')(f.event, { requestId: 'wrong' })).toEqual({ success: false })
    expect(signal.aborted).toBe(false)
    expect(f.handlers.get('import:cancel')(f.event, { requestId: 'first' })).toEqual({ success: true })
    expect(signal.aborted).toBe(true)
    finish([]); expect(await first).toMatchObject({ success: true, cancelled: true })
    expect(f.contents.listenerCount('destroyed')).toBe(0)
    expect(f.owner.listenerCount('close')).toBe(0)
  })

  it.each(['navigation', 'destroyed', 'close', 'replacement'])('invalidates an old batch after %s', async reason => {
    let finish, signal
    const f = bridgeFixture((_paths, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve }) })
    const first = f.handlers.get('import:paths')(f.event, { requestId: 'first', paths: ['/a.txt'] })
    if (reason === 'navigation') f.contents.emit('did-start-navigation', {}, '', false, true)
    if (reason === 'destroyed') f.contents.emit('destroyed')
    if (reason === 'close') { f.close(); f.owner.emit('close') }
    if (reason === 'replacement') f.replace()
    if (reason !== 'replacement') expect(signal.aborted).toBe(true)
    finish([])
    const result = await first
    expect(result.cancelled).toBe(true)
    expect(f.contents.listenerCount('did-start-navigation')).toBe(0)
  })
})
