import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
} from '@lexical/table'
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
} from '@lexical/list'
import { TOGGLE_LINK_COMMAND } from '@lexical/link'
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from '@lexical/rich-text'
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical'
import { $patchStyleText, $setBlocksType } from '@lexical/selection'
import { mergeRegister, $getNearestBlockElementAncestorOrThrow } from '@lexical/utils'

import { INSERT_CODE_BLOCK_COMMAND } from './CodeBlockPlugin'
import { $createImageNode } from '../nodes/ImageNode'
import { $createImageGridNode } from '../nodes/ImageGridNode'
import { $createVideoNode } from '../nodes/VideoNode'
import { $createCalloutNode } from '../nodes/CalloutNode'
import { $createDividerNode } from '../nodes/DividerNode'
import { $createToggleNode } from '../nodes/ToggleNode'
import { $createEmbedNode } from '../nodes/EmbedNode'
import { $createAttachmentNode } from '../nodes/AttachmentNode'
import { $createFormulaNode } from '../nodes/FormulaNode'
import { compressImage, generateVideoMetadata, loadXLSX, uploadFile } from '../utils/fileUpload'
import { toast } from '~/services/toast'
import TableMenu from './TableMenu'
import { normalizeLinkUrl } from '../utils/linkUtils'
import './TextColorPlugin.css'

