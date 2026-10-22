import React, { useEffect, useRef, useState } from 'react'
import { api, listAllFiles } from '../services/api'
import { normalizeImportedContent } from '../services/importContent'
import { dailyRequest } from '../services/dailyNotes.mjs'
import {
  LOCAL_IMPORT_COUNT, LOCAL_IMPORT_FILE_LIMIT, LOCAL_IMPORT_LIMIT,
  canCancelImport, canClearImport, createImportLedger, createImportOperations,
  importFolders, importTitle, validateImportedBody, validateNativeImportResult,
} from '../services/localImport.mjs'
import './ImportWorkspace.css'

const accept = '.md,.txt,.docx,.doc,.xlsx,.xls'
const names = { prepared: '等待确认', pending: '已确认，尚未开始', preparing: '正在转换', submitting: '正在确认', unknown: '结果待查回', committed: '导入已确认', rejected: '已明确拒绝', error: '无法导入' }
const rowId = row => row.entry?.value.requestId || row.sourceId
const fromEntry = entry => {
  const intent = entry.value, parsed = validateImportedBody(intent.payload.content)
  return { sourceId: intent.requestId, sourceTitle: intent.sourceTitle || intent.payload.title, title: intent.payload.title, content: intent.payload.content, preview: parsed.preview, bytes: parsed.bytes, parentId: intent.payload.parent_id, selected: false, entry, status: intent.outcome?.status || (intent.attempted ? 'unknown' : 'pending'), receipt: intent.outcome?.receipt, message: intent.outcome?.status === 'rejected' ? intent.outcome.message : intent.outcome?.status === 'committed' ? '已保存上次确认结果；可查回当前状态。' : intent.attempted ? '已恢复冻结的导入记录；本次没有自动提交，请先查回结果。' : '已恢复确认时保存的完整内容，本项尚未开始；可使用原请求继续或取消未开始项。', warnings: [] }
}
const bridge = () => {
  const native = window.electronAPI
  return typeof native?.getPathForFile === 'function' && typeof native?.importPaths === 'function' && typeof native?.cancelImport === 'function' ? native : null
}
const errorText = error => error?.message || '操作未完成，请重试。'

