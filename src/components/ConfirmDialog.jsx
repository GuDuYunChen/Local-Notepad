import React from 'react'

export default function ConfirmDialog({ title, message, actions, onClose }) {
  React.useEffect(() => {
    // Only allow Escape if NOT loading
    const isAnyLoading = actions.some(a => a.loading);
    const onKey = (e) => { 
        if (e.key === 'Escape' && !isAnyLoading) onClose() 
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, actions])

  const isAnyLoading = actions.some(a => a.loading);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">{title}</div>
        <div className="modal-message">{message}</div>
        <div className="modal-actions">
          {actions.map((a, idx) => (
            <button 
                key={idx} 
                className={`btn${a.kind === 'primary' ? ' primary' : ''}${a.kind === 'danger' ? ' danger' : ''}`} 
                onClick={a.onClick}
                disabled={a.disabled || isAnyLoading}
                style={{ 
                    opacity: (a.disabled || (isAnyLoading && !a.loading)) ? 0.5 : 1, 
                    cursor: (a.disabled || isAnyLoading) ? 'not-allowed' : 'pointer',
                    position: 'relative'
                }}
            >
                {a.loading ? (
                    <>
                        <span style={{ opacity: 0 }}>{a.label}</span>
                        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                            <svg className="spinner" viewBox="0 0 50 50" style={{ width: '1em', height: '1em', animation: 'spin 1s linear infinite' }}>
                                <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="5"></circle>
                            </svg>
                        </span>
                    </>
                ) : a.label}
            </button>
          ))}
        </div>
        <style>{`
            @keyframes spin {
                100% { transform: rotate(360deg); }
            }
        `}</style>
      </div>
    </div>
  )
}
