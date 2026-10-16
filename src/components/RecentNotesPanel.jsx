import React,{useEffect,useMemo,useRef,useState} from 'react'
import {api} from '~/services/api'
import ConfirmDialog from './ConfirmDialog'
import {RECENT_EVENT,RECENT_KEY,RECENT_PAGE_SIZE,recentStore,recentWarning,recentQuery,recentView,readRecentTarget,notifyRecent} from '../services/recentNotes.mjs'
import './RecentNotesPanel.css'

export default function RecentNotesPanel({onSelectFile,onClose}) {
  const store=useMemo(()=>recentStore(),[]),alive=useRef(false),operation=useRef(null),latest=useRef({onSelectFile,onClose}),composing=useRef(false),search=useRef(null)
  latest.current={onSelectFile,onClose}
  const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[corrupt,setCorrupt]=useState(false),[raw,setRaw]=useState(null)
  const [query,setQuery]=useState(''),[applied,setApplied]=useState(''),[valid,setValid]=useState(true),[page,setPage]=useState(0),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState(null)
  const cancel=()=>{operation.current?.abort();operation.current=null;setBusy(false)}
  const load=()=>{
    cancel();setReview(null);setFeedback('');setError('');setSelected('');setPage(0);setSnapshot(null);setCorrupt(false)
    try{const value=store.read();setSnapshot(value.data);setRaw(value.raw);setError(recentWarning())}
    catch(e){setError(e.message);try{setRaw(store.raw());setCorrupt(e.code==='invalid')}catch{setRaw(null)}}
  }
  useEffect(()=>{
    alive.current=true;load()
    const changed=()=>load(),storage=e=>{if(e.key===RECENT_KEY||e.key===null)load()}
    window.addEventListener(RECENT_EVENT,changed);window.addEventListener('storage',storage)
    return()=>{alive.current=false;operation.current?.abort();window.removeEventListener(RECENT_EVENT,changed);window.removeEventListener('storage',storage)}
  },[])
  const rows=useMemo(()=>snapshot&&valid?recentView(snapshot,applied):[],[snapshot,applied,valid])
  const pages=Math.max(1,Math.ceil(rows.length/RECENT_PAGE_SIZE)),shownPage=Math.min(page,pages-1),shown=rows.slice(shownPage*RECENT_PAGE_SIZE,(shownPage+1)*RECENT_PAGE_SIZE)
  const entry=rows.find(e=>e.id===selected)
  const filter=(value,commit=!composing.current)=>{setQuery(value);setSelected('');setPage(0);setFeedback('');if(commit){try{setApplied(recentQuery(value));setValid(true);setError('')}catch(e){setValid(false);setError(e.message)}}}
  const finishChange=decision=>{
    setReview(null)
    try{
      if(decision.kind==='remove')store.remove(decision.raw,decision.id)
      else if(decision.kind==='clear')store.clear(decision.raw)
      else if(decision.kind==='reset')store.reset(decision.raw)
      else store.enable(decision.raw,decision.enabled)
      notifyRecent()
      setFeedback(decision.kind==='remove'?'已从访问历史移除，原笔记没有删除。':decision.kind==='clear'?'访问历史已清空，所有笔记仍然保留。':decision.kind==='reset'?'已重置损坏记录并暂停记录；笔记未修改，可手动开启记录。':decision.enabled?'已开启记录，从后续进入的笔记开始记录。':'已暂停记录，已有历史保留。')
    }catch(e){load();setError(e.message)}
  }
  const open=async()=>{
    if(!entry||operation.current||composing.current)return
    const target=entry,ctl=new AbortController();operation.current=ctl;setBusy(true);setFeedback('');setError('')
    const owns=()=>alive.current&&operation.current===ctl&&!ctl.signal.aborted
    let problem=''
    try{
      if(typeof latest.current.onSelectFile!=='function')throw Error('笔记打开通道暂不可用。')
      const accepted=await latest.current.onSelectFile(target.id,{signal:ctl.signal,shouldSelect:owns,readFile:async(id,{signal})=>{
        try{if(id!==target.id)throw Error('打开目标身份不符。');return await readRecentTarget(api,target,signal)}catch(e){problem=e.message;throw e}
      }})
      if(owns()){if(problem)setError(problem+' 可以重试或仅移除这条访问记录。');else setFeedback(accepted===true?'笔记已打开。':'未切换笔记，查找条件、历史和当前草稿保留。')}
    }catch(e){if(owns())setError(problem||e.message)}
    finally{if(operation.current===ctl){operation.current=null;if(alive.current)setBusy(false)}}
  }
  const close=()=>{cancel();latest.current.onClose?.()}
  return <section className="recent-workspace" aria-label="本地最近访问" onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing&&!composing.current&&!review&&!document.querySelector('[role=dialog][aria-modal=true]')){e.preventDefault();e.stopPropagation();close()}}}>
    <header className="recent-header"><div><h2>最近访问</h2><p>回到刚才读过的内容，不改变笔记原来的位置。</p></div><div><button type="button" className="btn small" disabled={busy} onClick={load}>重新读取历史</button><button type="button" className="btn small" onClick={close}>返回笔记</button></div></header>
    {error&&<p className="recent-feedback error" role="alert">{error}</p>}{feedback&&<p className="recent-feedback" role="status">{feedback}</p>}
    {corrupt&&<div className="recent-recovery"><p>原记录保留，不把损坏历史当作空历史。重置仅影响本机访问记录，并会暂停后续记录。</p><button type="button" className="btn" onClick={()=>setReview({kind:'reset',raw})}>重置损坏的访问记录…</button></div>}
    {snapshot&&<>
      <div className="recent-tools"><label>查找访问记录<input ref={search} aria-label="查找访问记录" value={query} disabled={busy} placeholder="按上次访问时的标题查找" onCompositionStart={()=>{composing.current=true;setSelected('')}} onCompositionEnd={e=>{composing.current=false;filter(e.currentTarget.value,true)}} onChange={e=>filter(e.target.value)}/></label><button type="button" className="btn small" disabled={busy} onClick={()=>{composing.current=false;filter('',true);search.current?.focus()}}>清除查找</button></div>
      <div className="recent-options"><span role="status">{snapshot.enabled?'正在记录':'已暂停记录'} · {rows.length} / {snapshot.entries.length} 条访问记录</span><button type="button" className="btn small" disabled={busy} onClick={()=>setReview({kind:'enable',raw,enabled:!snapshot.enabled})}>{snapshot.enabled?'暂停记录…':'开启记录…'}</button><button type="button" className="btn small" disabled={busy||!snapshot.entries.length} onClick={()=>setReview({kind:'clear',raw})}>清空访问历史…</button></div>
      {busy&&<div className="recent-wait"><span role="status">正在读取最新笔记并等待原保存决定…</span><button type="button" className="btn small" onClick={()=>{cancel();setFeedback('已停止打开，当前笔记未切换。')}}>停止打开</button></div>}
      <div className="recent-content"><div><div role="list" aria-label="最近访问列表" className="recent-list">{shown.map(item=><div key={item.id} role="listitem"><button type="button" className="recent-row" data-recent-note-id={item.id} aria-pressed={selected===item.id} disabled={busy} onClick={()=>{if(!composing.current){setSelected(item.id);setError('');setFeedback('')}}}><strong>{item.title||'未命名'}</strong><small>{new Date(item.visitedAt).toLocaleString('zh-CN')}</small></button></div>)}</div>
        {!shown.length&&<div className="recent-empty"><h3>{!valid?'请修改查找条件':snapshot.entries.length?'没有匹配的访问记录':'还没有访问记录'}</h3><p>{snapshot.entries.length?'清除查找可以查看全部历史。':'进入普通笔记后会出现在这里；暂停记录期间不会新增。'}</p></div>}
        {pages>1&&<nav className="recent-pages" aria-label="访问历史分页"><button type="button" disabled={busy||shownPage===0} onClick={()=>setPage(shownPage-1)}>上一页</button><span>{shownPage+1} / {pages}</span><button type="button" disabled={busy||shownPage+1===pages} onClick={()=>setPage(shownPage+1)}>下一页</button></nav>}</div>
        <aside className="recent-detail" aria-label="选中访问记录">{entry?<><h3>{entry.title||'未命名'}</h3><p>标题来自上次访问。打开时重新读取同一笔记，更名后使用最新内容；删除或不可用时不切换。</p><button type="button" className="btn primary" disabled={busy} onClick={()=>void open()}>重新打开笔记</button><button type="button" className="btn" disabled={busy} onClick={()=>setReview({kind:'remove',raw,id:entry.id})}>仅移除这条历史…</button><p>选择记录不会自动打开。重开仍经过原保存、放弃和取消保护。</p></>:<p>选择一条记录以重开笔记或整理访问历史。</p>}</aside>
      </div>
    </>}
    <footer>仅保存在这台设备的应用存储中，最多100条、每页20条；只保存笔记标识、标题摘要和访问时间，不保存正文。清理历史不会删除笔记，不随工作区便携包迁移，不保证浏览器存储清理或卸载后仍保留。</footer>
    {review&&<ConfirmDialog title={review.kind==='remove'?'仅移除这条访问历史？':review.kind==='clear'?'清空本机访问历史？':review.kind==='reset'?'重置损坏历史并暂停记录？':review.enabled?'开启访问记录？':'暂停访问记录？'} message={review.kind==='enable'?(review.enabled?'从后续进入的普通笔记开始记录，不补写暂停期间的历史。':'已有历史保留，后续打开笔记不再新增记录。'):review.kind==='reset'?'原本机访问记录会被替换为空记录并暂停；笔记、正文和附件不变。':'只影响本机访问记录，不会删除笔记、正文或附件。'} onClose={()=>setReview(null)} actions={[{label:'取消',onClick:()=>setReview(null)},{label:'确认',kind:'primary',onClick:()=>finishChange(review)}]}/>}
  </section>
}
