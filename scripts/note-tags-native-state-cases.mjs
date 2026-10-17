import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {URL as NodeURL} from 'node:url'

// Test the exact predicates executed by the native runner. A DOM query stand-in
// only supplies element presence; the real Windows workflow must still run.
export function registerNoteTagNativeStateTests(test) {
 const native=readFileSync(new NodeURL('./check-note-tags-desktop.mjs',import.meta.url),'utf8')
 const predicate = label => {
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  const match=native.match(new RegExp('evaluate\\("([^"\\n]+)"\\),\\\''+escaped+'\\\''))
  assert.ok(match,'Missing native predicate '+label)
  return new Function('document','return ('+match[1]+')')
 }
 const dirty=predicate('Dirty draft absent'),saved=predicate('Original save still pending')
 const documentFor=state=>({querySelector(selector){
  const present=new Set(state)
  return selector.split(',').some(value=>present.has(value.trim()))?{}:null
 }})
 const cases=[
  ['clean',[],false,true],
  ['unsaved',['.workspace-save-chip.dirty'],true,false],
  ['saving',['.workspace-save-chip.saving','.workspace-save-chip','.save-state'],false,false],
  ['save-failed',['.workspace-save-chip.error','.workspace-save-chip','.save-state'],false,false],
  ['toolbar-only-pending',['.workspace-save-chip'],false,false],
  ['status-only-pending',['.save-state'],false,false],
 ]
 for(const [name,elements,isDirty,isSaved] of cases) {
  const withParent=elements.includes('.workspace-save-chip.dirty')?[...elements,'.workspace-save-chip']:elements
  test('native tag draft check distinguishes '+name,()=>assert.equal(dirty(documentFor(withParent)),isDirty))
  test('native tag save completion distinguishes '+name,()=>assert.equal(saved(documentFor(withParent)),isSaved))
 }
 test('original native selector wrongly waits for saving instead of an unsaved draft',()=>{
  const prior=doc=>!!doc.querySelector('.save-state')
  assert.equal(prior(documentFor(['.workspace-save-chip.dirty'])),false)
  assert.equal(prior(documentFor(['.save-state'])),true)
 })
 test('predicates remain bound to original production indicator conditions',()=>{
  const app=readFileSync(new NodeURL('../src/App.jsx',import.meta.url),'utf8')
  const editor=readFileSync(new NodeURL('../src/components/TextEditor.jsx',import.meta.url),'utf8')
  assert.ok(app.includes("editorStatus.saving ? ' saving' : ' dirty'"))
  assert.ok(editor.includes('(saveError || saving) && ('))
  assert.ok(native.includes(".content,file.content);assert.ok(await evaluate"),'Preserve database and actual editor checks')
 })
}
