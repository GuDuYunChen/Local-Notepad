// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const native = vi.hoisted(() => ({ windows: [], holdPrint: false, afterPrint: null }))
vi.mock('electron', () => ({ BrowserWindow: class {
  constructor() {
    this.destroyed = false
    this.webContents = {
      executeJavaScript: vi.fn(async () => true),
      printToPDF: vi.fn(async () => {
        if (native.holdPrint) return new Promise((_resolve, reject) => { this.rejectPrint = reject })
        native.afterPrint?.(); return Buffer.from('%PDF-test')
      }),
    }
    native.windows.push(this)
  }
  async loadURL() {}
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true; this.rejectPrint?.(new Error('Owned window destroyed')) }
  close() { this.destroyed = true }
} }))
import { exportCombinedManuscript, exportToPDF, exportToHTML } from './export.js'
import { materializeLocalAssetsInLexical, localUploadToDataUri } from './export-utils.js'

const roots = []
const temp = async () => { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'notepad-export-scope-')); roots.push(directory); return directory }
const lexical = text => JSON.stringify({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] } })
const file = { id: 'a', title: '笔记.md', content: lexical('正文'), is_folder: false }
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers(); native.windows.length = 0; native.holdPrint = false; native.afterPrint = null
  for (const directory of roots.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

it('refuses a cancelled combined export before reading or writing', async () => {
  const directory = await temp(), controller = new AbortController(); controller.abort()
  const fetchImpl = vi.spyOn(globalThis, 'fetch')
  await expect(exportCombinedManuscript(['a'], directory, 'markdown', '合并', { signal: controller.signal, deadline: Date.now() + 1000 })).rejects.toMatchObject({ code: 'cancelled' })
  expect(fetchImpl).not.toHaveBeenCalled(); expect(await fs.readdir(directory)).toEqual([])
})

it('passes the actual cancellation signal into the current combined-export body request', async () => {
  const directory = await temp(), controller = new AbortController()
  const fetchImpl = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    expect(init.signal).toBe(controller.signal)
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  const task = exportCombinedManuscript(['a'], directory, 'markdown', '合并', { signal: controller.signal, deadline: Date.now() + 1000 })
  controller.abort()
  await expect(task).rejects.toBeInstanceOf(Error)
  expect(fetchImpl).toHaveBeenCalledOnce(); expect(await fs.readdir(directory)).toEqual([])
})

it('refuses a successful body that arrived after the absolute deadline', async () => {
  const directory = await temp(); vi.useFakeTimers(); vi.setSystemTime(1000)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: true, json: async () => { vi.setSystemTime(3000); return { code: 0, data: file } } }))
  await expect(exportCombinedManuscript(['a'], directory, 'docx', '合并', { deadline: 2000 })).rejects.toMatchObject({ code: 'timeout' })
  expect(await fs.readdir(directory)).toEqual([])
})

it('does not let the legacy image fallback swallow cancellation or write late asset bytes', async () => {
  const directory = await temp(), controller = new AbortController()
  const content = JSON.stringify({ root: { children: [{ type: 'image', src: 'http://127.0.0.1:27121/uploads/a.png' }] } })
  const fetchImpl = vi.fn(async (_url, init) => ({ ok: true, arrayBuffer: async () => { expect(init.signal).toBe(controller.signal); controller.abort(); return Buffer.from('bytes') } }))
  await expect(materializeLocalAssetsInLexical(content, directory, 'assets', fetchImpl, { signal: controller.signal, deadline: Date.now() + 1000 })).rejects.toMatchObject({ code: 'cancelled' })
  expect(await fs.readdir(directory)).toEqual([])
  await expect(localUploadToDataUri('http://127.0.0.1:27121/uploads/a.png', fetchImpl, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
})

it('does not publish HTML when an image read finishes after cancellation', async () => {
  const directory = await temp(), controller = new AbortController()
  const content = JSON.stringify({ root: { children: [{ type: 'image', src: 'http://127.0.0.1:27121/uploads/a.png' }] } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: true, arrayBuffer: async () => { controller.abort(); return Buffer.from('bytes') } }))
  await expect(exportToHTML({ ...file, content }, path.join(directory, 'a.html'), { signal: controller.signal, deadline: Date.now() + 1000 })).rejects.toMatchObject({ code: 'cancelled' })
  expect(await fs.readdir(directory)).toEqual([])
})

it('destroys only the owned hidden PDF window when its print is cancelled', async () => {
  const directory = await temp(), controller = new AbortController(); native.holdPrint = true
  const task = exportToPDF(file, path.join(directory, 'a.pdf'), { signal: controller.signal, deadline: Date.now() + 1000 })
  const rejection = expect(task).rejects.toBeInstanceOf(Error)
  await vi.waitFor(() => expect(native.windows[0]?.rejectPrint).toBeTypeOf('function'))
  controller.abort(); await rejection
  expect(native.windows).toHaveLength(1); expect(native.windows[0].destroyed).toBe(true)
  expect(await fs.readdir(directory)).toEqual([])
})

it('does not publish a late PDF result even before the timeout callback runs', async () => {
  const directory = await temp(); vi.useFakeTimers(); vi.setSystemTime(1000); native.afterPrint = () => vi.setSystemTime(3000)
  await expect(exportToPDF(file, path.join(directory, 'a.pdf'), { deadline: 2000 })).rejects.toMatchObject({ code: 'timeout' })
  expect(native.windows[0].destroyed).toBe(true); expect(await fs.readdir(directory)).toEqual([])
})
