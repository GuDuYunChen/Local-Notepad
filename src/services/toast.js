const TOAST_EVENT = 'local-notepad:toast'

let toastSeed = 0

function nextId() {
  toastSeed += 1
  return `toast-${Date.now()}-${toastSeed}`
}

function emit(type, content, durationSeconds) {
  if (typeof window === 'undefined') return () => {}

  const id = nextId()
  const defaultDuration = type === 'loading' ? 0 : 3
  const seconds = typeof durationSeconds === 'number' ? durationSeconds : defaultDuration
  const duration = seconds === 0 ? 0 : Math.max(500, seconds * 1000)

  window.dispatchEvent(new CustomEvent(TOAST_EVENT, {
    detail: {
      action: 'show',
      toast: {
        id,
        type,
        content: String(content ?? ''),
        duration,
      },
    },
  }))

  return () => {
    window.dispatchEvent(new CustomEvent(TOAST_EVENT, {
      detail: { action: 'close', id },
    }))
  }
}

export const toast = {
  success(content, duration) {
    return emit('success', content, duration)
  },
  error(content, duration) {
    return emit('error', content, duration)
  },
  warning(content, duration) {
    return emit('warning', content, duration)
  },
  loading(content, duration = 0) {
    return emit('loading', content, duration)
  },
}

export { TOAST_EVENT }
