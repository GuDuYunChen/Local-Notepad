// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import syncFS from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { prepareExportPlan, describeExportPlan, executeExportPlan, LOCAL_EXPORT_LIMITS as LIMIT } from './local-export.js'
import { inspectExportContent } from './local-export-document.js'
import { exportName } from './local-export-policy.js'

const BASE = 'http://127.0.0.1:27121'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gAAAAABJRU5ErkJggg==', 'base64')
const roots = []
const body = (...children) => JSON.stringify({ root: { type: 'root', children } })
const paragraph = text => ({ type: 'paragraph', children: [{ type: 'text', text, format: 0 }] })
const note = (id, title = id + '.md', content = body(paragraph('正文 ' + id)), parent_id = '') => ({ id, title, content, parent_id, is_folder: false, is_deleted: false })
const folder = (id, title = id, parent_id = '') => ({ id, title, parent_id, is_folder: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const temp = async () => { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'notepad-local-export-')); roots.push(directory); return directory }
const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { 'content-type': 'application/json' } })
function service(files, assets = {}) {
  const calls = []
  const fetchImpl = vi.fn(async (raw, init) => {
    const url = new URL(raw); calls.push({ url: url.href, method: init.method })
    if (url.pathname === '/api/files') {
      const start = (Number(url.searchParams.get('page')) - 1) * LIMIT.pageSize
      return response(files.slice(start, start + LIMIT.pageSize).map(({ content, ...rest }) => rest))
    }
    if (url.pathname.startsWith('/api/files/')) {
      const file = files.find(item => item.id === decodeURIComponent(url.pathname.slice('/api/files/'.length)))
      return file ? response(file) : new Response('missing', { status: 404 })
    }
    const value = assets[url.pathname]
    return value ? new Response(value.bytes || value, { headers: { 'content-type': value.mime || 'image/png' } }) : new Response('missing', { status: 404 })
  })
  return { fetchImpl, calls }
}
async function prepare(files, ids = [files[0].id], format = 'markdown', assets = {}) {
  const native = service(files, assets)
  return { plan: await prepareExportPlan({ ids, format, fetchImpl: native.fetchImpl, baseURL: BASE }), ...native }
}
function zipFiles(bytes) {
  const files = new Map()
  let end = bytes.length - 22
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('ZIP EOCD missing')
  let central = bytes.readUInt32LE(end + 16)
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    expect(bytes.readUInt32LE(central)).toBe(0x02014b50)
    const method = bytes.readUInt16LE(central + 10), length = bytes.readUInt32LE(central + 20)
    const nameLength = bytes.readUInt16LE(central + 28), extra = bytes.readUInt16LE(central + 30), comment = bytes.readUInt16LE(central + 32)
    const name = bytes.subarray(central + 46, central + 46 + nameLength).toString(), local = bytes.readUInt32LE(central + 42)
    const offset = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
    const compressed = bytes.subarray(offset, offset + length)
    files.set(name, method === 8 ? inflateRawSync(compressed) : compressed)
    central += 46 + nameLength + extra + comment
  }
  return files
}
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

