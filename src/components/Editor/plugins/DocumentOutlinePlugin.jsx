import React, { useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { $isHeadingNode } from '@lexical/rich-text'

const levelLabel = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
}

export default function DocumentOutlinePlugin() {
  const [editor] = useLexicalComposerContext()
  const [headings, setHeadings] = useState([])
  const [activeKey, setActiveKey] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const collect = (editorState) => {
      editorState.read(() => {
        const next = $getRoot()
          .getChildren()
          .filter($isHeadingNode)
          .map(node => ({
            key: node.getKey(),
            level: levelLabel[node.getTag()] || 1,
            text: node.getTextContent().trim() || '未命名标题',
          }))

        setHeadings(next)
        if (next.length < 2) setOpen(false)
      })
    }

    collect(editor.getEditorState())
    return editor.registerUpdateListener(({ editorState }) => collect(editorState))
  }, [editor])

  useEffect(() => {
    if (!headings.length) {
      setActiveKey('')
      return undefined
    }

    const rootElement = editor.getRootElement()
    const scroller = rootElement?.closest('.editor-container')
    if (!scroller) return undefined

    let frame = 0

    const updateActiveHeading = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const scrollerRect = scroller.getBoundingClientRect()
        const anchorY = scrollerRect.top + Math.min(150, scrollerRect.height * 0.22)
        let nextKey = headings[0]?.key || ''

        for (const heading of headings) {
          const element = editor.getElementByKey(heading.key)
          if (!element) continue
          const rect = element.getBoundingClientRect()
          if (rect.top <= anchorY) nextKey = heading.key
          else break
        }

        setActiveKey(nextKey)
      })
    }

    updateActiveHeading()
    scroller.addEventListener('scroll', updateActiveHeading, { passive: true })
    window.addEventListener('resize', updateActiveHeading)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', updateActiveHeading)
      window.removeEventListener('resize', updateActiveHeading)
    }
  }, [editor, headings])

  if (headings.length < 2) return null

  const goToHeading = (key) => {
    const element = editor.getElementByKey(key)
    if (!element) return

    setActiveKey(key)
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })

    window.setTimeout(() => {
      element.classList.add('outline-target-flash')
      window.setTimeout(() => element.classList.remove('outline-target-flash'), 900)
    }, 180)
  }

  return (
    <div className={`document-outline${open ? ' open' : ''}`}>
      <button
        type="button"
        className="document-outline-toggle"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-label="文档目录"
        title="文档目录"
      >
        <span aria-hidden="true">☰</span>
        <span>{headings.length}</span>
      </button>

      {open && (
        <div className="document-outline-panel">
          <div className="document-outline-header">
            <strong>文档目录</strong>
            <span>{headings.length} 个标题</span>
          </div>

          <div className="document-outline-list">
            {headings.map(heading => (
              <button
                type="button"
                key={heading.key}
                className={`document-outline-item level-${Math.min(heading.level, 4)}${activeKey === heading.key ? ' active' : ''}`}
                onClick={() => goToHeading(heading.key)}
                title={heading.text}
                aria-current={activeKey === heading.key ? 'location' : undefined}
              >
                {heading.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
