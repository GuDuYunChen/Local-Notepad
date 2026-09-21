import React, { useEffect, useMemo, useState } from 'react'
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

export function getCollapsedOutlineKeys(nodes, collapsedKeys) {
  const collapsed = collapsedKeys instanceof Set
    ? collapsedKeys
    : new Set(collapsedKeys || [])

  const hidden = new Set()

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (!node?.isHeading || !collapsed.has(node.key)) continue

    for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex++) {
      const next = nodes[nextIndex]
      if (next?.isHeading && next.level <= node.level) break
      hidden.add(next.key)
    }
  }

  return hidden
}

export function findOutlineHeadingForKey(nodes, topLevelKey) {
  const targetIndex = (Array.isArray(nodes) ? nodes : []).findIndex(node => node.key === topLevelKey)
  if (targetIndex < 0) return null

  for (let index = targetIndex; index >= 0; index--) {
    if (nodes[index]?.isHeading) return nodes[index]
  }

  return null
}

function hasCollapsibleContent(nodes, headingKey) {
  const index = nodes.findIndex(node => node.key === headingKey)
  const heading = nodes[index]
  if (index < 0 || !heading?.isHeading) return false

  const next = nodes[index + 1]
  if (!next) return false
  return !(next.isHeading && next.level <= heading.level)
}

