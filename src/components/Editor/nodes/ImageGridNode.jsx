import { $getNodeByKey, DecoratorNode, HISTORIC_TAG } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { uploadFile } from '../utils/fileUpload'

export class ImageGridNode extends DecoratorNode {
  __items
  __columns
  __gap

  static getType() {
    return 'image-grid'
  }

  static clone(node) {
    return new ImageGridNode(node.__items, node.__columns, node.__gap, node.__key)
  }

  static importJSON(serialized) {
    const { items, columns, gap } = serialized
    return new ImageGridNode(
      Array.isArray(items) ? items : [],
      Number(columns) || 3,
      Number(gap) || 8,
    )
  }

  exportJSON() {
    return {
      type: 'image-grid',
      version: 2,
      items: this.__items,
      columns: this.__columns,
      gap: this.__gap,
    }
  }

  constructor(items, columns = 3, gap = 8, key) {
    super(key)
    this.__items = Array.isArray(items) ? items : []
    this.__columns = columns
    this.__gap = gap
  }

  setColumns(columns) {
    const writable = this.getWritable()
    writable.__columns = columns
  }

  setGap(gap) {
    const writable = this.getWritable()
    writable.__gap = gap
  }

  setItems(items) {
    const writable = this.getWritable()
    writable.__items = items
  }

  createDOM(config) {
    const div = document.createElement('div')
    const className = config.theme.imageGrid
    if (className !== undefined) div.className = className
    return div
  }

  updateDOM() {
    return false
  }

  isInline() {
    return false
  }

  decorate() {
    return (
      <ImageGridComponent
        nodeKey={this.__key}
        items={this.__items}
        columns={this.__columns}
        gap={this.__gap}
      />
    )
  }
}

function uniqueItemIndex(items, item) {
  const index = items.indexOf(item)
  return index >= 0 && items.lastIndexOf(item) === index ? index : -1
}

export function appendImageGridItems(items, additions) {
  return [
    ...(Array.isArray(items) ? items : []),
    ...(Array.isArray(additions) ? additions : []),
  ]
}

export function replaceImageGridItem(items, index, replacement) {
  const list = Array.isArray(items) ? items : []
  if (index < 0 || index >= list.length || !replacement) return [...list]

  return list.map((item, itemIndex) => (
    itemIndex === index
      ? { ...item, ...replacement }
      : item
  ))
}

export function reorderImageGridItems(items, fromIndex, toIndex) {
  const list = Array.isArray(items) ? [...items] : []
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return list
  }

  const [moved] = list.splice(fromIndex, 1)
  list.splice(toIndex, 0, moved)
  return list
}

