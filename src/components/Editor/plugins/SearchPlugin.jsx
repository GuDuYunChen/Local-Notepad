import React, { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'

function isWordChar(char) {
  return Boolean(char && /[\p{L}\p{N}_]/u.test(char))
}

export function findTextMatchOffsets(text, query, options = {}) {
  const source = String(text || '')
  const needle = String(query || '')
  if (!needle) return []

  const matchCase = Boolean(options.matchCase)
  const wholeWord = Boolean(options.wholeWord)
  const haystack = matchCase ? source : source.toLocaleLowerCase()
  const target = matchCase ? needle : needle.toLocaleLowerCase()
  const results = []

  let startIndex = 0
  while (startIndex <= haystack.length - target.length) {
    const index = haystack.indexOf(target, startIndex)
    if (index === -1) break

    let accepted = true
    if (wholeWord) {
      const before = source[index - 1] || ''
      const after = source[index + needle.length] || ''
      if (isWordChar(needle[0]) && isWordChar(before)) accepted = false
      if (isWordChar(needle[needle.length - 1]) && isWordChar(after)) accepted = false
    }

    if (accepted) results.push(index)
    startIndex = index + Math.max(1, target.length)
  }

  return results
}

function $findAllTextNodes(text, options) {
  if (!text) return []

  const results = []

  const traverse = node => {
    if (node.getType() === 'text') {
      const nodeText = node.getTextContent()
      for (const offset of findTextMatchOffsets(nodeText, text, options)) {
        results.push({
          node,
          offset,
          length: text.length,
        })
      }
    }

    for (const child of node.getChildren?.() || []) traverse(child)
  }

  for (const child of $getRoot().getChildren()) traverse(child)
  return results
}

function topLevelKey(node) {
  let current = node
  while (current?.getParent && current.getParent()?.getType?.() !== 'root') {
    current = current.getParent()
  }
  return current?.getKey?.() || ''
}

function notifySearchMatch(node) {
  const key = topLevelKey(node)
  if (!key) return

  window.dispatchEvent(new CustomEvent('editor:search-match', {
    detail: { topLevelKey: key },
  }))
}

function OptionChip({ active, label, title, onClick }) {
  return (
    <button
      type="button"
      className={'search-option-chip' + (active ? ' active' : '')}
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
      title={title}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}

export default function SearchPlugin() {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const deferredSearchText = useDeferredValue(searchText)
  const [matchCount, setMatchCount] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [contentRevision, setContentRevision] = useState(0)
  const inputRef = useRef(null)

  const options = {
    matchCase,
    wholeWord,
  }

  useEffect(() => {
    if (!isOpen) return

    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [isOpen, showReplace])

  useEffect(() => {
    if (!isOpen) return undefined

    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      const hasContentChanges =
        (dirtyElements?.size || 0) > 0 ||
        (dirtyLeaves?.size || 0) > 0

      if (hasContentChanges) {
        setContentRevision(value => value + 1)
      }
    })
  }, [editor, isOpen])

  useEffect(() => {
    if (!isOpen || !deferredSearchText) {
      setMatchCount(0)
      setCurrentIndex(-1)
      return
    }

    editor.update(() => {
      const results = $findAllTextNodes(deferredSearchText, options)
      setMatchCount(results.length)

      if (!results.length) {
        setCurrentIndex(-1)
        return
      }

      setCurrentIndex(0)
      const { node, offset, length } = results[0]
      node.select(offset, offset + length)
      notifySearchMatch(node)
    })
  }, [isOpen, deferredSearchText, editor, matchCase, wholeWord, contentRevision])

  const goToMatch = useCallback((index) => {
    editor.update(() => {
      const results = $findAllTextNodes(deferredSearchText, {
        matchCase,
        wholeWord,
      })
      if (!results.length) return

      const nextIndex = ((index % results.length) + results.length) % results.length
      setCurrentIndex(nextIndex)

      const { node, offset, length } = results[nextIndex]
      node.select(offset, offset + length)
      notifySearchMatch(node)
    })
  }, [deferredSearchText, editor, matchCase, wholeWord])

  const handleFindNext = useCallback(() => {
    goToMatch(currentIndex + 1)
  }, [currentIndex, goToMatch])

  const handleFindPrev = useCallback(() => {
    goToMatch(currentIndex - 1)
  }, [currentIndex, goToMatch])

  const handleReplace = useCallback(() => {
    if (currentIndex < 0 || !searchText) return

    editor.update(() => {
      const results = $findAllTextNodes(searchText, {
        matchCase,
        wholeWord,
      })
      if (!results.length || currentIndex >= results.length) return

      const { node, offset, length } = results[currentIndex]
      const value = node.getTextContent()
      node.setTextContent(
        value.slice(0, offset) +
        replaceText +
        value.slice(offset + length)
      )
    })
  }, [currentIndex, editor, matchCase, replaceText, searchText, wholeWord])

  const handleReplaceAll = useCallback(() => {
    if (!searchText) return

    editor.update(() => {
      const nodes = []

      const traverse = node => {
        if (node.getType() === 'text') nodes.push(node)
        for (const child of node.getChildren?.() || []) traverse(child)
      }
      for (const child of $getRoot().getChildren()) traverse(child)

      for (const node of nodes) {
        const value = node.getTextContent()
        const offsets = findTextMatchOffsets(value, searchText, {
          matchCase,
          wholeWord,
        })
        if (!offsets.length) continue

        let next = value
        for (const offset of [...offsets].reverse()) {
          next =
            next.slice(0, offset) +
            replaceText +
            next.slice(offset + searchText.length)
        }
        node.setTextContent(next)
      }
    })
  }, [editor, matchCase, replaceText, searchText, wholeWord])

  useEffect(() => {
    const focusSearch = replace => {
      setIsOpen(true)
      setShowReplace(Boolean(replace))
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }

    const handleKeyDown = event => {
      const modifier = event.ctrlKey || event.metaKey
      if (!modifier) return

      const key = event.key.toLowerCase()
      if (key === 'f') {
        event.preventDefault()
        focusSearch(false)
      } else if (key === 'h') {
        event.preventDefault()
        focusSearch(true)
      }
    }

    const handleOpenSearch = event => {
      focusSearch(Boolean(event?.detail?.replace))
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('editor:open-search', handleOpenSearch)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('editor:open-search', handleOpenSearch)
    }
  }, [])

  if (!isOpen) return null

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <strong>{showReplace ? '查找与替换' : '查找'}</strong>
        <button
          type="button"
          className="search-btn close-btn"
          onClick={() => {
            setIsOpen(false)
            editor.focus()
          }}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      <div className="search-row">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="搜索…"
          value={searchText}
          onChange={event => setSearchText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (event.shiftKey) handleFindPrev()
              else handleFindNext()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setIsOpen(false)
              editor.focus()
            }
          }}
        />
        <div className="search-count">
          {matchCount > 0 ? String(currentIndex + 1) + '/' + matchCount : '0/0'}
        </div>
        <button type="button" className="search-btn" onClick={handleFindPrev} disabled={!matchCount}>↑</button>
        <button type="button" className="search-btn" onClick={handleFindNext} disabled={!matchCount}>↓</button>
      </div>

      {showReplace && (
        <div className="search-row">
          <input
            className="search-input"
            placeholder="替换为…"
            value={replaceText}
            onChange={event => setReplaceText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (event.shiftKey) handleReplaceAll()
                else handleReplace()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setIsOpen(false)
                editor.focus()
              }
            }}
          />
          <button type="button" className="search-btn" onClick={handleReplace} disabled={!matchCount || currentIndex < 0}>替换</button>
          <button type="button" className="search-btn" onClick={handleReplaceAll} disabled={!matchCount}>全部</button>
        </div>
      )}

      <div className="search-options">
        <OptionChip
          active={matchCase}
          label="Aa"
          title="区分大小写"
          onClick={() => setMatchCase(value => !value)}
        />
        <OptionChip
          active={wholeWord}
          label="整词"
          title="仅匹配完整单词或词组"
          onClick={() => setWholeWord(value => !value)}
        />
        <button
          type="button"
          className={'search-option-chip' + (showReplace ? ' active' : '')}
          onMouseDown={event => event.preventDefault()}
          onClick={() => setShowReplace(value => !value)}
        >
          替换
        </button>
      </div>
    </div>
  )
}
