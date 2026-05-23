import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection, $getRoot, $isElementNode } from 'lexical'

export default function DragDropPlugin() {
  const [editor] = useLexicalComposerContext()
  const dragItemRef = useRef(null)
  const dragOverItemRef = useRef(null)

  useEffect(() => {
    const editorContainer = document.querySelector('.editor-container')
    if (!editorContainer) return

    let dragHandle = null

    const handleDragStart = (e) => {
      const handle = e.target.closest('.block-handle')
      if (!handle) return

      dragHandle = handle
      const blockElement = handle.closest('.editor-input > *')
      if (!blockElement) return

      dragItemRef.current = blockElement
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', '')

      setTimeout(() => {
        blockElement.style.opacity = '0.4'
      }, 0)
    }

    const handleDragOver = (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      const target = e.target.closest('.editor-input > *')
      if (target && target !== dragItemRef.current) {
        dragOverItemRef.current = target

        document.querySelectorAll('.editor-input > *').forEach((el) => {
          el.style.borderTop = 'none'
        })

        target.style.borderTop = '2px solid var(--accent, #7e5bef)'
      }
    }

    const handleDrop = (e) => {
      e.preventDefault()

      const dragItem = dragItemRef.current
      const dropTarget = dragOverItemRef.current

      if (!dragItem || !dropTarget || dragItem === dropTarget) {
        cleanup()
        return
      }

      editor.update(() => {
        const root = $getRoot()
        const children = root.getChildren()

        const dragIndex = children.findIndex((child) => {
          const dom = editor.getElementByKey(child.getKey())
          return dom === dragItem
        })

        const dropIndex = children.findIndex((child) => {
          const dom = editor.getElementByKey(child.getKey())
          return dom === dropTarget
        })

        if (dragIndex === -1 || dropIndex === -1) return

        const dragNode = children[dragIndex]
        const dropNode = children[dropIndex]

        if (dragIndex < dropIndex) {
          dropNode.insertAfter(dragNode)
        } else {
          dropNode.insertBefore(dragNode)
        }

        dragNode.selectEnd()
      })

      cleanup()
    }

    const handleDragEnd = () => {
      cleanup()
    }

    const cleanup = () => {
      if (dragItemRef.current) {
        dragItemRef.current.style.opacity = '1'
      }
      document.querySelectorAll('.editor-input > *').forEach((el) => {
        el.style.borderTop = 'none'
      })
      dragItemRef.current = null
      dragOverItemRef.current = null
      dragHandle = null
    }

    editorContainer.addEventListener('dragstart', handleDragStart, true)
    editorContainer.addEventListener('dragover', handleDragOver, true)
    editorContainer.addEventListener('drop', handleDrop, true)
    editorContainer.addEventListener('dragend', handleDragEnd, true)

    return () => {
      editorContainer.removeEventListener('dragstart', handleDragStart, true)
      editorContainer.removeEventListener('dragover', handleDragOver, true)
      editorContainer.removeEventListener('drop', handleDrop, true)
      editorContainer.removeEventListener('dragend', handleDragEnd, true)
    }
  }, [editor])

  return null
}
