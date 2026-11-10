import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDesktopWindowSession } from './desktop-window-session.mjs'

// Reading a note over HTTP and seeing a DevTools target URL do not prove that
// the production renderer, its quit bridge or the actual editor have mounted.
export function upgradedRendererSnapshot(expected) {
  const visible = node => {
    if (!node) return false
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility === 'visible' && Number(style.opacity) > 0
  }
  const root = document.getElementById('root')
  const app = document.querySelector('.app-shell')
  const editor = document.querySelector('.editor-input')
  const text = editor?.innerText || ''
  const pending = [...document.querySelectorAll('.placeholder, .save-state')]
    .filter(visible).map(node => ({ text: node.innerText, className: node.className }))
  const quit = window.__upgradedRendererQuitObservation
  return {
    url: location.href, readyState: document.readyState, timeOrigin: performance.timeOrigin,
    rootMounted: Boolean(root?.childElementCount), rootInert: root?.inert === true,
    appVisible: visible(app), editorVisible: visible(editor), editorText: text,
    retainedMarkerVisible: text.includes(expected.marker),
    retainedNotePresent: [...document.querySelectorAll('[data-file-id]')]
      .some(node => node.getAttribute('data-file-id') === expected.noteId),
    preload: ['onQuitPrepare', 'onQuitRelease', 'reportQuitResult']
      .every(key => typeof window.electronAPI?.[key] === 'function'),
    pending, quitVeil: Boolean(document.querySelector('.editor-quit-veil')),
    quitObservation: quit ? { timeOrigin: quit.timeOrigin, attached: quit.attached, events: [...quit.events] } : null,
    bodyText: (document.body?.innerText || '').slice(0, 6000),
  }
}

export function isUpgradedRendererReady(snapshot, expected) {
  return Boolean(snapshot && snapshot.url === expected.url && snapshot.readyState === 'complete' &&
    Number.isFinite(snapshot.timeOrigin) && snapshot.rootMounted && !snapshot.rootInert &&
    snapshot.appVisible && snapshot.editorVisible && snapshot.retainedMarkerVisible &&
    typeof snapshot.editorText === 'string' && snapshot.editorText.includes(expected.marker) &&
    snapshot.retainedNotePresent && snapshot.preload && Array.isArray(snapshot.pending) &&
    snapshot.pending.length === 0 && !snapshot.quitVeil)
}

export async function waitForUpgradedRenderer({ read, expected, deadline, save = () => {},
  now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  assert.ok(Number.isFinite(deadline), 'Original desktop startup deadline is required')
  assert.ok(expected?.url && expected.noteId && expected.marker, 'Exact retained-note identity is required')
  let first = null, last = null, observations = 0
  while (now() < deadline) {
    try { last = await read(Math.max(1, Math.min(1000, deadline - now()))) }
    catch (error) { last = { readError: error.message } }
    first ||= last; observations += 1
    const result = { first, last, observations, ready: isUpgradedRendererReady(last, expected) }
    save(result)
    if (result.ready && now() < deadline) return result
    const remaining = deadline - now()
    if (remaining > 0) await pause(Math.min(100, remaining))
  }
  throw new Error('Actual upgraded editor did not show the retained note before the original desktop startup deadline')
}

export function observeUpgradedQuit() {
  if (window.__upgradedRendererQuitObservation) throw new Error('Upgrade quit observer was already attached')
  const record = { timeOrigin: performance.timeOrigin, attached: false, events: [] }
  const disposers = [
    window.electronAPI.onQuitPrepare(value => record.events.push({ event: 'prepare', id: value?.id, at: performance.now() })),
    window.electronAPI.onQuitRelease(value => record.events.push({ event: 'release', id: value?.id, at: performance.now() })),
  ]
  record.attached = disposers.every(value => typeof value === 'function')
  window.__upgradedRendererQuitObservation = record
  return { timeOrigin: record.timeOrigin, attached: record.attached }
}

async function connect(url, timeout) {
  const endpoint = new URL(url)
  assert.equal(endpoint.protocol, 'ws:')
  assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname), 'Only the owned loopback DevTools endpoint is allowed')
  const ws = new WebSocket(url), pending = new Map()
  let serial = 0
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('DevTools connection timed out')) }, timeout)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('DevTools connection failed')) }, { once: true })
  })
  ws.addEventListener('message', event => {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    const task = pending.get(message.id)
    if (!task) return
    pending.delete(message.id); clearTimeout(task.timer)
    if (message.error) task.reject(new Error(JSON.stringify(message.error)))
    else task.resolve(message.result)
  })
  ws.addEventListener('close', () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('DevTools connection closed')) }
    pending.clear()
  })
  return {
    send(method, params = {}, budget = 1000) {
      const id = ++serial
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('DevTools command timed out: ' + method)) }, budget)
        pending.set(id, { resolve, reject, timer })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { ws.close() },
  }
}

