import React, { useEffect, useState, useMemo, useRef } from 'react'
import { useDrag, useDrop } from 'react-dnd'
import { NativeTypes } from 'react-dnd-html5-backend'
import { api, listAllFiles } from '~/services/api'
import { toast } from '~/services/toast'
import { executeFileHistoryAction } from '~/services/fileHistory'

const NameDialog = React.lazy(() => import('./NameDialog'))
const FileSelectorDialog = React.lazy(() => import('./FileSelectorDialog'))
const TemplateSelector = React.lazy(() => import('./TemplateSelector'))
const ItemType = 'FILE_NODE'

const FileNode = ({ 
    node, 
    level, 
    isSelected,
    isKeyboardFocused,
    isExpanded, 
    folderState, 
    onSelect, 
    toggleExpand, 
    onContextMenu, 
    onMove,
    checkHierarchy,
    removeExtension,
    onRename,
    onDelete
}) => {
    const ref = useRef(null)
    const [dropPos, setDropPos] = useState(null)

    const [{ isDragging }, drag] = useDrag({
        type: ItemType,
        item: { ...node },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    })

    const [{ isOver }, drop] = useDrop({
        accept: ItemType,
        hover: (draggedItem, monitor) => {
            if (!ref.current || !monitor.isOver({ shallow: true })) return
            
            if (draggedItem.id === node.id) return
            
            // Hierarchy Check
            if (checkHierarchy(draggedItem.id, node.id)) {
                return
            }

            const hoverBoundingRect = ref.current.getBoundingClientRect()
            const hoverClientY = monitor.getClientOffset().y - hoverBoundingRect.top
            const height = hoverBoundingRect.height
            
            let newPos = ''
            if (node.is_folder) {
                if (hoverClientY < height * 0.25) newPos = 'before'
                else if (hoverClientY > height * 0.75) newPos = 'after'
                else newPos = 'inside'
            } else {
                if (hoverClientY < height * 0.5) newPos = 'before'
                else newPos = 'after'
            }
            
            setDropPos(newPos)
        },
        drop: (draggedItem, monitor) => {
            if (monitor.didDrop()) return
            if (draggedItem.id === node.id) return
            
            if (checkHierarchy(draggedItem.id, node.id)) {
                toast.error('操作无效：不能将文件夹移动到自身子目录', 3)
                return
            }
            onMove(draggedItem, node, dropPos)
        },
        collect: (monitor) => ({
            isOver: monitor.isOver({ shallow: true }),
        }),
    })

    drag(drop(ref))

    // Reset dropPos when not over
    useEffect(() => {
        if (!isOver) setDropPos(null)
    }, [isOver])

    let dragClass = ''
    if (isOver && dropPos) {
        if (dropPos === 'inside') dragClass = 'drag-inside'
        else if (dropPos === 'before') dragClass = 'drag-before'
        else if (dropPos === 'after') dragClass = 'drag-after'
    }

    return (
        <div
            ref={ref}
            id={`file-tree-item-${node.id}`}
            data-file-id={node.id}
            role="treeitem"
            aria-level={level + 1}
            aria-selected={isSelected}
            aria-expanded={node.is_folder ? isExpanded : undefined}
            className={`list-item level-${level}${isSelected ? ' active' : ''}${isKeyboardFocused ? ' keyboard-focus' : ''}${node.is_folder ? ' folder' : ''} ${isDragging ? 'dragging' : ''} ${dragClass}`}
            onClick={(e) => onSelect(node, e)}
            onContextMenu={(e) => onContextMenu(e, node)}
            style={{ paddingLeft: `${12 + level * 16}px`, opacity: isDragging ? 0.5 : 1 }}
        >
          <div className="icon" aria-hidden="true">
              {node.is_folder ? (
                  isExpanded ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                  ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  )
              ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              )}
              {node.is_folder && folderState > 0 && (
                  <span className="selection-indicator">
                      {folderState === 2 ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      )}
                  </span>
              )}
          </div>
          <div className="info">
            <div className="title" title={node.title}>
                {node.is_pinned && <span className="pin-icon" title="已置顶">⭐</span>}
                {node.is_folder ? node.title : removeExtension(node.title)}
                {node.is_folder && <span className="count"> ({node.fileCount})</span>}
            </div>
          </div>
          <div className="actions">
            <button tabIndex={-1} className="action-btn" onClick={(e) => { e.stopPropagation(); onRename(node); }} title="重命名" aria-label={`重命名 ${node.title}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button tabIndex={-1} className="action-btn danger" onClick={(e) => { e.stopPropagation(); onDelete(node); }} title="删除" aria-label={`删除 ${node.title}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
    )
}

/**
 * 文件列表组件
 * 职责：展示应用库中的文件列表（树形结构），提供新建/打开/保存/删除基础操作
 * 增强：文件夹文件计数、拖拽排序与移动、删除优化
 */
