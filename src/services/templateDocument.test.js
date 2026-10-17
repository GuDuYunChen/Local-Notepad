// @vitest-environment node
import { test, expect } from 'vitest'
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical'
import { textTemplateDocument } from './templateLibrary.mjs'
for(const text of ['', '工作计划\n🙂\n下一步', '\n\n', '  空格\t\n末行  ']) {
 test('template text uses exact production Lexical serialization '+JSON.stringify(text),()=>{
  const editor=createEditor({namespace:'template-normalization',onError(e){throw e}})
  editor.update(()=>{const root=$getRoot();root.clear();for(const line of text.split('\n')){const p=$createParagraphNode();if(line)p.append($createTextNode(line));root.append(p)}},{discrete:true})
  const body=textTemplateDocument(text);expect(body).toBe(JSON.stringify(editor.getEditorState().toJSON()))
  editor.setEditorState(editor.parseEditorState(body));expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(body)
 })
}
