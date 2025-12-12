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
export default function FileSelectorDialog({ open, onClose, items, onConfirm, title = '选择内容', confirmText = '确定', processingText = '处理中...', showDeleteWarning = false, selectedFileId = null, initialSelectedIds = [] }) {
    const [selectedIds, setSelectedIds] = useState(new Set(initialSelectedIds));
    const [expandedIds, setExpandedIds] = useState(new Set());
    const [processing, setProcessing] = useState(false);
    const [lastClickedId, setLastClickedId] = useState(null);

    // ... tree and useEffect ...

    // Check if active file is in selection
    const isActiveFileSelected = useMemo(() => {
        if (!showDeleteWarning || !selectedFileId) return false;
        
        // Helper to check if id is in selection or if any ancestor is in selection
        const check = (id) => {
             if (selectedIds.has(id)) return true;
             const item = items.find(i => i.id === id);
             if (item && item.parent_id) return check(item.parent_id);
             return false;
        };
        return check(selectedFileId);
    }, [selectedIds, selectedFileId, items, showDeleteWarning]);

    // Build tree from items
    const tree = useMemo(() => {
        const map = {};
        const roots = [];
        // Deep copy items to avoid mutation issues
        const nodes = items.map(i => ({ ...i, children: [] }));
        
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
            setSelectedIds(new Set(initialSelectedIds));
            setExpandedIds(new Set());
            setProcessing(false);
            setLastClickedId(null);
        }
    }, [open, initialSelectedIds]);

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
    }, [tree]);

    /**
     * Handle item selection
     * @param {Object} node - The file/folder node
     * @param {boolean} checked - Target checked state
     * @param {Object} e - Event object
     */
    const handleSelect = (node, checked, e) => {
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
                
                // If checking, add all in range
                // If unchecking, remove all in range (usually Shift+Click means select range)
                // Standard behavior: Set all in range to 'checked'
                
                range.forEach(n => {
                    // Also include descendants if it's a folder? 
                    // Usually list selection selects the item itself. 
                    // But here we have recursive selection logic.
                    // Let's apply recursive selection to each item in range.
                    const subIds = descendantsMap[n.id] || [n.id];
                    subIds.forEach(id => {
                        if (checked) next.add(id);
                        else next.delete(id);
                    });
                });
            }
        } else {
            // Normal Selection
            if (checked) {
                ids.forEach(id => next.add(id));
            } else {
                ids.forEach(id => next.delete(id));
            }
        }
        
        setSelectedIds(next);
        setLastClickedId(node.id);
    };

    const handleSelectAll = () => {
        if (selectedIds.size === items.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(items.map(i => i.id)));
        }
    };


    const handleConfirmAction = async () => {
        if (selectedIds.size === 0) return;
        setProcessing(true);
        try {
            // Logic to filter duplicates or handle recursive selection depends on use case.
            // ... (roots logic) ...
            
            const roots = [];
            const allSelected = new Set(selectedIds);
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
            await onConfirm(Array.from(selectedIds), roots);
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
        const isChecked = selectedIds.has(node.id);
        
        let allChildrenSelected = true;
        let someChildrenSelected = false;
        
        if (node.is_folder) {
             const childIds = descendantsMap[node.id].filter(id => id !== node.id);
             if (childIds.length === 0) {
                 allChildrenSelected = selectedIds.has(node.id);
                 someChildrenSelected = selectedIds.has(node.id);
             } else {
                 let count = 0;
                 childIds.forEach(id => {
                     if (selectedIds.has(id)) count++;
                 });
                 allChildrenSelected = count === childIds.length;
                 someChildrenSelected = count > 0;
             }
        } else {
            allChildrenSelected = selectedIds.has(node.id);
            someChildrenSelected = selectedIds.has(node.id);
        }

        return (
            <div key={node.id}>
                <div className="tree-item" style={{ paddingLeft: level * 20 + 10 }}>
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
                            {selectedIds.size === items.length && items.length > 0 ? '取消全选' : '全选'}
                        </button>
                        <span className="counter">已选择 {selectedIds.size} 项</span>
                    </div>
                    <div className="tree-container">
                        {tree.map(node => renderNode(node))}
                    </div>
                    {showDeleteWarning && isActiveFileSelected && (
                        <div className="warning-box" style={{ marginTop: 8, padding: 8, background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4, color: '#cf1322', fontSize: 13 }}>
                            ⚠️ 注意：当前正在浏览的文件包含在删除列表中，删除后将自动关闭。
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    {processing && <span className="loading-text">{processingText}</span>}
                    <button className="btn" onClick={onClose}>取消</button>
                    <button className="btn primary" onClick={handleConfirmAction} disabled={processing || selectedIds.size === 0}>
                        {processing && <span className="spinner"></span>}
                        {confirmText}
                    </button>
                </div>
            </div>
            <style>{`
                .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
                .modal-header h3 { margin: 0; }
                .close-btn { background: none; border: none; font-size: 20px; cursor: pointer; }
                .modal-body .toolbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1px solid #eee; margin-bottom: 8px; }
                .tree-container { max-height: 400px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px; }
                .tree-item { display: flex; align-items: center; padding: 4px 0; gap: 6px; cursor: default; }
                .tree-item:hover { background: #f5f5f5; }
                .tree-item .toggle { cursor: pointer; width: 16px; text-align: center; font-size: 10px; color: #666; }
                .tree-item input { cursor: pointer; }
                .loading-text { margin-right: 12px; color: #666; }
                .btn.small { height: 28px; padding: 0 8px; font-size: 12px; }
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
