import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { extractLexicalText } from '~/utils/lexicalText'
import './EditorSaveConflictDialog.css'

export default function EditorSaveConflictDialog({ draft, database, busy, problem, onClose, onResolve }) {
  const titleID = useId(), messageID = useId(), panel = useRef(null)
  const state = useRef({ busy, onClose }); state.current = { busy, onClose }
  useEffect(() => {
    const focus = document.activeElement, root = document.getElementById('root'), wasInert = root?.inert
    if (root) root.inert = true
    panel.current?.querySelector('[data-conflict-cancel]')?.focus()
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!state.current.busy) state.current.onClose(); return }
      if (event.key !== 'Tab') return
      const controls = [...panel.current.querySelectorAll('button:not(:disabled),[tabindex="0"]')]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); if (root) root.inert = wasInert; if (focus?.isConnected) focus.focus() }
  }, [])
  const preview = content => extractLexicalText(content).slice(0, 1600) || '（没有可预览的文字；正文可能含图片等内容）'
  return createPortal(<div className="modal-overlay consumer-modal-overlay editor-save-conflict-overlay">
    <section ref={panel} className="modal consumer-modal editor-save-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby={titleID} aria-describedby={messageID}>
      <h2 id={titleID}>处理保存冲突</h2>
      <p id={messageID}>数据库中已有另一份正文，当前草稿仍保留。保留我的正文会再次核对数据库版本，并将被替换的数据库正文存入版本历史；采用数据库正文会重新读取数据库并放弃当前草稿。</p>
      <div className="editor-save-conflict-previews">
        <section aria-label="我的草稿预览"><h3>我的草稿</h3><pre tabIndex={0}>{preview(draft)}</pre></section>
        <section aria-label="数据库正文预览"><h3>数据库正文</h3><pre tabIndex={0}>{preview(database)}</pre></section>
      </div>
      <p className="editor-save-conflict-note">仅预览各版本前 1600 个字符；不会把格式、图片或附件转换为预览文字后保存。</p>
      {problem && <p className="editor-save-conflict-problem" role="alert">{problem}</p>}
      <div className="modal-actions consumer-modal-actions">
        <button type="button" className="btn" data-conflict-cancel disabled={busy} onClick={onClose}>暂不处理</button>
        <button type="button" className="btn" disabled={busy} onClick={() => { void onResolve('database') }}>采用数据库正文</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => { void onResolve('keep') }}>保留我的正文</button>
      </div>
    </section>
  </div>, document.body)
}
