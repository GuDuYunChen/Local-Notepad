import React,{useEffect,useMemo,useRef,useState} from 'react'
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext'
import {$getRoot,$getNodeByKey,$getSelection,$isRangeSelection} from 'lexical'
import {$isHeadingNode} from '@lexical/rich-text'
import {buildHeadingAnchor} from '../utils/linkUtils'
import {formatWikiReferenceText,rememberReference} from '../utils/referenceUtils'
import {isEvidenceContentReady,subscribeEvidenceContentReady} from '~/services/evidenceNavigation'
import {OUTLINE_LIMITS,outlineSnapshot,filterOutline,expandedOutlineKeys,copyOutlineText,resolveOutlinePath,
  calculateReadingProgress,getOutlineBreadcrumb,getCollapsedOutlineKeys,findOutlineHeadingForKey} from '~/services/documentOutline.mjs'
import './DocumentOutline.css'
export {calculateReadingProgress,getOutlineBreadcrumb,getCollapsedOutlineKeys,findOutlineHeadingForKey,findHeadingByPath} from '~/services/documentOutline.mjs'

export default function DocumentOutlinePlugin(props) {return <CurrentOutline key={props.documentId||''} {...props}/>}
function CurrentOutline({documentId='',documentTitle='',initialContent,requireLoaded=false}) {
  const [editor]=useLexicalComposerContext()
  const [snapshot,setSnapshot]=useState({nodes:[],headings:[]}),[status,setStatus]=useState('loading')
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[query,setQuery]=useState('')
  const [collapsed,setCollapsed]=useState(new Set()),[active,setActive]=useState(''),[caret,setCaret]=useState('')
  const [bodyToggle,setBodyToggle]=useState(null)
  const [progress,setProgress]=useState(0),[origin,setOrigin]=useState(null),[feedback,setFeedback]=useState(''),[error,setError]=useState(''),[copying,setCopying]=useState(false)
  const state=useRef({}),alive=useRef(false),epoch=useRef(0),frames=useRef(new Set()),copy=useRef(null),flash=useRef(null),flashTimer=useRef(null)
  const entry=useRef(null),queryInput=useRef(null),list=useRef(null),composing=useRef(false),display=useRef(new Map())
  const ready=()=>!requireLoaded||isEvidenceContentReady(editor,documentId,initialContent)
  const scroller=()=>editor.getRootElement()?.closest('.editor-container')
  state.current={snapshot,status,open,collapsed,active,caret,query,documentTitle}
  const clearFlash=()=>{clearTimeout(flashTimer.current);flash.current?.classList.remove('outline-target-flash');flash.current=null}
  const invalidate=()=>{epoch.current++;for(const f of frames.current)cancelAnimationFrame(f);frames.current.clear();copy.current?.abort();clearFlash()}
  const frame=fn=>{const id=requestAnimationFrame(()=>{frames.current.delete(id);fn()});frames.current.add(id)}
  const resetDisplays=()=>{for(const [el,prior]of display.current){el.style.display=prior;el.classList.remove('outline-section-collapsed')}display.current.clear()}
  const applyFolds=(nodes,keys)=>{
    resetDisplays();const hidden=getCollapsedOutlineKeys(nodes,keys),root=editor.getRootElement()
    for(const node of nodes){const el=editor.getElementByKey(node.key);if(!el||!root?.contains(el))continue;display.current.set(el,el.style.display);if(hidden.has(node.key))el.style.display='none';el.classList.toggle('outline-section-collapsed',node.isHeading&&keys.has(node.key))}
  }
  const collect=()=>{
    invalidate()
    if(!ready()){setSnapshot({nodes:[],headings:[]});setStatus('loading');return}
    try{
      let next
      editor.getEditorState().read(()=>{
        const nodes=$getRoot().getChildren()
        if(nodes.length>OUTLINE_LIMITS.blocks)throw Error('正文块超过大纲完整读取上限，未采用部分目录。')
        next=outlineSnapshot(nodes.map(n=>{
          const heading=$isHeadingNode(n)
          if(heading&&n.getTextContentSize()>OUTLINE_LIMITS.title)throw Error('标题过长，未采用部分目录。')
          return {key:n.getKey(),isHeading:heading,level:heading?Number(n.getTag().slice(1)):null,text:heading?n.getTextContent():''}
        }))
      })
      setSnapshot(next);setStatus('ready');setError('')
      setCollapsed(previous=>new Set([...previous].filter(key=>next.headings.some(h=>h.key===key))))
      setActive(key=>next.headings.some(h=>h.key===key)?key:next.headings[0]?.key||'')
    }catch(e){resetDisplays();setSnapshot({nodes:[],headings:[]});setCollapsed(new Set());setStatus('error');setError(e.message)}
  }
  useEffect(()=>{
    alive.current=true;collect()
    const unsubscribe=subscribeEvidenceContentReady(()=>{if(alive.current)collect()})
    const update=editor.registerUpdateListener(({editorState,dirtyElements,dirtyLeaves})=>{
      if((dirtyElements?.size||0)+(dirtyLeaves?.size||0)>0)collect()
      let key=''
      editorState.read(()=>{const selection=$getSelection();if($isRangeSelection(selection))key=selection.anchor.getNode().getTopLevelElement()?.getKey()||''})
      if(key)setCaret(key)
    })
    return()=>{alive.current=false;invalidate();unsubscribe();update();resetDisplays()}
  },[editor,documentId,initialContent,requireLoaded])
  useEffect(()=>{applyFolds(snapshot.nodes,collapsed);return resetDisplays},[editor,snapshot,collapsed])
  const reveal=key=>{
    const current=state.current,next=expandedOutlineKeys(current.snapshot.nodes,current.collapsed,key)
    applyFolds(current.snapshot.nodes,next);setCollapsed(next)
  }
  useEffect(()=>{
    let scrollFrame=0,observer=null,unbind=()=>{}
    const unregister=editor.registerRootListener(root=>{
      unbind();observer?.disconnect();if(scrollFrame)cancelAnimationFrame(scrollFrame)
      const box=root?.closest('.editor-container');if(!root||!box)return
      const update=()=>{
        if(scrollFrame)cancelAnimationFrame(scrollFrame)
        scrollFrame=requestAnimationFrame(()=>{
          scrollFrame=0;if(!alive.current)return
          setProgress(calculateReadingProgress(box.scrollTop,box.scrollHeight,box.clientHeight))
          const current=state.current,hidden=getCollapsedOutlineKeys(current.snapshot.nodes,current.collapsed)
          const top=box.getBoundingClientRect().top+48
          let key=current.snapshot.headings.find(h=>!hidden.has(h.key))?.key||''
          for(const heading of current.snapshot.headings){if(hidden.has(heading.key))continue;const el=editor.getElementByKey(heading.key);if(el&&el.getBoundingClientRect().top<=top)key=heading.key}
          setActive(key)
        })
      }
      const revealCaret=()=>{invalidate();let key;editor.getEditorState().read(()=>{const s=$getSelection();if($isRangeSelection(s))key=s.anchor.getNode().getTopLevelElement()?.getKey()});if(key)reveal(key)}
      const wheel=()=>invalidate()
      box.addEventListener('scroll',update,{passive:true});box.addEventListener('wheel',wheel,{passive:true})
      root.addEventListener('focus',revealCaret,true);root.addEventListener('keydown',revealCaret,true);window.addEventListener('resize',update)
      if(typeof ResizeObserver==='function'){observer=new ResizeObserver(update);observer.observe(root);observer.observe(box)}
      unbind=()=>{box.removeEventListener('scroll',update);box.removeEventListener('wheel',wheel);root.removeEventListener('focus',revealCaret,true);root.removeEventListener('keydown',revealCaret,true);window.removeEventListener('resize',update)}
      update()
    })
    return()=>{unregister();unbind();observer?.disconnect();if(scrollFrame)cancelAnimationFrame(scrollFrame)}
  },[editor])
  const close=()=>{invalidate();setOpen(false);setFeedback('');entry.current?.focus({preventScroll:true})}
  const scrollToKey=(key,{heading=true,remember=true}={})=>{
    invalidate();setError('');setFeedback('')
    const current=state.current,reviewed=current.snapshot.nodes.find(n=>n.key===key)
    if(current.status!=='ready'||!ready()||!reviewed||(heading&&!reviewed.isHeading)){setError('章节已变化或正文尚未就绪，请重新读取大纲。');return}
    const ticket=epoch.current,box=scroller();if(!box){setError('正文滚动区域尚未就绪，请重试。');return}
    if(remember)setOrigin(box.scrollTop)
    reveal(key)
    frame(()=>frame(()=>{
      if(!alive.current||ticket!==epoch.current||!ready())return
      let valid=false
      editor.getEditorState().read(()=>{const n=$getNodeByKey(key);valid=!!n&&n.getParent()?.getType()==='root'&&(!heading||$isHeadingNode(n)&&n.getTextContent().trim().replace(/\s+/g,' ')===reviewed.rawText)})
      const el=editor.getElementByKey(key),root=editor.getRootElement()
      if(!valid||!el||!root?.contains(el)||!el.isConnected){setError('章节已变化或不可定位，请重新读取；正文未改动。');return}
      const target=Math.max(0,box.scrollTop+el.getBoundingClientRect().top-box.getBoundingClientRect().top-24)
      box.scrollTo({top:target,behavior:'auto'})
      const owner=findOutlineHeadingForKey(current.snapshot.nodes,key)
      setActive(owner?.key||'');clearFlash();flash.current=el;el.classList.add('outline-target-flash');flashTimer.current=setTimeout(clearFlash,900)
      setFeedback('已定位：'+(owner?.text||'最后输入位置'))
    }))
  }
  const copyPath=async(heading,wholeNote=false)=>{
    if(copy.current)return
    const current=state.current
    if(!ready()||current.status!=='ready'){setError('正文尚未就绪，不能复制旧大纲。');return}
    const path=heading?getOutlineBreadcrumb(current.snapshot.nodes,heading.key).map(n=>n.rawText):[]
    if(heading&&resolveOutlinePath(current.snapshot.nodes,path).status!=='found'){setError('章节路径为空或存在同名歧义，未复制；请通过目录条目直接定位。');return}
    const title=state.current.documentTitle
    const value=wholeNote?formatWikiReferenceText(title,path):buildHeadingAnchor(path)
    const ctl=new AbortController(),ticket=epoch.current;copy.current=ctl;setCopying(true);setError('')
    try{
      await copyOutlineText(value,{signal:ctl.signal})
      if(!alive.current||ticket!==epoch.current||ctl.signal.aborted)return
      if(wholeNote&&title===state.current.documentTitle){try{rememberReference({id:documentId,title,sectionPath:path})}catch{setFeedback('引用已复制；本机最近引用记录未保存。');return}}
      setFeedback(wholeNote?'引用已复制':'章节锚点已复制')
    }catch(e){if(alive.current&&!ctl.signal.aborted)setError(e.message)}
    finally{if(copy.current===ctl)copy.current=null;if(alive.current)setCopying(false)}
  }
  useEffect(()=>{
    const toggle=()=>{if(state.current.open)close();else {setOpen(true);frame(()=>{if(alive.current)queryInput.current?.focus({preventScroll:true})})}}
    // The current search has foreground ownership. Leave the permanent outline
    // entry available underneath it and cancel old outline navigation/clipboard work.
    const yieldToSearch=e=>{
      if(e.detail?.documentId&&e.detail.documentId!==documentId)return
      if(ready()&&state.current.open)close()
    }
    const keyboard=e=>{
      if(e.isComposing||e.keyCode===229||composing.current)return
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&['f','h'].includes(e.key.toLowerCase())&&!e.target?.closest?.('[role="dialog"]'))yieldToSearch(e)
      if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='o'){e.preventDefault();toggle()}
    }
    const anchor=e=>{
      if(e.detail?.documentId&&e.detail.documentId!==documentId)return
      const result=resolveOutlinePath(state.current.snapshot.nodes,e.detail?.path);setOpen(true)
      if(result.status!=='found'){setError(result.status==='ambiguous'?'存在同名章节路径，请在目录中直接选择；未自动跳转。':'未找到该章节，可能已改名或移除；未自动跳转。');return}
      scrollToKey(result.heading.key)
    }
    const searchMatch=e=>{if(e.detail?.documentId&&e.detail.documentId!==documentId)return;const key=e.detail?.topLevelKey;if(!state.current.snapshot.nodes.some(n=>n.key===key))return;reveal(key);const h=findOutlineHeadingForKey(state.current.snapshot.nodes,key);if(h)setActive(h.key)}
    const currentReference=()=>{setOpen(true);if(!documentId||!state.current.documentTitle){setError('当前没有可复制的笔记引用。');return};const now=state.current;const h=findOutlineHeadingForKey(now.snapshot.nodes,now.caret)||now.snapshot.headings.find(h=>h.key===now.active);void copyPath(h,true)}
    window.addEventListener('keydown',keyboard);window.addEventListener('editor:toggle-outline',toggle);window.addEventListener('editor:open-search',yieldToSearch);window.addEventListener('editor:open-heading-anchor',anchor);window.addEventListener('editor:search-match',searchMatch);window.addEventListener('editor:copy-current-reference',currentReference)
    return()=>{window.removeEventListener('keydown',keyboard);window.removeEventListener('editor:toggle-outline',toggle);window.removeEventListener('editor:open-search',yieldToSearch);window.removeEventListener('editor:open-heading-anchor',anchor);window.removeEventListener('editor:search-match',searchMatch);window.removeEventListener('editor:copy-current-reference',currentReference)}
  },[editor,documentId,initialContent,requireLoaded])
  const view=useMemo(()=>{try{return {rows:filterOutline(snapshot.nodes,query,collapsed),error:''}}catch(e){return{rows:[],error:e.message}}},[snapshot,query,collapsed])
  const path=getOutlineBreadcrumb(snapshot.nodes,active)
  const fold=key=>{invalidate();setCollapsed(previous=>{const next=new Set(previous);next.has(key)?next.delete(key):next.add(key);return next})}
  const next=direction=>{if(composing.current||!view.rows.length)return;const index=view.rows.findIndex(h=>h.key===active);scrollToKey(view.rows[index<0?(direction>0?0:view.rows.length-1):(index+direction+view.rows.length)%view.rows.length].key)}
  useEffect(()=>{
    const root=editor.getRootElement(),box=scroller();if(!root||!box)return
    const hide=()=>setBodyToggle(null)
    const move=e=>{
      const el=e.target?.closest?.('h1,h2,h3,h4,h5,h6')
      const h=el&&root.contains(el)&&snapshot.headings.find(n=>editor.getElementByKey(n.key)===el)
      const index=h?snapshot.nodes.findIndex(n=>n.key===h.key):-1,after=snapshot.nodes[index+1]
      if(!h||!after||after.isHeading&&after.level<=h.level){hide();return}
      const r=el.getBoundingClientRect();setBodyToggle({key:h.key,left:Math.max(6,r.left-32),top:r.top+Math.max(0,(r.height-24)/2)})
    }
    root.addEventListener('mousemove',move);box.addEventListener('scroll',hide,{passive:true});window.addEventListener('resize',hide)
    return()=>{root.removeEventListener('mousemove',move);box.removeEventListener('scroll',hide);window.removeEventListener('resize',hide)}
  },[editor,snapshot])
  useEffect(()=>{
    if(!open||!active||!list.current)return
    const row=[...list.current.querySelectorAll('[data-outline-key]')].find(el=>el.dataset.outlineKey===active)
    if(!row)return;const a=row.getBoundingClientRect(),b=list.current.getBoundingClientRect()
    if(a.top<b.top||a.bottom>b.bottom)list.current.scrollTo?.({top:Math.max(0,list.current.scrollTop+a.top-b.top-24),behavior:'auto'})
  },[open,active])
  return <>
    {bodyToggle&&<button type="button" className={'heading-body-collapse'+(collapsed.has(bodyToggle.key)?' collapsed':'')} style={{top:bodyToggle.top,left:bodyToggle.left}} onMouseDown={e=>e.preventDefault()} onClick={()=>fold(bodyToggle.key)} aria-label={collapsed.has(bodyToggle.key)?'展开当前章节':'折叠当前章节'}>›</button>}
    <div className="document-reading-progress" aria-hidden="true"><span style={{width:progress+'%'}}/></div>
    <div className={'document-outline local-outline'+(open?' open':'')} onKeyDown={e=>{if(e.key==='Escape'&&!e.isComposing&&!composing.current&&open){e.preventDefault();e.stopPropagation();close()}}}>
      <button ref={entry} type="button" className="document-outline-toggle" aria-label="文档目录" aria-expanded={open} title="文档目录 (Ctrl+Shift+O)" onClick={()=>open?close():setOpen(true)}><span aria-hidden="true">☰</span><span>{snapshot.headings.length}</span></button>
      {open&&<section className="document-outline-panel" aria-label="当前文档大纲">
        <div className="document-outline-header"><div><strong>文档目录</strong><small>当前正文 · 只读导航</small></div><button type="button" aria-label="关闭文档目录" onClick={close}>×</button></div>
        <div className="outline-tools"><button type="button" onClick={()=>{invalidate();collect()}}>重新读取大纲</button><button type="button" disabled={!collapsed.size} onClick={()=>{invalidate();setCollapsed(new Set())}}>展开全部</button><button type="button" onClick={()=>window.dispatchEvent(new Event('editor:open-structure-manager'))}>结构</button></div>
        {status==='loading'&&<p role="status">正文正在加载，暂不显示旧目录。</p>}
        {(error||view.error)&&<p className="outline-error" role="alert">{error||view.error}</p>}
        {feedback&&<p className="outline-feedback" role="status">{feedback}</p>}
        {status==='ready'&&<>
          {!snapshot.headings.length?<p className="outline-empty" role="status">当前正文没有标题。使用编辑器的标题样式后，这里会自动生成目录。</p>:<>
            <label className="outline-query">查找章节<input ref={queryInput} aria-label="查找章节" value={search} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={e=>{composing.current=false;setQuery(e.currentTarget.value)}} onChange={e=>{setSearch(e.target.value);if(!composing.current)setQuery(e.target.value)}} onKeyDown={e=>{if(e.key==='Enter'&&!e.isComposing&&!composing.current){e.preventDefault();next(e.shiftKey?-1:1)}}} placeholder="标题或上级章节名称"/></label>
            <p className="outline-count">显示 {view.rows.length} / {snapshot.headings.length} 个标题 · 阅读 {progress}%</p>
            {path.length>0&&<p className="outline-breadcrumb" aria-label="当前章节路径">{path.map(p=>p.text).join(' › ')}</p>}
            <div className="outline-tools"><button type="button" disabled={!view.rows.length} onClick={()=>next(-1)}>上一章节</button><button type="button" disabled={!view.rows.length} onClick={()=>next(1)}>下一章节</button><button type="button" disabled={!caret} onClick={()=>scrollToKey(caret,{heading:false})}>光标</button><button type="button" disabled={origin===null} onClick={()=>{invalidate();const box=scroller();if(box&&ready()){box.scrollTo({top:origin,behavior:'auto'});setOrigin(null);setFeedback('已返回跳转前的位置')}}}>返回</button></div>
            <div className="document-outline-list" ref={list}>
              {!view.rows.length&&!view.error&&<p role="status">没有匹配的章节，清除查找条件可查看完整目录。</p>}
              {view.rows.map(h=>{const index=snapshot.nodes.findIndex(n=>n.key===h.key),after=snapshot.nodes[index+1],collapsible=after&&(!after.isHeading||after.level>h.level);return <div key={h.key} data-outline-key={h.key} className={'document-outline-row level-'+Math.min(4,h.level)+(active===h.key?' active':'')}>
                <button type="button" className="document-outline-collapse" disabled={!collapsible} aria-label={(collapsed.has(h.key)?'展开章节：':'折叠章节：')+h.text} aria-expanded={!collapsed.has(h.key)} onClick={()=>fold(h.key)}><span className={collapsed.has(h.key)?'':'open'}>›</span></button>
                <button type="button" className="document-outline-item" onClick={()=>scrollToKey(h.key)} aria-current={active===h.key?'location':undefined} title={getOutlineBreadcrumb(snapshot.nodes,h.key).map(p=>p.text).join(' › ')}>{h.text}</button>
                <button type="button" className="document-outline-anchor" disabled={copying} aria-label={'复制章节锚点：'+h.text} onClick={()=>void copyPath(h)}>#</button>
              </div>})}
            </div>
          </>}
        </>}
      </section>}
    </div>
  </>
}
