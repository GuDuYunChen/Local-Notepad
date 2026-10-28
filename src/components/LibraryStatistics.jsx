import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '~/services/api'
import { readLibraryStatistics, statisticsNotes, downloadStatisticsReport, STATISTICS_PAGE_SIZE } from '~/services/libraryStatistics.mjs'
import './LibraryStatistics.css'
const focusable = node => [...(node?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary') || [])].filter(n=>!n.closest('[hidden],fieldset:disabled'))
const time = seconds => seconds ? new Date(seconds*1000).toLocaleString('zh-CN') : '无日期'
const number = value => value.toLocaleString('zh-CN')
export default function LibraryStatistics({onClose,onOpenFile}) {
  const [snapshot,setSnapshot]=useState(null),[loading,setLoading]=useState(false),[opening,setOpening]=useState(false),[stale,setStale]=useState(false)
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[sort,setSort]=useState('updated'),[page,setPage]=useState(0)
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[exporting,setExporting]=useState(false),[titles,setTitles]=useState(false)
  const alive=useRef(false),request=useRef(null),navigation=useRef(null),panel=useRef(null),composition=useRef(false),exportButton=useRef(null),wasExporting=useRef(false)
  const refresh=async()=>{
    const ctl=new AbortController();request.current?.abort();request.current=ctl;setLoading(true);setSnapshot(null);setStale(false);setError('');setMessage('');setExporting(false);setPage(0)
    try { const value=await readLibraryStatistics(api,ctl.signal);if(alive.current&&!ctl.signal.aborted&&request.current===ctl){setSnapshot(value);setMessage('完整统计已生成；仅包含已保存数据，不包含当前未保存草稿。')} }
    catch(e){if(alive.current&&!ctl.signal.aborted&&request.current===ctl)setError(e.message)}
    finally{if(alive.current&&request.current===ctl)setLoading(false)}
  }
  const stop=()=>{request.current?.abort();request.current=null;setLoading(false);setSnapshot(null);setError('');setMessage('统计已取消，没有保留或导出部分结果。')}
  const close=()=>{request.current?.abort();navigation.current?.abort();onClose()}
  useLayoutEffect(()=>{alive.current=true;const entry=document.activeElement,node=panel.current;focusable(node)[0]?.focus();return()=>{alive.current=false;request.current?.abort();navigation.current?.abort();if(entry?.isConnected&&(!document.activeElement||document.activeElement===document.body||node?.contains(document.activeElement)))entry.focus?.()}},[])
  useEffect(()=>{void refresh()},[])
  useEffect(()=>{const changed=()=>{request.current?.abort();request.current=null;setLoading(false);setStale(true);setExporting(false);setMessage('');setError('资料库已变化，当前显示的是旧快照；请重新统计后打开或导出。')};const events=['library:refresh','note-tags:changed','tag-workspace:changed'];for(const e of events)window.addEventListener(e,changed);return()=>{for(const e of events)window.removeEventListener(e,changed)}},[])
  useLayoutEffect(()=>{if(exporting)focusable(panel.current?.querySelector('[role=alertdialog]'))[0]?.focus();else if(wasExporting.current)exportButton.current?.focus();wasExporting.current=exporting},[exporting])
  const options={query,filter,sort},notes=useMemo(()=>snapshot?statisticsNotes(snapshot,{query,filter,sort}):[],[snapshot,query,filter,sort])
  const pages=Math.max(1,Math.ceil(notes.length/STATISTICS_PAGE_SIZE)),shown=notes.slice(page*STATISTICS_PAGE_SIZE,(page+1)*STATISTICS_PAGE_SIZE)
  const change=(setter,value)=>{setter(value);setPage(0);setMessage('');setError('')}
  const open=async id=>{
    if(loading||opening||stale||!onOpenFile||exporting)return
    const ctl=new AbortController();navigation.current=ctl;setOpening(true);setError('');setMessage('')
    try{const accepted=await onOpenFile(id,{signal:ctl.signal,shouldSelect:()=>alive.current&&!ctl.signal.aborted&&navigation.current===ctl});if(alive.current&&!ctl.signal.aborted){if(accepted===true)onClose();else setMessage('打开已取消；统计快照仍保留，没有修改笔记。')}}
    catch{if(alive.current&&!ctl.signal.aborted)setError('笔记已变化或无法打开，请重新统计后重试。')}
    finally{if(alive.current&&navigation.current===ctl)setOpening(false)}
  }
  const exportNow=()=>{if(!snapshot||stale||loading)return;setError('');setMessage('');try{downloadStatisticsReport(snapshot,options,titles);setExporting(false);setMessage('已发起统计文件下载，请检查保存结果；数据库和笔记正文未修改。')}catch{setError('统计文件未能导出，快照仍保留；请重试。')}}
  const keyboard=e=>{
    if(opening)return
    e.stopPropagation()
    if(composition.current||e.isComposing||e.nativeEvent?.isComposing||e.keyCode===229)return
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();return}
    if(e.key==='Escape'){e.preventDefault();if(exporting)setExporting(false);else close();return}
    if(e.key==='Tab'){const items=focusable(exporting?panel.current.querySelector('[role=alertdialog]'):panel.current);if(!items.length){e.preventDefault();return}const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!items.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!items.includes(document.activeElement))){e.preventDefault();first.focus()}}
  }
  const t=snapshot?.totals
  return createPortal(<div className="library-statistics-overlay" data-opening={opening?'true':undefined} onMouseDown={e=>{if(e.target===e.currentTarget&&!exporting)close()}}>
    <section className="library-statistics" ref={panel} role="dialog" aria-modal="true" aria-label="本地笔记库统计" onKeyDown={keyboard} onCompositionStart={()=>{composition.current=true}} onCompositionEnd={()=>{composition.current=false}}>
      <header><div><h2>笔记库统计</h2><p>只读分析 · 保存的数据 · 一份完整快照</p></div><button type="button" aria-label="关闭笔记库统计" disabled={exporting} onClick={close}>×</button></header>
      <div className="library-statistics-scroll" aria-busy={loading}>
        {loading&&<p>正在读取本机笔记库…可以随时取消。</p>}
        {snapshot&&<><p className="statistics-caption">快照时间：{time(snapshot.captured_at)}{stale?' · 已过时':''}</p>
          <dl className="statistics-cards">{[['普通笔记',t.notes],['可检索字符',t.characters],['未分类笔记',t.notes-t.tagged],['置顶笔记',t.pinned]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{number(value)}</dd></div>)}</dl>
          <p>文件夹 {t.folders} · 模板 {t.templates} · 回收站条目 {t.trash} · 标签 {t.tags}（未使用 {t.unused_tags}）</p>
          <p className="statistics-caption">字符按搜索文本的 Unicode 字符计数，不含空白；不是分词字数。代码、公式、链接文字和图片说明按搜索规则计入，不含附件文件大小。正文存储文本共 {number(t.content_bytes)} 字节。</p>
          {t.unsupported>0&&<p className="statistics-warning">{t.unsupported} 篇正文无法解析，未计入字符总量，也不计为无文本笔记。可用“无法统计”筛选查看。</p>}
          <details><summary>最近 30 天的创建与最后修改日期分布（UTC）</summary><p>每篇笔记按创建日和当前最后修改日各计一次；不是编辑次数或完整写作历史。</p><table><thead><tr><th>日期</th><th>创建笔记</th><th>最后修改</th></tr></thead><tbody>{snapshot.activity.map(d=><tr key={d.day}><th>{d.day}</th><td>{d.created}</td><td>{d.updated}</td></tr>)}</tbody></table></details>
          <fieldset disabled={exporting||opening||stale} className="statistics-filters"><legend>查看与定位笔记</legend><label>标题查找<input aria-label="统计标题查找" value={query} maxLength={128} onChange={e=>change(setQuery,e.target.value)}/></label><label>范围<select aria-label="统计范围" value={filter} onChange={e=>change(setFilter,e.target.value)}>{[['all','全部普通笔记'],['untagged','未分类'],['pinned','已置顶'],['no-text','无可计数字符'],['unsupported','无法统计']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>排序<select aria-label="统计排序" value={sort} onChange={e=>change(setSort,e.target.value)}><option value="updated">最近修改</option><option value="characters">字符最多</option><option value="title">标题</option></select></label></fieldset>
          <p>当前筛选 {notes.length} 篇 · 第 {page+1}/{pages} 页</p>
          <div className="statistics-notes">{shown.map(n=><article key={n.id}><button type="button" disabled={exporting||opening||stale||!onOpenFile} onClick={()=>void open(n.id)}>{n.title||'未命名笔记'}</button><span>{n.text_supported?`${number(n.characters)} 字符`:'字符未统计'} · {n.tag_count} 标签{n.pinned?' · 已置顶':''}</span><small>直属位置：{n.folder} · 修改：{time(n.updated_at)}</small></article>)}</div>
          {!notes.length&&<p>没有符合条件的普通笔记。</p>}<nav aria-label="统计笔记分页"><button type="button" disabled={page===0||opening||stale||exporting} onClick={()=>setPage(p=>p-1)}>上一页</button><button type="button" disabled={page+1>=pages||opening||stale||exporting} onClick={()=>setPage(p=>p+1)}>下一页</button></nav>
        </>}
      </div>
      <div className="library-statistics-feedback" aria-label="统计操作反馈">
        {exporting&&<div role="alertdialog" aria-modal="true" aria-label="确认统计导出"><p>导出当前快照的汇总与日期分布，默认不含标题、查询词、正文或本机路径。勾选清单后附上当前查询词、标题和笔记 ID；导出后需自行妥善保管。</p><label><input type="checkbox" checked={titles} onChange={e=>setTitles(e.target.checked)}/>包含当前筛选的标题清单（{notes.length} 篇）</label><button type="button" onClick={()=>setExporting(false)}>取消导出</button><button type="button" onClick={exportNow}>确认导出</button></div>}
        {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
      </div>
      <footer><span>仅本机 · 不写入正文</span><button type="button" disabled={loading||opening||exporting} onClick={()=>void refresh()}>重新统计</button>{loading&&<button type="button" onClick={stop}>取消统计</button>}{opening&&<button type="button" onClick={()=>{navigation.current?.abort();setOpening(false);setMessage('打开已取消。')}}>取消打开</button>}<button ref={exportButton} type="button" disabled={!snapshot||loading||opening||stale||exporting} onClick={()=>{setTitles(false);setMessage('');setError('');setExporting(true)}}>导出统计</button></footer>
    </section>
  </div>,document.body)
}
