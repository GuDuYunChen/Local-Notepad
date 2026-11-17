// Production components and CSS with synthetic records; this is not full-app acceptance.
import '../src/styles/index.css'
import '../src/styles/redesign.css'
import '../src/styles/editor-document.css'
import '../src/styles/dark-theme.css'
import '../src/styles/editor-quit.css'
import '../src/components/PinnedNotesPanel.css'
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import UiThemeProvider from '../src/components/ui/UiThemeProvider'
import { UiButton, UiInput, UiPassword, UiSelect } from '../src/components/ui/ControlKit'
import useBackupDialogFocus from '../src/hooks/useBackupDialogFocus'

const theme = new URLSearchParams(location.search).get('theme')
if (!['light', 'dark'].includes(theme)) throw new Error('Explicit fixture theme required')
document.documentElement.dataset.theme = theme
window.__uiControlEvents = []
window.__uiControlErrors = []
for (const type of ['mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'input', 'change', 'focusin', 'submit', 'reset']) {
  document.addEventListener(type, event => {
    if (window.__uiControlEvents.length >= 1000) return
    const target = event.target
    window.__uiControlEvents.push({ type, trusted: event.isTrusted, key: event.key || null,
      id: target.id || null, probe: target.closest?.('[data-probe]')?.dataset.probe || null,
      option: target.closest?.('[data-ui-option-value]')?.getAttribute('data-ui-option-value') || null })
  }, true)
}
window.addEventListener('error', event => window.__uiControlErrors.push(String(event.message)))
window.addEventListener('unhandledrejection', event => window.__uiControlErrors.push(String(event.reason?.message || event.reason)))

const densities = [
  { name: 'ordinary', title: '普通 40px', props: {} },
  { name: 'compact', title: '紧凑 28px · 生产编辑器工具栏', props: { density: 'compact' } },
  { name: 'large', title: '大号 44px', props: { size: 'large' } },
]
const choices = <><option value="alpha">第一项</option><option value="beta">第二项</option><option value="gamma">第三项</option><option value="blocked" disabled>不可选择</option></>
const longLabel = '完整保留的很长资料集名称：本地笔记、附件、历史快照与归档资料，包含中文和 English 长名称'
function Cell({ name, kind, label, showLabel = true, children }) {
  return <div className="probe-cell" data-probe={`${name}-${kind}`} data-kind={kind}>
    {showLabel && <label htmlFor={`${name}-${kind}`}>{label}</label>}{children}
  </div>
}
function ProbeDialog({ onClose }) {
  const overlay = useRef(null), dialog = useRef(null), heading = useRef(null)
  useBackupDialogFocus(overlay, dialog, heading, onClose)
  return <div ref={overlay} className="modal-overlay probe-dialog-overlay">
    <section ref={dialog} id="probe-modal" role="dialog" aria-modal="true" aria-labelledby="probe-dialog-title" className="probe-dialog">
      <h2 ref={heading} id="probe-dialog-title" tabIndex={-1}>真实备份弹窗焦点所有者</h2>
      <p>第一次 Escape 关闭下拉；第二次关闭本合成弹窗。</p>
      <UiSelect id="modal-select" aria-label="弹窗选择" defaultValue="alpha">{choices}</UiSelect>
      <UiButton type="button" onClick={onClose}>关闭</UiButton>
    </section>
  </div>
}
function Fixture() {
  const [values, setValues] = useState({ ordinary: 'alpha', compact: 'alpha', large: 'alpha' })
  const [changes, setChanges] = useState({ ordinary: 0, compact: 0, large: 0 })
  const [submissions, setSubmissions] = useState([]), [resets, setResets] = useState(0)
  const [modal, setModal] = useState(false), [closedDialogs, setClosedDialogs] = useState(0)
  useEffect(() => { document.documentElement.dataset.uiControlReady = 'true' }, [])
  const select = (name, event) => {
    setValues(old => ({ ...old, [name]: event.target.value }))
    setChanges(old => ({ ...old, [name]: old[name] + 1 }))
  }
  return <main className="ui-render-fixture">
    <h1>共享控件原生回归 · {theme}</h1>
    <p className="probe-description">合成界面；验证共用控件、焦点和表单，不代表全应用页面验收。</p>
    <UiButton id="focus-start" type="button">键盘起点</UiButton>
    {densities.map(({ name, title, props }) => <section key={name} data-density-section={name}>
      <h2>{title}</h2><div className={'probe-density' + (name === 'compact' ? ' editor-toolbar product-editor-toolbar' : '')} data-density={name}>
        {/* The production toolbar has its own fixed container height. Keep its
            labels in accessible names, without overriding control geometry. */}
        <Cell name={name} kind="button" label="操作" showLabel={name !== 'compact'}><UiButton {...props} id={`${name}-button`} aria-label={`${name} 操作`} type="button">确认</UiButton></Cell>
        <Cell name={name} kind="input" label="输入" showLabel={name !== 'compact'}><UiInput {...props} id={`${name}-input`} aria-label={`${name} 输入`} defaultValue="示例文字" /></Cell>
        <Cell name={name} kind="password" label="密码" showLabel={name !== 'compact'}><UiPassword {...props} id={`${name}-password`} aria-label={`${name} 密码`} defaultValue="synthetic-only" /></Cell>
        <Cell name={name} kind="select" label="选择" showLabel={name !== 'compact'}><UiSelect {...props} id={`${name}-select`} aria-label={`${name} 选择`} value={values[name]} onChange={event => select(name, event)}>{choices}</UiSelect></Cell>
      </div>
    </section>)}
    <output id="selection-output" className="probe-receipt">{JSON.stringify({ values, changes })}</output>

    <section id="long-toolbar-section"><h2>生产筛选行布局与长标签</h2>
      <div className="pinned-tools" id="long-toolbar">
        <label>很长的检索标签，需要在窄窗口完整换行且不挤压相邻控件
          <UiInput id="long-input" data-probe-toolbar="input" className="pinned-control" defaultValue={longLabel} />
        </label>
        <label>完整保留长资料集名称与选项
          <UiSelect id="long-select" data-probe-toolbar="select" className="pinned-control" defaultValue="long" aria-label="长资料集名称">
            <option value="long" title={longLabel}>{longLabel}</option><option value="short">短名称</option>
          </UiSelect>
        </label>
        <UiButton id="long-clear" data-probe-toolbar="button" className="btn small pinned-clear" type="button">清除筛选</UiButton>
      </div>
    </section>

    <section id="form-section"><h2>原生表单、禁用与错误状态</h2>
      <form id="native-form" onReset={() => setResets(value => value + 1)} onSubmit={event => {
        event.preventDefault()
        const data = Object.fromEntries(new FormData(event.currentTarget).entries())
        setSubmissions(old => [...old, data])
      }}>
        <div className="probe-form-grid">
          <label className="probe-cell">标题<UiInput id="native-title" name="title" defaultValue="original" /></label>
          <label className="probe-cell">模式<UiSelect id="native-mode" aria-label="表单模式" name="mode" defaultValue="alpha">{choices}</UiSelect></label>
        </div>
        <fieldset className="probe-fieldset" disabled>
          <legend>首个 legend 例外 <UiSelect id="legend-mode" aria-label="首个图例的选择" name="legendMode" defaultValue="alpha">{choices}</UiSelect></legend>
          <div className="probe-form-grid">
            <UiInput id="blocked-title" name="blockedTitle" defaultValue="excluded" />
            <UiSelect id="blocked-mode" aria-label="禁用字段集的选择" name="blockedMode" defaultValue="alpha">{choices}</UiSelect>
          </div>
          <UiButton id="blocked-submit" type="submit">禁用提交</UiButton>
        </fieldset>
        <div className="probe-form-actions"><UiButton id="native-submit" type="submit">提交合成表单</UiButton><UiButton id="native-reset" type="reset">重置合成表单</UiButton></div>
      </form>
      <div className="probe-form-grid probe-error">
        <UiInput id="error-input" aria-label="错误输入" aria-invalid="true" defaultValue="错误状态" />
        <UiSelect id="error-select" aria-label="错误选择" aria-invalid="true" defaultValue="alpha">{choices}</UiSelect>
      </div>
      <output id="form-output" className="probe-receipt">{JSON.stringify({ submissions, resets })}</output>
      <UiButton id="open-modal" type="button" onClick={() => setModal(true)}>打开焦点测试弹窗</UiButton>
      <output id="modal-output" className="probe-receipt">{closedDialogs}</output>
    </section>
    {modal && <ProbeDialog onClose={() => { setModal(false); setClosedDialogs(value => value + 1) }} />}
  </main>
}
createRoot(document.getElementById('root')).render(<UiThemeProvider><Fixture /></UiThemeProvider>)
