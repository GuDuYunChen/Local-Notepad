// Test-only ownership tracking. Never inspect, connect to or kill an external owner.
export function trackProbeFixture(server) {
  const pending = new Map()
  let closing = false, completion
  server.on('connection', socket => {
    const closed = new Promise(resolve => socket.once('close', () => {
      pending.delete(socket)
      resolve()
    }))
    pending.set(socket, closed)
    if (closing) socket.destroy()
  })
  return () => {
    if (completion) return completion
    completion = (async () => {
      closing = true
      let timer
      const drained = (async () => {
        // Stop accepting before destroying established connections. The server's
        // close callback can precede socket close events, especially on abort.
        const stopped = new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve())
        })
        server.closeAllConnections()
        for (const socket of pending.keys()) socket.destroy()
        await stopped
        await Promise.all([...pending.values()])
      })()
      try {
        await Promise.race([drained, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('probe fixture close did not drain')), 2000)
        })])
      } finally { clearTimeout(timer) }
    })()
    return completion
  }
}
