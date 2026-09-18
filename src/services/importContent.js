import { createEditor, $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown'

const IMPORT_NODES = [
  HeadingNode,
  QuoteNode,
  ListItemNode,
  ListNode,
  CodeHighlightNode,
  CodeNode,
  AutoLinkNode,
  LinkNode,
]

function createImportEditor() {
  return createEditor({
    namespace: 'ImportNormalizer',
    nodes: IMPORT_NODES,
    onError(error) {
      throw error
    },
  })
}

export function plainTextToLexical(text) {
  const editor = createImportEditor()
  editor.update(() => {
    const root = $getRoot()
    root.clear()

    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
    for (const line of lines) {
      const paragraph = $createParagraphNode()
      if (line) paragraph.append($createTextNode(line))
      root.append(paragraph)
    }

    if (lines.length === 0) {
      root.append($createParagraphNode())
    }
  }, { discrete: true })

  return JSON.stringify(editor.getEditorState().toJSON())
}

export function markdownToLexical(markdown) {
  const editor = createImportEditor()
  editor.update(() => {
    $convertFromMarkdownString(String(markdown || ''), TRANSFORMERS)
  }, { discrete: true })

  return JSON.stringify(editor.getEditorState().toJSON())
}

export function normalizeImportedContent(item) {
  const title = String(item?.title || '')
  const ext = title.toLowerCase().match(/(\.[^.]+)$/)?.[1] || ''
  const content = String(item?.content || '')
  const contentType = item?.contentType || (ext === '.txt' || ext === '.doc' ? 'text' : 'markdown')

  if (contentType === 'text') {
    return plainTextToLexical(content)
  }

  return markdownToLexical(content)
}
