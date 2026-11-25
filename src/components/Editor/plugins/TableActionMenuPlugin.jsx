import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $setSelection, $isRangeSelection } from 'lexical'
import { $isTableCellNode } from '@lexical/table'
import { createPortal } from 'react-dom'
import { UiButton } from '~/components/ui/ControlKit'
import { useEditorWriteScope } from '../hooks/useEditorWriteScope'
import { $resolveTableCell } from '../utils/tableModel'
import { dispatchTableEvent, isTableEventForEditor } from '../utils/tableEvents'

const BACKGROUND_COLORS = [
  { hex: '', label: '无背景' },
  { hex: '#f2f3f5', label: '灰色' },
  { hex: '#fff3cd', label: '黄色' },
  { hex: '#d1e7dd', label: '绿色' },
  { hex: '#f8d7da', label: '红色' },
  { hex: '#cff4fc', label: '蓝色' },
]

export default function TableActionMenuPlugin({ documentId }) {
  const [editor] = useLexicalComposerContext()
  const beginWrite = useEditorWriteScope(editor, documentId)
  const [menuPosition, setMenuPosition] = useState(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [tableInfo, setTableInfo] = useState(null)
  const menuRef = useRef(null), buttonRef = useRef(null), openedRef = useRef(null)
  const close = useCallback((restoreFocus = false) => {
    openedRef.current = null
    setIsMenuOpen(false)
    if (restoreFocus && editor.isEditable()) buttonRef.current?.focus()
  }, [editor])

  const updateMenu = useCallback(() => {
    if (!editor.isEditable()) {
      close(); setMenuPosition(null); setTableInfo(null)
      return
    }
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      let cell = $isRangeSelection(selection) ? selection.anchor.getNode() : null
      while (cell && !$isTableCellNode(cell)) cell = cell.getParent()
      let current = cell ? $resolveTableCell(cell.getKey()) : null
      const opened = openedRef.current
      if (opened) {
        current = $resolveTableCell(opened.info.cellKey, opened.info.tableKey)
        if (!current || !opened.canWrite() || current.model.signature !== opened.signature) { close(); current = null }
      }
      const root = editor.getRootElement(), container = root?.closest('.editor-container')
      const dom = current && editor.getElementByKey(current.cell.getKey())
      if (!current || !dom || !container || !root.contains(dom)) {
        setMenuPosition(null); setTableInfo(null); close()
        return
      }
      const box = dom.getBoundingClientRect(), host = container.getBoundingClientRect()
      setMenuPosition({
        top: box.top - host.top + container.scrollTop,
        right: box.right - host.left + container.scrollLeft,
      })
      setTableInfo({
        ri: current.rowIndex, ci: current.columnIndex, tableKey: current.table.getKey(),
        rowKey: current.row.getKey(), cellKey: current.cell.getKey(),
      })
    })
  }, [editor, close])

  useLayoutEffect(() => {
    close(); setTableInfo(null); setMenuPosition(null)
    const unregister = editor.registerEditableListener(updateMenu)
    return () => { openedRef.current = null; unregister() }
  }, [editor, documentId, close, updateMenu])
  useEffect(() => {
    let detach = () => {}
    const unregister = editor.registerUpdateListener(updateMenu)
    const unregisterRoot = editor.registerRootListener(root => {
      detach()
      const container = root?.closest('.editor-container')
      container?.addEventListener('scroll', updateMenu, true)
      detach = () => container?.removeEventListener('scroll', updateMenu, true)
      updateMenu()
    })
    window.addEventListener('resize', updateMenu)
    return () => { unregister(); unregisterRoot(); detach(); window.removeEventListener('resize', updateMenu) }
  }, [editor, updateMenu])
  useEffect(() => {
    const onPointerDown = event => {
      if (openedRef.current && !menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) close()
    }
    const onMode = event => {
      if (isTableEventForEditor(editor, event)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('tableSelection:mode', onMode)
    return () => { document.removeEventListener('mousedown', onPointerDown); window.removeEventListener('tableSelection:mode', onMode) }
  }, [editor, close])

  const open = () => {
    if (openedRef.current) { close(); return }
    const canWrite = beginWrite()
    if (!canWrite() || !tableInfo) return
    let signature
    editor.getEditorState().read(() => { signature = $resolveTableCell(tableInfo.cellKey, tableInfo.tableKey)?.model.signature })
    if (!signature) return
    let retainedSelection = null
    editor.read('latest', () => { retainedSelection = $getSelection()?.clone() || null })
    openedRef.current = { info: tableInfo, signature, canWrite, retainedSelection }
    setIsMenuOpen(true)
  }
  const validMenu = () => {
    const opened = openedRef.current
    if (!opened?.canWrite()) { close(); return null }
    let valid = false
    editor.getEditorState().read(() => {
      const current = $resolveTableCell(opened.info.cellKey, opened.info.tableKey)
      valid = !!current && current.model.signature === opened.signature
    })
    if (!valid) { close(); return null }
    return opened.info
  }
  const enterSelectionMode = () => {
    const opened = openedRef.current
    if (!validMenu() || !opened) return
    // The menu autofocuses its first item. Preserve the actual Lexical
    // selection before that focus change and restore it after closing; merely
    // focusing the root cannot recover a selection already cleared by blur.
    close()
    editor.update(() => {
      if (opened.retainedSelection) $setSelection(opened.retainedSelection.clone())
    }, { discrete: true })
    if (editor.isEditable()) editor.focus()
    dispatchTableEvent(editor, 'tableSelection:mode', true)
  }
  const dispatch = (type, payload) => {
    const info = validMenu()
    if (!info) return
    const detailPayload = { ...info }
    if (typeof payload === 'object' && payload !== null) Object.assign(detailPayload, payload)
    else if (payload !== undefined) detailPayload.value = payload
    // Close before the synchronous update so an action cannot retarget an open
    // menu to the neighbour selected by a row/column removal.
    close()
    dispatchTableEvent(editor, 'tableAction', { type, payload: detailPayload })
    if (editor.isEditable()) editor.focus()
  }
  if (!menuPosition || !tableInfo || !editor.isEditable()) return null
  const portalTarget = editor.getRootElement()?.closest('.editor-container')
  if (!portalTarget) return null
  return createPortal(
    <>
      <UiButton density="compact" ref={buttonRef} type="button" className="table-action-menu-trigger"
        style={{ position: 'absolute', top: menuPosition.top + 5, left: menuPosition.right - 27 }}
        onMouseDown={event => event.preventDefault()} onClick={open}
        aria-label="表格单元格操作" aria-expanded={isMenuOpen} aria-haspopup="menu" title="表格操作">···</UiButton>
      {isMenuOpen && <TableActionMenu menuRef={menuRef} buttonRef={buttonRef} pos={menuPosition} dispatch={dispatch} enterSelectionMode={enterSelectionMode} close={close} />}
    </>, portalTarget,
  )
}

function TableActionMenu({ menuRef, buttonRef, pos, dispatch, enterSelectionMode, close }) {
  useLayoutEffect(() => {
    menuRef.current?.querySelector('button:not(:disabled)')?.focus()
  }, [menuRef])
  useLayoutEffect(() => {
    const menu = menuRef.current, container = menu?.closest('.editor-container')
    if (!menu || !container) return
    const host = container.getBoundingClientRect(), viewHeight = window.innerHeight || host.height
    const top = Math.max(host.top, 0), bottom = Math.min(host.bottom, viewHeight)
    const height = Math.max(40, bottom - top - 16)
    menu.style.setProperty('--table-menu-available-height', height + 'px')
    const box = menu.getBoundingClientRect()
    const minTop = top - host.top + container.scrollTop + 8
    const maxTop = bottom - host.top + container.scrollTop - box.height - 8
    const desired = pos.top + 34 <= maxTop ? pos.top + 34 : pos.top - box.height - 6
    menu.style.top = Math.max(minTop, Math.min(desired, maxTop)) + 'px'
    const left = Math.max(host.left, 0) - host.left + container.scrollLeft + 8
    const right = Math.min(host.right, window.innerWidth || host.right) - host.left + container.scrollLeft - box.width - 8
    menu.style.left = Math.max(left, Math.min(pos.right - 238, right)) + 'px'
  }, [menuRef, pos])
  const onKeyDown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
    const buttons = [...menuRef.current.querySelectorAll('button:not(:disabled)')]
    const index = buttons.indexOf(document.activeElement)
    let next
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
    if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = buttons.length - 1
    if (next !== undefined) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus() }
  }
  return (
    <div ref={menuRef} className="table-action-menu product-table-menu" role="menu" aria-label="表格操作"
      style={{ position: 'absolute', top: pos.top + 34, left: Math.max(8, pos.right - 238) }}
      onMouseDown={event => event.stopPropagation()} onKeyDown={onKeyDown}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !buttonRef.current?.contains(event.relatedTarget)) close() }}>
      <MenuSection label="行与列">
        <MenuItem onClick={() => dispatch('insertRowAbove', { mode: 'above' })} label="上方插入行" />
        <MenuItem onClick={() => dispatch('insertRowBelow', { mode: 'below' })} label="下方插入行" />
        <MenuItem onClick={() => dispatch('moveRowUp')} label="当前行上移" />
        <MenuItem onClick={() => dispatch('moveRowDown')} label="当前行下移" />
        <MenuItem onClick={() => dispatch('insertColLeft', { mode: 'left' })} label="左侧插入列" />
        <MenuItem onClick={() => dispatch('insertColRight', { mode: 'right' })} label="右侧插入列" />
        <MenuItem onClick={() => dispatch('moveColLeft')} label="当前列左移" />
        <MenuItem onClick={() => dispatch('moveColRight')} label="当前列右移" />
      </MenuSection>
      <MenuSection label="单元格">
        <MenuItem onClick={enterSelectionMode} label="多选单元格…" />
        <MenuItem onClick={() => dispatch('mergeCells')} label="合并所选单元格" />
        <MenuItem onClick={() => dispatch('splitCells')} label="拆分单元格" />
        <MenuItem onClick={() => dispatch('clear')} label="清空内容" />
      </MenuSection>
      <MenuSection label="样式">
        <div className="table-color-palette" aria-label="单元格背景">
          {BACKGROUND_COLORS.map(color => <UiButton density="compact" type="button" key={color.label}
            className={'table-color-swatch' + (!color.hex ? ' clear' : '')} style={{ '--table-swatch': color.hex || 'transparent' }}
            title={color.label} aria-label={color.label} onClick={() => dispatch('background', color.hex)} />)}
        </div>
        <div className="table-action-row">
          <UiButton density="compact" type="button" onClick={() => dispatch('alignVertical', 'top')}>上对齐</UiButton>
          <UiButton density="compact" type="button" onClick={() => dispatch('alignVertical', 'middle')}>居中</UiButton>
          <UiButton density="compact" type="button" onClick={() => dispatch('alignVertical', 'bottom')}>下对齐</UiButton>
        </div>
        <MenuItem onClick={() => dispatch('toggleRowStriping')} label="隔行底色" />
        <MenuItem onClick={() => dispatch('toggleRowHeader')} label="切换首行表头" />
        <MenuItem onClick={() => dispatch('toggleColumnHeader')} label="切换首列表头" />
      </MenuSection>
      <MenuSection label="固定">
        <MenuItem onClick={() => dispatch('toggleFrozenRow')} label="固定首行" />
        <MenuItem onClick={() => dispatch('toggleFrozenColumn')} label="固定首列" />
      </MenuSection>
      <MenuSection>
        <MenuItem danger onClick={() => dispatch('deleteRow')} label="删除当前行" />
        <MenuItem danger onClick={() => dispatch('deleteCol')} label="删除当前列" />
        <MenuItem danger onClick={() => dispatch('deleteTable')} label="删除整个表格" />
      </MenuSection>
    </div>
  )
}
function MenuSection({ label, children }) {
  return <div className="product-table-menu-section">{label && <div className="product-table-menu-label">{label}</div>}{children}</div>
}
function MenuItem({ label, onClick, danger = false }) {
  return <UiButton density="compact" type="button" className={'table-action-menu-item' + (danger ? ' danger' : '')} onClick={onClick} role="menuitem"><span>{label}</span></UiButton>
}
