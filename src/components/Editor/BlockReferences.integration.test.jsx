import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { $createParagraphNode, $createTextNode, $getRoot, $getNodeByKey, $copyNode, createEditor } from 'lexical'
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text'
import { $createListNode, ListNode, ListItemNode } from '@lexical/list'
import { $createCodeNode, CodeNode } from '@lexical/code'
import { $createTableNodeWithDimensions, TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $blockId, $ensureBlockId } from './utils/blockReferenceState.js'
import { CodeBlockNode } from './nodes/CodeBlockNode.jsx'
import { WikiLinkNode, $createBlockReferenceNode } from './nodes/WikiLinkNode.jsx'
import BlockReferencePlugin from './plugins/BlockReferencePlugin.jsx'
import BlockEmbedView from './nodes/BlockEmbedView.jsx'
import { LoadContentPlugin } from './Editor.jsx'
import { $insertBlockClipboardPayloadAfter, $serializeBlockClipboard } from './plugins/BlockHandlePlugin.jsx'
import { blockLocator } from '../../services/blockReferenceModel.mjs'
import { api } from '../../services/api'
import { analyzeMarkdownSourceCompatibility } from '../../services/markdownSource'
vi.mock('../../services/api', () => ({ api:vi.fn(), searchFiles:vi.fn() }))
const id='b-'+'a'.repeat(32)
const text = value => ({type:'text',version:1,text:value,format:0,detail:0,mode:'normal',style:''})
const paragraph = (value='正文',blockId) => ({type:'paragraph',version:1,format:'',indent:0,direction:null,children:[text(value)],...(blockId?{$:{localBlockId:blockId}}:{})})
const body = (...children) => JSON.stringify({root:{type:'root',version:1,format:'',indent:0,direction:null,children}})
const file=(content=body(paragraph('来源正文',id)))=>({id:'source',title:'来源.md',content,is_folder:false,is_deleted:false,updated_at:1700000000})
const nodes=[CodeBlockNode,HeadingNode,QuoteNode,ListNode,ListItemNode,CodeNode,TableNode,TableRowNode,TableCellNode,WikiLinkNode]
function editor(){return createEditor({nodes,onError:e=>{throw e}})}
function change(e,fn){e.update(fn,{discrete:true})}
function json(e){return JSON.stringify(e.getEditorState())}

