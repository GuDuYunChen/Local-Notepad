import React, {forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react'
import * as d3 from 'd3'

// A bounded layout is calculated once per dataset/viewport, not once per search
// keystroke or selection. No perpetual force timer continues behind the editor.
export default forwardRef(function LocalGraphCanvas({view,selectedId,onChoose,disabled=false},ref) {
  const host=useRef(null),svg=useRef(null),controls=useRef(null),latest=useRef({onChoose,disabled})
  latest.current={onChoose,disabled}
  const [size,setSize]=useState({width:0,height:0})
  useImperativeHandle(ref,()=>({reset:()=>controls.current?.reset(),zoomIn:()=>controls.current?.zoom(1.25),zoomOut:()=>controls.current?.zoom(.8)}),[])
  useLayoutEffect(()=>{
    const element=host.current;if(!element)return
    const measure=()=>{const rect=element.getBoundingClientRect();const width=Math.max(0,Math.floor(rect.width)),height=Math.max(0,Math.floor(rect.height));setSize(old=>old.width===width&&old.height===height?old:{width,height})}
    measure();const observer=typeof ResizeObserver==='function'?new ResizeObserver(measure):null
    observer?.observe(element);window.addEventListener('resize',measure)
    return()=>{observer?.disconnect();window.removeEventListener('resize',measure)}
  },[])
  useEffect(()=>{
    if(!svg.current||!view.nodes.length||!size.width||!size.height)return
    const {width,height}=size,root=d3.select(svg.current);root.selectAll('*').remove()
    const layer=root.append('g'),nodes=view.nodes.map(n=>({...n})),edges=view.edges.map(e=>({...e}))
    const layout=d3.forceSimulation(nodes).stop()
      .force('link',d3.forceLink(edges).id(n=>n.id).distance(100).strength(.35))
      .force('charge',d3.forceManyBody().strength(-180))
      .force('center',d3.forceCenter(width/2,height/2))
      .force('collision',d3.forceCollide(23))
    layout.tick(64)
    const zoom=d3.zoom().extent([[0,0],[width,height]]).scaleExtent([.08,5]).on('zoom',e=>layer.attr('transform',e.transform))
    root.call(zoom).on('dblclick.zoom',null)
    const lines=layer.append('g').attr('class','local-graph-edges').selectAll('path').data(edges).join('path')
      .attr('fill','none').attr('stroke','var(--ink-muted, #707780)').attr('stroke-opacity',.36)
    const item=layer.append('g').selectAll('g').data(nodes).join('g')
      .attr('class',n=>'local-graph-node'+(n.id===selectedId?' selected':''))
      .attr('data-graph-node-id',n=>n.id).attr('role','button').attr('tabindex',disabled?-1:0)
      .attr('aria-label',n=>`选择笔记：${n.label||'未命名'}`).attr('aria-pressed',n=>String(n.id===selectedId))
    item.append('circle').attr('r',n=>Math.min(15,7+Math.sqrt(n.incoming+n.outgoing)*1.8))
    item.append('text').attr('x',19).attr('y',4).text(n=>{const c=Array.from(n.label||'未命名');return c.slice(0,14).join('')+(c.length>14?'…':'')})
    item.append('title').text(n=>`${n.label||'未命名'} · 引入 ${n.incoming} / 引出 ${n.outgoing}`)
    const render=()=>{
      lines.attr('d',e=>e.source.id===e.target.id?`M${e.source.x},${e.source.y-9}a22,22 0 1,1 1,0`:`M${e.source.x},${e.source.y}L${e.target.x},${e.target.y}`)
      item.attr('transform',n=>`translate(${n.x},${n.y})`)
    }
    render()
    item.call(d3.drag().on('drag',(e,n)=>{if(latest.current.disabled)return;n.x=e.x;n.y=e.y;render()}))
    const choose=(event,n)=>{if(latest.current.disabled||event.defaultPrevented)return;event.stopPropagation();latest.current.onChoose?.(n.id)}
    item.on('click',choose).on('keydown',(event,n)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!latest.current.disabled)latest.current.onChoose?.(n.id)}})
    const reset=()=>{
      const xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y),left=Math.min(...xs)-35,right=Math.max(...xs)+125,top=Math.min(...ys)-35,bottom=Math.max(...ys)+35
      const k=Math.max(.08,Math.min(1.4,(width-30)/(right-left),(height-30)/(bottom-top)))
      root.call(zoom.transform,d3.zoomIdentity.translate(width/2,height/2).scale(k).translate(-(left+right)/2,-(top+bottom)/2))
    }
    controls.current={reset,zoom:factor=>root.call(zoom.scaleBy,factor)};reset()
    return()=>{layout.stop();controls.current=null;root.interrupt().on('.zoom',null);item.on('.drag',null).on('click',null).on('keydown',null);root.selectAll('*').remove()}
  },[view,size])
  useEffect(()=>{
    if(!svg.current)return
    d3.select(svg.current).selectAll('.local-graph-node').classed('selected',n=>n.id===selectedId).attr('aria-pressed',n=>String(n.id===selectedId)).attr('tabindex',disabled?-1:0)
  },[selectedId,disabled,view,size])
  return <div className="graph-canvas local-graph-canvas" ref={host}>
    {view.nodes.length?<svg ref={svg} className="graph-svg" width={size.width} height={size.height} role="group" aria-label="本地笔记关系图"/>:<div className="local-graph-no-matches">当前条件没有匹配笔记。清除筛选可返回完整图谱。</div>}
    <p className="local-graph-canvas-help">拖动背景平移 · 滚轮缩放 · 选择节点查看关系；也可使用右侧笔记列表。</p>
  </div>
})
