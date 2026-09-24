import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { api } from '~/services/api'
import { toast } from '~/services/toast'

// Fetching a file is not permission to leave the current draft. Invoke the latest
// selection guard only after the fetch completes, and resolve after its decision.
export default function useGuardedNoteOpener({ currentId, workspace, navigationEpoch, onSelectFile, onHeading }) {
  const latest = useRef({ currentId, onSelectFile, onHeading })
  const pending = useRef(null)
  const generation = useRef(0)
  useLayoutEffect(() => { latest.current = { currentId, onSelectFile, onHeading } })
  const cancel = useCallback(() => {
    if (!pending.current) return
    const operation = pending.current
    pending.current = null
    operation.controller.abort()
    operation.cleanup?.()
    operation.resolve(false)
  }, [])
  useEffect(() => {
    if (pending.current && pending.current.epoch !== navigationEpoch.current) cancel()
  }, [currentId, workspace, navigationEpoch, cancel])
  useEffect(() => cancel, [cancel])

  return useCallback((id, options = {}) => {
    if (!id || options.signal?.aborted) return Promise.resolve(false)
    cancel()
    const sequence = ++generation.current
    const epoch = navigationEpoch.current
    const controller = new AbortController()
    return new Promise(resolve => {
      const operation = { sequence, epoch, controller, resolve }
      pending.current = operation
      const abort = () => { if (pending.current === operation) cancel() }
      operation.cleanup = () => options.signal?.removeEventListener('abort', abort)
      options.signal?.addEventListener('abort', abort, { once: true })
      const valid = () => {
        if (pending.current !== operation || navigationEpoch.current !== epoch || controller.signal.aborted || options.signal?.aborted) return false
        try { return options.shouldSelect?.() !== false } catch { return false }
      }
      const finish = accepted => {
        operation.cleanup()
        if (pending.current === operation) pending.current = null
        resolve(accepted)
      }
      Promise.resolve().then(() => api(`/api/files/${encodeURIComponent(id)}`, { signal: controller.signal }))
        .then(file => {
          if (!valid()) { finish(false); return }
          if (!file || file.is_deleted || file.is_folder || String(file.id) !== String(id)) {
            throw new Error('目标笔记不存在或已删除')
          }
          const headingPath = Array.isArray(options?.headingPath) ? options.headingPath.filter(Boolean) : []
          latest.current.onSelectFile(file, {
            shouldSelect: valid,
            onCancel: () => finish(false),
            afterSelect: () => {
              // onSelectFile has synchronously crossed its save/discard guard.
              if (headingPath.length) latest.current.onHeading?.(id, headingPath, latest.current.currentId === id)
              finish(true)
            },
          })
        })
        .catch(error => {
          if (valid() && error?.name !== 'AbortError') toast.error('目标笔记不存在或暂时无法打开')
          finish(false)
        })
    })
  }, [cancel, navigationEpoch])
}