describe('saved local export preview', () => {
  it('reads every metadata page, expands selected folders once and freezes the saved preview', async () => {
    const files = [folder('parent', '目录'), ...Array.from({ length: 202 }, (_, i) => note('n' + i, '笔记' + i + '.md', body(paragraph('内容' + i)), i < 2 ? 'parent' : ''))]
    const { plan, calls } = await prepare(files, ['parent', 'n0'])
    expect(plan.items.map(item => item.id)).toEqual(['n0', 'n1'])
    expect(calls.filter(call => new URL(call.url).pathname === '/api/files')).toHaveLength(2)
    expect(plan.items[0].relativePath).toBe('目录/笔记0.md')
    const summary = describeExportPlan(plan)
    expect(summary.source).toBe('saved'); expect(summary.counts).toEqual({ total: 2, ready: 2, running: 0, succeeded: 0, failed: 0, cancelled: 0 })
    expect(JSON.stringify(summary)).not.toContain('snapshot')
    files[1].content = body(paragraph('后来修改'))
    const report = await executeExportPlan(plan, { targetDir: await temp() })
    expect(await fs.readFile(report.items[0].outputPath, 'utf8')).toContain('内容0')
    expect(await fs.readFile(report.items[0].outputPath, 'utf8')).not.toContain('后来修改')
    expect(calls.every(call => call.method === 'GET')).toBe(true)
  })
  it('allocates portable paths for same-stem notes, folders, reserved names and case collisions', async () => {
    const { plan } = await prepare([note('a', 'Same.md'), note('b', 'same.txt'), folder('assets', 'Same_assets'), note('c', 'CON.txt'), note('d', '..')], ['a', 'b', 'assets', 'c', 'd'])
    expect(plan.items.map(item => item.relativePath)).toEqual(['Same.md', 'same (2).md', '_CON.md', '未命名.md'])
    expect(exportName('..')).toBe('未命名'); expect(exportName('LPT9.txt')).toBe('_LPT9.txt')
    expect(exportName('a/b\\c:<>|*?". ')).toBe('a_b_c_______')
  })
  it.each([
    ['duplicate input', ['a', 'a'], [note('a')]],
    ['unknown selection', ['missing'], [note('a')]],
    ['empty folder', ['f'], [folder('f')]],
    ['orphan', ['a'], [note('a', 'a', body(paragraph('x')), 'missing')]],
    ['cycle', ['f'], [folder('f', 'f', 'g'), folder('g', 'g', 'f')]],
  ])('rejects %s instead of constructing an incomplete plan', async (_name, ids, files) => {
    await expect(prepare(files, ids)).rejects.toBeInstanceOf(Error)
  })
  it('rejects duplicated or malformed metadata and unavailable pages', async () => {
    await expect(prepare([note('a'), note('a')])).rejects.toMatchObject({ code: 'invalid-metadata' })
    await expect(prepare([{ ...note('a'), is_folder: 'false' }])).rejects.toMatchObject({ code: 'invalid-metadata' })
    await expect(prepareExportPlan({ ids: ['a'], format: 'markdown', fetchImpl: async () => response({ partial: [note('a')] }) })).rejects.toMatchObject({ code: 'invalid-metadata' })
  })
  it('does not omit a selected note whose saved body fails to load', async () => {
    const fake = service([note('a'), note('b')])
    const fetchImpl = (url, init) => String(url).endsWith('/b') ? Promise.resolve(new Response('missing', { status: 404 })) : fake.fetchImpl(url, init)
    await expect(prepareExportPlan({ ids: ['a', 'b'], format: 'markdown', fetchImpl })).rejects.toMatchObject({ code: 'read-failed', message: expect.stringContaining('b.md') })
  })
  it('rejects a response for another note and a renamed body after metadata reading', async () => {
    for (const override of [{ id: 'other' }, { title: 'renamed.md' }, { parent_id: 'other' }, { is_deleted: true }]) {
      const fake = service([note('a')])
      const fetchImpl = (url, init) => String(url).endsWith('/a') ? Promise.resolve(response({ ...note('a'), ...override })) : fake.fetchImpl(url, init)
      await expect(prepareExportPlan({ ids: ['a'], format: 'markdown', fetchImpl })).rejects.toMatchObject({ code: 'source-changed' })
    }
  })
  it('enforces note, body and tree limits without truncating', async () => {
    const files = [folder('f'), ...Array.from({ length: 101 }, (_, i) => note('n' + i, 'n.md', '', 'f'))]
    await expect(prepare(files, ['f'])).rejects.toMatchObject({ code: 'too-many-notes' })
    expect(() => inspectExportContent('x'.repeat(LIMIT.contentBytes + 1), 'markdown')).toThrow(/2 MiB/)
    let node = paragraph('x'); for (let i = 0; i < 66; i++) node = { type: 'mark', children: [node] }
    expect(() => inspectExportContent(body(node), 'markdown')).toThrow(/64 层/)
    expect(() => inspectExportContent(body({ type: 'new-private-node', privateText: 'must not be lost' }), 'markdown')).toThrow(/暂不支持/)
  })
  it('rejects aborted, expired and late successful reads before creating a plan', async () => {
    const controller = new AbortController(); controller.abort()
    const fetchImpl = vi.fn()
    await expect(prepareExportPlan({ ids: ['a'], format: 'markdown', signal: controller.signal, fetchImpl })).rejects.toMatchObject({ code: 'cancelled' })
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(prepareExportPlan({ ids: ['a'], format: 'markdown', deadline: Date.now() - 1, fetchImpl })).rejects.toMatchObject({ code: 'timeout' })
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const late = async () => { vi.setSystemTime(62000); return response([note('a')]) }
    await expect(prepareExportPlan({ ids: ['a'], format: 'markdown', deadline: 61000, fetchImpl: late })).rejects.toMatchObject({ code: 'timeout' })
  })
  it('bounds streamed bytes and refuses invalid JSON without including response content in errors', async () => {
    const privateText = 'PRIVATE-CONTENT'
    await expect(prepareExportPlan({ ids: ['a'], format: 'markdown', fetchImpl: async () => new Response(privateText) })).rejects.toMatchObject({ code: 'invalid-response', message: expect.not.stringContaining(privateText) })
    await expect(prepareExportPlan({ ids: ['a'], format: 'markdown', fetchImpl: async () => new Response('x', { headers: { 'content-length': String(LIMIT.responseBytes + 1) } }) })).rejects.toMatchObject({ code: 'too-large' })
  })
})

