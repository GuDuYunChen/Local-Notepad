// @vitest-environment node
import {test,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {createEditor,$getRoot,$createParagraphNode} from 'lexical'
const source=readFileSync(new URL('../../server/internal/dao/daily.go',import.meta.url),'utf8')
const initial=source.match(/const dailyInitialContent = `([^`]+)`/)?.[1]
test('new daily body exactly matches the installed Lexical blank serializer',()=>{
 const editor=createEditor({namespace:'daily-empty-contract',onError(error){throw error}})
 editor.update(()=>{$getRoot().clear().append($createParagraphNode())},{discrete:true})
 expect(initial).toBe(JSON.stringify(editor.getEditorState().toJSON()))
 expect(initial).not.toBe('')
})
test('reopening the canonical empty daily body does not change its serialized baseline',()=>{
 const editor=createEditor({namespace:'daily-empty-reopen',onError(error){throw error}})
 editor.setEditorState(editor.parseEditorState(initial))
 expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(initial)
 editor.getEditorState().read(()=>expect($getRoot().getTextContent()).toBe(''))
})
