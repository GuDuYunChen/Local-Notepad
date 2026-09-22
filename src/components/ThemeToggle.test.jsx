// @vitest-environment happy-dom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ThemeToggle from './ThemeToggle'
import { api } from '~/services/api'
import {
  THEME_STORAGE_KEY,
  initializeThemeFromStorage,
} from '~/services/themePreference'

vi.mock('~/services/api', () => ({
  api: vi.fn(),
}))

describe('ThemeToggle persistence', () => {
  let container
  let root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
    api.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    container.remove()
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })

  it('restores the persisted theme before the app renders', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    expect(initializeThemeFromStorage()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('does not reset dark theme when the more-menu ThemeToggle mounts', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    initializeThemeFromStorage()

    api.mockImplementation(async (path, init) => {
      if (path === '/api/settings' && !init?.method) {
        return { theme: 'light' }
      }
      if (path === '/api/settings' && init?.method === 'PUT') {
        return { theme: 'dark' }
      }
      throw new Error('Unexpected request')
    })

    await act(async () => {
      root.render(<ThemeToggle />)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(api).toHaveBeenCalledWith('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ theme: 'dark' }),
    })
  })

  it('persists a user toggle locally immediately', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    initializeThemeFromStorage()
    api.mockResolvedValue({ theme: 'light' })

    await act(async () => {
      root.render(<ThemeToggle />)
    })

    const button = container.querySelector('button[aria-label="切换主题"]')
    expect(button).toBeTruthy()

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
