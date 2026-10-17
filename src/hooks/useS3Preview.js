import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createS3PreviewBinding, S3_PREVIEW_DISCONNECTED, S3_PREVIEW_STALE_INPUT } from '../services/s3PreviewBinding.mjs'

// revision is non-secret context identity, not a credential/configuration object.
// Change it for every committed input, local-basis or pin change. In an edit
// handler call invalidate() immediately, before any deferred revision update.
export default function useS3Preview(revision = 0) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Invalid S3 preview input revision')
  const [binding] = useState(() => createS3PreviewBinding())
  const result = useSyncExternalStore(binding.subscribe, binding.snapshot, binding.snapshot)
  useLayoutEffect(() => binding.connect(), [binding])
  // Render may be abandoned. Only a layout commit can activate this token;
  // a pending Suspense render must not revoke the still-displayed revision.
  const token = useMemo(() => ({}), [revision])
  const committed = useRef(null)
  useLayoutEffect(() => {
    committed.current = token
    binding.invalidate()
    return () => { if (committed.current === token) committed.current = null }
  }, [binding, token])
  const read = useCallback(input => {
    if (committed.current !== token) {
      return Promise.resolve(committed.current === null ? S3_PREVIEW_DISCONNECTED : S3_PREVIEW_STALE_INPUT)
    }
    return binding.read(input)
  }, [binding, token])
  const invalidate = useCallback(() => {
    if (committed.current !== token) {
      return committed.current === null ? S3_PREVIEW_DISCONNECTED : S3_PREVIEW_STALE_INPUT
    }
    return binding.invalidate()
  }, [binding, token])
  return { result, read, invalidate }
}
