import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createS3ProbeBinding } from '../services/s3ProbeBinding.mjs'
import { S3_PROBE_LIMITATION } from '../services/s3ReadProbe.mjs'

// Command refusals are credential-free and do not publish into the live binding.
const refused = (state, code, message) => Object.freeze({
  state, code, serviceStatus: 0, summary: null, message, limitation: S3_PROBE_LIMITATION,
})
const STALE_INPUT = refused('stopped', 'stale-input', '检查上下文已变化；本次未调用原生桥，请使用当前界面重新检查。')
const DISCONNECTED = refused('disposed', 'disposed', '检查会话已关闭；未发起新的读取。')

// revision is a non-secret generation counter, NOT the configuration/credentials.
// Increment it on committed input/context changes. Call invalidate() directly in
// edit handlers when invalidation must precede a deferred React render.
export default function useS3ReadProbe(revision = 0) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Invalid S3 probe input revision')
  const [binding] = useState(() => createS3ProbeBinding())
  const result = useSyncExternalStore(binding.subscribe, binding.snapshot, binding.snapshot)
  // React StrictMode replays setup/cleanup. Reconnect a fresh lifetime rather
  // than reusing a permanently disposed session; construction never probes.
  useLayoutEffect(() => binding.connect(), [binding])
  // Each rendered revision owns a distinct capability. A committed A→B→A
  // creates a new token even when the caller reuses a numeric revision. Never
  // replace the committed token during render: a discarded/suspended render
  // must not authorize its handlers or revoke the still-committed handlers.
  const token = useMemo(() => ({}), [revision])
  const committed = useRef(null)
  useLayoutEffect(() => {
    committed.current = token
    binding.invalidate()
    return () => { if (committed.current === token) committed.current = null }
  }, [binding, token])
  const read = useCallback(input => {
    // Check before inspecting input or discovering the native bridge. Old
    // confirmations cannot become new requests in the latest revision.
    if (committed.current !== token) return Promise.resolve(committed.current === null ? DISCONNECTED : STALE_INPUT)
    return binding.read(input)
  }, [binding, token])
  const invalidate = useCallback(() => {
    if (committed.current !== token) return committed.current === null ? DISCONNECTED : STALE_INPUT
    return binding.invalidate()
  }, [binding, token])
  return { result, read, invalidate }
}
