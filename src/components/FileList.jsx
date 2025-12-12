import React, { useEffect, useState, useMemo, useRef } from 'react'
import { api } from '~/services/api'
import NameDialog from './NameDialog'
import FileSelectorDialog from './FileSelectorDialog'
import { useDrag, useDrop } from 'react-dnd'
import { NativeTypes } from 'react-dnd-html5-backend'
import { message } from 'antd'

const ItemType = 'FILE_NODE'

const FileNode = ({ 
    node, 
    level, 
    isSelected, 
    isExpanded, 
    folderState, 
    onSelect, 
    toggleExpand, 
    onContextMenu, 
    onMove,
    checkHierarchy,
    removeExtension
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
                message.error('操作无效：不能将文件夹移动到自身子目录', 3)
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
        <li 
            ref={ref}
            className={`list-item level-${level}${isSelected ? ' active' : ''}${node.is_folder ? ' folder' : ''} ${isDragging ? 'dragging' : ''} ${dragClass}`} 
            onClick={(e) => onSelect(node, e)}
            onContextMenu={(e) => onContextMenu(e, node)}
            style={{ paddingLeft: `${12 + level * 16}px`, opacity: isDragging ? 0.5 : 1 }}
        >
          <div className="icon">
              {node.is_folder ? (
                  isExpanded ? '📂' : '📁'
              ) : (
                  '📄'
              )}
              {node.is_folder && folderState > 0 && (
                  <span className="selection-indicator">
                      {folderState === 2 ? '☑️' : '⊟'}
                  </span>
              )}
          </div>
          <div className="info">
            <div className="title" title={node.title}>
                {node.is_folder ? node.title : removeExtension(node.title)}
                {node.is_folder && <span className="count"> ({node.fileCount})</span>}
            </div>
          </div>
        </li>
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
  const [contextMenu, setContextMenu] = useState(null) // 右键菜单 { x, y, item }
  const [targetParentId, setTargetParentId] = useState('') // 新建时的目标父目录ID
  
  const [selectedIds, setSelectedIds] = useState(new Set()) // Multi-select state

  // Sync selectedId (prop) with selectedIds
  useEffect(() => {
      // Always sync internal selection with prop, ensuring UI reflects Active Editor state.
      if (selectedId) {
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
  
  function pushHistory(action) {
      historyRef.current.undo.push(action)
      historyRef.current.redo = [] // clear redo on new action
  }
  
  async function performUndo() {
      const action = historyRef.current.undo.pop()
      if (!action) return
      
      try {
          switch (action.type) {
              case 'delete':
                  // Restore: Create again with same ID/Content (backend support needed? or just create new)
                  // Ideally we use "restore" API if soft delete is used.
                  // Since we implemented soft delete, we can "undelete".
                  // But our delete API is soft delete now. We need a restore API.
                  // For now, let's implement a 'restore' endpoint or just update is_deleted=0
                   await api(`/api/files/${action.data.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ is_deleted: false })
                  })
                  break
              case 'create':
                  // Undo create -> delete
                   await api(`/api/files/${action.data.id}`, { method: 'DELETE' })
                  break
              case 'rename':
                   await api(`/api/files/${action.data.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ title: action.data.oldTitle })
                  })
                  break
              case 'move':
                   await api(`/api/files/${action.data.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ parent_id: action.data.oldParentId, sort_order: action.data.oldSortOrder })
                  })
                  break
          }
          historyRef.current.redo.push(action)
          void load()
      } catch (e) {
          console.error("Undo failed", e)
          historyRef.current.undo.push(action) // put back
      }
  }

  async function performRedo() {
      const action = historyRef.current.redo.pop()
      if (!action) return

      try {
           switch (action.type) {
              case 'delete':
                  await api(`/api/files/${action.data.id}`, { method: 'DELETE' })
                  break
              case 'create':
                  // Redo create: we deleted it in undo. We need to restore it.
                  await api(`/api/files/${action.data.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ is_deleted: false })
                  })
                  break
              case 'rename':
                   await api(`/api/files/${action.data.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ title: action.data.newTitle })
                  })
                  break
              case 'move':
                   await api(`/api/files/${action.data.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ parent_id: action.data.newParentId, sort_order: action.data.newSortOrder })
                  })
                  break
          }
          historyRef.current.undo.push(action)
          void load()
      } catch (e) {
          console.error("Redo failed", e)
          historyRef.current.redo.push(action)
      }
  }

  // Keyboard shortcut for Undo/Redo
  useEffect(() => {
      function handleUndoRedo(e) {
          if (e.ctrlKey && e.key === 'z') {
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
    void load()
    
    function handleClickOutside(e) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target)) {
        setShowNewMenu(false)
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items]) // 依赖 items 只是为了确保最新状态，虽然这里主要是触发弹窗

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
  function buildTree(flatItems) {
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
          // if (a.is_folder !== b.is_folder) return b.is_folder ? 1 : -1
          return (b.sort_order ?? 0) - (a.sort_order ?? 0)
      }
      
      const sortRecursive = (nodes) => {
          nodes.sort(sortFn)
          nodes.forEach(n => sortRecursive(n.children))
      }
      sortRecursive(roots)
      return roots
  }

  // Helper to find the first file (DFS)
  function findFirstFileInTree(nodes) {
      for (const node of nodes) {
          if (!node.is_folder) return node
          const found = findFirstFileInTree(node.children)
          if (found) return found
      }
      return null
  }
  
  // Helper to find first file in a specific folder (by ID)
  function findFirstFileInFolder(tree, folderId) {
      // Find the folder node first
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

  async function load(retryCount = 0) {
    setLoading(true)
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : ''
      const list = await api(`/api/files${qs}`)
      setItems(list)
      onItemsChanged?.(list)
      
      // Ensure selection
      if (!selectedId && list.length > 0) {
          const tree = buildTree(list)
          const first = findFirstFileInTree(tree)
          if (first) onSelect(first)
      }
    } catch (e) {
      console.error(e)
      if (retryCount < 3) {
          console.log(`Load failed, retrying (${retryCount + 1}/3)...`)
          setTimeout(() => load(retryCount + 1), 1000)
      } else {
          message.error('加载文件列表失败，请手动刷新')
      }
    } finally {
      setLoading(false)
    }
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

  async function onNewFileCheck(parentId = '') {
    try {
      const ok = await (onBeforeNew?.() ?? true)
      if (!ok) return
      setTargetParentId(parentId)
      setNaming(true)
      setShowNewMenu(false)
      setContextMenu(null)
    } catch (e) { console.error(e) }
  }

  async function onNewFolderCheck(parentId = '') {
    try {
      setTargetParentId(parentId)
      setFolderNaming(true)
      setShowNewMenu(false)
      setContextMenu(null)
    } catch (e) { console.error(e) }
  }

  async function onExportConfirm(ids, roots) {
    try {
        const targetDir = await window.electronAPI.openDirectoryDialog()
        if (!targetDir) return
        
        // Use Electron main process export logic (Node.js)
        const res = await window.electronAPI.exportToDocx(roots, targetDir)
        
        if (res && res.success) {
             message.success('导出成功')
             if (res.errors && res.errors.length > 0) {
                 message.warning(`部分文件导出失败: ${res.errors.length} 个`)
             }
        } else {
             message.error('导出失败: ' + (res?.message || '未知错误'))
        }
    } catch (e) {
        console.error(e)
        message.error('导出失败: ' + (e.message || '未知错误'))
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
              
              if (nextSelectionId) {
                  const nextItem = items.find(i => i.id === nextSelectionId)
                  onSelect(nextItem, { skipSave: true })
              } else {
                  // Fallback: select nothing or first available after reload
                  onSelect(null, { skipSave: true })
              }
          }

          message.success(`成功删除 ${ids.length} 个项目`)
          void load()
      } catch (e) {
          console.error(e)
          message.error('批量删除失败: ' + (e.message || '未知错误'))
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

  async function onImport() {
    try {
      const res = await window.electronAPI.importFiles()
      if (!res || !res.success || !res.results || res.results.length === 0) return
      
      const results = res.results
      const loadingMsg = message.loading(`正在导入 ${results.length} 个文件...`, 0)
      
      let successCount = 0
      let failCount = 0
      
      for (const item of results) {
          if (item.error) {
              failCount++
              continue
          }
          try {
              // Use default title if empty
              const title = item.title || '未命名'
              
              await api('/api/files', {
                  method: 'POST',
                  body: JSON.stringify({
                      title: title,
                      content: item.content || '',
                      is_folder: false,
                      parent_id: '' // Import to root by default
                  })
              })
              successCount++
          } catch (e) {
              console.error(`Import create failed for ${item.title}`, e)
              failCount++
          }
      }
      
      loadingMsg() // Close loading
      
      if (successCount > 0) {
          message.success(`成功导入 ${successCount} 个文件`)
          void load()
      }
      if (failCount > 0) {
          message.warning(`${failCount} 个文件导入失败`)
      }
    } catch (e) { 
        console.error(e)
        message.error('导入出错')
    }
  }

  async function onSaveAs(id) {
    try {
      const path = await window.electronAPI.saveFileDialog()
      if (!path) return
      await api(`/api/files/${id}/save-as`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
    } catch (e) { console.error(e) }
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

  async function onRenameConfirm(id, name) {
    try {
      const updated = await api(`/api/files/${id}`, { method: 'PUT', body: JSON.stringify({ title: name }) })
      // Push history
      const oldTitle = items.find(i => i.id === id)?.title
      pushHistory({ type: 'rename', data: { id, oldTitle, newTitle: name } })

      setItems(prev => prev.map(i => i.id === id ? { ...i, title: updated.title } : i))
      onItemsChanged?.(items)
      setRenaming(null)
    } catch (e) { console.error(e) }
  }

  async function onNewFileConfirm(name) {
    try {
      // Add default extension if missing (since NameDialog no longer auto-appends)
      const title = /\.[a-zA-Z0-9]+$/.test(name) ? name : `${name}.md`

      const item = await api('/api/files', { 
          method: 'POST', 
          body: JSON.stringify({ 
              title: title, 
              content: '', 
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
    } catch (e) { console.error(e) }
    setNaming(false)
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
    } catch (e) { console.error(e) }
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
        newSortOrder = Date.now() / 1000 + 1000
        setExpanded(prev => new Set([...prev, target.id]))
    } else {
        newParentId = target.parent_id
        const baseOrder = target.sort_order || 0
        newSortOrder = pos === 'before' ? baseOrder + 1 : baseOrder - 1
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
        message.error(e.message || '移动失败，已还原')
        void load() // Reload to revert UI
    }
  }

  async function handleMoveToRoot(dragged) {
      if (dragged.parent_id === '') return
      
      const newSortOrder = Date.now() / 1000 + 1000
      
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
          message.error(e.message || '移动失败，已还原')
          void load()
      }
  }

  async function handleNativeFileDrop(files) {
       if (!files || files.length === 0) return
       
       const paths = []
       for (let i = 0; i < files.length; i++) {
           if (files[i].path) paths.push(files[i].path)
       }
       
       if (paths.length > 0) {
           try {
               await api('/api/files/import', {
                  method: 'POST',
                  body: JSON.stringify({ paths, encoding: 'utf-8' }),
                })
                void load()
           } catch (e) { console.error(e) }
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
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  // 递归渲染树节点
  function renderNode(node, level = 0) {
    const isFolder = node.is_folder
    const isExpanded = expanded.has(node.id)
    const isSelected = selectedId === node.id || selectedIds.has(node.id)
    
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
            isExpanded={isExpanded}
            folderState={folderState}
            onSelect={handleSelect}
            toggleExpand={toggleExpand}
            onContextMenu={handleContextMenuEvent}
            onMove={handleMove}
            checkHierarchy={checkHierarchy}
            removeExtension={removeExtension}
        />
        {isFolder && isExpanded && node.children.length > 0 && (
            node.children.map(child => renderNode(child, level + 1))
        )}
        {isFolder && isExpanded && node.children.length === 0 && (
            <li className="empty-folder" style={{ paddingLeft: `${12 + (level + 1) * 16}px` }}>
                (空)
            </li>
        )}
      </React.Fragment>
    )
  }

  return (
    <div className="file-list" ref={dropContainer}>
      <div className="toolbar colored">
        <div className="btn-group" style={{ position: 'relative' }}>
            <button className="btn primary" onClick={() => setShowNewMenu(!showNewMenu)}>
                新建 ▾
            </button>
            {showNewMenu && (
                <div className="dropdown-menu" ref={newMenuRef} style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100 }}>
                    <div className="menu-item" onClick={() => onNewFileCheck('')}>新建文件 (Ctrl+N)</div>
                    <div className="menu-item" onClick={() => onNewFolderCheck('')}>新建文件夹 (Ctrl+Shift+N)</div>
                </div>
            )}
        </div>
        <button className="btn" onClick={onImport}>导入</button>
        <button className="btn" onClick={() => setShowExport(true)}>导出</button>
        <button className="btn danger" onClick={() => void onBatchDeleteCheck()}>批量删除</button>
        <div className="search-box">
          <input className="input" placeholder="搜索..." value={q} onChange={e => setQ(e.target.value)} />
          <button className="btn" onClick={() => void load()}>🔍</button>
        </div>
      </div>
      {loading ? (
        <div className="placeholder">加载中…</div>
      ) : (
        <ul className="list tree-list">
          {tree.map(node => renderNode(node))}
          {tree.length === 0 && <div className="placeholder">暂无文件</div>}
        </ul>
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
                      <button className="btn danger" onClick={() => void onDelete(deleteConfirm.id)}>删除</button>
                  </div>
              </div>
          </div>
      )}

      {naming && (
        <NameDialog
          defaultName={'未命名.md'}
          title={'新建文件'}
          message={'请输入文件名（可包含扩展名）：'}
          validate={validateName}
          onConfirm={onNewFileConfirm}
          onCancel={() => setNaming(false)}
          showFormatSelect={true}
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
        />
      )}
      {showExport && <FileSelectorDialog open={showExport} onClose={() => setShowExport(false)} items={items} onConfirm={onExportConfirm} title="导出文件" confirmText="开始导出" />}
      {showBatchDelete && <FileSelectorDialog open={showBatchDelete} onClose={() => setShowBatchDelete(false)} items={items} onConfirm={onBatchDeleteConfirm} title="批量删除" confirmText="删除" processingText="删除中..." showDeleteWarning={true} selectedFileId={selectedId} initialSelectedIds={Array.from(selectedIds)} />}
      {renaming && (
        <NameDialog
          defaultName={renaming.title}
          title={renaming.is_folder ? '重命名文件夹' : '重命名文件'}
          message={`当前名称：${renaming.title}`}
          validate={renaming.is_folder ? validateFolderInput : validateName}
          onConfirm={(name) => void onRenameConfirm(renaming.id, name)}
          onCancel={() => setRenaming(null)}
        />
      )}
      <style>{`
          .tree-list .list-item {
              display: flex; align-items: center; gap: 8px;
              padding: 8px 12px; cursor: pointer;
              user-select: none;
              border-bottom: 1px solid rgba(0,0,0,0.03);
              border-top: 2px solid transparent; /* for drag-before */
              border-bottom: 2px solid transparent; /* for drag-after */
          }
          .tree-list .list-item:hover { background: rgba(0,0,0,0.03); }
          .tree-list .list-item.active { background: rgba(126, 91, 239, 0.1); color: var(--accent); }
          .tree-list .list-item .icon { font-size: 16px; min-width: 20px; text-align: center; }
          .tree-list .list-item .info { flex: 1; min-width: 0; }
          .tree-list .list-item .title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .tree-list .list-item .count { color: var(--muted); font-size: 12px; }
          .tree-list .empty-folder { font-size: 12px; color: var(--muted); padding: 8px 12px; font-style: italic; }
          
          /* Drag Styles */
          .tree-list .list-item.dragging { opacity: 0.5; background: #f0f0f0; }
          .tree-list .list-item.drag-inside { background: rgba(126, 91, 239, 0.2); border: 1px dashed var(--accent); }
          .tree-list .list-item.drag-before { border-top: 2px solid var(--accent); }
          .tree-list .list-item.drag-after { border-bottom: 2px solid var(--accent); }

          .dropdown-menu, .context-menu {
              background: var(--panel);
              border: 1px solid rgba(0,0,0,0.1);
              box-shadow: 0 4px 12px rgba(0,0,0,0.15);
              border-radius: 6px;
              padding: 4px 0;
              min-width: 140px;
          }
          .menu-item {
              padding: 6px 16px;
              font-size: 13px;
              cursor: pointer;
              color: var(--fg);
          }
          .menu-item:hover { background: var(--accent); color: #fff; }
          .menu-item.danger { color: #ef4444; }
          .menu-item.danger:hover { background: #ef4444; color: #fff; }
          .divider { height: 1px; background: rgba(0,0,0,0.1); margin: 4px 0; }
      `}</style>
    </div>
  )
}
