import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createS3ProbeBinding } from '../services/s3ProbeBinding.mjs'

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
  useLayoutEffect(() => { binding.invalidate() }, [binding, revision])
  return { result, read: binding.read, invalidate: binding.invalidate }
}
