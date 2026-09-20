import React, { useEffect, useId, useMemo, useState } from 'react'

export default function NameDialog({
  defaultName = '未命名.md',
  onConfirm,
  onCancel,
  title = '新建笔记',
  message = '给这篇笔记起个名字：',
  validate,
  showFormatSelect = false,
  currentPathLabel = '',
  onPathSelect = null,
  isRename = false
}) {
  const [name, setName] = useState(defaultName)
  const [format, setFormat] = useState('.md')
  const [err, setErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const inputId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !submitting) onCancel?.()
    }
    document.addEventListener('keydown', onKey)

    if (showFormatSelect) {
      const match = defaultName.match(/\.[^.]+$/)
      if (match && ['.md', '.txt', '.docx'].includes(match[0])) {
        setFormat(match[0])
        setName(defaultName.substring(0, defaultName.lastIndexOf('.')))
      } else {
        setName(defaultName)
      }
    } else if (isRename) {
      const lastDot = defaultName.lastIndexOf('.')
      if (lastDot > 0) {
        setFormat(defaultName.substring(lastDot))
        setName(defaultName.substring(0, lastDot))
      } else {
        setName(defaultName)
        setFormat('')
      }
    } else {
      setName(defaultName)
    }

    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, showFormatSelect, defaultName, isRename, submitting])

  const formatLabel = useMemo(() => ({
    '.md': '标准笔记',
    '.txt': '纯文本',
    '.docx': 'Word 文档',
  }[format] || format), [format])

  const submit = async (event) => {
    event?.preventDefault()
    if (submitting) return

    const nextName = name.trim()
    if (!nextName) {
      setErr('请输入名称')
      return
    }

    if (validate) {
      const validationMessage = validate(nextName)
      if (validationMessage) {
        setErr(validationMessage)
        return
      }
    }

    setErr('')
    setSubmitting(true)
    try {
      if (showFormatSelect || isRename) {
        await onConfirm(nextName, format)
      } else {
        await onConfirm(nextName)
      }
    } catch (error) {
      setErr(error.message || '操作失败，请重试')
      setSubmitting(false)
    }
  }

  const hasSecondaryOptions = showFormatSelect || Boolean(currentPathLabel)

  return (
    <div
      className="modal-overlay consumer-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel?.()
      }}
    >
      <form
        className="modal consumer-modal name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
        aria-describedby={descriptionId}
        onSubmit={submit}
      >
        <div className="consumer-modal-heading">
          <div className="modal-title" id="name-dialog-title">{title}</div>
          <div className="modal-message" id={descriptionId}>{message}</div>
        </div>

        <div className="name-dialog-field">
          <label htmlFor={inputId}>名称</label>
          <div className="name-dialog-input-wrap">
            <input
              id={inputId}
              className="input name-dialog-input"
              autoFocus
              value={name}
              disabled={submitting}
              onChange={(event) => {
                setName(event.target.value)
                if (err) setErr('')
              }}
              placeholder="例如：旅行计划"
              aria-invalid={Boolean(err)}
            />
            {isRename && format && <span className="static-ext">{format}</span>}
          </div>
        </div>

        {hasSecondaryOptions && (
          <div className="name-dialog-secondary">
            <button
              type="button"
              className="name-dialog-options-toggle"
              aria-expanded={showOptions}
              onClick={() => setShowOptions(prev => !prev)}
            >
              <span>更多选项</span>
              <span aria-hidden="true">{showOptions ? '⌃' : '⌄'}</span>
            </button>

            {showOptions && (
              <div className="name-dialog-options">
                {showFormatSelect && (
                  <label className="name-dialog-option-row">
                    <span>
                      <strong>保存格式</strong>
                      <small>{formatLabel}</small>
                    </span>
                    <select
                      className="select"
                      value={format}
                      disabled={submitting}
                      onChange={(event) => setFormat(event.target.value)}
                    >
                      <option value=".md">标准笔记 (.md)</option>
                      <option value=".txt">纯文本 (.txt)</option>
                      <option value=".docx">Word (.docx)</option>
                    </select>
                  </label>
                )}

                {currentPathLabel && (
                  <div className="name-dialog-option-row">
                    <span>
                      <strong>保存位置</strong>
                      <small className="path-text" title={currentPathLabel}>{currentPathLabel}</small>
                    </span>
                    {onPathSelect && (
                      <button type="button" className="btn small" onClick={onPathSelect} disabled={submitting}>
                        更改
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {err && <div className="modal-error" role="alert">{err}</div>}

        <div className="modal-actions consumer-modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={submitting}>取消</button>
          <button type="submit" className="btn primary" disabled={submitting}>
            {submitting ? '正在处理…' : '确定'}
          </button>
        </div>
      </form>
    </div>
  )
}