export default function FileList({ selectedId, onSelect, onBeforeNew, onBeforeDelete, onItemsChanged, updatedItem }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [naming, setNaming] = useState(false) // 新建文件对话框
  const [folderNaming, setFolderNaming] = useState(false) // 新建文件夹对话框
  const [renaming, setRenaming] = useState(null)
  const [showExport, setShowExport] = useState(false)
  const [showBatchDelete, setShowBatchDelete] = useState(false)
  const [expanded, setExpanded] = useState(new Set()) // 展开的文件夹ID集合
  const [showNewMenu, setShowNewMenu] = useState(false) // 新建菜单显隐
  const [showLibraryMenu, setShowLibraryMenu] = useState(false)
  const [contextMenu, setContextMenu] = useState(null) // 右键菜单 { x, y, item }
  const [targetParentId, setTargetParentId] = useState('') // 新建时的目标父目录ID
  const [showFolderSelector, setShowFolderSelector] = useState(false) // 路径选择器
  const [showTemplate, setShowTemplate] = useState(false) // 模板选择器
  const [pendingNewFile, setPendingNewFile] = useState(null) // 待新建文件信息
  
  const [selectedIds, setSelectedIds] = useState(new Set()) // Multi-select state
  const [keyboardFocusId, setKeyboardFocusId] = useState(selectedId || '')
  const treeListRef = useRef(null)

  // Sync selectedId (prop) with selectedIds
  useEffect(() => {
      // Always sync internal selection with prop, ensuring UI reflects Active Editor state.
      if (selectedId) {
          setKeyboardFocusId(selectedId)
          // Force sync: if prop exists, it must be the only selection (unless multi-select mode? logic simplified for now)
          // To fix "two items selected on cancel": we enforce that if we are not in a multi-select operation (which we can't easily know here),
          // we sync to prop.
          // Since we decided `handleSelect` won't update `selectedIds` for single click, this Effect does the job.
          setSelectedIds(new Set([selectedId]))
      } else {
          setSelectedIds(new Set())
      }
  }, [selectedId])

  // Multi-select Logic
  function handleSelect(item, e) {
      setKeyboardFocusId(item.id)
      if (item.is_folder) {
          toggleExpand(item.id, e)
          return
      }
      
      // If ctrl key, toggle
      if (e && (e.ctrlKey || e.metaKey)) {
          const next = new Set(selectedIds)
          if (next.has(item.id)) {
              next.delete(item.id)
          } else {
              next.add(item.id)
          }
          setSelectedIds(next)
          onSelect(item) 
      } else if (e && e.shiftKey) {
          // Range select
          const next = new Set(selectedIds)
          next.add(item.id)
          setSelectedIds(next)
          onSelect(item)
      } else {
          // Single select
          // We do NOT update selectedIds immediately here if we want to wait for parent confirmation?
          // But UI needs feedback.
          // Strategy: Optimistically select. If parent denies (prop doesn't change), 
          // the useEffect [selectedId] will revert it (if we enforce it).
          
          // Let's enforce sync in useEffect.
          // Here we just notify parent.
          // BUT, to avoid "flash" or double selection, we can wait?
          // No, usually we select immediately.
          // If parent cancels, selectedId prop won't change, so we revert.
          
          // ISSUE: `selectedIds` update is batched.
          // If we set it here, render happens.
          // Then parent decides to NOT change selectedId.
          // Then useEffect runs? No, if prop doesn't change, useEffect [selectedId] might NOT run if dependency didn't change.
          // But we need it to run to revert.
          
          // Solution: Don't set `selectedIds` here for single select. 
          // Let the prop drive the selection state for the Active File.
          // But for multi-select (Ctrl), we manage local state.
          
          // REFACTOR:
          // For single click (activation): Call onSelect. Don't touch selectedIds.
          // Let useEffect update selectedIds when prop changes.
          // This ensures if switch is cancelled, UI doesn't change.
          
          onSelect(item)
      }
  }

  // Recursive Selection State for Folder
  // Returns: 0 (none), 1 (partial), 2 (all)
  function getFolderSelectionState(node) {
      if (!node.children || node.children.length === 0) return 0
      
      let selectedCount = 0
      let allCount = 0
      
      const traverse = (n) => {
          if (n.is_folder) {
              n.children.forEach(traverse)
          } else {
              allCount++
              if (selectedIds.has(n.id)) selectedCount++
          }
      }
      traverse(node)
      
      if (allCount === 0) return 0
      if (selectedCount === allCount) return 2
      if (selectedCount > 0) return 1
      return 0
  }
  const newMenuRef = useRef(null)
  const libraryMenuRef = useRef(null)
  const searchMountedRef = useRef(false)
  const contextMenuRef = useRef(null)

  const [deleteConfirm, setDeleteConfirm] = useState(null) // { id, count, isFolder }

  // Auto expand path on load or selection change
  useEffect(() => {
      if (!selectedId || items.length === 0) return
      
      const toExpand = new Set(expanded)
      let curr = items.find(i => i.id === selectedId)
      let changed = false
      while (curr && curr.parent_id) {
          if (!toExpand.has(curr.parent_id)) {
              toExpand.add(curr.parent_id)
              changed = true
          }
          curr = items.find(i => i.id === curr.parent_id)
      }
      if (changed) {
          setExpanded(toExpand)
      }
  }, [selectedId, items]) // Note: items change might trigger re-expand, which is okay

  // Undo/Redo Manager (Simplified)
  // Stack format: { type: 'delete'|'create'|'rename'|'move', data: { ... } }
  // We only support undo for now to keep it simple, or full stack.
  // Due to state complexity, we'll implement a basic history stack ref.
  const historyRef = useRef({ undo: [], redo: [] })
  const retryTimerRef = useRef(null)
  
  function pushHistory(action) {
      historyRef.current.undo.push(action)
      historyRef.current.redo = [] // clear redo on new action
  }
  
  async function performUndo() {
      const action = historyRef.current.undo.pop()
      if (!action) return
      
      try {
          await executeFileHistoryAction(action, 'undo')
          historyRef.current.redo.push(action)
          void load()
      } catch (e) {
          console.error("Undo failed", e)
          toast.error('撤销失败: ' + (e.message || '未知错误'))
          historyRef.current.undo.push(action) // put back
      }
  }

  async function performRedo() {
      const action = historyRef.current.redo.pop()
      if (!action) return

      try {
          await executeFileHistoryAction(action, 'redo')
          historyRef.current.undo.push(action)
          void load()
      } catch (e) {
          console.error("Redo failed", e)
          toast.error('重做失败: ' + (e.message || '未知错误'))
          historyRef.current.redo.push(action)
      }
  }

  // Keyboard shortcut for Undo/Redo
  useEffect(() => {
      function handleUndoRedo(e) {
          if (e.ctrlKey && e.key === 'z') {
              // 如果焦点在可编辑元素内（编辑器、输入框等），不拦截，让编辑器自行处理
              const el = document.activeElement
              const tag = el?.tagName?.toLowerCase()
              if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return
              e.preventDefault()
              if (e.shiftKey) {
                  void performRedo()
              } else {
                  void performUndo()
              }
          }
      }
      window.addEventListener('keydown', handleUndoRedo)
      return () => window.removeEventListener('keydown', handleUndoRedo)
  }, [])


  useEffect(() => {
    const handleCreateNoteRequest = () => {
      void onNewFileCheck()
    }
    window.addEventListener('library:create-note', handleCreateNoteRequest)
    return () => window.removeEventListener('library:create-note', handleCreateNoteRequest)
  }, [selectedId, items])

  useEffect(() => {
    void load()
    
    function handleClickOutside(e) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target)) {
        setShowNewMenu(false)
      }
      if (libraryMenuRef.current && !libraryMenuRef.current.contains(e.target)) {
        setShowLibraryMenu(false)
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!searchMountedRef.current) {
      searchMountedRef.current = true
      return undefined
    }
    const timer = window.setTimeout(() => {
      void load()
    }, 280)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => {
    // 快捷键支持
    function handleKeyDown(e) {
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault()
        if (e.shiftKey) {
           onNewFolderCheck()
        } else {
           onNewFileCheck()
        }
      }
      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null)
        }
        if (showNewMenu) {
          setShowNewMenu(false)
        }
        if (showLibraryMenu) {
          setShowLibraryMenu(false)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, contextMenu, showNewMenu, showLibraryMenu]) // 保持快捷键读取最新菜单状态

  useEffect(() => {
    if (!updatedItem) return
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === updatedItem.id)
      if (idx < 0) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], ...updatedItem }
      return next
    })
  }, [updatedItem])

  // Helper to build tree from flat items (for internal logic usage)
  const buildTree = React.useMemo(() => {
    return (flatItems) => {
        const map = {}
        const roots = []
        flatItems.forEach(i => {
            map[i.id] = { ...i, children: [] }
        })
        flatItems.forEach(i => {
            if (i.parent_id && map[i.parent_id]) {
                map[i.parent_id].children.push(map[i.id])
            } else {
                roots.push(map[i.id])
            }
        })
        
        const sortFn = (a, b) => {
            return (b.sort_order ?? 0) - (a.sort_order ?? 0)
        }
        
        const sortRecursive = (nodes) => {
            nodes.sort(sortFn)
            nodes.forEach(n => sortRecursive(n.children))
        }
        sortRecursive(roots)
        return roots
    }
  }, [])

  // Helper to find the first file (DFS)
  const findFirstFileInTree = React.useMemo(() => {
      return (nodes) => {
          for (const node of nodes) {
              if (!node.is_folder) return node
              const found = findFirstFileInTree(node.children)
              if (found) return found
          }
          return null
      }
  }, [])
  
  // Helper to find first file in a specific folder (by ID)
  const findFirstFileInFolder = React.useMemo(() => {
      return (tree, folderId) => {
          let targetFolder = null
          const findFolder = (nodes) => {
              for (const node of nodes) {
                  if (node.id === folderId) {
                      targetFolder = node
                      return
                  }
                  if (node.children) findFolder(node.children)
                  if (targetFolder) return
              }
          }
          findFolder(tree)
          
          if (targetFolder && targetFolder.children.length > 0) {
              return findFirstFileInTree(targetFolder.children)
          }
          return null
      }
  }, [findFirstFileInTree])

  async function load(retryCount = 0) {
    setLoading(true)
    try {
      const normalizedList = await listAllFiles(q)
      setItems(normalizedList)
      onItemsChanged?.(normalizedList)
      
      // Ensure selection
      if (!selectedId && normalizedList.length > 0) {
          const tree = buildTree(normalizedList)
          const first = findFirstFileInTree(tree)
          if (first) onSelect(first)
      }
    } catch (e) {
      console.error(e)
      if (retryCount < 3) {
          console.log(`Load failed, retrying (${retryCount + 1}/3)...`)
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
          retryTimerRef.current = setTimeout(() => load(retryCount + 1), 1000)
      } else {
          toast.error('加载文件列表失败，请手动刷新')
      }
    } finally {
      setLoading(false)
    }
  }

  // Helper to get path label
  const getPathLabel = (folderId) => {
      if (!folderId) return '根目录'
      const parts = []
      let curr = items.find(i => i.id === folderId)
      while (curr) {
          parts.unshift(curr.title)
          curr = items.find(i => i.id === curr.parent_id)
      }
      return parts.join(' / ') || '根目录'
  }

  // 构建树形结构 (Memoized for rendering)
  const tree = useMemo(() => {
    const map = {}
    const roots = []
    items.forEach(i => {
      map[i.id] = { ...i, children: [], fileCount: 0 }
    })
    
    // 第一次遍历：构建层级
    items.forEach(i => {
      if (i.parent_id && map[i.parent_id]) {
        map[i.parent_id].children.push(map[i.id])
      } else {
        roots.push(map[i.id])
      }
    })

    // 递归计算文件数和排序
    const sortFn = (a, b) => {
        // 需求调整：文件夹和文件混合排序，仅按 sort_order 倒序
        return (b.sort_order ?? 0) - (a.sort_order ?? 0)
    }

    const processRecursive = (nodes) => {
        nodes.sort(sortFn)
        let count = 0
        nodes.forEach(n => {
            if (n.is_folder) {
                n.fileCount = processRecursive(n.children)
                count += n.fileCount // 文件夹算作包含的文件数
            } else {
                count += 1
            }
        })
        return count
    }
    processRecursive(roots)
    return roots
  }, [items])

  const visibleNodes = useMemo(() => {
      const out = []
      const walk = (nodes) => {
          for (const node of nodes) {
              out.push(node)
              if (node.is_folder && expanded.has(node.id)) {
                  walk(node.children || [])
              }
          }
      }
      walk(tree)
      return out
  }, [tree, expanded])

  const focusTreeItem = React.useCallback((id) => {
      if (!id) return
      setKeyboardFocusId(id)
      window.requestAnimationFrame(() => {
          document.querySelector(`[data-file-id="${CSS.escape(id)}"]`)?.scrollIntoView({
              block: 'nearest',
          })
      })
  }, [])

  function handleTreeKeyDown(event) {
      if (visibleNodes.length === 0) return

      const currentIndex = Math.max(
          0,
          visibleNodes.findIndex(node => node.id === (keyboardFocusId || selectedId))
      )
      const currentNode = visibleNodes[currentIndex] || visibleNodes[0]

      if (event.key === 'ArrowDown') {
          event.preventDefault()
          const next = visibleNodes[Math.min(visibleNodes.length - 1, currentIndex + 1)]
          focusTreeItem(next.id)
          return
      }
      if (event.key === 'ArrowUp') {
          event.preventDefault()
          const prev = visibleNodes[Math.max(0, currentIndex - 1)]
          focusTreeItem(prev.id)
          return
      }
      if (event.key === 'Home') {
          event.preventDefault()
          focusTreeItem(visibleNodes[0].id)
          return
      }
      if (event.key === 'End') {
          event.preventDefault()
          focusTreeItem(visibleNodes[visibleNodes.length - 1].id)
          return
      }
      if (event.key === 'ArrowRight' && currentNode.is_folder) {
          event.preventDefault()
          if (!expanded.has(currentNode.id)) {
              toggleExpand(currentNode.id)
          } else if (currentNode.children?.length) {
              focusTreeItem(currentNode.children[0].id)
          }
          return
      }
      if (event.key === 'ArrowLeft') {
          event.preventDefault()
          if (currentNode.is_folder && expanded.has(currentNode.id)) {
              toggleExpand(currentNode.id)
          } else if (currentNode.parent_id) {
              focusTreeItem(currentNode.parent_id)
          }
          return
      }
      if (event.key === 'Enter') {
          event.preventDefault()
          if (currentNode.is_folder) {
              toggleExpand(currentNode.id)
          } else {
              onSelect(currentNode)
          }
          return
      }
      if (event.key === 'F2') {
          event.preventDefault()
          event.stopPropagation()
          setRenaming(currentNode)
          return
      }
      if (event.key === 'Delete') {
          event.preventDefault()
          void onDeleteCheck(currentNode.id)
      }
  }

  async function onNewFileCheck(parentId) {
    try {
      const ok = await (onBeforeNew?.() ?? true)
      if (!ok) return

      let target = parentId;
      // If parentId is not provided (e.g. toolbar/shortcut), infer from selection
      if (target === undefined || target === null || target === '') {
          // Note: toolbar passes '', shortcut passes nothing.
          // But if explicit '' is passed (e.g. explicit root), we might want to respect it?
          // Existing code: toolbar calls onNewFileCheck('')
          // Shortcut calls onNewFileCheck()
          
          // Let's refine: if argument is NOT provided (undefined), try to infer.
          // If '' is provided, it means root.
          // However, user wants "smart" creation.
          // If I click "New" in toolbar, I usually expect it to be in current context if I have one.
          
          // Let's change toolbar to call onNewFileCheck() without args if we want inference.
          // But wait, the existing code for toolbar was: onClick={() => onNewFileCheck('')}
          // I should change that call site if I want inference there.
          // OR I can change logic here: if parentId is '' AND we have selection, maybe we should infer?
          // But maybe user WANTS root.
          
          // To be safe and support "Explicit Root", we should treat '' as Root.
          // And change Toolbar/Shortcut to pass `undefined` or `null` to signal "Infer".
          
          if (target === undefined || target === null) {
              if (selectedId) {
                  const item = items.find(i => i.id === selectedId)
                  if (item) {
                      target = item.is_folder ? item.id : item.parent_id
                  }
              }
              if (!target) target = ''
          }
      }

      setTargetParentId(target)
      setShowTemplate(true)
      setShowNewMenu(false)
      setContextMenu(null)
    } catch (e) {
      console.error(e)
      toast.error('操作失败: ' + (e.message || '未知错误'))
    }
  }

  async function onNewFolderCheck(parentId) {
    try {
      let target = parentId;
      if (target === undefined || target === null) {
          if (selectedId) {
              const item = items.find(i => i.id === selectedId)
              if (item) {
                  target = item.is_folder ? item.id : item.parent_id
              }
          }
          if (!target) target = ''
      }

      setTargetParentId(target)
      setFolderNaming(true)
      setShowNewMenu(false)
      setContextMenu(null)
    } catch (e) {
      console.error(e)
      toast.error('操作失败: ' + (e.message || '未知错误'))
    }
  }

  async function onExportConfirm(ids, roots) {
    try {
        const format = await new Promise((resolve) => {
            const choice = window.confirm('导出为 Markdown 格式？\n\n点击"确定"导出为 Markdown\n点击"取消"导出为 DOCX')
            resolve(choice ? 'markdown' : 'docx')
        })
        
        const targetDir = await window.electronAPI.openDirectoryDialog()
        if (!targetDir) return
        
        const res = await window.electronAPI.exportToDocx(roots, targetDir, format)
        
        if (res && res.success) {
             toast.success('导出成功')
             if (res.errors && res.errors.length > 0) {
                 toast.warning(`部分文件导出失败: ${res.errors.length} 个`)
             }
        } else {
             toast.error('导出失败: ' + (res?.message || '未知错误'))
        }
    } catch (e) {
        console.error(e)
        toast.error('导出失败: ' + (e.message || '未知错误'))
    }
  }

  async function onBatchDeleteConfirm(ids, roots) {
      // Logic:
      // 1. If active file is deleted, find adjacent file FIRST.
      // 2. Execute Delete.
      // 3. Update selection.
      
      let nextSelectionId = null
      let shouldReselect = false
      
      if (selectedId) {
          // Check if selectedId or its parent is in roots
          let isDeleted = false
          if (roots.includes(selectedId)) {
              isDeleted = true
          } else {
               let curr = items.find(i => i.id === selectedId)
               while (curr && curr.parent_id) {
                  if (roots.includes(curr.parent_id)) {
                      isDeleted = true
                      break
                  }
                  curr = items.find(i => i.id === curr.parent_id)
               }
          }
          
          if (isDeleted) {
              shouldReselect = true
              // Find adjacent
              const visibleList = []
              const traverse = (nodes) => {
                  for (const node of nodes) {
                      visibleList.push(node)
                      if (node.is_folder && expanded.has(node.id)) {
                          traverse(node.children)
                      }
                  }
              }
              traverse(tree)
              
              const idx = visibleList.findIndex(i => i.id === selectedId)
              if (idx !== -1) {
                  // Strategy: Find the nearest neighbor that is NOT in the delete set.
                  // Backward search
                  for (let i = idx - 1; i >= 0; i--) {
                      const candidate = visibleList[i]
                      if (!isItemDeleted(candidate, roots)) {
                          nextSelectionId = candidate.id
                          break
                      }
                  }
                  // If no prev, Forward search
                  if (!nextSelectionId) {
                      for (let i = idx + 1; i < visibleList.length; i++) {
                          const candidate = visibleList[i]
                          if (!isItemDeleted(candidate, roots)) {
                              nextSelectionId = candidate.id
                              break
                          }
                      }
                  }
              }
          }
      }

      try {
          await api('/api/files/batch-delete', {
              method: 'POST',
              body: JSON.stringify({ ids: roots })
          })
          
          if (shouldReselect) {
              // Immediately unselect current file to close preview/prevent save
              // This is critical: We must ensure App.jsx knows this file is gone.
              // But App.jsx relies on onItemsChanged to detect deletion.
              // However, load() is async.
              // We should explicitly clear selection if we know it's deleted.
              
              // Notify App that the current file is removed from the list
              // This triggers App to add it to deletedIds, preventing auto-save
              if (selectedId) {
                  onItemsChanged?.(items.filter(i => i.id !== selectedId))
              }

              if (nextSelectionId) {
                  const nextItem = items.find(i => i.id === nextSelectionId)
                  onSelect(nextItem, { skipSave: true })
              } else {
                  // Fallback: select nothing or first available after reload
                  onSelect(null, { skipSave: true })
              }
          }

          toast.success(`成功删除 ${ids.length} 个项目`)
          void load()
      } catch (e) {
          console.error(e)
          toast.error('批量删除失败: ' + (e.message || '未知错误'))
          throw e // Re-throw to let dialog know it failed
      }
  }
  
  function isItemDeleted(item, roots) {
      if (roots.includes(item.id)) return true
      let curr = item
      while (curr && curr.parent_id) {
          if (roots.includes(curr.parent_id)) return true
          // We need to look up parent in `items` list because `item` might be from `tree` which has parent ref? 
          // `items` is flat. `tree` nodes usually don't have parent ref, but we have `parent_id`.
          // We need to find the parent object.
          // `items` is available in scope.
          curr = items.find(i => i.id === curr.parent_id)
      }
      return false
  }

  async function importParsedResults(results) {
    if (!Array.isArray(results) || results.length === 0) return

    const loadingMsg = toast.loading(`正在导入 ${results.length} 个文件...`, 0)
    let successCount = 0
    let failCount = 0

    try {
      const { normalizeImportedContent } = await import('~/services/importContent')
      for (const item of results) {
        if (item.error) {
          failCount++
          continue
        }

        try {
          const title = item.title || '未命名'
          const content = normalizeImportedContent(item)

          await api('/api/files', {
            method: 'POST',
            body: JSON.stringify({
              title,
              content,
              is_folder: false,
              parent_id: ''
            })
          })
          successCount++
        } catch (e) {
          console.error(`Import create failed for ${item.title}`, e)
          failCount++
        }
      }
    } finally {
      loadingMsg()
    }

    if (successCount > 0) {
      toast.success(`成功导入 ${successCount} 个文件`)
      void load()
    }
    if (failCount > 0) {
      toast.warning(`${failCount} 个文件导入失败`)
    }
  }

  async function onImport() {
    try {
      const res = await window.electronAPI.importFiles()
      if (!res?.success) {
        if (res?.message) toast.error('导入出错: ' + res.message)
        return
      }
      await importParsedResults(res.results)
    } catch (e) {
      console.error(e)
      toast.error('导入出错: ' + (e.message || '未知错误'))
    }
  }

  async function onSaveAs(id) {
    try {
      const file = await api(`/api/files/${id}`)
      const res = await window.electronAPI?.saveContentAs?.({
        suggestedName: file?.title || 'note.md',
        content: file?.content || '',
      })
      if (res?.canceled) return
      if (!res?.success) {
        throw new Error(res?.message || '写入文件失败')
      }
      toast.success('另存为成功')
    } catch (e) {
      console.error(e)
      toast.error('另存为失败: ' + (e.message || '未知错误'))
    }
  }

  async function togglePin(id, isPinned) {
    try {
      await api.updateFile(id, { is_pinned: isPinned })
      await loadList()
    } catch (e) {
      console.error(e)
      toast.error('置顶操作失败: ' + (e.message || '未知错误'))
    }
  }

  // 优化的删除逻辑
  async function onDeleteCheck(targetId) {
      // Check if we are deleting a selection
      if (selectedIds.has(targetId) && selectedIds.size > 1) {
          void onBatchDeleteCheck()
          return
      }

      const targetItem = items.find(i => i.id === targetId)
      if (!targetItem) return
      
      // Calculate count for recursive delete
      let count = 0
      const countRecursive = (id) => {
          let c = 0
          const children = items.filter(i => i.parent_id === id)
          c += children.length
          children.forEach(child => {
              if (child.is_folder) c += countRecursive(child.id)
          })
          return c
      }
      
      if (targetItem.is_folder) {
          count = countRecursive(targetItem.id)
          setDeleteConfirm({ id: targetId, count, isFolder: true, title: targetItem.title })
      } else {
          setDeleteConfirm({ id: targetId, count: 0, isFolder: false, title: targetItem.title })
      }
      setContextMenu(null)
  }

  async function onDelete(targetId) {
    // Handle Batch Delete
    if (deleteConfirm && deleteConfirm.isBatch) {
        await onBatchDeleteConfirm(deleteConfirm.ids, deleteConfirm.ids)
        setDeleteConfirm(null)
        return
    }

    try {
      // 1. No onBeforeDelete call here anymore to avoid "Unsaved Changes" dialog from App.
      // We handle delete confirmation locally.
      
      const targetItem = items.find(i => i.id === targetId)
      if (!targetItem) return

      const isDeletingSelected = selectedId === targetId
      let isDeletingParentOfSelected = false
      if (!isDeletingSelected && selectedId) {
          let curr = items.find(i => i.id === selectedId)
          while (curr && curr.parent_id) {
              if (curr.parent_id === targetId) {
                  isDeletingParentOfSelected = true
                  break
              }
              curr = items.find(i => i.id === curr.parent_id)
          }
      }

      setLoading(true) // Show loading state (simple progress)
      await api(`/api/files/${targetId}`, { method: 'DELETE' })
      
      const nextItems = items.filter(i => i.id !== targetId && i.parent_id !== targetId) // Simple filter
      
      // Determine next selection
      if (isDeletingSelected || isDeletingParentOfSelected) {
          const nextTree = buildTree(nextItems)
          let nextSelection = null

          // If deleted file was in a folder, try to find next in that folder
          if (targetItem.parent_id) {
              // Note: targetItem.parent_id is still valid in nextItems (folder itself wasn't deleted unless recursive)
              // But if we deleted a folder (recursive), targetItem is that folder.
              // If we deleted a file inside a folder...
              
              // Case 1: Deleted a FILE inside a folder
              if (!targetItem.is_folder) {
                  // Try to find first file in the same folder
                   nextSelection = findFirstFileInFolder(nextTree, targetItem.parent_id)
                   // If found, ensure folder expanded (it should be already if we were selecting a file inside it)
              }
          }
          
          // Fallback (Logic A): Select first file in entire tree
          if (!nextSelection) {
              nextSelection = findFirstFileInTree(nextTree)
          }

          if (nextSelection) {
              // Call onSelect. App.jsx will check unsaved logic.
              // But wait, if we just deleted the file (and set deletedIds via onItemsChanged later),
              // App logic: "if current file deleted, skip save".
              // So we need to ensure App knows it's deleted BEFORE we switch.
              // BUT onItemsChanged is called AFTER we update items state.
              // Here we haven't updated items state yet.
              // So App still thinks current file is valid.
              // If we switch now, App sees unsaved changes on a valid file -> prompts save.
              
              // We want to SKIP save prompt if we are deleting the active file.
              // Strategy:
              // 1. Update items locally first (remove deleted).
              // 2. Call onItemsChanged (App detects deletion and updates deletedIds).
              // 3. Call onSelect (App sees deletedIds and skips save).
              
              // Let's reorder:
              setItems(prev => prev.filter(i => i.id !== targetId))
              // onItemsChanged is triggered by effect? No, FileList doesn't have effect for onItemsChanged.
              // It calls it in load() or specific actions.
              // We should call it here.
              onItemsChanged?.(nextItems)
              
              // NOW call onSelect with skipSave option
              onSelect(nextSelection, { skipSave: true })
          } else {
              setItems(prev => prev.filter(i => i.id !== targetId))
              onItemsChanged?.(nextItems)
              onSelect(null, { skipSave: true })
          }
      } else {
          setItems(prev => prev.filter(i => i.id !== targetId))
          onItemsChanged?.(nextItems)
      }
      
      void load() 
      pushHistory({ type: 'delete', data: { id: targetId } })
    } catch (e) {
      console.error(e)
      toast.error('删除失败: ' + (e.message || '未知错误'))
    } finally {
        setLoading(false)
        setDeleteConfirm(null)
    }
    setContextMenu(null)
  }

  function removeExtension(filename) {
    if (!filename) return filename
    const lastDotIndex = filename.lastIndexOf('.')
    // If no dot or dot is at start (hidden file), return as is
    if (lastDotIndex <= 0) return filename
    return filename.substring(0, lastDotIndex)
  }

  function validateName(n) {
    const illegal = /[\\/:*?"<>|]/
    if (illegal.test(n)) return '名称不能包含 \\/ : * ? " < > |'
    if (n.length > 100) return '名称过长（最多100个字符）'
    return ''
  }
  
  function validateFolderInput(n) {
      // 1. Format Check
      const err = validateName(n)
      if (err) return err
      if (/\.[^.]+$/.test(n)) return '文件夹名称不得包含扩展名'
      
      // 2. Duplicate Check
      // Determine context (Create or Rename)
      let parentId = null
      let currentId = null
      
      if (folderNaming) {
          parentId = targetParentId
      } else if (renaming && renaming.is_folder) {
          parentId = renaming.parent_id
          currentId = renaming.id
      }
      
      // Check against existing folders in the same parent
      const exists = items.some(i => 
          i.is_folder &&
          i.parent_id === parentId &&
          i.id !== currentId &&
          i.title.toLowerCase() === n.toLowerCase()
      )
      
      if (exists) return '文件夹名称已存在，请重新命名'
      
      return ''
  }

  async function onRenameConfirm(id, name, format) {
    try {
      let finalName = name;
      // If we have a fixed format (from isRename mode), append it if missing
      // (Though NameDialog should handle returning clean name, we might need to reconstruct full name)
      // Actually, if isRename is true, NameDialog returns the name part.
      // We need to know the original extension if format is passed?
      // Wait, NameDialog passes `format` if showFormatSelect is true.
      // If showFormatSelect is false (which it is for rename currently, or we will change it?), 
      // we need to handle extension preservation.
      
      // Update: We are adding `isRename` prop to NameDialog.
      // If `isRename` is true, NameDialog will display extension as static text.
      // It should return the name part.
      // We need to append the extension back.
      
      // Let's see how we call NameDialog for rename.
      // We need to pass the extension to NameDialog so it can display it.
      // And NameDialog returns the new name part.
      // So here we need to reconstruct.
      
      // But `onRenameConfirm` signature in `NameDialog` is `(name, format)`.
      // If `isRename` is true, `format` argument might be the extension we passed in?
      // Or we can rely on `renaming` state to get the original extension.
      
      if (renaming && !renaming.is_folder) {
          const dotIndex = renaming.title.lastIndexOf('.')
          const originalExt = dotIndex > 0 ? renaming.title.slice(dotIndex) : ''
          if (originalExt && !finalName.endsWith(originalExt)) {
              finalName += originalExt
          }
      }

      const updated = await api(`/api/files/${id}`, { method: 'PUT', body: JSON.stringify({ title: finalName }) })
      // Push history
      const oldTitle = items.find(i => i.id === id)?.title
      pushHistory({ type: 'rename', data: { id, oldTitle, newTitle: finalName } })

      setItems(prev => prev.map(i => i.id === id ? { ...i, title: updated.title } : i))
      onItemsChanged?.(items)
      setRenaming(null)
    } catch (e) { 
        console.error(e)
        throw e // Rethrow to let NameDialog handle it
    }
  }

  async function onNewFileConfirm(name, format) {
    try {
      let title = name;
      if (format && !title.endsWith(format)) {
          title = title + format;
      } else if (!format && !/\.[a-zA-Z0-9]+$/.test(title)) {
          title = `${title}.md`
      }

      const content = pendingNewFile ? (pendingNewFile.content || '') : ''
      const item = await api('/api/files', { 
          method: 'POST', 
          body: JSON.stringify({ 
              title: title, 
              content: content, 
              is_folder: false, 
              parent_id: targetParentId 
          }) 
      })
      pushHistory({ type: 'create', data: { id: item.id } })
      setItems(prev => [item, ...prev])
      onItemsChanged?.([item, ...items])
      onSelect(item)
      if (targetParentId) {
          setExpanded(prev => new Set([...prev, targetParentId]))
      }
      void load()
    } catch (e) { 
        console.error(e)
        toast.error('新建失败: ' + (e.message || '未知错误'))
        throw e
    }
    setNaming(false)
    setPendingNewFile(null)
  }

  function handleTemplateSelect(template) {
    setShowTemplate(false)
    if (!template) {
      setNaming(true)
      return
    }
    setPendingNewFile(template)
    setNaming(true)
  }

  async function onNewFolderConfirm(name) {
    try {
      const item = await api('/api/files', { 
          method: 'POST', 
          body: JSON.stringify({ 
              title: name, 
              content: '', 
              is_folder: true, 
              parent_id: targetParentId 
          }) 
      })
      pushHistory({ type: 'create', data: { id: item.id } })
      setItems(prev => [item, ...prev])
      onItemsChanged?.([item, ...items])
      if (targetParentId) {
          setExpanded(prev => new Set([...prev, targetParentId]))
      }
      void load()
    } catch (e) { 
        console.error(e)
        throw e
    }
    setFolderNaming(false)
  }

  function toggleExpand(id, e) {
      e?.stopPropagation()
      setExpanded(prev => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
      })
  }

  // --- Drag and Drop Handlers ---

  function checkHierarchy(sourceId, targetId) {
      if (sourceId === targetId) return true
      let curr = items.find(i => i.id === targetId)
      while (curr && curr.parent_id) {
          if (curr.parent_id === sourceId) return true
          curr = items.find(i => i.id === curr.parent_id)
      }
      return false
  }

  async function handleMove(dragged, target, pos) {
    let newParentId = dragged.parent_id
    let newSortOrder = dragged.sort_order

    if (pos === 'inside') {
        newParentId = target.id
        const siblings = items.filter(i => i.parent_id === target.id)
        newSortOrder = siblings.length > 0 
          ? Math.max(...siblings.map(s => s.sort_order || 0)) + 1000 
          : Math.floor(Date.now() / 1000)
        setExpanded(prev => new Set([...prev, target.id]))
    } else {
        newParentId = target.parent_id
        const siblings = items.filter(i => i.parent_id === target.parent_id)
        const targetIndex = siblings.findIndex(s => s.id === target.id)
        if (pos === 'before' && targetIndex > 0) {
          const prevSibling = siblings[targetIndex - 1]
          newSortOrder = Math.floor((prevSibling.sort_order + target.sort_order) / 2)
        } else if (pos === 'after' && targetIndex < siblings.length - 1) {
          const nextSibling = siblings[targetIndex + 1]
          newSortOrder = Math.floor((target.sort_order + nextSibling.sort_order) / 2)
        } else {
          newSortOrder = pos === 'before' ? target.sort_order + 1000 : target.sort_order - 1000
        }
    }

    try {
        await api(`/api/files/${dragged.id}`, {
            method: 'PUT',
            body: JSON.stringify({ parent_id: newParentId, sort_order: newSortOrder })
        })
        
        pushHistory({ 
            type: 'move', 
            data: { 
                id: dragged.id, 
                oldParentId: dragged.parent_id, 
                oldSortOrder: dragged.sort_order,
                newParentId: newParentId,
                newSortOrder: newSortOrder
            } 
        })
        void load()
    } catch (e) {
        console.error(e)
        toast.error(e.message || '移动失败，已还原')
        void load() // Reload to revert UI
    }
  }

  async function handleMoveToRoot(dragged) {
      if (dragged.parent_id === '') return
      
      const siblings = items.filter(i => i.parent_id === '')
      const newSortOrder = siblings.length > 0 
        ? Math.max(...siblings.map(s => s.sort_order || 0)) + 1000 
        : Math.floor(Date.now() / 1000)
      
      try {
          await api(`/api/files/${dragged.id}`, {
              method: 'PUT',
              body: JSON.stringify({ parent_id: '', sort_order: newSortOrder })
          })
           pushHistory({ 
              type: 'move', 
              data: { 
                  id: dragged.id, 
                  oldParentId: dragged.parent_id, 
                  oldSortOrder: dragged.sort_order,
                  newParentId: '',
                  newSortOrder: newSortOrder
              } 
          })
          void load()
      } catch (e) {
          console.error(e)
          toast.error(e.message || '移动失败，已还原')
          void load()
      }
  }

  async function handleNativeFileDrop(files) {
    if (!files || files.length === 0) return

    try {
      const paths = Array.from(files)
        .map(file => window.electronAPI?.getPathForFile?.(file) || file?.path || '')
        .filter(Boolean)

      if (paths.length === 0) {
        toast.warning('无法读取拖入文件路径，请使用“导入文件”')
        return
      }

      const res = await window.electronAPI?.importPaths?.(paths)
      if (!res?.success) {
        throw new Error(res?.message || '解析拖入文件失败')
      }
      await importParsedResults(res.results)
    } catch (e) {
      console.error(e)
      toast.error('拖放导入失败: ' + (e.message || '未知错误'))
    }
  }

   const [, dropContainer] = useDrop({
       accept: [ItemType, NativeTypes.FILE],
       drop: (item, monitor) => {
           if (monitor.didDrop()) return
           
           const itemType = monitor.getItemType()
           if (itemType === ItemType) {
               handleMoveToRoot(item)
           } else if (itemType === NativeTypes.FILE) {
               const dropped = monitor.getItem()
               handleNativeFileDrop(dropped.files)
           }
       }
   })


  function handleContextMenuEvent(e, item) {
    e.preventDefault()
    e.stopPropagation()
    
    // If the item is not in the current selection, select it (single select)
    // unless Ctrl/Shift is pressed? Context menu usually selects the item if not selected.
    // If item IS in selection, keep selection (to allow operation on batch).
    if (!selectedIds.has(item.id)) {
        onSelect(item) // This triggers single selection logic
        // But wait, onSelect might be async or dependent on prop update.
        // For context menu, we might want to force update selectedIds locally?
        // Actually, let's just use the item passed to context menu if it's not selected.
        // But if we want to support "Right click on one of selected -> Delete All",
        // we need to know if it was selected.
    }
    
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  // Unified Batch Delete Check
  async function onBatchDeleteCheck() {
      setShowBatchDelete(true)
  }

  // Update Delete Confirm Dialog to handle batch
  // ...


  function format(ts) {
    const d = new Date(ts * 1000)
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d)
  }

  // 递归渲染树节点
  function renderNode(node, level = 0) {
    const isFolder = node.is_folder
    const isExpanded = expanded.has(node.id)
    const isSelected = selectedId === node.id || selectedIds.has(node.id)
    const isKeyboardFocused = keyboardFocusId === node.id
    
    // Selection State for Folder
    let folderState = 0
    if (isFolder) {
        folderState = getFolderSelectionState(node)
    }
    
    return (
      <React.Fragment key={node.id}>
        <FileNode 
            node={node}
            level={level}
            isSelected={isSelected}
            isKeyboardFocused={isKeyboardFocused}
            isExpanded={isExpanded}
            folderState={folderState}
            onSelect={handleSelect}
            toggleExpand={toggleExpand}
            onContextMenu={handleContextMenuEvent}
            onMove={handleMove}
            checkHierarchy={checkHierarchy}
            removeExtension={removeExtension}
            onRename={(n) => setRenaming(n)}
            onDelete={(n) => onDeleteCheck(n.id)}
        />
        {isFolder && isExpanded && node.children.length > 0 && (
            node.children.map(child => renderNode(child, level + 1))
        )}
        {isFolder && isExpanded && node.children.length === 0 && (
            <div role="presentation" className="empty-folder" style={{ paddingLeft: `${12 + (level + 1) * 16}px` }}>
                (空)
            </div>
        )}
      </React.Fragment>
    )
  }

  return (
    <div className="file-list" ref={dropContainer}>
      <div className="file-library-header">
        <div className="file-library-title-row">
          <div>
            <div className="file-library-eyebrow">资料库</div>
            <div className="file-library-title">我的笔记</div>
          </div>

          <div className="file-library-actions">
            <div className="btn-group file-new-wrap" style={{ position: 'relative' }}>
              <button
                className="btn primary file-new-btn"
                onClick={() => setShowNewMenu(!showNewMenu)}
                title="新建"
                aria-label="新建"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                新建
              </button>
              {showNewMenu && (
                <div className="dropdown-menu file-action-menu" ref={newMenuRef}>
                  <div className="menu-item" onClick={() => onNewFileCheck()}>
                    <span>新建文件</span>
                    <kbd>Ctrl+N</kbd>
                  </div>
                  <div className="menu-item" onClick={() => onNewFolderCheck()}>
                    <span>新建文件夹</span>
                    <kbd>Ctrl+Shift+N</kbd>
                  </div>
                </div>
              )}
            </div>

            <div className="file-more-wrap" ref={libraryMenuRef}>
              <button
                className={`icon-btn file-more-btn${showLibraryMenu ? ' active' : ''}`}
                onClick={() => setShowLibraryMenu(prev => !prev)}
                title="更多资料库操作"
                aria-label="更多资料库操作"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8"/>
                  <circle cx="12" cy="12" r="1.8"/>
                  <circle cx="19" cy="12" r="1.8"/>
                </svg>
              </button>
              {showLibraryMenu && (
                <div className="dropdown-menu file-action-menu file-more-menu">
                  <div className="menu-item" onClick={() => { setShowLibraryMenu(false); void onImport() }}>
                    导入文件
                  </div>
                  <div className="menu-item" onClick={() => { setShowLibraryMenu(false); setShowExport(true) }}>
                    导出…
                  </div>
                  <div className="divider" />
                  <div className="menu-item danger" onClick={() => { setShowLibraryMenu(false); void onBatchDeleteCheck() }}>
                    批量删除{selectedIds.size > 1 ? `（${selectedIds.size}）` : ''}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="file-search-row">
          <div className="file-search-icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <path d="m20 20-4-4"/>
            </svg>
          </div>
          <input
            className="file-search-input"
            placeholder="搜索标题或正文"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void load()
            }}
            aria-label="搜索文件"
          />
          {q && (
            <button
              type="button"
              className="file-search-clear"
              onClick={() => setQ('')}
              aria-label="清除搜索"
              title="清除搜索"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <div className="placeholder">加载中…</div>
      ) : (
        <div
          ref={treeListRef}
          className="list tree-list"
          role="tree"
          tabIndex={0}
          aria-label="文件树"
          aria-multiselectable="true"
          aria-activedescendant={keyboardFocusId ? `file-tree-item-${keyboardFocusId}` : undefined}
          onFocus={() => {
            if (!keyboardFocusId && visibleNodes.length) {
              focusTreeItem(selectedId || visibleNodes[0].id)
            }
          }}
          onKeyDown={handleTreeKeyDown}
          onMouseDown={() => treeListRef.current?.focus({ preventScroll: true })}
        >
          {tree.map(node => renderNode(node))}
          {tree.length === 0 && (
            q ? (
              <div className="empty-state search-empty">
                <div className="empty-icon">🔍</div>
                <div className="empty-title">未找到匹配的文件</div>
                <div className="empty-desc">尝试使用其他关键词搜索</div>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">📝</div>
                <div className="empty-title">暂无文件</div>
                <div className="empty-desc">开始创建你的第一篇笔记吧</div>
                <div className="empty-actions">
                  <button className="btn primary" onClick={() => onNewFileCheck()}>新建文件</button>
                  <button className="btn" onClick={() => onNewFolderCheck()}>新建文件夹</button>
                </div>
                <div className="empty-tips">
                  <div>快捷键：Ctrl+N 新建文件 · Ctrl+Shift+N 新建文件夹</div>
                  <div>支持拖拽导入本地文件</div>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
          <div 
            className="context-menu" 
            ref={contextMenuRef}
            style={{ top: contextMenu.y, left: contextMenu.x, position: 'fixed', zIndex: 200 }}
          >
              {contextMenu.item.is_folder && (
                  <>
                    <div className="menu-item" onClick={() => onNewFileCheck(contextMenu.item.id)}>在此新建文件</div>
                    <div className="menu-item" onClick={() => onNewFolderCheck(contextMenu.item.id)}>在此新建文件夹</div>
                    <div className="divider"></div>
                  </>
              )}
              <div className="menu-item" onClick={() => { togglePin(contextMenu.item.id, !contextMenu.item.is_pinned); setContextMenu(null) }}>
                  {contextMenu.item.is_pinned ? '取消置顶' : '置顶'}
              </div>
              <div className="menu-item" onClick={() => { setRenaming(contextMenu.item); setContextMenu(null) }}>重命名</div>
              {!contextMenu.item.is_folder && (
                  <div className="menu-item" onClick={() => { void onSaveAs(contextMenu.item.id); setContextMenu(null) }}>另存为</div>
              )}
              <div className="menu-item danger" onClick={() => onDeleteCheck(contextMenu.item.id)}>删除</div>
          </div>
      )}

      {deleteConfirm && (
          <div className="modal-overlay">
              <div className="modal">
                  <div className="modal-title">{deleteConfirm.isBatch ? '批量删除确认' : '删除确认'}</div>
                  <div className="modal-message">
                      {deleteConfirm.isBatch ? (
                          <>
                              确定要删除选中的 {deleteConfirm.count} 个项目吗？
                              <div style={{ marginTop: 8, color: '#ef4444' }}>
                                  ⚠️ 此操作不可恢复！
                              </div>
                          </>
                      ) : (
                          <>
                              确定要删除 {deleteConfirm.isFolder ? '文件夹' : '文件'} "{deleteConfirm.title}" 吗？
                              {deleteConfirm.isFolder && (
                                  <div style={{ marginTop: 8, color: '#ef4444' }}>
                                      ⚠️ 将同时删除其中包含的 {deleteConfirm.count} 个项目！
                                  </div>
                              )}
                          </>
                      )}
                  </div>
                  <div className="modal-actions">
                      <button className="btn" onClick={() => setDeleteConfirm(null)}>取消</button>
                      <button className="btn danger" onClick={() => onDelete(deleteConfirm.id)}>删除</button>
                  </div>
              </div>
          </div>
      )}

      <React.Suspense fallback={null}>
      {naming && (
        <NameDialog
          defaultName={'未命名'}
          title={'新建文件'}
          message={'请输入文件名（不包含扩展名）：'}
          validate={validateName}
          onConfirm={onNewFileConfirm}
          onCancel={() => setNaming(false)}
          showFormatSelect={true}
          currentPathLabel={getPathLabel(targetParentId)}
          onPathSelect={() => setShowFolderSelector(true)}
        />
      )}
      {folderNaming && (
        <NameDialog
          defaultName={'新建文件夹'}
          title={'新建文件夹'}
          message={'请输入文件夹名称：'}
          validate={validateFolderInput}
          onConfirm={onNewFolderConfirm}
          onCancel={() => setFolderNaming(false)}
          currentPathLabel={getPathLabel(targetParentId)}
          onPathSelect={() => setShowFolderSelector(true)}
        />
      )}
      {showExport && <FileSelectorDialog open={showExport} onClose={() => setShowExport(false)} items={items} onConfirm={onExportConfirm} title="导出文件" confirmText="开始导出" />}
      {showBatchDelete && <FileSelectorDialog open={showBatchDelete} onClose={() => setShowBatchDelete(false)} items={items} onConfirm={onBatchDeleteConfirm} title="批量删除" confirmText="删除" processingText="删除中..." showDeleteWarning={true} selectedFileId={selectedId} initialSelectedIds={Array.from(selectedIds)} />}
      {showTemplate && <TemplateSelector open={showTemplate} onClose={() => setShowTemplate(false)} onSelect={handleTemplateSelect} />}
      {showFolderSelector && (
          <FileSelectorDialog 
              open={showFolderSelector}
              onClose={() => setShowFolderSelector(false)}
              items={items}
              title="选择目标文件夹"
              confirmText="确定"
              mode="single-folder"
              initialSelectedIds={targetParentId ? [targetParentId] : []}
              onConfirm={(ids) => {
                  setTargetParentId(ids[0] || '')
                  // No need to close explicitly here as FileSelectorDialog closes itself? 
                  // But we need to ensure local state updates.
              }}
          />
      )}
      {renaming && (
        <NameDialog
          defaultName={renaming.title}
          title={renaming.is_folder ? '重命名文件夹' : '重命名文件'}
          message={`当前名称：${renaming.title}`}
          validate={renaming.is_folder ? validateFolderInput : validateName}
          onConfirm={(name) => onRenameConfirm(renaming.id, name)}
          onCancel={() => setRenaming(null)}
          isRename={!renaming.is_folder}
        />
      )}
      </React.Suspense>
      <style>{`
          .tree-list .list-item.drag-inside { background: var(--clay-light); border: 2px dashed var(--clay); border-radius: 4px; }
          .tree-list .list-item.drag-before { border-top: 3px solid var(--clay); margin-top: -1px; position: relative; }
          .tree-list .list-item.drag-after { border-bottom: 3px solid var(--clay); margin-bottom: -1px; position: relative; }
          .tree-list .list-item.drag-before::before,
          .tree-list .list-item.drag-after::after {
              content: '';
              position: absolute;
              left: 0;
              right: 0;
              height: 3px;
              background: var(--clay);
              box-shadow: 0 0 10px var(--clay-medium);
          }
          .tree-list .list-item.drag-before::before { top: -3px; }
          .tree-list .list-item.drag-after::after { bottom: -3px; }
      `}</style>
    </div>
  )
}
