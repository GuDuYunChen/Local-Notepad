export { spawnManagedBackend, stopChildProcess } from './backend-shutdown.mjs'

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
