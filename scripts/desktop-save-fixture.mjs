import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical'
import { $createHeadingNode, HeadingNode } from '@lexical/rich-text'

// Seed only isolated test data with the SAME installed Lexical serializer as
// the application. Hand-written JSON can be valid but still normalize on load,
// making a pristine test note appear changed before any simulated user action.
export function desktopNote(heading, text) {
  const editor = createEditor({ namespace: 'desktop-seed', nodes: [HeadingNode], onError(error) { throw error } })
  editor.update(() => {
    $getRoot().clear().append($createHeadingNode('h1').append($createTextNode(heading)),
      $createParagraphNode().append($createTextNode(text)))
  }, { discrete: true })
  return JSON.stringify(editor.getEditorState().toJSON())
}
