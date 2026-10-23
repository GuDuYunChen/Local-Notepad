import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ID = /^[A-Za-z0-9_-]{1,64}$/
const DEADLINE_MS = 60_000
const CHANNEL = 'export:workspace:'
const copy = value => structuredClone(value)
const refused = (code, message) => ({ success: false, code, message })
const changed = () => refused('export-owner-changed', '导出窗口已变化，请重新打开导出工作台')
const busy = () => refused('export-busy', '当前导出操作尚未结束，请先停止并等待结果确认')

function documentURL(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) return null
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.search) return null
    if (url.protocol === 'file:') { if (url.host) return null }
    else if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5000') return null
    url.hash = ''
    return url.href
  } catch { return null }
}

function fields(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key))
}

function directoryInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function suggestedFilename(raw, fallback, extension) {
  let name = path.win32.basename(path.posix.basename(typeof raw === 'string' ? raw : fallback))
    .replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '').trim()
  if (!name || /^\.+$/.test(name)) name = fallback
  if (/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`
  if (extension) name = `${path.parse(name).name || '文档'}.${extension}`
  return [...name].slice(0, 160).join('')
}

// Owns the single native export slot, its directory authority and its exact
// renderer document. The core owns immutable source snapshots and file receipts.
// No save, note mutation, quit decision or renderer event stream is introduced.
export function registerLocalExportHandlers({ ipcMain, dialog, shell, getWindow, getExpectedURL,
  isClosing = () => false, prepare, describe, execute, isExportError = () => false,
  combinedExport, pdfExport, htmlExport,
  fsImpl = fs, now = Date.now, schedule = setTimeout, clearTimer = clearTimeout,
  timeoutMs = DEADLINE_MS, createId = randomUUID } = {}) {
  if (![getWindow, getExpectedURL, isClosing, prepare, describe, execute, isExportError, now,
    schedule, clearTimer, createId].every(fn => typeof fn === 'function') ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEADLINE_MS) {
    throw new TypeError('Invalid local export bridge configuration')
  }
  let session = null, active = null, disposed = false

  function trusted(event, ownerSession) {
    try {
      const win = getWindow(), contents = win?.webContents, expected = documentURL(getExpectedURL())
      return !disposed && isClosing() === false && expected && win && !win.isDestroyed() &&
        contents && !contents.isDestroyed() && event?.sender === contents &&
        event.senderFrame === contents.mainFrame && documentURL(event.senderFrame?.url) === expected &&
        documentURL(contents.getURL()) === expected && (!ownerSession ||
          (ownerSession.valid && ownerSession === session && ownerSession.owner === win &&
            ownerSession.sender === event.sender && ownerSession.frame === event.senderFrame))
    } catch { return false }
  }

  function safeError(error) {
    if (isExportError(error) && typeof error.code === 'string' && /^[a-z0-9-]{1,64}$/.test(error.code) &&
        typeof error.message === 'string' && error.message.length <= 500) return refused(error.code, error.message)
    return refused('export-failed', '导出未完成，请检查所选目录和本地数据服务后重试')
  }

  function removeListeners(ownerSession) {
    for (const [target, name, handler] of ownerSession.listeners.splice(0)) {
      try { target.removeListener(name, handler) } catch {}
    }
  }

  function stop(operation, reason = 'cancelled') {
    if (!operation || operation.finished || operation.controller.signal.aborted) return
    operation.reason = reason
    if (operation.record) operation.record.phase = 'cancelling'
    operation.controller.abort()
  }

  function invalidate(ownerSession) {
    if (!ownerSession.valid) return
    ownerSession.valid = false
    if (active?.session === ownerSession) stop(active, 'owner-changed')
    ownerSession.legacyDirectory = null
    ownerSession.record = null
    ownerSession.requests.clear()
    removeListeners(ownerSession)
    if (session === ownerSession) session = null
    // The native slot remains occupied until the underlying operation settles.
  }

  function currentSession(event) {
    if (!trusted(event)) return null
    if (session && trusted(event, session)) return session
    if (session) invalidate(session)
    if (active) return null
    const value = { owner: getWindow(), sender: event.sender, frame: event.senderFrame,
      valid: true, listeners: [], requests: new Map(), record: null, legacyDirectory: null }
    session = value
    const listen = (target, name, handler) => {
      value.listeners.push([target, name, handler]); target.on(name, handler)
    }
    try {
      listen(value.sender, 'did-start-navigation', (details, _url, _inPlace, main) => {
        if (details?.isMainFrame === true || main === true || (details?.isMainFrame !== false && main !== false)) invalidate(value)
      })
      for (const name of ['render-process-gone', 'destroyed']) listen(value.sender, name, () => invalidate(value))
      listen(value.owner, 'close', () => { if (active?.session === value) stop(active) })
      listen(value.owner, 'closed', () => invalidate(value))
      if (!trusted(event, value)) { invalidate(value); return null }
      return value
    } catch { invalidate(value); return null }
  }

  function begin(ownerSession, event, kind, requestId, record = null, timed = true) {
    const operation = { session: ownerSession, event, kind, requestId, record,
      controller: new AbortController(), deadline: timed ? now() + timeoutMs : null,
      finished: false, reason: null, promise: null, timer: undefined }
    active = operation
    if (timed) {
      operation.timer = schedule(() => stop(operation, 'timeout'), timeoutMs)
      operation.timer?.unref?.()
    }
    return operation
  }

  function check(operation) {
    if (operation.deadline !== null && now() >= operation.deadline) stop(operation, 'timeout')
    if (!trusted(operation.event, operation.session)) stop(operation, 'owner-changed')
    return !operation.controller.signal.aborted && !operation.finished && active === operation
  }

  function finish(operation) {
    operation.finished = true
    if (operation.timer !== undefined) clearTimer(operation.timer)
    if (active === operation) active = null
    // Release may arrive while a native read, write or directory dialog is
    // still pending. Keep its slot until drain, then revoke only that plan.
    const ownerSession = operation.session, record = operation.record
    if (record?.releaseRequested && ownerSession.valid && ownerSession.record === record) {
      ownerSession.record = null
      if (!ownerSession.legacyDirectory && active?.session !== ownerSession && session === ownerSession) invalidate(ownerSession)
    }
  }

  function arm(operation) {
    if (operation.deadline !== null) return
    operation.deadline = now() + timeoutMs
    operation.timer = schedule(() => stop(operation, 'timeout'), timeoutMs)
    operation.timer?.unref?.()
  }

  function cancellation(operation) {
    if (operation.reason === 'owner-changed') return changed()
    if (operation.reason === 'timeout') return refused('export-timeout', '本次导出操作超过 60 秒，已停止；请减少所选内容后重试')
    return { ...refused('export-cancelled', '已停止导出操作'), cancelled: true }
  }

  function remember(ownerSession, requestId, entry) {
    ownerSession.requests.set(requestId, entry)
    while (ownerSession.requests.size > 32) ownerSession.requests.delete(ownerSession.requests.keys().next().value)
  }

  function snapshot(record) {
    const working = active?.record === record && !active.finished
    const stopping = working && active.controller.signal.aborted
    const dto = copy(record.dto)
    return { ...dto, planId: record.planId, requestId: record.requestId,
      destination: record.directory?.selected || '', phase: record.phase, busy: Boolean(working),
      canChooseDirectory: !working && !record.directoryLocked,
      canStart: !working && Boolean(record.directory) && (dto.counts.ready > 0 || dto.counts.cancelled > 0),
      canRetry: !working && Boolean(record.directory) && dto.counts.failed > 0 &&
        !dto.items.some(item => item.status === 'failed' && (item.partialPath || item.partialPaths?.length)),
      canReveal: !working && Boolean(record.directory), releasePending: record.releaseRequested,
      ...(record.problem || {}),
      ...(stopping ? { code: 'export-cancelling', message: '正在停止并确认已开始的文件操作，请等待结果' } : {}) }
  }

  function findRecord(event, payload) {
    if (!trusted(event, session)) return { error: changed() }
    if (!fields(payload, ['planId']) || !ID.test(payload.planId || '')) {
      return { error: refused('invalid-export-request', '导出任务标识无效') }
    }
    const record = session?.record
    if (!record || record.planId !== payload.planId) return { error: refused('export-not-found', '该导出任务已释放，请重新预览') }
    if (active?.record === record) check(active)
    return { record, ownerSession: session }
  }

  async function directoryAuthority(selected) {
    if (typeof selected !== 'string' || selected.length > 32768 || selected.includes('\0') || !path.isAbsolute(selected)) {
      throw new Error('Invalid native directory')
    }
    const canonical = await fsImpl.realpath(selected), stat = await fsImpl.stat(canonical)
    if (!path.isAbsolute(canonical) || !stat.isDirectory()) throw new Error('Not a directory')
    return { selected, canonical, device: stat.dev, inode: stat.ino }
  }

  async function checkDirectory(authority) {
    const canonical = await fsImpl.realpath(authority.canonical), stat = await fsImpl.stat(canonical)
    if (canonical !== authority.canonical || !stat.isDirectory() || stat.dev !== authority.device || stat.ino !== authority.inode) {
      throw new Error('Directory identity changed')
    }
    return canonical
  }

  function prepareRequest(payload) {
    if (!fields(payload, ['requestId', 'ids', 'format']) || !ID.test(payload.requestId || '') ||
        !Array.isArray(payload.ids) || payload.ids.length < 1 || payload.ids.length > 100 ||
        payload.ids.some(id => typeof id !== 'string' || id.length < 1 || id.length > 200 || /[\x00-\x1f\x7f/\\?#]/.test(id)) ||
        new Set(payload.ids).size !== payload.ids.length || !['docx', 'markdown', 'md'].includes(payload.format)) return null
    return { requestId: payload.requestId, ids: [...payload.ids], format: payload.format === 'md' ? 'markdown' : payload.format }
  }

  async function prepareHandler(event, payload) {
    if (!trusted(event)) return changed()
    const input = prepareRequest(payload)
    if (!input) return refused('invalid-export-request', '请选择 1 至 100 项有效内容，并选择 Word 或 Markdown 格式')
    const ownerSession = currentSession(event)
    if (!ownerSession) return active ? busy() : changed()
    const fingerprint = JSON.stringify([input.ids, input.format])
    const old = ownerSession.requests.get(input.requestId)
    if (old) {
      if (old.kind !== 'prepare' || old.fingerprint !== fingerprint) return refused('export-request-conflict', '请求标识已用于其他操作，请重新预览')
      if (old.promise) return old.promise
      if (old.result?.success) return ownerSession.record?.planId === old.planId
        ? { success: true, plan: snapshot(ownerSession.record) }
        : refused('export-not-found', '该导出预览已释放，请重新预览')
      return copy(old.result || refused('export-not-found', '该导出预览已释放，请重新预览'))
    }
    if (active) return busy()
    ownerSession.record = null
    ownerSession.legacyDirectory = null
    const operation = begin(ownerSession, event, 'prepare', input.requestId)
    const entry = { kind: 'prepare', fingerprint }
    remember(ownerSession, input.requestId, entry)
    operation.promise = (async () => {
      let result
      try {
        const plan = await prepare({ ids: input.ids, format: input.format,
          signal: operation.controller.signal, deadline: operation.deadline })
        if (!check(operation)) result = cancellation(operation)
        else {
          const record = { planId: createId(), requestId: input.requestId, plan, dto: copy(describe(plan)),
            directory: null, directoryLocked: false, phase: 'prepared', problem: null, releaseRequested: false }
          ownerSession.record = record
          entry.planId = record.planId
          result = { success: true, plan: snapshot(record) }
        }
      } catch (error) { result = check(operation) ? safeError(error) : cancellation(operation) }
      finally { finish(operation) }
      entry.promise = null
      entry.result = copy(result)
      return result
    })()
    entry.promise = operation.promise
    return operation.promise
  }

  async function chooseHandler(event, payload) {
    const found = findRecord(event, payload)
    if (found.error) return found.error
    const { record, ownerSession } = found
    if (active) return busy()
    if (record.directoryLocked) return refused('export-directory-locked', '该批次已创建导出结果；如需更换目录，请重新预览')
    const operation = begin(ownerSession, event, 'choose', record.requestId, record, false)
    record.phase = 'choosing'
    try {
      const selected = await dialog.showOpenDialog(ownerSession.owner, {
        title: '选择文档导出目录', buttonLabel: '选择此目录', properties: ['openDirectory', 'createDirectory'],
      })
      if (!check(operation)) return cancellation(operation)
      if (selected?.canceled) return { success: true, cancelled: true, plan: null }
      if (!Array.isArray(selected?.filePaths) || selected.filePaths.length !== 1) throw new Error('Invalid native selection')
      const authority = await directoryAuthority(selected.filePaths[0])
      if (!check(operation)) return cancellation(operation)
      record.directory = authority
      record.problem = null
      return { success: true, plan: null }
    } catch (error) {
      return check(operation) ? refused('export-directory-unavailable', '所选目录不可用，请重新选择可写的本机目录') : cancellation(operation)
    } finally {
      finish(operation)
      record.phase = record.dto.state === 'prepared' ? 'prepared' : 'settled'
    }
  }

  async function chooseWithSnapshot(event, payload) {
    const result = await chooseHandler(event, payload)
    if (result.success && trusted(event, session) && session?.record?.planId === payload?.planId) {
      return { ...result, plan: snapshot(session.record) }
    }
    return result.success ? changed() : result
  }

  function startHandler(event, payload, retryFailed = false) {
    if (!fields(payload, ['planId', 'requestId']) || !ID.test(payload.requestId || '')) return refused('invalid-export-request', '导出请求标识无效')
    const found = findRecord(event, { planId: payload.planId })
    if (found.error) return found.error
    const { record, ownerSession } = found
    const kind = retryFailed ? 'retry' : 'start', old = ownerSession.requests.get(payload.requestId)
    if (old) {
      if (old.kind !== kind || old.planId !== record.planId) return refused('export-request-conflict', '请求标识已用于其他操作')
      return { success: true, plan: snapshot(record) }
    }
    if (active) return busy()
    if (!record.directory) return refused('export-directory-required', '请先通过系统对话框选择导出目录')
    if (retryFailed && record.dto.items.some(item => item.status === 'failed' && (item.partialPath || item.partialPaths?.length))) {
      return refused('cleanup-incomplete', '部分导出文件仍未确认清理。请先检查残留路径，再重新预览；系统不会覆盖这些文件。')
    }
    if (retryFailed ? record.dto.counts.failed < 1 : record.dto.counts.ready + record.dto.counts.cancelled < 1) {
      return refused('export-nothing-to-run', retryFailed ? '没有需要重试的失败项' : '没有尚未导出的项目')
    }
    record.requestId = payload.requestId
    record.phase = 'running'; record.problem = null; record.releaseRequested = false
    const operation = begin(ownerSession, event, kind, payload.requestId, record)
    remember(ownerSession, payload.requestId, { kind, planId: record.planId })
    // Start returns immediately. A lost renderer reply never restarts the work;
    // status reads the same main-owned plan and a repeated request is idempotent.
    operation.promise = Promise.resolve().then(async () => {
      try {
        const targetDir = await checkDirectory(record.directory)
        if (!check(operation)) return
        const result = await execute(record.plan, { targetDir, signal: operation.controller.signal,
          deadline: operation.deadline, retryFailed,
          onProgress: dto => {
            if (check(operation)) {
              record.dto = copy(dto)
              if (dto.exportDirectory || dto.counts?.succeeded > 0) record.directoryLocked = true
            }
          } })
        // After abort, the core first drains the active write and cleanup. Its
        // final receipts may include an already completed file; do not erase it.
        if (ownerSession.valid && session === ownerSession) record.dto = copy(result || describe(record.plan))
      } catch (error) {
        if (ownerSession.valid && session === ownerSession) {
          record.dto = copy(describe(record.plan))
          const failure = check(operation) ? safeError(error) : cancellation(operation)
          record.problem = { code: failure.code, message: failure.message }
        }
      } finally {
        check(operation)
        if (ownerSession.valid && session === ownerSession) {
          if (operation.controller.signal.aborted) {
            const failure = cancellation(operation)
            record.problem = { code: failure.code, message: failure.message }
            record.dto.state = 'cancelled'
          }
          if (record.dto.exportDirectory || record.dto.counts?.succeeded > 0) record.directoryLocked = true
          record.phase = 'settled'
        }
        finish(operation)
      }
    }).catch(() => {
      // A malformed internal report must not escape as an unhandled rejection.
      if (ownerSession.valid && session === ownerSession) {
        record.phase = 'settled'
        record.problem = { code: 'export-failed', message: '导出结果无法确认，请重新预览后重试' }
      }
      finish(operation)
    })
    return { success: true, plan: snapshot(record) }
  }

  function statusHandler(event, payload) {
    const found = findRecord(event, payload)
    return found.error || { success: true, plan: snapshot(found.record) }
  }

  function cancelHandler(event, payload) {
    if (!trusted(event, session)) return changed()
    if (!fields(payload, ['planId', 'requestId']) || (!payload.planId && !payload.requestId) ||
        (payload.planId && !ID.test(payload.planId)) || (payload.requestId && !ID.test(payload.requestId))) {
      return refused('invalid-export-request', '导出任务标识无效')
    }
    const record = session?.record
    if ((payload.planId && record?.planId !== payload.planId) ||
        (payload.requestId && (active?.session === session ? active.requestId : record?.requestId) !== payload.requestId)) {
      return refused('export-not-found', '该导出操作已经结束或已被替换')
    }
    if (payload.planId && active?.session === session && active.record !== record) {
      return refused('export-not-found', '当前运行的操作不属于此导出任务')
    }
    if (!active && payload.requestId && !payload.planId && record?.phase === 'prepared' &&
        session.requests.get(payload.requestId)?.kind === 'prepare') {
      // A renderer may time out just after preparation settled but before its
      // reply arrived. Revoking that request also revokes the late plan ID.
      const entry = session.requests.get(payload.requestId)
      entry.result = { ...refused('export-cancelled', '已停止导出预览'), cancelled: true }
      session.record = null
      return { success: true, cancelled: true }
    }
    if (active?.session === session) stop(active)
    return { success: true, ...(record ? { plan: snapshot(record) } : { cancelled: true }) }
  }

  async function revealHandler(event, payload) {
    const found = findRecord(event, payload)
    if (found.error) return found.error
    const { record, ownerSession } = found
    if (active) return busy()
    if (!record.directory) return refused('export-directory-required', '请先选择导出目录')
    try {
      const parent = await checkDirectory(record.directory)
      const output = record.dto.exportDirectory
      let directory = parent
      if (output) {
        if (typeof output !== 'string' || !path.isAbsolute(output) || !directoryInside(parent, output)) throw new Error('Invalid output directory')
        directory = await fsImpl.realpath(output)
        if (!directoryInside(parent, directory) || !(await fsImpl.stat(directory)).isDirectory()) throw new Error('Invalid output directory')
      }
      if (!trusted(event, ownerSession) || ownerSession.record !== record) return changed()
      const error = await shell.openPath(directory)
      if (!trusted(event, ownerSession) || ownerSession.record !== record) return changed()
      return error ? refused('export-reveal-failed', '无法打开导出目录，请通过系统文件管理器查看') : { success: true, plan: snapshot(record) }
    } catch { return refused('export-directory-unavailable', '导出目录已移动或不可用，请在系统文件管理器中检查') }
  }

  function releaseHandler(event, payload) {
    const found = findRecord(event, payload)
    if (found.error) return found.error
    const { record, ownerSession } = found
    if (active?.record === record) {
      record.releaseRequested = true; stop(active)
      return { success: true, releasePending: true, plan: snapshot(record) }
    }
    const plan = snapshot(record)
    ownerSession.record = null
    if (!ownerSession.legacyDirectory && active?.session !== ownerSession) invalidate(ownerSession)
    return { success: true, released: true, plan }
  }

  // The old UI chose a directory first and passed its string back. Keep that
  // call shape, but only a fresh native choice in this exact document grants it.
  async function chooseLegacyDirectory(event) {
    if (!trusted(event)) return ''
    const ownerSession = currentSession(event)
    if (!ownerSession || active) return ''
    const operation = begin(ownerSession, event, 'legacy-choose', createId(), null, false)
    ownerSession.legacyDirectory = null
    try {
      const selected = await dialog.showOpenDialog(ownerSession.owner, { properties: ['openDirectory'] })
      if (!check(operation) || selected?.canceled || selected?.filePaths?.length !== 1) return ''
      const authority = await directoryAuthority(selected.filePaths[0])
      if (!check(operation)) return ''
      ownerSession.legacyDirectory = authority
      return authority.selected
    } catch { return '' }
    finally { finish(operation) }
  }

  async function legacyExport(event, payload) {
    if (!trusted(event, session)) return changed()
    if (!fields(payload, ['ids', 'targetDir', 'format']) || !session?.legacyDirectory ||
        payload.targetDir !== session.legacyDirectory.selected) return refused('export-directory-required', '请先通过系统对话框重新选择导出目录')
    if (active) return busy()
    const authority = session.legacyDirectory
    const result = await prepareHandler(event, { requestId: createId(), ids: payload.ids, format: payload.format || 'docx' })
    if (!result.success) return result
    const record = session?.record
    if (!trusted(event, session) || !record || record.planId !== result.plan.planId) return changed()
    record.directory = authority
    const started = startHandler(event, { planId: record.planId, requestId: createId() })
    if (!started.success) return started
    const operation = active
    await operation.promise
    if (!trusted(event, session) || session.record !== record) return changed()
    const plan = snapshot(record)
    return { success: !record.problem && plan.counts.failed === 0 && plan.counts.cancelled === 0,
      errors: plan.items.filter(item => item.status !== 'succeeded').map(item => item.id),
      ...(record.problem || (plan.counts.failed ? { message: '部分文档导出失败，请在导出工作台查看结果' } : {})), plan }
  }

  function compatibilityOperation(event, kind) {
    if (!trusted(event)) return { error: changed() }
    const ownerSession = currentSession(event)
    if (!ownerSession) return { error: active ? busy() : changed() }
    if (active) return { error: busy() }
    return { operation: begin(ownerSession, event, kind, createId(), null, false) }
  }

  function finishCompatibility(operation) {
    finish(operation)
    if (operation.session.valid && !operation.session.record && !operation.session.legacyDirectory) invalidate(operation.session)
  }

  async function inspectStaging(directory) {
    let count = 0, bytes = 0
    async function walk(current, depth = 0) {
      if (depth > 64) throw new Error('Export nesting limit')
      const entries = await fsImpl.readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        if (++count > 1000) throw new Error('Export entry limit')
        const target = path.join(current, entry.name)
        if (entry.isSymbolicLink()) throw new Error('Unexpected export link')
        if (entry.isDirectory()) await walk(target, depth + 1)
        else if (entry.isFile()) {
          bytes += (await fsImpl.stat(target)).size
          if (bytes > 64 * 1024 * 1024) throw new Error('Export size limit')
        } else throw new Error('Unexpected export entry')
      }
    }
    await walk(directory)
  }

  function sameFile(expected, actual) {
    return expected?.isFile() && actual?.isFile() && expected.dev === actual.dev && expected.ino === actual.ino &&
      expected.size === actual.size && expected.mtimeMs === actual.mtimeMs
  }

  // Last guard and atomic publication are synchronous: a renderer navigation
  // cannot enter between the final document check and the filesystem commit.
  // Existing files are replaced only after native overwrite consent and only
  // while their identity still matches the file observed after that dialog.
  function publishFile(operation, authority, filename, expected, contents) {
    if (!check(operation)) throw new Error('Cancelled export')
    const parent = fsSync.realpathSync(authority.canonical), parentStat = fsSync.statSync(parent)
    if (parent !== authority.canonical || !parentStat.isDirectory() || parentStat.dev !== authority.device || parentStat.ino !== authority.inode) throw new Error('Directory changed')
    const destination = path.join(parent, filename)
    let current = null
    try { current = fsSync.lstatSync(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (expected ? !sameFile(expected, current) : current !== null) throw new Error('Destination changed')
    const temporary = path.join(parent, `.notepad-export-${createId()}.tmp`)
    try {
      fsSync.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 })
      if (!check(operation)) throw new Error('Cancelled export')
      // A new destination uses an exclusive hard link, so a concurrent creator
      // never gets overwritten. Native-confirmed replacements use atomic rename.
      if (expected) fsSync.renameSync(temporary, destination)
      else {
        try { fsSync.linkSync(temporary, destination) }
        catch (error) {
          if (!['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(error.code)) throw error
          // FAT/exFAT removable media may not support hard links. Exclusive
          // copying retains the no-overwrite rule on those native destinations.
          fsSync.copyFileSync(temporary, destination, fsSync.constants.COPYFILE_EXCL)
        }
        fsSync.unlinkSync(temporary)
      }
      return destination
    } finally {
      try { fsSync.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }

  async function saveAuthority(selected) {
    if (typeof selected !== 'string' || selected.length > 32768 || selected.includes('\0') || !path.isAbsolute(selected)) throw new Error('Invalid native target')
    const authority = await directoryAuthority(path.dirname(selected)), filename = path.basename(selected)
    let existing = null
    try { existing = await fsImpl.lstat(path.join(authority.canonical, filename)) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (existing && !existing.isFile()) throw new Error('Not a regular destination')
    return { authority, filename, existing }
  }

  async function combinedHandler(event, payload = {}) {
    if (!trusted(event, session)) return changed()
    const format = payload.format || 'docx'
    const input = prepareRequest({ requestId: 'legacy-combined', ids: payload.ids, format })
    if (!fields(payload, ['ids', 'targetDir', 'format', 'title']) || !input ||
        (payload.title !== undefined && (typeof payload.title !== 'string' || payload.title.length > 2000))) {
      return refused('invalid-export-request', '请选择有效的合并稿章节和导出格式')
    }
    if (!session?.legacyDirectory || payload.targetDir !== session.legacyDirectory.selected) return refused('export-directory-required', '请先通过系统对话框重新选择导出目录')
    if (typeof combinedExport !== 'function') return refused('export-unavailable', '合并稿导出服务尚未准备好')
    const acquired = compatibilityOperation(event, 'combined')
    if (acquired.error) return acquired.error
    const { operation } = acquired, authority = operation.session.legacyDirectory
    operation.session.legacyDirectory = null
    let staging, published
    try {
      arm(operation)
      const parent = await checkDirectory(authority)
      if (!check(operation)) return cancellation(operation)
      staging = await fsImpl.mkdtemp(path.join(os.tmpdir(), 'notepad-combined-export-'))
      if (!check(operation)) return cancellation(operation)
      const output = await combinedExport(input.ids, staging, input.format, payload.title || '合并稿',
        { signal: operation.controller.signal, deadline: operation.deadline })
      if (!check(operation)) return cancellation(operation)
      if (typeof output !== 'string' || !directoryInside(staging, output) || !(await fsImpl.lstat(output)).isFile()) throw new Error('Invalid converter output')
      await inspectStaging(staging)
      await checkDirectory(authority)
      if (!check(operation)) return cancellation(operation)
      published = path.join(parent, `Local-Notepad-合并稿-${createId()}`)
      fsSync.mkdirSync(published)
      try {
        // Keep the exclusive root claim. errorOnExist also rejects an existing
        // directory, so copy each child to its own absent destination instead.
        for (const name of fsSync.readdirSync(staging)) {
          fsSync.cpSync(path.join(staging, name), path.join(published, name),
            { recursive: true, force: false, errorOnExist: true })
        }
      }
      catch (error) { fsSync.rmSync(published, { recursive: true, force: true }); published = null; throw error }
      return { success: true, path: path.join(published, path.relative(staging, output)), directory: published }
    } catch (error) { return check(operation) ? safeError(error) : cancellation(operation) }
    finally {
      if (staging) { try { await fsImpl.rm(staging, { recursive: true, force: true }) } catch {} }
      finishCompatibility(operation)
    }
  }

  async function singleFileHandler(event, payload, format) {
    if (!fields(payload, ['file', 'outputPath']) || !fields(payload.file, Object.keys(payload.file || {})) ||
        typeof payload.file.content !== 'string' || Buffer.byteLength(payload.file.content, 'utf8') > 2 * 1024 * 1024 ||
        typeof payload.file.title !== 'string' || payload.file.title.length > 2000) return refused('invalid-export-request', '请选择有效的文档内容')
    const acquired = compatibilityOperation(event, format)
    if (acquired.error) return acquired.error
    const { operation } = acquired, converter = format === 'pdf' ? pdfExport : htmlExport
    let staging
    try {
      if (typeof converter !== 'function') return refused('export-unavailable', '此格式的导出服务尚未准备好')
      const selected = await dialog.showSaveDialog(operation.session.owner, {
        title: format === 'pdf' ? '导出 PDF 文档' : '导出 HTML 文档',
        defaultPath: suggestedFilename(payload.outputPath || payload.file.title, `文档.${format}`, format),
        filters: [{ name: format === 'pdf' ? 'PDF 文档' : 'HTML 文档', extensions: [format] }],
      })
      if (!check(operation)) return cancellation(operation)
      if (selected?.canceled || !selected?.filePath) return { success: false, cancelled: true, canceled: true, code: 'export-cancelled', message: '已取消选择导出文件' }
      arm(operation)
      const authority = await saveAuthority(selected.filePath)
      if (!check(operation)) return cancellation(operation)
      staging = await fsImpl.mkdtemp(path.join(os.tmpdir(), 'notepad-file-export-'))
      if (!check(operation)) return cancellation(operation)
      const stagedFile = path.join(staging, `document.${format}`)
      const result = await converter({ title: payload.file.title, content: payload.file.content }, stagedFile,
        { signal: operation.controller.signal, deadline: operation.deadline })
      if (!check(operation)) return cancellation(operation)
      const stat = await fsImpl.lstat(stagedFile)
      if (result !== stagedFile || !stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('Invalid converter output')
      const contents = await fsImpl.readFile(stagedFile, { signal: operation.controller.signal })
      if (!check(operation)) return cancellation(operation)
      return { success: true, path: publishFile(operation, authority.authority, authority.filename, authority.existing, contents) }
    } catch (error) { return check(operation) ? safeError(error) : cancellation(operation) }
    finally {
      if (staging) { try { await fsImpl.rm(staging, { recursive: true, force: true }) } catch {} }
      finishCompatibility(operation)
    }
  }

  async function saveContentHandler(event, payload = {}) {
    if (!fields(payload, ['suggestedName', 'content'])) return refused('invalid-export-request', '另存为请求无效')
    const acquired = compatibilityOperation(event, 'save-content')
    if (acquired.error) return acquired.error
    const { operation } = acquired
    try {
      const selected = await dialog.showSaveDialog(operation.session.owner, {
        defaultPath: suggestedFilename(payload.suggestedName, 'note.md'),
        filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }],
      })
      if (!check(operation)) return cancellation(operation)
      if (selected?.canceled || !selected?.filePath) return { success: false, canceled: true }
      arm(operation)
      const authority = await saveAuthority(selected.filePath)
      if (!check(operation)) return cancellation(operation)
      const output = publishFile(operation, authority.authority, authority.filename, authority.existing, String(payload.content ?? ''))
      return { success: true, path: output }
    } catch (error) { return check(operation) ? safeError(error) : cancellation(operation) }
    finally { finishCompatibility(operation) }
  }

  const handlers = { prepare: prepareHandler, 'choose-directory': chooseWithSnapshot,
    start: (event, payload) => startHandler(event, payload), status: statusHandler, cancel: cancelHandler,
    retry: (event, payload) => startHandler(event, payload, true), reveal: revealHandler, release: releaseHandler }
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`${CHANNEL}${name}`, handler)
  ipcMain.handle('dialog:openDirectory', chooseLegacyDirectory)
  ipcMain.handle('export:docx', legacyExport)
  ipcMain.handle('export:combined-manuscript', combinedHandler)
  ipcMain.handle('export:pdf', (event, payload) => singleFileHandler(event, payload, 'pdf'))
  ipcMain.handle('export:html', (event, payload) => singleFileHandler(event, payload, 'html'))
  ipcMain.handle('file:saveContentAs', saveContentHandler)
  return Object.freeze({
    abort: () => stop(active),
    dispose: () => {
      disposed = true
      if (session) invalidate(session)
      if (active) stop(active, 'owner-changed')
      for (const name of Object.keys(handlers)) ipcMain.removeHandler(`${CHANNEL}${name}`)
      ipcMain.removeHandler('dialog:openDirectory'); ipcMain.removeHandler('export:docx')
      for (const name of ['export:combined-manuscript', 'export:pdf', 'export:html', 'file:saveContentAs']) ipcMain.removeHandler(name)
    },
  })
}
