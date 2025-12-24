import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, $isNodeSelection } from 'lexical';
import { $isTableNode, $isTableRowNode, $isTableCellNode, TableCellNode, TableNode } from '@lexical/table';
import { createPortal } from 'react-dom';

// 颜色预设
const BACKGROUND_COLORS = [
  { hex: '', label: '无颜色' },
  { hex: '#f2f3f5', label: '灰色' },
  { hex: '#fff3cd', label: '黄色' },
  { hex: '#d1e7dd', label: '绿色' },
  { hex: '#f8d7da', label: '红色' },
  { hex: '#cff4fc', label: '蓝色' },
];

export default function TableActionMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [menuPosition, setMenuPosition] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [tableInfo, setTableInfo] = useState(null);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  const updateMenu = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        setMenuPosition(null);
        return;
      }

      const anchor = selection.anchor;
      const node = anchor.getNode();
      
      let cell = node;
      while (cell && !$isTableCellNode(cell)) {
        cell = cell.getParent();
      }

      if ($isTableCellNode(cell)) {
        const dom = editor.getElementByKey(cell.getKey());
        if (dom) {
          const rect = dom.getBoundingClientRect();
          const container = document.querySelector('.editor-container');
          if (!container) return;
          const rootRect = container.getBoundingClientRect();
          
          // Calculate position relative to container
          // 使用 scrollTop/scrollLeft 确保位置是相对于内容的固定坐标
          // 这样即使容器滚动，因为按钮在容器内，且坐标是内容坐标，它会随内容自然移动，无需更新 JS
          const top = rect.top - rootRect.top + container.scrollTop;
          const right = rect.right - rootRect.left + container.scrollLeft;
          
          setMenuPosition({ top, right });
          
          const row = cell.getParent();
          const table = row.getParent();
          
          let tIndex = 0;
          const tableDom = editor.getElementByKey(table.getKey());
          const allTables = Array.from(container.querySelectorAll('table'));
          tIndex = allTables.indexOf(tableDom);
          
          const rowIndex = row.getIndexWithinParent();
          const colIndex = cell.getIndexWithinParent();
          
          setTableInfo({ 
            tIndex, 
            ri: rowIndex, 
            ci: colIndex,
            tableKey: table.getKey(),
            rowKey: row.getKey(),
            cellKey: cell.getKey()
          });
          return;
        }
      }
      
      setMenuPosition(null);
      setIsMenuOpen(false);
    });
  }, [editor]);

  useEffect(() => {
    const removeUpdate = editor.registerUpdateListener(({ editorState }) => {
      updateMenu();
    });
    
    window.addEventListener('resize', updateMenu);
    // document.addEventListener('scroll', updateMenu, true); // 移除 scroll 监听，因为使用内容坐标后不需要实时更新

    return () => {
      removeUpdate();
      window.removeEventListener('resize', updateMenu);
      // document.removeEventListener('scroll', updateMenu, true);
    };
  }, [editor, updateMenu]);

  // Handle click outside
  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && 
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const dispatch = (type, payload) => {
    let detailPayload = { ...tableInfo };
    if (typeof payload === 'object' && payload !== null) {
      Object.assign(detailPayload, payload);
    } else if (payload !== undefined) {
      detailPayload.value = payload;
    }
    const event = new CustomEvent('tableAction', { 
      detail: { type, payload: detailPayload } 
    });
    window.dispatchEvent(event);
    setIsMenuOpen(false);
  };

  if (!menuPosition) return null;

  return createPortal(
    <>
      <div 
        ref={buttonRef}
        className="table-action-menu-trigger"
        style={{
          position: 'absolute',
          top: menuPosition.top + 5,
          left: menuPosition.right - 20,
        }}
        onClick={() => setIsMenuOpen(!isMenuOpen)}
      >
        ▼
      </div>
      
      {isMenuOpen && (
        <TableActionMenu 
          menuRef={menuRef}
          pos={menuPosition}
          dispatch={dispatch}
        />
      )}
    </>,
    document.querySelector('.editor-container') || document.body
  );
}