export default function ImportWorkspace({ initialPaths = [], onClose, onChanged, onOpenNote }) {
  const initial = useRef(initialPaths.slice())
  const callbacks = useRef({ onClose, onChanged, onOpenNote })
  callbacks.current = { onClose, onChanged, onOpenNote }
  const lifetime = useRef(0), mounted = useRef(false), operation = useRef(null), folderOperation = useRef(null)
  const ledgerRef = useRef(null), operationsRef = useRef(null), composing = useRef(new Set())
  const recordRead = useRef(0)
  const panel = useRef(null), previousFocus = useRef(document.activeElement), opened = useRef(false)
  const rowsRef = useRef([])
  const [rows, setRows] = useState([]), [corrupt, setCorrupt] = useState([])
  const [busy, setBusy] = useState(false), [ime, setIme] = useState(false)
  const [message, setMessage] = useState(''), [storageError, setStorageError] = useState('')
  const [recordLoading, setRecordLoading] = useState(true), [recovery, setRecovery] = useState({})
  const [folders, setFolders] = useState([]), [folderState, setFolderState] = useState('loading'), [folderError, setFolderError] = useState('')
  const updateRows = action => {
    const next = typeof action === 'function' ? action(rowsRef.current) : action
    rowsRef.current = next
    if (mounted.current) setRows(next)
  }
  const updateRow = (id, patch) => updateRows(current => current.map(row => rowId(row) === id ? { ...row, ...patch } : row))
  const valid = task => mounted.current && operation.current === task && !task.controller.signal.aborted
  const start = kind => {
    if (operation.current) return null
    const task = { kind, controller: new AbortController(), parserId: null }
    operation.current = task; setBusy(true); setMessage('')
    return task
  }
  const finish = task => { if (operation.current === task) { operation.current = null; if (mounted.current) setBusy(false) } }
  const stop = (announce = true) => {
    const task = operation.current
    if (!task) return
    task.controller.abort()
    if (task.parserId) { try { Promise.resolve(window.electronAPI?.cancelImport(task.parserId)).catch(() => {}) } catch {} }
    operation.current = null
    if (mounted.current) {
      setBusy(false)
      // The attempt marker is written synchronously before POST. Re-read it so
      // an aborted UI never retains an older journal snapshot for the retry.
      let persisted = new Map()
      try { persisted = new Map(ledgerRef.current?.list().filter(entry => entry.value).map(entry => [entry.value.requestId, entry]) || []) } catch (error) { setStorageError(errorText(error)) }
      updateRows(current => current.map(row => {
        if (row.status !== 'submitting') return row
        const entry = row.entry && (persisted.get(row.entry.value.requestId) || row.entry)
        return entry ? { ...row, entry, status: canCancelImport(entry) ? 'pending' : 'unknown', message: canCancelImport(entry) ? '已停止，本项尚未开始；可以继续原请求或取消。' : '已停止等待，请查回结果；不会自动继续下一项。' } : { ...row, status: 'prepared', message: '已停止，本项尚未提交。' }
      }))
      if (announce) setMessage('已停止。已发送项目保留原请求等待查回；尚未发送的项目不会继续写入。')
    }
  }
  const close = () => { stop(false); folderOperation.current?.abort(); callbacks.current.onClose?.() }

  const readRecords = async (preservePreview = true) => {
    const sequence = ++recordRead.current, epoch = lifetime.current
    setRecordLoading(true)
    try {
      if (!ledgerRef.current) {
        ledgerRef.current = createImportLedger(window.localStorage)
        operationsRef.current = createImportOperations(api, ledgerRef.current)
      }
      const entries = await ledgerRef.current.inspect(), errors = entries.filter(entry => entry.error)
      if (!mounted.current || sequence !== recordRead.current || epoch !== lifetime.current) return null
      setCorrupt(errors); setStorageError('')
      const present = new Set(entries.map(entry => entry.key))
      updateRows(current => [...(preservePreview ? current.flatMap(row => {
        if (!row.entry) return [row]
        if (row.reservationFailure && !present.has(row.entry.key)) return [{ ...row, entry: null, reservationFailure: false, status: 'prepared', selected: true, message: '完整读取确认本项未存入记录且未发送；可以重新预检和确认。' }]
        return []
      }) : []), ...entries.filter(entry => entry.value).map(fromEntry)])
      return entries
    } catch (error) { if (mounted.current && sequence === recordRead.current && epoch === lifetime.current) setStorageError(errorText(error)); return null }
    finally { if (mounted.current && sequence === recordRead.current && epoch === lifetime.current) setRecordLoading(false) }
  }
  const loadFolders = async () => {
    folderOperation.current?.abort()
    const controller = new AbortController(), epoch = lifetime.current
    folderOperation.current = controller; setFolderState('loading'); setFolderError('')
    try {
      const all = await dailyRequest((_, init) => listAllFiles('', { signal: init.signal, strict: true }), '', { signal: controller.signal }, 10000)
      const choices = importFolders(all)
      if (!mounted.current || lifetime.current !== epoch || folderOperation.current !== controller || controller.signal.aborted) return
      setFolders(choices); setFolderState('ready')
    } catch (error) {
      if (!mounted.current || lifetime.current !== epoch || folderOperation.current !== controller || controller.signal.aborted) return
      setFolders([]); setFolderState('error'); setFolderError(errorText(error) + ' 未采用不完整的目录，当前不能确认导入。')
    }
  }

  const parsePaths = async (paths, sourceErrors = []) => {
    if (!bridge()) { setMessage('本地文档导入需要桌面客户端。当前缺少桌面文件接口，未读取或导入任何文件。'); return }
    if (rowsRef.current.length || corrupt.length || storageError) { setMessage('当前批次或本地记录尚未处理，请先核对并清理，再选择新文件。'); return }
    if (!Array.isArray(paths) || !paths.length || paths.length + sourceErrors.length > LOCAL_IMPORT_COUNT || paths.some(path => typeof path !== 'string' || !path || path.length > 32768 || /[\x00-\x1f]/.test(path)) || new Set(paths).size !== paths.length) { setMessage('每批请选择1–20个不同的本地文件；没有发送解析请求。'); return }
    const task = start('parse')
    if (!task) return
    try {
      task.parserId = crypto.randomUUID()
      const response = await dailyRequest(() => bridge().importPaths(paths, { requestId: task.parserId }), '', { signal: task.controller.signal }, 65000)
      if (!valid(task)) return
      if (!response || response.success !== true || !Array.isArray(response.results) || response.results.length !== paths.length || response.results.some((item, index) => !item || item.originalPath !== paths[index])) throw new Error('桌面转换结果缺失或文件身份不匹配，未采用这批内容。')
      let total = 0
      const prepared = response.results.map(item => {
        const sourceId = crypto.randomUUID(), sourceTitle = typeof item.title === 'string' && item.title ? item.title : item.originalPath.split(/[\\/]/).at(-1)
        const base = { sourceId, sourceTitle, title: sourceTitle, parentId: '', selected: false, warnings: [], content: '', preview: '', bytes: 0 }
        if (item.error === true || item.success !== true) return { ...base, status: 'error', code: item.code || 'invalid-document', message: typeof item.message === 'string' ? item.message.slice(0, 2000) : '该文件未能转换。' }
        try {
          const parsed = validateImportedBody(normalizeImportedContent(validateNativeImportResult(item)))
          if (total + parsed.bytes > LOCAL_IMPORT_LIMIT) throw new Error('本批预备正文超过2 MiB；该项未加入，请分批导入。')
          total += parsed.bytes
          return { ...base, ...parsed, status: 'prepared', selected: true, warnings: item.warnings || [], format: item.format || item.contentType, message: '' }
        } catch (error) { return { ...base, status: 'error', code: 'invalid-document', message: errorText(error) } }
      })
      updateRows([...prepared, ...sourceErrors]); setMessage('转换完成。请检查标题、导入位置和内容，再确认所选文档。预览不会写入笔记。')
    } catch (error) {
      if (valid(task)) {
        updateRows([...paths.map(path => ({ sourceId: crypto.randomUUID(), sourceTitle: path.split(/[\\/]/).at(-1), title: path.split(/[\\/]/).at(-1), status: 'error', selected: false, warnings: [], message: errorText(error) })), ...sourceErrors])
        setMessage('本批文件未能完成转换，没有写入笔记。可清空预览后重新选择。')
      }
    } finally {
      if (task.parserId) { try { Promise.resolve(window.electronAPI?.cancelImport(task.parserId)).catch(() => {}) } catch {} }
      finish(task)
    }
  }
  const chooseFiles = async event => {
    const files = Array.from(event.target.files || []); event.target.value = ''
    if (!files.length) return
    if (operation.current || rowsRef.current.length || corrupt.length || storageError || recordLoading) { setMessage('请先处理当前批次和本地记录，再选择新文件。'); return }
    if (!bridge()) { setMessage('本地文档导入需要桌面客户端。当前缺少桌面文件接口。'); return }
    if (files.length > LOCAL_IMPORT_COUNT) { setMessage('每批最多20个文件，请重新选择。'); return }
    const paths = [], errors = []
    for (const file of files) {
      try {
        if (file.size > LOCAL_IMPORT_FILE_LIMIT) throw new Error('文件超过50 MiB，未读取。')
        const path = bridge().getPathForFile(file)
        if (typeof path !== 'string' || !path) throw new Error('无法取得本地文件路径，请重新选择。')
        paths.push(path)
      } catch (error) { errors.push({ sourceId: crypto.randomUUID(), sourceTitle: file.name, title: file.name, status: 'error', selected: false, warnings: [], message: errorText(error) }) }
    }
    if (!paths.length) { updateRows(errors); setMessage('所选文件均未通过读取检查，没有写入笔记。'); return }
    await parsePaths(paths, errors)
  }

  const applyResult = (id, result) => {
    updateRow(id, { entry: result.entry, status: result.status, receipt: result.receipt, message: result.message, storageError: result.storageError || '', selected: false })
    if (result.storageError) setStorageError(result.storageError)
    if (result.status === 'committed') {
      const epoch = lifetime.current
      try { Promise.resolve(callbacks.current.onChanged?.()).catch(() => { if (mounted.current && lifetime.current === epoch) setMessage('导入已确认，但笔记列表暂时未能刷新；可重新打开工作台或查回。') }) }
      catch { setMessage('导入已确认，但笔记列表暂时未能刷新；可查回并打开笔记。') }
    }
  }
  const confirm = async () => {
    if (operation.current || composing.current.size || folderState !== 'ready' || storageError || corrupt.length || recordLoading || !ledgerRef.current) return
    const selected = rowsRef.current.filter(row => row.status === 'prepared' && row.selected && !row.entry)
    if (!selected.length) return
    let invalid = false
    for (const row of selected) {
      try { importTitle(row.title); validateImportedBody(row.content); if (!folders.some(folder => folder.id === row.parentId)) throw new Error('导入目录已不在完整列表中，请重新选择。') }
      catch (error) { invalid = true; updateRow(rowId(row), { message: errorText(error) }) }
    }
    const duplicateNames = new Map()
    for (const row of selected) {
      const key = row.parentId + '\0' + row.title.replace(/[A-Z]/g, char => char.toLowerCase())
      duplicateNames.set(key, [...(duplicateNames.get(key) || []), row])
    }
    for (const group of duplicateNames.values()) if (group.length > 1) {
      invalid = true
      for (const row of group) updateRow(rowId(row), { message: '本批次在同一目录有重复标题，请调整标题或取消勾选后再确认。' })
    }
    if (invalid) { setMessage('请修正所选文档的标题或目录后再确认。'); return }
    const task = start('commit')
    if (!task) return
    try {
      const reserved = []
      for (const row of selected) {
        if (!valid(task)) break
        let id = rowId(row)
        updateRow(id, { status: 'submitting', message: '正在保存本地请求记录…' })
        try {
          const entry = await ledgerRef.current.reserve({ title: row.title, content: row.content, parent_id: row.parentId }, row.sourceTitle, task.controller.signal)
          if (!valid(task)) break
          updateRow(id, { entry, status: 'pending', selected: false, message: '完整内容已保存，本项尚未开始。' })
          reserved.push(entry)
        } catch (error) {
          if (valid(task)) { updateRow(id, error.entry ? { entry: error.entry, reservationFailure: true, status: 'pending', selected: false, message: '本地写入校验未完成，原请求标识已保留；请先重读记录。' } : { status: 'prepared', message: errorText(error) }); setStorageError(errorText(error)); setMessage('本地记录未能可靠保存，本批没有继续写入。') }
          return
        }
      }
      // The entire confirmed selection is durable before its first POST.
      // Closing midway preserves even the not-yet-started selected documents.
      for (const entry of reserved) {
        if (!valid(task)) break
        const id = entry.value.requestId
        updateRow(id, { status: 'submitting', message: '本地请求已保存，正在核对并提交…' })
        const result = await operationsRef.current.run(entry, { send: true, signal: task.controller.signal })
        if (!valid(task)) break
        applyResult(id, result)
        if (result.status === 'unknown' || result.storageError) { setMessage('本批已停止在待核对项目，其他项目不会自动继续。请先查回结果。'); break }
      }
    } finally { finish(task) }
  }
  const reconcile = async (row, send) => {
    if (operation.current || !row.entry || corrupt.length || storageError || (send && !bridge())) return
    const task = start('reconcile')
    if (!task) return
    const id = rowId(row)
    updateRow(id, { status: 'submitting', message: send ? '先查回原请求，必要时以同一标识和正文继续…' : '正在只读查回结果…' })
    try {
      const result = await operationsRef.current.run(row.entry, { send, signal: task.controller.signal })
      if (valid(task)) applyResult(id, result)
    } finally { finish(task) }
  }
  const revise = row => {
    if (operation.current || row.status !== 'rejected' || !canClearImport(row.entry) || storageError) return
    try {
      ledgerRef.current.remove(row.entry)
      updateRow(rowId(row), { sourceId: crypto.randomUUID(), entry: null, status: 'prepared', selected: true, receipt: null, message: '原请求已明确拒绝。正文已保留，请修改标题或目录，再确认导入。', storageError: '' })
    } catch (error) { setStorageError(errorText(error)) }
  }
  const clearRows = only => {
    if (operation.current || storageError) return
    for (const row of rowsRef.current.filter(row => row.entry && canClearImport(row.entry) && (!only || rowId(row) === only))) {
      try { ledgerRef.current.remove(row.entry); updateRows(current => current.filter(item => rowId(item) !== rowId(row))) }
      catch (error) { setStorageError(errorText(error)); break }
    }
  }
  const cancelUnstarted = row => {
    if (operation.current || storageError || recordLoading) return
    try { ledgerRef.current.cancel(row.entry); updateRows(current => current.filter(item => rowId(item) !== rowId(row))); setMessage('已取消尚未开始的项目，没有发送创建请求。') }
    catch (error) { setStorageError(errorText(error)) }
  }
  const exportRecord = entry => {
    try {
      const url = URL.createObjectURL(new Blob([entry.raw ?? ''], { type: 'application/json' })), a = document.createElement('a')
      a.href = url; a.download = 'local-import-record-' + entry.key.slice(-36).replace(/[^a-z0-9-]/gi, '_') + '.json'; document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('已提供本项恢复记录导出，请妥善保存；导出不会清理记录或发送请求。')
    } catch { setMessage('原记录暂时无法导出，请保留本地存储并重试。') }
  }
  const restoreRecord = async entry => {
    const task = start('restore')
    if (!task) return
    try {
      await ledgerRef.current.restore(entry, recovery[entry.key] || '', task.controller.signal)
      if (valid(task)) { await readRecords(); if (valid(task)) setMessage('同一请求的有效备份已恢复。未自动发送，请先查回结果。') }
    } catch (error) { if (valid(task)) setMessage(errorText(error)) }
    finally { finish(task) }
  }
  const openNote = async row => {
    if (row.receipt?.state !== 'available' || operation.current) return
    const task = start('open')
    if (!task) return
    try {
      const accepted = await callbacks.current.onOpenNote?.(row.receipt.file_id, { signal: task.controller.signal, shouldSelect: () => valid(task) })
      if (valid(task)) {
        if (accepted === true) { opened.current = true; finish(task); close() }
        else setMessage('打开已取消或目标暂不可用；当前工作台与原笔记保持可继续操作。')
      }
    } catch { if (valid(task)) setMessage('目标笔记暂时无法打开，请查回当前状态后重试。') }
    finally { finish(task) }
  }

  useEffect(() => {
    mounted.current = true
    const epoch = ++lifetime.current
    const focusTimer = setTimeout(() => { if (mounted.current && lifetime.current === epoch) panel.current?.querySelector('[data-local-import-close]')?.focus() }, 0)
    loadFolders()
    if (!bridge()) setMessage('本地文档导入需要桌面客户端。当前缺少桌面文件接口，未读取或导入任何文件。')
    readRecords(false).then(entries => {
      if (!mounted.current || lifetime.current !== epoch || !initial.current.length) return
      if (!entries || entries.length) setMessage('发现未清理的本地导入记录。本次拖入文件未覆盖原批次；请先查回、处理并清理记录，再重新选择文件。')
      else parsePaths(initial.current)
    })
    return () => {
      clearTimeout(focusTimer); mounted.current = false; ++lifetime.current; stop(false); folderOperation.current?.abort()
      if (!opened.current && (panel.current?.contains(document.activeElement) || document.activeElement === document.body)) {
        const target = previousFocus.current?.isConnected && previousFocus.current !== document.body ? previousFocus.current : document.querySelector('[aria-label="更多笔记操作"]')
        target?.focus?.()
      }
    }
  }, [])

  const onKeyDown = event => {
    if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229 || composing.current.size) {
      if (event.key === 'Escape') event.stopPropagation()
      return
    }
    // The existing editor dialog owns Escape while a guarded open is awaiting
    // save/discard/cancel. Its document listener must see the original event.
    if (operation.current?.kind === 'open' && document.querySelector('.consumer-confirm-modal')) return
    if (event.key === 'Escape') { event.stopPropagation(); close(); return }
    if (event.key !== 'Tab' || operation.current?.kind === 'open') return
    const candidates = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')]
    const available = candidates.filter(element => { const closed = element.closest('details:not([open])'); return !closed || closed.querySelector('summary') === element })
    const first = available[0], last = available.at(-1)
    if (!first) { event.preventDefault(); panel.current.focus(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const selectedCount = rows.filter(row => row.status === 'prepared' && row.selected && !row.entry).length
  const hasRecord = rows.some(row => row.entry), pendingRecords = rows.some(row => row.entry && !canClearImport(row.entry))
  const hasClearable = rows.some(row => canClearImport(row.entry)), blocked = busy || recordLoading || !!storageError || !!corrupt.length
  return <div className="modal-overlay local-import-overlay">
    <section ref={panel} tabIndex={-1} className="local-import-workspace" role="dialog" aria-modal="true" aria-label="本地文档导入工作台" data-local-import-workspace="" onKeyDown={onKeyDown}>
      <header>
        <div><span className="local-import-eyebrow">本地文档</span><h2>导入工作台</h2><p>先预览，再选择标题和位置。确认后逐项创建独立笔记。</p></div>
        <div className="local-import-actions"><button type="button" className="btn" data-local-import-stop="" aria-label="停止当前导入操作" onClick={() => stop()} disabled={!busy}>停止</button><button type="button" className="btn" data-local-import-close="" aria-label="关闭本地文档导入工作台" onClick={close}>关闭</button></div>
      </header>
      <div className="local-import-intro">
        <label className="local-import-picker">选择本地文件<input type="file" multiple accept={accept} data-local-import-input="" aria-label="选择要导入的本地文档" onChange={chooseFiles} disabled={!bridge() || blocked || rows.length > 0} /></label>
        <p>支持 Markdown、TXT、Word 和 Excel。每批最多20个文件，每个文件最多50 MiB；转换后单项及本批正文最多2 MiB。Excel包含全部受支持的工作表；转换差异会逐项提示。</p>
        <p>确认后先保存整批内容，再逐项写入。关闭后已保存的确认记录会保留；尚未确认或尚未保存的预览需重新选择。源文件不会被修改。</p>
      </div>
      {message && <p className="local-import-notice" role="status">{message}</p>}
      {(storageError || corrupt.length > 0) && <div className="local-import-fault" role="alert"><strong>本地记录需要处理，当前禁止提交。</strong>{storageError && <p>{storageError}</p>}{corrupt.map(entry => <div key={entry.key} data-local-import-corrupt={entry.key}><p>{entry.error}</p><details><summary>导出原记录或从同一请求的备份恢复</summary><p>请先保留原记录。粘贴完整JSON备份并确认恢复；请求标识及正文指纹必须一致。恢复后先查回，不会自动发送。</p><button type="button" className="btn" data-local-import-export-record={entry.key} aria-label="导出损坏的本地导入记录" onClick={() => exportRecord(entry)}>导出原记录</button><label>该记录的完整备份<textarea data-local-import-recovery-input={entry.key} aria-label="粘贴同一导入请求的完整备份" value={recovery[entry.key] || ''} onChange={event => setRecovery(current => ({ ...current, [entry.key]: event.target.value }))} disabled={busy}/></label><button type="button" className="btn" data-local-import-restore-record={entry.key} aria-label="校验并恢复该导入记录" disabled={busy || recordLoading || !recovery[entry.key]} onClick={() => restoreRecord(entry)}>校验并恢复该记录</button></details></div>)}<p>原记录未被静默删除；结果未知的项目不能清理或换标识重建。</p></div>}
      <div className="local-import-toolbar">
        <span role="status">{folderState === 'loading' ? '正在完整读取导入目录…' : folderState === 'ready' ? `已读取${folders.length}个可选位置` : '导入目录尚未完整读取'}</span>
        <button type="button" className="btn" data-local-import-folders-refresh="" aria-label="重新读取全部导入目录" disabled={busy || folderState === 'loading'} onClick={loadFolders}>刷新目录</button>
        <button type="button" className="btn" data-local-import-ledger-refresh="" aria-label="重新读取本地导入记录" disabled={busy || recordLoading} onClick={() => readRecords()}>{recordLoading ? '正在校验本地记录…' : '重读本地记录'}</button>
      </div>
      {folderError && <p role="alert" className="local-import-fault">{folderError}</p>}
      {hasRecord && <p className="local-import-notice">已发送的项目会冻结标题、正文和位置。查回只读取结果；“使用原请求继续”会先查回，再按同一标识和内容提交。{pendingRecords && ' 结果未知或身份冲突的记录不能清理。'}</p>}
      <div className="local-import-rows">
        {rows.map(row => {
          const id = rowId(row), frozen = !!row.entry, editable = row.status === 'prepared' && !frozen
          const label = names[row.status] || '等待处理'
          const destination = folders.find(folder => folder.id === row.parentId)
          const canRevise = row.status === 'rejected' && canClearImport(row.entry)
          return <article key={row.sourceId} data-local-import-row={id} data-local-import-state={row.status} data-local-import-request-id={row.entry?.value.requestId || ''} className={'local-import-row local-import-' + row.status}>
            <div className="local-import-row-heading"><label className="local-import-check"><input type="checkbox" data-local-import-selected={id} aria-label={'选择导入 ' + row.sourceTitle} checked={row.selected} disabled={!editable || busy} onChange={event => updateRow(id, { selected: event.target.checked })}/><strong>{row.sourceTitle}</strong></label><span className="local-import-badge">{label}</span></div>
            {(editable || frozen) && <div className="local-import-fields">
              <label>笔记标题<input value={row.title} data-local-import-title={id} aria-label={'导入标题 ' + row.sourceTitle} disabled={!editable || busy} onChange={event => updateRow(id, { title: event.target.value, message: '' })} onCompositionStart={() => { composing.current.add(id); setIme(true) }} onCompositionEnd={event => { updateRow(id, { title: event.currentTarget.value }); composing.current.delete(id); setIme(composing.current.size > 0) }} /></label>
              <label>导入位置<select value={row.parentId} data-local-import-destination={id} aria-label={'导入目录 ' + row.sourceTitle} disabled={!editable || busy || folderState !== 'ready'} onChange={event => updateRow(id, { parentId: event.target.value, message: '' })}>{!destination && <option value={row.parentId}>{folderState === 'ready' ? '原目录已不可用，请重新选择' : '等待完整读取目录'}</option>}{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.label}</option>)}</select></label>
            </div>}
            {row.warnings?.length > 0 && <ul className="local-import-warnings">{row.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
            {row.preview !== undefined && row.content && <details open={rows.length === 1} className="local-import-preview"><summary>查看转换内容 · {(row.bytes / 1024).toFixed(1)} KiB</summary><pre data-local-import-preview={id} aria-label={'导入正文预览 ' + row.sourceTitle}>{row.preview || '（空文档）'}</pre></details>}
            {row.message && <p className="local-import-row-message" role={row.status === 'error' || row.status === 'rejected' ? 'alert' : 'status'}>{row.message}</p>}
            {row.storageError && <p role="alert">{row.storageError} 已收到的确认结果仍保留在当前窗口，请重读记录后查回。</p>}
            {frozen && <div className="local-import-actions">
              <button type="button" className="btn" data-local-import-refresh={id} aria-label={'查回导入结果 ' + row.title} disabled={blocked} onClick={() => reconcile(row, false)}>查回结果</button>
              {!row.entry.value.outcome && <button type="button" className="btn" data-local-import-retry={id} aria-label={'使用原请求继续导入 ' + row.title} disabled={blocked || !bridge()} onClick={() => reconcile(row, true)}>使用原请求继续</button>}
              {canCancelImport(row.entry) && <button type="button" className="btn" data-local-import-cancel={id} aria-label={'取消尚未开始的导入 ' + row.title} disabled={blocked} onClick={() => cancelUnstarted(row)}>取消未开始项</button>}
              {canRevise && <button type="button" className="btn" data-local-import-revise={id} aria-label={'返回预检修改 ' + row.title} disabled={blocked} onClick={() => revise(row)}>返回预检修改</button>}
              {row.receipt?.state === 'available' && <button type="button" className="btn primary" data-local-import-open={id} aria-label={'打开已导入笔记 ' + row.title} disabled={busy} onClick={() => openNote(row)}>打开笔记</button>}
              {canClearImport(row.entry) && <button type="button" className="btn" data-local-import-clear-row={id} aria-label={'清理已确认导入记录 ' + row.title} disabled={blocked} onClick={() => clearRows(id)}>清理记录</button>}
              <button type="button" className="btn" data-local-import-export-record={id} aria-label={'导出本项恢复记录 ' + row.title} disabled={busy || recordLoading} onClick={() => exportRecord(row.entry)}>导出本项恢复记录</button>
            </div>}
            {row.receipt && row.receipt.state !== 'available' && <p>笔记{row.receipt.state === 'deleted' ? '已删除' : '已不在当前数据库'}，不会重新创建。</p>}
          </article>
        })}
      </div>
      {!rows.length && !busy && <div className="local-import-empty">选择文件后，在这里逐项预览和确认。</div>}
      {busy && <p role="status" className="local-import-notice">{operation.current?.kind === 'parse' ? '正在本机转换文件，请等待或停止…' : operation.current?.kind === 'open' ? '正在读取笔记并等待原编辑器的保存决定…' : '正在逐项核对导入结果，请等待或停止…'}</p>}
      <footer><div><strong>{rows.length}项 · 已选{selectedCount}项</strong><p>清理仅移除本地处理记录，不会删除已导入的笔记。</p></div><div className="local-import-actions">
        <button type="button" className="btn" data-local-import-reset="" aria-label="清空未确认的导入预览" disabled={busy || !rows.some(row => !row.entry)} onClick={() => { updateRows(current => current.filter(row => row.entry)); composing.current.clear(); setIme(false); setMessage('未确认预览已清空，已发送的本地记录保留。') }}>清空未确认预览</button>
        <button type="button" className="btn" data-local-import-clear="" aria-label="清理全部已确认导入记录" disabled={blocked || !hasClearable} onClick={() => clearRows()}>清理已确认记录</button>
        <button type="button" className="btn primary" data-local-import-confirm="" aria-label="确认导入所选文档" disabled={blocked || ime || folderState !== 'ready' || !selectedCount} onClick={confirm}>确认导入所选文档（{selectedCount}）</button>
      </div></footer>
    </section>
  </div>
}
