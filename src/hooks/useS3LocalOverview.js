import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createS3LocalOverviewBinding, S3_LOCAL_OVERVIEW_DISCONNECTED,
  S3_LOCAL_OVERVIEW_STALE_INPUT } from '../services/s3LocalOverviewBinding.mjs'

// revision is a non-secret identity. Change it for committed workspace/context
// changes; call invalidate() synchronously in an edit handler before deferring
// a revision update. No render, mount or cleanup automatically starts a read.
export default function useS3LocalOverview(revision = 0) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Invalid local overview revision')
  const [binding] = useState(() => createS3LocalOverviewBinding())
  const result = useSyncExternalStore(binding.subscribe, binding.snapshot, binding.snapshot)
  useLayoutEffect(() => binding.connect(), [binding])
  const token = useMemo(() => ({}), [revision])
  const committed = useRef(null)
  useLayoutEffect(() => {
    committed.current = token
    binding.invalidate()
    return () => { if (committed.current === token) committed.current = null }
  }, [binding, token])
  const read = useCallback(input => {
    if (committed.current !== token) return Promise.resolve(committed.current === null
      ? S3_LOCAL_OVERVIEW_DISCONNECTED : S3_LOCAL_OVERVIEW_STALE_INPUT)
    return binding.read(input)
  }, [binding, token])
  const invalidate = useCallback(() => {
    if (committed.current !== token) return committed.current === null
      ? S3_LOCAL_OVERVIEW_DISCONNECTED : S3_LOCAL_OVERVIEW_STALE_INPUT
    return binding.invalidate()
  }, [binding, token])
  return { result, read, invalidate }
}
