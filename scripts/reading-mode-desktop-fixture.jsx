import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical'
import { HeadingNode, $createHeadingNode } from '@lexical/rich-text'
import { TodoNode, $createTodoNode } from '../src/components/Editor/nodes/TodoNode'
import { CalloutNode, $createCalloutNode } from '../src/components/Editor/nodes/CalloutNode'
import { ToggleNode, $createToggleNode } from '../src/components/Editor/nodes/ToggleNode'
import { CodeBlockNode, $createCodeBlockNode } from '../src/components/Editor/nodes/CodeBlockNode'
import { FormulaNode, $createFormulaNode } from '../src/components/Editor/nodes/FormulaNode'
import { ImageNode, $createImageNode } from '../src/components/Editor/nodes/ImageNode'
import { ImageGridNode, $createImageGridNode } from '../src/components/Editor/nodes/ImageGridNode'
import { AttachmentNode, $createAttachmentNode } from '../src/components/Editor/nodes/AttachmentNode'
import { EmbedNode, $createEmbedNode } from '../src/components/Editor/nodes/EmbedNode'
import { READING_DRAFT_VALUES } from './reading-mode-desktop-evidence.mjs'

// A CRC-verified 77-byte 8x8 RGB PNG, also used as the attachment preview input.
// Image previews use the product's existing img-src policy; no CSP is weakened.
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGO0bvrGgA0wYRUdtBIAVs4Bw7T4PJAAAAAASUVORK5CYII='
export const READING_FIXTURE_TEXT = Object.freeze({
  heading: '阅读模式装饰块验证', body: 'reading-mode-canonical-decorators', todo: '保持未完成的原始待办',
  callout: '原始提示文字', toggleTitle: '原始折叠标题', toggleContent: '原始折叠正文',
  code: 'const readingGuard = true;', caption: '原始图片说明', gridCaption: '原始图片组说明', formula: 'x^2',
  embedURL: READING_DRAFT_VALUES.embedOriginalURL, embedTitle: READING_DRAFT_VALUES.embedOriginalTitle,
})

// Use the real installed Lexical serializer and the application's node classes.
// This creates isolated fixture bytes only; it does not touch a running editor.
export function readingModeDesktopFixture() {
  const t = READING_FIXTURE_TEXT
  const editor = createEditor({ namespace: 'reading-mode-desktop-fixture',
    nodes: [HeadingNode, TodoNode, CalloutNode, ToggleNode, CodeBlockNode, FormulaNode, ImageNode, ImageGridNode, AttachmentNode, EmbedNode],
    onError(error) { throw error },
  })
  editor.update(() => {
    $getRoot().clear().append(
      $createHeadingNode('h1').append($createTextNode(t.heading)),
      $createParagraphNode().append($createTextNode(t.body)),
      $createTodoNode({ checked: false, text: t.todo }),
      $createCalloutNode({ icon: '💡', text: t.callout }),
      $createToggleNode({ title: t.toggleTitle, content: t.toggleContent, collapsed: false }),
      $createCodeBlockNode(t.code, 'javascript'),
      $createFormulaNode({ expression: t.formula, displayMode: true }),
      $createImageNode({ src: IMAGE, originalSrc: IMAGE, alt: 'reading-mode-fixture.png', width: 48, height: 48, caption: t.caption }),
      $createImageGridNode({ items: [{ src: IMAGE, originalSrc: IMAGE, alt: 'reading-mode-grid.png', caption: t.gridCaption }], columns: 1, gap: 8 }),
      $createAttachmentNode({ src: IMAGE, name: '阅读模式附件.png', size: 77, mime: 'image/png' }),
      $createEmbedNode({ url: t.embedURL, title: t.embedTitle }),
      $createParagraphNode().append($createTextNode('reading-mode-fixture-end')),
    )
  }, { discrete: true })
  const serialized = JSON.stringify(editor.getEditorState().toJSON())
  editor.setEditorState(editor.parseEditorState(serialized))
  if (JSON.stringify(editor.getEditorState().toJSON()) !== serialized) throw Error('Reading fixture serializer is not stable')
  return serialized
}
