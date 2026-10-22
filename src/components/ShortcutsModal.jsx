import React from 'react'
import useLocalShortcuts from '../hooks/useLocalShortcuts'
import {
  FIXED_SHORTCUTS,
  SHORTCUT_COMMANDS,
  applyShortcutBindings,
  captureShortcut,
  findShortcutConflict,
  formatShortcut,
  getDefaultShortcutBindings,
  reloadShortcutPreferences,
  validateShortcutBindings,
} from '../services/localShortcuts'
import './ShortcutsModal.css'

const gestures = [
  ['Ctrl / ⌘ + A、X', '全选或剪切'],
  ['Ctrl / ⌘ + B、I、U', '加粗、斜体或下划线'],
  ['Ctrl / ⌘ + Enter', '勾选或取消当前待办'],
  ['↑ / ↓、← / →', '移动列表选择，展开或折叠文件夹'],
  ['Enter / Delete', '打开当前项目，或将其移到回收站'],
  ['Escape', '取消当前操作或关闭面板'],
  ['Alt + 1～6', '切换项目工作台视图'],
  ['Ctrl / ⌘ + 点击', '打开链接或跳转章节'],
  ['Ctrl / ⌘ + 滚轮', '调整写作视图正文字号'],
  ['$ + 空格、$公式$ + 空格', '插入独立公式或转换行内公式'],
  ['[[笔记#章节', '插入跨笔记章节引用'],
]

function sameBindings(left, right) {
  return SHORTCUT_COMMANDS.every(command => left[command.id] === right[command.id])
}

function eventIsComposing(event) {
  return event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229
}

