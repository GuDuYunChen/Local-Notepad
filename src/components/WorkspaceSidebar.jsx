import React, { useEffect, useRef, useState } from 'react'
import ThemeToggle from './ThemeToggle'

const Icon = ({ children, size = 18 }) => (
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

export default function WorkspaceSidebar({
  activeWorkspace,
  collapsed,
  onToggleCollapsed,
  onChangeWorkspace,
  onOpenSearch,
  onOpenBackup,
  onOpenShortcuts,
  children,
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

  const navigate = (workspace) => {
    setMoreOpen(false)
    onChangeWorkspace(workspace)
  }

  const navItems = [
    {
      id: 'notes',
      label: '笔记',
      icon: <Icon><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></Icon>,
    },
    {
      id: 'daily',
      label: '每日笔记',
      icon: <Icon><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Icon>,
    },
    {
      id: 'graph',
      label: '知识图谱',
      icon: <Icon><circle cx="12" cy="12" r="2.5" /><circle cx="5" cy="7" r="2" /><circle cx="19" cy="7" r="2" /><path d="m7 8 3 2M17 8l-3 2M12 14v5" /></Icon>,
    },
  ]

  return (
    <aside className={`workspace-sidebar file-sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="workspace-sidebar-top">
        <div className="workspace-sidebar-brand">
          <button
            type="button"
            className="workspace-brand-mark"
            onClick={() => navigate('notes')}
            aria-label="返回笔记"
            title="记事本"
          >
            N
          </button>

          {!collapsed && (
            <>
              <div className="workspace-brand-copy">
                <strong>记事本</strong>
                <span>我的本地空间</span>
              </div>
              <button
                type="button"
                className="workspace-sidebar-collapse"
                onClick={onToggleCollapsed}
                aria-label="折叠侧边栏"
                title="折叠侧边栏"
              >
                ‹
              </button>
            </>
          )}
        </div>

        {collapsed ? (
          <button
            type="button"
            className="workspace-sidebar-icon-btn"
            onClick={onOpenSearch}
            aria-label="搜索笔记"
            title="搜索 (Ctrl+K)"
          >
            <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Icon>
          </button>
        ) : (
          <button
            type="button"
            className="workspace-sidebar-search"
            onClick={onOpenSearch}
            aria-label="搜索笔记"
          >
            <Icon size={16}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Icon>
            <span>搜索笔记</span>
            <kbd>Ctrl K</kbd>
          </button>
        )}

        <nav className="workspace-sidebar-nav" aria-label="主要功能">
          {navItems.map(item => (
            <button
              key={item.id}
              type="button"
              className={`workspace-sidebar-nav-item${activeWorkspace === item.id ? ' active' : ''}`}
              onClick={() => navigate(item.id)}
              aria-pressed={activeWorkspace === item.id}
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
      </div>

      {!collapsed && (
        <div className="workspace-sidebar-library">
          {children}
        </div>
      )}

      <div className="workspace-sidebar-bottom" ref={moreRef}>
        <button
          type="button"
          className={`workspace-sidebar-more${moreOpen ? ' active' : ''}`}
          onClick={() => setMoreOpen(prev => !prev)}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          aria-label="更多功能"
          title={collapsed ? '更多功能' : undefined}
        >
          <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>
          {!collapsed && <span>更多</span>}
        </button>

        {collapsed && (
          <button
            type="button"
            className="workspace-sidebar-expand"
            onClick={onToggleCollapsed}
            aria-label="展开侧边栏"
            title="展开侧边栏"
          >
            ›
          </button>
        )}

        {moreOpen && (
          <div className={`workspace-sidebar-more-menu${collapsed ? ' from-collapsed' : ''}`} role="menu">
            <button type="button" role="menuitem" onClick={() => navigate('trash')}>
              <Icon><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></Icon>
              <span>回收站</span>
            </button>
            <button type="button" role="menuitem" onClick={() => navigate('settings')}>
              <Icon><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></Icon>
              <span>设置</span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onOpenBackup?.() }}>
              <Icon><path d="M5 4h14v16H5z" /><path d="M8 4v6h8V5M8 20v-7h8v7" /></Icon>
              <span>备份与恢复</span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onOpenShortcuts?.() }}>
              <Icon><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" /></Icon>
              <span>快捷键</span>
            </button>
            <div className="workspace-sidebar-menu-separator" />
            <div className="workspace-sidebar-theme">
              <span>外观</span>
              <ThemeToggle />
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
