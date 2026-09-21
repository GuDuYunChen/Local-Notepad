import React from 'react'

export function FileNewMenu({ menuRef, onCreateNote, onCreateFolder }) {
  return (
    <div className="dropdown-menu file-action-menu" ref={menuRef} role="menu" aria-label="新建">
      <button type="button" className="menu-item" role="menuitem" onClick={onCreateNote}>
        <span className="menu-item-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3h9l3 3v15H6z" />
            <path d="M15 3v4h4M9 12h6M12 9v6" />
          </svg>
        </span>
        <span className="menu-item-label">新建笔记</span>
        <kbd>Ctrl+N</kbd>
      </button>

      <button type="button" className="menu-item" role="menuitem" onClick={onCreateFolder}>
        <span className="menu-item-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h7l2 2h9v11H3z" />
            <path d="M12 11v5M9.5 13.5h5" />
          </svg>
        </span>
        <span className="menu-item-label">新建文件夹</span>
        <kbd>Ctrl+Shift+N</kbd>
      </button>
    </div>
  )
}

export function FileLibraryMenu({
  selectedCount,
  onImport,
  onExport,
  onBatchOrganize,
}) {
  return (
    <div className="dropdown-menu file-action-menu file-more-menu" role="menu" aria-label="更多笔记操作">
      <button type="button" className="menu-item" role="menuitem" onClick={onImport}>
        <span className="menu-item-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 8l5-5 5 5" />
            <path d="M5 14v6h14v-6" />
          </svg>
        </span>
        <span className="menu-item-label">
          <strong>导入</strong>
          <small>Markdown、文本、Word 等</small>
        </span>
      </button>

      <button type="button" className="menu-item" role="menuitem" onClick={onExport}>
        <span className="menu-item-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21V9M7 16l5 5 5-5" />
            <path d="M5 10V4h14v6" />
          </svg>
        </span>
        <span className="menu-item-label">
          <strong>导出</strong>
          <small>保存为 Markdown 或 Word</small>
        </span>
      </button>

      <div className="divider" />

      <button type="button" className="menu-item danger" role="menuitem" onClick={onBatchOrganize}>
        <span className="menu-item-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" />
          </svg>
        </span>
        <span className="menu-item-label">
          <strong>{selectedCount > 1 ? '移到回收站（' + selectedCount + '）' : '批量整理'}</strong>
          <small>{selectedCount > 1 ? '所选内容可在 30 天内恢复' : '选择多个项目后可批量操作'}</small>
        </span>
      </button>
    </div>
  )
}

export function FileContextMenu({
  contextMenu,
  menuRef,
  onCreateNote,
  onCreateFolder,
  onTogglePin,
  onRename,
  onSaveAs,
  onDelete,
}) {
  if (!contextMenu) return null

  const item = contextMenu.item

  return (
    <div
      className="context-menu file-context-menu"
      ref={menuRef}
      role="menu"
      aria-label={item.title + ' 操作'}
      style={{
        top: contextMenu.y,
        left: contextMenu.x,
        position: 'fixed',
        zIndex: 200,
      }}
    >
      {item.is_folder && (
        <>
          <button type="button" className="menu-item" role="menuitem" onClick={() => onCreateNote(item)}>
            <span className="menu-item-icon" aria-hidden="true">＋</span>
            <span className="menu-item-label">在此新建笔记</span>
          </button>
          <button type="button" className="menu-item" role="menuitem" onClick={() => onCreateFolder(item)}>
            <span className="menu-item-icon" aria-hidden="true">▢</span>
            <span className="menu-item-label">在此新建文件夹</span>
          </button>
          <div className="divider" />
        </>
      )}

      <button type="button" className="menu-item" role="menuitem" onClick={() => onTogglePin(item)}>
        <span className="menu-item-icon" aria-hidden="true">⌖</span>
        <span className="menu-item-label">{item.is_pinned ? '取消置顶' : '置顶'}</span>
      </button>

      <button type="button" className="menu-item" role="menuitem" onClick={() => onRename(item)}>
        <span className="menu-item-icon" aria-hidden="true">✎</span>
        <span className="menu-item-label">重命名</span>
        <kbd>F2</kbd>
      </button>

      {!item.is_folder && (
        <button type="button" className="menu-item" role="menuitem" onClick={() => onSaveAs(item)}>
          <span className="menu-item-icon" aria-hidden="true">⇩</span>
          <span className="menu-item-label">另存为</span>
        </button>
      )}

      <div className="divider" />

      <button type="button" className="menu-item danger" role="menuitem" onClick={() => onDelete(item)}>
        <span className="menu-item-icon" aria-hidden="true">⌫</span>
        <span className="menu-item-label">移到回收站</span>
        <kbd>Del</kbd>
      </button>
    </div>
  )
}