describe('stable identities in real Lexical editor state',()=>{
 test.each([
  ['paragraph',()=> $createParagraphNode().append($createTextNode('段落'))],['heading',()=> $createHeadingNode('h2').append($createTextNode('标题'))],
  ['quote',()=> $createQuoteNode().append($createTextNode('引用'))],['list',()=> $createListNode('bullet')],['code',()=> $createCodeNode().append($createTextNode('code'))],['code-block',()=>new CodeBlockNode('const x = 1', 'javascript')],['table',()=> $createTableNodeWithDimensions(2,2)]
 ])('%s identity survives serialization and reopen',(_,create)=>{
   const e=editor();let key,identity
   change(e,()=>{const n=create();$getRoot().append(n);key=n.getKey();identity=$ensureBlockId(n)})
   const raw=json(e);expect(raw).toContain(identity)
   const reopened=editor();reopened.setEditorState(reopened.parseEditorState(raw));reopened.getEditorState().read(()=>expect($blockId($getRoot().getFirstChild())).toBe(identity))
   change(e,()=>expect($ensureBlockId($getNodeByKey(key))).toBe(identity))
 })
 test('moving/renaming a source preserves identity; duplicate/paste creates an independent block',()=>{
   const e=editor();let key,identity
   change(e,()=>{const a=$createParagraphNode().append($createTextNode('source'));const b=$createParagraphNode().append($createTextNode('other'));$getRoot().append(a,b);key=a.getKey();identity=$ensureBlockId(a)})
   change(e,()=>{const a=$getNodeByKey(key);a.getFirstChild().setTextContent('changed');$getRoot().append(a);const payload=$serializeBlockClipboard(e,a);const copies=$insertBlockClipboardPayloadAfter(payload,a);expect($blockId(copies[0])).toBe('');expect($blockId(a)).toBe(identity)})
   e.getEditorState().read(()=>expect($blockId($getNodeByKey(key))).toBe(identity))
 })
 test('Lexical copies reset owned IDs while cloned editing states retain them',()=>{
   const e=editor();change(e,()=>{const a=$createParagraphNode();$getRoot().append(a);const identity=$ensureBlockId(a);const copy=$copyNode(a);expect($blockId(copy)).toBe('');expect($blockId(a)).toBe(identity)})
 })
 test('new link and embed JSON round-trip without modifying the legacy node shape',()=>{
   const e=editor();change(e,()=>{$getRoot().append($createParagraphNode().append($createBlockReferenceNode('source','来源',id)), $createBlockReferenceNode('source','来源',id,true))})
   const state=JSON.parse(json(e));expect(state.root.children[0].children[0]).toMatchObject({type:'wiki-link',blockId:id,embedded:false});expect(state.root.children[1].embedded).toBe(true)
   const next=editor();next.setEditorState(next.parseEditorState(state));expect(json(next)).toBe(json(e))
 })
 test.each([{blockId:''},{blockId:0},{blockId:null},{embedded:true},{blockId:id,embedded:'yes'},{blockId:id,sectionPath:['标题']}])('rejects malformed block metadata instead of downgrading it: %j', fields=>{
   const e=editor();e.getEditorState().read(()=>expect(()=>WikiLinkNode.importJSON({type:'wiki-link',version:1,id:'source',title:'来源',sectionPath:[],...fields})).toThrow())
 })
 test('source-mode conversion cannot silently discard a stable anchor',()=>{
   const result=analyzeMarkdownSourceCompatibility(body(paragraph('text',id)));expect(result.editable).toBe(false)
 })
})
let host,root,liveEditor,saveClipboard
function Probe(){[liveEditor]=useLexicalComposerContext();return null}
function Harness({documentId='destination',content=body(paragraph('当前正文'))}){
 return <LexicalComposer initialConfig={{namespace:'MyEditor',nodes,onError:e=>{throw e}}}><div className="editor-shell"><BlockReferencePlugin documentId={documentId} documentTitle="当前.md" initialContent={content}/><div className="editor-container"><RichTextPlugin contentEditable={<ContentEditable className="editor-input"/>} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/><LoadContentPlugin content={content} documentId={documentId}/><Probe/></div></div></LexicalComposer>
}
const button=label=>[...host.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label)
async function click(label){const b=button(label);expect(b,label).toBeTruthy();await act(async()=>b.click())}
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,0))})}
async function input(value){const field=host.querySelector('input[placeholder="notepad://block/…"]');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))})}
async function mount(props={}){await act(async()=>root.render(<Harness {...props}/>));await flush();await act(async()=>change(liveEditor,()=>{$getRoot().getFirstChild().selectEnd()}));await click('块引用')}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);saveClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockResolvedValue()}});api.mockResolvedValue(file())})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();if(saveClipboard)Object.defineProperty(navigator,'clipboard',saveClipboard);else delete navigator.clipboard;delete globalThis.IS_REACT_ACT_ENVIRONMENT})
describe('entry, saved source, review, insertion and exception lifecycle',()=>{
 test('opening and cancelling the dialog never changes the note',async()=>{await mount();const original=json(liveEditor);await click('取消');expect(json(liveEditor)).toBe(original);expect(host.querySelector('[role=dialog]')).toBeNull();expect(api).not.toHaveBeenCalled()})
 test('creation changes only the draft and copy refuses until saved bytes match',async()=>{
  await mount();await click('为当前块创建引用');const draft=json(liveEditor);expect(draft).toContain('localBlockId');expect(api).not.toHaveBeenCalled()
  api.mockResolvedValue({...file(body(paragraph('未保存'))),id:'destination'});await click('核对保存并复制引用');expect(navigator.clipboard.writeText).not.toHaveBeenCalled();expect(host.textContent).toContain('来源块已删除')
  api.mockResolvedValue({...file(draft),id:'destination'});await click('核对保存并复制引用');expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();expect(json(liveEditor)).toBe(draft)
 })
 test('clipboard failure leaves a verified address for explicit manual copying',async()=>{
  await mount();await click('为当前块创建引用');api.mockResolvedValue({...file(json(liveEditor)),id:'destination'});navigator.clipboard.writeText.mockRejectedValue(Error('denied'));await click('核对保存并复制引用');expect(host.textContent).toContain('手动复制');expect(host.querySelector('input[readonly]').value).toContain('notepad://block/destination/')
 })
 test('preview is read-only; confirm rechecks then inserts an actual reference node',async()=>{
  await mount();const original=json(liveEditor);await input(blockLocator('source',id));await click('读取来源块');expect(host.textContent).toContain('来源正文');expect(json(liveEditor)).toBe(original);await click('确认插入引用');expect(JSON.parse(json(liveEditor)).root.children[0].children.some(n=>n.type==='wiki-link'&&n.blockId===id)).toBe(true);expect(api).toHaveBeenCalledTimes(2)
 })
 test('changed source refreshes the preview and requires a second confirmation',async()=>{
  await mount();await input(blockLocator('source',id));await click('读取来源块');const original=json(liveEditor);api.mockResolvedValue(file(body(paragraph('新正文',id))));await click('确认插入引用');expect(json(liveEditor)).toBe(original);expect(host.textContent).toContain('来源已改变');await click('确认插入引用');expect(json(liveEditor)).toContain('"blockId"')
 })
 test('source deleted after preview never inserts a stale reference',async()=>{
  await mount();await input(blockLocator('source',id));await click('读取来源块');const original=json(liveEditor);api.mockResolvedValue({...file(),is_deleted:true});await click('确认插入引用');expect(json(liveEditor)).toBe(original);expect(host.querySelector('[role=alert]')).toBeTruthy()
 })
 test('new edits invalidate the captured insertion position',async()=>{
  await mount();await input(blockLocator('source',id));await click('读取来源块');await act(async()=>change(liveEditor,()=>{$getRoot().getFirstChild().getFirstChild().setTextContent('新草稿');$getRoot().getFirstChild().selectEnd()}));const draft=json(liveEditor);await click('确认插入引用');expect(json(liveEditor)).toBe(draft);expect(host.textContent).toContain('正文已变化')
 })
 test('read-only transition cancels the panel and preserves content',async()=>{
  await mount();const original=json(liveEditor);await act(async()=>liveEditor.setEditable(false));expect(host.querySelector('[role=dialog]')).toBeNull();expect(json(liveEditor)).toBe(original);expect(button('块引用').disabled).toBe(true)
 })
 test('close cancels a pending read and ignores a late response',async()=>{
  await mount();let resolve;api.mockImplementation(()=>new Promise(r=>resolve=r));await input(blockLocator('source',id));await click('读取来源块');const original=json(liveEditor);await click('取消');await act(async()=>resolve(file()));expect(host.querySelector('[role=dialog]')).toBeNull();expect(json(liveEditor)).toBe(original)
 })
 test('IME Escape does not discard the panel; normal Escape closes it',async()=>{
  await mount();const dialog=host.querySelector('[role=dialog]');await act(async()=>dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));expect(host.querySelector('[role=dialog]')).toBeTruthy();await act(async()=>dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(host.querySelector('[role=dialog]')).toBeNull()
 })
 test('embed loads the saved block and ignores recursive embeds',async()=>{
  await act(async()=>root.render(<BlockEmbedView id="source" title="来源" blockId={id}/>));await flush();expect(host.textContent).toContain('来源正文');expect(host.querySelector('pre').textContent).toBe('来源正文');expect(api).toHaveBeenCalledTimes(1)
 })
 test('embed failed refresh clears stale content, preserves the reference and permits retry',async()=>{
  await act(async()=>root.render(<BlockEmbedView id="source" title="来源" blockId={id}/>));await flush();api.mockRejectedValue(Error('private'));await click('刷新来源');expect(host.querySelector('pre')).toBeNull();expect(host.textContent).not.toContain('private');expect(button('打开来源块')).toBeTruthy();api.mockResolvedValue(file());await click('刷新来源');expect(host.querySelector('pre')).toBeTruthy()
 })
})


