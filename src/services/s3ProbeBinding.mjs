import { createS3ReadProbeSession } from './s3ReadProbe.mjs'

// Observable, credential-free bridge between a React lifetime and one session.
// Construction/subscription/connection never starts a native request. A lease
// belongs to one committed mount, so an old cleanup cannot close a newer mount.
export function createS3ProbeBinding(options) {
  let current = null
  let snapshot = createS3ReadProbeSession(options).snapshot()
  const listeners = new Set()
  function publish(next) {
    if (snapshot === next) return
    snapshot = next
    // Notifications carry no payload. Consumers always read the latest snapshot
    // (including when another listener invalidates or disconnects reentrantly).
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue
      try { listener() } catch { /* An observer cannot turn a native result into an unhandled rejection. */ }
    }
  }
  function connect() {
    if (current) throw new TypeError('S3 probe binding is already connected')
    const owner = { session: createS3ReadProbeSession(options), epoch: { invalidated: null }, closed: null }
    current = owner
    publish(owner.session.snapshot())
    return () => {
      if (current !== owner) return
      current = null
      owner.closed = owner.session.dispose()
      if (!current) publish(owner.closed)
    }
  }
  function read(input) {
    const owner = current
    if (!owner) {
      // Use the original session's fixed public result. Never inspect input or
      // discover a bridge after a component has disconnected.
      const closed = createS3ReadProbeSession(options)
      closed.dispose()
      return closed.read(null)
    }
    const epoch = owner.epoch
    const result = owner.session.read(input)
    const settled = result.then(value => {
      // Native settlement and its consumer's microtask are distinct moments.
      // Recheck before notification AND after reentrant observers run.
      if (owner.closed || epoch.invalidated) return owner.closed || epoch.invalidated
      if (current === owner) publish(owner.session.snapshot())
      return owner.closed || epoch.invalidated || value
    })
    if (current === owner) publish(owner.session.snapshot())
    return settled
  }
  function invalidate() {
    if (current) {
      const owner = current, epoch = owner.epoch
      owner.epoch = { invalidated: null }
      epoch.invalidated = owner.session.invalidate()
      if (current === owner) publish(epoch.invalidated)
    }
    return snapshot
  }
  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Invalid S3 probe observer')
    // A registration owns its own wrapper: removing one subscription must not
    // silently remove another subscription of the same function.
    const notify = () => listener()
    listeners.add(notify)
    return () => { listeners.delete(notify) }
  }
  return Object.freeze({ connect, read, invalidate, subscribe, snapshot: () => snapshot })
}
