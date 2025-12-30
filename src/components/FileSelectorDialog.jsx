import React, { useState, useEffect, useMemo } from 'react';

const FolderIcon = ({ expanded }) => expanded ? '📂' : '📁';
const FileIcon = () => '📄';

/**
 * File Selector Dialog Component
 * 
 * @param {Object} props
 * @param {boolean} props.open - Whether the dialog is open
 * @param {function} props.onClose - Callback when dialog is closed
 * @param {Array<Object>} props.items - List of file/folder items
 * @param {string} props.items[].id - Unique ID
 * @param {string} props.items[].title - File name
 * @param {boolean} props.items[].is_folder - Is folder
 * @param {string} props.items[].parent_id - Parent folder ID
 * @param {function} props.onConfirm - Callback when confirm button is clicked. Receives (allSelectedIds, rootIds).
 * @param {string} [props.title] - Dialog title
 * @param {string} [props.confirmText] - Confirm button text
 * @param {string} [props.processingText] - Text to show while processing
 * @param {boolean} [props.showDeleteWarning] - Whether to show warning if active file is selected
 * @param {string} [props.selectedFileId] - ID of the currently active file (for warning)
 */
export default function FileSelectorDialog({ 
    open, 
    onClose, 
    items, 
    onConfirm, 
    title = '选择内容', 
    confirmText = '确定', 
    processingText = '处理中...', 
    showDeleteWarning = false, 
    selectedFileId = null, 
    initialSelectedIds = [],
    mode = 'multi' // 'multi' | 'single-folder'
}) {
    const [selectedIds, setSelectedIds] = useState(new Set(initialSelectedIds));
    const [expandedIds, setExpandedIds] = useState(new Set());
    const [processing, setProcessing] = useState(false);
    const [lastClickedId, setLastClickedId] = useState(null);
    const [singleSelectedId, setSingleSelectedId] = useState(initialSelectedIds[0] || null);

    // ... tree and useEffect ...

    // Build tree from items
    const tree = useMemo(() => {
        const map = {};
        const roots = [];
        
        // Filter items based on mode
        let nodes = items;
        if (mode === 'single-folder') {
            nodes = items.filter(i => i.is_folder);
        }
        
        // Deep copy items to avoid mutation issues
        nodes = nodes.map(i => ({ ...i, children: [] }));
        
        nodes.forEach(i => map[i.id] = i);
        
        nodes.forEach(i => {
            if (i.parent_id && map[i.parent_id]) {
                map[i.parent_id].children.push(i);
            } else {
                roots.push(i);
            }
        });

        const sortFn = (a, b) => (b.sort_order ?? 0) - (a.sort_order ?? 0);
        const sortRecursive = (list) => {
            list.sort(sortFn);
            list.forEach(n => sortRecursive(n.children));
        };
        sortRecursive(roots);
        return roots;
    }, [items]);

    // Flatten visible items for Shift-Selection
    const visibleFlatList = useMemo(() => {
        const list = [];
        const traverse = (nodes) => {
            for (const node of nodes) {
                list.push(node);
                if (node.is_folder && expandedIds.has(node.id)) {
                    traverse(node.children);
                }
            }
        };
        traverse(tree);
        return list;
    }, [tree, expandedIds]);

    useEffect(() => {
        if (open) {
            if (mode === 'single-folder') {
                setSingleSelectedId(initialSelectedIds[0] || '');
                setExpandedIds(new Set()); 
            } else {
                // Filter out selectedFileId from initial selection if it exists
                const initialSet = new Set(initialSelectedIds);
                if (selectedFileId && initialSet.has(selectedFileId)) {
                    initialSet.delete(selectedFileId);
                }
                setSelectedIds(initialSet);
                setExpandedIds(new Set());
            }
            setProcessing(false);
            setLastClickedId(null);
        }
        // Remove initialSelectedIds from dependency to avoid loop if parent passes new array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, mode, selectedFileId]);

    if (!open) return null;

    const handleExpand = (id, e) => {
        e.stopPropagation();
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedIds(next);
    };
    
    // Efficient descendant lookup
    const descendantsMap = useMemo(() => {
        if (mode === 'single-folder') return {}; // Not needed
        const map = {};
        const compute = (node) => {
            let ids = [node.id];
            node.children.forEach(child => {
                ids = ids.concat(compute(child));
            });
            map[node.id] = ids;
            return ids;
        };
        tree.forEach(compute);
        return map;
    }, [tree, mode]);

    // Check if node contains selectedFileId (for disabling parent folders)
    const containsSelectedFile = useMemo(() => {
        if (!selectedFileId || mode === 'single-folder') return new Set();
        const set = new Set();
        Object.entries(descendantsMap).forEach(([id, descendants]) => {
            if (descendants.includes(selectedFileId)) {
                set.add(id);
            }
        });
        return set;
    }, [descendantsMap, selectedFileId, mode]);

    /**
     * Handle item selection
     * @param {Object} node - The file/folder node
     * @param {boolean} checked - Target checked state
     * @param {Object} e - Event object
     */
    const handleSelect = (node, checked, e) => {
        if (mode === 'single-folder') {
            setSingleSelectedId(node.id);
            return;
        }

        // Prevent selection if it's the current file or contains it
        if (node.id === selectedFileId || containsSelectedFile.has(node.id)) return;

        const next = new Set(selectedIds);
        const ids = descendantsMap[node.id] || [node.id];
        
        // Handle Shift Selection
        if (e && e.shiftKey && lastClickedId) {
            const lastIdx = visibleFlatList.findIndex(n => n.id === lastClickedId);
            const currIdx = visibleFlatList.findIndex(n => n.id === node.id);
            
            if (lastIdx !== -1 && currIdx !== -1) {
                const start = Math.min(lastIdx, currIdx);
                const end = Math.max(lastIdx, currIdx);
                const range = visibleFlatList.slice(start, end + 1);
                
                range.forEach(n => {
                    // Skip disabled items
                    if (n.id === selectedFileId || containsSelectedFile.has(n.id)) return;

                    const subIds = descendantsMap[n.id] || [n.id];
                    subIds.forEach(id => {
                        // Also check subIds for disabled state
                        if (id === selectedFileId || containsSelectedFile.has(id)) return;

                        if (checked) next.add(id);
                        else next.delete(id);
                    });
                });
            }
        } else {
            // Normal Selection
            if (checked) {
                ids.forEach(id => {
                    if (id !== selectedFileId && !containsSelectedFile.has(id)) next.add(id);
                });
            } else {
                ids.forEach(id => next.delete(id));
            }
        }
        
        setSelectedIds(next);
        setLastClickedId(node.id);
    };

    const handleSelectAll = () => {
        // Exclude selectedFileId and its parents from total count
        const selectableItems = items.filter(i => i.id !== selectedFileId && !containsSelectedFile.has(i.id));
        
        // Check if all *selectable* items are selected
        const allSelectableSelected = selectableItems.length > 0 && selectableItems.every(i => selectedIds.has(i.id));

        if (allSelectableSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(selectableItems.map(i => i.id)));
        }
    };
    
    // Check state for button text
    const selectableCount = items.filter(i => i.id !== selectedFileId && !containsSelectedFile.has(i.id)).length;
    const isAllSelected = selectableCount > 0 && selectedIds.size === selectableCount;



    const handleConfirmAction = async () => {
        if (mode === 'single-folder') {
             setProcessing(true);
             try {
                 await onConfirm([singleSelectedId], [singleSelectedId]);
                 onClose();
             } catch (e) { console.error(e) } 
             finally { setProcessing(false) }
             return;
        }

        if (selectedIds.size === 0) return;
        setProcessing(true);
        try {
            // Logic to filter duplicates or handle recursive selection depends on use case.
            // ... (roots logic) ...
            
            const roots = [];
            // Filter out any accidentally selected disabled items
            const finalIds = Array.from(selectedIds).filter(id => id !== selectedFileId && !containsSelectedFile.has(id));
            const allSelected = new Set(finalIds);
            const itemMap = {};
            items.forEach(i => itemMap[i.id] = i);
            
            allSelected.forEach(id => {
                let curr = itemMap[id];
                let parentSelected = false;
                while (curr && curr.parent_id) {
                    if (allSelected.has(curr.parent_id)) {
                        parentSelected = true;
                        break;
                    }
                    curr = itemMap[curr.parent_id];
                }
                if (!parentSelected) {
                    roots.push(id);
                }
            });
            
            // We pass both: array of all selected IDs, and optimized roots
            await onConfirm(finalIds, roots);
            onClose();
        } catch (e) {
            console.error(e);
            // Don't close dialog on error
        } finally {
            setProcessing(false);
        }
    };

    // Recursive render
    const renderNode = (node, level = 0) => {
        const isExpanded = expandedIds.has(node.id);
        
        if (mode === 'single-folder') {
             const isChecked = singleSelectedId === node.id;
             return (
                 <div key={node.id}>
                    <div 
                        className={`tree-item ${isChecked ? 'selected' : ''}`}
                        style={{ paddingLeft: level * 20 + 10 }}
                        onClick={(e) => handleSelect(node, true, e)}
                    >
                        <span 
                            className="toggle" 
                            onClick={(e) => { e.stopPropagation(); node.is_folder && handleExpand(node.id, e); }}
                            style={{ visibility: node.is_folder ? 'visible' : 'hidden' }}
                        >
                            {isExpanded ? '▼' : '▶'}
                        </span>
                        <span className="icon"><FolderIcon expanded={isExpanded} /></span>
                        <span className="title">{node.title}</span>
                    </div>
                    {node.is_folder && isExpanded && (
                        <div>
                            {node.children.map(child => renderNode(child, level + 1))}
                        </div>
                    )}
                 </div>
             )
        }

        const isChecked = selectedIds.has(node.id);
        const isCurrent = node.id === selectedFileId;
        const isDisabled = isCurrent || containsSelectedFile.has(node.id);
        
        let allChildrenSelected = true;
        let someChildrenSelected = false;
        
        if (node.is_folder) {
             const childIds = descendantsMap[node.id].filter(id => id !== node.id);
             // For checkbox logic, we only care about selectable children
             const selectableChildIds = childIds.filter(id => id !== selectedFileId && !containsSelectedFile.has(id));
             
             if (selectableChildIds.length === 0) {
                 // If no selectable children, check self if not disabled
                 // If disabled, it's effectively unchecked for UI purposes (or irrelevant)
                 allChildrenSelected = isDisabled ? false : selectedIds.has(node.id);
                 someChildrenSelected = isDisabled ? false : selectedIds.has(node.id);
             } else {
                 let count = 0;
                 selectableChildIds.forEach(id => {
                     if (selectedIds.has(id)) count++;
                 });
                 allChildrenSelected = count === selectableChildIds.length;
                 someChildrenSelected = count > 0;
             }
        } else {
            allChildrenSelected = selectedIds.has(node.id);
            someChildrenSelected = selectedIds.has(node.id);
        }

        let tooltip = node.title;
        if (isCurrent) {
            tooltip = "当前文件正在阅读中，无法删除";
        } else if (isDisabled) {
            tooltip = "该文件夹包含正在阅读的文件，无法删除";
        }

        return (
            <div key={node.id}>
                <div 
                    className={`tree-item ${isDisabled ? 'disabled' : ''}`} 
                    style={{ 
                        paddingLeft: level * 20 + 10,
                        color: isDisabled ? '#CCCCCC' : 'inherit',
                        cursor: isDisabled ? 'not-allowed' : 'default'
                    }}
                    title={tooltip}
                >
                    <span 
                        className="toggle" 
                        onClick={(e) => node.is_folder && handleExpand(node.id, e)}
                        style={{ visibility: node.is_folder ? 'visible' : 'hidden' }}
                    >
                        {isExpanded ? '▼' : '▶'}
                    </span>
                    <input 
                        type="checkbox" 
                        checked={allChildrenSelected}
                        disabled={isDisabled}
                        ref={el => el && (el.indeterminate = someChildrenSelected && !allChildrenSelected)}
                        onChange={(e) => handleSelect(node, e.target.checked, e.nativeEvent)}
                    />
                    <span className="icon">{node.is_folder ? <FolderIcon expanded={isExpanded} /> : <FileIcon />}</span>
                    <span className="title">{node.title}</span>
                </div>
                {node.is_folder && isExpanded && (
                    <div>
                        {node.children.map(child => renderNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="modal-overlay">
            <div className="modal" style={{ width: 500, maxWidth: '90vw' }}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    <div className="toolbar">
                        <button className="btn small" onClick={handleSelectAll}>
                            {isAllSelected ? '取消全选' : '全选'}
                        </button>
                        <span className="counter">已选择 {selectedIds.size} 项</span>
                    </div>
                    <div className="tree-container">
                        {mode === 'single-folder' && (
                            <div 
                                className={`tree-item ${singleSelectedId === '' ? 'selected' : ''}`}
                                style={{ paddingLeft: 10 }}
                                onClick={() => setSingleSelectedId('')}
                            >
                                <span className="toggle" style={{ visibility: 'hidden' }}></span>
                                <span className="icon">🏠</span>
                                <span className="title">根目录</span>
                            </div>
                        )}
                        {tree.map(node => renderNode(node))}
                    </div>
                </div>
                <div className="modal-footer">
                    {processing && <span className="loading-text">{processingText}</span>}
                    <div className="btn-group">
                        <button className="btn" onClick={onClose}>取消</button>
                        <button className="btn primary" onClick={handleConfirmAction} disabled={processing || (mode !== 'single-folder' && selectedIds.size === 0)}>
                            {processing && <span className="spinner"></span>}
                            {confirmText}
                        </button>
                    </div>
                </div>
            </div>
            <style>{`
                .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
                .modal-header h3 { margin: 0; }
                .close-btn { background: none; border: none; font-size: 20px; cursor: pointer; }
                .modal-body .toolbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1px solid #eee; margin-bottom: 8px; }
                .tree-container { max-height: 60vh; overflow-y: auto; border: 1px solid #eee; border-radius: 4px; }
                .tree-item { display: flex; align-items: center; padding: 4px 0; gap: 6px; cursor: default; }
                .tree-item:hover { background: rgba(0,0,0,0.04); }
                .tree-item.disabled:hover { background: transparent; }
                .tree-item.selected { background: rgba(126, 91, 239, 0.1); color: var(--accent); }
                .tree-item .toggle { cursor: pointer; width: 16px; text-align: center; font-size: 10px; color: var(--muted, #666); }
                .tree-item input { cursor: pointer; }
                .tree-item input:disabled { cursor: not-allowed; opacity: 0.5; }
                .loading-text { margin-right: 12px; color: #666; }
                .btn.small { height: 28px; padding: 0 8px; font-size: 12px; }
                .modal-footer { 
                    display: flex; 
                    align-items: center; 
                    margin-top: 16px; 
                    position: relative;
                    justify-content: end;
                }
                .modal-footer .btn-group {
                    display: flex;
                    gap: 12px; 
                }
                .modal-footer .loading-text {
                    position: absolute;
                    left: 0;
                }
                .spinner {
                    display: inline-block;
                    width: 12px;
                    height: 12px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-radius: 50%;
                    border-top-color: #fff;
                    animation: spin 1s ease-in-out infinite;
                    margin-right: 8px;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
}
