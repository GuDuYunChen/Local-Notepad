import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { $isHeadingNode } from '@lexical/rich-text'
import { buildHeadingAnchor } from '../utils/linkUtils'

const levelLabel = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
}

export function calculateReadingProgress(scrollTop, scrollHeight, clientHeight) {
  const top = Math.max(0, Number(scrollTop) || 0)
  const total = Math.max(0, Number(scrollHeight) || 0)
  const viewport = Math.max(0, Number(clientHeight) || 0)
  const maxScroll = Math.max(0, total - viewport)

  if (maxScroll <= 0) return 100

  return Math.max(
    0,
    Math.min(100, Math.round((top / maxScroll) * 100))
  )
}

export function getOutlineBreadcrumb(nodes, activeKey) {
  const headings = (Array.isArray(nodes) ? nodes : []).filter(node => node?.isHeading)
  const targetIndex = headings.findIndex(node => node.key === activeKey)
  if (targetIndex < 0) return []

  const target = headings[targetIndex]
  const path = [target]
  let currentLevel = target.level

  for (let index = targetIndex - 1; index >= 0 && currentLevel > 1; index--) {
    const candidate = headings[index]
    if (candidate.level < currentLevel) {
      path.unshift(candidate)
      currentLevel = candidate.level
    }
  }

  return path
}

