import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {api} from '~/services/api'
import {ATTACHMENT_STATES,ATTACHMENT_PAGE_SIZE,readAttachmentAudit,auditItems,downloadAttachmentAudit} from '~/services/attachmentAudit.mjs'
import './AttachmentAudit.css'
const controls=node=>[...(node?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')||[])].filter(n=>!n.closest('[hidden],fieldset:disabled'))
const bytes=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KiB`:`${(n/1048576).toFixed(1)} MiB`
export default function AttachmentAudit({onClose,onOpenFile}){
 const [snapshot,setSnapshot]=useState(null),[loading,setLoading]=useState(false),[opening,setOpening]=useState(false),[stale,setStale]=useState(false)
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[sort,setSort]=useState('state'),[page,setPage]=useState(0),[selected,setSelected]=useState(''),[notePage,setNotePage]=useState(0),[gaps,setGaps]=useState(false)
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[exporting,setExporting]=useState(false),[details,setDetails]=useState(false)
 const alive=useRef(false),request=useRef(null),navigation=useRef(null),panel=useRef(null),composing=useRef(false),exportButton=useRef(null),wasExporting=useRef(false),staleRef=useRef(false)
 const refresh=async()=>{
  navigation.current?.abort();setOpening(false)
  const ctl=new AbortController();request.current?.abort();request.current=ctl;setLoading(true);setSnapshot(null);setStale(false);staleRef.current=false;setError('');setMessage('');setExporting(false);setSelected('');setGaps(false);setPage(0);setNotePage(0)
  try{const value=await readAttachmentAudit(api,ctl.signal);if(alive.current&&!ctl.signal.aborted&&request.current===ctl){setSnapshot(value);setMessage('附件检查完成。仅为读取时的元数据与候选引用，不是可删除清单。')}}
  catch(e){if(alive.current&&!ctl.signal.aborted&&request.current===ctl)setError(e.message)}
  finally{if(alive.current&&request.current===ctl)setLoading(false)}
 }
 const stop=()=>{request.current?.abort();request.current=null;setLoading(false);setSnapshot(null);setError('');setMessage('检查已取消，没有采用部分结果。')}
 const close=()=>{request.current?.abort();navigation.current?.abort();onClose()}
 useLayoutEffect(()=>{alive.current=true;const entry=document.activeElement,node=panel.current;controls(node)[0]?.focus();return()=>{alive.current=false;request.current?.abort();navigation.current?.abort();if(entry?.isConnected&&(!document.activeElement||document.activeElement===document.body||node?.contains(document.activeElement)))entry.focus?.()}},[])
 useEffect(()=>{void refresh()},[])
 useEffect(()=>{const changed=()=>{staleRef.current=true;request.current?.abort();request.current=null;navigation.current?.abort();setLoading(false);setOpening(false);setStale(true);setExporting(false);setMessage('');setError('资料库已变化；这是旧检查结果，请重新检查后打开或导出。')};const events=['library:refresh','attachments:changed'];for(const e of events)window.addEventListener(e,changed);return()=>{for(const e of events)window.removeEventListener(e,changed)}},[])
 useLayoutEffect(()=>{if(exporting)controls(panel.current.querySelector('[role=alertdialog]'))[0]?.focus();else if(wasExporting.current)exportButton.current?.focus();wasExporting.current=exporting},[exporting])
 const items=useMemo(()=>snapshot?auditItems(snapshot,{query,filter,sort}):[],[snapshot,query,filter,sort])
 const notesById=useMemo(()=>new Map(snapshot?.notes.map(n=>[n.id,n])||[]),[snapshot])
 const selectedItem=items.find(i=>i.name===selected),associated=gaps?(snapshot?.notes.filter(n=>!n.parsed||n.rejected_urls>0)||[]):(selectedItem?.notes.map(id=>notesById.get(id))||[])
 const pages=Math.max(1,Math.ceil(items.length/ATTACHMENT_PAGE_SIZE)),notePages=Math.max(1,Math.ceil(associated.length/ATTACHMENT_PAGE_SIZE))
 const change=(setter,value)=>{setter(value);setPage(0);setSelected('');setGaps(false);setNotePage(0);setMessage('');if(!stale)setError('')}
 const open=async note=>{
  if(note.scope!=='active'||!onOpenFile||staleRef.current||loading||opening||exporting)return
  const ctl=new AbortController();navigation.current=ctl;setOpening(true);setError('');setMessage('')
  const current=()=>alive.current&&!ctl.signal.aborted&&navigation.current===ctl&&!staleRef.current
  try{const accepted=await onOpenFile(note.id,{signal:ctl.signal,shouldSelect:current});if(current()){if(accepted===true)onClose();else setMessage('打开已取消；检查结果保留，没有修改笔记。')}}
  catch{if(current())setError('来源笔记无法打开或已变化，请重新检查后重试。')}
  finally{if(alive.current&&navigation.current===ctl)setOpening(false)}
 }
 const exportNow=()=>{if(!snapshot||loading||staleRef.current)return;setError('');setMessage('');try{downloadAttachmentAudit(snapshot,{query,filter,sort},details);setExporting(false);setMessage('已发起报告下载，请检查保存结果。附件和正文均未修改。')}catch{setError('报告未能导出，检查结果仍保留；请重试。')}}
 const keyboard=e=>{
  if(opening)return;e.stopPropagation()
  if(composing.current||e.isComposing||e.nativeEvent?.isComposing||e.keyCode===229)return
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();return}
  if(e.key==='Escape'){e.preventDefault();if(exporting)setExporting(false);else close();return}
  if(e.key==='Tab'){const nodes=controls(exporting?panel.current.querySelector('[role=alertdialog]'):panel.current),first=nodes[0],last=nodes.at(-1);if(!first){e.preventDefault();return}if(e.shiftKey&&(document.activeElement===first||!nodes.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!nodes.includes(document.activeElement))){e.preventDefault();first.focus()}}
 }
 const t=snapshot?.totals
 return createPortal(<div className="attachment-audit-overlay" data-opening={opening?'true':undefined} onMouseDown={e=>{if(e.target===e.currentTarget&&!exporting)close()}}>
  <section className="attachment-audit" ref={panel} role="dialog" aria-modal="true" aria-label="本地附件检查中心" onKeyDown={keyboard} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}}>
   <header><div><h2>附件检查中心</h2><p>只读检查 · 不删除文件 · 不改写正文</p></div><button type="button" aria-label="关闭附件检查中心" disabled={exporting} onClick={close}>×</button></header>
   <div className="attachment-audit-scroll" aria-busy={loading}>
    <p className="attachment-audit-scope">检查附件文件夹的直接条目，以及已保存普通笔记、模板和回收站文本中的本地 URL 候选引用。不读取附件内容，不联网，也不验证文件内容是否损坏。</p>
    <p className="attachment-audit-warning">“未发现候选引用”不等于可以删除：草稿、历史版本和外部资料不在本次范围，文本或代码中的路径也可能计为候选引用。</p>
    {loading&&<p>正在检查本机附件与保存的引用…可以随时取消。</p>}
    {snapshot&&<>
     <p>检查时间：{new Date(snapshot.captured_at*1000).toLocaleString('zh-CN')}{stale?' · 已过时':''}</p>
     <dl className="attachment-audit-cards">{[['普通附件',t.files],['缺失附件',t.missing],['未发现引用',t.unreferenced],['非普通条目',t.blocked]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value.toLocaleString('zh-CN')}</dd></div>)}</dl>
     <p>普通文件大小合计 {bytes(t.bytes)} · 检查 {t.notes} 篇保存正文 · {t.references} 组附件与笔记关联。</p>
     {(t.unparsed>0||t.rejected_urls>0)&&<p className="attachment-audit-warning">覆盖缺口：{t.unparsed} 篇内容未完整解析，{t.rejected_urls} 个不安全或不支持的本地 URL 未采用。不能据此判断附件无人使用。<button type="button" disabled={stale||opening||exporting} onClick={()=>{setGaps(true);setSelected('');setNotePage(0);setMessage('')}}>查看未解析或拒绝来源</button></p>}
     <fieldset className="attachment-audit-filters" disabled={opening||exporting||stale}><legend>查找附件</legend><label>文件名<input aria-label="附件名称查找" maxLength={128} value={query} onChange={e=>change(setQuery,e.target.value)}/></label><label>状态<select aria-label="附件检查范围" value={filter} onChange={e=>change(setFilter,e.target.value)}><option value="all">全部条目</option>{Object.entries(ATTACHMENT_STATES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>排序<select aria-label="附件检查排序" value={sort} onChange={e=>change(setSort,e.target.value)}><option value="state">问题优先</option><option value="size">大小从高到低</option><option value="name">文件名</option></select></label></fieldset>
     <p>当前筛选 {items.length} 项 · 第 {page+1}/{pages} 页</p>
     <div className="attachment-audit-items">{items.slice(page*50,(page+1)*50).map(item=><article key={item.name} data-state={item.state}><button type="button" disabled={stale||opening||exporting} aria-pressed={item.name===selected} onClick={()=>{setSelected(item.name);setGaps(false);setNotePage(0);setMessage('')}}>{item.name}</button><span>{ATTACHMENT_STATES[item.state]}</span><small>{['available','unreferenced'].includes(item.state)?bytes(item.bytes):'未读取文件内容'} · {item.notes.length} 篇候选来源</small></article>)}</div>
     {!items.length&&<p>没有符合条件的附件条目。</p>}
     <nav aria-label="附件分页"><button type="button" disabled={page===0||stale||opening||exporting} onClick={()=>setPage(p=>p-1)}>上一页</button><button type="button" disabled={page+1>=pages||stale||opening||exporting} onClick={()=>setPage(p=>p+1)}>下一页</button></nav>
     {(selectedItem||gaps)&&<section className="attachment-audit-sources" aria-label="附件来源笔记"><h3>{gaps?'未解析或拒绝的来源':`${selectedItem.name} 的候选来源`}</h3><p>模板与回收站条目只展示来源，不自动恢复或打开为普通笔记。</p>{!associated.length&&<p>本次范围未发现可识别引用；不提供删除操作。</p>}{associated.slice(notePage*50,(notePage+1)*50).map(note=><article key={note.id}><button type="button" disabled={note.scope!=='active'||stale||opening||exporting||!onOpenFile} onClick={()=>void open(note)}>{note.title||'未命名笔记'}</button><span>{note.scope==='active'?'普通笔记':note.scope==='trash'?'回收站':'模板'}{note.parsed?'':' · 未完整解析'}{note.rejected_urls>0?` · ${note.rejected_urls} 个拒绝URL`:''}</span></article>)}{associated.length>50&&<nav aria-label="来源分页"><button type="button" disabled={notePage===0||stale||opening||exporting} onClick={()=>setNotePage(p=>p-1)}>上一组来源</button><span>{notePage+1}/{notePages}</span><button type="button" disabled={notePage+1>=notePages||stale||opening||exporting} onClick={()=>setNotePage(p=>p+1)}>下一组来源</button></nav>}</section>}
    </>}
   </div>
   <div className="attachment-audit-feedback" aria-label="附件检查反馈">
    {exporting&&<div role="alertdialog" aria-modal="true" aria-label="确认附件报告导出"><p>默认只导出汇总，不含文件名、标题或查询词。勾选后附当前筛选条目、来源标题和笔记 ID；请妥善保管。报告不是可删除清单。</p><label><input type="checkbox" checked={details} onChange={e=>setDetails(e.target.checked)}/>包含文件名和来源清单</label><button type="button" onClick={()=>setExporting(false)}>取消导出</button><button type="button" onClick={exportNow}>确认导出</button></div>}
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
   </div>
   <footer><span>仅检查，不清理</span><button type="button" disabled={loading||opening||exporting} onClick={()=>void refresh()}>重新检查</button>{loading&&<button type="button" onClick={stop}>取消检查</button>}{opening&&<button type="button" onClick={()=>{navigation.current?.abort();setOpening(false);setMessage('打开已取消。')}}>取消打开</button>}<button ref={exportButton} type="button" disabled={!snapshot||loading||opening||stale||exporting} onClick={()=>{setDetails(false);setMessage('');setError('');setExporting(true)}}>导出检查报告</button></footer>
  </section>
 </div>,document.body)
}
