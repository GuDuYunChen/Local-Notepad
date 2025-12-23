import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { HeadingNode, $createHeadingNode, QuoteNode, $createQuoteNode } from '@lexical/rich-text'
import { CodeNode, CodeHighlightNode, $createCodeNode } from '@lexical/code'
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary'
import {
  FORMAT_TEXT_COMMAND,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  UNDO_COMMAND,
  REDO_COMMAND,
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { OnChangePlugin as LexicalOnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { ListItemNode, ListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list'
import { LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { $setBlocksType } from '@lexical/selection'

/**
 * 编辑器组件
 * 职责：富文本编辑（加粗/斜体/标题/列表/链接）、搜索/替换、快捷键（撤销/重做）、查找高亮
 */
export default function Editor({ docId, value, onChange }) {
  const nodesCfg = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, CodeHighlightNode]
  const initialConfig = {
    namespace: 'notepad-editor',
    theme: {
      paragraph: 'lx-paragraph',
      heading: { h1: 'lx-h1', h2: 'lx-h2', h3: 'lx-h3' },
      text: { bold: 'lx-bold', italic: 'lx-italic' },
    },
    nodes: nodesCfg,
    onError(error) { console.error('编辑器错误', error) },
  }

  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')

  /**
   * 内容桥接插件
   * 职责：将外部传入的 value 写入编辑器，并监听编辑器更新回传 onChange
   */
  const writingRef = useRef(false)
  const ContentBridge = ({ id, val }) => {
    const [editor] = useLexicalComposerContext()
    useEffect(() => {
      writingRef.current = true
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const lines = String(val).split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          const p = $createParagraphNode()
          p.append($createTextNode(lines[i]))
          root.append(p)
        }
      })
      const t = setTimeout(() => { writingRef.current = false }, 0)
      return () => clearTimeout(t)
    }, [editor, id])
    return null
  }

  const onLexicalChange = (editorState) => {
    if (writingRef.current) return
    editorState.read(() => {
      const root = $getRoot()
      const text = root.getTextContent()
      const norm = (s) => s.replace(/\r/g, '')
      const t1 = norm(text)
      const t2 = norm(value)
      if (t1 === t2) return
      if (t1.replace(/\n+$/,'') === t2) return
      onChange(text)
    })
  }

  /**
   * 工具栏组件
   * 功能：加粗、斜体、标题、列表、链接、撤销/重做（含快捷键）
   */
  const Toolbar = () => {
    const [editor] = useLexicalComposerContext()
    const [url, setUrl] = useState('')
    React.useEffect(() => {
      const onKey = (e) => {
        const k = e.key.toLowerCase()
        if (e.ctrlKey && k === 'z') { editor.dispatchCommand(UNDO_COMMAND, undefined); e.preventDefault() }
        if (e.ctrlKey && (k === 'y' || (e.shiftKey && k === 'z'))) { editor.dispatchCommand(REDO_COMMAND, undefined); e.preventDefault() }
        if (e.ctrlKey && k === '1') { onHeading(1); e.preventDefault() }
        if (e.ctrlKey && k === '2') { onHeading(2); e.preventDefault() }
        if (e.ctrlKey && k === '3') { onHeading(3); e.preventDefault() }
        if (e.ctrlKey && k === 'q') {
          editor.update(() => { const sel = $getSelection(); if ($isRangeSelection(sel)) { $setBlocksType(sel, () => $createQuoteNode()) } })
          e.preventDefault()
        }
        if (e.ctrlKey && k === '`') {
          editor.update(() => { const sel = $getSelection(); if ($isRangeSelection(sel)) { $setBlocksType(sel, () => $createCodeNode()) } })
          e.preventDefault()
        }
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }, [editor])
    const onBold = useCallback(() => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold') }, [editor])
    const onItalic = useCallback(() => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic') }, [editor])
    const onHeading = useCallback((level) => {
      editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) {
          const tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
          $setBlocksType(sel, () => $createHeadingNode(tag))
        }
      })
    }, [editor])
    const onParagraph = useCallback(() => {
      editor.update(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) {
          $setBlocksType(sel, () => $createParagraphNode())
        }
      })
    }, [editor])
    const onUL = useCallback(() => { editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined) }, [editor])
    const onOL = useCallback(() => { editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined) }, [editor])
    const onLink = useCallback(() => { editor.dispatchCommand(TOGGLE_LINK_COMMAND, url || null) }, [editor, url])
    return (
      <div className="toolbar-stack colored">
        <div className="toolbar-row">
          <div className="toolbar-group">
            <button className="btn primary" onClick={onBold}>加粗</button>
            <button className="btn" onClick={onItalic}>斜体</button>
          </div>
          <span className="divider" />
          <div className="toolbar-group">
            <input className="input" placeholder="链接地址" value={url} onChange={e => setUrl(e.target.value)} />
            <button className="btn" onClick={onLink}>链接</button>
          </div>
          <span className="divider" />
          <div className="toolbar-group">
            <button className="btn" title="Ctrl+Z" onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}>撤销</button>
            <button className="btn" title="Ctrl+Y / Ctrl+Shift+Z" onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}>重做</button>
          </div>
        </div>
        <div className="toolbar-row">
          <div className="toolbar-group">
            <button className="btn" onClick={() => onHeading(1)}>H1</button>
            <button className="btn" onClick={() => onHeading(2)}>H2</button>
            <button className="btn" onClick={() => onHeading(3)}>H3</button>
            <button className="btn" onClick={onParagraph}>P</button>
          </div>
          <span className="divider" />
          <div className="toolbar-group">
            <button className="btn" onClick={onUL}>UL</button>
            <button className="btn" onClick={onOL}>OL</button>
          </div>
        </div>
      </div>
    )
  }

  /**
   * 搜索与替换组件
   * 功能：全文替换、查找首个匹配并高亮
   */
  const SearchReplace = () => {
    const [editor] = useLexicalComposerContext()
    const [current, setCurrent] = useState(0)
    const onReplaceAll = useCallback(() => {
      const q = query
      if (!q) return
      editor.update(() => {
        const root = $getRoot()
        const text = root.getTextContent()
        const replaced = text.split(q).join(replace)
        root.clear()
        const p = $createParagraphNode()
        p.append($createTextNode(replaced))
        root.append(p)
      })
    }, [editor, query, replace])
    const highlightAll = useCallback(() => {
      const q = query
      if (!q) return
      editor.update(() => {
        const root = $getRoot()
        const walk = (node) => {
          const children = node.getChildren?.() || []
          for (let i = 0; i < children.length; i++) {
            let child = children[i]
            if (child.getChildren) { walk(child); continue }
            if (typeof child.getTextContent === 'function') {
              let text = child.getTextContent()
              const format = child.getFormat ? child.getFormat() : 0
              while (true) {
                const idx = text.indexOf(q)
                if (idx < 0) break
                const beforeStr = text.slice(0, idx)
                const matchStr = text.slice(idx, idx + q.length)
                const afterStr = text.slice(idx + q.length)
                const beforeNode = $createTextNode(beforeStr)
                const matchNode = $createTextNode(matchStr)
                const afterNode = $createTextNode(afterStr)
                if (beforeStr) beforeNode.setFormat(format)
                matchNode.setFormat(format)
                if (afterStr) afterNode.setFormat(format)
                matchNode.setStyle('background:rgba(255,215,0,.3)')
                child.replace(beforeNode)
                beforeNode.insertAfter(matchNode)
                matchNode.insertAfter(afterNode)
                child = afterNode
                text = afterStr
                if (!text) break
              }
            }
          }
        }
        walk(root)
      })
      setCurrent(0)
      setTimeout(() => focusHighlight(0), 0)
    }, [editor, query])
    const clearHighlights = useCallback(() => {
      editor.update(() => {
        const root = $getRoot()
        const walk = (node) => {
          const children = node.getChildren?.() || []
          for (let i = 0; i < children.length; i++) {
            const child = children[i]
            if (child.getChildren) { walk(child); continue }
            if (typeof child.getTextContent === 'function') {
              const style = child.getStyle ? child.getStyle() : ''
              if (style && style.includes('rgba(255,215,0,.3)')) {
                child.setStyle('')
                // 合并相邻文本节点（相同格式且无样式）
                const prev = child.getPreviousSibling?.()
                const next = child.getNextSibling?.()
                const canMerge = (a, b) => a && b && typeof a.getTextContent === 'function' && typeof b.getTextContent === 'function' && (a.getFormat?.() === b.getFormat?.()) && !(a.getStyle?.()) && !(b.getStyle?.())
                if (canMerge(prev, child)) {
                  const merged = $createTextNode((prev.getTextContent?.() || '') + child.getTextContent())
                  merged.setFormat(prev.getFormat?.() || 0)
                  prev.replace(merged)
                  child.remove?.()
                }
                // 重新获取当前 child 的下一个以防已被移除
                const nxt = mergedSibling(child) || next
                if (canMerge(child, nxt)) {
                  const merged2 = $createTextNode(child.getTextContent() + (nxt.getTextContent?.() || ''))
                  merged2.setFormat(child.getFormat?.() || 0)
                  child.replace(merged2)
                  nxt.remove?.()
                }
              }
            }
          }
        }
        const mergedSibling = (n) => n?.getNextSibling?.()
        walk(root)
      })
    }, [editor])
    const replaceCurrent = useCallback(() => {
      const q = query
      if (!q) return
      editor.update(() => {
        const root = $getRoot()
        let count = -1
        let done = false
        const walk = (node) => {
          if (done) return
          const children = node.getChildren?.() || []
          for (let i = 0; i < children.length; i++) {
            let child = children[i]
            if (child.getChildren) { walk(child); continue }
            if (typeof child.getTextContent === 'function') {
              const style = child.getStyle ? child.getStyle() : ''
              if (style && style.includes('rgba(255,215,0,.3)')) {
                count++
                if (count === current) {
                  // 替换当前高亮文本
                  const newNode = $createTextNode(replace)
                  newNode.setFormat(child.getFormat?.() || 0)
                  child.replace(newNode)
                  done = true
                  break
                }
              }
            }
          }
        }
        walk(root)
      })
      // 跳到下一个
      setTimeout(() => { focusHighlight(current + 1) }, 0)
    }, [editor, current, query, replace])
    const focusHighlight = (index) => {
      const nodes = document.querySelectorAll('.editable span[style*="rgba(255,215,0,.3)"]')
      if (!nodes || nodes.length === 0) return
      const i = ((index % nodes.length) + nodes.length) % nodes.length
      const el = nodes[i]
      el.scrollIntoView({ block: 'center' })
      setCurrent(i)
      const sel = window.getSelection()
      if (sel && el.firstChild) {
        const range = document.createRange()
        range.selectNodeContents(el)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
    const next = () => focusHighlight(current + 1)
    const prev = () => focusHighlight(current - 1)
    const replaceRemaining = () => {
      const nodes = document.querySelectorAll('.editable span[style*="rgba(255,215,0,.3)"]')
      if (!nodes || nodes.length === 0) return
      const start = ((current % nodes.length) + nodes.length) % nodes.length
      editor.update(() => {
        const root = $getRoot()
        let idx = -1
        const walk = (node) => {
          const children = node.getChildren?.() || []
          for (let i = 0; i < children.length; i++) {
            let child = children[i]
            if (child.getChildren) { walk(child); continue }
            if (typeof child.getTextContent === 'function') {
              const style = child.getStyle ? child.getStyle() : ''
              if (style && style.includes('rgba(255,215,0,.3)')) {
                idx++
                if (idx >= start) {
                  const newNode = $createTextNode(replace)
                  newNode.setFormat(child.getFormat?.() || 0)
                  child.replace(newNode)
                }
              }
            }
          }
        }
        walk(root)
      })
      clearHighlights()
    }
    const skipAll = () => {
      clearHighlights()
    }
    return (
      <div className="search-replace">
        <input className="input" placeholder="搜索" value={query} onChange={(e) => setQuery(e.target.value)} />
        <input className="input" placeholder="替换为" value={replace} onChange={(e) => setReplace(e.target.value)} />
        <button className="btn" onClick={onReplaceAll}>全部替换</button>
        <button className="btn" onClick={replaceCurrent}>替换当前</button>
        <button className="btn" onClick={highlightAll}>全部高亮</button>
        <button className="btn" onClick={prev}>上一个</button>
        <button className="btn" onClick={next}>下一个</button>
        <button className="btn" onClick={replaceRemaining}>替换余下</button>
        <button className="btn" onClick={skipAll}>跳过全部</button>
        <button className="btn" onClick={clearHighlights}>清除高亮</button>
      </div>
    )
  }

  return (
    <div className="editor">
      <LexicalComposer initialConfig={initialConfig}>
        <div className="toolbar-fixed">
          <Toolbar />
        </div>
        <RichTextPlugin contentEditable={<ContentEditable className="editable" />} placeholder={<div className="placeholder">开始记录你的灵感…</div>} ErrorBoundary={LexicalErrorBoundary} />
        <LexicalOnChangePlugin onChange={onLexicalChange} />
        <ContentBridge id={docId} val={value} />
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <SearchReplace />
      </LexicalComposer>
    </div>
  )
}
