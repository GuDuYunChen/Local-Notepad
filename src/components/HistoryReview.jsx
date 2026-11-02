import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '~/services/api'
import { readComparisonIndex, comparisonChoices, readComparisonSource, compareNoteText, COMPARISON_ROW_PAGE } from '~/services/noteComparison.mjs'
import { readHistoryReview, sameHistoryReview, historyReviewChoices, downloadHistoryReview, HISTORY_REVIEW_PAGE } from '~/services/historyReview.mjs'
import { formatHistoryTime } from '~/services/versionHistory.mjs'
import './HistoryReview.css'

const controls = node => [...(node?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || [])].filter(n=>!n.closest('[hidden],fieldset:disabled'))
export default function HistoryReview({ onClose, onOpenFile }) {
  const [index,setIndex]=useState(null), [query,setQuery]=useState(''), [page,setPage]=useState(0)
  const [file,setFile]=useState(''), [snapshot,setSnapshot]=useState(null), [historyQuery,setHistoryQuery]=useState(''), [historyPage,setHistoryPage]=useState(0)
  const [mode,setMode]=useState('text'), [rowPage,setRowPage]=useState(0), [change,setChange]=useState(0), [relocate,setRelocate]=useState(0)
  const [busy,setBusy]=useState(''), [stale,setStale]=useState(false), [problem,setProblem]=useState(''), [message,setMessage]=useState('')
  const [confirm,setConfirm]=useState(false), [contents,setContents]=useState(false)
  const composing=useRef(false)
  const panel=useRef(null), active=useRef(null), alive=useRef(false), closing=useRef(false), invalid=useRef(false), lastRead=useRef({file:'',version:null}), exportButton=useRef(null), previousConfirm=useRef(false)
  const current=ctl=>alive.current&&!closing.current&&active.current===ctl&&!ctl.signal.aborted
  const begin=kind=>{if(active.current||closing.current)return null;const ctl=new AbortController();active.current=ctl;setBusy(kind);setProblem('');setMessage('');return ctl}
  const finish=ctl=>{if(alive.current&&active.current===ctl){active.current=null;setBusy('')}}
  const close=()=>{if(closing.current)return;closing.current=true;active.current?.abort();active.current=null;onClose()}
  const invalidate=()=>{invalid.current=true;active.current?.abort();active.current=null;setBusy('');setStale(true);setConfirm(false);setMessage('');setProblem('资料库已变化，旧对照不能打开或导出。请重新读取目录。')}
  const refresh=async()=>{
    const ctl=begin('index');if(!ctl)return
    invalid.current=false;setStale(false);setIndex(null);setSnapshot(null);setFile('');setConfirm(false);setPage(0);setHistoryPage(0);setHistoryQuery('')
    try{const value=await readComparisonIndex(api,ctl.signal);if(current(ctl)){setIndex(value);setMessage('目录已读取。请选择一篇普通笔记；不会自动恢复、清理或保存正文。')}}
    catch(e){if(current(ctl))setProblem(e.message)}finally{finish(ctl)}
  }
  const load=async(id,version=null)=>{
    if(!index||invalid.current||confirm)return
    const ctl=begin('history');if(!ctl)return
    const switching=file!==id;lastRead.current={file:id,version};setFile(id);setSnapshot(null)
    if(switching){setHistoryQuery('');setHistoryPage(0)}
    try{
      const value=await readHistoryReview(api,id,version,ctl.signal)
      if(!current(ctl))return
      const entry=index.notes.find(n=>n.id===id)
      if(!entry||entry.title!==value.current.title||entry.parent_id!==value.current.parent_id){invalidate();return}
      setSnapshot(value);setMessage(value.total?'历史已读取。左侧为所选历史，右侧为当前保存正文；不代表编辑器中的未保存草稿。':'该笔记当前没有保留快照。没有把当前正文冒充历史记录。')
    }catch(e){if(current(ctl))setProblem(e.message)}finally{finish(ctl)}
  }
  const cancel=()=>{active.current?.abort();active.current=null;setBusy('');setProblem('');setConfirm(false);setMessage('本次操作已取消；未采用迟到结果，也未发起下载或正文修改。')}
  useLayoutEffect(()=>{alive.current=true;const entry=document.activeElement,node=panel.current;controls(node)[0]?.focus();return()=>{alive.current=false;active.current?.abort();active.current=null;if(entry?.isConnected&&(document.activeElement===document.body||node?.contains(document.activeElement)))entry.focus?.()}},[])
  useEffect(()=>{void refresh()},[])
  useEffect(()=>{const events=['library:refresh','folder-workspace:changed','trash-recovery:changed'];for(const name of events)window.addEventListener(name,invalidate);return()=>{for(const name of events)window.removeEventListener(name,invalidate)}},[])
  useLayoutEffect(()=>{if(confirm)controls(panel.current?.querySelector('[role=alertdialog]'))[0]?.focus();else if(previousConfirm.current)exportButton.current?.focus();previousConfirm.current=confirm},[confirm])
  const notes=useMemo(()=>index?comparisonChoices(index,query):[],[index,query])
  const versions=useMemo(()=>snapshot?historyReviewChoices(snapshot,historyQuery):[],[snapshot,historyQuery])
  const model=useMemo(()=>snapshot?.selected?compareNoteText(snapshot.selected.content,snapshot.current.content,mode):null,[snapshot,mode])
  const notePages=Math.max(1,Math.ceil(notes.length/HISTORY_REVIEW_PAGE)), versionPages=Math.max(1,Math.ceil(versions.length/HISTORY_REVIEW_PAGE)), rowPages=Math.max(1,Math.ceil((model?.rows.length||0)/COMPARISON_ROW_PAGE))
  useLayoutEffect(()=>{setChange(0);setRowPage(Math.floor((model?.changes[0]??0)/COMPARISON_ROW_PAGE))},[model])
  useLayoutEffect(()=>{if(model?.state==='different')panel.current?.querySelector('[data-history-change=true]')?.scrollIntoView?.({block:'center',inline:'nearest'})},[model,rowPage,change,relocate])
  useEffect(()=>{setHistoryPage(p=>Math.min(p,versionPages-1))},[versionPages])
  const blocked=!!(busy||stale||confirm)
  const locate=(value=change)=>{if(blocked||!model?.changes.length)return;setChange(value);setRowPage(Math.floor(model.changes[value]/COMPARISON_ROW_PAGE));setRelocate(n=>n+1)}
  const open=async()=>{
    if(!snapshot||invalid.current||confirm||!onOpenFile)return
    const ctl=begin('open');if(!ctl)return
    let sourceError
    try{
      const accepted=await onOpenFile(snapshot.current.id,{signal:ctl.signal,refreshCurrent:true,shouldSelect:()=>current(ctl)&&!invalid.current,
        readFile:async(id,{signal})=>{try{if(id!==snapshot.current.id)throw Error('来源身份不符');return await readComparisonSource(api,snapshot.current,signal)}catch(e){sourceError=e;throw e}}})
      if(current(ctl)){if(accepted===true)close();else if(sourceError?.code==='stale')invalidate();else if(sourceError)setProblem('来源无法读取，请重试；没有恢复或改写正文。');else setMessage('打开已取消，历史对照保留。')}
    }catch{if(current(ctl)){if(sourceError?.code==='stale')invalidate();else setProblem('来源打开未完成，请重试。')}}finally{finish(ctl)}
  }
  const download=async()=>{
    if(!confirm||!snapshot?.selected||invalid.current)return
    const ctl=begin('export');if(!ctl)return
    try{
      const latest=await readHistoryReview(api,snapshot.current.id,snapshot.selected.id,ctl.signal)
      if(!current(ctl))return
      if(!sameHistoryReview(snapshot,latest)){invalidate();return}
      downloadHistoryReview(latest,mode,contents);setConfirm(false);setMessage('已发起历史对照报告下载；仅导出本次选择，没有修改笔记。')
    }catch(e){if(current(ctl)){setProblem(e.message);setConfirm(false)}}finally{finish(ctl)}
  }
  const keyboard=e=>{
    e.stopPropagation()
    if(composing.current||e.nativeEvent?.isComposing||e.isComposing||e.keyCode===229||e.repeat)return
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();return}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(busy)cancel();else if(confirm)setConfirm(false);else close()}
    if(e.key==='Tab'){const list=controls(confirm?panel.current?.querySelector('[role=alertdialog]'):panel.current);if(list.length){const first=list[0],last=list.at(-1);if(e.shiftKey&&(document.activeElement===first||!list.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!list.includes(document.activeElement))){e.preventDefault();first.focus()}}}
  }
  return createPortal(<div className="history-review-overlay" data-opening={busy==='open'?'true':undefined} onKeyDown={keyboard} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}}><section ref={panel} className="history-review" role="dialog" aria-modal="true" aria-label="本地历史检索与对照" aria-busy={!!busy}>
    <header className="history-review-header"><div><small>本地 · 只读 · 不覆盖草稿</small><h2>历史检索与对照</h2></div><button type="button" className="btn" disabled={confirm} onClick={close}>关闭历史中心</button></header>
    <div className="history-review-feedback" aria-live="polite">{problem?<p role="alert">{problem}</p>:<p role="status">{message||(busy==='index'?'正在读取本地目录…':busy==='history'?'正在读取当前正文与保留历史…':busy==='export'?'正在重新核对导出来源…':busy==='open'?'正在通过原保存保护打开来源…':'请选择笔记和历史快照。')}</p>}{busy&&<button type="button" className="btn" onClick={cancel}>取消当前操作</button>}{!busy&&(stale||!index)&&<button type="button" className="btn" onClick={()=>void refresh()}>重新读取目录</button>}{!busy&&!stale&&index&&file&&!snapshot&&<button type="button" className="btn" onClick={()=>void load(lastRead.current.file,lastRead.current.version)}>重试读取历史</button>}</div>
    <div className="history-review-scroll">
      <p className="history-review-scope">仅查看普通笔记中仍被保留的快照；不包含模板、回收站、附件内容或未保存草稿，也不是完整编辑审计。恢复正文请先打开来源，再使用原编辑器的版本历史。</p>
      <div className="history-review-columns">
        <section aria-label="选择历史来源" className="history-review-source"><h3>1. 选择笔记</h3><label>查找笔记<input aria-label="历史中心查找笔记" maxLength={128} value={query} disabled={blocked} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>
          <p>共 {notes.length} 篇匹配笔记{index?` · 排除 ${index.hidden} 个隐藏项目`:''}</p>
          {index&&!notes.length&&<p role="status">{index.notes.length?'没有匹配笔记，请清除查找条件。':'当前没有可查看的普通笔记。'}</p>}
          <ul>{notes.slice(page*HISTORY_REVIEW_PAGE,(page+1)*HISTORY_REVIEW_PAGE).map(n=><li key={n.id}><button type="button" className={file===n.id?'selected':''} data-history-file={n.id} disabled={blocked} aria-pressed={file===n.id} onClick={()=>void load(n.id)}><strong>{n.title||'未命名'}</strong><small>{n.folder}</small></button></li>)}</ul>
          <nav aria-label="历史来源分页"><button type="button" disabled={blocked||page===0} onClick={()=>setPage(n=>n-1)}>上一页笔记</button><span>{page+1}/{notePages}</span><button type="button" disabled={blocked||page+1>=notePages} onClick={()=>setPage(n=>n+1)}>下一页笔记</button></nav>
        </section>
        <section aria-label="选择历史快照" className="history-review-versions"><h3>2. 选择保留快照</h3><label>查找快照<input aria-label="历史中心查找快照" maxLength={128} value={historyQuery} disabled={blocked||!snapshot} placeholder="快照编号、历史标题或 ISO 日期" onChange={e=>{setHistoryQuery(e.target.value);setHistoryPage(0)}}/></label>
          {!file&&<p>先选择左侧笔记。</p>}{snapshot&&<><p>匹配 {versions.length} / 当前保留 {snapshot.total} 份</p>{!versions.length&&<p role="status">{snapshot.total?'没有匹配快照；清除查找可查看其余记录。':'暂无保留历史，不提供虚构的恢复点。'}</p>}
          <ul>{versions.slice(historyPage*HISTORY_REVIEW_PAGE,(historyPage+1)*HISTORY_REVIEW_PAGE).map(v=><li key={v.id}><button type="button" data-history-version={v.id} aria-pressed={snapshot.selected?.id===v.id} className={snapshot.selected?.id===v.id?'selected':''} disabled={blocked||v.content_bytes>512*1024} onClick={()=>void load(file,v.id)}><strong>快照 #{v.id} · {v.title||'未命名'}</strong><small>{formatHistoryTime(v.created_at)} · {v.content_bytes} 字节{v.content_bytes>512*1024?' · 超过对照预算':''}</small></button></li>)}</ul>
          <nav aria-label="历史快照分页"><button type="button" disabled={blocked||historyPage===0} onClick={()=>setHistoryPage(n=>n-1)}>上一页快照</button><span>{historyPage+1}/{versionPages}</span><button type="button" disabled={blocked||historyPage+1>=versionPages} onClick={()=>setHistoryPage(n=>n+1)}>下一页快照</button></nav></>}
        </section>
      </div>
      {snapshot&&<section className="history-review-result" aria-label="历史与当前正文对照"><h3>3. 核对保存正文</h3><p>当前笔记：{snapshot.current.title} · {snapshot.current.folder} · {formatHistoryTime(snapshot.current.updated_at)}</p>
        {!snapshot.selected&&snapshot.total>0&&<p>请选择一份历史快照开始对照，当前尚未加载任何历史正文。</p>}
        {snapshot.selected&&<><p>历史快照 #{snapshot.selected.id}：{snapshot.selected.title} · {formatHistoryTime(snapshot.selected.created_at)}。左侧独有为历史内容，右侧独有为当前保存内容，不是删除或恢复指令。</p>
          {historyQuery&&!versions.some(v=>v.id===snapshot.selected.id)&&<p>当前对照的快照不在查找结果中。</p>}
          <label>对照模式<select aria-label="历史对照模式" value={mode} disabled={blocked} onChange={e=>setMode(e.target.value)}><option value="text">文字投影</option><option value="raw">保存正文原文</option></select></label>
          <p data-history-state={model.state}>{model.message}</p>
          {model.state==='different'&&<><nav aria-label="历史差异导航"><button type="button" disabled={blocked||change===0} onClick={()=>locate(change-1)}>上一处历史差异</button><span>差异 {change+1}/{model.changes.length}</span><button type="button" disabled={blocked} onClick={()=>locate()}>定位历史差异</button><button type="button" disabled={blocked||change+1>=model.changes.length} onClick={()=>locate(change+1)}>下一处历史差异</button></nav>
          <div className="history-review-diff" role="table" aria-label="历史与当前逐行差异"><div role="row" className="history-review-row headings"><span role="columnheader">历史行</span><span role="columnheader">当前行</span><span role="columnheader">类型、行尾与正文</span></div>{model.rows.slice(rowPage*COMPARISON_ROW_PAGE,(rowPage+1)*COMPARISON_ROW_PAGE).map((r,i)=><div role="row" key={rowPage*COMPARISON_ROW_PAGE+i} data-history-change={rowPage*COMPARISON_ROW_PAGE+i===model.changes[change]} className={'history-review-row '+r.kind}><span role="cell">{r.left??'—'}</span><span role="cell">{r.right??'—'}</span><div role="cell"><small>{r.kind==='same'?'相同':r.kind==='left'?'历史独有':'当前独有'} · {r.ending==='none'?'无行尾':r.ending}</small><pre>{r.text||' '}</pre></div></div>)}</div>
          <nav aria-label="历史差异分页"><button type="button" disabled={blocked||rowPage===0} onClick={()=>setRowPage(n=>n-1)}>上一页历史差异</button><span>第 {rowPage+1}/{rowPages} 页</span><button type="button" disabled={blocked||rowPage+1>=rowPages} onClick={()=>setRowPage(n=>n+1)}>下一页历史差异</button></nav></>}
        </>}
      </section>}
    </div>
    <footer className="history-review-footer"><button type="button" className="btn" disabled={blocked} onClick={()=>void refresh()}>刷新历史目录</button><button type="button" className="btn" disabled={blocked||!snapshot||!onOpenFile} onClick={()=>void open()}>打开当前笔记</button><button ref={exportButton} type="button" className="btn primary" disabled={blocked||!snapshot?.selected} onClick={()=>{setContents(false);setConfirm(true)}}>导出历史对照报告</button></footer>
    {confirm&&<div className="history-review-confirm" role="alertdialog" aria-modal="true" aria-label="确认导出历史对照"><h3>确认导出历史对照</h3><p>默认仅导出计数与范围，不包含标题、笔记标识、位置、历史时间或正文。导出前会重新核对当前正文及所选快照，发生变化则拒绝下载。</p><label><input type="checkbox" checked={contents} disabled={!!busy} onChange={e=>setContents(e.target.checked)}/>明确包含标题、位置、标识及两份完整保存正文</label><p>仅选择的历史快照与当前正文；不打包其余历史或附件。</p><div><button type="button" className="btn" onClick={()=>busy?cancel():setConfirm(false)}>取消导出</button><button type="button" className="btn primary" disabled={!!busy} onClick={()=>void download()}>核对后下载</button></div></div>}
  </section></div>,document.body)
}
