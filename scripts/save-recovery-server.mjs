// Isolated real Go server, with the same parent-pipe shutdown used by Electron.
import { request } from 'node:http'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export async function createSaveTestServer(binary) {
  if (!binary) throw new Error('NOTEPAD_SAVE_TEST_SERVER must point to the real built Go server')
  const root = mkdtempSync(path.join(tmpdir(), 'notepad-save-recovery-'))
  const data = path.join(root, 'data'); mkdirSync(data)
  let child, endpoint, exit, output = ''
  const calls = []
  function call(route, init = {}) {
    calls.push({ route, method: init.method || 'GET' })
    return new Promise((resolve, reject) => {
      const req = request(endpoint + route, { method: init.method || 'GET', signal: init.signal,
        headers: { Origin: 'null', 'Content-Type': 'application/json' } }, res => {
        let raw = ''; res.setEncoding('utf8'); res.on('data', c => raw += c)
        res.on('error', reject)
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) throw new Error('HTTP ' + res.statusCode)
            const body = JSON.parse(raw)
            if (body.code !== 0) throw new Error(body.detail || body.message || 'API error')
            resolve(body.data)
          } catch (error) { reject(error) }
        })
      })
      req.setTimeout(12000, () => req.destroy(new Error('Real server request timed out')))
      req.on('error', reject)
      req.end(init.body)
    })
  }
  async function start() {
    const listener = createServer()
    await new Promise((yes, no) => { listener.once('error', no); listener.listen(0, '127.0.0.1', yes) })
    const port = listener.address().port
    await new Promise(yes => listener.close(yes))
    endpoint = 'http://127.0.0.1:' + port
    child = spawn(path.resolve(binary), [], { cwd: root, env: { ...process.env, NOTEPAD_DATA: data, PORT: String(port), NOTEPAD_PARENT_STDIN: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    exit = new Promise((yes, no) => { child.once('exit', code => yes(code)); child.once('error', no) })
    // Observe early errors immediately, even while polling startup.
    void exit.catch(() => {})
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { output = (output + b).slice(-32000) })
    for (let i = 0; i < 150; i++) {
      try { await call('/api/health'); return } catch {}
      if (child.exitCode !== null) throw new Error('Server exited: ' + output)
      await sleep(100)
    }
    throw new Error('Server did not become ready: ' + output)
  }
  async function stop() {
    if (!child) return
    if (child.exitCode !== null) { const code = child.exitCode; child = null; if (code !== 0) throw new Error('Abnormal server exit: ' + output); return }
    child.stdin.end()
    const timeout = new AbortController()
    let code
    try { code = await Promise.race([exit, sleep(12000, null, { signal: timeout.signal }).then(() => { throw new Error('Parent-pipe shutdown did not finish: ' + output) })]) }
    finally { timeout.abort() }
    child = null
    if (code !== 0) throw new Error('Shutdown failed: ' + code + '\n' + output)
  }
  async function dispose() {
    try { await stop() } finally {
      if (child && child.exitCode === null) { child.kill(); await Promise.race([exit.catch(() => {}), sleep(2000)]) }
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
  try { await start() } catch (error) { await dispose(); throw error }
  return { call, stop, start, dispose, calls, data }
}
