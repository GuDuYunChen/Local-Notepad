import React, { useState, useEffect, useMemo } from 'react';

const Icon = ({ children, size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
    </svg>
);

const FolderIcon = ({ expanded }) => (
    <Icon>
        <path d="M3 6h7l2 2h9v11H3z" />
        {expanded && <path d="M3 11h18" />}
    </Icon>
);

const FileIcon = () => (
    <Icon>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M15 3v4h4" />
    </Icon>
);

const ChevronIcon = ({ expanded }) => (
    <Icon size={13}>
        <path d={expanded ? 'm7 9 5 5 5-5' : 'm9 7 5 5-5 5'} />
    </Icon>
);

const HomeIcon = () => (
    <Icon>
        <path d="m4 11 8-7 8 7" />
        <path d="M6 10v10h12V10M10 20v-6h4v6" />
    </Icon>
);

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
    processingText = '处理中…', 
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

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape' && !processing) onClose?.();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, processing, onClose]);

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

    // Flatten all items that are actually present in the tree structure (visible in UI context)
    // This handles the case where items might contain orphans or deleted items not in the tree.
    const treeItemIds = useMemo(() => {
        const ids = new Set();
        const traverse = (nodes) => {
            nodes.forEach(node => {
                ids.add(node.id);
                if (node.children) traverse(node.children);
            });
        };
        traverse(tree);
        return ids;
    }, [tree]);

    const handleSelectAll = () => {
        // Exclude selectedFileId and its parents from total count
        // AND ensure we only select items that are actually in the tree
        const selectableItems = items.filter(i => 
            i.id !== selectedFileId && 
            !containsSelectedFile.has(i.id) && 
            treeItemIds.has(i.id)
        );
        
        // Calculate valid selected count properly (excluding children if parent is selected)
        const validSelectedIdsCount = Array.from(selectedIds).filter(id => {
            const item = items.find(i => i.id === id);
            // Must be a valid item, not disabled, AND present in the tree
            if (!item || id === selectedFileId || containsSelectedFile.has(id) || !treeItemIds.has(id)) return false;
            
            // If parent is also selected, don't count this child
            if (item.parent_id && selectedIds.has(item.parent_id)) return false;
            
            return true;
        }).length;

        // Check if all *selectable roots* are selected. 
        const allSelectableSelected = selectableItems.length > 0 && selectableItems.every(i => selectedIds.has(i.id));

        if (allSelectableSelected) {
            setSelectedIds(new Set());
        } else {
            // Select all selectable items
            setSelectedIds(new Set(selectableItems.map(i => i.id)));
        }
    };
    
    // Check state for button text and counter
    // Filter out invalid IDs from selectedIds (in case some were selected before being disabled or removed)
    // AND filter out children if parent is already selected to avoid double counting in UI
    const validSelectedIdsCount = Array.from(selectedIds).filter(id => {
        const item = items.find(i => i.id === id);
        if (!item || id === selectedFileId || containsSelectedFile.has(id) || !treeItemIds.has(id)) return false;
        
        // Check if any ancestor is also selected
        let curr = item;
        while (curr && curr.parent_id) {
             if (selectedIds.has(curr.parent_id)) return false;
             curr = items.find(i => i.id === curr.parent_id);
        }
        return true;
    }).length;

    const selectableCount = items.filter(i => 
        i.id !== selectedFileId && 
        !containsSelectedFile.has(i.id) &&
        treeItemIds.has(i.id)
    ).length;
    // For "All Selected" state, we can stick to checking if all selectable items are in the set
    // because handleSelectAll adds everything.
    const isAllSelected = selectableCount > 0 && items.filter(i => 
        i.id !== selectedFileId && 
        !containsSelectedFile.has(i.id) &&
        treeItemIds.has(i.id)
    ).every(i => selectedIds.has(i.id));



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
                        <button
                            type="button"
                            className="toggle selector-tree-toggle"
                            onClick={(e) => { e.stopPropagation(); node.is_folder && handleExpand(node.id, e); }}
                            style={{ visibility: node.is_folder ? 'visible' : 'hidden' }}
                            aria-label={isExpanded ? '收起文件夹' : '展开文件夹'}
                        >
                            <ChevronIcon expanded={isExpanded} />
                        </button>
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
             
             if (isDisabled) {
                 // If the folder itself is disabled (because it contains the current file), 
                 // it should NEVER appear selected or indeterminate, regardless of children.
                 allChildrenSelected = false;
                 someChildrenSelected = false;
             } else if (selectableChildIds.length === 0) {
                 // If no selectable children, check self if not disabled
                 // If disabled, it's effectively unchecked for UI purposes (or irrelevant)
                 allChildrenSelected = selectedIds.has(node.id);
                 someChildrenSelected = selectedIds.has(node.id);
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
            tooltip = "当前正在编辑，先切换到其他笔记再操作";
        } else if (isDisabled) {
            tooltip = "这个文件夹包含当前正在编辑的笔记，暂时不能删除";
        }

        return (
            <div key={node.id}>
                <div 
                    className={`tree-item ${isDisabled ? 'disabled' : ''}`} 
                    style={{ paddingLeft: level * 20 + 10 }}
                    title={tooltip}
                >
                    <button
                        type="button"
                        className="toggle selector-tree-toggle"
                        onClick={(e) => { e.stopPropagation(); node.is_folder && handleExpand(node.id, e); }}
                        style={{ visibility: node.is_folder ? 'visible' : 'hidden' }}
                        aria-label={isExpanded ? '收起文件夹' : '展开文件夹'}
                    >
                        <ChevronIcon expanded={isExpanded} />
                    </button>
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
        <div
            className="modal-overlay consumer-modal-overlay"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !processing) onClose();
            }}
        >
            <section
                className="modal consumer-modal selector-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="selector-dialog-title"
            >
                <header className="selector-modal-header">
                    <div>
                        <div className="modal-title" id="selector-dialog-title">{title}</div>
                        <div className="modal-message">
                            {mode === 'single-folder'
                                ? '选择一个位置，之后新内容会保存在这里。'
                                : showDeleteWarning
                                    ? '选择要移到回收站的内容。30 天内仍然可以恢复。'
                                    : '选择需要处理的内容。'}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="icon-btn selector-close-btn"
                        onClick={onClose}
                        disabled={processing}
                        aria-label="关闭"
                        title="关闭"
                    >
                        ×
                    </button>
                </header>

                {showDeleteWarning && (
                    <div className="selector-info-banner">
                        当前正在编辑的笔记会自动保留，避免误删正在使用的内容。
                    </div>
                )}

                <div className="selector-toolbar">
                    {mode !== 'single-folder' ? (
                        <button type="button" className="btn small" onClick={handleSelectAll} disabled={processing}>
                            {isAllSelected ? '取消全选' : '全选'}
                        </button>
                    ) : (
                        <span>保存位置</span>
                    )}
                    <span className="selector-counter">
                        {mode === 'single-folder'
                            ? (singleSelectedId ? '已选择文件夹' : '顶层位置')
                            : `已选择 ${validSelectedIdsCount} 项`}
                    </span>
                </div>

                <div className="selector-tree" aria-label={mode === 'single-folder' ? '选择文件夹' : '选择内容'}>
                    {mode === 'single-folder' && (
                        <div
                            className={`tree-item selector-root-item ${singleSelectedId === '' ? 'selected' : ''}`}
                            onClick={() => setSingleSelectedId('')}
                        >
                            <span className="toggle" aria-hidden="true" />
                            <span className="icon" aria-hidden="true"><HomeIcon /></span>
                            <span className="title">我的笔记（顶层）</span>
                        </div>
                    )}
                    {tree.map(node => renderNode(node))}
                </div>

                <footer className="selector-modal-footer">
                    <span className="selector-processing" aria-live="polite">
                        {processing ? processingText : ''}
                    </span>
                    <div className="btn-group">
                        <button type="button" className="btn" onClick={onClose} disabled={processing}>取消</button>
                        <button
                            type="button"
                            className="btn primary"
                            onClick={handleConfirmAction}
                            disabled={processing || (mode !== 'single-folder' && selectedIds.size === 0)}
                        >
                            {processing ? processingText : confirmText}
                        </button>
                    </div>
                </footer>
            </section>
        </div>
    );
}
