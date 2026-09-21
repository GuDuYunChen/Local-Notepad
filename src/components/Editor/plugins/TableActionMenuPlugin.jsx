import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection } from 'lexical'
import { $isTableCellNode } from '@lexical/table'
import { createPortal } from 'react-dom'

const BACKGROUND_COLORS = [
  { hex: '', label: '无背景' },
  { hex: '#f2f3f5', label: '灰色' },
  { hex: '#fff3cd', label: '黄色' },
  { hex: '#d1e7dd', label: '绿色' },
  { hex: '#f8d7da', label: '红色' },
  { hex: '#cff4fc', label: '蓝色' },
]

export default function TableActionMenuPlugin() {
  const [editor] = useLexicalComposerContext()
  const [menuPosition, setMenuPosition] = useState(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [tableInfo, setTableInfo] = useState(null)
  const menuRef = useRef(null)
  const buttonRef = useRef(null)

  const updateMenu = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        setMenuPosition(null)
        setIsMenuOpen(false)
        return
      }

      let cell = selection.anchor.getNode()
      while (cell && !$isTableCellNode(cell)) cell = cell.getParent?.()

      if (!$isTableCellNode(cell)) {
        setMenuPosition(null)
        setIsMenuOpen(false)
        return
      }

      const cellDom = editor.getElementByKey(cell.getKey())
      const container = editor.getRootElement()?.closest('.editor-container')
      if (!cellDom || !container) return

      const rect = cellDom.getBoundingClientRect()
      const rootRect = container.getBoundingClientRect()
      const row = cell.getParent()
      const table = row?.getParent()

      if (!row || !table) return

      setMenuPosition({
        top: rect.top - rootRect.top + container.scrollTop,
        right: rect.right - rootRect.left + container.scrollLeft,
      })

      setTableInfo({
        ri: row.getIndexWithinParent(),
        ci: cell.getIndexWithinParent(),
        tableKey: table.getKey(),
        rowKey: row.getKey(),
        cellKey: cell.getKey(),
      })
    })
  }, [editor])

  useEffect(() => {
    const unregister = editor.registerUpdateListener(updateMenu)
    const container = editor.getRootElement()?.closest('.editor-container')

    window.addEventListener('resize', updateMenu)
    container?.addEventListener('scroll', updateMenu, { passive: true })

    return () => {
      unregister()
      window.removeEventListener('resize', updateMenu)
      container?.removeEventListener('scroll', updateMenu)
    }
  }, [editor, updateMenu])

  useEffect(() => {
    const onPointerDown = (event) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const enterSelectionMode = () => {
    window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true }))
    setIsMenuOpen(false)
  }

  const dispatch = (type, payload) => {
    const detailPayload = { ...tableInfo }

    if (typeof payload === 'object' && payload !== null) {
      Object.assign(detailPayload, payload)
    } else if (payload !== undefined) {
      detailPayload.value = payload
    }

    window.dispatchEvent(new CustomEvent('tableAction', {
      detail: {
        type,
        payload: detailPayload,
      },
    }))

    setIsMenuOpen(false)
  }

  if (!menuPosition || !tableInfo) return null

  const portalTarget = editor.getRootElement()?.closest('.editor-container') || document.body

  return createPortal(
    <>
      <button
        ref={buttonRef}
        type="button"
        className="table-action-menu-trigger"
        style={{
          position: 'absolute',
          top: menuPosition.top + 5,
          left: menuPosition.right - 27,
        }}
        onClick={() => setIsMenuOpen(prev => !prev)}
        aria-label="表格单元格操作"
        aria-expanded={isMenuOpen}
        title="表格操作"
      >
        ···
      </button>

      {isMenuOpen && (
        <TableActionMenu
          menuRef={menuRef}
          pos={menuPosition}
          dispatch={dispatch}
        />
      )}
    </>,
    portalTarget
  )
}

function TableActionMenu({ menuRef, pos, dispatch }) {
  useEffect(() => {
    if (!menuRef.current) return

    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const container = menu.closest('.editor-container')
    const rootRect = container?.getBoundingClientRect()

    if (rootRect && rect.bottom > rootRect.bottom - 8) {
      menu.style.top = `${Math.max(8, pos.top - rect.height - 6)}px`
    }
  }, [menuRef, pos])

  return (
    <div
      ref={menuRef}
      className="table-action-menu product-table-menu"
      role="menu"
      aria-label="表格操作"
      style={{
        position: 'absolute',
        top: pos.top + 34,
        left: Math.max(8, pos.right - 238),
      }}
      onMouseDown={event => event.stopPropagation()}
    >
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
          {BACKGROUND_COLORS.map(color => (
            <button
              type="button"
              key={color.label}
              className={`table-color-swatch${!color.hex ? ' clear' : ''}`}
              style={{ '--table-swatch': color.hex || 'transparent' }}
              title={color.label}
              aria-label={color.label}
              onClick={() => dispatch('background', color.hex)}
            />
          ))}
        </div>

        <div className="table-action-row">
          <button type="button" onClick={() => dispatch('alignVertical', 'top')}>上对齐</button>
          <button type="button" onClick={() => dispatch('alignVertical', 'middle')}>居中</button>
          <button type="button" onClick={() => dispatch('alignVertical', 'bottom')}>下对齐</button>
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
  return (
    <div className="product-table-menu-section">
      {label && <div className="product-table-menu-label">{label}</div>}
      {children}
    </div>
  )
}

function MenuItem({ label, onClick, danger = false }) {
  return (
    <button
      type="button"
      className={`table-action-menu-item${danger ? ' danger' : ''}`}
      onClick={onClick}
      role="menuitem"
    >
      <span>{label}</span>
    </button>
  )
}