export function findHeadingByPath(nodes, path) {
  const targetPath = (Array.isArray(path) ? path : [])
    .map(value => String(value || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)

  if (!targetPath.length) return null

  const headings = (Array.isArray(nodes) ? nodes : []).filter(node => node?.isHeading)

  for (const heading of headings) {
    const breadcrumb = getOutlineBreadcrumb(headings, heading.key)
      .map(item => String(item.text || '').trim().replace(/\s+/g, ' '))

    if (
      breadcrumb.length === targetPath.length &&
      breadcrumb.every((value, index) => value === targetPath[index])
    ) {
      return heading
    }
  }

  return null
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
  const [caretTopLevelKey, setCaretTopLevelKey] = useState('')
  const [readingProgress, setReadingProgress] = useState(0)
  const [bodyToggle, setBodyToggle] = useState(null)
  const [open, setOpen] = useState(false)
  const [canReturn, setCanReturn] = useState(false)
  const [copiedAnchorKey, setCopiedAnchorKey] = useState('')
  const outlineListRef = useRef(null)
  const navigationOriginRef = useRef(null)
  const anchorCopyTimerRef = useRef(null)

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

  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    let nextTopLevelKey = ''

    editorState.read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      const anchorNode = selection.anchor.getNode()
      const topLevel = anchorNode.getTopLevelElement?.()
      nextTopLevelKey = topLevel?.getKey?.() || ''
    })

    if (nextTopLevelKey) {
      setCaretTopLevelKey(previous => (
        previous === nextTopLevelKey ? previous : nextTopLevelKey
      ))
    }
  }), [editor])

  const hiddenKeys = useMemo(
    () => getCollapsedOutlineKeys(outlineNodes, collapsedKeys),
    [outlineNodes, collapsedKeys]
  )

  const activeBreadcrumb = useMemo(
    () => getOutlineBreadcrumb(headings, activeKey),
    [headings, activeKey]
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
    const rootElement = editor.getRootElement()
    const scroller = rootElement?.closest('.editor-container')
    if (!rootElement || !scroller) return undefined

    let frame = 0

    const updateScrollState = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        setReadingProgress(calculateReadingProgress(
          scroller.scrollTop,
          scroller.scrollHeight,
          scroller.clientHeight,
        ))

        if (!headings.length) {
          setActiveKey('')
          return
        }

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

        setActiveKey(previous => previous === nextKey ? previous : nextKey)
      })
    }

    updateScrollState()
    scroller.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(updateScrollState)
      : null
    resizeObserver?.observe(rootElement)
    resizeObserver?.observe(scroller)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      scroller.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [editor, headings, hiddenKeys])

  useEffect(() => {
    if (!open || !activeKey || !outlineListRef.current) return

    const list = outlineListRef.current
    const row = Array.from(list.querySelectorAll('[data-outline-key]'))
      .find(element => element.dataset.outlineKey === activeKey)

    if (!row) return

    const listRect = list.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    if (rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom) return

    const nextTop = list.scrollTop + rowRect.top - listRect.top - listRect.height * 0.35
    list.scrollTo({
      top: Math.max(0, nextTop),
      behavior: 'smooth',
    })
  }, [activeKey, open])

  useEffect(() => {
    const toggleOutline = () => {
      if (headings.length < 2) return
      setOpen(value => !value)
    }

    const onKeyDown = event => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'o'
      ) {
        event.preventDefault()
        toggleOutline()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('editor:toggle-outline', toggleOutline)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('editor:toggle-outline', toggleOutline)
    }
  }, [headings.length])

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

  const expandForTopLevelKey = topLevelKey => {
    if (!topLevelKey || !outlineNodes.length) return null

    const heading = findOutlineHeadingForKey(outlineNodes, topLevelKey)
    if (!heading) return null

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

    return heading
  }

  useEffect(() => {
    const onSearchMatch = event => {
      const topLevelKey = event.detail?.topLevelKey
      const heading = expandForTopLevelKey(topLevelKey)
      if (!heading) return

      setActiveKey(heading.key)
      if (headings.length >= 2) setOpen(true)
    }

    window.addEventListener('editor:search-match', onSearchMatch)
    return () => window.removeEventListener('editor:search-match', onSearchMatch)
  }, [outlineNodes, headings.length])

  const getScroller = () => (
    editor.getRootElement()?.closest('.editor-container') || null
  )

  const scrollToElement = (element, behavior = 'smooth') => {
    const scroller = getScroller()
    if (!scroller || !element) return

    const scrollerRect = scroller.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    const targetTop = Math.max(
      0,
      scroller.scrollTop + elementRect.top - scrollerRect.top - 24
    )

    scroller.scrollTo({
      top: targetTop,
      behavior,
    })
  }

  const rememberNavigationOrigin = () => {
    const scroller = getScroller()
    if (!scroller) return
    navigationOriginRef.current = scroller.scrollTop
    setCanReturn(true)
  }

  const flashElement = element => {
    window.setTimeout(() => {
      element.classList.add('outline-target-flash')
      window.setTimeout(() => element.classList.remove('outline-target-flash'), 900)
    }, 180)
  }

  const goToHeading = (key, rememberOrigin = true) => {
    const element = editor.getElementByKey(key)
    if (!element) return

    if (rememberOrigin) rememberNavigationOrigin()
    setActiveKey(key)
    scrollToElement(element)
    flashElement(element)
  }

  const goToCaret = () => {
    if (!caretTopLevelKey) return

    const heading = expandForTopLevelKey(caretTopLevelKey)
    const element = editor.getElementByKey(caretTopLevelKey)
    if (!element) return

    rememberNavigationOrigin()
    if (heading) setActiveKey(heading.key)

    window.requestAnimationFrame(() => {
      scrollToElement(element)
      flashElement(element)
    })
  }

  const returnToOrigin = () => {
    const scroller = getScroller()
    const origin = navigationOriginRef.current
    if (!scroller || typeof origin !== 'number') return

    scroller.scrollTo({
      top: origin,
      behavior: 'smooth',
    })
    navigationOriginRef.current = null
    setCanReturn(false)
  }

  const toggleCollapsed = key => {
    setCollapsedKeys(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const copyHeadingAnchor = async heading => {
    const breadcrumb = getOutlineBreadcrumb(headings, heading.key)
    const href = buildHeadingAnchor(breadcrumb.map(item => item.text))
    if (!href) return

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(href)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = href
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
      }

      if (anchorCopyTimerRef.current) {
        window.clearTimeout(anchorCopyTimerRef.current)
      }
      setCopiedAnchorKey(heading.key)
      anchorCopyTimerRef.current = window.setTimeout(() => {
        setCopiedAnchorKey('')
        anchorCopyTimerRef.current = null
      }, 1200)
    } catch {
      // Copying an anchor is optional; navigation remains usable.
    }
  }

  useEffect(() => {
    const onOpenHeadingAnchor = event => {
      const target = findHeadingByPath(headings, event.detail?.path)
      if (!target) return

      const breadcrumb = getOutlineBreadcrumb(headings, target.key)
      const ancestorKeys = new Set(breadcrumb.map(item => item.key))

      rememberNavigationOrigin()
      setOpen(true)
      setCollapsedKeys(previous => {
        let changed = false
        const next = new Set(previous)
        for (const key of ancestorKeys) {
          if (next.delete(key)) changed = true
        }
        return changed ? next : previous
      })

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => goToHeading(target.key, false))
      })
    }

    window.addEventListener('editor:open-heading-anchor', onOpenHeadingAnchor)
    return () => window.removeEventListener('editor:open-heading-anchor', onOpenHeadingAnchor)
  }, [headings])

  useEffect(() => () => {
    if (anchorCopyTimerRef.current) {
      window.clearTimeout(anchorCopyTimerRef.current)
      anchorCopyTimerRef.current = null
    }
  }, [])

  const visibleHeadings = headings.filter(heading => !hiddenKeys.has(heading.key))

  return (
    <>
      <div
        className="document-reading-progress"
        aria-hidden="true"
        title={'阅读进度 ' + readingProgress + '%'}
      >
        <span style={{ width: String(readingProgress) + '%' }} />
      </div>

      {bodyToggle && (
        <button
          type="button"
          className={'heading-body-collapse' + (bodyToggle.collapsed ? ' collapsed' : '')}
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
        <div className={'document-outline' + (open ? ' open' : '')}>
          <button
            type="button"
            className="document-outline-toggle"
            onClick={() => setOpen(prev => !prev)}
            aria-expanded={open}
            aria-label="文档目录"
            title="文档目录 (Ctrl+Shift+O)"
          >
            <span aria-hidden="true">☰</span>
            <span>{headings.length}</span>
          </button>

          {open && (
            <div className="document-outline-panel">
              <div
                className="document-outline-progress-track"
                aria-label={'阅读进度 ' + readingProgress + '%'}
              >
                <span style={{ width: String(readingProgress) + '%' }} />
              </div>

              <div className="document-outline-header">
                <div>
                  <strong>文档目录</strong>
                  <small>滚动自动跟随 · # 可复制章节锚点</small>
                </div>
                <div className="document-outline-header-actions">
                  <span>{readingProgress}%</span>
                  <button
                    type="button"
                    onClick={goToCaret}
                    disabled={!caretTopLevelKey}
                    title="回到最后输入位置"
                  >
                    光标
                  </button>
                  {canReturn && (
                    <button
                      type="button"
                      onClick={returnToOrigin}
                      title="返回目录跳转前的位置"
                    >
                      返回
                    </button>
                  )}
                </div>
              </div>

              {activeBreadcrumb.length > 0 && (
                <div className="document-outline-context" aria-label="当前章节路径">
                  <span>当前位置</span>
                  <div>
                    {activeBreadcrumb.map((heading, index) => (
                      <React.Fragment key={heading.key}>
                        {index > 0 && <i aria-hidden="true">›</i>}
                        <button
                          type="button"
                          onClick={() => goToHeading(heading.key)}
                          title={heading.text}
                        >
                          {heading.text}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              <div className="document-outline-list" ref={outlineListRef}>
                {visibleHeadings.map(heading => {
                  const collapsible = hasCollapsibleContent(outlineNodes, heading.key)
                  const collapsed = collapsedKeys.has(heading.key)

                  return (
                    <div
                      key={heading.key}
                      data-outline-key={heading.key}
                      className={'document-outline-row level-' + Math.min(heading.level, 4) + (activeKey === heading.key ? ' active' : '')}
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

                      <button
                        type="button"
                        className={'document-outline-anchor' + (copiedAnchorKey === heading.key ? ' copied' : '')}
                        onClick={() => void copyHeadingAnchor(heading)}
                        aria-label={'复制章节锚点：' + heading.text}
                        title="复制章节锚点"
                      >
                        {copiedAnchorKey === heading.key ? '✓' : '#'}
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
