import React from 'react'

export default function ConfirmDialog({ title, message, actions, onClose }) {
  const isAnyLoading = actions.some(action => action.loading)
  const primaryRef = React.useRef(null)

  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !isAnyLoading) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, isAnyLoading])

  React.useEffect(() => {
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const descriptionId = 'consumer-confirm-description'

  return (
    <div
      className="modal-overlay consumer-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isAnyLoading) onClose?.()
      }}
    >
      <section
        className="modal consumer-modal consumer-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consumer-confirm-title"
        aria-describedby={descriptionId}
      >
        <div className="consumer-modal-heading">
          <div className="modal-title" id="consumer-confirm-title">{title}</div>
          <div className="modal-message" id={descriptionId}>{message}</div>
        </div>

        <div className="modal-actions consumer-modal-actions">
          {actions.map((action, index) => {
            const isPrimary = action.kind === 'primary' || action.kind === 'danger'
            const disabled = action.disabled || isAnyLoading

            return (
              <button
                key={`${action.label}-${index}`}
                ref={isPrimary ? primaryRef : undefined}
                type="button"
                className={`btn${action.kind === 'primary' ? ' primary' : ''}${action.kind === 'danger' ? ' danger' : ''}`}
                onClick={action.onClick}
                disabled={disabled}
                aria-busy={Boolean(action.loading)}
              >
                {action.loading ? (
                  <span className="consumer-button-loading">
                    <svg className="spinner" viewBox="0 0 50 50" aria-hidden="true">
                      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="5" />
                    </svg>
                    <span>处理中…</span>
                  </span>
                ) : action.label}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
