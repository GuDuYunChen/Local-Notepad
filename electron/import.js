import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { LOCAL_IMPORT_EXTENSIONS, LOCAL_IMPORT_LIMITS as LIMIT, LocalImportError } from './import-policy.js'

const failed = (filePath, code, message) => ({ title: typeof filePath === 'string' ? path.basename(filePath) : '无效文件',
  originalPath: typeof filePath === 'string' ? filePath : '', error: true, code, message })

function parseInWorker(filePath, { workerPath, signal, timeoutMs, WorkerClass = Worker }) {
  return new Promise(resolve => {
    let worker, timer, settled = false
    const deadline = Date.now() + timeoutMs
    const finish = result => {
      if (settled) return
      settled = true
      if (signal?.aborted) result = failed(filePath, 'cancelled', '已停止解析；此文件尚未导入')
      else if (Date.now() >= deadline) result = failed(filePath, 'timeout', '解析超过 15 秒，已停止；请缩小或另存源文件后重试')
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancelled)
      if (worker) {
        // Keep error listeners while termination drains: late worker failures
        // must not become uncaught main-process exceptions.
        worker.unref?.()
        try { Promise.resolve(worker.terminate()).catch(() => {}) } catch {}
      }
      resolve(result)
    }
    const cancelled = () => finish(failed(filePath, 'cancelled', '已停止解析；此文件尚未导入'))
    if (signal?.aborted) { cancelled(); return }
    try {
      worker = new WorkerClass(workerPath, { workerData: { filePath },
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 8 } })
      signal?.addEventListener('abort', cancelled, { once: true })
      worker.on('error', () => finish(failed(filePath, 'invalid-document', '文档解析进程失败，请缩小或另存源文件后重试')))
      worker.on('exit', () => finish(failed(filePath, 'invalid-document', '文档解析进程提前结束，请另存后重试')))
      worker.on('message', message => {
        if (!message?.ok) {
          finish(failed(filePath, typeof message?.code === 'string' ? message.code : 'invalid-document',
            typeof message?.message === 'string' ? message.message : '文档解析失败'))
          return
        }
        const result = message.result
        if (!result || result.originalPath !== filePath || result.success !== true || typeof result.content !== 'string' ||
            !['text', 'markdown'].includes(result.contentType) || Buffer.byteLength(result.content, 'utf8') > LIMIT.contentBytes) {
          finish(failed(filePath, 'invalid-document', '文档转换结果无效，请重新选择文件'))
          return
        }
        finish(result)
      })
      timer = setTimeout(() => finish(failed(filePath, 'timeout', '解析超过 15 秒，已停止；请缩小或另存源文件后重试')), timeoutMs)
      timer.unref?.()
      if (signal?.aborted) cancelled()
    } catch { finish(failed(filePath, 'invalid-document', '文档解析进程无法启动，请重新打开导入工作台')) }
  })
}

export async function parseImportPaths(filePaths, options = {}) {
  if (!Array.isArray(filePaths)) throw new LocalImportError('invalid-request', '请选择有效的本地文件')
  if (filePaths.length > LIMIT.files) throw new LocalImportError('too-many-files', '每批最多选择 20 个文件')
  if (!options.workerPath) throw new LocalImportError('unavailable', '导入解析服务尚未准备好')
  const results = [], started = Date.now()
  let contentBytes = 0
  for (const filePath of filePaths) {
    const remaining = LIMIT.batchTimeoutMs - (Date.now() - started)
    if (options.signal?.aborted) {
      results.push(failed(filePath, 'cancelled', '已停止解析；此文件尚未导入'))
      continue
    }
    if (remaining <= 0) {
      results.push(failed(filePath, 'timeout', '本批解析超过 60 秒，剩余文件请另选一批'))
      continue
    }
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0') || filePath.length > 32768) {
      results.push(failed(filePath, 'invalid-path', '请选择本机上的有效文件路径'))
      continue
    }
    if (!LOCAL_IMPORT_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
      results.push(failed(filePath, 'unsupported', '仅支持 Markdown、TXT、Word 和 Excel 文件'))
      continue
    }
    const result = await parseInWorker(filePath, { ...options, timeoutMs: Math.min(options.timeoutMs || LIMIT.fileTimeoutMs, remaining) })
    if (result.success) {
      const bytes = Buffer.byteLength(result.content, 'utf8')
      if (contentBytes + bytes > LIMIT.batchContentBytes) {
        results.push(failed(filePath, 'too-large', '本批转换正文合计超过 2 MiB，请减少所选文件后重试'))
        continue
      }
      contentBytes += bytes
    }
    results.push(result)
  }
  return results
}

