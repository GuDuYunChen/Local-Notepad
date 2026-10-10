import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createOfflineBatchDrop, OFFLINE_BATCH_DROP_MESSAGES } from '../services/s3OfflineBatchDrop.mjs'
import './S3OfflineReportDrop.css'

export default function S3OfflineBatchDrop({ revision, onFiles }) {
  const id = useId(), lease = useRef(null), accept = useRef(null)
  const [code, setCode] = useState(''), [highlight, setHighlight] = useState(false)
  const token = useMemo(() => ({}), [revision])
  const handlers = useMemo(() => createOfflineBatchDrop({
    isActive: () => lease.current === token,
    onFiles: files => accept.current(files), onFeedback: setCode, onHighlight: setHighlight,
  }), [token])
  useLayoutEffect(() => { accept.current = onFiles }, [onFiles])
  useLayoutEffect(() => {
    lease.current = token; setCode(''); setHighlight(false)
    return () => { if (lease.current === token) lease.current = null }
  }, [token])
  return <div className="offline-pair-drop" data-offline-batch-drop data-offline-drag={highlight ? 'true' : 'false'}
    role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`}
    onDragEnter={handlers.enter} onDragOver={handlers.over} onDragLeave={handlers.leave} onDragEnd={handlers.end} onDrop={handlers.drop}>
    <p id={`${id}-label`} data-offline-batch-drop-label><strong>{highlight ? '松开后校验两份报告' : '同时拖入两份统计报告'}</strong></p>
    <p id={`${id}-hint`}>按拖放返回顺序分配 A / B，不代表时间先后。每份最多 4 KiB，两份均校验成功才一起替换；请核对方向后手动比较。也可使用下方文件选择按钮。</p>
    <p role="status" aria-live="polite" aria-atomic="true" data-offline-batch-drop-status={code}>{OFFLINE_BATCH_DROP_MESSAGES[code] || ''}</p>
  </div>
}
