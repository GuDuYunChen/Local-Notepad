import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { markdownToLexical } from '~/services/importContent'
import { analyzeMarkdownSourceCompatibility } from '~/services/markdownSource'
import { editorQuit, EditorQuitError } from '~/services/editorQuit.mjs'
import ConfirmDialog from '../../ConfirmDialog'

export default function MarkdownSourcePlugin({ readOnly = false }) {
  const [editor] = useLexicalComposerContext()
  const editorEditable = useLexicalEditable()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [original, setOriginal] = useState('')
  const [issues, setIssues] = useState([])
  const [editable, setEditable] = useState(false)
  const [closeReview, setCloseReview] = useState(null)
  const canEdit = editable && editorEditable && !readOnly
  const textareaRef = useRef(null)
  const quitSource = useRef(null)
  quitSource.current = { open, editable, source, original }
  useEffect(() => editorQuit.register(() => {
    const current = quitSource.current
    if (current.open && current.editable && current.source !== current.original) {
      throw new EditorQuitError('source')
    }
  }), [])

  const refreshFromEditor = () => {
    const serialized = JSON.stringify(editor.getEditorState())
    try {
      const analysis = analyzeMarkdownSourceCompatibility(serialized)
      setSource(analysis.markdown)
      setOriginal(analysis.markdown)
      setIssues(analysis.issues)
      // Compatibility belongs to the draft; a mode switch only pauses editing.
      setEditable(analysis.editable)
    } catch (error) {
      console.error('生成 Markdown 源码失败', error)
      setSource('')
      setOriginal('')
      setIssues(['当前文档无法转换为 Markdown 源码'])
      setEditable(false)
    }
  }

  const closeSource = () => {
    if (editable && source !== original) {
      setCloseReview({ source, original })
      return
    }
    setOpen(false)
    editor.focus()
  }

  const discardAndClose = () => {
    if (!closeReview || closeReview.source !== source || closeReview.original !== original) {
      setCloseReview(null)
      return
    }
    setSource(original)
    setCloseReview(null)
    setOpen(false)
    editor.focus()
  }

  useEffect(() => {
    const toggle = () => {
      if (open) closeSource()
      else { refreshFromEditor(); setOpen(true) }
    }

    window.addEventListener('editor:toggle-source-mode', toggle)
    return () => window.removeEventListener('editor:toggle-source-mode', toggle)
  }, [editor, readOnly, open, editable, source, original])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [open])

  const dirty = source !== original

  const applySource = () => {
    if (!editable || readOnly || !editor.isEditable() || !dirty) return

    try {
      const lexical = markdownToLexical(source)
      const nextState = editor.parseEditorState(lexical)
      editor.setEditorState(nextState)
      setOriginal(source)
      editor.focus()
    } catch (error) {
      console.error('应用 Markdown 源码失败', error)
    }
  }

  if (!open) return null

  return (
    <div className="markdown-source-overlay">
      <section className="markdown-source-panel" aria-label="Markdown 源码">
        <header className="markdown-source-header">
          <div>
            <strong>Markdown 源码</strong>
            <span>{canEdit ? '修改后可应用回视觉编辑器' : readOnly || !editorEditable ? '阅读模式：源码只读' : '只读保护：当前文档包含非标准 Markdown 内容'}</span>
          </div>
          <div className="markdown-source-actions">
            {canEdit && (
              <button type="button" onClick={applySource} disabled={!dirty}>
                应用更改
              </button>
            )}
            <button
              type="button"
              onClick={closeSource}
            >
              关闭
            </button>
          </div>
        </header>

        {issues.length > 0 && (
          <div className="markdown-source-warning">
            <strong>为避免数据丢失，本页禁止覆盖正文。</strong>
            <span>{'无法无损表示：' + issues.join('、')}</span>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={source}
          onChange={event => { if (canEdit && editor.isEditable()) setSource(event.target.value) }}
          readOnly={!canEdit}
          spellCheck={false}
          className="markdown-source-textarea"
          aria-label="Markdown 源码内容"
        />

        <footer className="markdown-source-footer">
          <span>{source.length.toLocaleString() + ' 字符'}</span>
          <span>{dirty && editable ? canEdit ? '有未应用更改' : '未应用更改已保留' : canEdit ? '已同步' : '只读源码'}</span>
        </footer>
      </section>
      {closeReview && createPortal(<ConfirmDialog
        title="放弃未应用的源码更改？"
        message="源码更改还没有应用到正文。继续查看会保留草稿；放弃后关闭，正文保持不变。"
        onClose={() => setCloseReview(null)}
        actions={[
          { label: '继续查看', onClick: () => setCloseReview(null) },
          { label: '放弃更改并关闭', kind: 'danger', onClick: discardAndClose },
        ]}
      />, document.body)}
    </div>
  )
}
