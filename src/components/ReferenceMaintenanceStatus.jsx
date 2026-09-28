import React, { useEffect, useRef, useState } from 'react'
import './ReferenceMaintenanceStatus.css'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { boundedEditorRequest } from '~/services/editorSaveTransaction.mjs'
import { maintainSavedReferences } from '~/services/referenceMaintenance.mjs'

export default function ReferenceMaintenanceStatus() {
  const [status, setStatus] = useState(null)
  const running = useRef(null), rerun = useRef(false)
  const startRef = useRef(null)
  useEffect(() => {
    let live = true
    const start = async (retryManual = false) => {
      if (running.current) { rerun.current = true; return }
      const controller = new AbortController(); running.current = controller
      try {
        const result = await maintainSavedReferences({ load: api, signal: controller.signal, retryManual,
          hasDraft: id => editorQuit.hasDraft(id),
          listFiles: async signal => {
            const all = []
            for (let page = 1; page <= 100; page++) {
              const part = await boundedEditorRequest(api, `/api/files?page=${page}&size=200`, { signal })
              if (!Array.isArray(part)) throw new Error('引用扫描响应无效')
              all.push(...part); if (part.length < 200) return all
            }
            throw new Error('引用扫描范围超过本次限制')
          },
        })
        if (live) setStatus(result.pending ? `正文保存独立进行；${result.pending} 项引用待处理${result.limited ? '（本批）' : ''}` : null)
      } catch { if (live) setStatus('引用维护暂不可用；不会阻塞正文保存。') }
      finally {
        if (running.current === controller) running.current = null
        if (live && rerun.current) { rerun.current = false; void start() }
      }
    }
    startRef.current = start
    const saved = () => { void start() }
    window.addEventListener('editor:durable-save', saved); void start()
    return () => { live = false; rerun.current = false; running.current?.abort(); running.current = null; window.removeEventListener('editor:durable-save', saved) }
  }, [])
  return status ? <aside className="reference-maintenance-status" aria-label="引用维护状态">
    <span role="status">{status}</span>
    <button type="button" className="btn small" onClick={() => { void startRef.current?.(true) }}>重试引用更新</button>
  </aside> : null
}