async function main() {
  assert.equal(process.platform, 'win32', 'This native diagnostic only runs on the original Windows runner')
  const args = Object.fromEntries(process.argv.slice(3).reduce((pairs, value, index, all) => {
    if (index % 2 === 0) pairs.push([value.replace(/^--/, ''), all[index + 1]])
    return pairs
  }, []))
  const mode = process.argv[2]
  assert.ok(['prepare', 'failure'].includes(mode))
  const out = path.resolve(args.out), pid = Number(args.pid)
  assert.ok(Number.isInteger(pid) && pid > 0)
  assert.ok(path.win32.isAbsolute(args.exe))
  const expected = { url: args.url, noteId: args.note, marker: args.marker }
  assert.ok(expected.noteId && expected.marker && new URL(expected.url).protocol === 'file:')
  mkdirSync(out, { recursive: true })
  const report = { schemaVersion: 1, mode, pid, expected, startedAt: new Date().toISOString(), complete: false }
  const reportFile = path.join(out, 'renderer-' + mode + '.json')
  const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  save()
  let cdp, session
  const capture = async (label, budget = 1000) => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' }, budget)
    const bytes = Buffer.from(result.data, 'base64'), filename = label + '.png'
    writeFileSync(path.join(out, filename), bytes)
    report.screenshot = { filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    save()
  }
  try {
    if (mode === 'failure') {
      // Inspect the exact owned process first: a native error box can block CDP.
      session = createDesktopWindowSession({ startupMs: 3000, requestMs: 2000 })
      try { report.windows = await session.inspect(pid, args.exe) }
      catch (error) { report.nativeInspectionError = error.message }
      report.nativeEvents = session.events(); save()
    }
    const deadline = mode === 'prepare' ? Date.parse(args.deadline) : Date.now() + 3000
    assert.ok(Number.isFinite(deadline) && deadline > Date.now(), 'Original desktop startup deadline expired')
    cdp = await connect(args.socket, Math.max(1, Math.min(1000, deadline - Date.now())))
    const read = async budget => {
      const result = await cdp.send('Runtime.evaluate', {
        expression: '(' + upgradedRendererSnapshot.toString() + ')(' + JSON.stringify(expected) + ')', returnByValue: true,
      }, budget)
      assert.equal(result.exceptionDetails, undefined, 'Renderer snapshot evaluation failed')
      return result.result?.value
    }
    if (mode === 'prepare') {
      report.readiness = await waitForUpgradedRenderer({ read, expected, deadline,
        save(value) { report.readiness = value; save() } })
      const observer = await cdp.send('Runtime.evaluate', {
        expression: '(' + observeUpgradedQuit.toString() + ')()', returnByValue: true,
      }, Math.max(1, Math.min(1000, deadline - Date.now())))
      assert.equal(observer.exceptionDetails, undefined)
      assert.equal(observer.result?.value?.attached, true)
      report.observer = observer.result.value
      assert.equal(report.observer.timeOrigin, report.readiness.last.timeOrigin)
      assert.ok(Date.now() < deadline, 'Original desktop startup deadline expired before quit observation attached')
    } else report.snapshot = await read(1000)
    await capture('renderer-' + mode, Math.max(1, Math.min(1000, deadline - Date.now())))
    if (mode === 'prepare') assert.ok(Date.now() < deadline, 'Original desktop startup deadline expired during capture')
    report.complete = true
  } catch (error) { report.error = error.message; throw error }
  finally {
    cdp?.close()
    if (session) { report.nativeWorkerClean = await session.dispose(); report.nativeEvents = session.events() }
    report.finishedAt = new Date().toISOString(); save()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
