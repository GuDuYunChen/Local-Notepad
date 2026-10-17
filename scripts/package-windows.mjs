import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageWindows } from './windows-package-core.mjs'

// Only these constant npm arguments enter cmd.exe, not repository paths or user
// input. cwd handles spaces/non-ASCII paths; npm.cmd avoids PowerShell policies.
export function commandSpec(command, args, platform = process.platform) {
  if (command !== 'npm' || platform !== 'win32') return { command, args }
  const allowed = ['--version', 'ci --no-audit --no-fund', 'run build']
  if (!allowed.includes(args.join(' '))) throw new Error('Unsupported npm command')
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd ' + args.join(' ')] }
}
export function runNative(command, args, { cwd, timeout = 900000, cleanupTimeout = 5000, signal, logFile, quiet = false } = {}) {
  signal?.throwIfAborted()
  for (const value of [timeout, cleanupTimeout]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error('Invalid command time budget')
  }
  const spec = commandSpec(command, args), deadline = performance.now() + timeout
  return new Promise((resolve, reject) => {
    let stdout = '', error = null, reason = null, settled = false, closed = false
    let cleanupUnconfirmed = false, helper = null, helperPending = false, cleanupTimer = null, escalation = null
    let exitCode = null, exitSignal = null
    const windows = process.platform === 'win32'
    // A POSIX process group remains addressable when the immediate child exits.
    // Windows uses only this live child's tree, never a reused/exited parent PID.
    const child = spawn(spec.command, spec.args, { cwd, windowsHide: true, detached: !windows,
      stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    const finish = () => {
      if (settled || !closed || helperPending) return
      settled = true; clearTimeout(timer); clearTimeout(cleanupTimer); clearTimeout(escalation)
      signal?.removeEventListener('abort', abort)
      if (reason) {
        const failure = new Error(`Command ${reason}; packaging did not complete${cleanupUnconfirmed ? '; process cleanup unconfirmed' : ''}`)
        Object.assign(failure, { reason, cleanupUnconfirmed, childPid: child.pid ?? null })
        reject(failure)
      } else resolve({ code: exitCode, signal: exitSignal, error, stdout })
    }
    const signalGroup = kind => {
      if (!child.pid) return
      try { process.kill(-child.pid, kind) }
      catch (failure) { if (failure.code !== 'ESRCH') { cleanupUnconfirmed = true; error = failure } }
    }
    const detach = () => {
      // Destroy only our pipe endpoints. This is NOT proof that descendants died.
      child.stdout.destroy(); child.stderr.destroy(); child.unref()
    }
    const stop = why => {
      if (settled || reason) return
      reason = why
      cleanupTimer = setTimeout(() => {
        if (settled) return
        cleanupUnconfirmed = true
        if (helper) { helper.kill(); helper.unref() }
        if (windows) { if (child.exitCode === null && child.signalCode === null) child.kill() }
        else signalGroup('SIGKILL')
        detach(); closed = true; helperPending = false; finish()
      }, cleanupTimeout)
      if (!windows) {
        signalGroup('SIGTERM')
        escalation = setTimeout(() => signalGroup('SIGKILL'), Math.min(500, Math.max(1, Math.floor(cleanupTimeout / 2))))
      } else if (child.pid && child.exitCode === null && child.signalCode === null) {
        helperPending = true
        const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
        try {
          helper = spawn(taskkill, ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
          const helperDone = failed => {
            if (settled || !helperPending) return
            helperPending = false
            if (failed) { cleanupUnconfirmed = true; if (child.exitCode === null) child.kill() }
            finish()
          }
          helper.on('error', () => helperDone(true))
          helper.once('close', code => helperDone(code !== 0))
        } catch (failure) { error = failure; cleanupUnconfirmed = true; helperPending = false; child.kill() }
      } else if (!closed) {
        // exit != close: inherited pipes may outlive their parent. taskkill of
        // an exited PID is unsafe and cannot establish descendant ownership.
        cleanupUnconfirmed = true; detach()
      }
      finish()
    }
    const output = (data, stream) => {
      if (settled || reason) return
      try { if (logFile) appendFileSync(logFile, data); if (!quiet) stream.write(data) }
      catch (failure) { error = failure; stop('output-error') }
    }
    const abort = () => stop('cancelled'), timer = setTimeout(() => stop('timeout'), timeout)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout.on('data', data => {
      if (settled || reason) return
      stdout += data.toString('utf8').slice(0, Math.max(0, 65536 - stdout.length))
      output(data, process.stdout)
    })
    child.stderr.on('data', data => output(data, process.stderr))
    child.stdout.on('error', failure => { error = failure; stop('stdout-error') })
    child.stderr.on('error', failure => { error = failure; stop('stderr-error') })
    child.on('error', failure => { error = failure })
    child.once('close', (code, childSignal) => {
      closed = true; exitCode = code; exitSignal = childSignal
      // A delayed timer must not turn an over-budget completion into success.
      if (!reason && signal?.aborted) reason = 'cancelled'
      if (!reason && performance.now() >= deadline) reason = 'timeout'
      finish()
    })
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const aborter = new AbortController()
  const cancel = () => aborter.abort(new Error('Packaging cancelled'))
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
  try {
    if (process.argv.length !== 2) throw new Error('This entry accepts no flags; use pack-win.ps1 -NoOpen to suppress Explorer')
    const result = await packageWindows({ root: fileURLToPath(new URL('../', import.meta.url)), run: runNative,
      signal: aborter.signal, log: text => process.stdout.write(text) })
    console.log(`[package] SUCCESS: ${result.target}\n[package] SHA256: ${result.installer.sha256}\n[package] Version checked; this command did not install or run the application.`)
  } catch (error) { console.error(`[package] FAILED: ${error.message}`); process.exitCode = aborter.signal.aborted ? 130 : 1 }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel) }
}
