import React from 'react'

const shortcuts = [
  { category: '全局', items: [
    { key: 'Ctrl + K', desc: '快速搜索 / 切换笔记' },
    { key: 'Ctrl + /', desc: '打开快捷键面板' },
    { key: 'F11', desc: '进入 / 退出专注模式' },
  ]},
  { category: '笔记', items: [
    { key: 'Ctrl + N', desc: '新建笔记' },
    { key: 'Ctrl + Shift + N', desc: '新建文件夹' },
    { key: 'Ctrl + S', desc: '保存当前笔记' },
    { key: 'Ctrl + Z', desc: '撤销笔记列表操作' },
  ]},
  { category: '编辑操作', items: [
    { key: 'Ctrl + F', desc: '打开编辑器搜索' },
    { key: 'Ctrl + H', desc: '打开替换面板' },
    { key: 'Ctrl + B', desc: '加粗' },
    { key: 'Ctrl + I', desc: '斜体' },
    { key: 'Ctrl + U', desc: '下划线' },
  ]},
  { category: '导航操作', items: [
    { key: '↑ / ↓', desc: '在笔记列表或快速搜索中移动' },
    { key: '← / →', desc: '折叠 / 展开文件夹' },
    { key: 'Enter', desc: '打开笔记 / 展开文件夹' },
    { key: 'F2', desc: '重命名当前笔记或列表项目' },
    { key: 'Delete', desc: '将当前项目移到回收站' },
    { key: 'Escape', desc: '关闭对话框 / 面板' },
  ]},
]

export default function ShortcutsModal({ open, onClose }) {
  React.useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-overlay consumer-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <section
        className="modal consumer-modal shortcuts-modal consumer-shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
      >
        <header className="selector-modal-header">
          <div>
            <h2 className="modal-title" id="shortcuts-dialog-title">快捷键</h2>
            <div className="modal-message">常用操作可以少点几次鼠标。</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭" title="关闭">×</button>
        </header>

        <div className="consumer-shortcuts-body">
          {shortcuts.map(group => (
            <section key={group.category} className="shortcut-group">
              <h3 className="shortcut-category">{group.category}</h3>
              <div className="shortcut-list">
                {group.items.map(item => (
                  <div key={item.key} className="shortcut-item">
                    <kbd className="shortcut-key">{item.key}</kbd>
                    <span className="shortcut-desc">{item.desc}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}
