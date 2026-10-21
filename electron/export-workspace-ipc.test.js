// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerLocalExportHandlers } from './export-workspace-ipc.js'
import { prepareExportPlan, describeExportPlan, executeExportPlan, LocalExportError } from './local-export.js'
import { exportResult } from '../src/services/localExport.mjs'

const dispose = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of dispose.splice(0).reverse()) await cleanup() })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const advance = () => new Promise(resolve => setImmediate(resolve))

function recalculate(plan, state = plan.dto.state) {
  plan.dto.state = state
  plan.dto.counts = { total: plan.dto.items.length, ready: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 }
  for (const item of plan.dto.items) plan.dto.counts[item.status]++
  return structuredClone(plan.dto)
}
function makePlan(ids = ['note-1'], format = 'markdown') {
  const plan = { secretSourceBody: 'private saved source must not leak', dto: { format, createdAt: 1234,
    source: 'saved', state: 'prepared', exportDirectory: '', items: ids.map(id => ({ id, title: id,
      relativePath: `${id}.md`, preview: '已保存内容', status: 'ready', message: '', warnings: [] })) } }
  recalculate(plan)
  return plan
}

function harness(overrides = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-export-bridge-test-')))
  const contents = new EventEmitter(), owner = new EventEmitter(), frame = { url: 'http://localhost:5000/' }
  contents.mainFrame = frame; contents.getURL = () => frame.url; contents.isDestroyed = () => false
  owner.webContents = contents; owner.isDestroyed = () => false
  const event = { sender: contents, senderFrame: frame }, handles = new Map()
  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [directory] })),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: path.join(directory, 'chosen.md') })) }
  const shell = { openPath: vi.fn(async () => '') }
  const prepare = vi.fn(async ({ ids, format }) => makePlan(ids, format))
  const execute = vi.fn(async (plan, { targetDir, onProgress }) => {
    plan.dto.items.forEach(item => { if (item.status !== 'succeeded') item.status = 'succeeded' })
    const dto = recalculate(plan, 'completed'); onProgress(dto); return dto
  })
  let serial = 0
  const options = { ipcMain: { handle: (name, fn) => handles.set(name, fn), removeHandler: name => handles.delete(name) },
    dialog, shell, getWindow: () => owner, getExpectedURL: () => 'http://localhost:5000/',
    prepare, describe: plan => structuredClone(plan.dto), execute, createId: () => `native-${++serial}`,
    ...overrides }
  const runtime = registerLocalExportHandlers(options)
  const call = (name, payload, sender = event) => handles.get(name.includes(':') ? name : `export:workspace:${name}`)(sender, payload)
  const ready = async (ids = ['note-1']) => {
    const result = await call('prepare', { requestId: `preview-${++serial}`, ids, format: 'markdown' })
    expect(result.success).toBe(true)
    const chosen = await call('choose-directory', { planId: result.plan.planId })
    expect(chosen.success).toBe(true)
    return chosen.plan
  }
  const settled = async planId => {
    const until = Date.now() + 2000
    while (Date.now() < until) {
      const result = await call('status', { planId })
      if (!result.success || !result.plan.busy) return result
      await advance()
    }
    throw new Error('Native export did not settle')
  }
  dispose.push(() => fs.rmSync(directory, { recursive: true, force: true }))
  dispose.push(() => runtime.dispose())
  return { directory, contents, owner, frame, event, handles, dialog, shell, prepare, execute,
    options, runtime, call, ready, settled }
}

