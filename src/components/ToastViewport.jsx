import React, { useEffect, useRef, useState } from 'react'
import { TOAST_EVENT } from '~/services/toast'

const SYMBOLS = {
  success: '✓',
  error: '!',
  warning: '!',
  loading: '•',
}

export default function ToastViewport() {
  const [items, setItems] = useState([])
  const timersRef = useRef(new Map())

  useEffect(() => {
    const clearTimer = (id) => {
      const timer = timersRef.current.get(id)
      if (timer) {
        window.clearTimeout(timer)
        timersRef.current.delete(id)
      }
    }

    const close = (id) => {
      clearTimer(id)
      setItems(current => current.filter(item => item.id !== id))
    }

    const handleToast = (event) => {
      const detail = event.detail || {}

      if (detail.action === 'close') {
        close(detail.id)
        return
      }

      const item = detail.toast
      if (!item?.id) return

      setItems(current => {
        const next = [...current.filter(existing => existing.id !== item.id), item]
        return next.slice(-5)
      })

      clearTimer(item.id)
      if (item.duration > 0) {
        const timer = window.setTimeout(() => close(item.id), item.duration)
        timersRef.current.set(item.id, timer)
      }
    }

    window.addEventListener(TOAST_EVENT, handleToast)
    return () => {
      window.removeEventListener(TOAST_EVENT, handleToast)
      timersRef.current.forEach(timer => window.clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {items.map(item => (
        <div
          key={item.id}
          className={`app-toast ${item.type}`}
          role={item.type === 'error' ? 'alert' : 'status'}
        >
          <span className={`app-toast-symbol ${item.type}`} aria-hidden="true">
            {SYMBOLS[item.type] || '•'}
          </span>
          <span className="app-toast-content">{item.content}</span>
          {item.type === 'loading' && <span className="app-toast-loader" aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
}
