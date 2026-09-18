import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { api } from '~/services/api'
import './GraphPanel.css'

export default function GraphPanel({ onSelectFile, onClose }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const zoomRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] })
  const [query, setQuery] = useState('')
  const [viewport, setViewport] = useState({ width: 0, height: 0 })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api('/api/graph')
      setGraphData({
        nodes: res?.nodes || [],
        edges: res?.edges || [],
      })
    } catch (e) {
      console.error('加载知识图谱失败', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return undefined

    const update = () => {
      const rect = element.getBoundingClientRect()
      setViewport({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!svgRef.current || graphData.nodes.length === 0 || viewport.width === 0 || viewport.height === 0) return undefined

    const width = viewport.width
    const height = viewport.height
    const normalizedQuery = query.trim().toLowerCase()

    d3.select(svgRef.current).selectAll('*').remove()

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)

    const g = svg.append('g')
    const zoom = d3.zoom()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => g.attr('transform', event.transform))

    zoomRef.current = zoom
    svg.call(zoom)

    const linkData = graphData.edges.map(e => ({
      source: e.source,
      target: e.target,
    }))

    const nodeData = graphData.nodes.map(n => ({
      id: n.id,
      label: n.label || '未命名',
      links: n.links || 0,
    }))

    const simulation = d3.forceSimulation(nodeData)
      .force('link', d3.forceLink(linkData).id(d => d.id).distance(105).strength(0.45))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => Math.max(24, 16 + Math.min(d.links, 8) * 2)))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.04))

    const isMatch = (d) => !normalizedQuery || d.label.toLowerCase().includes(normalizedQuery)

    const link = g.append('g')
      .attr('class', 'graph-links')
      .selectAll('line')
      .data(linkData)
      .join('line')
      .attr('stroke', 'var(--border-strong)')
      .attr('stroke-opacity', normalizedQuery ? 0.22 : 0.55)
      .attr('stroke-width', 1)

    const node = g.append('g')
      .attr('class', 'graph-nodes')
      .selectAll('g')
      .data(nodeData)
      .join('g')
      .attr('class', d => `graph-node${isMatch(d) ? ' matched' : ' dimmed'}`)
      .attr('cursor', 'pointer')
      .call(d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.25).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on('drag', (event, d) => {
          d.fx = event.x
          d.fy = event.y
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null
          d.fy = null
        }))

    node.append('circle')
      .attr('r', d => Math.max(7, Math.min(17, 7 + Math.sqrt(d.links || 0) * 2.2)))
      .attr('fill', 'var(--accent)')
      .attr('fill-opacity', d => isMatch(d) ? 0.9 : 0.12)
      .attr('stroke', d => isMatch(d) ? 'var(--surface)' : 'transparent')
      .attr('stroke-width', 2)

    node.append('text')
      .text(d => d.label.length > 16 ? `${d.label.slice(0, 16)}…` : d.label)
      .attr('x', d => Math.max(7, Math.min(17, 7 + Math.sqrt(d.links || 0) * 2.2)) + 5)
      .attr('y', 4)
      .attr('font-size', '11px')
      .attr('font-weight', d => isMatch(d) && normalizedQuery ? 600 : 400)
      .attr('fill', 'var(--fg)')
      .attr('fill-opacity', d => isMatch(d) ? 0.86 : 0.16)
      .attr('pointer-events', 'none')
      .attr('class', 'graph-node-label')

    node.append('title').text(d => d.label)

    node.on('click', (event, d) => {
      event.stopPropagation()
      onSelectFile?.(d.id)
    })

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y)

      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    return () => simulation.stop()
  }, [graphData, onSelectFile, query, viewport])

  const resetView = () => {
    if (!svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomRef.current.transform, d3.zoomIdentity)
  }

  const matchCount = query.trim()
    ? graphData.nodes.filter(n => (n.label || '').toLowerCase().includes(query.trim().toLowerCase())).length
    : graphData.nodes.length

  return (
    <div className="graph-panel">
      <div className="graph-header graph-workspace-toolbar">
        <div>
          <div className="graph-workspace-eyebrow">Connections</div>
          <strong>知识关系</strong>
        </div>

        <div className="graph-header-actions">
          <div className="graph-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/>
              <path d="m20 20-4-4"/>
            </svg>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="查找节点"
              aria-label="查找图谱节点"
            />
            {query && <button onClick={() => setQuery('')} aria-label="清除搜索">×</button>}
          </div>
          <button className="btn small" onClick={resetView}>重置视图</button>
          <button className="icon-btn" onClick={loadData} title="刷新" aria-label="刷新">↻</button>
          <button className="icon-btn close-panel-btn" onClick={onClose} title="返回笔记" aria-label="返回笔记">×</button>
        </div>
      </div>

      <div className="graph-canvas" ref={containerRef}>
        {loading ? (
          <div className="placeholder">正在整理链接关系…</div>
        ) : graphData.nodes.length === 0 ? (
          <div className="empty-state graph-empty-state">
            <div className="graph-empty-mark">◎</div>
            <div className="empty-title">还没有链接关系</div>
            <div className="empty-desc">在笔记中输入 [[文件名]]，这里就会逐渐形成你的知识网络。</div>
          </div>
        ) : (
          <svg ref={svgRef} className="graph-svg" />
        )}
      </div>

      <div className="graph-stats">
        <span>{graphData.nodes.length} 个节点</span>
        <span>{graphData.edges.length} 条链接</span>
        {query.trim() && <span>{matchCount} 个匹配</span>}
        <span className="graph-stats-hint">拖拽节点 · 滚轮缩放 · 点击打开笔记</span>
      </div>
    </div>
  )
}
