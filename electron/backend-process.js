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


export async function waitForHttpService(url, {
  timeoutMs = 8000,
  intervalMs = 100,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  const deadline = now() + timeoutMs

  while (now() < deadline) {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        cache: 'no-store',
      })
      if (response?.ok) {
        let body = null
        try {
          body = await response.json()
        } catch {
          // A healthy 2xx endpoint is sufficient even if it has no JSON body.
        }
        if (!body || body.code === 0) return true
      }
    } catch {
      // The backend may still be starting; retry until the deadline.
    }

    const remaining = deadline - now()
    if (remaining <= 0) break
    await sleep(Math.min(intervalMs, remaining))
  }

  return false
}
