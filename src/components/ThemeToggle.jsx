import React, { useEffect, useState } from 'react'
import { api } from '~/services/api'

/**
 * 主题切换组件
 * 职责：在浅色/深色主题之间快速切换，并将选择持久化到 localStorage
 * 注意：后端 Settings API 完成后将改为从服务端读取/写入
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const s = await api('/api/settings')
        if (mounted && s?.theme) {
          setTheme(s.theme)
          document.documentElement.setAttribute('data-theme', s.theme)
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggle = async () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    try { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ theme: next }) }) } catch {}
  }

  return (
    <button className="btn" onClick={toggle} aria-label="切换主题">
      {theme === 'light' ? '夜间模式' : '日间模式'}
    </button>
  )
}