describe('complete local output transactions', () => {
  it('writes verified Markdown and local attachment bytes into a new directory without overwriting old files', async () => {
    const target = await temp(), existing = path.join(target, 'note.md'); await fs.writeFile(existing, 'USER-EXISTING')
    const content = body(paragraph('文档正文'), { type: 'image', src: BASE + '/uploads/picture.png', alt: '插图', caption: '图注' }, { type: 'attachment', src: '/uploads/data.txt', name: '数据.txt' })
    const { plan } = await prepare([note('a', 'note.md', content)], ['a'], 'markdown', { '/uploads/picture.png': PNG, '/uploads/data.txt': { bytes: Buffer.from('附件\0原字节'), mime: 'text/plain' } })
    const result = await executeExportPlan(plan, { targetDir: target })
    expect(result.state).toBe('completed'); const row = result.items[0]
    expect(await fs.readFile(existing, 'utf8')).toBe('USER-EXISTING')
    const bytes = await fs.readFile(row.outputPath)
    expect(sha(bytes)).toBe(row.sha256); expect(bytes.length).toBe(row.bytes); expect(row.assetCount).toBe(2)
    expect(bytes.toString()).toContain('note_assets/picture.png'); expect(bytes.toString()).toContain('note_assets/数据.txt')
    expect(await fs.readFile(path.join(result.exportDirectory, 'note_assets', 'picture.png'))).toEqual(PNG)
    expect(await fs.readFile(path.join(result.exportDirectory, 'note_assets', '数据.txt'))).toEqual(Buffer.from('附件\0原字节'))
    expect(bytes.toString()).not.toContain('127.0.0.1')
  })
  it('generates a real Word archive with images, attachment relationships and correct underline/strike', async () => {
    const content = body({ type: 'paragraph', children: [{ type: 'text', text: '删除线', format: 4 }, { type: 'text', text: '下划线', format: 8 }, { type: 'wiki-link', title: '目标', sectionPath: ['第一章'] }] },
      { type: 'image', src: '/uploads/image.png', alt: '真实图片', width: 1, height: 1 }, { type: 'attachment', src: '/uploads/a.txt', name: 'a.txt' },
      { type: 'formula', expression: 'x^2+y^2', displayMode: true }, { type: 'toggle', title: '折叠标题', content: '隐藏正文', collapsed: true })
    const { plan } = await prepare([note('a', '文档.md', content)], ['a'], 'docx', { '/uploads/image.png': PNG, '/uploads/a.txt': { bytes: Buffer.from('attachment'), mime: 'text/plain' } })
    const result = await executeExportPlan(plan, { targetDir: await temp() }), row = result.items[0]
    expect(row.status).toBe('succeeded'); expect(row.assetCount).toBe(1)
    const archive = zipFiles(await fs.readFile(row.outputPath)), xml = archive.get('word/document.xml').toString()
    expect(xml).toContain('<w:strike/>'); expect(xml).toContain('<w:u ')
    for (const text of ['删除线', '下划线', '[[目标#第一章]]', 'x^2+y^2', '折叠标题', '隐藏正文']) expect(xml).toContain(text)
    expect([...archive.entries()].some(([name, value]) => name.startsWith('word/media/') && value.equals(PNG))).toBe(true)
    expect(archive.get('word/_rels/document.xml.rels').toString()).toContain('文档_assets/a.txt')
  })
  it('preserves decorators and literal code delimiters instead of silently dropping fields', async () => {
    const content = body({ type: 'paragraph', children: [{ type: 'text', text: '删除', format: 4 }, { type: 'text', text: '下划', format: 8 }, { type: 'inline-code', text: 'a`b' }] },
      { type: 'code-block', code: 'before\n```\nafter', language: 'js' }, { type: 'callout', icon: '!', text: '提示文字' },
      { type: 'toggle', title: '折叠题', content: '折叠内容', collapsed: true }, { type: 'formula', expression: 'a+b', displayMode: true },
      { type: 'embed', title: '外部引用', url: 'https://example.test/page' }, { type: 'todo', checked: true, text: '已办' })
    const { plan } = await prepare([note('a', 'a.md', content)])
    const report = await executeExportPlan(plan, { targetDir: await temp() }), md = await fs.readFile(report.items[0].outputPath, 'utf8')
    for (const text of ['~~删除~~', '<u>下划</u>', '``a`b``', '````js', '提示文字', '折叠题', '折叠内容', 'a+b', 'https://example.test/page', '- [x] 已办']) expect(md).toContain(text)
    expect(report.items[0].warnings.length).toBeGreaterThan(0)
  })
  it('preserves merged-cell text, local images and link labels in inert Markdown HTML', async () => {
    const content = body({ type: 'table', children: [{ type: 'tablerow', children: [{ type: 'tablecell', colSpan: 2, rowSpan: 1, children: [
      { type: 'paragraph', children: [{ type: 'text', text: '<script>literal</script>', format: 0 }, { type: 'link', url: 'https://example.test/?x="quoted"', children: [{ type: 'text', text: '链接' }] }] },
      { type: 'image', src: '/uploads/cell.png', alt: '格中图片' },
    ] }] }] })
    const { plan } = await prepare([note('a', 'a.md', content)], ['a'], 'markdown', { '/uploads/cell.png': PNG })
    const report = await executeExportPlan(plan, { targetDir: await temp() }), text = await fs.readFile(report.items[0].outputPath, 'utf8')
    expect(text).toContain('<td colspan="2" rowspan="1">'); expect(text).toContain('&lt;script&gt;literal&lt;/script&gt;')
    expect(text).toContain('a_assets/cell.png'); expect(text).toContain('&quot;quoted&quot;'); expect(text).not.toContain('<script>')
    expect(await fs.readFile(path.join(report.exportDirectory, 'a_assets', 'cell.png'))).toEqual(PNG)
  })
  it('reports one failed resource while preserving other successes, then retries only the failed item', async () => {
    const assets = {}, { plan, calls } = await prepare([note('a'), note('b', 'b.md', body({ type: 'image', src: '/uploads/missing.png' }))], ['a', 'b'], 'markdown', assets)
    const directory = await temp(), first = await executeExportPlan(plan, { targetDir: directory })
    expect(first.items.map(item => item.status)).toEqual(['succeeded', 'failed']); expect(first.state).toBe('partial')
    const success = first.items[0], modified = (await fs.stat(success.outputPath)).mtimeMs
    assets['/uploads/missing.png'] = PNG
    const second = await executeExportPlan(plan, { targetDir: directory, retryFailed: true })
    expect(second.state).toBe('completed'); expect(second.items[0]).toEqual(success)
    expect((await fs.stat(success.outputPath)).mtimeMs).toBe(modified)
    expect(calls.filter(item => item.url.endsWith('/api/files/a'))).toHaveLength(1)
  })
  it('stops between items, preserves the first receipt and resumes only cancelled items', async () => {
    const { plan } = await prepare([note('a'), note('b')], ['a', 'b']), directory = await temp(), controller = new AbortController()
    const first = await executeExportPlan(plan, { targetDir: directory, signal: controller.signal, onProgress: report => { if (report.counts.succeeded === 1) controller.abort() } })
    expect(first.state).toBe('cancelled'); expect(first.items.map(item => item.status)).toEqual(['succeeded', 'cancelled'])
    const second = await executeExportPlan(plan, { targetDir: directory })
    expect(second.state).toBe('completed'); expect(second.items[0]).toEqual(first.items[0])
  })
  it('settles and cleans an already-started write on cancellation without exposing it as a success', async () => {
    const { plan } = await prepare([note('a')]), targetDir = await temp(), controller = new AbortController()
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args), write = handle.writeFile.bind(handle)
      handle.writeFile = async (...params) => { await write(...params); controller.abort() }
      return handle
    })
    const result = await executeExportPlan(plan, { targetDir, signal: controller.signal })
    expect(result.state).toBe('cancelled'); expect(result.items[0].status).toBe('cancelled'); expect(result.items[0].sha256).toBeUndefined()
    expect(await fs.readdir(result.exportDirectory)).toEqual([])
  })
  it('refuses an existing output path and never overwrites it, including on retry', async () => {
    const { plan } = await prepare([note('a')]), targetDir = await temp()
    let collision
    const first = await executeExportPlan(plan, { targetDir, onProgress: report => {
      if (!collision && report.exportDirectory) { collision = path.join(report.exportDirectory, 'a.md'); syncFS.writeFileSync(collision, 'USER-COLLISION') }
    } })
    expect(first.items[0].status).toBe('failed'); expect(await fs.readFile(collision, 'utf8')).toBe('USER-COLLISION')
    const again = await executeExportPlan(plan, { targetDir, retryFailed: true })
    expect(again.items[0].status).toBe('failed'); expect(await fs.readFile(collision, 'utf8')).toBe('USER-COLLISION')
  })
  it('rejects read-back corruption, clears only owned bytes and does not issue a success receipt', async () => {
    const { plan } = await prepare([note('a')]), targetDir = await temp(), read = fs.readFile.bind(fs)
    let corrupt = true
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      const bytes = await read(...args)
      if (corrupt && String(args[0]).endsWith('a.md')) { corrupt = false; return Buffer.from('different') }
      return bytes
    })
    const report = await executeExportPlan(plan, { targetDir })
    expect(report.items[0]).toMatchObject({ status: 'failed', code: 'write-unconfirmed' }); expect(report.items[0].sha256).toBeUndefined()
    expect(await fs.readdir(report.exportDirectory)).toEqual([])
  })
  it('reports every actual residual path and refuses to overwrite residual document or asset on retry', async () => {
    const { plan } = await prepare([note('a', 'a.md', body({ type: 'image', src: '/uploads/picture.png' }))],
      ['a'], 'markdown', { '/uploads/picture.png': { bytes: PNG, mime: 'image/png' } })
    const targetDir = await temp(), controller = new AbortController(), open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args), write = handle.writeFile.bind(handle)
      handle.writeFile = async (...params) => { await write(...params); controller.abort() }
      return handle
    })
    vi.spyOn(fs, 'unlink').mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
    const first = await executeExportPlan(plan, { targetDir, signal: controller.signal })
    expect(first.items[0]).toMatchObject({ status: 'failed', code: 'cleanup-incomplete', partialPath: expect.stringContaining('a.md') })
    expect(first.items[0].partialPaths).toHaveLength(2)
    expect(first.items[0].partialPaths).toContain(first.items[0].partialPath)
    expect(first.items[0].partialPaths.some(value => value.endsWith(path.join('a_assets', 'image-' + sha(PNG).slice(0, 12) + '.png')))).toBe(true)
    const originals = await Promise.all(first.items[0].partialPaths.map(filename => fs.readFile(filename)))
    await expect(executeExportPlan(plan, { targetDir, retryFailed: true })).rejects.toMatchObject({ code: 'cleanup-incomplete' })
    expect(plan.items[0].partialPaths).toEqual(first.items[0].partialPaths)
    expect(await Promise.all(first.items[0].partialPaths.map(filename => fs.readFile(filename)))).toEqual(originals)
  })
  it('refuses a symlink introduced into its owned output hierarchy', async () => {
    const { plan } = await prepare([folder('f', 'folder'), note('a', 'a.md', body(paragraph('body')), 'f')], ['f']), targetDir = await temp(), outside = await temp()
    let inserted = false
    const report = await executeExportPlan(plan, { targetDir, onProgress: state => {
      if (!inserted && state.exportDirectory) { syncFS.symlinkSync(outside, path.join(state.exportDirectory, 'folder'), process.platform === 'win32' ? 'junction' : 'dir'); inserted = true }
    } })
    expect(report.items[0].status).toBe('failed'); expect(await fs.readdir(outside)).toEqual([])
  })
  it('refuses a changed export root and prevents switching destination after output', async () => {
    const { plan } = await prepare([note('a'), note('b', 'b.md', body({ type: 'image', src: '/uploads/missing.png' }))], ['a', 'b']), targetDir = await temp()
    const first = await executeExportPlan(plan, { targetDir })
    await expect(executeExportPlan(plan, { targetDir: await temp(), retryFailed: true })).rejects.toMatchObject({ code: 'destination-changed' })
    const moved = first.exportDirectory + '-old'; await fs.rename(first.exportDirectory, moved); await fs.mkdir(first.exportDirectory)
    await expect(executeExportPlan(plan, { targetDir, retryFailed: true })).rejects.toMatchObject({ code: 'destination-changed' })
    expect(await fs.readdir(first.exportDirectory)).toEqual([])
  })
  it.each(['https://remote.invalid/x.png', 'file:///private.png', 'http://127.0.0.1:12345/uploads/x.png', '/uploads/%2e%2e%2fsecret', '/uploads/x.png?token=private'])('refuses external or unsafe resource %s before access', async src => {
    const { plan, calls } = await prepare([note('a', 'a.md', body({ type: 'image', src }))])
    const result = await executeExportPlan(plan, { targetDir: await temp() })
    expect(result.items[0]).toMatchObject({ status: 'failed', code: 'external-asset' })
    expect(calls.every(call => new URL(call.url).pathname.startsWith('/api/files'))).toBe(true)
    expect(await fs.readdir(result.exportDirectory)).toEqual([])
  })
  it('keeps failed image errors explicit with no partial document', async () => {
    const { plan } = await prepare([note('a', 'a.md', body({ type: 'image', src: '/uploads/a.png' }))], ['a'], 'docx', { '/uploads/a.png': Buffer.from('not an image') })
    const result = await executeExportPlan(plan, { targetDir: await temp() })
    expect(result.items[0]).toMatchObject({ status: 'failed', code: 'unsupported-image' }); expect(await fs.readdir(result.exportDirectory)).toEqual([])
  })
  it('refuses an oversized local attachment before allocating or writing output bytes', async () => {
    const { plan } = await prepare([note('a', 'a.md', body({ type: 'attachment', src: '/uploads/a.bin', name: 'a.bin' }))])
    plan.fetchImpl = async () => new Response('small actual body', { headers: { 'content-length': String(LIMIT.assetBytes + 1) } })
    const report = await executeExportPlan(plan, { targetDir: await temp() })
    expect(report.items[0]).toMatchObject({ status: 'failed', code: 'too-large' }); expect(await fs.readdir(report.exportDirectory)).toEqual([])
  })
  it('rejects empty data and invalid formats before access and ignores progress observer exceptions', async () => {
    const fetchImpl = vi.fn()
    await expect(prepareExportPlan({ ids: [], format: 'markdown', fetchImpl })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(prepareExportPlan({ ids: ['a'], format: 'pdf', fetchImpl })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(fetchImpl).not.toHaveBeenCalled()
    const { plan } = await prepare([note('a')])
    expect((await executeExportPlan(plan, { targetDir: await temp(), onProgress: () => { throw new Error('UI gone') } })).state).toBe('completed')
  })
})
