import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { captureSyncDiagnostic, syncDiagnosticFacts, copySyncDiagnostic } from '~/services/syncDiagnostic.mjs'
import './SyncDiagnosticPanel.css'

// The only side effect here is the user's explicit copy of the visible text.
// No refresh/run/resolve callback is supplied; a report cannot authorize sync.
export default function SyncDiagnosticPanel(props) {
  const [snapshot, setSnapshot] = useState(null)
  const [changed, setChanged] = useState(false)
  const [copying, setCopying] = useState(false)
  const [message, setMessage] = useState('')
  const alive = useRef(false), ticket = useRef(0), pending = useRef(false), area = useRef(null), opener = useRef(null)
  const currentKey = JSON.stringify(syncDiagnosticFacts(props))
  useEffect(() => { alive.current = true; return () => { alive.current = false; ticket.current++ } }, [])
  useLayoutEffect(() => {
    if (snapshot && snapshot.key !== currentKey) setChanged(true)
  }, [snapshot, currentKey])
  const generate = () => {
    ticket.current++; pending.current = false; setCopying(false); setMessage(''); setChanged(false)
    setSnapshot(captureSyncDiagnostic(props))
  }
  const close = () => {
    ticket.current++; pending.current = false; setCopying(false); setMessage(''); setSnapshot(null); setChanged(false)
    opener.current?.focus()
  }
  const copy = async () => {
    if (!snapshot || pending.current || !alive.current) return
    pending.current = true; setCopying(true); setMessage('')
    const id = ++ticket.current
    const confirmed = await copySyncDiagnostic(snapshot.text, value => navigator.clipboard.writeText(value))
    if (!alive.current || id !== ticket.current) return
    pending.current = false; setCopying(false)
    setMessage(confirmed ? '已复制当前显示的摘要；没有上传或执行同步。' : '复制未确认。可点击“选择摘要”后手动复制；先前复制请求仍可能完成，不会自动重试。')
  }
  return <section className="sync-diagnostic-panel" aria-label="同步诊断摘要">
    <div className="sync-diagnostic-heading"><h4>同步诊断摘要</h4>
      <button ref={opener} type="button" className="btn small" onClick={generate}>{snapshot ? '重新生成摘要' : '生成诊断摘要'}</button>
    </div>
    <p className="sync-diagnostic-caption">用于手动排障和分享，不含正文、名称、账号、地址、凭据或错误原文。不自动上传，生成摘要也不会重新读取或执行同步。</p>
    {snapshot && <>
      <p className="sync-diagnostic-caption">复制的是下方这份快照。它仍含计数和时间，请先核对再分享；不是匿名或实时状态保证。</p>
      {changed && <p className="sync-diagnostic-notice" role="status">可见诊断字段已变化。下面保留原摘要，请重新生成后再分享；恢复原值不会自动更新旧摘要。</p>}
      <textarea ref={area} aria-label="可复制的诊断摘要" readOnly spellCheck={false} value={snapshot.text}/>
      <div className="sync-diagnostic-actions">
        <button type="button" className="btn small" disabled={copying} onClick={() => void copy()}>{copying ? '等待复制结果…' : '复制诊断摘要'}</button>
        <button type="button" className="btn small" onClick={() => { area.current?.focus(); area.current?.select() }}>选择摘要</button>
        <button type="button" className="btn small" onClick={close}>收起诊断摘要</button>
      </div>
      {message && <p className="sync-diagnostic-notice" role="status">{message}</p>}
    </>}
  </section>
}
