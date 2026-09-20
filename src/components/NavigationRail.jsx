import React, { useEffect, useRef, useState } from 'react'
import ThemeToggle from './ThemeToggle'

const Icon = ({ children }) => (
  <svg
    width="19"
    height="19"
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

export default function NavigationRail({
  activeWorkspace,
  onChangeWorkspace,
  onOpenSearch,
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef(null)

  useEffect(() => {
    if (!moreOpen) return undefined
    const onPointerDown = (event) => {
      if (!moreRef.current?.contains(event.target)) setMoreOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [moreOpen])

  const moreActive = ['graph', 'trash', 'settings'].includes(activeWorkspace)

  const navigate = (workspace) => {
    setMoreOpen(false)
    onChangeWorkspace(workspace)
  }

  return (
    <nav className="navigation-rail minimal-navigation-rail" aria-label="主导航">
      <button
        type="button"
        className="navigation-brand minimal-navigation-brand"
        onClick={() => navigate('notes')}
        title="我的笔记"
        aria-label="我的笔记"
      >
        N
      </button>

      <div className="navigation-primary">
        <button
          type="button"
          className="rail-btn rail-search"
          onClick={onOpenSearch}
          title="搜索 (Ctrl+K)"
          aria-label="搜索笔记"
        >
          <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Icon>
        </button>

        <button
          type="button"
          className={`rail-btn${activeWorkspace === 'notes' ? ' active' : ''}`}
          onClick={() => navigate('notes')}
          title="笔记列表"
          aria-label="笔记列表"
          aria-pressed={activeWorkspace === 'notes'}
        >
          <Icon><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></Icon>
        </button>

        <button
          type="button"
          className={`rail-btn${activeWorkspace === 'daily' ? ' active' : ''}`}
          onClick={() => navigate('daily')}
          title="每日笔记"
          aria-label="每日笔记"
          aria-pressed={activeWorkspace === 'daily'}
        >
          <Icon><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Icon>
        </button>
      </div>

      <div className="navigation-secondary" ref={moreRef}>
        <div className="rail-more-wrap">
          <button
            type="button"
            className={`rail-btn${moreActive || moreOpen ? ' active' : ''}`}
            onClick={() => setMoreOpen(prev => !prev)}
            title="更多"
            aria-label="更多功能"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>
          </button>

          {moreOpen && (
            <div className="rail-more-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => navigate('graph')}>
                <Icon><circle cx="12" cy="12" r="2.5" /><circle cx="5" cy="7" r="2" /><circle cx="19" cy="7" r="2" /><path d="m7 8 3 2M17 8l-3 2M12 14v5" /></Icon>
                <span>知识图谱</span>
              </button>
              <button type="button" role="menuitem" onClick={() => navigate('trash')}>
                <Icon><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></Icon>
                <span>回收站</span>
              </button>
              <button type="button" role="menuitem" onClick={() => navigate('settings')}>
                <Icon><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></Icon>
                <span>设置</span>
              </button>
              <div className="rail-more-separator" />
              <div className="rail-more-theme">
                <span>外观</span>
                <ThemeToggle />
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