export default function DocumentOutlinePlugin() {
  const [editor] = useLexicalComposerContext()
  const [headings, setHeadings] = useState([])
  const [outlineNodes, setOutlineNodes] = useState([])
  const [collapsedKeys, setCollapsedKeys] = useState(() => new Set())
  const [activeKey, setActiveKey] = useState('')
  const [bodyToggle, setBodyToggle] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const collect = editorState => {
      let nextHeadings = []
      let nextNodes = []

      editorState.read(() => {
        nextNodes = $getRoot().getChildren().map(node => {
          const isHeading = $isHeadingNode(node)
          const level = isHeading ? (levelLabel[node.getTag()] || 1) : null
          return {
            key: node.getKey(),
            isHeading,
            level,
            text: isHeading ? (node.getTextContent().trim() || '未命名标题') : '',
          }
        })

        nextHeadings = nextNodes.filter(node => node.isHeading)
      })

      setOutlineNodes(nextNodes)
      setHeadings(nextHeadings)

      const validHeadingKeys = new Set(nextHeadings.map(item => item.key))
      setCollapsedKeys(previous => {
        const next = new Set([...previous].filter(key => validHeadingKeys.has(key)))
        if (next.size === previous.size && [...next].every(key => previous.has(key))) return previous
        return next
      })

      if (nextHeadings.length < 2) setOpen(false)
    }

    collect(editor.getEditorState())
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      const hasContentChanges = (dirtyElements?.size || 0) > 0 || (dirtyLeaves?.size || 0) > 0
      if (!hasContentChanges) return
      collect(editorState)
    })
  }, [editor])

  const hiddenKeys = useMemo(
    () => getCollapsedOutlineKeys(outlineNodes, collapsedKeys),
    [outlineNodes, collapsedKeys]
  )

  useEffect(() => {
    if (!outlineNodes.length) return undefined

    for (const node of outlineNodes) {
      const element = editor.getElementByKey(node.key)
      if (!element) continue
      element.style.display = hiddenKeys.has(node.key) ? 'none' : ''
      element.classList.toggle(
        'outline-section-collapsed',
        Boolean(node.isHeading && collapsedKeys.has(node.key))
      )
    }

    return () => {
      for (const node of outlineNodes) {
        const element = editor.getElementByKey(node.key)
        if (!element) continue
        element.style.display = ''
        element.classList.remove('outline-section-collapsed')
      }
    }
  }, [editor, outlineNodes, hiddenKeys, collapsedKeys])

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
        let nextKey = headings.find(heading => !hiddenKeys.has(heading.key))?.key || ''

        for (const heading of headings) {
          if (hiddenKeys.has(heading.key)) continue
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
  }, [editor, headings, hiddenKeys])

  useEffect(() => {
    const rootElement = editor.getRootElement()
    const scroller = rootElement?.closest('.editor-container')
    if (!rootElement || !scroller) return undefined

    const onMouseMove = event => {
      const headingElement = event.target?.closest?.('h1, h2, h3, h4, h5, h6')
      if (!headingElement || !rootElement.contains(headingElement)) {
        setBodyToggle(null)
        return
      }

      const heading = headings.find(item => editor.getElementByKey(item.key) === headingElement)
      if (!heading || !hasCollapsibleContent(outlineNodes, heading.key)) {
        setBodyToggle(null)
        return
      }

      const rect = headingElement.getBoundingClientRect()
      setBodyToggle({
        key: heading.key,
        collapsed: collapsedKeys.has(heading.key),
        top: rect.top + Math.max(0, (rect.height - 24) / 2),
        left: Math.max(6, rect.left - 32),
      })
    }

    const hide = () => setBodyToggle(null)

    rootElement.addEventListener('mousemove', onMouseMove)
    scroller.addEventListener('scroll', hide, { passive: true })
    window.addEventListener('resize', hide)

    return () => {
      rootElement.removeEventListener('mousemove', onMouseMove)
      scroller.removeEventListener('scroll', hide)
      window.removeEventListener('resize', hide)
    }
  }, [editor, headings, outlineNodes, collapsedKeys])

  useEffect(() => {
    const onSearchMatch = event => {
      const topLevelKey = event.detail?.topLevelKey
      if (!topLevelKey || !outlineNodes.length) return

      const heading = findOutlineHeadingForKey(outlineNodes, topLevelKey)
      if (!heading) return

      setCollapsedKeys(previous => {
        if (!previous.size) return previous

        let changed = false
        const next = new Set(previous)

        for (const collapsedKey of previous) {
          const hiddenByHeading = getCollapsedOutlineKeys(outlineNodes, new Set([collapsedKey]))
          if (hiddenByHeading.has(topLevelKey) || hiddenByHeading.has(heading.key)) {
            next.delete(collapsedKey)
            changed = true
          }
        }

        return changed ? next : previous
      })

      setActiveKey(heading.key)
      if (headings.length >= 2) setOpen(true)
    }

    window.addEventListener('editor:search-match', onSearchMatch)
    return () => window.removeEventListener('editor:search-match', onSearchMatch)
  }, [outlineNodes, headings.length])

  if (headings.length === 0) return null

  const visibleHeadings = headings.filter(heading => !hiddenKeys.has(heading.key))

  const goToHeading = key => {
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

  const toggleCollapsed = key => {
    setCollapsedKeys(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <>
      {bodyToggle && (
        <button
          type="button"
          className={`heading-body-collapse${bodyToggle.collapsed ? ' collapsed' : ''}`}
          style={{ top: bodyToggle.top, left: bodyToggle.left }}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            toggleCollapsed(bodyToggle.key)
            setBodyToggle(previous => previous ? { ...previous, collapsed: !previous.collapsed } : previous)
          }}
          aria-label={bodyToggle.collapsed ? '展开当前章节' : '折叠当前章节'}
          title={bodyToggle.collapsed ? '展开章节' : '折叠章节'}
        >
          ›
        </button>
      )}

      {headings.length >= 2 && (
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
            <div>
              <strong>文档目录</strong>
              <small>点击跳转 · 箭头折叠章节</small>
            </div>
            <span>{headings.length} 个标题</span>
          </div>

          <div className="document-outline-list">
            {visibleHeadings.map(heading => {
              const collapsible = hasCollapsibleContent(outlineNodes, heading.key)
              const collapsed = collapsedKeys.has(heading.key)

              return (
                <div
                  key={heading.key}
                  className={`document-outline-row level-${Math.min(heading.level, 4)}${activeKey === heading.key ? ' active' : ''}`}
                >
                  <button
                    type="button"
                    className="document-outline-collapse"
                    onClick={() => collapsible && toggleCollapsed(heading.key)}
                    disabled={!collapsible}
                    aria-label={collapsed ? '展开章节' : '折叠章节'}
                    title={collapsible ? (collapsed ? '展开章节' : '折叠章节') : ''}
                  >
                    <span className={collapsed ? '' : 'open'}>›</span>
                  </button>

                  <button
                    type="button"
                    className="document-outline-item"
                    onClick={() => goToHeading(heading.key)}
                    title={heading.text}
                    aria-current={activeKey === heading.key ? 'location' : undefined}
                  >
                    {heading.text}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
        </div>
      )}
    </>
  )
}
