import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodes } from 'lexical'
import { blockRegistry } from '../utils/blockRegistry'

const EXTRA_COMMANDS = [
  {
    id: 'find',
    label: '文内查找与替换',
    description: '搜索当前笔记内容',
    keywords: ['find', 'search', '搜索', '查找', '替换'],
    run: () => window.dispatchEvent(new Event('editor:open-search')),
  },
  {
    id: 'outline',
    label: '文档目录',
    description: '打开或关闭长文目录与章节导航',
    keywords: ['outline', 'toc', '目录', '大纲', '章节', '导航'],
    run: () => window.dispatchEvent(new Event('editor:toggle-outline')),
  },
  {
    id: 'long-form-structure',
    label: '长篇结构管理',
    description: '管理卷、章、场的重排、合并与拆出',
    keywords: ['structure', '结构', '卷', '章', '场', '重排', '拆分', '合并'],
    run: () => window.dispatchEvent(new Event('editor:open-structure-manager')),
  },
  {
    id: 'copy-reference',
    label: '复制当前章节引用',
    description: '复制当前笔记与章节的结构化引用',
    keywords: ['reference', '引用', '章节引用', '复制引用', 'wiki'],
    run: () => window.dispatchEvent(new Event('editor:copy-current-reference')),
  },
  {
    id: 'table-selection',
    label: '表格多选模式',
    description: '框选多个单元格并批量操作',
    keywords: ['table', '表格', '多选', '合并', '单元格'],
    run: () => window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true })),
  },
]

export function filterCommandPaletteCommands(commands, query) {
  const normalized = String(query || '').trim().toLowerCase()
  if (!normalized) return commands

  return commands.filter(command => {
    const haystack = [
      command.label,
      command.description,
      ...(command.keywords || []),
    ].join(' ').toLowerCase()
    return haystack.includes(normalized)
  })
}

function buildCommands(editor) {
  const blockCommands = blockRegistry.map(block => ({
    id: 'block:' + block.type,
    label: block.label,
    description: block.description || '插入内容块',
    keywords: block.keywords || [],
    run: async () => {
      if (block.run) {
        await block.run(editor)
        return
      }

      if (!block.createNode) return
      editor.update(() => {
        const node = block.createNode()
        if (node) $insertNodes([node])
      })
      editor.focus()
    },
  }))

  return [
    ...EXTRA_COMMANDS,
    ...blockCommands,
  ]
}

export default function CommandPalettePlugin() {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const commands = useMemo(() => buildCommands(editor), [editor])
  const filtered = useMemo(
    () => filterCommandPaletteCommands(commands, query),
    [commands, query]
  )

  useEffect(() => {
    if (!open) return
    setSelectedIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (selectedIndex < filtered.length) return
    setSelectedIndex(Math.max(0, filtered.length - 1))
  }, [filtered.length, selectedIndex])

  useEffect(() => {
    const openPalette = () => {
      setOpen(true)
      setQuery('')
    }

    const onKeyDown = event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        openPalette()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('editor:open-command-palette', openPalette)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('editor:open-command-palette', openPalette)
    }
  }, [])

  const close = () => {
    setOpen(false)
    setQuery('')
    editor.focus()
  }

  const runCommand = async command => {
    if (!command) return
    setOpen(false)
    setQuery('')
    try {
      await command.run()
    } finally {
      editor.focus()
    }
  }

  if (!open) return null

  return (
    <div
      className="editor-command-palette-overlay"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        className="editor-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="编辑器命令"
      >
        <div className="editor-command-palette-search">
          <span aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                if (filtered.length) setSelectedIndex(index => (index + 1) % filtered.length)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                if (filtered.length) setSelectedIndex(index => (index - 1 + filtered.length) % filtered.length)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                void runCommand(filtered[selectedIndex])
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
            placeholder="输入命令，例如：公式、表格、标题、查找…"
            aria-label="搜索编辑器命令"
          />
          <kbd>Ctrl ⇧ P</kbd>
        </div>

        <div className="editor-command-palette-list" role="listbox">
          {filtered.length ? filtered.map((command, index) => (
            <button
              type="button"
              key={command.id}
              className={`editor-command-item${index === selectedIndex ? ' active' : ''}`}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => void runCommand(command)}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <span className="editor-command-copy">
                <strong>{command.label}</strong>
                <small>{command.description}</small>
              </span>
              <span className="editor-command-arrow" aria-hidden="true">↵</span>
            </button>
          )) : (
            <div className="editor-command-empty">没有匹配的命令</div>
          )}
        </div>
      </section>
    </div>
  )
}
