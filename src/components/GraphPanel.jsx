import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { api } from '~/services/api'
import './GraphPanel.css'

export default function GraphPanel({ onSelectFile, onClose }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] })
  const simulationRef = useRef(null)

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
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!svgRef.current || !graphData.nodes || graphData.nodes.length === 0) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    d3.select(svgRef.current).selectAll('*').remove()

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)

    const g = svg.append('g')

    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)

    const linkData = graphData.edges.map(e => ({
      source: e.source,
      target: e.target,
    }))

    const nodeData = graphData.nodes.map(n => ({
      id: n.id,
      label: n.label,
      links: n.links,
    }))

    const simulation = d3.forceSimulation(nodeData)
      .force('link', d3.forceLink(linkData).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05))

    simulationRef.current = simulation

    const link = g.append('g')
      .attr('class', 'graph-links')
      .selectAll('line')
      .data(linkData)
      .join('line')
      .attr('stroke', 'var(--muted)')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1.5)

    const node = g.append('g')
      .attr('class', 'graph-nodes')
      .selectAll('g')
      .data(nodeData)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded))

    node.append('circle')
      .attr('r', d => Math.max(8, Math.min(20, 4 + d.links * 3)))
      .attr('fill', d => {
        const hue = (d.links * 30) % 360
        return `hsl(${hue}, 60%, 55%)`
      })
      .attr('stroke', 'var(--panel)')
      .attr('stroke-width', 2)

    node.append('text')
      .text(d => d.label.length > 10 ? d.label.slice(0, 10) + '...' : d.label)
      .attr('x', d => Math.max(8, Math.min(20, 4 + d.links * 3)) + 4)
      .attr('y', 4)
      .attr('font-size', '11px')
      .attr('fill', 'var(--fg)')
      .attr('pointer-events', 'none')
      .attr('class', 'graph-node-label')

    node.on('click', (event, d) => {
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

    function dragStarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart()
      d.fx = d.x
      d.fy = d.y
    }

    function dragged(event, d) {
      d.fx = event.x
      d.fy = event.y
    }

    function dragEnded(event, d) {
      if (!event.active) simulation.alphaTarget(0)
      d.fx = null
      d.fy = null
    }

    return () => {
      simulation.stop()
    }
  }, [graphData, onSelectFile])

  return (
    <div className="graph-panel" ref={containerRef}>
      <div className="graph-header">
        <span>知识图谱</span>
        <div className="graph-header-actions">
          <button className="btn small" onClick={loadData} title="刷新">↻</button>
          <button className="btn small close-panel-btn" onClick={onClose} title="关闭">×</button>
        </div>
      </div>
      {loading ? (
        <div className="placeholder">加载中…</div>
      ) : (graphData.nodes?.length || 0) === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🕸️</div>
          <div className="empty-title">暂无链接关系</div>
          <div className="empty-desc">使用 [[文件名]] 语法创建双向链接</div>
        </div>
      ) : (
        <svg ref={svgRef} className="graph-svg" />
      )}
      <div className="graph-stats">
        <span>{graphData.nodes?.length || 0} 个节点</span>
        <span>{graphData.edges?.length || 0} 条链接</span>
      </div>
    </div>
  )
}