const FontOptions = [
  { label: '系统默认', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' },
  { label: '微软雅黑', value: 'Microsoft YaHei' },
  { label: '宋体', value: 'SimSun' },
  { label: '黑体', value: 'SimHei' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: '阿里妈妈灵动体', value: 'AlimamaAgileVF' },
]

const FontSizeOptions = ['12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px']

const TEXT_COLORS = [
  { label: '默认', value: '' },
  { label: '红色', value: '#ef4444' },
  { label: '橙色', value: '#f97316' },
  { label: '黄色', value: '#eab308' },
  { label: '绿色', value: '#22c55e' },
  { label: '蓝色', value: '#3b82f6' },
  { label: '紫色', value: '#8b5cf6' },
]

const HIGHLIGHT_COLORS = [
  { label: '无', value: '' },
  { label: '红色', value: '#fee2e2' },
  { label: '橙色', value: '#ffedd5' },
  { label: '黄色', value: '#fef9c3' },
  { label: '绿色', value: '#dcfce7' },
  { label: '蓝色', value: '#dbeafe' },
  { label: '紫色', value: '#f3e8ff' },
]

const BLOCK_OPTIONS = [
  ['paragraph', '正文'],
  ['h1', '标题 1'],
  ['h2', '标题 2'],
  ['h3', '标题 3'],
  ['h4', '标题 4'],
  ['quote', '引用'],
]

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext()
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [fontSize, setFontSize] = useState('16px')
  const [fontFamily, setFontFamily] = useState(() => (
    localStorage.getItem('editor-font-family') || FontOptions[0].value
  ))
  const [isUploading, setIsUploading] = useState(false)
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isCode, setIsCode] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [blockType, setBlockType] = useState('paragraph')
  const [isBulletList, setIsBulletList] = useState(false)
  const [isNumberList, setIsNumberList] = useState(false)
  const [isCheckList, setIsCheckList] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [elementFormat, setElementFormat] = useState('left')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showHighlightPicker, setShowHighlightPicker] = useState(false)
  const [insertOpen, setInsertOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const fontSelectRef = useRef(null)
  const colorPickerRef = useRef(null)
  const insertMenuRef = useRef(null)
  const moreMenuRef = useRef(null)
  const linkRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        fontSelectRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const openLink = () => {
      setLinkOpen(true)
      setInsertOpen(false)
      setMoreOpen(false)
    }

    window.addEventListener('editor:open-link', openLink)
    return () => window.removeEventListener('editor:open-link', openLink)
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target)) {
        setShowColorPicker(false)
        setShowHighlightPicker(false)
      }
      if (insertMenuRef.current && !insertMenuRef.current.contains(event.target)) {
        setInsertOpen(false)
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setMoreOpen(false)
      }
      if (linkRef.current && !linkRef.current.contains(event.target)) {
        setLinkOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const applyStyle = (style, value) => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { [style]: value })
      }
    })
  }

  const applyTextColor = (color) => {
    applyStyle('color', color)
    setShowColorPicker(false)
    editor.focus()
  }

  const applyHighlight = (color) => {
    applyStyle('background-color', color)
    setShowHighlightPicker(false)
    editor.focus()
  }

  const handleFontChange = (event) => {
    const value = event.target.value
    setFontFamily(value)
    localStorage.setItem('editor-font-family', value)
    applyStyle('font-family', value)
  }

  const updateToolbar = useCallback(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    setIsBold(selection.hasFormat('bold'))
    setIsItalic(selection.hasFormat('italic'))
    setIsUnderline(selection.hasFormat('underline'))
    setIsCode(selection.hasFormat('code'))
    setIsStrikethrough(selection.hasFormat('strikethrough'))
    setHasSelection(!selection.isCollapsed())

    const anchorNode = selection.anchor.getNode()
    let element = anchorNode.getKey() === 'root'
      ? anchorNode
      : $getNearestBlockElementAncestorOrThrow(anchorNode)

    if (element.getType?.() === 'listitem' && element.getParent()) {
      element = element.getParent()
    }

    setElementFormat(element.getFormatType?.() || 'left')

    if ($isHeadingNode(element)) {
      setBlockType(element.getTag())
      setIsBulletList(false)
      setIsNumberList(false)
      setIsCheckList(false)
      return
    }

    if ($isQuoteNode(element)) {
      setBlockType('quote')
      setIsBulletList(false)
      setIsNumberList(false)
      setIsCheckList(false)
      return
    }

    if ($isListNode(element)) {
      const listType = element.getListType()
      setBlockType('paragraph')
      setIsBulletList(listType === 'bullet')
      setIsNumberList(listType === 'number')
      setIsCheckList(listType === 'check')
      return
    }

    setBlockType('paragraph')
    setIsBulletList(false)
    setIsNumberList(false)
    setIsCheckList(false)
  }, [])

  useEffect(() => mergeRegister(
    editor.registerUpdateListener(({ editorState }) => {
      editorState.read(updateToolbar)
    }),
    editor.registerCommand(CAN_UNDO_COMMAND, payload => {
      setCanUndo(payload)
      return false
    }, 1),
    editor.registerCommand(CAN_REDO_COMMAND, payload => {
      setCanRedo(payload)
      return false
    }, 1),
  ), [editor, updateToolbar])

  const formatBlock = (nextType) => {
    editor.dispatchCommand(REMOVE_LIST_COMMAND)

    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      if (nextType === 'paragraph') {
        $setBlocksType(selection, () => $createParagraphNode())
      } else if (nextType === 'quote') {
        $setBlocksType(selection, () => $createQuoteNode())
      } else {
        $setBlocksType(selection, () => $createHeadingNode(nextType))
      }
    })

    editor.focus()
  }

  const toggleList = (type) => {
    const active = type === 'bullet'
      ? isBulletList
      : type === 'number'
        ? isNumberList
        : isCheckList

    const command = type === 'bullet'
      ? INSERT_UNORDERED_LIST_COMMAND
      : type === 'number'
        ? INSERT_ORDERED_LIST_COMMAND
        : INSERT_CHECK_LIST_COMMAND

    editor.dispatchCommand(active ? REMOVE_LIST_COMMAND : command)
    editor.focus()
  }

  const insertNode = (node) => {
    editor.update(() => {
      $insertNodes([node])
    })
    setInsertOpen(false)
    editor.focus()
  }

  const applyLink = () => {
    const url = normalizeLinkUrl(linkUrl)
    if (!url || !hasSelection) {
      if (linkUrl.trim()) toast.warning('请输入有效网页链接或章节锚点')
      return
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
    setLinkOpen(false)
    setLinkUrl('')
    editor.focus()
  }

  const removeLink = () => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    setLinkOpen(false)
    setLinkUrl('')
    editor.focus()
  }

  const uploadFileSafe = async (file) => {
    try {
      return await uploadFile(file)
    } catch (error) {
      toast.error(error.message || '上传失败')
      return null
    }
  }

  const handleAttachment = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 100 * 1024 * 1024) {
      toast.warning('单个附件不能超过 100 MB')
      event.target.value = ''
      return
    }

    setIsUploading(true)
    try {
      const result = await uploadFileSafe(file)
      if (!result) return

      editor.update(() => {
        $insertNodes([
          $createAttachmentNode({
            src: result.url,
            name: file.name,
            size: file.size,
            mime: file.type || '',
          }),
        ])
      })
      setInsertOpen(false)
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  const handleImage = async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return

    if (files.some(file => file.size > 10 * 1024 * 1024)) {
      toast.warning('单张图片不能超过 10 MB')
      event.target.value = ''
      return
    }

    setIsUploading(true)
    try {
      const uploads = await Promise.all(files.map(async file => {
        const type = file.type || ''
        const skipCompress = type.includes('gif') || type.includes('png')

        if (!skipCompress && file.size > 2 * 1024 * 1024) {
          try {
            const compressedFile = await compressImage(file)
            const [compressed, original] = await Promise.all([
              uploadFileSafe(compressedFile),
              uploadFileSafe(file),
            ])
            if (compressed && original) {
              return {
                src: compressed.url,
                originalSrc: original.url,
                alt: file.name,
              }
            }
          } catch {
            // Fall back to the original file below.
          }
        }

        const result = await uploadFileSafe(file)
        return result
          ? { src: result.url, originalSrc: result.url, alt: file.name }
          : null
      }))

      const items = uploads.filter(Boolean)
      if (!items.length) return

      editor.update(() => {
        if (items.length === 1) {
          const item = items[0]
          $insertNodes([
            $createImageNode({
              src: item.src,
              originalSrc: item.originalSrc,
              alt: item.alt,
              caption: item.alt,
              width: 640,
            }),
          ])
        } else {
          $insertNodes([$createImageGridNode({ items, columns: 3, gap: 8 })])
        }
      })
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  const handleVideo = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 100 * 1024 * 1024) {
      toast.warning('视频不能超过 100 MB')
      event.target.value = ''
      return
    }

    setIsUploading(true)
    try {
      const metadata = await generateVideoMetadata(file)
      const videoResult = await uploadFileSafe(file)
      if (!videoResult) return

      let coverUrl = null
      if (metadata.coverFile) {
        const coverResult = await uploadFileSafe(metadata.coverFile)
        if (coverResult) coverUrl = coverResult.url
      }

      editor.update(() => {
        $insertNodes([
          $createVideoNode({
            src: videoResult.url,
            width: 720,
            poster: coverUrl,
            duration: metadata.duration,
          }),
        ])
      })
    } catch (error) {
      console.error('视频上传失败', error)
      toast.error(error.message || '视频上传失败')
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  const handleExcel = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      toast.warning('Excel 文件不能超过 5 MB')
      event.target.value = ''
      return
    }

    setIsUploading(true)
    const reader = new FileReader()

    reader.onload = async (loadEvent) => {
      try {
        const XLSX = await loadXLSX()
        const data = new Uint8Array(loadEvent.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

        editor.update(() => {
          const table = $createTableNode()
          for (const rowData of rows) {
            const tableRow = $createTableRowNode()
            for (const cellData of rowData) {
              const tableCell = $createTableCellNode()
              const paragraph = $createParagraphNode()
              paragraph.append($createTextNode(String(cellData)))
              tableCell.append(paragraph)
              tableRow.append(tableCell)
            }
            table.append(tableRow)
          }
          $insertNodes([table])
        })
      } catch (error) {
        console.error('Excel 解析失败', error)
        toast.error('Excel 解析失败')
      } finally {
        setIsUploading(false)
        event.target.value = ''
      }
    }

    reader.onerror = () => {
      setIsUploading(false)
      event.target.value = ''
      toast.error('读取 Excel 文件失败')
    }

    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="editor-toolbar product-editor-toolbar">
      <div className="toolbar-group compact-history" aria-label="历史操作">
        <button
          type="button"
          disabled={!canUndo}
          onClick={() => editor.dispatchCommand(UNDO_COMMAND)}
          className="btn icon-only"
          aria-label="撤销"
          title="撤销 (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={() => editor.dispatchCommand(REDO_COMMAND)}
          className="btn icon-only"
          aria-label="重做"
          title="重做 (Ctrl+Y)"
        >
          ↷
        </button>
      </div>

      <span className="divider" />

      <select
        className="select toolbar-block-select"
        value={blockType}
        onChange={event => formatBlock(event.target.value)}
        aria-label="段落类型"
        title="段落类型"
      >
        {BLOCK_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <span className="divider" />

      <div className="toolbar-group compact-format" aria-label="文字格式">
        <button
          type="button"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
          className={`btn fw-bold${isBold ? ' active' : ''}`}
          aria-label="加粗"
          title="加粗 (Ctrl+B)"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
          className={`btn fst-italic${isItalic ? ' active' : ''}`}
          aria-label="斜体"
          title="斜体 (Ctrl+I)"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
          className={`btn text-decoration-underline${isUnderline ? ' active' : ''}`}
          aria-label="下划线"
          title="下划线 (Ctrl+U)"
        >
          U
        </button>
        <button
          type="button"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')}
          className={`btn toolbar-inline-code${isCode ? ' active' : ''}`}
          aria-label="行内代码"
          title="行内代码"
        >
          &lt;/&gt;
        </button>
      </div>

      <span className="divider" />

      <div className="toolbar-group toolbar-structure" aria-label="结构">
        <button
          type="button"
          className={`btn toolbar-text-btn${isBulletList ? ' active' : ''}`}
          onClick={() => toggleList('bullet')}
          aria-label="无序列表"
          title="无序列表"
        >
          <span aria-hidden="true">•≡</span>
        </button>
        <button
          type="button"
          className={`btn toolbar-text-btn${isNumberList ? ' active' : ''}`}
          onClick={() => toggleList('number')}
          aria-label="有序列表"
          title="有序列表"
        >
          <span aria-hidden="true">1.</span>
        </button>
        <button
          type="button"
          className={`btn toolbar-text-btn${isCheckList ? ' active' : ''}`}
          onClick={() => toggleList('check')}
          aria-label="待办清单"
          title="待办清单 · Ctrl+Alt+T · Tab/Shift+Tab 调整层级"
        >
          <span aria-hidden="true">☑</span>
        </button>
      </div>

      <div className="toolbar-link-wrap" ref={linkRef}>
        <button
          type="button"
          className={`btn toolbar-text-btn${linkOpen ? ' active' : ''}`}
          disabled={!hasSelection}
          onClick={() => setLinkOpen(prev => !prev)}
          aria-label="添加链接"
          title={hasSelection ? '添加链接' : '先选中文字'}
        >
          <span aria-hidden="true">⌁</span>
        </button>

        {linkOpen && (
          <div className="toolbar-link-popover">
            <input
              autoFocus
              className="input"
              value={linkUrl}
              onChange={event => setLinkUrl(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  applyLink()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setLinkOpen(false)
                }
              }}
              placeholder="https:// 或 #heading/章节"
              aria-label="链接地址或章节锚点"
            />
            <button type="button" className="btn primary small" onClick={applyLink} disabled={!linkUrl.trim()}>
              应用
            </button>
            <button type="button" className="btn small" onClick={removeLink}>
              移除
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-spacer" />

      <button
        type="button"
        className="btn toolbar-text-btn toolbar-find-btn"
        onClick={() => window.dispatchEvent(new Event('editor:open-search'))}
        aria-label="文内查找与替换"
        title="文内查找与替换 (Ctrl+F)"
      >
        <span aria-hidden="true">⌕</span>
      </button>

      <button
        type="button"
        className="btn toolbar-text-btn toolbar-command-btn"
        onClick={() => window.dispatchEvent(new Event('editor:open-command-palette'))}
        aria-label="编辑器命令"
        title="编辑器命令 (Ctrl+Shift+P)"
      >
        <span aria-hidden="true">⌘</span>
      </button>

      <button
        type="button"
        className="btn toolbar-text-btn toolbar-view-btn"
        onClick={() => window.dispatchEvent(new Event('editor:toggle-view-settings'))}
        aria-label="写作视图设置"
        title="写作视图设置"
      >
        <span aria-hidden="true">◫</span>
      </button>

      <button
        type="button"
        className="btn toolbar-text-btn toolbar-source-btn"
        onClick={() => window.dispatchEvent(new Event('editor:toggle-source-mode'))}
        aria-label="Markdown 源码"
        title="Markdown 源码 / 视觉编辑"
      >
        <span aria-hidden="true">&lt;/&gt;</span>
      </button>

      <span className="toolbar-slash-hint">输入 / 快速插入</span>
      {isUploading && <span className="toolbar-progress">处理中…</span>}

      <div className="toolbar-more-wrap" ref={insertMenuRef}>
        <button
          type="button"
          className={`btn toolbar-more-trigger${insertOpen ? ' active' : ''}`}
          onClick={() => {
            setInsertOpen(prev => !prev)
            setMoreOpen(false)
          }}
          aria-label="插入内容"
          title="插入内容"
        >
          <span className="toolbar-plus">＋</span>
        </button>

        {insertOpen && (
          <div className="toolbar-more-menu toolbar-insert-menu">
            <div className="toolbar-menu-section">
              <div className="toolbar-menu-label">内容块</div>
              <div className="toolbar-menu-grid toolbar-insert-grid">
                <label className="btn toolbar-menu-action">
                  附件
                  <input type="file" hidden onChange={handleAttachment} />
                </label>
                <label className="btn toolbar-menu-action">
                  图片
                  <input type="file" accept="image/*" multiple hidden onChange={handleImage} />
                </label>
                <label className="btn toolbar-menu-action">
                  视频
                  <input type="file" accept="video/*" hidden onChange={handleVideo} />
                </label>
                <button
                  type="button"
                  className="btn toolbar-menu-action"
                  onClick={() => {
                    editor.dispatchCommand(INSERT_CODE_BLOCK_COMMAND)
                    setInsertOpen(false)
                  }}
                >
                  代码块
                </button>
                <button type="button" className="btn toolbar-menu-action" onClick={() => insertNode($createFormulaNode())} title="Ctrl+Alt+E">
                  数学公式
                </button>
                <button type="button" className="btn toolbar-menu-action" onClick={() => insertNode($createCalloutNode())}>
                  提示块
                </button>
                <button type="button" className="btn toolbar-menu-action" onClick={() => insertNode($createToggleNode())}>
                  折叠块
                </button>
                <button type="button" className="btn toolbar-menu-action" onClick={() => insertNode($createDividerNode())}>
                  分割线
                </button>
                <button type="button" className="btn toolbar-menu-action" onClick={() => insertNode($createEmbedNode())}>
                  嵌入
                </button>
                <label className="btn toolbar-menu-action">
                  Excel
                  <input type="file" accept=".xlsx,.xls" hidden onChange={handleExcel} />
                </label>
              </div>

              <div className="toolbar-table-section">
                <TableMenu />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="toolbar-more-wrap" ref={moreMenuRef}>
        <button
          type="button"
          className={`btn toolbar-format-more${moreOpen ? ' active' : ''}`}
          onClick={() => {
            setMoreOpen(prev => !prev)
            setInsertOpen(false)
          }}
          aria-label="更多格式"
          title="更多格式"
        >
          •••
        </button>

        {moreOpen && (
          <div className="toolbar-more-menu toolbar-format-menu">
            <div className="toolbar-menu-section">
              <div className="toolbar-menu-label">文字样式</div>
              <div className="toolbar-menu-row">
                <select
                  ref={fontSelectRef}
                  value={fontFamily}
                  onChange={handleFontChange}
                  className="select toolbar-wide-select"
                  aria-label="字体"
                >
                  {FontOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={fontSize}
                  onChange={event => {
                    setFontSize(event.target.value)
                    applyStyle('font-size', event.target.value)
                  }}
                  className="select"
                  aria-label="字号"
                >
                  {FontSizeOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>

              <div className="toolbar-menu-row">
                <button
                  type="button"
                  className={`btn${isStrikethrough ? ' active' : ''}`}
                  onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')}
                >
                  删除线
                </button>
                <div className="text-color-group" ref={colorPickerRef}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setShowColorPicker(prev => !prev)
                      setShowHighlightPicker(false)
                    }}
                  >
                    文字颜色
                  </button>
                  {showColorPicker && (
                    <div className="color-picker-dropdown" role="listbox" aria-label="文本颜色选择">
                      {TEXT_COLORS.map(color => (
                        <button
                          type="button"
                          key={color.value || 'default'}
                          className="color-option"
                          onClick={() => applyTextColor(color.value)}
                          title={color.label}
                          aria-label={color.label}
                        >
                          <span
                            className="color-swatch"
                            style={{
                              backgroundColor: color.value || 'transparent',
                              border: !color.value ? '1px dashed var(--muted)' : 'none',
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-color-group">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setShowHighlightPicker(prev => !prev)
                      setShowColorPicker(false)
                    }}
                  >
                    高亮
                  </button>
                  {showHighlightPicker && (
                    <div className="color-picker-dropdown" role="listbox" aria-label="高亮颜色选择">
                      {HIGHLIGHT_COLORS.map(color => (
                        <button
                          type="button"
                          key={color.value || 'default'}
                          className="color-option"
                          onClick={() => applyHighlight(color.value)}
                          title={color.label}
                          aria-label={color.label}
                        >
                          <span
                            className="color-swatch"
                            style={{
                              backgroundColor: color.value || 'transparent',
                              border: !color.value ? '1px dashed var(--muted)' : 'none',
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="toolbar-menu-section">
              <div className="toolbar-menu-label">段落</div>
              <div className="toolbar-menu-row">
                <button
                  type="button"
                  onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left')}
                  className={`btn${elementFormat === 'left' ? ' active' : ''}`}
                >
                  左对齐
                </button>
                <button
                  type="button"
                  onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center')}
                  className={`btn${elementFormat === 'center' ? ' active' : ''}`}
                >
                  居中
                </button>
                <button
                  type="button"
                  onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right')}
                  className={`btn${elementFormat === 'right' ? ' active' : ''}`}
                >
                  右对齐
                </button>
              </div>
              <div className="toolbar-menu-row">
                <button type="button" className="btn" onClick={() => editor.dispatchCommand(OUTDENT_CONTENT_COMMAND)}>
                  减少缩进
                </button>
                <button type="button" className="btn" onClick={() => editor.dispatchCommand(INDENT_CONTENT_COMMAND)}>
                  增加缩进
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