function ImageGridComponent({ nodeKey, items, columns, gap }) {
  const [editor] = useLexicalComposerContext()
  const isEditable = useLexicalEditable()
  const [selected, setSelected] = useState(false)
  const [currentColumns, setCurrentColumns] = useState(columns || 3)
  const [currentGap, setCurrentGap] = useState(gap || 8)
  const currentItems = Array.isArray(items) ? items : []
  const [dragIndex, setDragIndex] = useState(-1)
  const [dragOverIndex, setDragOverIndex] = useState(-1)
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const wrapperRef = useRef(null)
  const addInputRef = useRef(null)
  const replaceInputRef = useRef(null)
  const uploadGenerationRef = useRef(0)
  const activeUploadRef = useRef(null)
  const replacementTargetRef = useRef(null)
  const dragIndexRef = useRef(-1)

  useEffect(() => setCurrentColumns(columns || 3), [columns])
  useEffect(() => setCurrentGap(gap || 8), [gap])

  const cancelUpload = useCallback(message => {
    const pending = activeUploadRef.current || replacementTargetRef.current
    uploadGenerationRef.current += 1
    activeUploadRef.current = null
    replacementTargetRef.current = null
    setUploading(false)
    if (pending && message) setUploadMessage(message)
  }, [])

  useEffect(() => {
    // Revoke pending uploads and drags at the transition, even within one React batch.
    const unregisterEditable = editor.registerEditableListener(editable => {
      if (!editable) {
        cancelUpload('已进入阅读模式，本次图片上传已取消。')
        dragIndexRef.current = -1
        setDragIndex(-1)
        setDragOverIndex(-1)
      }
    })
    const unregisterUpdate = editor.registerUpdateListener(({ editorState, tags }) => {
      const target = replacementTargetRef.current
      if (!target && !activeUploadRef.current) return
      if (tags.has(HISTORIC_TAG)) {
        cancelUpload('内容已撤销或重做，本次图片上传已取消。')
        return
      }
      editorState.read(() => {
        const node = $getNodeByKey(nodeKey)
        if (!$isImageGridNode(node) || !node.isAttached()) {
          cancelUpload('图片组已移除，本次图片上传已取消。')
        } else if (target && (
          node.__items !== target.items || uniqueItemIndex(node.__items, target.item) < 0
        )) {
          // Only the local caption/reorder/remove operations below can carry a
          // selected item into a new array. Imported or historical equal-looking
          // items are not proof that this is still the selected image.
          cancelUpload('图片已发生变化，本次替换已取消，请重新选择图片。')
        }
      })
    })
    return () => {
      uploadGenerationRef.current += 1
      activeUploadRef.current = null
      replacementTargetRef.current = null
      dragIndexRef.current = -1
      unregisterEditable()
      unregisterUpdate()
    }
  }, [editor, nodeKey, cancelUpload])

  useEffect(() => {
    if (!selected) return undefined
    const onPointerDown = event => {
      if (!wrapperRef.current?.contains(event.target)) setSelected(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [selected])

  const templateColumns = useMemo(
    () => `repeat(${Math.max(1, Math.min(4, currentColumns))}, minmax(0, 1fr))`,
    [currentColumns]
  )

  const uploadIsCurrent = generation => editor.isEditable() && (
    generation === uploadGenerationRef.current && activeUploadRef.current?.generation === generation
  )

  const updateNode = patch => {
    if (!editor.isEditable()) return
    editor.update(() => {
      if (!editor.isEditable()) return
      const node = $getNodeByKey(nodeKey)
      if (!$isImageGridNode(node)) return
      if (patch.columns !== undefined) node.setColumns(patch.columns)
      if (patch.gap !== undefined) node.setGap(patch.gap)
    })
  }

  const applyLocalItems = (node, nextItems) => {
    const target = replacementTargetRef.current
    if (target) target.items = nextItems
    node.setItems(nextItems)
  }

  const changeColumns = next => {
    if (!editor.isEditable()) return
    setCurrentColumns(next)
    updateNode({ columns: next })
  }

  const changeGap = next => {
    if (!editor.isEditable()) return
    setCurrentGap(next)
    updateNode({ gap: next })
  }

  const changeCaption = (index, caption) => {
    if (!editor.isEditable()) return
    editor.update(() => {
      if (!editor.isEditable()) return
      const node = $getNodeByKey(nodeKey)
      if (!$isImageGridNode(node)) return
      const nextItems = node.__items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const nextItem = { ...item, caption }
        const target = replacementTargetRef.current
        if (target?.item === item) target.item = nextItem
        return nextItem
      })
      applyLocalItems(node, nextItems)
    })
  }

  const reorderItems = (fromIndex, toIndex) => {
    if (!editor.isEditable()) return
    editor.update(() => {
      if (!editor.isEditable()) return
      const node = $getNodeByKey(nodeKey)
      if (!$isImageGridNode(node)) return
      applyLocalItems(node, reorderImageGridItems(node.__items, fromIndex, toIndex))
    })
  }

  const handleDragStart = (event, index) => {
    if (!editor.isEditable()) {
      event.preventDefault()
      return
    }
    event.stopPropagation()
    dragIndexRef.current = index
    setSelected(true)
    setDragIndex(index)
    setDragOverIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (event, index) => {
    if (!editor.isEditable() || dragIndexRef.current < 0) return
    if (dragIndex < 0 || index === dragOverIndex) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDrop = (event, index) => {
    event.preventDefault()
    event.stopPropagation()
    if (editor.isEditable() && dragIndexRef.current >= 0) reorderItems(dragIndexRef.current, index)
    dragIndexRef.current = -1
    setDragIndex(-1)
    setDragOverIndex(-1)
  }

  const handleDragEnd = () => {
    dragIndexRef.current = -1
    setDragIndex(-1)
    setDragOverIndex(-1)
  }

  const uploadImageFiles = async (files, uploadGeneration) => {
    const selectedFiles = Array.from(files || [])
    const validFiles = selectedFiles.filter(file => file.size <= 10 * 1024 * 1024)
    const oversized = selectedFiles.length - validFiles.length
    let failed = 0

    const results = []
    for (const file of validFiles) {
      if (!uploadIsCurrent(uploadGeneration)) return null
      try {
        const result = await uploadFile(file)
        if (!uploadIsCurrent(uploadGeneration)) return null
        if (result?.url) {
          results.push({
            src: result.url,
            originalSrc: result.url,
            alt: file.name,
            caption: file.name,
          })
        } else failed += 1
      } catch (error) {
        if (!uploadIsCurrent(uploadGeneration)) return null
        failed += 1
        console.error('图片组上传失败', error)
      }
    }

    return { additions: results, failed, oversized }
  }

  const handleAddImages = async event => {
    if (!editor.isEditable()) return
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files?.length) return

    const uploadGeneration = ++uploadGenerationRef.current
    replacementTargetRef.current = null
    activeUploadRef.current = { generation: uploadGeneration }
    setUploadMessage('')
    setUploading(true)
    try {
      const result = await uploadImageFiles(files, uploadGeneration)
      if (!result || !uploadIsCurrent(uploadGeneration)) return
      const { additions, failed, oversized } = result
      if (additions.length) editor.update(() => {
        if (!uploadIsCurrent(uploadGeneration)) return
        const node = $getNodeByKey(nodeKey)
        if (!$isImageGridNode(node) || !node.isAttached()) return
        node.setItems(appendImageGridItems(node.__items, additions))
      }, { discrete: true })
      if (uploadIsCurrent(uploadGeneration)) setUploadMessage([
        failed ? `${failed} 张图片上传失败，请重试。` : '',
        oversized ? `${oversized} 张图片超过 10 MB，请选择较小文件。` : '',
      ].filter(Boolean).join(' '))
    } finally {
      if (uploadGeneration === uploadGenerationRef.current) {
        activeUploadRef.current = null
        setUploading(false)
      }
    }
  }

  const chooseReplacement = item => {
    if (!editor.isEditable() || activeUploadRef.current) return
    // Flush accepted edits before binding the file picker to a canonical item.
    editor.read(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isImageGridNode(node) || uniqueItemIndex(node.__items, item) < 0) {
        replacementTargetRef.current = null
        setUploadMessage('图片已发生变化，请重新选择要替换的图片。')
        return
      }
      replacementTargetRef.current = { item, items: node.__items }
      setUploadMessage('')
    })
    if (replacementTargetRef.current) replaceInputRef.current?.click()
  }

  const handleReplaceImage = async event => {
    if (!editor.isEditable()) return
    const file = event.target.files?.[0]
    event.target.value = ''
    const target = replacementTargetRef.current
    if (!file) {
      replacementTargetRef.current = null
      return
    }
    if (!target || activeUploadRef.current) return
    if (file.size > 10 * 1024 * 1024) {
      replacementTargetRef.current = null
      setUploadMessage('图片不能超过 10 MB，请选择较小文件。')
      return
    }

    const uploadGeneration = ++uploadGenerationRef.current
    activeUploadRef.current = { generation: uploadGeneration }
    setUploadMessage('')
    setUploading(true)
    try {
      const result = await uploadFile(file)
      if (!uploadIsCurrent(uploadGeneration)) return
      if (!result?.url) {
        setUploadMessage('图片上传失败，请重试。')
        return
      }
      editor.update(() => {
        if (!uploadIsCurrent(uploadGeneration) || replacementTargetRef.current !== target) return
        const node = $getNodeByKey(nodeKey)
        const index = $isImageGridNode(node) ? uniqueItemIndex(node.__items, target.item) : -1
        if (index < 0 || !node.isAttached() || node.__items !== target.items) {
          cancelUpload('图片已发生变化，本次替换已取消，请重新选择图片。')
          return
        }
        const nextItems = replaceImageGridItem(node.__items, index, {
          src: result.url,
          originalSrc: result.url,
          alt: file.name,
        })
        replacementTargetRef.current = null
        node.setItems(nextItems)
      }, { discrete: true })
    } catch (error) {
      if (!uploadIsCurrent(uploadGeneration)) return
      console.error('替换图片组图片失败', error)
      setUploadMessage('图片上传失败，请重试。')
    } finally {
      if (uploadGeneration === uploadGenerationRef.current) {
        activeUploadRef.current = null
        replacementTargetRef.current = null
        setUploading(false)
      }
    }
  }

  const removeItem = index => {
    if (!editor.isEditable()) return
    editor.update(() => {
      if (!editor.isEditable()) return
      const node = $getNodeByKey(nodeKey)
      if (!$isImageGridNode(node)) return
      const removed = node.__items[index]
      const nextItems = node.__items.filter((_, itemIndex) => itemIndex !== index)
      if (replacementTargetRef.current?.item === removed) {
        // Revoke now, before a same-batch undo could restore this exact object.
        cancelUpload('要替换的图片已移除，本次替换已取消。')
      }
      if (nextItems.length === 0) {
        cancelUpload('图片组已移除，本次图片上传已取消。')
        node.remove()
      } else applyLocalItems(node, nextItems)
    })
  }

  const deleteGrid = () => {
    if (!editor.isEditable()) return
    editor.update(() => {
      if (!editor.isEditable()) return
      const node = $getNodeByKey(nodeKey)
      if ($isImageGridNode(node)) {
        cancelUpload('图片组已移除，本次图片上传已取消。')
        node.remove()
      }
    })
  }

  return (
    <figure
      ref={wrapperRef}
      className={`editor-image-grid-block${selected ? ' selected' : ''}`}
      onClick={() => setSelected(true)}
    >
      {selected && isEditable && (
        <div className="editor-image-grid-toolbar" role="toolbar" aria-label="图片组工具">
          <span>列数</span>
          {[2, 3, 4].map(value => (
            <button
              type="button"
              key={value}
              className={currentColumns === value ? 'active' : ''}
              onClick={event => {
                event.stopPropagation()
                changeColumns(value)
              }}
            >
              {value}
            </button>
          ))}

          <span className="editor-image-toolbar-divider" />

          <span>间距</span>
          {[
            [4, '紧'],
            [8, '中'],
            [16, '松'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={currentGap === value ? 'active' : ''}
              onClick={event => {
                event.stopPropagation()
                changeGap(value)
              }}
            >
              {label}
            </button>
          ))}

          <span className="editor-image-toolbar-divider" />

          <button
            type="button"
            onClick={event => {
              event.stopPropagation()
              if (!editor.isEditable()) return
              addInputRef.current?.click()
            }}
            disabled={uploading}
          >
            {uploading ? '处理中…' : '添加图片'}
          </button>
          <input
            ref={addInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={!isEditable || uploading}
            onChange={handleAddImages}
          />
          {uploading && (
            <button type="button" onClick={event => {
              event.stopPropagation()
              cancelUpload('已取消本次上传，可重新选择图片。')
            }}>
              取消本次上传
            </button>
          )}

          <button
            type="button"
            className="danger"
            onClick={event => {
              event.stopPropagation()
              deleteGrid()
            }}
          >
            删除图片组
          </button>
        </div>
      )}

      {uploadMessage && <div className="editor-image-grid-upload-status" role="status" aria-live="polite">{uploadMessage}</div>}

      <div
        className="editor-image-grid-layout"
        style={{
          gridTemplateColumns: templateColumns,
          gap: currentGap,
        }}
      >
        {currentItems.map((item, index) => (
          <div
            key={`${item.src || item.alt || 'image'}-${index}`}
            className={`editor-image-grid-card${dragIndex === index ? ' dragging' : ''}${dragOverIndex === index && dragIndex !== index ? ' drag-over' : ''}`}
            onDragOver={event => handleDragOver(event, index)}
            onDrop={event => handleDrop(event, index)}
          >
            <div className="editor-image-grid-media">
              {selected && isEditable && (
                <button
                  type="button"
                  className="editor-image-grid-drag"
                  draggable
                  onDragStart={event => handleDragStart(event, index)}
                  onDragEnd={handleDragEnd}
                  onClick={event => event.stopPropagation()}
                  aria-label={`拖动图片 ${index + 1} 排序`}
                  title="拖动排序"
                >
                  ⋮⋮
                </button>
              )}
              <img
                src={item.src}
                alt={item.alt || item.caption || ''}
                loading="lazy"
                title={item.alt || item.caption || ''}
              />

              {selected && isEditable && (
                <div className="editor-image-grid-card-actions">
                  <button
                    type="button"
                    className="editor-image-grid-replace"
                    onClick={event => {
                      event.stopPropagation()
                      if (!editor.isEditable()) return
                      chooseReplacement(item)
                    }}
                    disabled={uploading}
                    aria-label={`替换图片 ${index + 1}`}
                    title="替换图片"
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    className="editor-image-grid-remove"
                  onClick={event => {
                    event.stopPropagation()
                    removeItem(index)
                  }}
                  aria-label={`移除图片 ${index + 1}`}
                  title="从图片组移除"
                >
                  ×
                </button>
                </div>
              )}
            </div>

            {(selected || (item.caption ?? item.alt)) && (
              <input
                className="editor-image-grid-caption"
                value={item.caption ?? item.alt ?? ''}
                readOnly={!isEditable}
                onChange={event => changeCaption(index, event.target.value)}
                onClick={event => event.stopPropagation()}
                placeholder="图片说明…"
                aria-label={`图片 ${index + 1} 说明`}
              />
            )}
          </div>
        ))}
      </div>
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        hidden
        disabled={!isEditable || uploading}
        onChange={handleReplaceImage}
      />
    </figure>
  )
}

export function $createImageGridNode({ items, columns, gap }) {
  return new ImageGridNode(items, columns, gap)
}

export function $isImageGridNode(node) {
  return node instanceof ImageGridNode
}
