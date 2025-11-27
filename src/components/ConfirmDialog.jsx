import React from 'react'

export default function ConfirmDialog({ title, message, actions, onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">{title}</div>
        <div className="modal-message">{message}</div>
        <div className="modal-actions">
          {actions.map((a, idx) => (
            <button key={idx} className={`btn${a.kind === 'primary' ? ' primary' : ''}${a.kind === 'danger' ? ' danger' : ''}`} onClick={a.onClick}>{a.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