function TableActionMenu({ menuRef, pos, dispatch }) {
  const [subMenu, setSubMenu] = useState(null); // 'bg', 'align'

  useEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const container = document.querySelector('.editor-container');
      const rootRect = container ? container.getBoundingClientRect() : document.body.getBoundingClientRect();

      // Check if menu goes below container/viewport
      if (rect.bottom > rootRect.bottom) {
        // Move menu up
        // Default top is pos.top + 30
        // We want new bottom to be pos.top
        const newTop = pos.top - rect.height;
        menu.style.top = `${newTop}px`;
      }
    }
  }, [pos]);

  return (
    <div 
      ref={menuRef}
      className="table-action-menu"
      style={{
        position: 'absolute',
        top: pos.top + 30,
        left: pos.right - 180, // 向左偏移以完整显示
        width: 200,
        maxHeight: 300, // 限制最大高度
        overflowY: 'auto', // 允许内容滚动
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 样式操作 */}
      <div className="table-action-menu-group">
        <MenuItem 
          label="背景颜色" 
          hasSubMenu 
          active={subMenu === 'bg'}
          onClick={() => setSubMenu(subMenu === 'bg' ? null : 'bg')}
        />
        {subMenu === 'bg' && (
          <div className="table-action-submenu">
            {BACKGROUND_COLORS.map(c => (
              <div 
                key={c.label} 
                className="color-item" 
                style={{ backgroundColor: c.hex || '#fff', border: c.hex ? 'none' : '1px solid #ddd' }} 
                title={c.label}
                onClick={() => dispatch('background', c.hex)}
              />
            ))}
          </div>
        )}
        
        <MenuItem onClick={() => dispatch('toggleRowStriping')} label="切换隔行变色" />
        
        <MenuItem 
          label="垂直对齐" 
          hasSubMenu
          active={subMenu === 'align'}
          onClick={() => setSubMenu(subMenu === 'align' ? null : 'align')}
        />
        {subMenu === 'align' && (
          <div className="table-action-submenu-list">
             <MenuItem onClick={() => dispatch('alignVertical', 'top')} label="顶部对齐" />
             <MenuItem onClick={() => dispatch('alignVertical', 'middle')} label="居中对齐" />
             <MenuItem onClick={() => dispatch('alignVertical', 'bottom')} label="底部对齐" />
          </div>
        )}

        <MenuItem onClick={() => dispatch('toggleFrozenRow')} label="冻结首行" />
        <MenuItem onClick={() => dispatch('toggleFrozenColumn')} label="冻结首列" />
      </div>

      <div className="table-action-menu-divider" />

      {/* 插入操作 */}
      <div className="table-action-menu-group">
        <MenuItem onClick={() => dispatch('insertRowAbove', { mode: 'above' })} label="在上方插入行" />
        <MenuItem onClick={() => dispatch('insertRowBelow', { mode: 'below' })} label="在下方插入行" />
        <MenuItem onClick={() => dispatch('insertColLeft', { mode: 'left' })} label="在左侧插入列" />
        <MenuItem onClick={() => dispatch('insertColRight', { mode: 'right' })} label="在右侧插入列" />
      </div>

      <div className="table-action-menu-divider" />

      {/* 删除操作 */}
      <div className="table-action-menu-group">
        <MenuItem onClick={() => dispatch('deleteCol')} label="删除列" />
        <MenuItem onClick={() => dispatch('deleteRow')} label="删除行" />
        <MenuItem onClick={() => dispatch('deleteTable')} label="删除表格" />
      </div>

      <div className="table-action-menu-divider" />
      
      {/* 单元格操作 */}
      <div className="table-action-menu-group">
        <MenuItem onClick={() => dispatch('mergeCells')} label="合并单元格" />
        <MenuItem onClick={() => dispatch('splitCells')} label="拆分单元格" />
        <MenuItem onClick={() => dispatch('clear')} label="清除内容" />
      </div>

      <div className="table-action-menu-divider" />

      {/* 表头操作 */}
      <div className="table-action-menu-group">
        <MenuItem onClick={() => dispatch('toggleRowHeader')} label="添加/移除 行表头" />
        <MenuItem onClick={() => dispatch('toggleColumnHeader')} label="添加/移除 列表头" />
      </div>
    </div>
  );
}

function MenuItem({ label, onClick, hasSubMenu, active }) {
  return (
    <div 
      className={`table-action-menu-item ${active ? 'active' : ''}`} 
      onClick={onClick}
    >
      <span style={{ flex: 1 }}>{label}</span>
      {hasSubMenu && <span className="arrow">›</span>}
    </div>
  );
}
