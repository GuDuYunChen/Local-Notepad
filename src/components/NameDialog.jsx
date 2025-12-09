import React, { useState, useEffect } from 'react'

export default function NameDialog({ defaultName = '未命名.md', onConfirm, onCancel, title = '新建文件', message = '请输入文件名（可包含扩展名）：', validate }) {
  const [name, setName] = useState(defaultName)
  const [err, setErr] = useState('')
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  const ok = () => {
    const n = name.trim()
    if (!n) { setErr('文件名不能为空'); return }
    if (validate) {
      const m = validate(n)
      if (m) { setErr(m); return }
    }
    onConfirm(n)
  }
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">{title}</div>
        <div className="modal-message">{message}</div>
        <div className="modal-input-row"><input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} /></div>
        {err && <div className="modal-error">{err}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={ok}>确定</button>
        </div>
      </div>
    </div>
  )
}
