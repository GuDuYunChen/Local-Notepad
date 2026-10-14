import React, {useEffect, useMemo, useRef, useState} from 'react'
import {api} from '../services/api'
import ConfirmDialog from './ConfirmDialog'
import {createNoteTagJournal, noteTagIntent, noteTagName, readNoteTags, sendNoteTagIntent, intentMatchesCurrent, tagColor} from '../services/noteTags.mjs'
import './TagSelector.css'

// A separate lifetime for every note: an old completion never becomes the next
// note's tag state. The parent no longer supplies a silent-error empty list.
export default function TagSelector({fileId,onChange}) {
  return fileId ? <NoteTags key={fileId} fileId={fileId} onChange={onChange}/> : null
}
function NoteTags({fileId,onChange}) {
  const [expanded,setExpanded]=useState(false),[snapshot,setSnapshot]=useState(null),[status,setStatus]=useState('loading')
  const [message,setMessage]=useState(''),[feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false)
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[name,setName]=useState('')
  const [pending,setPending]=useState(null),[corrupt,setCorrupt]=useState(false),[reviewed,setReviewed]=useState(false),[confirm,setConfirm]=useState(null)
  const alive=useRef(false),readOwner=useRef(null),writeOwner=useRef(null),action=useRef(false),composing=useRef(false),entry=useRef(null),latestChange=useRef(onChange)
  latestChange.current=onChange
  const journal=useMemo(()=>createNoteTagJournal({getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)},fileId),[fileId])
  const getPending=()=>{try{setPending(journal.read());setCorrupt(false)}catch{setCorrupt(true);setMessage('本机标签操作记录无法读取；原记录保留，尚未发送新修改。')}}
  const adopt=value=>{setSnapshot(value);setStatus('ready');latestChange.current?.(value.tags)}
  const load=async(reconcile=false)=>{
    if(action.current)return
    const ctl=new AbortController();readOwner.current?.abort();readOwner.current=ctl;setStatus('loading');setMessage('')
    try{
      const value=await readNoteTags(api,fileId,ctl.signal)
      if(!alive.current||ctl.signal.aborted||readOwner.current!==ctl)return
      adopt(value)
      if(reconcile){const intent=journal.read();setPending(intent);setReviewed(true);setFeedback(intent?(intentMatchesCurrent(value,intent)?'当前标签与目标一致。这是当前读取结果，不是原请求的历史回执。':'当前标签与原目标不同；未重新发送修改，请核对后明确结束这条记录。'):'当前标签已重新读取。')}
    }catch(error){if(alive.current&&!ctl.signal.aborted&&readOwner.current===ctl){setSnapshot(null);setStatus('error');setMessage(error.message)}}
  }
  useEffect(()=>{
    alive.current=true;getPending();void load()
    return()=>{alive.current=false;readOwner.current?.abort();writeOwner.current?.abort()}
  },[fileId])
  const close=()=>{
    if(name.trim()){setConfirm({kind:'close'});return}
    writeOwner.current?.abort();setExpanded(false)
    window.setTimeout(()=>{if(alive.current)entry.current?.focus()},0)
  }
  const run=async(payload)=>{
    if(action.current||status!=='ready'||pending||corrupt)return
    let intent
    try{intent=noteTagIntent(fileId,payload);journal.save(intent)}catch(e){setMessage(e.message);getPending();return}
    action.current=true;setBusy(true);setPending(intent);setReviewed(false);setFeedback('');setMessage('')
    readOwner.current?.abort();const ctl=new AbortController();writeOwner.current=ctl
    try{
      const value=await sendNoteTagIntent(api,intent,ctl.signal)
      if(!alive.current||ctl.signal.aborted)return
      adopt(value);setFeedback(payload.kind==='create'?'标签已创建或复用，并分配到当前笔记。':payload.attached?'标签已添加到当前笔记。':'已从当前笔记移除标签；其他笔记与标签本身保持不变。')
      journal.clear(intent);setPending(null);if(payload.kind==='create')setName('')
      window.dispatchEvent(new CustomEvent('note-tags:changed',{detail:{fileId}}))
    }catch(e){if(alive.current){setMessage('标签操作未确认。停止或超时不等于撤销；记录已保留，请核对当前标签，不会自动重发。');getPending()}}
    finally{action.current=false;if(writeOwner.current===ctl)writeOwner.current=null;if(alive.current)setBusy(false)}
  }
  const requestTag=tag=>{
    if(busy||pending||corrupt||!snapshot)return
    const attached=snapshot.tags.some(t=>t.id===tag.id),payload={kind:'change',tag_id:tag.id,name:tag.name,expected_attached:attached,attached:!attached}
    if(attached)setConfirm({kind:'remove',tag,payload});else void run(payload)
  }
  const create=()=>{if(composing.current||busy)return;try{void run({kind:'create',name:noteTagName(name)})}catch(e){setMessage(e.message)}}
  const clearPending=()=>{try{if(corrupt)journal.discardCorrupt();else journal.clear(pending);setPending(null);setCorrupt(false);setReviewed(false);setConfirm(null);setFeedback('已结束本机操作记录；没有再次修改标签。')}catch(e){setMessage(e.message);setConfirm(null)}}
  const rows=(snapshot?.available||[]).filter(t=>!query||t.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const blocked=busy||status!=='ready'||!!pending||corrupt
  return <div className="tag-selector note-tags" onKeyDown={e=>{if(e.key==='Escape'&&!e.isComposing&&expanded&&!confirm){e.preventDefault();e.stopPropagation();close()}}}>
    <div className="note-tags-summary" aria-label="当前笔记标签">
      {status==='loading'&&!snapshot?<span role="status">正在读取标签…</span>:snapshot?.tags.map(t=><span className="note-tag-chip" key={t.id}><i style={{backgroundColor:tagColor(t.color)}} aria-hidden="true"/>{t.name}</span>)}
      {status==='ready'&&snapshot?.tags.length===0&&<span className="note-tag-muted">暂无标签</span>}
      <button ref={entry} type="button" className="btn small" aria-label="管理标签" aria-expanded={expanded} onClick={()=>{if(expanded)close();else setExpanded(true)}}>管理标签</button>
    </div>
    {!expanded&&(status==='error'||pending||corrupt)&&<p className="note-tag-warning" role="status">{pending||corrupt?'有待核对的标签操作，打开管理标签继续。':'标签读取失败，打开管理标签可重试。'}</p>}
    {expanded&&<section className="note-tag-panel" aria-label="笔记标签整理">
      <header><strong>整理这篇笔记的标签</strong><button type="button" className="icon-btn" aria-label="关闭标签管理" onClick={close}>×</button></header>
      <p className="note-tag-muted">只修改标签关联，不保存或改写正文。移除不会删除共享标签。</p>
      {feedback&&<p role="status" className="note-tag-feedback">{feedback}</p>}
      {message&&<p role="alert" className="note-tag-warning">{message}</p>}
      {(pending||corrupt)&&<div className="note-tag-recovery"><strong>{corrupt?'操作记录损坏':'标签操作待核对'}</strong>{pending&&<p>{pending.kind==='create'?'创建并分配':pending.attached?'添加':'移除'}：{pending.name}</p>}
        {!corrupt&&<button type="button" className="btn small" disabled={busy||status==='loading'} onClick={()=>void load(true)}>核对当前标签</button>}
        <button type="button" className="btn small" disabled={busy||(!corrupt&&!reviewed)} onClick={()=>setConfirm({kind:'clear'})}>{corrupt?'清除损坏记录':'结束这条操作记录'}</button>
      </div>}
      <div className="note-tag-toolbar"><button type="button" className="btn small" disabled={busy||status==='loading'} onClick={()=>void load(!!pending)}>重新读取标签</button>{busy&&<button type="button" className="btn small" onClick={()=>writeOwner.current?.abort()}>停止等待</button>}</div>
      {status==='loading'&&<p role="status">正在读取完整标签列表…</p>}
      {status==='ready'&&<>
        <label className="note-tag-field">查找标签<input aria-label="查找标签" value={search} disabled={busy} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={e=>{composing.current=false;setQuery(e.currentTarget.value)}} onChange={e=>{setSearch(e.target.value);if(!composing.current)setQuery(e.target.value)}} placeholder="输入标签名称"/></label>
        <p className="note-tag-muted">已分配 {snapshot.tags.length} 项 · 显示 {rows.length} / {snapshot.available.length} 个标签</p>
        <div className="note-tag-options" role="group" aria-label="可用标签">{rows.map(t=><button key={t.id} type="button" data-note-tag-id={t.id} className="note-tag-option" disabled={blocked} aria-pressed={snapshot.tags.some(x=>x.id===t.id)} onClick={()=>requestTag(t)}><i style={{backgroundColor:tagColor(t.color)}} aria-hidden="true"/><span>{t.name}</span><span aria-hidden="true">{snapshot.tags.some(x=>x.id===t.id)?'✓':'＋'}</span></button>)}</div>
        {!rows.length&&<p className="note-tag-muted">{snapshot.available.length?'没有匹配的标签。':'标签库为空，可以新建第一个标签。'}</p>}
        <form className="note-tag-create" onSubmit={e=>{e.preventDefault();create()}}>
          <label className="note-tag-field">新标签名称<input aria-label="新标签名称" value={name} disabled={blocked} onChange={e=>setName(e.target.value)} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}} onKeyDown={e=>{if(e.key==='Enter'&&(e.nativeEvent.isComposing||e.keyCode===229))e.preventDefault()}} placeholder="同名标签会复用"/></label>
          <button type="submit" className="btn primary" disabled={blocked||!name.trim()}>新建并分配</button>
        </form>
      </>}
    </section>}
    {confirm&&<ConfirmDialog title={confirm.kind==='remove'?'从这篇笔记移除标签？':confirm.kind==='clear'?'结束标签操作记录？':'放弃尚未提交的标签名称？'} message={confirm.kind==='remove'?`仅移除“${confirm.tag.name}”与当前笔记的关联；不会删除标签或其他笔记。`:confirm.kind==='clear'?'这只清除本机操作记录，不会撤销或重发服务器操作。请以刚读取的当前标签为准。':'尚未提交的名称将清空，已保存的标签不变。'} onClose={()=>setConfirm(null)} actions={[
      {label:'取消',onClick:()=>setConfirm(null)},
      {label:'确认',kind:confirm.kind==='close'?'primary':'danger',onClick:()=>{const current=confirm;setConfirm(null);if(current.kind==='remove')void run(current.payload);else if(current.kind==='clear')clearPending();else{setName('');writeOwner.current?.abort();setExpanded(false)}}},
    ]}/>}
  </div>
}
