import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG } from 'lexical'
import ConfirmDialog from '../../ConfirmDialog'
import { SEARCH_LIMITS, assertSearchString } from '~/services/documentSearch.mjs'
import { $readDocumentSearch, $replaceDocumentMatches, searchTopLevelKey, searchDOMRange } from './documentSearchLexical'
import './DocumentSearch.css'
export { findTextMatchOffsets } from '~/services/documentSearch.mjs'
export { $findAllSearchMatches } from './documentSearchLexical'

const HIGHLIGHT = 'notepad-document-find'
export default function SearchPlugin({ documentId = '' }) {
  const [editor] = useLexicalComposerContext()
  const [open,setOpen] = useState(false), [replaceOpen,setReplaceOpen] = useState(false)
  const [input,setInput] = useState(''), [query,setQuery] = useState(''), [replacement,setReplacement] = useState('')
  const [matchCase,setMatchCase] = useState(false), [wholeWord,setWholeWord] = useState(false)
  const [snapshot,setSnapshot] = useState(null), [index,setIndex] = useState(0), [revision,setRevision] = useState(0)
  const [error,setError] = useState(''), [feedback,setFeedback] = useState(''), [review,setReview] = useState(null)
  const [editable,setEditable] = useState(editor.isEditable()), [composing,setComposing] = useState(false)
  const inputRef = useRef(null), panelRef = useRef(null), alive = useRef(false), compose = useRef(false), mutation = useRef(0), active = useRef(null)
  const signature = useRef(''), inAction = useRef(false), epoch = useRef(0), focusFrame = useRef(0)
  const options = { matchCase, wholeWord }
  active.current = {open,query,replacement,matchCase,wholeWord,snapshot,index,revision}
  const clearHighlight = () => globalThis.CSS?.highlights?.delete(HIGHLIGHT)
  const close = () => {
    epoch.current++; setReview(null); setOpen(false); setFeedback(''); clearHighlight()
    if (editor.getRootElement()?.isConnected) editor.getRootElement().focus({preventScroll:true})
  }
  useEffect(() => {
    alive.current = true
    const unregister = editor.registerUpdateListener(({dirtyElements,dirtyLeaves}) => {
      if ((dirtyElements?.size || 0) + (dirtyLeaves?.size || 0)) {
        mutation.current++; setRevision(value=>value+1)
      }
    })
    const offEditable = editor.registerEditableListener(value => {setEditable(value); if (!value) setReview(null)})
    return () => {alive.current=false;epoch.current++;unregister();offEditable();clearHighlight();cancelAnimationFrame(focusFrame.current)}
  }, [editor,documentId])
  useEffect(() => {
    const start = replace => {
      if (!editor.getRootElement()?.isConnected || editor.isComposing()) return
      setOpen(true);setReplaceOpen(Boolean(replace && editor.isEditable()));setError('');setFeedback('');setReview(null)
      const ticket = ++epoch.current
      cancelAnimationFrame(focusFrame.current)
      focusFrame.current=requestAnimationFrame(()=>{if(alive.current&&epoch.current===ticket){inputRef.current?.focus();inputRef.current?.select()}})
    }
    const onKey = e => {
      if (e.defaultPrevented || e.isComposing || e.keyCode===229 || !(e.ctrlKey||e.metaKey) || e.altKey) return
      const otherDialog = e.target?.closest?.('[role="dialog"]')
      if (otherDialog) return
      if (['f','h'].includes(e.key.toLowerCase())) {e.preventDefault();start(e.key.toLowerCase()==='h')}
    }
    const onOpen = e => { if (e.detail?.documentId && e.detail.documentId!==documentId) return; start(e.detail?.replace) }
    window.addEventListener('keydown',onKey);window.addEventListener('editor:open-search',onOpen)
    return ()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('editor:open-search',onOpen)}
  },[editor,documentId])
  useEffect(()=>{
    clearHighlight()
    if(!open||compose.current||!query){setSnapshot(null);setIndex(0);if(!query)setError('');return}
    try{
      let next;editor.getEditorState().read(()=>{next=$readDocumentSearch(query,{matchCase,wholeWord})})
      const key=JSON.stringify([query,matchCase,wholeWord])
      const changed=key!==signature.current
      setIndex(previous=>changed?0:Math.min(previous,Math.max(0,next.matches.length-1)))
      signature.current=key;setSnapshot({...next,revision:mutation.current});setError('')
    }catch(e){setSnapshot(null);setError(e.message)}
  },[editor,open,query,matchCase,wholeWord,revision,composing])
  useEffect(()=>{
    if(!open||composing||!snapshot?.matches[index]){clearHighlight();return}
    const ticket=epoch.current, match=snapshot.matches[index]
    const frame=requestAnimationFrame(()=>{
      if(!alive.current||ticket!==epoch.current||active.current.snapshot!==snapshot||mutation.current!==snapshot.revision)return
      try{
        const key=searchTopLevelKey(editor,match)
        window.dispatchEvent(new CustomEvent('editor:search-match',{detail:{documentId,topLevelKey:key}}))
        const element=editor.getElementByKey(key)
        element?.scrollIntoView?.({block:'center',inline:'nearest',behavior:'auto'})
        if(match.kind==='code-block'){
          window.dispatchEvent(new CustomEvent('editor:code-search-match',{detail:{nodeKey:match.parts[0].key,offset:match.parts[0].start,length:match.length,focus:false}}))
          clearHighlight()
        }else{
          const range=searchDOMRange(editor,match)
          if(range&&globalThis.Highlight&&globalThis.CSS?.highlights) CSS.highlights.set(HIGHLIGHT,new Highlight(range))
        }
      }catch{clearHighlight();setError('匹配位置暂时不可用，请重新查找；正文未改动')}
    })
    return()=>{cancelAnimationFrame(frame);clearHighlight()}
  },[editor,documentId,open,composing,snapshot,index])
  const reset=()=>{setReview(null);setFeedback('');setError('');epoch.current++}
  const composingEvent=e=>e.isComposing||e.nativeEvent?.isComposing||e.keyCode===229||compose.current||editor.isComposing()
  const move=direction=>{
    if(compose.current||!snapshot?.matches.length)return
    setIndex(value=>(value+direction+snapshot.matches.length)%snapshot.matches.length)
  }
  const consent=all=>{
    if(inAction.current||compose.current||!editor.isEditable()||!snapshot?.matches.length)return
    try{
      assertSearchString(replacement,SEARCH_LIMITS.replacement,'替换内容')
      const current={signature:snapshot.signature,revision:snapshot.revision,query,replacement,matchCase,wholeWord,index:all?null:index,documentId,count:all?snapshot.matches.length:1}
      if(all){setReview(current);setFeedback('')}else apply(current)
    }catch(e){setError(e.message)}
  }
  const apply=expected=>{
    if(inAction.current)return
    inAction.current=true
    try{
      const now=active.current
      if(!alive.current||!now.open||!editor.isEditable()||compose.current||editor.isComposing())throw new Error('当前不能替换；只读或输入中的正文不会被修改')
      if(expected.documentId!==documentId||expected.revision!==mutation.current||['query','replacement','matchCase','wholeWord'].some(k=>expected[k]!==now[k]))throw new Error('正文或查找条件已变化，请重新查找后再确认')
      let replaced=0, completed=false, failure=null
      editor.update(()=>{
        if(!editor.isEditable()||expected.revision!==mutation.current){failure=new Error('正文状态已变化，未替换');return}
        try{if($readDocumentSearch(expected.query,{matchCase:expected.matchCase,wholeWord:expected.wholeWord}).signature!==expected.signature)throw new Error('正文已变化，原确认已失效；请重新查找')}catch(e){failure=e;return}
        replaced=$replaceDocumentMatches(expected,expected.query,{matchCase:expected.matchCase,wholeWord:expected.wholeWord},expected.replacement,expected.index)
        completed=true
      },{discrete:true,tag:[HISTORY_PUSH_TAG,SKIP_DOM_SELECTION_TAG]})
      if(failure)throw failure
      if(!completed)throw new Error('替换未完成，请核对当前草稿；不会自动再次替换')
      setError('');setReview(null);setFeedback(replaced?`已在当前草稿替换 ${replaced} 处；请以编辑器保存状态为准。Ctrl+Z 可撤销。`:'替换前后正文相同，没有修改或新增撤销记录。')
    }catch(e){setError(e.message);setReview(null)}finally{inAction.current=false}
  }
  const composeStart=()=>{compose.current=true;setComposing(true);setReview(null);clearHighlight()}
  const composeEnd=()=>{compose.current=false;setComposing(false)}
  const count=snapshot?.matches.length||0, current=snapshot?.matches[index]
  if(!open)return null
  const blocked=composing||!count||!!error||input!==query
  return <section ref={panelRef} className="search-panel document-search" aria-label="文内查找与安全替换" onKeyDown={e=>{
    if(e.key==='Escape'&&!composingEvent(e)&&!review){e.preventDefault();e.stopPropagation();close()}
  }}>
    <header className="search-panel-header"><strong>{replaceOpen?'文内查找与替换':'文内查找'}</strong><button type="button" className="search-btn close-btn" aria-label="关闭文内查找" onClick={close}>×</button></header>
    <div className="search-row"><input ref={inputRef} className="search-input" aria-label="查找内容" placeholder="输入要查找的文字" value={input}
      onCompositionStart={composeStart} onCompositionEnd={e=>{composeEnd();reset();setQuery(e.currentTarget.value)}}
      onChange={e=>{setInput(e.target.value);reset();if(!compose.current)setQuery(e.target.value)}}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!composingEvent(e))move(e.shiftKey?-1:1)}}}/>
      <span className="search-count" role="status">{composing?'输入中':count?`${index+1}/${count}`:query?'0 处':'待查找'}</span>
      <button type="button" className="search-btn" aria-label="上一个匹配" disabled={blocked} onClick={()=>move(-1)}>↑</button><button type="button" className="search-btn" aria-label="下一个匹配" disabled={blocked} onClick={()=>move(1)}>↓</button></div>
    <div className="search-options"><button type="button" className="search-option-chip" aria-pressed={matchCase} disabled={composing} onClick={()=>{reset();setMatchCase(v=>!v)}}>区分大小写</button><button type="button" className="search-option-chip" aria-pressed={wholeWord} disabled={composing} onClick={()=>{reset();setWholeWord(v=>!v)}}>整词</button><button type="button" className="search-option-chip" aria-pressed={replaceOpen} disabled={!editable||composing} onClick={()=>{reset();setReplaceOpen(v=>!v)}}>显示替换</button><button type="button" className="search-option-chip" disabled={composing} onClick={()=>{reset();setRevision(v=>v+1)}}>重新查找</button></div>
    {replaceOpen&&editable&&<div className="search-row"><input className="search-input" aria-label="替换内容" placeholder="留空表示删除匹配文字" value={replacement} onCompositionStart={composeStart} onCompositionEnd={composeEnd} onChange={e=>{reset();setReplacement(e.target.value)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!composingEvent(e))consent(e.shiftKey)}}}/><button type="button" className="search-btn" disabled={blocked} onClick={()=>consent(false)}>替换当前</button><button type="button" className="search-btn" disabled={blocked} onClick={()=>consent(true)}>全部替换…</button></div>}
    {error&&<p role="alert" className="document-search-error">{error}</p>}
    {feedback&&<p role="status" className="document-search-feedback">{feedback}</p>}
    {!error&&query&&!composing&&!count&&<p role="status">未找到匹配；正文未改动。</p>}
    {current&&!composing&&<p className="document-search-preview" aria-label="当前匹配上下文">{current.preview}</p>}
    <p className="document-search-scope">{!editable?'只读模式：仅查找。':''}查找当前编辑器正文（含未保存修改）和代码块。段内可跨加粗、斜体；不跨段落、链接、单元格或嵌入对象。图片、附件、Wiki 引用、隐藏嵌套编辑器不在替换范围。整词按 Unicode 字符边界，不是中文分词。</p>
    {review&&createPortal(<ConfirmDialog title="确认全部替换？" message={<><p>将在当前笔记替换 {review.count} 处。</p><p className="document-search-confirm-text">查找：{review.query}</p><p className="document-search-confirm-text">替换为：{review.replacement||'（删除匹配文字）'}</p><p>跨样式匹配采用起始文字的样式。只修改当前草稿，由原保存流程处理；Ctrl+Z 可撤销本次替换。</p></>} onClose={()=>setReview(null)} actions={[{label:'取消',onClick:()=>setReview(null)},{label:'确认全部替换',kind:'danger',onClick:()=>apply(review)}]}/>, document.body)}
  </section>
}
