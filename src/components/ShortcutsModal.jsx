import React from 'react'

const shortcuts = [
  { category: '文件操作', items: [
    { key: 'Ctrl + N', desc: '新建文件' },
    { key: 'Ctrl + Shift + N', desc: '新建文件夹' },
    { key: 'Ctrl + S', desc: '保存当前文件' },
    { key: 'Ctrl + Z', desc: '撤销文件级操作' },
  ]},
  { category: '编辑操作', items: [
    { key: 'Ctrl + F', desc: '打开搜索面板' },
    { key: 'Ctrl + H', desc: '打开替换面板' },
    { key: 'Ctrl + B', desc: '加粗' },
    { key: 'Ctrl + I', desc: '斜体' },
    { key: 'Ctrl + U', desc: '下划线' },
  ]},
  { category: '导航操作', items: [
    { key: '↑ / ↓', desc: '在文件列表中移动' },
    { key: 'Enter', desc: '打开选中文件' },
    { key: 'Escape', desc: '关闭对话框/面板' },
  ]},
]

export default function ShortcutsModal({ open, onClose }) {
  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal shortcuts-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">快捷键</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {shortcuts.map(group => (
            <div key={group.category} className="shortcut-group">
              <h3 className="shortcut-category">{group.category}</h3>
              <div className="shortcut-list">
                {group.items.map(item => (
                  <div key={item.key} className="shortcut-item">
                    <kbd className="shortcut-key">{item.key}</kbd>
                    <span className="shortcut-desc">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
