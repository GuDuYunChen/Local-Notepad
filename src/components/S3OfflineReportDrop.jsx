import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createOfflineReportDrop } from '../services/s3OfflineReportDrop.mjs'
import { LOCAL_REPORT_DROP_MESSAGES } from '../services/s3LocalReportDrop.mjs'
import './S3OfflineReportDrop.css'

export default function S3OfflineReportDrop({ side, revision, onFile, children }) {
  const id = useId(), lease = useRef(null), accept = useRef(null)
  const [code, setCode] = useState(''), [highlight, setHighlight] = useState(false)
  const token = useMemo(() => ({}), [side, revision])
  const handlers = useMemo(() => createOfflineReportDrop({
    isActive: () => lease.current === token,
    onFile: file => accept.current(file), onFeedback: setCode, onHighlight: setHighlight,
  }), [token])
  useLayoutEffect(() => { accept.current = onFile }, [onFile])
  useLayoutEffect(() => {
    lease.current = token; setCode(''); setHighlight(false)
    return () => { if (lease.current === token) lease.current = null }
  }, [token])
  return <div className="offline-pair-drop" data-offline-drop={side} data-offline-drag={highlight ? 'true' : 'false'}
    role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`}
    onDragEnter={handlers.enter} onDragOver={handlers.over} onDragLeave={handlers.leave} onDragEnd={handlers.end} onDrop={handlers.drop}>
    <p id={`${id}-label`} data-offline-drop-label><strong>{highlight ? `松开以替换报告 ${side.toUpperCase()}` : `拖入单个报告 ${side.toUpperCase()}`}</strong></p>
    <p id={`${id}-hint`}>也可使用文件选择按钮。仅替换本侧，不导入笔记；最多 4 KiB，校验后需重新点击比较。</p>
    {children}
    <p role="status" aria-live="polite" aria-atomic="true" data-offline-drop-status={code}>{LOCAL_REPORT_DROP_MESSAGES[code] || ''}</p>
  </div>
}
