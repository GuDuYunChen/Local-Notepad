import React,{act,useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {test,expect,vi} from 'vitest'
import {LexicalComposer} from '@lexical/react/LexicalComposer'
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext'
import {RichTextPlugin} from '@lexical/react/LexicalRichTextPlugin'
import {ContentEditable} from '@lexical/react/LexicalContentEditable'
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary'
import {$getRoot,$createTextNode,$createParagraphNode} from 'lexical'
import {HeadingNode,$createHeadingNode} from '@lexical/rich-text'
import DocumentOutlinePlugin,{findHeadingByPath} from './DocumentOutlinePlugin'
test('ambiguous heading paths must not select the first source',()=>{expect(findHeadingByPath([{key:'A',text:'同名',level:1,isHeading:true},{key:'B',text:'同名',level:1,isHeading:true}],['同名'])).toBeNull()})
async function real(check){globalThis.IS_REACT_ACT_ENVIRONMENT=true;let editor;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);function Capture(){const[e]=useLexicalComposerContext();useEffect(()=>{editor=e},[e]);return null}
 try{await act(async()=>root.render(<LexicalComposer initialConfig={{namespace:'outline-negative',nodes:[HeadingNode],onError:e=>{throw e}}}><div className="editor-shell"><DocumentOutlinePlugin documentId="A" documentTitle="标题"/><div className="editor-container"><RichTextPlugin contentEditable={<ContentEditable className="editor-input"/>} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/><Capture/></div></div></LexicalComposer>));await act(async()=>editor.update(()=>$getRoot().clear().append($createHeadingNode('h1').append($createTextNode('唯一标题')),$createParagraphNode().append($createTextNode('正文'))),{discrete:true}));await act(async()=>{for(let i=0;i<10;i++)await Promise.resolve()});await check(host)}finally{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();delete globalThis.IS_REACT_ACT_ENVIRONMENT}}
test('single-heading documents retain the outline entry',async()=>real(async host=>expect(host.querySelector('button[aria-label="文档目录"]')).toBeTruthy()))
test('fallback clipboard returning false cannot be reported as copied',async()=>real(async host=>{vi.stubGlobal('navigator',{});const prior=document.execCommand;document.execCommand=vi.fn(()=>false);try{await act(async()=>window.dispatchEvent(new Event('editor:copy-current-reference')));await act(async()=>{for(let i=0;i<20;i++)await Promise.resolve()});expect(document.execCommand).toHaveBeenCalled();expect(host.textContent).toContain('复制未成功')}finally{document.execCommand=prior}}))
