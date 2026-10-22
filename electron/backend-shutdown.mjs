export const BACKEND_SHUTDOWN_COMMAND = 'LOCAL_NOTEPAD_SHUTDOWN_V1\n'
export const BACKEND_GRACE_MS = 10_000

// A private inherited stdin pipe, not a localhost shutdown API. Only child
// objects spawned by this control instance are eligible for the pipe protocol.
export function createBackendProcessControl({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  const managed = new WeakSet()
  const pending = new WeakMap()
  const exited = child => Number.isInteger(child?.exitCode) || Boolean(child?.signalCode)

  function spawnManagedBackend(spawn, binary, options = {}) {
    const child = spawn(binary, {
      ...options,
      env: { ...(options.env || process.env), NOTEPAD_PARENT_STDIN: '1' },
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    managed.add(child)
    // EPIPE can arrive after the process exits or while shutdown is in flight.
    child.stdin?.on?.('error', () => {})
    return child
  }

  function stopChildProcess(child, timeoutMs = 2500) {
    if (!child || exited(child)) return Promise.resolve({ exited: true, forced: false })
    if (pending.has(child)) return pending.get(child)
    const usesPipe = managed.has(child)
    let forced = false
    let forceTimer = null
    let finalTimer = null
    let settled = false
    const task = new Promise((resolve, reject) => {
      const cleanup = () => {
        if (forceTimer !== null) cancel(forceTimer)
        if (finalTimer !== null) cancel(finalTimer)
        child.removeListener?.('exit', onExit)
        child.removeListener?.('error', onError)
      }
      const onExit = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ exited: true, forced, clean: usesPipe && !forced && child.exitCode === 0 })
      }
      // A kill/spawn error is NOT evidence of process termination.
      const onError = () => { if (exited(child)) onExit() }
      child.once?.('exit', onExit)
      child.on?.('error', onError)
      forceTimer = schedule(() => {
        if (settled) return
        if (exited(child)) { onExit(); return }
        forced = true
        // child.killed only means a signal was sent; it must not suppress this.
        try { child.kill('SIGKILL') } catch { /* final check remains authoritative */ }
        if (settled) return
        finalTimer = schedule(() => {
          if (settled) return
          if (exited(child)) { onExit(); return }
          settled = true
          cleanup()
          reject(new Error('无法确认旧后端已退出；已阻止重启或替换工作区数据'))
        }, 1000)
      }, usesPipe ? Math.max(BACKEND_GRACE_MS, timeoutMs) : Math.max(0, timeoutMs))
      if (usesPipe) {
        try {
          // Do not treat a successful write callback as an exit acknowledgement.
          child.stdin.write(BACKEND_SHUTDOWN_COMMAND, () => {})
        } catch { /* no immediate Windows SIGTERM: retain the bounded grace */ }
      } else {
        try { child.kill('SIGTERM') } catch { /* fallback checks real exit */ }
      }
      if (exited(child)) onExit()
    })
    pending.set(child, task)
    // Both success and failure paths release the de-duplication slot.
    task.then(() => pending.delete(child), () => pending.delete(child))
    return task
  }
  return { spawnManagedBackend, stopChildProcess }
}

const defaultControl = createBackendProcessControl({
  schedule: (fn, ms) => setTimeout(fn, ms), cancel: id => clearTimeout(id),
})
export const spawnManagedBackend = defaultControl.spawnManagedBackend
export const stopChildProcess = defaultControl.stopChildProcess
