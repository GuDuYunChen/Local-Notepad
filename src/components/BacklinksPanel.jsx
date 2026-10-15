import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {api} from '../services/api'
import {readBacklinkSnapshot,readBacklinkDestination,filterBacklinkSources,backlinkPreview,BACKLINK_PAGE} from '../services/backlinkSources.mjs'
import './BacklinksPanel.css'

export default function BacklinksPanel({fileId,onSelectFile}){
 return fileId?<BacklinkWorkspace key={fileId} fileId={fileId} onSelectFile={onSelectFile}/>:null
}
function BacklinkWorkspace({fileId,onSelectFile}){
 const [snapshot,setSnapshot]=useState(null),[status,setStatus]=useState('loading'),[problem,setProblem]=useState(''),[notice,setNotice]=useState('')
 const [query,setQuery]=useState(''),[applied,setApplied]=useState(''),[page,setPage]=useState(0),[selectedId,setSelectedId]=useState(null),[previewPage,setPreviewPage]=useState(0),[opening,setOpening]=useState(false)
 const alive=useRef(false),readOwner=useRef(null),openOwner=useRef(null),composing=useRef(false),panel=useRef(null),input=useRef(null),latest=useRef(onSelectFile)
 latest.current=onSelectFile
 const cancelOpen=()=>{openOwner.current?.abort();openOwner.current=null;setOpening(false)}
 const load=async()=>{
  cancelOpen();readOwner.current?.abort();const ctl=new AbortController();readOwner.current=ctl
  setStatus('loading');setSnapshot(null);setProblem('');setNotice('');setSelectedId(null);setPreviewPage(0)
  try{
   const value=await readBacklinkSnapshot(api,fileId,ctl.signal)
   if(!alive.current||readOwner.current!==ctl||ctl.signal.aborted)return
   setSnapshot(value);setStatus('ready');setPage(0)
   const rows=filterBacklinkSources(value.sources,applied);setSelectedId(rows.find(r=>r.available)?.source_id||rows[0]?.source_id||null)
  }catch(e){if(alive.current&&readOwner.current===ctl&&!ctl.signal.aborted){setProblem(e.message);setStatus('error')}}
 }
 useEffect(()=>{
  alive.current=true;void load()
  return()=>{alive.current=false;readOwner.current?.abort();openOwner.current?.abort()}
 },[fileId])
 // The original reference status is a fixed overlay; keep real buttons reachable
 // without hiding that status or using scripted click workarounds.
 useLayoutEffect(()=>{
  const root=panel.current;if(!root)return
  let frame=0,banner=null
  const schedule=()=>{if(!frame)frame=window.requestAnimationFrame(measure)}
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null
  function measure(){frame=0;const current=document.querySelector('.reference-maintenance-status');if(current!==banner){if(banner)resize?.unobserve(banner);banner=current;if(banner)resize?.observe(banner)}
   const bounds=root.getBoundingClientRect(),overlay=banner?.getBoundingClientRect()
   const overlaps=overlay&&overlay.bottom>0&&overlay.top<window.innerHeight&&overlay.right>bounds.left&&overlay.left<bounds.right
   root.style.setProperty('--backlink-clearance',(overlaps?Math.ceil(window.innerHeight-Math.max(0,overlay.top))+16:16)+'px')
  }
  const changes=new MutationObserver(schedule);changes.observe(document.body,{childList:true,subtree:true});window.addEventListener('resize',schedule);measure()
  return()=>{changes.disconnect();resize?.disconnect();window.removeEventListener('resize',schedule);window.cancelAnimationFrame(frame)}
 },[])
 const rows=useMemo(()=>filterBacklinkSources(snapshot?.sources||[],applied),[snapshot,applied])
 const pages=Math.max(1,Math.ceil(rows.length/BACKLINK_PAGE)),currentPage=Math.min(page,pages-1),visible=rows.slice(currentPage*BACKLINK_PAGE,(currentPage+1)*BACKLINK_PAGE)
 const selected=rows.find(r=>r.source_id===selectedId)||null
 const preview=useMemo(()=>backlinkPreview(selected?.analysis?.text||'',previewPage),[selected,previewPage])
 const edit=(value,commit=!composing.current)=>{cancelOpen();setQuery(value);setNotice('');if(commit){setApplied(value);setPage(0);setSelectedId(null);setPreviewPage(0)}}
 const stop=()=>{
  if(openOwner.current){cancelOpen();setNotice('已停止打开来源，当前笔记与草稿保持不变。')}
  else{readOwner.current?.abort();readOwner.current=null;setStatus('stopped');setNotice('已停止读取，重新读取可继续。')}
 }
 const open=async(sectionPath=null)=>{
  if(!selected?.available||status!=='ready'||openOwner.current||composing.current)return
  const row=selected,ctl=new AbortController();openOwner.current=ctl;setOpening(true);setProblem('');setNotice('正在核对来源；需要离开草稿时，请在原保存确认框中决定。')
  const owns=()=>alive.current&&openOwner.current===ctl&&!ctl.signal.aborted
  let failure=''
  try{
   if(typeof latest.current!=='function')throw Error('笔记打开通道不可用')
   const accepted=await latest.current(row.source_id,{
    signal:ctl.signal,shouldSelect:owns,headingPath:sectionPath||[],
    readFile:async(id,{signal})=>{
     try{if(id!==row.source_id)throw Error('来源身份不符');return await readBacklinkDestination(api,fileId,row,sectionPath,signal)}
     catch(e){failure=e.message;throw e}
    },
   })
   if(!owns())return
   if(failure){setProblem(failure);setNotice('')}
   else setNotice(accepted===true?'来源笔记已打开。':'未切换笔记，查询、预览和当前草稿已保留。')
  }catch{if(owns()){setProblem(failure||'来源暂时无法打开，请手动重试。');setNotice('')}}
  finally{if(openOwner.current===ctl){openOwner.current=null;if(alive.current)setOpening(false)}}
 }
 const summary=snapshot?{verified:snapshot.sources.filter(r=>r.analysis?.state==='verified').length,unavailable:snapshot.sources.filter(r=>!r.available).length,uncertain:snapshot.sources.filter(r=>r.available&&r.analysis?.state!=='verified').length}:null
 return <section ref={panel} className="backlinks-panel local-backlinks" aria-label="反向链接与来源定位">
  <header className="backlinks-header"><div><div className="inspector-section-eyebrow">本地引用</div><h3>反向链接</h3></div>
   <button type="button" className="btn small" disabled={status==='loading'||opening} onClick={()=>void load()}>刷新来源</button></header>
  <p className="backlink-explanation">查看已保存笔记中指向当前笔记的索引与引用位置。未保存草稿不计入；这里不会修改正文或重建引用。</p>
  {problem&&<p className="backlink-feedback error" role="alert">{problem}</p>}
  {notice&&<p className="backlink-feedback" role="status">{notice}</p>}
  {(status==='loading'||opening)&&<button type="button" className="btn small" onClick={stop}>{opening?'停止打开来源':'停止读取来源'}</button>}
  {status==='loading'&&<p role="status">正在读取来源与已保存正文…</p>}
  {(status==='error'||status==='stopped')&&<button type="button" className="btn" onClick={()=>void load()}>重新读取来源</button>}
  {status==='ready'&&snapshot&&<>
   <p className="backlink-summary">已索引 {snapshot.indexed_count} 个来源 · 正文确认 {summary.verified} 个</p>
   {(summary.unavailable>0||summary.uncertain>0)&&<p className="backlink-explanation">不可用来源 {summary.unavailable} 个；索引待更新或正文无法解析 {summary.uncertain} 个。这些不会当作已确认引用位置。</p>}
   {snapshot.indexed_count===0?<div className="backlinks-empty">暂无已索引的反向链接。其他笔记保存 Wiki 引用后可刷新查看。</div>:<>
    <label className="backlink-search">查找来源<input ref={input} aria-label="查找反向来源" value={query} disabled={opening}
     onCompositionStart={()=>{composing.current=true;cancelOpen()}}
     onCompositionEnd={e=>{composing.current=false;edit(e.currentTarget.value,true)}}
     onChange={e=>edit(e.target.value)} placeholder="来源标题或章节名称"/></label>
    <p className="backlink-explanation">匹配 {rows.length} / {snapshot.sources.length} 个来源；每页 {BACKLINK_PAGE} 项。</p>
    <div className="backlinks-list" role="list" aria-label="反向来源列表">
     {visible.map(row=><div className="backlink-source" key={row.source_id} role="listitem">
      <button type="button" className="backlink-source-select" data-backlink-source={row.source_id} disabled={opening} aria-pressed={selectedId===row.source_id}
       onClick={()=>{cancelOpen();setSelectedId(row.source_id);setPreviewPage(0);setProblem('');setNotice('')}}>
       <strong>{row.file?.title||'来源不可用'}</strong><span>{!row.available?'已删除、在回收站、模板或目录':row.analysis.state==='verified'?`${row.analysis.occurrences} 处引用` : row.analysis.state==='stale'?'索引待更新：已保存正文中未找到引用':'已索引：正文格式无法定位'}</span>
      </button>
     </div>)}
     {rows.length===0&&<p>没有匹配的来源，清除查找条件可查看全部。</p>}
    </div>
    {pages>1&&<nav className="backlink-pages" aria-label="来源分页"><button type="button" disabled={opening||currentPage===0} onClick={()=>{setPage(currentPage-1);setSelectedId(null)}}>上一页来源</button><span>{currentPage+1} / {pages}</span><button type="button" disabled={opening||currentPage+1===pages} onClick={()=>{setPage(currentPage+1);setSelectedId(null)}}>下一页来源</button></nav>}
    {selected&&<section className="backlink-detail" aria-label="来源预览">
     <h4>{selected.file?.title||'来源不可用'}</h4>
     {!selected.available?<p>该来源没有可打开的普通笔记，刷新后可核对最新状态。</p>:<>
      <button type="button" className="btn primary" disabled={opening} onClick={()=>void open(null)}>打开来源笔记</button>
      <p className="backlink-explanation">只读纯文本预览，不加载图片或执行嵌入内容。打开前重新核对来源；正文变化后须先刷新。</p>
      <pre tabIndex={0} aria-label="来源正文预览">{preview.text||'（空正文）'}</pre>
      {preview.pages>1&&<nav className="backlink-pages" aria-label="正文预览分页"><button type="button" disabled={opening||preview.page===0} onClick={()=>setPreviewPage(preview.page-1)}>上一段正文</button><span>{preview.page+1} / {preview.pages}</span><button type="button" disabled={opening||preview.page+1===preview.pages} onClick={()=>setPreviewPage(preview.page+1)}>下一段正文</button></nav>}
      {selected.analysis.sections.map((section,index)=><div className="backlink-location" key={JSON.stringify(section.path)}>
       <span>{section.path.join(' › ')||'正文开头'} · {section.count} 处{section.ambiguous?'（同名章节，无法唯一定位）':''}</span>
       <button type="button" className="btn small" data-backlink-location={index} disabled={opening||section.ambiguous} onClick={()=>void open(section.path)}>定位引用章节</button>
      </div>)}
      {selected.analysis.state!=='verified'&&<p className="backlink-explanation">这里仅保留索引线索，不提供未经确认的章节定位；仍可打开来源查看。</p>}
     </>}
    </section>}
   </>}
  </>}
 </section>
}
