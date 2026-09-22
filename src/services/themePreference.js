export const THEME_STORAGE_KEY = 'localNotepad.theme.v1'
export const THEME_EVENT = 'theme:changed'

export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light'
}

export function readStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : ''
  } catch {
    return ''
  }
}

export function readAppliedTheme() {
  if (typeof document === 'undefined') return 'light'
  return normalizeTheme(document.documentElement.getAttribute('data-theme'))
}

export function applyTheme(theme, { persist = true, notify = true } = {}) {
  const next = normalizeTheme(theme)

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', next)
    document.documentElement.style.colorScheme = next
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Theme persistence is best effort and must never block rendering.
    }
  }

  if (notify && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_EVENT, {
      detail: { theme: next },
    }))
  }

  return next
}

export function initializeThemeFromStorage() {
  const stored = readStoredTheme()
  if (stored) return applyTheme(stored, { persist: false, notify: false })

  const existing = typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-theme')
    : ''
  return applyTheme(existing || 'light', { persist: false, notify: false })
}

export function subscribeTheme(listener) {
  if (typeof window === 'undefined') return () => {}

  const onTheme = event => {
    const theme = normalizeTheme(event?.detail?.theme)
    listener(theme)
  }
  const onStorage = event => {
    if (event.key !== THEME_STORAGE_KEY) return
    listener(normalizeTheme(event.newValue))
  }

  window.addEventListener(THEME_EVENT, onTheme)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(THEME_EVENT, onTheme)
    window.removeEventListener('storage', onStorage)
  }
}
