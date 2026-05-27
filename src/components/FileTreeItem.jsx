import { useEffect, useRef, useState } from 'react'
import { useDrag, useDrop } from 'react-dnd'
import { Input, message } from 'antd'
import {
  FileOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  PushpinOutlined,
} from '@ant-design/icons'

export function FileTreeItem({
  item,
  depth,
  isSelected,
  isExpanded,
  onSelect,
  onToggle,
  onRename,
  onDelete,
  onPin,
  onDragEnd,
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.title)
  const inputRef = useRef(null)

  useEffect(() => {
    setName(item.title)
  }, [item.title])

  const [{ isDragging }, drag] = useDrag({
    type: 'FILE',
    item: { id: item.id, isFolder: item.is_folder },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  })

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: 'FILE',
    drop: (draggedItem) => {
      if (draggedItem.id === item.id) return
      onDragEnd(draggedItem.id, item.id)
    },
    canDrop: (draggedItem) => draggedItem.id !== item.id && item.is_folder,
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  })

  const handleRename = () => {
    if (name.trim()) {
      onRename(item.id, name.trim())
    }
    setEditing(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleRename()
    if (e.key === 'Escape') {
      setName(item.title)
      setEditing(false)
    }
  }

  const icon = item.is_folder ? (
    isExpanded ? <FolderOpenOutlined /> : <FolderOutlined />
  ) : (
    <FileOutlined />
  )

  return (
    <div
      ref={(node) => drag(drop(node))}
      className={`file-tree-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isOver && canDrop ? 'drop-over' : ''}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => !item.is_folder && onSelect(item)}
      onDoubleClick={() => item.is_folder && onToggle(item.id)}
      role="treeitem"
      aria-expanded={item.is_folder ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !item.is_folder) {
          onSelect(item)
        }
        if (e.key === 'Enter' && item.is_folder) {
          onToggle(item.id)
        }
      }}
    >
      <span className="file-icon">{icon}</span>
      {item.is_pinned && <PushpinOutlined className="pin-icon" />}
      {editing ? (
        <Input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={handleKeyDown}
          autoFocus
          size="small"
          className="rename-input"
        />
      ) : (
        <span className="file-title">{item.title}</span>
      )}
      <div className="file-actions">
        {!editing && (
          <>
            <button
              type="button"
              className="file-action-btn"
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              aria-label={`重命名 ${item.title}`}
            >
              重命名
            </button>
            <button
              type="button"
              className="file-action-btn"
              onClick={(e) => { e.stopPropagation(); onPin(item.id, !item.is_pinned); }}
              aria-label={item.is_pinned ? `取消置顶 ${item.title}` : `置顶 ${item.title}`}
            >
              {item.is_pinned ? '取消置顶' : '置顶'}
            </button>
            <button
              type="button"
              className="file-action-btn file-action-btn--danger"
              onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
              aria-label={`删除 ${item.title}`}
            >
              删除
            </button>
          </>
        )}
      </div>
    </div>
  )
}
