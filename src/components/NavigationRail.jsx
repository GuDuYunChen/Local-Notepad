import React from 'react'
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
  const primaryItems = [
    {
      id: 'notes',
      label: '笔记列表',
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
    <nav className="navigation-rail minimal-navigation-rail" aria-label="主导航">
      <button
        type="button"
        className="navigation-brand minimal-navigation-brand"
        onClick={() => onChangeWorkspace('notes')}
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

        {primaryItems.map(item => (
          <button
            key={item.id}
            type="button"
            className={`rail-btn${activeWorkspace === item.id ? ' active' : ''}`}
            onClick={() => onChangeWorkspace(item.id)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={activeWorkspace === item.id}
          >
            {item.icon}
          </button>
        ))}
      </div>

      <div className="navigation-secondary">
        <button
          type="button"
          className={`rail-btn${activeWorkspace === 'trash' ? ' active' : ''}`}
          onClick={() => onChangeWorkspace('trash')}
          title="回收站"
          aria-label="回收站"
          aria-pressed={activeWorkspace === 'trash'}
        >
          <Icon><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></Icon>
        </button>
        <button
          type="button"
          className={`rail-btn${activeWorkspace === 'settings' ? ' active' : ''}`}
          onClick={() => onChangeWorkspace('settings')}
          title="设置"
          aria-label="设置"
          aria-pressed={activeWorkspace === 'settings'}
        >
          <Icon><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></Icon>
        </button>
        <div className="rail-theme">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  )
}
