import React, { useState, useEffect } from 'react'

export default function NameDialog({ 
  defaultName = '未命名.md', 
  onConfirm, 
  onCancel, 
  title = '新建文件', 
  message = '请输入文件名（可包含扩展名）：', 
  validate,
  showFormatSelect = false,
  currentPathLabel = '',
  onPathSelect = null,
  isRename = false
}) {
  const [name, setName] = useState(defaultName)
  const [format, setFormat] = useState('.md')
  const [err, setErr] = useState('')

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    
    // Initialize format from defaultName
    if (showFormatSelect) {
        const match = defaultName.match(/\.[^.]+$/);
        if (match) {
            const ext = match[0];
            if (['.md', '.txt', '.docx'].includes(ext)) {
                setFormat(ext);
                // Strip extension from name
                setName(defaultName.substring(0, defaultName.lastIndexOf('.')));
            } else {
                setName(defaultName);
            }
        } else {
            setName(defaultName);
        }
    } else if (isRename) {
        // In Rename mode, strip extension and store it in format
        const lastDot = defaultName.lastIndexOf('.');
        if (lastDot > 0) {
            setFormat(defaultName.substring(lastDot));
            setName(defaultName.substring(0, lastDot));
        } else {
            setName(defaultName);
            setFormat('');
        }
    } else {
        setName(defaultName);
    }
    
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, showFormatSelect, defaultName, isRename])

  const ok = async () => {
    const n = name.trim()
    if (!n) { setErr('文件名不能为空'); return }
    if (validate) {
      const m = validate(n)
      if (m) { setErr(m); return }
    }
    // Pass format separately or combine?
    // Parent expects onConfirm(name, format) or just name.
    // If showFormatSelect is true, we should probably pass both or combined.
    // Let's pass both.
    
    setErr('') // Clear previous errors
    
    try {
        if (showFormatSelect || isRename) {
            // If isRename, we might need to append format here or let parent handle it.
            // FileList's onRenameConfirm expects (id, name, format) but logic there appends it.
            // Actually FileList logic: "if we have a fixed format (from isRename mode), append it if missing"
            // But here we stripped it. So we pass `n` (name part) and `format` (extension).
            await onConfirm(n, format)
        } else {
            await onConfirm(n)
        }
    } catch (e) {
        setErr(e.message || '操作失败')
    }
  }

  const handleFormatChange = (e) => {
    const newFormat = e.target.value
    setFormat(newFormat)
    // No longer update name
  }

  const handleNameChange = (e) => {
      setName(e.target.value)
      // No longer sync format from name input, as name input shouldn't have extension
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">{title}</div>
        <div className="modal-message">{message}</div>
        <div className="modal-input-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" autoFocus value={name} onChange={handleNameChange} style={{ flex: 1 }} />
            {showFormatSelect && (
                <select className="select" value={format} onChange={handleFormatChange} style={{ width: 120 }}>
                    <option value=".md">Markdown (.md)</option>
                    <option value=".txt">纯文本 (.txt)</option>
                    <option value=".docx">Word (.docx)</option>
                </select>
            )}
            {isRename && format && (
                <div className="static-ext" style={{ color: '#666', fontSize: 13 }}>{format}</div>
            )}
        </div>
        {currentPathLabel && (
            <div className="path-row">
                <span className="path-text" title={currentPathLabel}>
                    位置: {currentPathLabel}
                </span>
                {onPathSelect && (
                    <button className="btn small" onClick={onPathSelect}>更改</button>
                )}
            </div>
        )}
        {err && <div className="modal-error">{err}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={ok}>确定</button>
        </div>
      </div>
      <style>{`
        .select {
            padding: 4px 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: var(--bg);
            color: var(--fg);
        }
        .path-row {
            font-size: 12px;
            color: #666;
            margin-top: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(128,128,128,0.08);
            padding: 6px 10px;
            border-radius: 6px;
        }
        .path-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 220px;
            font-family: monospace;
        }
        .btn.small {
            height: 24px;
            padding: 0 8px;
            font-size: 12px;
            margin-left: 8px;
        }
        .modal-error {
            color: #ff4d4f;
            font-size: 13px;
            margin-top: 8px;
        }
      `}</style>
    </div>
  )
}
