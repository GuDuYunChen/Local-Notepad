import React, { useEffect, useState } from 'react'
import { api } from '~/services/api'
import {
  applyTheme,
  readAppliedTheme,
  readStoredTheme,
  subscribeTheme,
} from '~/services/themePreference'

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => (
    readStoredTheme() || readAppliedTheme()
  ))

  useEffect(() => {
    setTheme(readStoredTheme() || readAppliedTheme())
    return subscribeTheme(setTheme)
  }, [])

  useEffect(() => {
    let mounted = true

    ;(async () => {
      try {
        const settings = await api('/api/settings')
        if (!mounted) return

        const localTheme = readStoredTheme()
        const serverTheme = settings?.theme === 'dark' ? 'dark' : 'light'

        if (localTheme) {
          setTheme(localTheme)
          applyTheme(localTheme, { persist: false })

          if (serverTheme !== localTheme) {
            try {
              await api('/api/settings', {
                method: 'PUT',
                body: JSON.stringify({ theme: localTheme }),
              })
            } catch {
              // Local theme remains authoritative when server sync is unavailable.
            }
          }
          return
        }

        setTheme(serverTheme)
        applyTheme(serverTheme)
      } catch {
        const fallback = readStoredTheme() || readAppliedTheme()
        setTheme(fallback)
        applyTheme(fallback, { persist: Boolean(readStoredTheme()) })
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  const toggle = async () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    applyTheme(next)

    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ theme: next }),
      })
    } catch {
      // localStorage is the primary startup source; backend sync is best effort.
    }
  }

  return (
    <button
      type="button"
      className="btn header-btn theme-toggle"
      onClick={toggle}
      aria-label="切换主题"
      title={theme === 'light' ? '切换为深色主题' : '切换为浅色主题'}
    >
      {theme === 'light' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      )}
    </button>
  )
}
