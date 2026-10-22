import React, { useId, useLayoutEffect, useRef, useState } from 'react'
import useS3ReadProbe from '../hooks/useS3ReadProbe.js'
import { S3_PROBE_LIMITATION } from '../services/s3ReadProbe.mjs'
import { emptyInspectionDraft, prepareS3Inspection, inspectionNextStep, INSPECTION_PRIVACY, INSPECTION_STOP_NOTICE } from '../services/s3ReadInspection.mjs'

// Plain React elements keep this module usable with the application's existing
// build chain. No storage, generic HTTP, payload logger or native API is added.
const h = React.createElement
const TITLES = { idle: '尚未检查', pending: '正在检查', readable: '本次读取完成', failed: '检查未完成', stopped: '已停止采用', blocked: '暂时不能重试', disposed: '检查已关闭' }
function hasNativeBridge() {
  try { return typeof globalThis.window?.electronAPI?.s3ProbeRead === 'function' }
  catch { return false }
}
function InspectionForm({ id, onClose }) {
  const [draft, setDraft] = useState(emptyInspectionDraft)
  const draftRef = useRef(draft)
  const [revision, setRevision] = useState(0)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)
  const { result, read, invalidate } = useS3ReadProbe(revision)
  const fields = useRef({}), action = useRef(null), alive = useRef(false), epoch = useRef({})
  const available = hasNativeBridge()
  useLayoutEffect(() => {
    alive.current = true
    fields.current.endpoint?.focus()
    return () => { alive.current = false; epoch.current = {}; action.current = null; draftRef.current = emptyInspectionDraft() }
  }, [])
  const invalidateNow = () => {
    // Invalidate synchronously before any deferred React render can occur.
    epoch.current = {}; action.current = null; invalidate()
    setRevision(value => value + 1); setNotice(null); setErrors({})
  }
  const edit = (key, value) => {
    invalidateNow()
    const next = { ...draftRef.current, [key]: value }
    draftRef.current = next; setDraft(next)
  }
  const clear = () => {
    invalidateNow()
    const next = emptyInspectionDraft(); draftRef.current = next; setDraft(next)
    setNotice({ text: '本面板的目标与凭据输入已清空；不会清理其他配置或触碰本地笔记。', code: 'cleared' })
    fields.current.endpoint?.focus()
  }
  const close = () => {
    epoch.current = {}; action.current = null; invalidate()
    draftRef.current = emptyInspectionDraft()
    onClose()
  }
  const stop = () => {
    invalidateNow()
    setNotice({ text: INSPECTION_STOP_NOTICE, code: 'wait-stopped' })
  }
  const inspect = async () => {
    if (!alive.current || action.current) return
    setNotice(null)
    const admission = prepareS3Inspection(draftRef.current)
    if (!admission.ok) {
      invalidate(); setErrors(admission.errors)
      const first = Object.keys(admission.errors).find(key => fields.current[key])
      fields.current[first]?.focus()
      return
    }
    if (!available) {
      setNotice({ text: '当前环境没有可用的原生只读检查桥；未发起读取。', code: 'native-unavailable' })
      return
    }
    setErrors({})
    const owner = epoch.current, token = {}
    action.current = token
    try {
      const outcome = await read(admission.payload)
      if (!alive.current || epoch.current !== owner || action.current !== token) return
      // Busy is a refusal of this click, not a new result for the old request.
      if (outcome.state === 'blocked') setNotice({ text: outcome.message, code: outcome.code })
    } catch {
      if (alive.current && epoch.current === owner && action.current === token)
        setNotice({ text: '本次检查未完成；没有采纳返回数据，也不会自动重试。', code: 'unexpected-failure' })
    } finally { if (action.current === token) action.current = null }
  }
  const keyDown = event => {
    if (event.nativeEvent?.isComposing || event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); void inspect() }
    else if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault()
  }
  const field = (name, label, hint, opts = {}) => {
    const fieldID = id + '-' + name, error = errors[name]
    return h('div', { className: 's3-inspection-field' + (opts.wide ? ' s3-inspection-wide' : ''), key: name },
      h('label', { htmlFor: fieldID }, label),
      h('input', { id: fieldID, name, type: opts.secret ? 'password' : 'text', value: draft[name],
        ref: element => { fields.current[name] = element }, onChange: e => edit(name, e.target.value),
        autoComplete: opts.secret ? 'new-password' : 'off', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false,
        inputMode: opts.numeric ? 'numeric' : undefined, maxLength: opts.maxLength || 65536,
        placeholder: opts.placeholder, 'aria-required': opts.required || undefined,
        'aria-invalid': !!error, 'aria-describedby': fieldID + '-hint' + (error ? ' ' + fieldID + '-error' : '') }),
      h('small', { id: fieldID + '-hint' }, hint),
      error && h('p', { className: 's3-inspection-error', id: fieldID + '-error' }, error))
  }
  const pending = result.state === 'pending'
  return h('div', { className: 's3-inspection-body', id: id + '-body', onKeyDown: keyDown },
    h('div', { className: 's3-inspection-intro', id: id + '-privacy' },
      h('strong', null, '只检查一个指定对象，不启用同步'),
      h('p', null, '所有输入由你明确提供。请求经过现有桌面原生通道；挂载、修改输入与重新打开均不会自动读取。'),
      h('p', null, INSPECTION_PRIVACY)),
    !available && h('p', { className: 's3-inspection-unavailable', role: 'note' }, '当前环境没有原生检查通道。请使用桌面应用；不会改走浏览器网络请求。'),
    Object.keys(errors).length > 0 && h('p', { className: 's3-inspection-error-summary', role: 'alert' }, errors.form || '请修正标出的输入项；本次没有发起读取。'),
    h('fieldset', { className: 's3-inspection-fieldset', 'aria-describedby': id + '-privacy' },
      h('legend', null, '1 · 指定读取目标'),
      h('div', { className: 's3-inspection-grid' },
        field('endpoint', 'S3 根地址', '使用 path-style 根地址，不填写桶路径、账号、查询或片段。公网地址必须使用 HTTPS。', { required: true, wide: true, placeholder: 'https://s3.example.com' }),
        field('bucket', '存储桶', '填写桶名称，不是完整链接。', { required: true, maxLength: 63 }),
        field('region', '区域', '按服务商说明填写，不自动探测。', { required: true, maxLength: 63, placeholder: '例如 us-east-1' }),
        field('prefix', '前缀（可选）', '不以 / 结尾。填写后由后端以“前缀/对象键”读取，不自动去重。', { maxLength: 1024 }),
        field('key', '对象键', '相对于上述前缀；保留中文、空格及字面 % 编码，不自动修正路径。', { required: true, maxLength: 1024 }))),
    h('fieldset', { className: 's3-inspection-fieldset' }, h('legend', null, '2 · 本次访问凭据'),
      h('div', { className: 's3-inspection-grid' },
        field('accessKeyId', '访问密钥 ID', '仅供本次打开的检查面板使用。', { required: true, secret: true, maxLength: 128 }),
        field('secretAccessKey', '访问密钥', '不会写入应用设置、日志或备份。', { required: true, secret: true, maxLength: 4096 }),
        field('sessionToken', '临时会话令牌（可选）', '使用临时凭据时填写；不使用时留空。', { secret: true, wide: true, maxLength: 16384 }))),
    h('fieldset', { className: 's3-inspection-fieldset' }, h('legend', null, '3 · 确认边界并检查'),
      field('maxBytes', '读取上限（字节）', '1–1048576 字节，最多 1 MiB；超限不接受部分对象。', { required: true, numeric: true, maxLength: 7 }),
      h('label', { className: 's3-inspection-consent', htmlFor: id + '-consent' },
        h('input', { id: id + '-consent', type: 'checkbox', checked: draft.consent,
          ref: el => { fields.current.consent = el }, onChange: e => edit('consent', e.target.checked),
          'aria-invalid': !!errors.consent, 'aria-describedby': errors.consent ? id + '-consent-error' : undefined }),
        h('span', null, '我确认只读取指定对象，不上传、不删除、不启动同步。')),
      errors.consent && h('p', { id: id + '-consent-error', className: 's3-inspection-error' }, errors.consent),
      h('div', { className: 's3-inspection-actions' },
        h('button', { type: 'button', className: 'btn primary', disabled: pending || !available, onClick: () => void inspect() }, pending ? '正在检查…' : result.state === 'idle' ? '开始只读检查' : '重新检查'),
        pending && h('button', { type: 'button', className: 'btn', onClick: stop }, '停止采用'),
        h('button', { type: 'button', className: 'btn', onClick: clear }, '清空全部输入'),
        h('button', { type: 'button', className: 'btn', onClick: close }, '关闭并清空')),
      h('p', { className: 's3-inspection-shortcuts' }, 'Ctrl / ⌘ + Enter 检查，Esc 关闭并清空。修改输入立即使旧结果失效。')),
    h('section', { className: 's3-inspection-result', 'data-state': result.state, 'aria-labelledby': id + '-result-title' },
      h('h4', { id: id + '-result-title' }, TITLES[result.state] || '检查状态'),
      h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
        h('p', null, result.message), notice && h('p', { className: 's3-inspection-notice' }, notice.text)),
      result.summary && h('dl', { className: 's3-inspection-metrics' },
        h('div', null, h('dt', null, '本次接受字节'), h('dd', null, String(result.summary.acceptedBytes) + ' B')),
        h('div', null, h('dt', null, '对象 HTTP 状态'), h('dd', null, result.summary.httpStatus || '未取得'))),
      (result.state !== 'idle' || notice?.code) && h('p', { className: 's3-inspection-next' }, inspectionNextStep(notice?.code === 'cleared' ? result.code : notice?.code || result.code)),
      h('p', { className: 's3-inspection-limitation' }, S3_PROBE_LIMITATION)))
}
export default function S3ReadInspectionPanel() {
  const id = useId(), [open, setOpen] = useState(false), opener = useRef(null), restoreFocus = useRef(false)
  // The entry is disabled while open. Restore focus after React has committed
  // its enabled state, not during the click that still sees a disabled button.
  useLayoutEffect(() => {
    if (!open && restoreFocus.current) { restoreFocus.current = false; opener.current?.focus() }
  }, [open])
  const close = () => { restoreFocus.current = true; setOpen(false) }
  return h('section', { className: 'settings-card consumer-settings-section s3-inspection', 'aria-labelledby': id + '-title' },
    h('div', { className: 'settings-card-header s3-inspection-heading' },
      h('div', null, h('h3', { id: id + '-title' }, '云端只读检查'), h('p', null, 'S3 兼容存储 · 一次检查，一个明确结果')),
      h('span', { className: 's3-inspection-badge' }, '只读工具')),
    !open && h('div', { className: 's3-inspection-entry' },
      h('p', null, '手动检查指定对象能否完整读取。不会保存凭据、列举文件或改动本地及云端内容。')),
    h('button', { type: 'button', ref: opener, className: 'btn s3-inspection-opener', 'aria-expanded': open,
      'aria-controls': id + '-body', disabled: open, onClick: () => setOpen(true) }, open ? '检查面板已打开' : '打开云端只读检查'),
    open && h(InspectionForm, { id, onClose: close }))
}