function focusableElements(container) {
  return [...container.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')]
    .filter(element => !element.closest('[hidden], [aria-hidden="true"]'))
}

function ShortcutSettingsSession({ onClose }) {
  const snapshot = useLocalShortcuts()
  const [baseline, setBaseline] = React.useState(snapshot)
  const [draft, setDraft] = React.useState(() => ({ ...snapshot.bindings }))
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState('全部')
  const [recording, setRecording] = React.useState(null)
  const [confirmation, setConfirmation] = React.useState(null)
  const [repairInvalid, setRepairInvalid] = React.useState(false)
  const [resetPending, setResetPending] = React.useState(false)
  const [externalChanged, setExternalChanged] = React.useState(false)
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')
  const dialogRef = React.useRef(null)
  const searchRef = React.useRef(null)
  const scrollRef = React.useRef(null)
  const recorderRef = React.useRef(null)
  const recorderPanelRef = React.useRef(null)
  const returnFocusRef = React.useRef(null)
  const composingSearch = React.useRef(false)
  const changedCount = SHORTCUT_COMMANDS.filter(command => draft[command.id] !== baseline.bindings[command.id]).length
  const dirty = changedCount > 0 || repairInvalid || resetPending

  React.useLayoutEffect(() => {
    const dialog = dialogRef.current
    returnFocusRef.current = document.activeElement
    searchRef.current?.focus()
    return () => {
      const previous = returnFocusRef.current
      const active = document.activeElement
      if (previous?.isConnected && (active === document.body || !active || dialog?.contains(active))) previous.focus?.()
    }
  }, [])

  React.useLayoutEffect(() => {
    if (recording) recorderRef.current?.focus({ preventScroll: true })
  }, [recording?.commandId])

  React.useLayoutEffect(() => {
    if (!recording) return
    const scroll = scrollRef.current
    const panel = recorderPanelRef.current
    if (!scroll || !panel) return
    let active = true

    function revealRecording() {
      if (!active || !scroll.isConnected || !panel.isConnected || recorderPanelRef.current !== panel) return
      if (!panel.contains(document.activeElement)) return
      const viewport = scroll.getBoundingClientRect()
      const card = panel.getBoundingClientRect()
      const top = viewport.top + scroll.clientTop + 8
      const bottom = viewport.top + scroll.clientTop + scroll.clientHeight - 8
      const available = bottom - top
      if (available <= 0 || card.height <= 0) return

      let start = card.top
      let end = card.bottom
      if (card.height > available) {
        // On unusually short windows, keep the active input and its feedback
        // together; keyboard navigation can still reveal the other controls.
        const input = recorderRef.current?.getBoundingClientRect()
        const feedback = panel.querySelector('[role="alert"]')?.getBoundingClientRect()
        if (input?.height > 0) {
          start = input.top
          end = feedback?.height > 0 ? feedback.bottom : input.bottom
        }
        const focused = document.activeElement
        if (focused !== recorderRef.current && panel.contains(focused)) {
          const control = focused.getBoundingClientRect()
          if (control.height > 0) { start = control.top; end = control.bottom }
        }
        if (end - start > available) start = end - available
      }

      const delta = end > bottom ? end - bottom : start < top ? start - top : 0
      if (delta) scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, scroll.scrollTop + delta))
    }

    revealRecording()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(revealRecording) : null
    observer?.observe(scroll)
    observer?.observe(panel)
    window.addEventListener('resize', revealRecording)
    return () => {
      active = false
      observer?.disconnect()
      window.removeEventListener('resize', revealRecording)
    }
  }, [recording?.commandId, recording?.candidate, recording?.error])

  React.useEffect(() => {
    if (snapshot.revision === baseline.revision) return
    if (sameBindings(snapshot.bindings, baseline.bindings)) {
      setBaseline(snapshot)
      return
    }
    if (dirty || recording) {
      setExternalChanged(true)
      return
    }
    setBaseline(snapshot)
    setDraft({ ...snapshot.bindings })
    setExternalChanged(false)
    setMessage('快捷键已更新为本机最新设置。')
  }, [snapshot, baseline.revision, dirty, recording])

  const categories = [...new Set(SHORTCUT_COMMANDS.map(command => command.category))]
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const normalizedBindingQuery = normalizedQuery.replace(/\s*\+\s*/g, '+')
  const visibleCommands = SHORTCUT_COMMANDS.filter(command => {
    if (category !== '全部' && command.category !== category) return false
    if (!normalizedQuery) return true
    const binding = formatShortcut(draft[command.id])
    return [command.label, command.category, command.description, ...(command.keywords || []), binding]
      .join(' ').toLocaleLowerCase().includes(normalizedQuery)
      || binding.toLocaleLowerCase().replace(/\s*\+\s*/g, '+').includes(normalizedBindingQuery)
  })

  function clearFeedback() {
    setError('')
    setMessage('')
    setConfirmation(null)
  }

  function replaceDraft(next) {
    const validation = validateShortcutBindings(next)
    if (!validation.ok) {
      setError(validation.error?.message || '这组快捷键无法应用，请检查组合键和冲突。')
      return false
    }
    setDraft({ ...validation.bindings })
    clearFeedback()
    return true
  }

  function startRecording(command, candidate = null) {
    clearFeedback()
    setRecording({ commandId: command.id, candidate, error: '' })
  }

  function closeRecording() {
    const id = recording?.commandId
    setRecording(null)
    if (id) dialogRef.current?.querySelector(`[data-shortcut-edit="${id}"]`)?.focus()
  }

  function recordKey(event) {
    if (event.key === 'Tab') return
    if (eventIsComposing(event) || event.repeat || event.getModifierState?.('AltGraph') || event.nativeEvent?.getModifierState?.('AltGraph')) {
      event.stopPropagation()
      return
    }
    const modifierOnly = ['Control', 'Meta', 'Shift', 'Alt', 'AltGraph'].includes(event.key)
    const result = modifierOnly ? null : captureShortcut(event.nativeEvent || event)
    event.preventDefault()
    event.stopPropagation()
    if (!result) return
    setRecording(current => current ? {
      ...current,
      candidate: result.ok ? result.binding : null,
      error: result.ok ? '' : (result.error?.message || '这个组合键不能用于自定义操作。'),
    } : current)
  }

  function acceptRecording(replaceConflict = false) {
    if (!recording?.candidate) return
    const conflict = findShortcutConflict(draft, recording.commandId, recording.candidate)
    if (conflict && !replaceConflict) return
    const next = { ...draft, [recording.commandId]: recording.candidate }
    if (conflict) next[conflict.id] = null
    if (replaceDraft(next)) closeRecording()
  }

  function restoreCommand(command) {
    const binding = getDefaultShortcutBindings()[command.id]
    if (findShortcutConflict(draft, command.id, binding)) startRecording(command, binding)
    else if (replaceDraft({ ...draft, [command.id]: binding })) setRecording(null)
  }

  function restoreAll() {
    const defaults = getDefaultShortcutBindings()
    if (!replaceDraft(defaults)) return
    setRecording(null)
    setBaseline(snapshot)
    setExternalChanged(false)
    setRepairInvalid(snapshot.status === 'invalid')
    setResetPending(snapshot.status !== 'ready')
    setMessage(snapshot.status === 'ready' && sameBindings(snapshot.bindings, defaults)
      ? '当前已使用默认快捷键。'
      : '已选用默认快捷键，点击“应用”后生效。')
  }

  function requestClose() {
    if (recording) setRecording(null)
    if (dirty) setConfirmation('close')
    else onClose?.()
  }

  function loadLatest() {
    const result = reloadShortcutPreferences()
    if (!result.ok) {
      setError(result.error?.message || '暂时无法读取本机设置，请稍后重试。')
      setConfirmation(null)
      return
    }
    setBaseline(result.snapshot)
    setDraft({ ...result.snapshot.bindings })
    setExternalChanged(false)
    setRepairInvalid(false)
    setResetPending(false)
    setRecording(null)
    clearFeedback()
    setMessage('已读取本机最新设置。')
  }

  function requestReload() {
    if (dirty || recording) setConfirmation('reload')
    else loadLatest()
  }

  function apply() {
    clearFeedback()
    if (externalChanged) {
      setError('本机快捷键已在其他窗口更改，请先重新读取，再应用修改。')
      return
    }
    const validation = validateShortcutBindings(draft)
    if (!validation.ok) {
      setError(validation.error?.message || '请先处理快捷键冲突。')
      return
    }
    const result = applyShortcutBindings(validation.bindings, { expectedRevision: baseline.revision, repairInvalid })
    if (!result.ok) {
      setError(result.error?.message || '快捷键尚未应用，请保留本页并重试。')
      return
    }
    setBaseline(result.snapshot)
    setDraft({ ...result.snapshot.bindings })
    setRepairInvalid(false)
    setResetPending(false)
    setExternalChanged(false)
    setMessage('已应用并保存到本机。')
  }

  function handleDialogKey(event) {
    if (eventIsComposing(event) || event.repeat) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (recording) closeRecording()
      else if (confirmation) setConfirmation(null)
      else requestClose()
    }
    if (event.key === 'Tab') {
      const focusable = focusableElements(dialogRef.current)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (!first) {
        event.preventDefault()
        dialogRef.current?.focus()
      } else if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  const activeRecording = SHORTCUT_COMMANDS.find(command => command.id === recording?.commandId)
  const recordingConflict = recording?.candidate ? findShortcutConflict(draft, recording.commandId, recording.candidate) : null
  const requiresRepair = snapshot.status === 'invalid' && !repairInvalid

  return (
    <div className="modal-overlay consumer-modal-overlay" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
      <section ref={dialogRef} className="modal consumer-modal shortcuts-modal consumer-shortcuts-modal local-shortcuts-settings"
        role="dialog" aria-modal="true" aria-labelledby="shortcuts-dialog-title" data-shortcut-settings="true" tabIndex={-1}
        onKeyDownCapture={handleDialogKey} onKeyDown={event => event.stopPropagation()}>
        <header className="selector-modal-header local-shortcuts-header">
          <div>
            <div className="local-shortcuts-eyebrow">本机设置</div>
            <h2 className="modal-title" id="shortcuts-dialog-title">快捷键</h2>
            <div className="modal-message">把常用操作设成顺手的按键。</div>
          </div>
          <button type="button" className="icon-btn" onClick={requestClose} aria-label="关闭快捷键设置" title="关闭">×</button>
        </header>

        {snapshot.status !== 'ready' && (
          <div className="local-shortcuts-notice" role="status">
            <span>{snapshot.message || (snapshot.status === 'invalid' ? '本地配置无法使用，当前采用默认快捷键。' : '本地设置暂时无法确认，请保留修改并重试。')}</span>
            {snapshot.status === 'invalid'
              ? <button type="button" className="btn" onClick={restoreAll}>恢复默认配置</button>
              : <button type="button" className="btn" onClick={requestReload}>重新读取</button>}
          </div>
        )}
        {externalChanged && (
          <div className="local-shortcuts-notice" role="status">
            <span>其他窗口已更改快捷键。你的修改仍保留在本页，请重新读取后再编辑。</span>
            <button type="button" className="btn" onClick={requestReload}>重新读取最新设置</button>
          </div>
        )}

        <div className="local-shortcuts-filters">
          <label className="local-shortcuts-search">
            <span aria-hidden="true">⌕</span>
            <input ref={searchRef} value={queryInput} placeholder="搜索操作或快捷键" aria-label="搜索快捷键" data-shortcut-search="true" maxLength={120}
              onCompositionStart={() => { composingSearch.current = true; setRecording(null) }}
              onCompositionEnd={event => { composingSearch.current = false; setQuery(event.currentTarget.value) }}
              onChange={event => { setQueryInput(event.target.value); setRecording(null); if (!composingSearch.current) setQuery(event.target.value) }} />
            {queryInput && <button type="button" className="icon-btn" aria-label="清除搜索" onClick={() => { setQueryInput(''); setQuery(''); searchRef.current?.focus() }}>×</button>}
          </label>
          <label className="local-shortcuts-category">
            <select aria-label="操作分类" value={category} onChange={event => { setCategory(event.target.value); setRecording(null) }}>
              <option value="全部">全部操作</option>
              {categories.map(value => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <div ref={scrollRef} className="local-shortcuts-scroll">
          <div className="local-shortcuts-list-summary">{visibleCommands.length} 项可配置操作<span>修改在应用后生效</span></div>
          {categories.map(group => {
            const commands = visibleCommands.filter(command => command.category === group)
            if (!commands.length) return null
            return <section className="local-shortcuts-group" key={group} aria-label={group}>
              <h3>{group}</h3>
              <div className="local-shortcuts-list">
                {commands.map(command => {
                  const changed = draft[command.id] !== baseline.bindings[command.id]
                  const isRecording = recording?.commandId === command.id
                  return <div className="local-shortcuts-row" key={command.id} data-shortcut-command={command.id}>
                    <div className="local-shortcuts-command">
                      <strong>{command.label}{changed && <span className="local-shortcuts-changed">待应用</span>}</strong>
                      <small>{command.description}</small>
                      {changed && <small>当前生效：{formatShortcut(snapshot.bindings[command.id])}</small>}
                    </div>
                    <button type="button" className="local-shortcuts-binding" data-shortcut-edit={command.id}
                      aria-label={`修改${command.label}快捷键`} aria-expanded={isRecording} onClick={() => startRecording(command)}>
                      <kbd>{formatShortcut(draft[command.id])}</kbd><span aria-hidden="true">修改</span>
                    </button>
                    <div className="local-shortcuts-row-actions">
                      <button type="button" className="local-shortcuts-text-button" disabled={draft[command.id] == null}
                        aria-label={`清除${command.label}快捷键`} onClick={() => { replaceDraft({ ...draft, [command.id]: null }); setRecording(null) }}>清除</button>
                      <button type="button" className="local-shortcuts-text-button" data-shortcut-reset={command.id} disabled={draft[command.id] === command.defaultBinding}
                        aria-label={`恢复${command.label}默认快捷键`} onClick={() => restoreCommand(command)}>默认</button>
                    </div>
                    {isRecording && (
                      <div ref={recorderPanelRef} className="local-shortcuts-recorder-panel">
                        <label htmlFor="shortcut-recorder">为“{activeRecording.label}”设置快捷键</label>
                        <input id="shortcut-recorder" ref={recorderRef} data-shortcut-recorder="true" readOnly
                          aria-label={`录入${activeRecording.label}快捷键`} aria-describedby={`shortcut-recording-hint${recording.error || recordingConflict ? ' shortcut-recording-feedback' : ''}`}
                          value={recording.candidate ? formatShortcut(recording.candidate) : '请按下组合键'} onKeyDownCapture={recordKey} />
                        <p id="shortcut-recording-hint">按下 Ctrl / ⌘ 与字母等组合键，或可用的功能键。按 Esc 取消录入。</p>
                        {recording.error && <p id="shortcut-recording-feedback" className="local-shortcuts-inline-error" role="alert">{recording.error}</p>}
                        {recordingConflict && <p id="shortcut-recording-feedback" className="local-shortcuts-inline-error" role="alert">
                          已用于“{recordingConflict.label}”。替换后，该操作将不再绑定快捷键。
                        </p>}
                        <div className="local-shortcuts-recorder-actions">
                          <button type="button" className="btn" onClick={closeRecording}>取消录入</button>
                          <button type="button" className="btn primary" disabled={!recording.candidate || Boolean(recording.error)}
                            onClick={() => acceptRecording(Boolean(recordingConflict))}>
                            {recordingConflict ? '替换冲突快捷键' : '使用此快捷键'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                })}
              </div>
            </section>
          })}
          {!visibleCommands.length && <div className="local-shortcuts-empty"><strong>没有匹配的操作</strong><span>试试其他名称，或切换到“全部操作”。</span></div>}

          <details className="local-shortcuts-reference">
            <summary>固定快捷键与输入手势</summary>
            <p>保存、输入和系统导航保留常用按键。快捷键只在对应操作可用时生效。</p>
            <dl>
              {FIXED_SHORTCUTS.map(({ binding, label }) => <div key={binding}><dt><kbd>{formatShortcut(binding)}</kbd></dt><dd>{label}</dd></div>)}
              {gestures.map(([key, label]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}
            </dl>
          </details>
        </div>

        <footer className="local-shortcuts-footer">
          {error && <div className="local-shortcuts-error" role="alert">{error}</div>}
          {confirmation ? <div className="local-shortcuts-confirmation" role="alert">
            <strong>{confirmation === 'reload' ? '放弃本页修改并重新读取？' : '还有未应用的修改，要放弃吗？'}</strong>
            <span>当前生效的快捷键不会因关闭本页而改变。</span>
            <div>
              <button type="button" className="btn" onClick={() => setConfirmation(null)}>继续编辑</button>
              <button type="button" className="btn" onClick={() => confirmation === 'reload' ? loadLatest() : onClose?.()}>
                {confirmation === 'reload' ? '放弃修改并重新读取' : '放弃修改并关闭'}
              </button>
            </div>
          </div> : <>
            <div className="local-shortcuts-status" role="status" aria-live="polite">
              {message || ((repairInvalid || resetPending) && changedCount === 0 ? '默认配置待恢复，点击“应用”确认。' : dirty ? `${changedCount} 项修改待应用${repairInvalid ? '，将同时恢复本地配置' : ''}。` : '当前快捷键已生效。')}
            </div>
            <div className="local-shortcuts-footer-actions">
              <button type="button" className="local-shortcuts-text-button" onClick={restoreAll}>全部恢复默认</button>
              <div>
                <button type="button" className="btn" onClick={requestClose}>{dirty ? '取消' : '完成'}</button>
                <button type="button" className="btn primary" data-shortcut-apply="true" disabled={!dirty || Boolean(recording) || externalChanged || requiresRepair} onClick={apply}>
                  {error || snapshot.status === 'unconfirmed' ? '重试应用' : '应用'}
                </button>
              </div>
            </div>
          </>}
        </footer>
      </section>
    </div>
  )
}

export default function ShortcutsModal({ open, onClose }) {
  return open ? <ShortcutSettingsSession onClose={onClose} /> : null
}
