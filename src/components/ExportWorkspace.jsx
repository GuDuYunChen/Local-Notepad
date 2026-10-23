import React, { useEffect, useRef, useState } from 'react'
import { exportResult, exportStatusLabels, localExportBridge, localExportRequest, validateExportSelection } from '../services/localExport.mjs'
import './ExportWorkspace.css'

const messageOf = error => error?.message || '操作未完成，请重试。'
const requestId = () => crypto.randomUUID()

export default function ExportWorkspace({ ids, onClose, onReselect }) {
  const selection = useRef(ids.slice()), native = useRef(localExportBridge())
  const live = useRef(false), epoch = useRef(0), operation = useRef(null), planRef = useRef(null)
  const panel = useRef(null), previousFocus = useRef(document.activeElement), prepareId = useRef(null)
  const callbacks = useRef({ onClose, onReselect }); callbacks.current = { onClose, onReselect }
  const [format, setFormat] = useState('markdown'), [plan, setPlan] = useState(null)
  const [working, setWorking] = useState(''), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false)
  const uncertainRef = useRef(false); uncertainRef.current = uncertain
  const [pollPaused, setPollPaused] = useState(false), [pollTick, setPollTick] = useState(0)
  const busy = Boolean(working || plan?.busy), composing = useRef(false)
  const setCurrent = next => { planRef.current = next; if (live.current) setPlan(next) }
  const accept = (response, expected = {}) => {
    const next = exportResult(response, { previous: planRef.current || undefined, ...expected })
    setCurrent(next); setUncertain(false); setPollPaused(false); setMessage(next.message || '')
    return next
  }
  const dispose = value => {
    if (!value?.planId || !native.current) return
    try { Promise.resolve(native.current.exportWorkspaceRelease({ planId: value.planId })).catch(() => {}) } catch {}
  }
  const stopNative = () => {
    const value = planRef.current
    if (!native.current || (!value && !prepareId.current)) return
    try { Promise.resolve(native.current.exportWorkspaceCancel(value ? { planId: value.planId } : { requestId: prepareId.current })).catch(() => {}) } catch {}
  }
  const valid = task => live.current && operation.current === task && task.epoch === epoch.current
  const begin = kind => {
    if (operation.current || composing.current || !native.current) return null
    const task = { kind, epoch: epoch.current }; operation.current = task; setWorking(kind); setMessage('')
    return task
  }
  const finish = task => { if (operation.current === task) { operation.current = null; if (live.current) setWorking('') } }
  const close = () => {
    if (operation.current || planRef.current?.busy || uncertainRef.current) { setMessage('请先停止或查回导出结果，确认后再关闭工作台。'); return }
    dispose(planRef.current); callbacks.current.onClose?.()
  }

  useEffect(() => {
    live.current = true; epoch.current++
    panel.current?.focus()
    const onKey = event => {
      if (event.isComposing || event.keyCode === 229 || composing.current) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      if (event.key === 'Tab') {
        const controls = [...(panel.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') || [])].filter(node => !node.hidden && node.getAttribute('aria-hidden') !== 'true')
        const first = controls[0], last = controls.at(-1)
        if (!first) { event.preventDefault(); panel.current?.focus(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      live.current = false; epoch.current++; stopNative(); dispose(planRef.current)
      document.removeEventListener('keydown', onKey, true)
      if (previousFocus.current?.isConnected) previousFocus.current.focus()
    }
  }, [])

  useEffect(() => {
    if (!plan?.busy || working || pollPaused || !native.current) return undefined
    const currentId = plan.planId, currentEpoch = epoch.current
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const response = await localExportRequest(() => native.current.exportWorkspaceStatus({ planId: currentId }), 10000)
        if (cancelled || !live.current || epoch.current !== currentEpoch || operation.current || planRef.current?.planId !== currentId) return
        accept(response, { planId: currentId }); setPollTick(value => value + 1)
      } catch (error) {
        if (!cancelled && live.current && epoch.current === currentEpoch && !operation.current) {
          setMessage(messageOf(error)); setUncertain(true); setPollPaused(true)
        }
      }
    }, 750)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [plan?.planId, plan?.busy, working, pollPaused, pollTick])

  const prepare = async () => {
    if (planRef.current || operation.current) return
    const task = begin('prepare'); if (!task) return
    const id = prepareId.current || requestId(); prepareId.current = id
    let preserveRequestId = false
    try {
      const roots = validateExportSelection(selection.current)
      const response = await localExportRequest(() => native.current.exportWorkspacePrepare({ requestId: id, ids: roots, format }))
      if (!valid(task)) { dispose(response?.plan); return }
      const next = exportResult(response, { format })
      if (next.requestId !== id) throw new Error('预览与本次读取请求不一致，没有采用。')
      prepareId.current = null
      setCurrent(next); setUncertain(false); setPollPaused(false); setMessage('预览已就绪。请核对内容并选择文件夹，再开始导出。')
    } catch (error) {
      if (valid(task)) {
        setMessage(messageOf(error))
        if (['local-export-request-timeout', 'local-export-response-lost'].includes(error?.code)) {
          // A timeout or lost IPC response does not prove that native preparation stopped.
          // Keep the same request identity so an explicit retry retrieves the original result.
          preserveRequestId = true
          setUncertain(true); setPollPaused(true)
        } else {
          stopNative(); setUncertain(false); prepareId.current = null
        }
      }
    } finally { if (prepareId.current === id && !preserveRequestId) prepareId.current = null; finish(task) }
  }

  const act = async (kind, method) => {
    const current = planRef.current
    if (!current || operation.current) return
    const task = begin(kind); if (!task) return
    try {
      const response = await localExportRequest(() => method(current), kind === 'choose' ? 65000 : 15000)
      if (!valid(task)) return
      const next = accept(response, { planId: current.planId, format: current.format })
      if (next.message) setMessage(next.message)
      else if (kind === 'choose') setMessage(response.cancelled || response.canceled ? '已取消选择文件夹，当前选择和预览均已保留。' : '导出位置已选好。开始后会创建独立文件夹，不覆盖已有文件。')
      else if (kind === 'cancel') setMessage(next.busy ? '正在停止，请等待正在进行的文件操作结束。' : '已停止。已导出的文件保留，未完成项可单独继续。')
      else if (kind === 'reveal') setMessage('已请求打开导出文件夹。')
    } catch (error) {
      if (valid(task)) {
        setMessage(messageOf(error)); setUncertain(true); setPollPaused(true)
        if (kind === 'choose') stopNative()
      }
    } finally { finish(task) }
  }
  const readStatus = () => act('status', value => native.current.exportWorkspaceStatus({ planId: value.planId }))
  const start = retry => act(retry ? 'retry' : 'start', value => native.current[retry ? 'exportWorkspaceRetry' : 'exportWorkspaceStart']({ planId: value.planId, requestId: requestId() }))
  const cancel = () => {
    if (!planRef.current) { stopNative(); return }
    return act('cancel', value => native.current.exportWorkspaceCancel({ planId: value.planId }))
  }
  const cancelPreparation = () => { stopNative(); setMessage('已请求停止读取，正在等待桌面确认。') }
  const changeFormat = next => {
    if (busy || uncertain || plan?.items.some(item => item.status !== 'ready')) return
    dispose(planRef.current); setCurrent(null); setFormat(next); setMessage('')
  }
  const reselect = () => {
    if (busy || uncertain) return
    dispose(planRef.current); callbacks.current.onReselect?.()
  }
  const remaining = (plan?.counts.ready || 0) + (plan?.counts.cancelled || 0)
  const completed = plan ? plan.counts.succeeded + plan.counts.failed + plan.counts.cancelled : 0
  const begun = plan?.items.some(item => item.status !== 'ready')
  const canContinue = !busy && !uncertain && plan?.canStart && remaining > 0 && begun
  return (
    <div className="modal-overlay consumer-modal-overlay export-workspace-overlay" role="presentation">
      <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="local-export-title" aria-describedby="local-export-source"
        className="export-workspace" data-local-export-workspace data-phase={plan?.phase || working || 'selection'} data-state={plan?.state || 'selection'}
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
        <header className="export-workspace-header">
          <div><p className="export-eyebrow">本地文档</p><h2 id="local-export-title">导出笔记</h2></div>
          <button type="button" className="icon-btn" aria-label="关闭导出工作台" disabled={busy || uncertain} onClick={close}>×</button>
        </header>
        <div className="export-workspace-body">
          <p id="local-export-source" className="export-source">导出已保存的笔记正文，不会保存或改动当前编辑草稿。预览就绪后，本批正文固定；附件会在导出时读取。每批创建独立文件夹，已有文件保留。</p>
          {!native.current && <p role="alert" className="export-error">本地文档导出需要桌面客户端。当前没有可用的桌面文件接口，未读取或写入任何导出文件。</p>}
          <div className="export-selection"><span>已选择 {selection.current.length} 个笔记或文件夹</span>{!begun && <button type="button" className="btn small" onClick={reselect} disabled={busy || uncertain}>更改选择</button>}</div>
          <fieldset className="export-format" disabled={busy || uncertain || Boolean(begun)}>
            <legend>导出格式</legend>
            <label><input type="radio" name="local-export-format" value="markdown" checked={format === 'markdown'} onChange={() => changeFormat('markdown')} />Markdown <small>正文和本地附件放在一起</small></label>
            <label><input type="radio" name="local-export-format" value="docx" checked={format === 'docx'} onChange={() => changeFormat('docx')} />Word 文档 <small>可用 Word 或兼容软件打开</small></label>
          </fieldset>
          {!plan && <button type="button" className="btn primary" data-local-export-prepare disabled={busy || !native.current} onClick={() => void prepare()}>{working === 'prepare' ? '正在读取预览…' : uncertain && prepareId.current ? '查回预览' : '读取导出预览'}</button>}
          {plan && <>
            <div className="export-destination"><div><strong>导出位置</strong><p>{plan.destination || '尚未选择文件夹'}</p></div><button type="button" className="btn" data-local-export-choose disabled={busy || uncertain || Boolean(begun) || plan.canChooseDirectory === false} onClick={() => void act('choose', value => native.current.exportWorkspaceChooseDirectory({ planId: value.planId }))}>{plan.destination ? '更换文件夹' : '选择导出文件夹'}</button></div>
            <section className="export-results" aria-label="导出预览与结果">
              <div className="export-results-heading"><h3>{begun ? '导出结果' : '内容预览'}</h3><span data-local-export-counts>共 {plan.counts.total} 项 · 已导出 {plan.counts.succeeded} · 失败 {plan.counts.failed} · 已停止 {plan.counts.cancelled}</span></div>
              {plan.busy && <progress aria-label="导出进度" max={plan.counts.total} value={completed} />}
              <ol className="export-items">{plan.items.map(item => <li key={item.id} data-local-export-item={item.id} data-status={item.status} data-output-bytes={item.status === 'succeeded' ? item.bytes : undefined} data-output-sha256={item.status === 'succeeded' ? item.sha256 : undefined}>
                <div className="export-item-heading"><strong>{item.title}</strong><span className={'export-item-status export-status-' + item.status}>{exportStatusLabels[item.status]}</span></div>
                <p className="export-item-path">{item.outputPath || item.partialPaths?.[0] || item.partialPath || item.relativePath}</p>
                {item.message && <p className={item.status === 'failed' ? 'export-error' : 'export-item-message'}>{item.message}</p>}
                {item.partialPaths?.length > 0 && <ul className="export-warnings" aria-label={item.title + ' 未清理输出路径'}>{item.partialPaths.map((filename, index) => <li key={filename + index}>{filename}</li>)}</ul>}
                {item.warnings.length > 0 && <ul className="export-warnings" aria-label={item.title + ' 导出提示'}>{item.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
                <details><summary>查看已保存正文预览</summary><pre>{item.preview || '（空白笔记）'}</pre></details>
              </li>)}</ol>
            </section>
          </>}
        </div>
        {message && <div className="export-workspace-notice"><p className={uncertain || message === plan?.message ? 'export-error' : 'export-feedback'} role={uncertain || message === plan?.message ? 'alert' : 'status'} data-local-export-feedback>{message}</p>
          {uncertain && <p className="export-source">目前尚未确认最新结果。请查回进度或请求停止，确认后再继续；已导出项目不会重新执行。</p>}
        </div>}
        <footer className="export-workspace-footer">
          <div className="export-secondary-actions">
            {plan && <button type="button" className="btn" data-local-export-status disabled={Boolean(working)} onClick={() => void readStatus()}>查回结果</button>}
            {plan?.canReveal && <button type="button" className="btn" data-local-export-reveal disabled={Boolean(working)} onClick={() => void act('reveal', value => native.current.exportWorkspaceReveal({ planId: value.planId }))}>打开导出文件夹</button>}
          </div>
          <div className="export-primary-actions">
            {(working === 'prepare' || (uncertain && !plan && prepareId.current)) && <button type="button" className="btn" data-local-export-cancel onClick={cancelPreparation}>{working === 'prepare' ? '停止读取' : '请求停止读取'}</button>}
            {plan?.busy || (uncertain && plan) ? <button type="button" className="btn" data-local-export-cancel disabled={Boolean(working)} onClick={() => void cancel()}>{plan?.phase === 'cancelling' ? '正在停止…' : '停止导出'}</button> : null}
            {!begun && plan && <button type="button" className="btn primary" data-local-export-start disabled={busy || uncertain || !plan.canStart || !plan.destination} onClick={() => void start(false)}>开始导出</button>}
            {canContinue && <button type="button" className="btn primary" data-local-export-continue onClick={() => void start(false)}>继续未完成项（{remaining}）</button>}
            {plan?.counts.failed > 0 && <button type="button" className="btn primary" data-local-export-retry disabled={busy || uncertain || !plan.canRetry} onClick={() => void start(true)}>仅重试失败项（{plan.counts.failed}）</button>}
            <button type="button" className="btn" disabled={busy || uncertain} onClick={close}>{plan?.state === 'completed' ? '完成' : '关闭'}</button>
          </div>
        </footer>
      </section>
    </div>
  )
}
