// Test-only fixed-port fixture. Keep one listener for the HTTP case group;
// never repeatedly relinquish/reacquire its port between sibling assertions.
import http from 'node:http'
import { createS3ProbeService } from '../electron/s3-probe-bridge.js'
import { trackProbeFixture } from './s3-probe-fixture-close.mjs'

export function createProbeLoopbackFixture() {
  let server, started, stop, active = null, closed = false, completion, fatal
  const allClients = new Set(), owners = new WeakMap()
  function start() {
    if (started) return started // An initial bind failure is never retried.
    server = http.createServer((request, response) => {
      const owner = owners.get(request.socket)
      // A late keep-alive/queued socket cannot acquire another case's handler.
      // Only a client created by this case may send synthetic fixture traffic.
      const ownedClient = owner && [...owner.clients.keys()].some(client =>
        client.socket?.localPort === request.socket.remotePort &&
        client.socket?.localAddress === request.socket.remoteAddress)
      if (!ownedClient || owner !== active || !owner.accepting) { request.socket.destroy(); return }
      try { owner.handler(request, response, owner.timers) }
      catch (error) { owner.reject(error); response.destroy() }
    })
    stop = trackProbeFixture(server, allClients)
    server.on('connection', socket => {
      const owner = active
      if (!owner?.accepting) { socket.destroy(); return }
      owners.set(socket, owner)
      owner.sockets.set(socket, new Promise(resolve => socket.once('close', () => {
        owner.sockets.delete(socket); resolve()
      })))
    })
    started = new Promise((resolve, reject) => {
      server.on('error', error => { fatal = error; reject(error); active?.reject(error) })
      server.listen({ host: '127.0.0.1', port: 27121, exclusive: true }, resolve)
    })
    return started
  }
  async function drain(owner) {
    owner.accepting = false
    for (const timer of owner.timers) { clearTimeout(timer); clearInterval(timer) }
    owner.timers.clear()
    const pending = [...owner.clients.values(), ...owner.sockets.values()]
    for (const client of owner.clients.keys()) client.destroy()
    for (const socket of owner.sockets.keys()) socket.destroy()
    let timer
    try {
      await Promise.race([Promise.all(pending), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('probe case close did not drain')), 2000)
      })])
    } finally { clearTimeout(timer) }
  }
  async function run(handler, action, serviceFactory = createS3ProbeService) {
    if (closed) throw new Error('probe fixture is closed')
    if (fatal) throw fatal
    if (active) throw new Error('probe fixture case is still active')
    const owner = { handler, accepting: true, timers: new Set(), sockets: new Map(), clients: new Map() }
    const failed = new Promise((_, reject) => { owner.reject = reject })
    // A listen error can occur before the action race is installed.
    failed.catch(() => {})
    active = owner
    let result, failure
    try {
      await start()
      if (closed || fatal || !server.listening) throw fatal || new Error('probe fixture is closed')
      const makeService = (options = {}) => serviceFactory({ ...options, requestImpl: (...args) => {
        if (closed || fatal || active !== owner || !owner.accepting || !server.listening) throw new Error('probe fixture case is closed')
        const request = http.request(...args)
        allClients.add(request)
        owner.clients.set(request, new Promise(resolve => request.once('close', () => {
          owner.clients.delete(request); allClients.delete(request); resolve()
        })))
        return request
      } })
      result = await Promise.race([Promise.resolve().then(() => action(makeService)), failed])
    } catch (error) { failure = error }
    finally {
      try { await drain(owner) }
      catch (error) {
        fatal = error
        failure = failure ? new AggregateError([failure, error], 'probe case and cleanup failed') : error
      }
      if (active === owner) active = null
    }
    if (failure) throw failure
    return result
  }
  function close() {
    if (completion) return completion
    closed = true
    if (active) { active.accepting = false; active.reject(new Error('probe fixture is closed')) }
    completion = (async () => {
      if (!started) return
      try { await started } catch { /* Failed to bind: no requests and no external owner management. */ }
      if (server.listening) await stop()
    })()
    return completion
  }
  return Object.freeze({ run, close })
}
