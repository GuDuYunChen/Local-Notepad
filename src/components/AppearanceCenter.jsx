import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  APPEARANCE_EXTERNAL_EVENT, BUILTIN_SCHEMES, MAX_CUSTOM_SCHEMES,
  activeScheme, beginAppearancePreview, defaultAppearance, downloadScheme,
  importScheme, newCustomScheme, readAppearance, readThemeFile, saveAppearance,
  validateAppearance,
} from '~/services/localAppearance'
import './AppearanceCenter.css'

const copy = value => JSON.parse(JSON.stringify(value))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const isComposing = event => event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229
function focusables(dialog) {
  return [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled):not([type="file"]), [tabindex="0"]')]
    .filter(node => !node.closest('[hidden], fieldset:disabled'))
}

export default function AppearanceCenter({ onClose }) {
  const [baseline, setBaseline] = useState(readAppearance)
  const [draft, setDraft] = useState(() => copy(baseline.value))
  const [repair, setRepair] = useState(false)
  const [externalChanged, setExternalChanged] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reading, setReading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const dialog = useRef(null), fileInput = useRef(null), pendingRead = useRef(null)
  const session = useRef(null), alive = useRef(true), generation = useRef(0)
  if (!session.current) session.current = beginAppearancePreview()
  const selected = activeScheme(draft)
  const custom = selected.id.startsWith('custom-')
  const dirty = !same(draft, baseline.value) || repair
  const invalid = useMemo(() => { try { validateAppearance(draft); return '' } catch (failure) { return failure.message } }, [draft])

  const cancelRead = () => {
    generation.current++
    pendingRead.current?.abort(); pendingRead.current = null
    setReading(false)
  }
  const clearPreview = () => { session.current.clear(); setPreviewing(false) }
  const change = next => {
    cancelRead(); clearPreview(); setDraft(next); setMessage(''); setError('')
  }
  useLayoutEffect(() => {
    const previous = document.activeElement
    const panel = dialog.current
    alive.current = true
    focusables(panel)[0]?.focus()
    return () => {
      alive.current = false; generation.current++; pendingRead.current?.abort(); session.current.clear()
      const active = document.activeElement
      if (previous?.isConnected && (!active || active === document.body || panel?.contains(active))) previous.focus?.()
    }
  }, [])
  useEffect(() => {
    const external = () => {
      cancelRead(); clearPreview(); setExternalChanged(true)
      setError('其它窗口已改变外观配置。当前编辑仍保留，请重新载入后再应用。')
    }
    window.addEventListener(APPEARANCE_EXTERNAL_EVENT, external)
    return () => window.removeEventListener(APPEARANCE_EXTERNAL_EVENT, external)
  }, [])
  useLayoutEffect(() => {
    if (confirmation) dialog.current.querySelector('[role="alertdialog"] button')?.focus()
  }, [confirmation])

  const close = () => {
    if (dirty) { setConfirmation({ kind: 'close' }); return }
    cancelRead(); clearPreview(); onClose()
  }
  const loadCurrent = () => {
    cancelRead(); clearPreview()
    const next = readAppearance()
    setBaseline(next); setDraft(copy(next.value)); setRepair(false); setExternalChanged(false)
    setError(next.error); setMessage(next.error ? '' : '已重新载入本机配置。')
  }
  const reload = () => dirty ? setConfirmation({ kind: 'reload' }) : loadCurrent()
  const select = id => change({ ...draft, activeId: id })
  const edit = (field, value) => change({ ...draft, schemes: draft.schemes.map(item => item.id === selected.id ? { ...item, [field]: value } : item) })
  const create = () => {
    try {
      const scheme = newCustomScheme(selected, draft.schemes)
      change({ ...draft, activeId: scheme.id, schemes: [...draft.schemes, scheme] })
    } catch (failure) { setError(failure.message) }
  }
  const preview = () => {
    try { session.current.show(draft); setPreviewing(true); setError(''); setMessage('正在预览，尚未保存。取消或关闭面板会恢复已应用方案。') }
    catch (failure) { setError(failure.message) }
  }
  const apply = () => {
    try {
      const next = saveAppearance(draft, baseline, { repair })
      clearPreview(); setBaseline(next); setDraft(copy(next.value)); setRepair(false); setError('')
      setMessage('外观方案已写入本机配置并读回确认，下次启动会恢复。笔记正文没有改变。')
    } catch (failure) { setError(failure.message); setMessage('') }
  }
  const exportSelected = () => {
    try { downloadScheme(selected); setError(''); setMessage('已请求导出当前方案，请检查下载保存位置；文件不包含笔记、路径或账户信息。') }
    catch (failure) { setError(failure.message || '主题导出未能启动，请重试') }
  }
  const importFile = async file => {
    cancelRead()
    const controller = new AbortController(), token = generation.current
    pendingRead.current = controller; setReading(true); setError(''); setMessage('')
    try {
      const text = await readThemeFile(file, { signal: controller.signal })
      if (!alive.current || token !== generation.current) return
      const scheme = importScheme(text, draft.schemes)
      clearPreview(); setDraft({ ...draft, activeId: scheme.id, schemes: [...draft.schemes, scheme] })
      setMessage('主题已导入为待应用方案；预览或点击“应用并保存”后生效。')
    } catch (failure) {
      if (alive.current && token === generation.current && failure.name !== 'AbortError') setError(failure.message)
    } finally {
      if (alive.current && token === generation.current) { pendingRead.current = null; setReading(false) }
    }
  }
  const confirm = () => {
    const choice = confirmation
    setConfirmation(null)
    if (choice.kind === 'close') { cancelRead(); clearPreview(); onClose(); return }
    if (choice.kind === 'reload') { loadCurrent(); return }
    if (choice.kind === 'reset') {
      change(defaultAppearance()); setRepair(Boolean(baseline.error)); setMessage('原生主题已载入，尚未写入配置。点击“应用并保存”完成重置。'); return
    }
    if (choice.kind === 'repair') { setRepair(true); setMessage('已确认修复配置；选择方案后点击“应用并保存”。'); return }
    if (choice.kind === 'delete') {
      change({ ...draft, activeId: draft.activeId === choice.id ? 'default' : draft.activeId, schemes: draft.schemes.filter(item => item.id !== choice.id) })
      setMessage('方案已从待应用列表移除，应用后才会写入本机。')
    }
  }
  const cancelConfirmation = () => { setConfirmation(null); dialog.current.querySelector('button[data-appearance-close]')?.focus() }
  const onKeyDown = event => {
    event.stopPropagation()
    if (isComposing(event)) return
    if (event.key === 'Escape') { event.preventDefault(); confirmation ? cancelConfirmation() : close(); return }
    if (event.key === 's' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); return }
    if (event.key !== 'Tab') return
    const scope = confirmation ? dialog.current.querySelector('[role="alertdialog"]') : dialog.current
    const items = focusables(scope), first = items[0], last = items.at(-1)
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first.focus() }
  }
  const confirmationText = {
    close: '放弃尚未应用的方案编辑，并恢复已应用的外观？',
    reload: '放弃当前方案编辑，重新读取本机最新配置？',
    reset: '恢复原生主题并移除自定义方案？点击应用前不会写入本机。',
    delete: '从待应用列表删除这个自定义方案？已应用数据在保存前保持不变。',
    repair: '应用时替换损坏或不兼容的外观配置？此操作只影响主题方案，不影响笔记。',
  }

  return createPortal(
    <div className="appearance-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <section className="appearance-center" ref={dialog} role="dialog" aria-modal="true" aria-label="本地主题方案中心" aria-describedby="appearance-scope" onKeyDown={onKeyDown}>
        <header className="appearance-header">
          <div><h2>本地主题方案</h2><p id="appearance-scope">浅色与深色各有强调色；不改写正文颜色，不加载外部 CSS 或字体。</p></div>
          <button type="button" data-appearance-close aria-label="关闭主题方案中心" disabled={Boolean(confirmation)} onClick={close}>×</button>
        </header>
        <div className="appearance-scroll">
          <fieldset disabled={Boolean(confirmation)} className="appearance-fields">
            <legend>选择方案</legend>
            <div className="appearance-schemes" role="group" aria-label="主题方案列表">
              {[...BUILTIN_SCHEMES, ...draft.schemes].map(scheme => <button type="button" key={scheme.id} aria-pressed={draft.activeId === scheme.id} onClick={() => select(scheme.id)}>
                <span className="appearance-swatch" style={{ background: /^#[0-9a-f]{6}$/i.test(scheme.lightAccent) ? scheme.lightAccent : '#7057d9' }} aria-hidden="true" />
                <span>{scheme.name || '未命名方案'}</span><small>{scheme.id.startsWith('custom-') ? '自定义' : '内置'}</small>
              </button>)}
            </div>
            <div className="appearance-tools">
              <button type="button" onClick={create} disabled={draft.schemes.length >= MAX_CUSTOM_SCHEMES || Boolean(invalid)}>复制为自定义方案</button>
              <button type="button" onClick={() => setConfirmation({ kind: 'delete', id: selected.id })} disabled={!custom}>删除方案</button>
              <span>{draft.schemes.length} / {MAX_CUSTOM_SCHEMES} 个自定义方案</span>
            </div>
            <div className="appearance-edit">
              <label>方案名称<input aria-label="方案名称" value={selected.name} disabled={!custom} maxLength={32} onChange={event => edit('name', event.target.value)} /></label>
              <label>浅色强调色<input aria-label="浅色强调色" value={selected.lightAccent} disabled={!custom} spellCheck="false" maxLength={7} onChange={event => edit('lightAccent', event.target.value)} /></label>
              <label>深色强调色<input aria-label="深色强调色" value={selected.darkAccent} disabled={!custom} spellCheck="false" maxLength={7} onChange={event => edit('darkAccent', event.target.value)} /></label>
            </div>
            <p className="appearance-hint">内置方案不能改写，复制后可编辑。强调色须与对应界面背景达到 4.5:1 的对比度；此检查不代表整个界面的无障碍认证。</p>
            <div className="appearance-examples" aria-label="浅深色方案示例">
              {['light', 'dark'].map(mode => <article key={mode} data-mode={mode}>
                <strong>{mode === 'light' ? '浅色' : '深色'}界面示例</strong><p>正文与背景保持原样，只调整界面强调色。</p>
                <span style={{ color: /^#[0-9a-f]{6}$/i.test(selected[`${mode}Accent`]) ? selected[`${mode}Accent`] : undefined }}>当前笔记 · 选中项目</span>
              </article>)}
            </div>
            <div className="appearance-tools">
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
              <button type="button" onClick={() => fileInput.current.click()} disabled={reading || draft.schemes.length >= MAX_CUSTOM_SCHEMES}>导入主题文件</button>
              <button type="button" onClick={exportSelected} disabled={Boolean(invalid)}>导出当前方案</button>
              <button type="button" onClick={() => setConfirmation({ kind: 'reset' })}>恢复默认方案</button>
              {reading && <button type="button" onClick={() => { cancelRead(); setMessage('导入已取消，现有方案未改变。') }}>取消导入</button>}
            </div>
          </fieldset>
          {confirmation && <div className="appearance-confirm" role="alertdialog" aria-modal="true" aria-label="确认主题方案操作">
            <p>{confirmationText[confirmation.kind]}</p>
            <button type="button" onClick={cancelConfirmation}>继续编辑</button>
            <button type="button" onClick={confirm}>确认</button>
          </div>}
        </div>
        <div className="appearance-feedback-area" aria-label="主题操作反馈">
          {baseline.error && <div role="alert" className="appearance-warning"><p>{baseline.error}</p>{baseline.raw !== undefined && !repair && <button type="button" disabled={Boolean(confirmation)} onClick={() => setConfirmation({ kind: 'repair' })}>确认修复配置</button>}</div>}
          {externalChanged && <p role="alert" className="appearance-warning">外部配置已变化，预览已撤销。重新载入前不能应用。</p>}
          {invalid && <p role="alert" className="appearance-warning">{invalid}</p>}
          {error && !externalChanged && error !== baseline.error && <p role="alert" className="appearance-warning">{error}</p>}
          <p role="status" aria-live="polite" className="appearance-feedback">{reading ? '正在读取主题文件…' : message || (dirty ? '有尚未应用的方案更改。' : '当前方案已应用；预览和编辑不会自动保存。')}</p>
        </div>
        <footer className="appearance-footer">
          <button type="button" disabled={Boolean(confirmation)} onClick={reload}>重新载入</button>
          <span>{previewing ? '预览中 · 未保存' : '仅本机配置'}</span>
          <button type="button" onClick={() => { clearPreview(); setMessage('预览已取消，已恢复当前应用的外观；尚未应用的编辑仍保留。') }} disabled={!previewing || Boolean(confirmation)}>取消预览</button>
          <button type="button" onClick={preview} disabled={Boolean(invalid) || externalChanged || Boolean(confirmation)}>预览当前方案</button>
          <button type="button" className="appearance-apply" onClick={apply} disabled={!dirty || Boolean(invalid) || externalChanged || reading || Boolean(confirmation) || (Boolean(baseline.error) && !repair)}>应用并保存</button>
        </footer>
      </section>
    </div>, document.body,
  )
}
