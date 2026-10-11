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
export function runNative(command, args, { cwd, timeout = 900000, signal, logFile, quiet = false } = {}) {
  signal?.throwIfAborted()
  const spec = commandSpec(command, args)
  return new Promise((resolve, reject) => {
    let stdout = '', error = null, stopping = false, stopReason = null, killer = null
    const child = spawn(spec.command, spec.args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    const output = (data, stream) => {
      try { if (logFile) appendFileSync(logFile, data); if (!quiet) stream.write(data) }
      catch (failure) { error = failure; stop('output-error') }
    }
    const stop = reason => {
      if (stopping || child.exitCode !== null || child.signalCode !== null) return
      stopping = true; stopReason = reason
      if (process.platform === 'win32' && child.pid) {
        killer = new Promise(done => {
          const processTree = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
          processTree.once('error', failure => { error = failure; child.kill(); done() })
          processTree.once('close', code => { if (code !== 0 && child.exitCode === null) { error = new Error('Could not terminate packaging process tree'); child.kill() }; done() })
        })
      } else child.kill('SIGTERM')
    }
    const abort = () => stop('cancelled'), timer = setTimeout(() => stop('timeout'), timeout)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout.on('data', data => { if (stdout.length < 65536) stdout += data.toString('utf8'); output(data, process.stdout) })
    child.stderr.on('data', data => output(data, process.stderr))
    child.stdout.on('error', failure => { error = failure; stop('stdout-error') })
    child.stderr.on('error', failure => { error = failure; stop('stderr-error') })
    child.on('error', failure => { error = failure })
    child.once('close', async (code, childSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (killer) await killer
      if (stopReason) reject(new Error(`Command ${stopReason}; packaging did not complete`))
      else resolve({ code, signal: childSignal, error, stdout })
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
