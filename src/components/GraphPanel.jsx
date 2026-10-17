import React,{useEffect,useMemo,useRef,useState} from 'react'
import {api} from '~/services/api'
import LocalGraphCanvas from './LocalGraphCanvas'
import {readLocalGraph,readGraphTarget,graphQuery,graphView,graphNeighbors,GRAPH_PAGE_SIZE} from '../services/localGraph.mjs'
import './GraphPanel.css'

const EMPTY=Object.freeze({nodes:Object.freeze([]),edges:Object.freeze([])})
export default function GraphPanel({onSelectFile,onClose}) {
  const [snapshot,setSnapshot]=useState(null),[status,setStatus]=useState('loading'),[problem,setProblem]=useState(''),[notice,setNotice]=useState('')
  const [query,setQuery]=useState(''),[applied,setApplied]=useState(''),[queryValid,setQueryValid]=useState(true),[mode,setMode]=useState('all'),[focusId,setFocusId]=useState(''),[selectedId,setSelectedId]=useState(''),[page,setPage]=useState(0),[opening,setOpening]=useState(false)
  const alive=useRef(false),reader=useRef(null),opener=useRef(null),composing=useRef(false),canvas=useRef(null),panel=useRef(null),search=useRef(null),latest=useRef({onSelectFile,onClose})
  latest.current={onSelectFile,onClose}
  const cancelOpen=()=>{opener.current?.abort();opener.current=null;setOpening(false)}
  const load=async()=>{
    cancelOpen();reader.current?.abort();const ctl=new AbortController();reader.current=ctl
    setStatus('loading');setSnapshot(null);setSelectedId('');setFocusId('');setPage(0);setProblem('');setNotice('')
    try{
      const value=await readLocalGraph(api,ctl.signal)
      if(!alive.current||reader.current!==ctl||ctl.signal.aborted)return
      setSnapshot(value);setStatus('ready')
    }catch(e){if(alive.current&&reader.current===ctl&&!ctl.signal.aborted){setProblem(e.message);setStatus('error')}}
  }
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;reader.current?.abort();opener.current?.abort()}},[])
  const view=useMemo(()=>snapshot&&queryValid?graphView(snapshot,applied,mode,focusId):EMPTY,[snapshot,applied,mode,focusId,queryValid])
  const selected=snapshot?.nodes.find(n=>n.id===selectedId)||null
  const neighbors=useMemo(()=>selected?graphNeighbors(snapshot,selected.id):[],[snapshot,selected])
  const pages=Math.max(1,Math.ceil(view.nodes.length/GRAPH_PAGE_SIZE)),currentPage=Math.min(page,pages-1),rows=view.nodes.slice(currentPage*GRAPH_PAGE_SIZE,(currentPage+1)*GRAPH_PAGE_SIZE)
  const edit=(value,commit=!composing.current)=>{
    cancelOpen();setQuery(value);setNotice('')
    if(commit){setSelectedId('');setPage(0);try{const q=graphQuery(value);setApplied(q);setQueryValid(true);setProblem('')}catch(e){setQueryValid(false);setProblem(e.message)}}
  }
  const choose=id=>{if(opening||composing.current||!queryValid||!snapshot?.nodes.some(n=>n.id===id))return;setSelectedId(id);setProblem('');setNotice('')}
  const clear=()=>{cancelOpen();composing.current=false;setQueryValid(true);setQuery('');setApplied('');setMode('all');setFocusId('');setSelectedId('');setPage(0);setProblem('');setNotice('');search.current?.focus()}
  const stop=()=>{
    if(opener.current){cancelOpen();setNotice('已停止打开，当前笔记与草稿保持不变。')}
    else{reader.current?.abort();reader.current=null;setStatus('stopped');setNotice('已停止读取，重新读取可继续。')}
  }
  const close=()=>{reader.current?.abort();cancelOpen();latest.current.onClose?.()}
  const open=async()=>{
    if(!selected||status!=='ready'||opener.current||composing.current)return
    const captured=selected,ctl=new AbortController();opener.current=ctl;setOpening(true);setProblem('');setNotice('正在核对目标笔记；离开草稿时由原保存确认框决定。')
    const owns=()=>alive.current&&opener.current===ctl&&!ctl.signal.aborted
    let failure=''
    try{
      if(typeof latest.current.onSelectFile!=='function')throw Error('笔记打开通道不可用。')
      const accepted=await latest.current.onSelectFile(captured.id,{
        signal:ctl.signal,shouldSelect:owns,
        readFile:async(id,{signal})=>{try{if(id!==captured.id)throw Error('图谱笔记身份不符。');return await readGraphTarget(api,captured,signal)}catch(e){failure=e.message;throw e}},
      })
      if(!owns())return
      if(failure){setProblem(failure);setNotice('')}
      else setNotice(accepted===true?'目标笔记已打开。':'未切换笔记，当前查询、关系选择和草稿已保留。')
    }catch(e){if(owns()){setProblem(failure||e.message||'暂时无法打开，请手动重试。');setNotice('')}}
    finally{if(opener.current===ctl){opener.current=null;if(alive.current)setOpening(false)}}
  }
  const keyDown=e=>{
    if(e.key!=='Escape'||e.nativeEvent?.isComposing||composing.current||opening)return
    if(document.querySelector('[role="dialog"][aria-modal="true"]'))return
    e.preventDefault();e.stopPropagation();close()
  }
  return <section ref={panel} className="graph-panel local-graph" aria-label="本地知识图谱" onKeyDown={keyDown}>
    <header className="graph-header graph-workspace-toolbar">
      <div><strong>知识图谱</strong><span className="graph-workspace-subtitle">浏览本地笔记及已保存的引用索引。</span></div>
      <div className="graph-header-actions"><button type="button" className="btn small" disabled={status==='loading'||opening} onClick={()=>void load()}>刷新图谱</button><button type="button" className="btn small" aria-label="返回笔记" onClick={close}>返回笔记</button></div>
    </header>
    <p className="local-graph-explanation">这里只读可用普通笔记与引用索引，不包含回收站、目录和模板，不改正文或重建引用。未保存、未完成索引的链接可能尚未显示。</p>
    {problem&&<div className="local-graph-feedback error" role="alert">{problem}</div>}
    {notice&&<div className="local-graph-feedback" role="status">{notice}</div>}
    {(status==='loading'||opening)&&<button type="button" className="btn small local-graph-stop" onClick={stop}>{opening?'停止打开笔记':'停止读取图谱'}</button>}
    {status==='loading'&&<p className="local-graph-state" role="status">正在读取完整本地图谱…</p>}
    {(status==='error'||status==='stopped')&&<div className="local-graph-state"><button type="button" className="btn" onClick={()=>void load()}>重新读取图谱</button></div>}
    {status==='ready'&&snapshot&&<>
      <div className="local-graph-tools">
        <label>查找笔记<input ref={search} aria-label="搜索知识图谱中的笔记" value={query} disabled={opening} placeholder="按标题查找"
          onCompositionStart={()=>{composing.current=true;cancelOpen()}} onCompositionEnd={e=>{composing.current=false;edit(e.currentTarget.value,true)}} onChange={e=>edit(e.target.value)}/></label>
        <label>关系范围<select aria-label="图谱关系范围" value={mode} disabled={opening} onChange={e=>{cancelOpen();setMode(e.target.value);setPage(0);setSelectedId('')}}><option value="all">全部笔记</option><option value="connected">有关联笔记</option><option value="isolated">暂无关联笔记</option></select></label>
        <button type="button" className="btn small" disabled={opening} onClick={clear}>清除筛选</button>
        <div className="local-graph-zoom"><button type="button" className="btn small" disabled={!view.nodes.length} onClick={()=>canvas.current?.zoomOut()} aria-label="缩小图谱">－</button><button type="button" className="btn small" disabled={!view.nodes.length} onClick={()=>canvas.current?.zoomIn()} aria-label="放大图谱">＋</button><button type="button" className="btn small" disabled={!view.nodes.length} onClick={()=>canvas.current?.reset()}>重置视图</button></div>
      </div>
      <div className="graph-stats local-graph-stats" role="status"><span>{snapshot.nodes.length} 篇可用笔记</span><span>{snapshot.edges.length} 条有向关联</span><span>{view.nodes.length} 个匹配结果</span><span>当前视图 {view.edges.length} 条关联</span>{focusId&&<strong>聚焦一跳关系</strong>}</div>
      {!snapshot.nodes.length?<div className="local-graph-state"><h3>还没有可用笔记</h3><p>返回笔记创建内容；保存 Wiki 引用后可刷新查看关联。浏览图谱不会自动创建笔记。</p></div>:<div className="local-graph-body">
        <LocalGraphCanvas ref={canvas} view={view} selectedId={selectedId} onChoose={choose} disabled={opening}/>
        <aside className="local-graph-sidebar" aria-label="图谱笔记与关系">
          <h3>笔记列表</h3><p className="local-graph-muted">点击只选择；打开前会核对最新笔记。</p>
          <div className="local-graph-note-list" role="list" aria-label="图谱笔记列表">{rows.map(n=><div role="listitem" key={n.id}><button type="button" data-graph-note-id={n.id} disabled={opening} aria-pressed={selectedId===n.id} onClick={()=>choose(n.id)}><strong>{n.label||'未命名'}</strong><span>引入 {n.incoming} · 引出 {n.outgoing}</span></button></div>)}{!rows.length&&<p>没有匹配笔记。清除筛选可恢复列表。</p>}</div>
          {pages>1&&<nav className="local-graph-pages" aria-label="图谱笔记分页"><button type="button" disabled={opening||currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {pages}</span><button type="button" disabled={opening||currentPage+1===pages} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}
          {selected&&<section className="local-graph-detail" aria-label="选中笔记关系"><h3>{selected.label||'未命名'}</h3><button type="button" className="btn primary" disabled={opening||composing.current} onClick={()=>void open()}>打开选中笔记</button><button type="button" className="btn small" disabled={opening} onClick={()=>{setFocusId(selected.id);setQuery('');setApplied('');setMode('all');setPage(0);setNotice('');setProblem('')}}>查看一跳关联</button><p className="local-graph-muted">引入 {selected.incoming} · 引出 {selected.outgoing}。有向关联按笔记对计数，不是正文中的出现次数。</p>
            {neighbors.length?<ul className="local-graph-neighbors">{neighbors.map(({node,incoming,outgoing})=><li key={node.id}><button type="button" disabled={opening} onClick={()=>choose(node.id)}>{node.id===selected.id?'自身引用':incoming&&outgoing?'互相引用':outgoing?'引用了':'被引用'}：{node.label||'未命名'}</button></li>)}</ul>:<p>这篇笔记暂无可用的引用关联。</p>}
          </section>}
        </aside>
      </div>}
    </>}
    <footer className="local-graph-footer">完整读取上限：800篇笔记、4000条关联、2MiB元数据。超限明确拒绝，不将部分图谱当完整结果。</footer>
  </section>
}
