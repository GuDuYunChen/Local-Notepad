import React, { useState, useEffect } from 'react'

export default function NameDialog({ 
  defaultName = '未命名.md', 
  onConfirm, 
  onCancel, 
  title = '新建文件', 
  message = '请输入文件名（可包含扩展名）：', 
  validate,
  showFormatSelect = false 
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
            }
        }
    }
    
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, showFormatSelect, defaultName])

  const ok = () => {
    const n = name.trim()
    if (!n) { setErr('文件名不能为空'); return }
    if (validate) {
      const m = validate(n)
      if (m) { setErr(m); return }
    }
    onConfirm(n)
  }

  const handleFormatChange = (e) => {
    const newFormat = e.target.value
    setFormat(newFormat)
    
    // Replace extension
    const parts = name.split('.')
    if (parts.length > 1) {
        parts.pop()
        setName(parts.join('.') + newFormat)
    } else {
        setName(name + newFormat)
    }
  }

  const handleNameChange = (e) => {
      setName(e.target.value)
      // Optional: sync format select if user types extension?
      // Let's keep it simple: dropdown drives extension, but user can override if they really want.
      // But if user types .txt, dropdown should probably update?
      // Requirement doesn't strictly specify bi-directional sync, but it's good UX.
      const val = e.target.value;
      const match = val.match(/\.[^.]+$/);
      if (match) {
          const ext = match[0];
          if (['.md', '.txt', '.docx'].includes(ext)) {
              setFormat(ext);
          }
      }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">{title}</div>
        <div className="modal-message">{message}</div>
        <div className="modal-input-row" style={{ display: 'flex', gap: 8 }}>
            <input className="input" autoFocus value={name} onChange={handleNameChange} style={{ flex: 1 }} />
            {showFormatSelect && (
                <select className="select" value={format} onChange={handleFormatChange} style={{ width: 120 }}>
                    <option value=".md">Markdown (.md)</option>
                    <option value=".txt">纯文本 (.txt)</option>
                    <option value=".docx">Word (.docx)</option>
                </select>
            )}
        </div>
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
      `}</style>
    </div>
  )
}