function documentURL(raw) {
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.search) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

// The current main document may read chosen files and cancel its own batch.
// Navigation/destruction aborts the worker; there is no background import queue.
export function registerLocalImportHandlers({ ipcMain, dialog, getWindow, getExpectedURL,
  isClosing = () => false, workerPath, parse = parseImportPaths }) {
  let active = null
  const trusted = (event, owner) => {
    try {
      const win = getWindow(), contents = win?.webContents
      const expected = documentURL(getExpectedURL())
      return !!expected && isClosing() === false && win && (!owner || owner === win) && !win.isDestroyed() &&
        contents && !contents.isDestroyed() && event?.sender === contents && event.senderFrame === contents.mainFrame &&
        documentURL(event.senderFrame?.url) === expected && documentURL(contents.getURL()) === expected
    } catch { return false }
  }
  const run = async (event, payload = {}, choose = false) => {
    if (!trusted(event)) return { success: false, message: '导入窗口已变化，请重新打开导入工作台' }
    const requestId = payload?.requestId ?? randomUUID()
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) return { success: false, message: '导入请求标识无效' }
    if (active) return { success: false, message: '已有文件正在解析，请先停止或等待完成' }
    const owner = getWindow(), controller = new AbortController(), listeners = []
    const operation = { event, requestId, owner, controller }
    active = operation
    const abort = () => controller.abort()
    const listen = (target, name, handler) => { listeners.push([target, name, handler]); target.on(name, handler) }
    let timer
    try {
      listen(event.sender, 'did-start-navigation', (details, _url, _inPlace, main) => {
        if (details?.isMainFrame !== false && main !== false) abort()
      })
      for (const name of ['render-process-gone', 'destroyed']) listen(event.sender, name, abort)
      for (const name of ['close', 'closed']) listen(owner, name, abort)
      let paths = payload?.paths
      if (choose) {
        const result = await dialog.showOpenDialog(owner, { properties: ['openFile', 'multiSelections'],
          filters: [{ name: '所有支持格式', extensions: LOCAL_IMPORT_EXTENSIONS.map(ext => ext.slice(1)) }] })
        paths = result.canceled ? [] : result.filePaths
      }
      if (controller.signal.aborted || !trusted(event, owner)) return { success: false, cancelled: true, message: '已停止解析' }
      timer = setTimeout(abort, LIMIT.batchTimeoutMs + 1000)
      timer.unref?.()
      const results = await parse(paths, { workerPath, signal: controller.signal })
      if (!trusted(event, owner)) return { success: false, cancelled: true, message: '导入窗口已关闭或变化' }
      return { success: true, results, cancelled: controller.signal.aborted }
    } catch (error) {
      return { success: false, message: error instanceof LocalImportError ? error.message : '文件解析失败，请重新选择' }
    } finally {
      clearTimeout(timer)
      for (const [target, name, handler] of listeners) { try { target.removeListener(name, handler) } catch {} }
      if (active === operation) active = null
    }
  }
  ipcMain.handle('import:files', (event, payload) => run(event, payload, true))
  ipcMain.handle('import:paths', (event, payload) => run(event, payload))
  ipcMain.handle('import:cancel', (event, payload) => {
    if (!trusted(event) || !active || active.event.sender !== event.sender || active.event.senderFrame !== event.senderFrame ||
        active.requestId !== payload?.requestId) return { success: false }
    active.controller.abort()
    return { success: true }
  })
  return Object.freeze({ abort: () => active?.controller.abort() })
}
