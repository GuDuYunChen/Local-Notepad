import React, {useEffect,useMemo,useRef,useState} from 'react'
import {api} from '~/services/api'
import ConfirmDialog from './ConfirmDialog'
import {PIN_PAGE_SIZE,pinJournal,pinQuery,pinView,readPins,readPin,changePin,readPinnedTarget} from '../services/localPins.mjs'
import './PinnedNotesPanel.css'

export default function PinnedNotesPanel({onSelectFile,onClose}) {
  const [snapshot,setSnapshot]=useState(null),[status,setStatus]=useState('loading'),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [query,setQuery]=useState(''),[applied,setApplied]=useState(''),[valid,setValid]=useState(true),[scope,setScope]=useState('pinned'),[order,setOrder]=useState('updated'),[page,setPage]=useState(0),[selectedId,setSelectedId]=useState('')
  const [pending,setPending]=useState(null),[corrupt,setCorrupt]=useState(false),[reviewed,setReviewed]=useState(false),[review,setReview]=useState(null),[busy,setBusy]=useState('')
  const alive=useRef(false),reader=useRef(null),operation=useRef(null),composing=useRef(false),search=useRef(null),latest=useRef({onSelectFile,onClose}),pendingRaw=useRef(null)
  latest.current={onSelectFile,onClose}
  const journal=useMemo(()=>pinJournal(),[])
  const refreshPending=()=>{
    try { const raw=journal.raw();if(raw!==pendingRaw.current)setReviewed(false);pendingRaw.current=raw;const p=journal.read();setPending(p);setCorrupt(false);return p }
    catch { setReviewed(false);setCorrupt(true);setPending(null);setError('本机置顶记录无法读取；不会发起新修改。可以核对或明确清除记录。');return null }
  }
  const cancelOperation=()=>{operation.current?.abort();operation.current=null;setBusy('')}
  const load=async()=>{
    if(operation.current)return
    reader.current?.abort();const ctl=new AbortController();reader.current=ctl
    setSnapshot(null);setSelectedId('');setPage(0);setStatus('loading');setError('');setNotice('');setReviewed(false);refreshPending()
    try { const value=await readPins(api,ctl.signal);if(alive.current&&reader.current===ctl&&!ctl.signal.aborted){setSnapshot(value);setStatus('ready')} }
    catch(e){if(alive.current&&reader.current===ctl&&!ctl.signal.aborted){setError(e.message);setStatus('error')}}
  }
  useEffect(()=>{
    alive.current=true;void load()
    const changed=()=>{if(!operation.current){setReviewed(false);refreshPending();void load()}}
    window.addEventListener('local-pins:changed',changed)
    const storage=e=>{if(e.key===null||e.key==='local-notepad.pending-pin.v1'){setReviewed(false);refreshPending()}}
    window.addEventListener('storage',storage)
    return()=>{alive.current=false;reader.current?.abort();operation.current?.abort();window.removeEventListener('local-pins:changed',changed);window.removeEventListener('storage',storage)}
  },[])
  const view=useMemo(()=>snapshot&&valid?pinView(snapshot,applied,scope,order):[],[snapshot,applied,scope,order,valid])
  const pages=Math.max(1,Math.ceil(view.length/PIN_PAGE_SIZE)),currentPage=Math.min(page,pages-1),rows=view.slice(currentPage*PIN_PAGE_SIZE,(currentPage+1)*PIN_PAGE_SIZE)
  const selected=snapshot?.items.find(n=>n.id===selectedId)
  const applyQuery=(value,commit=!composing.current)=>{setQuery(value);setNotice('');setSelectedId('');setPage(0);if(commit){try{setApplied(pinQuery(value));setValid(true);setError('')}catch(e){setValid(false);setError(e.message)}}}
  const updateRow=row=>{setSnapshot(prior=>prior?{...prior,items:prior.items.map(n=>n.id===row.id?row:n)}:prior)}
  const write=async row=>{
    if(operation.current||pending||corrupt||status!=='ready')return
    const ctl=new AbortController();operation.current=ctl;setBusy('write');setNotice('');setError('');setReviewed(false)
    try {
      const result=await changePin(api,row,!row.is_pinned,{signal:ctl.signal})
      if(!alive.current||operation.current!==ctl||ctl.signal.aborted)return
      updateRow(result);if(scope==='pinned'&&!result.is_pinned)setSelectedId('')
      setNotice(result.is_pinned?'已置顶，常用笔记列表已更新。正文未改动。':'已取消置顶，笔记和正文仍然保留。');refreshPending()
    }catch(e){if(alive.current&&operation.current===ctl){setError(e.message);refreshPending()}}
    finally{if(operation.current===ctl){operation.current=null;if(alive.current)setBusy('')}}
  }
  const reconcile=async()=>{
    if(operation.current||corrupt)return
    const expected=refreshPending();if(!expected)return
    const capturedRaw=pendingRaw.current,ctl=new AbortController();operation.current=ctl;setBusy('reconcile');setError('');setNotice('');setReviewed(false)
    try {
      const value=await readPin(api,expected.item.id,ctl.signal)
      if(!alive.current||operation.current!==ctl||ctl.signal.aborted)return
      if(journal.raw()!==capturedRaw)throw Error('本机记录已变化，请重新核对。')
      updateRow(value)
      setNotice(`当前${value.is_folder?'目录':'笔记'}“${value.title}”${value.is_pinned?'已置顶':'未置顶'}。这是当前读取状态，不是原请求的历史回执；没有重发修改。`)
      window.dispatchEvent(new Event('library:refresh'))
    }catch(e){if(alive.current&&operation.current===ctl&&!ctl.signal.aborted)setError(e.message+' 目标可能已删除或暂时不可用；结束记录不会撤销或重发操作。')}
    finally{if(operation.current===ctl){operation.current=null;if(alive.current){setBusy('');try{setReviewed(!ctl.signal.aborted&&journal.raw()===capturedRaw)}catch{setReviewed(false)}}}}
  }
  const endRecord=raw=>{
    try{journal.clear(raw);refreshPending();setReviewed(false);setNotice('已结束本机置顶记录，没有再次修改笔记。');setError('')}
    catch(e){refreshPending();setError(e.message);setReviewed(false)}
  }
  const open=async()=>{
    if(!selected||operation.current||composing.current)return
    const row=selected,ctl=new AbortController();operation.current=ctl;setBusy('open');setError('');setNotice('')
    const owns=()=>alive.current&&operation.current===ctl&&!ctl.signal.aborted
    let failure=''
    try {
      if(typeof latest.current.onSelectFile!=='function')throw Error('笔记打开通道不可用。')
      const accepted=await latest.current.onSelectFile(row.id,{signal:ctl.signal,shouldSelect:owns,readFile:async(id,{signal})=>{
        try{if(id!==row.id)throw Error('打开目标身份不符。');return await readPinnedTarget(api,row,signal)}catch(e){failure=e.message;throw e}
      }})
      if(owns()){if(failure)setError(failure);else setNotice(accepted===true?'笔记已打开。':'未切换笔记，查询、选择和当前草稿已保留。')}
    }catch(e){if(owns())setError(failure||e.message)}
    finally{if(operation.current===ctl){operation.current=null;if(alive.current)setBusy('')}}
  }
  const close=()=>{reader.current?.abort();operation.current?.abort();latest.current.onClose?.()}
  const stop=()=>{
    if(operation.current){operation.current.abort();if(busy==='open'){cancelOperation();setNotice('已停止打开，当前笔记未切换。')}}
    else{reader.current?.abort();reader.current=null;setStatus('stopped');setNotice('已停止读取，重新读取可以继续。')}
  }
  return <section className="pinned-workspace" aria-label="本地置顶笔记" onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing&&!composing.current&&!review&&!document.querySelector('[role=dialog][aria-modal=true]')){e.preventDefault();e.stopPropagation();close()}}}>
    <header className="pinned-header"><div><h2>置顶笔记</h2><p>把常用内容放在一起，保留原来的正文和位置。</p></div><div><button type="button" className="btn small" disabled={!!busy||status==='loading'} onClick={()=>void load()}>刷新列表</button><button type="button" className="btn small" onClick={close}>返回笔记</button></div></header>
    {error&&<p className="pinned-feedback error" role="alert">{error}</p>}{notice&&<p className="pinned-feedback" role="status">{notice}</p>}
    {(pending||corrupt)&&<section className="pinned-recovery" aria-label="置顶操作恢复"><h3>{corrupt?'本机置顶记录损坏':'置顶操作待核对'}</h3>{pending&&<p>{pending.pinned?'置顶':'取消置顶'}：{pending.item.title||'未命名'}{pending.item.is_folder?'（目录）':''}</p>}<p>结果未确认时不自动重发。先只读核对，再明确结束记录；结束记录不等于撤销。</p><button type="button" className="btn small" disabled={!!busy||corrupt} onClick={()=>void reconcile()}>核对当前置顶状态</button><button type="button" className="btn small" disabled={!!busy||(!corrupt&&!reviewed)} onClick={()=>setReview({kind:'clear',raw:pendingRaw.current})}>{corrupt?'清除损坏记录':'结束这条操作记录'}</button></section>}
    {(status==='loading'||busy)&&<div className="pinned-wait"><span role="status">{busy==='write'?'正在修改置顶状态…':busy==='open'?'正在核对笔记并等待原保存决定…':busy==='reconcile'?'正在只读核对…':'正在读取笔记列表…'}</span><button type="button" className="btn small" onClick={stop}>停止等待</button></div>}
    {(status==='error'||status==='stopped')&&<button type="button" className="btn" disabled={!!busy} onClick={()=>void load()}>重新读取置顶笔记</button>}
    {status==='ready'&&snapshot&&<>
      <div className="pinned-tools"><label>查找笔记<input ref={search} aria-label="查找置顶笔记" value={query} disabled={!!busy} placeholder="按标题查找" onCompositionStart={()=>{composing.current=true;setSelectedId('')}} onCompositionEnd={e=>{composing.current=false;applyQuery(e.currentTarget.value,true)}} onChange={e=>applyQuery(e.target.value)}/></label><label>显示范围<select aria-label="置顶显示范围" value={scope} disabled={!!busy} onChange={e=>{setScope(e.target.value);setPage(0);setSelectedId('')}}><option value="pinned">已置顶</option><option value="all">全部可用笔记</option></select></label><label>排序<select aria-label="置顶笔记排序" value={order} disabled={!!busy} onChange={e=>{setOrder(e.target.value);setPage(0)}}><option value="updated">最近编辑</option><option value="title">标题</option></select></label><button type="button" className="btn small" disabled={!!busy} onClick={()=>{composing.current=false;applyQuery('',true);search.current?.focus()}}>清除查找</button></div>
      <p className="pinned-count" role="status">{snapshot.items.filter(n=>n.is_pinned).length} 篇已置顶 · {view.length} 个匹配结果</p>
      <div className="pinned-content"><div><div className="pinned-list" role="list" aria-label="置顶笔记列表">{rows.map(n=><div role="listitem" key={n.id}><button type="button" className="pinned-row" data-pinned-note-id={n.id} disabled={!!busy} aria-pressed={selectedId===n.id} onClick={()=>{if(!composing.current){setSelectedId(n.id);setError('');setNotice('')}}}><span aria-hidden="true">{n.is_pinned?'★':'☆'}</span><strong>{n.title||'未命名'}</strong><small>{n.is_pinned?'已置顶':'未置顶'}</small></button></div>)}</div>
        {!rows.length&&<div className="pinned-empty"><h3>{!snapshot.items.length?'还没有可用笔记':scope==='pinned'&&!applied?'还没有置顶笔记':'没有匹配的笔记'}</h3><p>{scope==='pinned'?'切换到“全部可用笔记”，选择常用内容并置顶。':'清除查找可查看全部；在原笔记列表中可以新建内容。'}</p>{scope==='pinned'&&<button type="button" className="btn" disabled={!!busy} onClick={()=>{setScope('all');setPage(0);setSelectedId('')}}>从全部笔记中选择</button>}</div>}
        {pages>1&&<nav className="pinned-pages" aria-label="置顶笔记分页"><button type="button" disabled={!!busy||currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {pages}</span><button type="button" disabled={!!busy||currentPage+1===pages} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}</div>
        <aside className="pinned-detail" aria-label="选中置顶笔记">{selected?<><h3>{selected.title||'未命名'}</h3><p>{selected.is_pinned?'这篇笔记已置顶。':'这篇笔记尚未置顶。'}</p><button type="button" className="btn primary" disabled={!!busy} onClick={()=>void open()}>打开选中笔记</button><button type="button" className="btn" disabled={!!busy||!!pending||corrupt} onClick={()=>{if(selected.is_pinned)setReview({kind:'unpin',item:selected});else void write(selected)}}>{selected.is_pinned?'取消这篇笔记置顶…':'置顶这篇笔记'}</button><p>打开前会重新读取目标，并使用原有保存、放弃、取消保护。置顶不会保存正文草稿。</p></>:<p>先选择笔记。选择本身不会打开或修改正文。</p>}</aside>
      </div>
    </>}
    <footer>仅展示可用普通笔记，不包含目录、模板或回收站。列表最多完整读取2000篇、2MiB元数据；超限明确报错。目录置顶仍可在原右键菜单操作。</footer>
    {review&&<ConfirmDialog title={review.kind==='clear'?'结束本机置顶记录？':'取消这篇笔记置顶？'} message={review.kind==='clear'?'只清除当前本机记录，不撤销也不重发服务器操作。目标可能已变化，请以当前读取为准。':`仅取消“${review.item.title}”的置顶。笔记、正文和位置仍然保留。`} onClose={()=>setReview(null)} actions={[{label:'取消',onClick:()=>setReview(null)},{label:'确认',kind:'primary',onClick:()=>{const r=review;setReview(null);if(r.kind==='clear')endRecord(r.raw);else void write(r.item)}}]}/>}
  </section>
}
