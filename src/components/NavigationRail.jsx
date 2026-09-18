import React from 'react'
import ThemeToggle from './ThemeToggle'

const Icon = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export default function NavigationRail({
  activeWorkspace,
  onChangeWorkspace,
  onOpenSearch,
  onOpenBackup,
  onOpenShortcuts,
}) {
  const items = [
    {
      id: 'notes',
      label: '笔记',
      icon: <Icon><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></Icon>,
    },
    {
      id: 'daily',
      label: '每日笔记',
      icon: <Icon><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></Icon>,
    },
    {
      id: 'graph',
      label: '知识图谱',
      icon: <Icon><circle cx="12" cy="12" r="2.5" /><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="m7 7.5 3 3M17 7.5l-3 3M7 16.5l3-3M17 16.5l-3-3" /></Icon>,
    },
    {
      id: 'trash',
      label: '回收站',
      icon: <Icon><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></Icon>,
    },
  ]

  return (
    <nav className="navigation-rail" aria-label="主导航">
      <div className="navigation-brand" title="Local Notepad" aria-label="Local Notepad">N</div>

      <div className="navigation-primary">
        <button className="rail-btn" onClick={onOpenSearch} title="快速搜索 (Ctrl+K)" aria-label="快速搜索">
          <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Icon>
        </button>
        <div className="navigation-divider" />
        {items.map(item => (
          <button
            key={item.id}
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
        <button className="rail-btn" onClick={onOpenBackup} title="备份与恢复" aria-label="备份与恢复">
          <Icon><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M7 3v6h8V4M7 21v-8h10v8" /></Icon>
        </button>
        <button className="rail-btn" onClick={onOpenShortcuts} title="快捷键" aria-label="快捷键">
          <Icon><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 13h10M9 16h6" /></Icon>
        </button>
        <div className="rail-theme">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  )
}
