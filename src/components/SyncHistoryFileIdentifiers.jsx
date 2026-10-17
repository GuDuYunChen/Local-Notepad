import React, { useLayoutEffect, useRef, useState } from 'react'
import { selectHistoryFileIdentifier, clearHistoryFileIdentifierSelection } from '~/services/syncHistoryFileIdentifierSelection.mjs'

export default function SyncHistoryFileIdentifiers({ row, context, hintID }) {
  const details = useRef(null), object = useRef(null), record = useRef(null)
  const [notice, setNotice] = useState('')
  useLayoutEffect(() => {
    const node = details.current
    setNotice('')
    return () => { clearHistoryFileIdentifierSelection(node) }
  }, [context, row.id, row.itemID])
  const select = (node, label) => {
    const selected = selectHistoryFileIdentifier(node)
    setNotice(selected ? `已选中${label}标识；请按 Ctrl+C（Mac 为 ⌘C）手动复制。` :
      '无法自动选中；请拖选上方完整标识后手动复制。')
  }
  return <details ref={details} data-history-file-identifiers onToggle={event => {
    if (!event.currentTarget.open) { clearHistoryFileIdentifierSelection(event.currentTarget); setNotice('') }
  }}>
    <summary>查看文件内标识</summary>
    <p className="sync-history-file-identifier-line">对象：<bdi><code ref={object} data-history-file-selectable-id="object">{row.itemID}</code></bdi>
      <button type="button" className="btn small" data-history-file-select-id="object" aria-describedby={hintID}
        onClick={() => select(object.current, '对象')}>选择对象标识</button>
    </p>
    <p className="sync-history-file-identifier-line">记录：<bdi><code ref={record} data-history-file-selectable-id="record">{row.id}</code></bdi>
      <button type="button" className="btn small" data-history-file-select-id="record" aria-describedby={hintID}
        onClick={() => select(record.current, '记录')}>选择记录标识</button>
    </p>
    {notice && <p role="status" data-history-file-selection-notice>{notice}</p>}
  </details>
}
