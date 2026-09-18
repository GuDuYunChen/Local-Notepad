export function stopChildProcess(child, timeoutMs = 2500) {
  if (!child || child.exitCode !== null || child.signalCode || child.killed) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let settled = false
    let hardTimer = null

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(forceTimer)
      if (hardTimer) clearTimeout(hardTimer)
      child.removeListener?.('exit', finish)
      child.removeListener?.('error', finish)
      resolve()
    }

    child.once?.('exit', finish)
    child.once?.('error', finish)

    const forceTimer = setTimeout(() => {
      if (settled) return
      try {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL')
        }
      } catch {
        // The process may have exited between the state check and kill().
      }

      hardTimer = setTimeout(finish, 500)
    }, timeoutMs)

    try {
      const signalled = child.kill('SIGTERM')
      if (signalled === false && child.exitCode !== null) {
        finish()
      }
    } catch {
      finish()
    }
  })
}