describe('block embedding and reload boundaries',()=>{
 test('reviewed embedded insertion is a real block node and retains identity after reopen',async()=>{
   await mount();await input(blockLocator('source',id));await click('读取来源块')
   await act(async()=>{const select=host.querySelector('select');select.value='embed';select.dispatchEvent(new Event('change',{bubbles:true}))})
   await click('确认插入嵌入');await flush();const state=JSON.parse(json(liveEditor));expect(state.root.children.some(n=>n.type==='wiki-link'&&n.embedded&&n.blockId===id)).toBe(true)
   expect(host.querySelector('.block-reference-embed pre')?.textContent).toBe('来源正文')
   const e=editor();e.setEditorState(e.parseEditorState(state));expect(json(e)).toBe(JSON.stringify(state))
 })
 test('reloading even the same note invalidates the captured panel and late preview',async()=>{
   await mount();let resolve;api.mockImplementation(()=>new Promise(r=>resolve=r));await input(blockLocator('source',id));await click('读取来源块')
   const content=body(paragraph('已重新加载'));await act(async()=>root.render(<Harness content={content}/>));await act(async()=>resolve(file()));expect(host.querySelector('[role=dialog]')).toBeNull();expect(json(liveEditor)).toContain('已重新加载');expect(json(liveEditor)).not.toContain('blockId')
 })
 test('a hanging embed can be stopped without reviving a late reply',async()=>{
   let resolve;api.mockImplementation(()=>new Promise(r=>resolve=r));await act(async()=>root.render(<BlockEmbedView id="source" title="来源" blockId={id}/>));await click('停止读取');await act(async()=>resolve(file()));expect(host.querySelector('pre')).toBeNull();expect(host.textContent).toContain('读取已停止')
 })
 test('changing source note identity discards the previous embed result',async()=>{
   await act(async()=>root.render(<BlockEmbedView id="source" title="来源" blockId={id}/>));await flush();expect(host.querySelector('pre')).toBeTruthy()
   api.mockResolvedValue({...file(body(paragraph('另一笔记',id))),id:'other'});await act(async()=>root.render(<BlockEmbedView id="other" title="另一来源" blockId={id}/>));await flush();expect(host.querySelector('pre')?.textContent).toBe('另一笔记')
 })
})
