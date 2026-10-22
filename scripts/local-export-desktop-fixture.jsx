import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical'
import { HeadingNode, $createHeadingNode } from '@lexical/rich-text'
import { TableNode, TableRowNode, TableCellNode, $createTableNode, $createTableRowNode, $createTableCellNode } from '@lexical/table'
import { ImageNode, $createImageNode } from '../src/components/Editor/nodes/ImageNode'
import { AttachmentNode, $createAttachmentNode } from '../src/components/Editor/nodes/AttachmentNode'
import { LOCAL_EXPORT_FIXTURE } from './local-export-desktop-values.mjs'
export { LOCAL_EXPORT_FIXTURE } from './local-export-desktop-values.mjs'

// Production node classes and the installed Lexical serializer generate every
// fixture. No handwritten editor state or mutation of a running editor.
export function localExportDesktopDocument({ body = LOCAL_EXPORT_FIXTURE.body, image, attachment, rich = true } = {}) {
  const editor = createEditor({ namespace: 'local-export-desktop-fixture',
    nodes: [HeadingNode, TableNode, TableRowNode, TableCellNode, ImageNode, AttachmentNode],
    onError(error) { throw error },
  })
  editor.update(() => {
    const root = $getRoot().clear()
    root.append($createHeadingNode('h1').append($createTextNode(LOCAL_EXPORT_FIXTURE.heading)),
      $createParagraphNode().append($createTextNode(body)))
    if (rich) {
      root.append($createParagraphNode().append($createTextNode('EXPORT102 bold').setFormat('bold')))
      const table = $createTableNode()
      for (const values of [['列一', '列二'], ['EXPORT102 table', '中文单元格']]) {
        const row = $createTableRowNode()
        for (const value of values) row.append($createTableCellNode(0).append($createParagraphNode().append($createTextNode(value))))
        table.append(row)
      }
      root.append(table)
    }
    if (image) root.append($createImageNode({ src: image, originalSrc: image, alt: 'export102.png',
      width: 48, height: 48, caption: LOCAL_EXPORT_FIXTURE.imageCaption }))
    if (attachment) root.append($createAttachmentNode({ src: attachment, name: LOCAL_EXPORT_FIXTURE.attachmentName,
      size: Buffer.byteLength(LOCAL_EXPORT_FIXTURE.attachment), mime: 'text/plain' }))
    root.append($createParagraphNode().append($createTextNode('EXPORT102 end')))
  }, { discrete: true })
  const result = JSON.stringify(editor.getEditorState().toJSON())
  editor.setEditorState(editor.parseEditorState(result))
  if (JSON.stringify(editor.getEditorState().toJSON()) !== result) throw Error('Export fixture serializer is not stable')
  return result
}
