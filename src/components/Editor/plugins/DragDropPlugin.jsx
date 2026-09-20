import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'

export default function DragDropPlugin() {
  const [editor] = useLexicalComposerContext()
  const dragKeyRef = useRef('')
  const dragElementRef = useRef(null)
  const dropTargetRef = useRef(null)
  const dropPositionRef = useRef('before')

  useEffect(() => {
    const editorContainer = editor.getRootElement()?.closest('.editor-container')
    if (!editorContainer) return undefined

    const clearIndicators = () => {
      editorContainer.querySelectorAll('.editor-input > *').forEach(element => {
        element.classList.remove('block-drop-before', 'block-drop-after', 'block-being-dragged')
      })
    }

    const cleanup = () => {
      clearIndicators()
      dragKeyRef.current = ''
      dragElementRef.current = null
      dropTargetRef.current = null
      dropPositionRef.current = 'before'
    }

    const handleDragStart = (event) => {
      const handle = event.target.closest('.block-handle')
      if (!handle) return

      const blockKey = handle.dataset.blockKey
      const blockElement = blockKey ? editor.getElementByKey(blockKey) : null
      if (!blockKey || !blockElement) {
        event.preventDefault()
        return
      }

      dragKeyRef.current = blockKey
      dragElementRef.current = blockElement
      blockElement.classList.add('block-being-dragged')

      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('application/x-local-notepad-block', blockKey)
      event.dataTransfer.setData('text/plain', '')
    }

    const handleDragOver = (event) => {
      if (!dragKeyRef.current) return

      const target = event.target.closest('.editor-input > *')
      if (!target || target === dragElementRef.current) return

      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'

      clearIndicators()
      dragElementRef.current?.classList.add('block-being-dragged')

      const rect = target.getBoundingClientRect()
      const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

      dropTargetRef.current = target
      dropPositionRef.current = position
      target.classList.add(position === 'before' ? 'block-drop-before' : 'block-drop-after')
    }

    const handleDrop = (event) => {
      if (!dragKeyRef.current) return

      event.preventDefault()

      const dragKey = dragKeyRef.current
      const targetElement = dropTargetRef.current
      const position = dropPositionRef.current

      if (!targetElement || targetElement === dragElementRef.current) {
        cleanup()
        return
      }

      editor.update(() => {
        const children = $getRoot().getChildren()
        const dragNode = children.find(child => child.getKey() === dragKey)
        const targetNode = children.find(child => editor.getElementByKey(child.getKey()) === targetElement)

        if (!dragNode || !targetNode || dragNode === targetNode) return

        if (position === 'after') targetNode.insertAfter(dragNode)
        else targetNode.insertBefore(dragNode)

        if (typeof dragNode.selectEnd === 'function') dragNode.selectEnd()
      })

      cleanup()
    }

    const handleDragEnd = () => cleanup()

    editorContainer.addEventListener('dragstart', handleDragStart, true)
    editorContainer.addEventListener('dragover', handleDragOver, true)
    editorContainer.addEventListener('drop', handleDrop, true)
    editorContainer.addEventListener('dragend', handleDragEnd, true)

    return () => {
      cleanup()
      editorContainer.removeEventListener('dragstart', handleDragStart, true)
      editorContainer.removeEventListener('dragover', handleDragOver, true)
      editorContainer.removeEventListener('drop', handleDrop, true)
      editorContainer.removeEventListener('dragend', handleDragEnd, true)
    }
  }, [editor])

  return null
}
