import { boundedQuickRead, readQuickTarget } from './quickSwitcher.mjs'
export const GRAPH_NODE_LIMIT = 800
export const GRAPH_EDGE_LIMIT = 4000
export const GRAPH_PAGE_SIZE = 20
export const GRAPH_LIMIT_MESSAGE = '图谱超过完整读取上限（800篇笔记、4000条关联或2MiB元数据），未返回部分图谱'
export class GraphError extends Error {
  constructor(code, message) { super(message); this.name = 'GraphError'; this.code = code }
}
const fail = (code, message) => { throw new GraphError(code, message) }
const bytes = value => new TextEncoder().encode(value).length
const validID = id => typeof id === 'string' && id.length > 0 && bytes(id) <= 512 && !/[\u0000-\u001f\u007f]/.test(id) && !Array.from(id).some(c => c.codePointAt(0) >= 0xd800 && c.codePointAt(0) <= 0xdfff)
export function graphQuery(value) {
  if (typeof value !== 'string' || Array.from(value).length > 100 || /[\u0000-\u001f\u007f]/.test(value)) fail('query', '查找词最多100个字符，不能包含控制字符。')
  return value.trim()
}
export function validateLocalGraph(value) {
  if (!value || value.scope !== 'active-note-index-v1' || value.complete !== true || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) fail('invalid', '图谱数据不完整，未采用这份结果。请重新读取。')
  if (value.nodes.length > GRAPH_NODE_LIMIT || value.edges.length > GRAPH_EDGE_LIMIT) fail('limit', GRAPH_LIMIT_MESSAGE)
  const nodes = [], edges = [], index = new Map(), pairs = new Set(); let size = 0
  for (const n of value.nodes) {
    if (!n || !validID(n.id) || index.has(n.id) || typeof n.label !== 'string' || n.label.startsWith('__tpl__') || !Number.isSafeInteger(n.updated_at) || n.updated_at < 0 || !Number.isSafeInteger(n.incoming) || n.incoming < 0 || !Number.isSafeInteger(n.outgoing) || n.outgoing < 0)
      fail('invalid', '图谱笔记身份或计数无效，未采用这份结果。')
    size += bytes(n.id) + bytes(n.label) + 64
    if (bytes(n.label) > 16384 || size > 2 * 1024 * 1024) fail('limit', GRAPH_LIMIT_MESSAGE)
    const copy = { id:n.id, label:n.label, updated_at:n.updated_at, incoming:n.incoming, outgoing:n.outgoing }
    index.set(n.id, { node:copy, incoming:0, outgoing:0 }); nodes.push(copy)
  }
  for (const e of value.edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string' || !index.has(e.source) || !index.has(e.target)) fail('invalid', '图谱包含无法对应笔记的关联，未绘制不完整图谱。')
    const key = JSON.stringify([e.source,e.target])
    if (pairs.has(key)) fail('invalid', '图谱存在重复关联，未采用这份结果。')
    pairs.add(key); index.get(e.source).outgoing++; index.get(e.target).incoming++
    size += bytes(e.source) + bytes(e.target) + 32
    if (size > 2 * 1024 * 1024) fail('limit', GRAPH_LIMIT_MESSAGE)
    edges.push(Object.freeze({source:e.source,target:e.target}))
  }
  for (const entry of index.values()) {
    if (entry.node.incoming !== entry.incoming || entry.node.outgoing !== entry.outgoing) fail('invalid','图谱计数与实际关联不一致，请重新读取。')
    Object.freeze(entry.node)
  }
  const result = {scope:value.scope,complete:true,nodes:Object.freeze(nodes),edges:Object.freeze(edges)}
  if (bytes(JSON.stringify(result)) > 2 * 1024 * 1024) fail('limit',GRAPH_LIMIT_MESSAGE)
  return Object.freeze(result)
}
export async function readLocalGraph(api, signal, timeout) {
  const response = await boundedQuickRead(async s => {
    try { return {value:await api('/api/local-graph',{signal:s})} }
    catch (e) { if (e?.message === GRAPH_LIMIT_MESSAGE) return {limited:true}; throw e }
  },signal,timeout)
  if (response.limited) fail('limit',GRAPH_LIMIT_MESSAGE)
  return validateLocalGraph(response.value)
}
export function graphView(snapshot, query = '', mode = 'all', focusId = '') {
  const q = graphQuery(query).toLocaleLowerCase()
  if (!['all','connected','isolated'].includes(mode)) fail('view','图谱筛选条件无效。')
  let neighbors = null
  if (focusId) {
    if (!snapshot.nodes.some(n=>n.id===focusId)) fail('view','聚焦笔记已不在图谱中，请刷新。')
    neighbors = new Set([focusId])
    for (const e of snapshot.edges) { if(e.source===focusId) neighbors.add(e.target); if(e.target===focusId) neighbors.add(e.source) }
  }
  const nodes = snapshot.nodes.filter(n => (!q || n.label.toLocaleLowerCase().includes(q)) && (!neighbors || neighbors.has(n.id)) && (mode==='all'||(mode==='connected')===(n.incoming+n.outgoing>0)))
    .sort((a,b)=>(b.incoming+b.outgoing)-(a.incoming+a.outgoing)||a.label.localeCompare(b.label,'zh-CN')||a.id.localeCompare(b.id))
  const ids = new Set(nodes.map(n=>n.id))
  return {nodes,edges:snapshot.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))}
}
export function graphNeighbors(snapshot,id) {
  const map = new Map(snapshot.nodes.map(n=>[n.id,n])), related = new Map()
  for(const e of snapshot.edges) {
    if(e.source!==id&&e.target!==id)continue
    const other=e.source===id?e.target:e.source
    if(!related.has(other))related.set(other,{node:map.get(other),incoming:false,outgoing:false})
    if(e.source===id)related.get(other).outgoing=true
    if(e.target===id)related.get(other).incoming=true
  }
  return [...related.values()].sort((a,b)=>a.node.label.localeCompare(b.node.label,'zh-CN')||a.node.id.localeCompare(b.node.id))
}
export async function readGraphTarget(api,node,signal,timeout) {
  if (!node || !validID(node.id) || typeof node.label !== 'string') fail('target','选中笔记身份无效。')
  const file = await readQuickTarget(api,node.id,signal,timeout)
  if(file.title !== node.label) fail('changed','目标笔记已经更名，请刷新图谱后再打开。')
  // Graphs preview metadata, not old bodies; opening uses this current body and
  // the original App save/discard/cancel decision, never the graph's old row.
  return file
}
