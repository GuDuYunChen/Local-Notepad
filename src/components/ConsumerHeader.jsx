import React, { useEffect, useRef, useState } from 'react'
import ThemeToggle from './ThemeToggle'

const Icon = ({ children, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export default function ConsumerHeader({
  activeWorkspace,
  onChangeWorkspace,
  onOpenSearch,
  onOpenBackup,
  onOpenShortcuts,
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef(null)

  useEffect(() => {
    const close = (event) => {
      if (moreRef.current && !moreRef.current.contains(event.target)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const switchWorkspace = (id) => {
    setMoreOpen(false)
    onChangeWorkspace(id)
  }

  const moreActive = activeWorkspace === 'trash' || activeWorkspace === 'settings'

  return (
    <header className="consumer-header">
      <div className="consumer-brand" aria-label="记事本">
        <span className="consumer-brand-mark" aria-hidden="true">N</span>
        <strong>记事本</strong>
      </div>

      <nav className="consumer-nav" aria-label="主要功能">
        <button
          type="button"
          className={`consumer-nav-btn${activeWorkspace === 'notes' ? ' active' : ''}`}
          onClick={() => switchWorkspace('notes')}
          aria-pressed={activeWorkspace === 'notes'}
        >
          <Icon><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></Icon>
          <span>笔记</span>
        </button>
        <button
          type="button"
          className={`consumer-nav-btn${activeWorkspace === 'daily' ? ' active' : ''}`}
          onClick={() => switchWorkspace('daily')}
          aria-pressed={activeWorkspace === 'daily'}
        >
          <Icon><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Icon>
          <span>每日笔记</span>
        </button>
        <button
          type="button"
          className={`consumer-nav-btn${activeWorkspace === 'graph' ? ' active' : ''}`}
          onClick={() => switchWorkspace('graph')}
          aria-pressed={activeWorkspace === 'graph'}
        >
          <Icon><circle cx="12" cy="12" r="2.5" /><circle cx="5" cy="7" r="2" /><circle cx="19" cy="7" r="2" /><path d="m7 8 3 2M17 8l-3 2M12 14v5" /></Icon>
          <span>知识图谱</span>
        </button>
      </nav>

      <div className="consumer-header-actions">
        <button
          type="button"
          className="consumer-action-btn search"
          onClick={onOpenSearch}
          title="快速搜索 (Ctrl+K)"
        >
          <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Icon>
          <span>搜索</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="consumer-more" ref={moreRef}>
          <button
            type="button"
            className={`consumer-action-btn${moreActive ? ' active' : ''}`}
            onClick={() => setMoreOpen(prev => !prev)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>
            <span>更多</span>
          </button>

          {moreOpen && (
            <div className="consumer-more-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => switchWorkspace('trash')}>
                <Icon><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></Icon>
                <span>回收站</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onOpenBackup() }}>
                <Icon><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M7 3v6h8V4M7 21v-8h10v8" /></Icon>
                <span>备份与恢复</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onOpenShortcuts() }}>
                <Icon><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M7 13h10" /></Icon>
                <span>快捷键</span>
              </button>
              <div className="consumer-more-separator" />
              <button type="button" role="menuitem" onClick={() => switchWorkspace('settings')}>
                <Icon><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></Icon>
                <span>设置</span>
              </button>
            </div>
          )}
        </div>

        <div className="consumer-theme">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
