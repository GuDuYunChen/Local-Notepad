import React, { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { markdownToLexical } from '~/services/importContent'
import { analyzeMarkdownSourceCompatibility } from '~/services/markdownSource'
import { editorQuit, EditorQuitError } from '~/services/editorQuit.mjs'

export default function MarkdownSourcePlugin({ readOnly = false }) {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [original, setOriginal] = useState('')
  const [issues, setIssues] = useState([])
  const [editable, setEditable] = useState(false)
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
      setEditable(analysis.editable && !readOnly)
    } catch (error) {
      console.error('生成 Markdown 源码失败', error)
      setSource('')
      setOriginal('')
      setIssues(['当前文档无法转换为 Markdown 源码'])
      setEditable(false)
    }
  }

  useEffect(() => {
    const toggle = () => {
      setOpen(previous => {
        const next = !previous
        if (next) refreshFromEditor()
        return next
      })
    }

    window.addEventListener('editor:toggle-source-mode', toggle)
    return () => window.removeEventListener('editor:toggle-source-mode', toggle)
  }, [editor, readOnly])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [open])

  const dirty = source !== original

  const applySource = () => {
    if (!editable || !dirty) return

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
            <span>{editable ? '修改后可应用回视觉编辑器' : '只读保护：当前文档包含非标准 Markdown 内容'}</span>
          </div>
          <div className="markdown-source-actions">
            {editable && (
              <button type="button" onClick={applySource} disabled={!dirty}>
                应用更改
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                editor.focus()
              }}
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
          onChange={event => editable && setSource(event.target.value)}
          readOnly={!editable}
          spellCheck={false}
          className="markdown-source-textarea"
          aria-label="Markdown 源码内容"
        />

        <footer className="markdown-source-footer">
          <span>{source.length.toLocaleString() + ' 字符'}</span>
          <span>{dirty && editable ? '有未应用更改' : editable ? '已同步' : '只读源码'}</span>
        </footer>
      </section>
    </div>
  )
}