describe('native export workspace authority and lifetime', () => {
  it.each([
    ['other sender', h => ({ sender: new EventEmitter(), senderFrame: h.frame })],
    ['child frame', h => ({ sender: h.contents, senderFrame: { url: h.frame.url } })],
    ['foreign page', h => { h.frame.url = 'https://example.test/'; return h.event }],
    ['credential URL', h => { h.frame.url = 'http://user:pass@localhost:5000/'; return h.event }],
    ['query URL', h => { h.frame.url = 'http://localhost:5000/?unsafe=1'; return h.event }],
    ['other port', h => { h.frame.url = 'http://localhost:5001/'; return h.event }],
    ['destroyed window', h => { h.owner.isDestroyed = () => true; return h.event }],
    ['destroyed contents', h => { h.contents.isDestroyed = () => true; return h.event }],
  ])('rejects %s before preview reads or native dialogs', async (_label, change) => {
    const h = harness(), event = change(h)
    expect(await h.call('prepare', { requestId: 'one', ids: ['note-1'], format: 'docx' }, event)).toMatchObject({ success: false, code: 'export-owner-changed' })
    expect(h.prepare).not.toHaveBeenCalled(); expect(h.dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(await h.call('dialog:openDirectory', undefined, event)).toBe('')
  })

  it.each([
    { requestId: 'a', ids: [], format: 'docx' },
    { requestId: 'a', ids: Array.from({ length: 101 }, (_, n) => `note-${n}`), format: 'docx' },
    { requestId: 'a', ids: ['a', 'a'], format: 'docx' },
    { requestId: 'a', ids: ['../outside'], format: 'docx' },
    { requestId: 'a', ids: ['a'], format: 'html' },
    { requestId: 'a', ids: ['a'], format: 'docx', targetDir: '/arbitrary' },
    { requestId: '../bad', ids: ['a'], format: 'docx' },
  ])('rejects malformed preview input without reading notes: %j', async payload => {
    const h = harness()
    expect(await h.call('prepare', payload)).toMatchObject({ success: false, code: 'invalid-export-request' })
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('returns only the core public snapshot and cannot run before a native directory choice', async () => {
    const h = harness()
    const result = await h.call('prepare', { requestId: 'preview', ids: ['note-1'], format: 'md' })
    expect(result.plan).toMatchObject({ format: 'markdown', destination: '', phase: 'prepared', busy: false, canStart: false })
    expect(JSON.stringify(result)).not.toContain('private saved source')
    expect(await h.call('start', { planId: result.plan.planId, requestId: 'run' })).toMatchObject({ success: false, code: 'export-directory-required' })
    expect(await h.call('choose-directory', { planId: result.plan.planId, targetDir: '/arbitrary' })).toMatchObject({ success: false, code: 'invalid-export-request' })
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('directory cancellation keeps the prepared plan and its existing authorized choice', async () => {
    const h = harness(), plan = await h.ready()
    h.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const cancelled = await h.call('choose-directory', { planId: plan.planId })
    expect(cancelled).toMatchObject({ success: true, cancelled: true, plan: { phase: 'prepared', state: 'prepared', destination: h.directory, busy: false } })
    expect(h.dialog.showOpenDialog).toHaveBeenCalledWith(h.owner, {
      title: '选择文档导出目录', buttonLabel: '选择此目录', properties: ['openDirectory', 'createDirectory'],
    })
  })

  it('rejects a directory result that arrives after navigation, including a return to the same URL/frame', async () => {
    const held = deferred(), h = harness()
    const prepared = await h.call('prepare', { requestId: 'preview', ids: ['note-1'], format: 'docx' })
    h.dialog.showOpenDialog.mockReturnValueOnce(held.promise)
    const pending = h.call('choose-directory', { planId: prepared.plan.planId })
    h.contents.emit('did-start-navigation', {}, h.frame.url, false, true)
    held.resolve({ canceled: false, filePaths: [h.directory] })
    expect(await pending).toMatchObject({ success: false, code: 'export-owner-changed' })
    expect(await h.call('status', { planId: prepared.plan.planId })).toMatchObject({ success: false })
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('cancels the actual preview read and discards a late successful result', async () => {
    const held = deferred(); let signal
    const h = harness({ prepare: vi.fn(options => { signal = options.signal; return held.promise }) })
    const pending = h.call('prepare', { requestId: 'preview', ids: ['note-1'], format: 'docx' })
    expect(await h.call('cancel', { requestId: 'preview' })).toMatchObject({ success: true, cancelled: true })
    expect(signal.aborted).toBe(true)
    expect(await h.call('prepare', { requestId: 'replacement', ids: ['note-1'], format: 'docx' })).toMatchObject({ success: false, code: 'export-busy' })
    held.resolve(makePlan())
    expect(await pending).toMatchObject({ success: false, code: 'export-cancelled' })
    expect(await h.call('prepare', { requestId: 'preview', ids: ['note-1'], format: 'docx' })).toMatchObject({ success: false, code: 'export-cancelled' })
  })

  it('revokes a prepared plan if cancellation reaches main just before its late reply reaches the UI', async () => {
    const h = harness(), result = await h.call('prepare', { requestId: 'preview', ids: ['note-1'], format: 'docx' })
    expect(await h.call('cancel', { requestId: 'preview' })).toMatchObject({ success: true, cancelled: true })
    expect(await h.call('status', { planId: result.plan.planId })).toMatchObject({ success: false, code: 'export-not-found' })
    expect(await h.call('prepare', { requestId: 'preview', ids: ['note-1'], format: 'docx' })).toMatchObject({ success: false, code: 'export-cancelled' })
  })

  it('checks the absolute deadline even when the timer callback has not run', async () => {
    const held = deferred(); let time = 1000, signal, deadline
    const h = harness({ now: () => time, schedule: vi.fn(() => 7), clearTimer: vi.fn(), prepare: vi.fn(options => {
      signal = options.signal; deadline = options.deadline; return held.promise
    }) })
    const pending = h.call('prepare', { requestId: 'preview', ids: ['note-1'], format: 'docx' })
    expect(deadline).toBe(61000)
    time = 61000; held.resolve(makePlan())
    expect(await pending).toMatchObject({ success: false, code: 'export-timeout' })
    expect(signal.aborted).toBe(true)
  })

  it('returns running immediately, aborts the same native operation, and holds the slot until drain completes', async () => {
    const held = deferred(), entered = deferred(); let options, nativePlan
    const h = harness({ execute: vi.fn((plan, value) => { nativePlan = plan; options = value; entered.resolve(); return held.promise }) })
    const plan = await h.ready(), start = await h.call('start', { planId: plan.planId, requestId: 'run' })
    expect(start.plan).toMatchObject({ phase: 'running', busy: true })
    await entered.promise
    expect(await h.call('cancel', { planId: plan.planId, requestId: 'wrong-run' })).toMatchObject({ success: false, code: 'export-not-found' })
    expect(options.signal.aborted).toBe(false)
    expect(await h.call('release', { planId: plan.planId })).toMatchObject({ success: true, releasePending: true, plan: { busy: true, phase: 'cancelling' } })
    expect(options.signal.aborted).toBe(true)
    expect(await h.call('prepare', { requestId: 'new-preview', ids: ['note-2'], format: 'docx' })).toMatchObject({ success: false, code: 'export-busy' })
    options.onProgress({ ...nativePlan.dto, state: 'completed' })
    expect((await h.call('status', { planId: plan.planId })).plan.phase).toBe('cancelling')
    nativePlan.dto.items[0].status = 'cancelled'; held.resolve(recalculate(nativePlan, 'cancelled'))
    const stopped = await h.settled(plan.planId)
    expect(stopped.plan).toMatchObject({ phase: 'settled', state: 'cancelled', busy: false, releasePending: true, canStart: true })
    const stable = structuredClone(stopped)
    options.onProgress({ ...nativePlan.dto, state: 'completed' })
    expect(await h.call('status', { planId: plan.planId })).toEqual(stable)
    expect(await h.call('release', { planId: plan.planId })).toMatchObject({ success: true, released: true })
    expect(await h.call('status', { planId: plan.planId })).toMatchObject({ success: false })
  })

  it.each(['navigation', 'render-process-gone', 'destroyed', 'closed'])('revokes the owner on %s and prevents a replacement until old reads settle', async kind => {
    const held = deferred(), entered = deferred(); let options
    const h = harness({ execute: vi.fn((_plan, value) => { options = value; entered.resolve(); return held.promise }) })
    const plan = await h.ready(); await h.call('start', { planId: plan.planId, requestId: 'run' }); await entered.promise
    if (kind === 'navigation') h.contents.emit('did-start-navigation', {}, h.frame.url, false, true)
    else if (kind === 'closed') h.owner.emit(kind)
    else h.contents.emit(kind)
    expect(options.signal.aborted).toBe(true)
    expect(await h.call('status', { planId: plan.planId })).toMatchObject({ success: false })
    expect(await h.call('prepare', { requestId: 'next', ids: ['note-2'], format: 'docx' })).toMatchObject({ success: false, code: 'export-busy' })
    held.resolve(makePlan().dto); await advance()
    const next = await h.call('prepare', { requestId: 'next', ids: ['note-2'], format: 'docx' })
    expect(next.success).toBe(true); expect(next.plan.planId).not.toBe(plan.planId)
  })

  it('ignores a proven child-frame navigation but treats ambiguous navigation as revocation', async () => {
    const h = harness(), plan = await h.ready()
    h.contents.emit('did-start-navigation', { isMainFrame: false }, 'https://example.test/', false, false)
    expect((await h.call('status', { planId: plan.planId })).success).toBe(true)
    h.contents.emit('did-start-navigation', {})
    expect((await h.call('status', { planId: plan.planId })).success).toBe(false)
  })

  it('keeps accepted receipts after cancel and does not let late progress resurrect the run', async () => {
    const held = deferred(), entered = deferred(); let nativePlan, options
    const h = harness({ execute: vi.fn((plan, value) => { nativePlan = plan; options = value; entered.resolve(); return held.promise }) })
    const plan = await h.ready(['a', 'b']); await h.call('start', { planId: plan.planId, requestId: 'run' }); await entered.promise
    nativePlan.dto.items[0].status = 'succeeded'; options.onProgress(recalculate(nativePlan, 'running'))
    await h.call('cancel', { planId: plan.planId })
    nativePlan.dto.items[1].status = 'cancelled'; held.resolve(recalculate(nativePlan, 'cancelled'))
    expect((await h.settled(plan.planId)).plan).toMatchObject({ state: 'cancelled', counts: { succeeded: 1, cancelled: 1 } })
    const final = await h.call('status', { planId: plan.planId })
    options.onProgress(recalculate(makePlan(['replacement']), 'completed'))
    expect(await h.call('status', { planId: plan.planId })).toEqual(final)
  })

  it('duplicate start replies are idempotent, retries are explicit and successful items are preserved', async () => {
    let attempt = 0
    const execute = vi.fn(async (plan, options) => {
      attempt++
      if (attempt === 1) { plan.dto.items[0].status = 'succeeded'; plan.dto.items[1].status = 'failed' }
      else { expect(options.retryFailed).toBe(true); expect(plan.dto.items[0].status).toBe('succeeded'); plan.dto.items[1].status = 'succeeded' }
      return recalculate(plan, attempt === 1 ? 'partial' : 'completed')
    })
    const h = harness({ execute }), plan = await h.ready(['a', 'b'])
    await h.call('start', { planId: plan.planId, requestId: 'run' }); await h.settled(plan.planId)
    await h.call('start', { planId: plan.planId, requestId: 'run' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(await h.call('retry', { planId: plan.planId, requestId: 'run' })).toMatchObject({ success: false, code: 'export-request-conflict' })
    await h.call('retry', { planId: plan.planId, requestId: 'retry' })
    expect((await h.settled(plan.planId)).plan).toMatchObject({ state: 'completed', counts: { succeeded: 2, failed: 0 } })
    expect(await h.call('choose-directory', { planId: plan.planId })).toMatchObject({ success: false, code: 'export-directory-locked' })
  })

  it('a replaced directory is rejected before execution and an escaping reveal path never reaches the shell', async () => {
    const h = harness(), plan = await h.ready(), original = `${h.directory}-original`
    fs.renameSync(h.directory, original); fs.mkdirSync(h.directory)
    dispose.push(() => fs.rmSync(original, { recursive: true, force: true }))
    await h.call('start', { planId: plan.planId, requestId: 'run' })
    expect((await h.settled(plan.planId)).plan).toMatchObject({ phase: 'settled', code: 'export-failed' })
    expect(h.execute).not.toHaveBeenCalled()
    expect(await h.call('reveal', { planId: plan.planId })).toMatchObject({ success: false, code: 'export-directory-unavailable' })
    expect(h.shell.openPath).not.toHaveBeenCalled()
  })

  it('reveals only the authorized parent or a real core-created descendant directory', async () => {
    const h = harness(), plan = await h.ready()
    expect((await h.call('reveal', { planId: plan.planId })).success).toBe(true)
    expect(h.shell.openPath).toHaveBeenLastCalledWith(h.directory)
    h.execute.mockImplementationOnce(async nativePlan => {
      nativePlan.dto.exportDirectory = path.dirname(h.directory)
      nativePlan.dto.items[0].status = 'succeeded'; return recalculate(nativePlan, 'completed')
    })
    await h.call('start', { planId: plan.planId, requestId: 'run' }); await h.settled(plan.planId)
    expect(await h.call('reveal', { planId: plan.planId })).toMatchObject({ success: false, code: 'export-directory-unavailable' })
    expect(h.shell.openPath).toHaveBeenCalledTimes(1)
  })

  it('normalizes a temporary-root directory alias for native reveal and save receipts', async () => {
    const owner = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-export-alias-owner-')))
    dispose.push(() => fs.rmSync(owner, { recursive: true, force: true }))
    const physical = path.join(owner, 'physical-temporary-root'), alias = path.join(owner, 'temporary-root-alias')
    fs.mkdirSync(physical)
    fs.symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir')
    vi.spyOn(os, 'tmpdir').mockReturnValue(alias)
    const h = harness(), plan = await h.ready()
    expect((await h.call('reveal', { planId: plan.planId })).success).toBe(true)
    expect(h.shell.openPath).toHaveBeenLastCalledWith(h.directory)
    const selected = path.join(h.directory, 'chosen.md')
    expect(await h.call('file:saveContentAs', { content: 'same directory through its canonical name' }))
      .toEqual({ success: true, path: selected })
    expect(fs.readFileSync(selected, 'utf8')).toBe('same directory through its canonical name')
  })

  it('holds one set of document listeners across replacements and releases every listener at close', async () => {
    const h = harness()
    let plan
    for (let n = 0; n < 12; n++) plan = (await h.call('prepare', { requestId: `preview-${n}`, ids: ['note-1'], format: 'docx' })).plan
    expect(h.contents.listenerCount('did-start-navigation')).toBe(1)
    expect(h.contents.listenerCount('destroyed')).toBe(1)
    expect(h.owner.listenerCount('close')).toBe(1)
    await h.call('release', { planId: plan.planId })
    expect(h.contents.eventNames()).toEqual([]); expect(h.owner.eventNames()).toEqual([])
  })

  it('does not replay a successful but replaced preview as a live plan', async () => {
    const h = harness()
    await h.call('prepare', { requestId: 'old', ids: ['note-1'], format: 'docx' })
    await h.call('prepare', { requestId: 'new', ids: ['note-2'], format: 'docx' })
    expect(await h.call('prepare', { requestId: 'old', ids: ['note-1'], format: 'docx' })).toMatchObject({ success: false, code: 'export-not-found' })
  })

  it('native errors are redacted and a real close only cancels export, without preventing the close', async () => {
    const h = harness({ prepare: vi.fn(async () => { throw new Error('Authorization: Bearer secret path C:\\private') }) })
    const result = await h.call('prepare', { requestId: 'preview', ids: ['note-1'], format: 'docx' })
    expect(result).toMatchObject({ success: false, code: 'export-failed' })
    expect(JSON.stringify(result)).not.toMatch(/secret|private|Bearer/)
    const close = { preventDefault: vi.fn() }; h.owner.emit('close', close)
    expect(close.preventDefault).not.toHaveBeenCalled()
  })
})

describe('legacy exports cannot bypass native destination consent', () => {
  it('legacy Word/Markdown requires a fresh directory grant and then reuses the workspace operation', async () => {
    const h = harness()
    expect(await h.call('export:docx', { ids: ['note-1'], targetDir: h.directory, format: 'markdown' })).toMatchObject({ success: false, code: 'export-directory-required' })
    expect(await h.call('dialog:openDirectory')).toBe(h.directory)
    expect(await h.call('export:docx', { ids: ['note-1'], targetDir: `${h.directory}-other`, format: 'markdown' })).toMatchObject({ success: false, code: 'export-directory-required' })
    const result = await h.call('export:docx', { ids: ['note-1'], targetDir: h.directory, format: 'markdown' })
    expect(result).toMatchObject({ success: true, errors: [] })
    expect(h.options.execute).toHaveBeenCalledTimes(1)
    expect(await h.call('export:docx', { ids: ['note-1'], targetDir: h.directory, format: 'markdown' })).toMatchObject({ success: false, code: 'export-directory-required' })
  })

  it('combined manuscripts publish in a new exclusive directory and preserve existing names', async () => {
    const observedErrors = vi.fn(() => false)
    const converter = vi.fn(async (_ids, dir) => {
      fs.mkdirSync(path.join(dir, 'assets', 'nested'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'assets', 'nested', 'attachment.bin'), Buffer.from([0, 23, 128, 255]))
      const filename = path.join(dir, '合并稿.md'); fs.writeFileSync(filename, 'new manuscript'); return filename
    })
    const h = harness({ combinedExport: converter, isExportError: observedErrors })
    const old = path.join(h.directory, '合并稿.md'); fs.writeFileSync(old, 'keep existing')
    fs.mkdirSync(path.join(h.directory, 'assets', 'nested'), { recursive: true })
    const oldAsset = path.join(h.directory, 'assets', 'nested', 'attachment.bin')
    fs.writeFileSync(oldAsset, Buffer.from([42, 99]))
    expect(await h.call('dialog:openDirectory')).toBe(h.directory)
    const result = await h.call('export:combined-manuscript', { ids: ['a'], targetDir: h.directory, format: 'markdown', title: '合并稿' })
    const nativeErrors = observedErrors.mock.calls.map(([error]) => ({ name: error.name, message: error.message,
      code: error.code, syscall: error.syscall, stack: error.stack }))
    expect(result.success, JSON.stringify({ result, nativeErrors })).toBe(true); expect(path.dirname(result.path)).not.toBe(h.directory)
    expect(converter).toHaveBeenCalledTimes(1); expect(converter.mock.calls[0][4].signal).toBeInstanceOf(AbortSignal)
    expect(nativeErrors).toEqual([])
    expect(fs.readFileSync(result.path, 'utf8')).toBe('new manuscript'); expect(fs.readFileSync(old, 'utf8')).toBe('keep existing')
    expect(fs.readFileSync(path.join(result.directory, 'assets', 'nested', 'attachment.bin'))).toEqual(Buffer.from([0, 23, 128, 255]))
    expect(fs.readFileSync(oldAsset)).toEqual(Buffer.from([42, 99]))
    expect(await h.call('export:combined-manuscript', { ids: ['a'], targetDir: h.directory })).toMatchObject({ success: false })
  })

  it('a combined publication failure removes only its own partially copied directory', async () => {
    let staging, publicationBeforeFailure, copied = 0
    const observedErrors = vi.fn(() => false)
    const converter = vi.fn(async (_ids, dir) => {
      staging = dir
      fs.writeFileSync(path.join(dir, 'first.md'), 'first manuscript')
      fs.writeFileSync(path.join(dir, 'second.md'), 'second manuscript')
      return path.join(dir, 'first.md')
    })
    const h = harness({ combinedExport: converter, isExportError: observedErrors }), old = path.join(h.directory, 'keep.md')
    fs.writeFileSync(old, 'existing bytes')
    const copy = fs.cpSync.bind(fs)
    vi.spyOn(fs, 'cpSync').mockImplementation((source, destination, options) => {
      if (copied === 1) {
        publicationBeforeFailure = fs.readdirSync(path.dirname(destination))
        throw Object.assign(new Error('Synthetic second-entry write failure'), { code: 'EIO' })
      }
      copy(source, destination, options); copied++
    })
    expect(await h.call('dialog:openDirectory')).toBe(h.directory)
    expect(await h.call('export:combined-manuscript', { ids: ['a'], targetDir: h.directory, format: 'markdown' }))
      .toMatchObject({ success: false, code: 'export-failed' })
    expect(copied).toBe(1); expect(fs.cpSync).toHaveBeenCalledTimes(2)
    expect(publicationBeforeFailure).toHaveLength(1)
    expect(observedErrors).toHaveBeenCalledTimes(1); expect(observedErrors.mock.calls[0][0].code).toBe('EIO')
    expect(fs.readFileSync(old, 'utf8')).toBe('existing bytes')
    expect(fs.readdirSync(h.directory)).toEqual(['keep.md'])
    expect(fs.existsSync(staging)).toBe(false)
  })

  it('a combined manuscript cancelled during conversion never publishes late temporary output', async () => {
    const entered = deferred(), held = deferred(); let options
    const h = harness({ combinedExport: vi.fn(async (_ids, dir, _format, _title, value) => {
      options = value; entered.resolve(); await held.promise
      const filename = path.join(dir, 'late.md'); fs.writeFileSync(filename, 'late'); return filename
    }) })
    await h.call('dialog:openDirectory')
    const pending = h.call('export:combined-manuscript', { ids: ['a'], targetDir: h.directory, format: 'markdown' })
    await entered.promise; h.contents.emit('did-start-navigation', {}, h.frame.url, false, true)
    expect(options.signal.aborted).toBe(true); held.resolve()
    expect(await pending).toMatchObject({ success: false, code: 'export-owner-changed' })
    expect(fs.readdirSync(h.directory)).toEqual([])
  })

  it.each(['pdf', 'html'])('%s ignores renderer paths and publishes only to the native save choice', async format => {
    const converter = vi.fn(async (_file, output) => { fs.writeFileSync(output, `actual-${format}`); return output })
    const h = harness({ [`${format}Export`]: converter })
    const selected = path.join(h.directory, `chosen.${format}`), malicious = path.join(h.directory, `arbitrary.${format}`)
    h.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: selected })
    const result = await h.call(`export:${format}`, { file: { title: '文档', content: 'saved' }, outputPath: `C:\\private\\arbitrary.${format}` })
    expect(result).toEqual({ success: true, path: selected })
    expect(fs.existsSync(malicious)).toBe(false); expect(fs.readFileSync(selected, 'utf8')).toBe(`actual-${format}`)
    expect(h.dialog.showSaveDialog.mock.calls[0][1].defaultPath).toBe(`arbitrary.${format}`)
  })

  it.each(['pdf', 'html'])('%s cancellation performs no conversion or write', async format => {
    const converter = vi.fn(), h = harness({ [`${format}Export`]: converter })
    h.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await h.call(`export:${format}`, { file: { title: '文档', content: 'saved' }, outputPath: '/arbitrary' })).toMatchObject({ success: false, cancelled: true })
    expect(converter).not.toHaveBeenCalled(); expect(fs.readdirSync(h.directory)).toEqual([])
  })

  it.each(['pdf', 'html'])('%s rejects a native save reply after document navigation', async format => {
    const held = deferred(), converter = vi.fn(), h = harness({ [`${format}Export`]: converter })
    h.dialog.showSaveDialog.mockReturnValueOnce(held.promise)
    const pending = h.call(`export:${format}`, { file: { title: '文档', content: 'saved' }, outputPath: '/arbitrary' })
    h.contents.emit('did-start-navigation', {}, h.frame.url, false, true)
    held.resolve({ canceled: false, filePath: path.join(h.directory, 'late') })
    expect(await pending).toMatchObject({ success: false, code: 'export-owner-changed' })
    expect(converter).not.toHaveBeenCalled(); expect(fs.readdirSync(h.directory)).toEqual([])
  })

  it('saveContentAs preserves content and native overwrite consent, with a basename-only suggestion', async () => {
    const h = harness(), selected = path.join(h.directory, 'chosen.md')
    fs.writeFileSync(selected, 'old bytes')
    const result = await h.call('file:saveContentAs', { suggestedName: '../../private/note.md', content: '中文\r\nexact\n' })
    expect(result).toEqual({ success: true, path: selected })
    expect(fs.readFileSync(selected, 'utf8')).toBe('中文\r\nexact\n')
    expect(h.dialog.showSaveDialog.mock.calls[0][1].defaultPath).toBe('note.md')
  })

  it('saveContentAs rejects a child frame and a late native dialog response without writing', async () => {
    const h = harness(), held = deferred()
    expect(await h.call('file:saveContentAs', { content: 'bad' }, { sender: h.contents, senderFrame: { url: h.frame.url } })).toMatchObject({ success: false })
    expect(h.dialog.showSaveDialog).not.toHaveBeenCalled()
    h.dialog.showSaveDialog.mockReturnValueOnce(held.promise)
    const pending = h.call('file:saveContentAs', { content: 'late' })
    h.owner.emit('closed'); held.resolve({ canceled: false, filePath: path.join(h.directory, 'late.md') })
    expect(await pending).toMatchObject({ success: false, code: 'export-owner-changed' })
    expect(fs.readdirSync(h.directory)).toEqual([])
  })

  it('single-file publication refuses a destination replaced while conversion is pending', async () => {
    const entered = deferred(), held = deferred()
    const h = harness({ htmlExport: vi.fn(async (_file, output) => {
      entered.resolve(); await held.promise; fs.writeFileSync(output, 'new'); return output
    }) })
    const selected = path.join(h.directory, 'chosen.html')
    h.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: selected })
    const pending = h.call('export:html', { file: { title: '文档', content: 'source' } })
    await entered.promise; fs.writeFileSync(selected, 'another owner'); held.resolve()
    expect(await pending).toMatchObject({ success: false, code: 'export-failed' })
    expect(fs.readFileSync(selected, 'utf8')).toBe('another owner')
  })

  it('works on native destinations without hard-link support while retaining exclusive creation', async () => {
    const h = harness(), selected = path.join(h.directory, 'chosen.md')
    vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => { const error = new Error('Unsupported'); error.code = 'ENOTSUP'; throw error })
    expect(await h.call('file:saveContentAs', { content: 'removable media' })).toEqual({ success: true, path: selected })
    expect(fs.readFileSync(selected, 'utf8')).toBe('removable media')
    expect(fs.readdirSync(h.directory)).toEqual(['chosen.md'])
  })

  it('a workspace cancellation cannot stop a different legacy operation in the same document', async () => {
    const entered = deferred(), held = deferred(); let legacyOptions
    const h = harness({ htmlExport: vi.fn(async (_file, output, options) => {
      legacyOptions = options; entered.resolve(); await held.promise; fs.writeFileSync(output, 'html'); return output
    }) })
    const plan = await h.ready()
    const pending = h.call('export:html', { file: { title: '文档', content: 'source' } })
    await entered.promise
    expect(await h.call('cancel', { planId: plan.planId })).toMatchObject({ success: false, code: 'export-not-found' })
    expect(legacyOptions.signal.aborted).toBe(false)
    expect(await h.call('release', { planId: plan.planId })).toMatchObject({ success: true, released: true })
    expect(legacyOptions.signal.aborted).toBe(false)
    held.resolve(); expect((await pending).success).toBe(true)
  })
})

describe('bridge connected to the actual local export core', () => {
  const body = JSON.stringify({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: '冻结正文 中文', format: 0 }] }] } })
  const file = { id: 'note-1', title: '预览.md', content: body, parent_id: '', is_folder: false, is_deleted: false }
  const response = data => new Response(JSON.stringify({ code: 0, data }), { headers: { 'content-type': 'application/json' } })

  it('writes the frozen saved preview, returns verified receipts and reveals its actual exclusive directory', async () => {
    const fetchImpl = vi.fn(async raw => new URL(raw).pathname === '/api/files'
      ? response([{ ...file, content: undefined }]) : response(file))
    const h = harness({ prepare: options => prepareExportPlan({ ...options, fetchImpl }),
      describe: describeExportPlan, execute: executeExportPlan, isExportError: error => error instanceof LocalExportError })
    const plan = await h.ready()
    expect(exportResult({ success: true, plan }, { format: 'markdown' })).toBe(plan)
    expect(plan.items[0].preview).toContain('冻结正文')
    const started = await h.call('start', { planId: plan.planId, requestId: 'actual-run' })
    expect(exportResult(started, { planId: plan.planId, previous: plan })).toBe(started.plan)
    expect(started.plan.busy).toBe(true)
    const result = await h.settled(plan.planId)
    expect(exportResult(result, { planId: plan.planId, previous: started.plan })).toBe(result.plan)
    expect(result.plan).toMatchObject({ state: 'completed', phase: 'settled', busy: false, counts: { succeeded: 1 } })
    const item = result.plan.items[0]
    expect(item.status).toBe('succeeded'); expect(item.sha256).toMatch(/^[a-f0-9]{64}$/)
    const bytes = fs.readFileSync(item.outputPath)
    expect(bytes.length).toBe(item.bytes); expect(bytes.toString('utf8')).toContain('冻结正文 中文')
    expect(path.dirname(result.plan.exportDirectory)).toBe(h.directory)
    const revealed = await h.call('reveal', { planId: plan.planId })
    expect(exportResult(revealed, { planId: plan.planId, previous: result.plan })).toEqual(result.plan)
    expect(h.shell.openPath).toHaveBeenCalledWith(result.plan.exportDirectory)
    expect(fetchImpl.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })

  it('cancellation propagates through the actual core into an in-flight response body read', async () => {
    const entered = deferred(); let actualSignal, readAborted = false
    const fetchImpl = vi.fn(async (raw, init) => {
      if (new URL(raw).pathname === '/api/files') return response([{ ...file, content: undefined }])
      actualSignal = init.signal
      return new Response(new ReadableStream({ start(controller) {
        init.signal.addEventListener('abort', () => {
          readAborted = true; controller.error(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
        entered.resolve()
      } }))
    })
    const h = harness({ prepare: options => prepareExportPlan({ ...options, fetchImpl }),
      describe: describeExportPlan, execute: executeExportPlan, isExportError: error => error instanceof LocalExportError })
    const pending = h.call('prepare', { requestId: 'actual-preview', ids: ['note-1'], format: 'markdown' })
    await entered.promise
    expect(await h.call('cancel', { requestId: 'actual-preview' })).toMatchObject({ success: true, cancelled: true })
    expect(await pending).toMatchObject({ success: false, code: 'export-cancelled' })
    expect(actualSignal.aborted).toBe(true); expect(readAborted).toBe(true)
    expect(fs.readdirSync(h.directory)).toEqual([])
  })
})
