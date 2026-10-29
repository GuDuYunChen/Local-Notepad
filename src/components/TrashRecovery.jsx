import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '~/services/api'
import { RECOVERY_JOURNAL, RECOVERY_CHANGED, createRecoveryJournal, ordinaryRecoveryItem, recoveryView, recoveryIntent, recoveryCurrentMatches, readTrashRecovery, sendTrashRecovery } from '~/services/trashRecovery.mjs'
import './TrashRecovery.css'

const controls = node => [...(node?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') || [])].filter(n => !n.closest('fieldset:disabled,[hidden]'))
// Resolve usable target paths once, not one full-tree walk for every option.
export function recoveryTargets(items) {
  const byID = new Map(items.map(r => [r.id,r])), known = new Map([['',true]])
  for (const row of items) {
    if (known.has(row.id)) continue
    const path = [], seen = new Set(); let id = row.id, good = false
    while (!known.has(id)) {
      const r = byID.get(id)
      if (!r || r.is_deleted || !r.is_folder || !ordinaryRecoveryItem(r) || seen.has(id)) break
      seen.add(id); path.push(id); id = r.parent_id
    }
    if (known.has(id)) good = known.get(id)
    known.set(row.id,good); for (const key of path) known.set(key,good)
  }
  return items.filter(r => known.get(r.id) && r.is_folder).sort((a,b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}
export default function TrashRecovery({onClose,onOpenFile}) {
  const [snapshot,setSnapshot] = useState(null), [loading,setLoading] = useState(false), [busy,setBusy] = useState(false), [opening,setOpening] = useState(false), [stale,setStale] = useState(false)
  const [query,setQuery] = useState(''), [type,setType] = useState('all'), [page,setPage] = useState(0), [selected,setSelected] = useState([]), [mode,setMode] = useState('original'), [parent,setParent] = useState('')
  const [confirmation,setConfirmation] = useState(null), [pending,setPending] = useState(null), [corrupt,setCorrupt] = useState(false), [reviewed,setReviewed] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState(''), [restored,setRestored] = useState([]), [resultID,setResultID] = useState('')
  const alive = useRef(false), panel = useRef(null), reader = useRef(null), writer = useRef(null), navigator = useRef(null), working = useRef(false), composing = useRef(false), epoch = useRef(0), staleRef = useRef(false), origin = useRef({})
  const journal = useMemo(() => createRecoveryJournal({getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)}),[])
  const readRecord = () => { try { const value = journal.read(); setPending(value); setCorrupt(false); return value } catch { setCorrupt(true); setPending(null); setError('本机恢复记录无法读取，原记录保留；暂不允许新恢复。'); return null } }
  const result = expected => { const notes = expected.filter(r=>!r.is_folder); setRestored(notes); setResultID(notes[0]?.id || '') }
  const load = async (reconcile = false) => {
    if (working.current) return
    const ctl = new AbortController(); reader.current?.abort(); navigator.current?.abort(); reader.current=ctl; setLoading(true); setOpening(false); setSnapshot(null); setSelected([]); setPage(0); setConfirmation(null); setReviewed(false); setRestored([]); setResultID(''); setError(''); setMessage('')
    try {
      const value = await readTrashRecovery(api,ctl.signal)
      if (!alive.current || ctl.signal.aborted || reader.current !== ctl) return
      setSnapshot(value); setStale(false); staleRef.current=false
      let record
      try { record=journal.read(); setPending(record); setCorrupt(false) } catch { readRecord(); return }
      if (record && reconcile) {
        const matches=recoveryCurrentMatches(value,record); setReviewed(true)
        if (matches) result(record.expected)
        setMessage(matches ? '当前资料与恢复目标一致；这不是原请求的历史回执。仅只读核对，没有重发。' : '当前资料与恢复目标不同；这不是原请求的历史回执。没有再次恢复，请核对后明确结束本机记录。')
      } else setMessage(record ? '回收站已读取；存在待核对恢复，不会自动重发。' : '完整回收站已读取。选择来源和恢复位置，再预览确认。')
    } catch(e) { if (alive.current && !ctl.signal.aborted && reader.current===ctl) { setError(e.message); readRecord() } }
    finally { if (alive.current && reader.current===ctl) setLoading(false) }
  }
  useLayoutEffect(()=>{alive.current=true;const entry=document.activeElement,node=panel.current;controls(node)[0]?.focus();return()=>{alive.current=false;reader.current?.abort();writer.current?.abort();navigator.current?.abort();if(entry?.isConnected&&(!document.activeElement||document.activeElement===document.body||node?.contains(document.activeElement)))entry.focus?.()}},[])
  useEffect(()=>{readRecord();void load()},[])
  useEffect(()=>{
    const change=e=>{if(e.detail?.recoveryOrigin===origin.current||(e.type==='storage'&&e.key!==RECOVERY_JOURNAL&&e.key!==null))return;epoch.current++;staleRef.current=true;reader.current?.abort();navigator.current?.abort();setLoading(false);setOpening(false);setStale(true);setConfirmation(null);setReviewed(false);setMessage('');setError('资料或恢复记录已在其它位置变化。请重新读取后确认。');readRecord()}
    for(const name of ['storage','library:refresh',RECOVERY_CHANGED])window.addEventListener(name,change)
    return()=>{for(const name of ['storage','library:refresh',RECOVERY_CHANGED])window.removeEventListener(name,change)}
  },[])
  useLayoutEffect(()=>{if(confirmation)controls(panel.current.querySelector('[role=alertdialog]'))[0]?.focus()},[confirmation])
  const byID=useMemo(()=>new Map(snapshot?.items.map(r=>[r.id,r])||[]),[snapshot])
  const targets=useMemo(()=>recoveryTargets(snapshot?.items||[]),[snapshot])
  const rows=useMemo(()=>snapshot?recoveryView(snapshot,query,type):[],[snapshot,query,type])
  const pages=Math.max(1,Math.ceil(rows.length/50)), blocked=!snapshot||loading||busy||opening||stale||!!pending||corrupt
  const quiet=()=>{setMessage('');if(!stale&&!pending&&!corrupt)setError('')}
  const closeNow=()=>{reader.current?.abort();writer.current?.abort();navigator.current?.abort();onClose()}
  const close=()=>{if(confirmation)return;if(busy)setConfirmation({kind:'leave'});else closeNow()}
  const cancelRead=()=>{reader.current?.abort();reader.current=null;setLoading(false);setSnapshot(null);setError('');setMessage('读取已取消，没有采用部分结果。')}
  const toggle=id=>{quiet();if(!selected.includes(id)&&selected.length>=100){setError('一次最多选择100个来源，请缩小范围。');return}setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])}
  const propose=()=>{if(blocked||composing.current)return;quiet();try{setConfirmation({kind:'restore',intent:recoveryIntent(snapshot,selected,mode,mode==='original'?'':parent)});setError('')}catch(e){setError(e.message)}}
  const run=async intent=>{
    if(working.current||blocked||staleRef.current||snapshot.revision!==intent.expected_revision)return
    working.current=true;quiet()
    try{journal.save(intent)}catch{working.current=false;readRecord();setError('本机恢复记录未能保存并读回，尚未发送恢复请求。请处理存储空间或已有记录后重试。');return}
    const ctl=new AbortController(),generation=epoch.current,before=snapshot;writer.current=ctl;setBusy(true);setPending(intent);setReviewed(false);setError('');setMessage('');let acknowledged=false
    try{
      const after=await sendTrashRecovery(api,before,intent,ctl.signal)
      if(!alive.current||ctl.signal.aborted)return
      acknowledged=true
      if(generation===epoch.current){setSnapshot(after);setStale(false);staleRef.current=false;result(intent.expected)}else{setSnapshot(null);setStale(true);staleRef.current=true;setRestored([])}
      setSelected([]);setPage(0)
      window.dispatchEvent(new CustomEvent('library:refresh',{detail:{recoveryOrigin:origin.current}}));window.dispatchEvent(new CustomEvent(RECOVERY_CHANGED,{detail:{recoveryOrigin:origin.current}}))
      journal.clear(intent);setPending(null)
      setMessage(generation===epoch.current?`本机数据库已确认整批恢复 ${intent.expected.length} 项；正文、标签与历史未改写。`:'数据库已确认本次恢复，随后有外部变化，请重新读取。')
    }catch{if(alive.current){setMessage('');setError(acknowledged?'数据库已确认，但本机记录清理失败；请只读核对，不要重发。':'恢复结果未确认。停止等待不等于撤销，记录已保留；请只读核对，不会自动重发。');readRecord()}}
    finally{working.current=false;if(writer.current===ctl)writer.current=null;if(alive.current)setBusy(false)}
  }
  const openRestored=async()=>{
    if(!resultID||!snapshot||staleRef.current||busy||loading||opening||!onOpenFile)return
    const ctl=new AbortController();navigator.current?.abort();navigator.current=ctl;setOpening(true);quiet()
    const valid=()=>alive.current&&!ctl.signal.aborted&&navigator.current===ctl&&!staleRef.current
    try{const accepted=await onOpenFile(resultID,{signal:ctl.signal,shouldSelect:valid});if(valid()){if(accepted===true)onClose();else setMessage('打开已取消，恢复结果和当前笔记保留。')}}catch{if(valid())setError('已恢复笔记暂时无法打开，请重新读取或从笔记列表打开。')}finally{if(alive.current&&navigator.current===ctl)setOpening(false)}
  }
  const clearRecord=()=>{try{setConfirmation(corrupt?{kind:'corrupt',raw:journal.raw()}:{kind:'record',record:pending})}catch{setError('恢复记录无法读取，未清除。')}}
  const confirm=()=>{const choice=confirmation;if(!choice)return;setConfirmation(null);if(choice.kind==='restore'){void run(choice.intent);return}if(choice.kind==='leave'){closeNow();return}try{if(choice.kind==='corrupt')journal.discardCorrupt(choice.raw);else journal.clear(choice.record);setPending(null);setCorrupt(false);setReviewed(false);setError('');setMessage('本机待核对记录已结束；没有撤销或重发恢复。')}catch(e){setError(e.message);readRecord()}}
  const keyboard=e=>{if(opening)return;e.stopPropagation();if(composing.current||e.isComposing||e.nativeEvent?.isComposing||e.keyCode===229)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();return}if(e.key==='Escape'){e.preventDefault();if(confirmation)setConfirmation(null);else close();return}if(e.key==='Tab'){const list=controls(confirmation?panel.current.querySelector('[role=alertdialog]'):panel.current),first=list[0],last=list.at(-1);if(!first)e.preventDefault();else if(e.shiftKey&&(document.activeElement===first||!list.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!list.includes(document.activeElement))){e.preventDefault();first.focus()}}}
  const confirmText=confirmation?.kind==='restore'?`整批恢复 ${confirmation.intent.ids.length} 个来源，共 ${confirmation.intent.expected.length} 项（含内部已删除项目）。${mode==='original'?'恢复到各自原位置。':`恢复到 ${parent?(byID.get(parent)?.title||'所选目录'):'根目录'}。`}同名或资料变化会整批拒绝，不覆盖、不自动改名，不修改正文。`:confirmation?.kind==='leave'?'停止等待并关闭？请求可能仍会完成，待核对记录会保留，不自动重发。':'只结束本机记录，不撤销、重发或证明原恢复结果。'
  return createPortal(<div className="trash-recovery-overlay" data-opening={opening?'true':undefined} onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
    <section className="trash-recovery" ref={panel} role="dialog" aria-modal="true" aria-label="本地回收站恢复工作台" onKeyDown={keyboard} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}}>
      <header><div><h2>回收站恢复工作台</h2><p>选择来源 → 选择恢复位置 → 预览并确认</p></div><button type="button" aria-label="关闭恢复工作台" disabled={!!confirmation} onClick={close}>×</button></header>
      <div className="trash-recovery-scroll" aria-busy={loading||busy}>
        <p className="trash-recovery-scope">只恢复普通笔记与文件夹，不永久删除、不覆盖、不改正文。文件夹包含内部已删除项目；模板与异常子项会拒绝。每批最多100个来源、1000个实际项目。</p>
        {loading&&<p>正在读取完整回收站…可以取消。</p>}
        {snapshot&&<>
          <fieldset className="trash-recovery-tools" disabled={busy||opening||!!confirmation}>
            <label>查找<input aria-label="恢复项目查找" maxLength={128} value={query} onChange={e=>{setQuery(e.target.value);setPage(0);quiet()}}/></label>
            <label>类型<select aria-label="恢复项目类型" value={type} onChange={e=>{setType(e.target.value);setPage(0);quiet()}}><option value="all">全部</option><option value="note">笔记</option><option value="folder">文件夹</option></select></label>
            <button type="button" disabled={!selected.length} onClick={()=>{setSelected([]);quiet()}}>清空选择</button>
          </fieldset>
          <div className="trash-recovery-items" aria-label="回收站恢复来源">{rows.slice(page*50,(page+1)*50).map(row=><article key={row.id} data-recovery-item={row.id}><label><input type="checkbox" aria-label={`选择恢复 ${row.title}`} checked={selected.includes(row.id)} disabled={blocked||!!confirmation} onChange={()=>toggle(row.id)}/><strong>{row.title||'未命名'}</strong></label><small>{row.is_folder?'文件夹':'笔记'} · 原位置：{row.parent_id?(byID.get(row.parent_id)?.title||'已缺失目录'):'根目录'}{row.parent_id&&byID.get(row.parent_id)?.is_deleted?'（也在回收站）':''}</small></article>)}</div>
          {!rows.length&&<p>{query?'没有匹配的普通回收站项目。':'当前没有此类型的普通回收站项目。模板不在本工作台恢复范围。'}</p>}
          <nav aria-label="恢复来源分页"><span>{rows.length} 项 · 第 {page+1}/{pages} 页</span><button type="button" disabled={page===0||busy||opening||!!confirmation} onClick={()=>setPage(p=>p-1)}>上一页</button><button type="button" disabled={page+1>=pages||busy||opening||!!confirmation} onClick={()=>setPage(p=>p+1)}>下一页</button></nav>
          {!!selected.length&&<details><summary>已选择 {selected.length} 个来源（跨页保留）</summary><ul>{selected.map(id=><li key={id}>{byID.get(id)?.title||id}</li>)}</ul></details>}
          <fieldset className="trash-recovery-destination" disabled={blocked||!!confirmation}>
            <legend>恢复位置</legend><label><input type="radio" name="recovery-mode" checked={mode==='original'} onChange={()=>{setMode('original');quiet()}}/>各自原位置</label><label><input type="radio" name="recovery-mode" checked={mode==='target'} onChange={()=>{setMode('target');quiet()}}/>指定现存目录</label>
            {mode==='target'&&<label>目标<select aria-label="恢复目标文件夹" value={parent} onChange={e=>{setParent(e.target.value);quiet()}}><option value="">根目录</option>{targets.map(r=><option key={r.id} value={r.id}>{r.title||'未命名'} · {r.id}</option>)}</select></label>}
            <p>原父目录不可用时，可指定根目录或现存普通文件夹。不会自动重建、合并或改名。</p>
          </fieldset>
          {confirmation?.kind==='restore'&&<details open><summary>本次恢复明细（{confirmation.intent.expected.length} 项）</summary><ol>{confirmation.intent.expected.map(row=><li key={row.id}>{row.is_folder?'目录':'笔记'} · {row.title||'未命名'}</li>)}</ol></details>}
          {!!restored.length&&<fieldset className="trash-recovery-result" disabled={loading||busy||opening||stale||!!confirmation}><legend>已恢复 / 当前核对相符的笔记</legend><select aria-label="打开已恢复笔记" value={resultID} onChange={e=>setResultID(e.target.value)}>{restored.map(row=><option key={row.id} value={row.id}>{row.title||'未命名'} · {row.id}</option>)}</select><button type="button" disabled={!onOpenFile||!resultID} onClick={()=>void openRestored()}>通过原保存保护打开</button></fieldset>}
        </>}
      </div>
      <div className="trash-recovery-feedback" aria-label="恢复操作反馈">
        {confirmation?<div role="alertdialog" aria-modal="true" aria-label="确认恢复操作"><p>{confirmText}</p><button type="button" onClick={()=>setConfirmation(null)}>取消操作</button><button type="button" onClick={confirm}>确认继续</button></div>:<>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{(pending||corrupt)&&<div className="trash-recovery-pending"><strong>{corrupt?'本机恢复记录损坏或不可读':'有待核对的恢复记录'}</strong><button type="button" disabled={busy||loading||opening||corrupt} onClick={()=>void load(true)}>只读核对当前状态</button><button type="button" disabled={busy||loading||opening||(!corrupt&&!reviewed)} onClick={clearRecord}>{corrupt?'清除损坏恢复记录':'结束待核对记录'}</button></div>}</>}
      </div>
      <footer><span>{busy?'已发送；停止等待不等于撤销':opening?'等待原保存保护…':`已选 ${selected.length}/100 · 不永久删除`}</span><button type="button" disabled={busy||loading||opening||!!confirmation} onClick={()=>void load(!!pending)}>重新读取回收站</button><button type="button" disabled={blocked||!selected.length||!!confirmation} onClick={propose}>预览整批恢复</button>{loading&&<button type="button" onClick={cancelRead}>取消读取</button>}{busy&&<button type="button" disabled={!!confirmation} onClick={()=>writer.current?.abort()}>停止等待</button>}{opening&&<button type="button" onClick={()=>{navigator.current?.abort();setOpening(false);setMessage('打开已取消。')}}>取消打开</button>}</footer>
    </section>
  </div>,document.body)
}
