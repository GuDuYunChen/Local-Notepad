import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection } from 'lexical'
import { useEffect } from 'react'
import { $createWikiLinkNode, WikiLinkNode } from './WikiLinkNode'

export function WikiLinkPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([WikiLinkNode])) {
      console.error('WikiLinkPlugin: WikiLinkNode 未注册')
      return
    }

    const removeListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
      })
    })

    return removeListener
  }, [editor])

  return null
}

export { $createWikiLinkNode, WikiLinkNode }
