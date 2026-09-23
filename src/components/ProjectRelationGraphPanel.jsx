import React, { useMemo, useState } from 'react'
import { toast } from '~/services/toast'
import {
  buildProjectRelationGraph,
  buildProjectRelationLayout,
  filterProjectRelationGraph,
  getProjectRelationEntityTypes,
  getProjectRelationTypes,
} from './projectRelationsUtils'
import './ProjectRelationGraphPanel.css'

function typeLabel(types, value) {
  return types.find(item => item.id === value)?.label || value
}

export default function ProjectRelationGraphPanel({
  projectIndexes,
  projectMeta,
  onMetaChange,
  onOpenFile,
}) {
  const [query, setQuery] = useState('')
  const [entityType, setEntityType] = useState('all')
  const [relationType, setRelationType] = useState('all')
  const [focusId, setFocusId] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [selectedRelationId, setSelectedRelationId] = useState('')

  const [entityLabel, setEntityLabel] = useState('')
  const [entityKind, setEntityKind] = useState('faction')
  const [entityDescription, setEntityDescription] = useState('')

  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [newRelationType, setNewRelationType] = useState('related')
  const [relationDirected, setRelationDirected] = useState(false)
  const [relationLabel, setRelationLabel] = useState('')
  const [relationNote, setRelationNote] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const entityTypes = useMemo(() => getProjectRelationEntityTypes(), [])
  const relationTypes = useMemo(() => getProjectRelationTypes(), [])

  const graph = useMemo(
    () => buildProjectRelationGraph(projectIndexes, projectMeta),
    [projectIndexes, projectMeta],
  )
  const filtered = useMemo(
    () => filterProjectRelationGraph(graph, {
      query,
      entityType,
      relationType,
      focusId,
    }),
    [entityType, focusId, graph, query, relationType],
  )
  const layout = useMemo(
    () => buildProjectRelationLayout(filtered, 960, 500),
    [filtered],
  )

  const selectedNode = graph.nodeById.get(selectedNodeId) || null
  const selectedRelation = graph.edges.find(edge => (
    edge.id === selectedRelationId
  )) || null
  const filterActive = Boolean(
    query.trim() ||
    entityType !== 'all' ||
    relationType !== 'all' ||
    focusId
  )

  const updateRelationMeta = patch => {
    onMetaChange?.(previous => ({
      ...previous,
      ...patch(previous),
    }))
  }

  const createEntity = () => {
    const label = entityLabel.trim()
    if (!label) {
      toast.error('请输入实体名称')
      return
    }

    const id = 'entity-' + Date.now().toString(36) + '-' +
      ((projectMeta?.relationEntities?.length || 0) + 1)
    updateRelationMeta(previous => ({
      relationEntities: [
        ...(previous.relationEntities || []),
        {
          id,
          label,
          type: entityKind,
          description: entityDescription.trim(),
          noteId: '',
        },
      ],
    }))
    setEntityLabel('')
    setEntityDescription('')
    setSelectedNodeId(id)
  }

  const createRelation = () => {
    if (!sourceId || !targetId) {
      toast.error('请选择关系两端实体')
      return
    }
    if (sourceId === targetId) {
      toast.error('关系两端不能是同一个实体')
      return
    }

    const existing = (projectMeta?.relations || []).find(item => (
      item.sourceId === sourceId &&
      item.targetId === targetId &&
      item.type === newRelationType
    ))
    if (existing) {
      toast.error('相同方向和类型的关系已经存在')
      return
    }

    const id = 'relation-' + Date.now().toString(36) + '-' +
      ((projectMeta?.relations?.length || 0) + 1)
    updateRelationMeta(previous => ({
      relations: [
        ...(previous.relations || []),
        {
          id,
          sourceId,
          targetId,
          type: newRelationType,
          directed: relationDirected,
          label: relationLabel.trim(),
          note: relationNote.trim(),
        },
      ],
    }))
    setRelationLabel('')
    setRelationNote('')
    setSelectedRelationId(id)
  }

  const removeRelation = relationId => {
    if (!relationId) return
    updateRelationMeta(previous => ({
      relations: (previous.relations || []).filter(item => (
        item.id !== relationId
      )),
    }))
    if (selectedRelationId === relationId) setSelectedRelationId('')
    setDeleteConfirm('')
  }

  const removeCustomEntity = entityId => {
    if (!entityId) return
    if (deleteConfirm !== entityId) {
      setDeleteConfirm(entityId)
      return
    }

    updateRelationMeta(previous => ({
      relationEntities: (previous.relationEntities || []).filter(item => (
        item.id !== entityId
      )),
      relations: (previous.relations || []).filter(item => (
        item.sourceId !== entityId && item.targetId !== entityId
      )),
    }))
    if (selectedNodeId === entityId) setSelectedNodeId('')
    if (focusId === entityId) setFocusId('')
    setDeleteConfirm('')
  }

  const connectedRelations = selectedNode
    ? graph.edges.filter(edge => (
      edge.sourceId === selectedNode.id ||
      edge.targetId === selectedNode.id
    ))
    : []

  const relationTypeConfig = relationTypes.find(item => (
    item.id === newRelationType
  ))

  return (
    <section className="project-relation-panel" aria-label="项目实体关系图">
      <header className="project-relation-head">
        <div>
          <strong>实体关系图</strong>
          <span>
            用人物、地点、伏笔及自定义势力 / 器物 / 概念建立项目级关系网络。
          </span>
        </div>
        <div className="project-relation-metrics">
          <span><b>{graph.totals.nodes}</b>实体</span>
          <span><b>{graph.totals.edges}</b>关系</span>
          <span><b>{graph.totals.components}</b>连通组</span>
          <span><b>{graph.totals.isolated}</b>孤立节点</span>
        </div>
      </header>

      <div className="project-relation-controls">
        <div className="project-relation-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索实体"
            aria-label="搜索实体关系图"
          />
        </div>
        <select
          value={entityType}
          onChange={event => setEntityType(event.target.value)}
          aria-label="关系图实体类型筛选"
        >
          <option value="all">全部实体</option>
          {entityTypes.map(item => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <select
          value={relationType}
          onChange={event => setRelationType(event.target.value)}
          aria-label="关系图关系类型筛选"
        >
          <option value="all">全部关系</option>
          {relationTypes.map(item => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <span className="project-relation-visible">
          {filtered.nodes.length} 节点 · {filtered.edges.length} 关系
        </span>
        {filterActive && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setQuery('')
              setEntityType('all')
              setRelationType('all')
              setFocusId('')
            }}
          >
            清除筛选
          </button>
        )}
      </div>

      <div className="project-relation-create-grid">
        <article>
          <header>
            <strong>补充世界观实体</strong>
            <span>适合势力、器物、概念等不一定需要独立笔记的节点。</span>
          </header>
          <div>
            <select
              value={entityKind}
              onChange={event => setEntityKind(event.target.value)}
              aria-label="自定义实体类型"
            >
              {entityTypes.map(item => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
            <input
              value={entityLabel}
              onChange={event => setEntityLabel(event.target.value)}
              placeholder="实体名称"
              aria-label="自定义实体名称"
            />
            <input
              value={entityDescription}
              onChange={event => setEntityDescription(event.target.value)}
              placeholder="一句说明（可选）"
              aria-label="自定义实体说明"
            />
            <button
              type="button"
              className="btn small primary"
              onClick={createEntity}
            >
              添加实体
            </button>
          </div>
        </article>

        <article>
          <header>
            <strong>建立关系</strong>
            <span>方向箭头从左侧实体指向右侧实体。</span>
          </header>
          <div>
            <select
              value={sourceId}
              onChange={event => setSourceId(event.target.value)}
              aria-label="关系源实体"
            >
              <option value="">选择起点</option>
              {graph.nodes.map(node => (
                <option key={node.id} value={node.id}>
                  {node.label} · {typeLabel(entityTypes, node.type)}
                </option>
              ))}
            </select>
            <select
              value={newRelationType}
              onChange={event => {
                const value = event.target.value
                setNewRelationType(value)
                const next = relationTypes.find(item => item.id === value)
                setRelationDirected(Boolean(next?.directed))
              }}
              aria-label="新建关系类型"
            >
              {relationTypes.map(item => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
            <select
              value={targetId}
              onChange={event => setTargetId(event.target.value)}
              aria-label="关系目标实体"
            >
              <option value="">选择终点</option>
              {graph.nodes.map(node => (
                <option key={node.id} value={node.id}>
                  {node.label} · {typeLabel(entityTypes, node.type)}
                </option>
              ))}
            </select>
            <label className="project-relation-direction">
              <input
                type="checkbox"
                checked={relationDirected}
                onChange={event => setRelationDirected(event.target.checked)}
              />
              <span>{relationDirected ? '有方向' : '双向'}</span>
            </label>
            <input
              value={relationLabel}
              onChange={event => setRelationLabel(event.target.value)}
              placeholder={relationTypeConfig?.label || '关系标签'}
              aria-label="自定义关系标签"
            />
            <input
              value={relationNote}
              onChange={event => setRelationNote(event.target.value)}
              placeholder="关系说明（可选）"
              aria-label="关系说明"
            />
            <button
              type="button"
              className="btn small primary"
              onClick={createRelation}
              disabled={!graph.nodes.length}
            >
              添加关系
            </button>
          </div>
        </article>
      </div>

      {(graph.signals.orphanEdges > 0 ||
        graph.signals.duplicateEdges > 0 ||
        graph.totals.isolated > 0) && (
        <div className="project-relation-signals">
          {graph.signals.orphanEdges > 0 && (
            <span><b>{graph.signals.orphanEdges}</b> 条关系引用了已不存在实体</span>
          )}
          {graph.signals.duplicateEdges > 0 && (
            <span><b>{graph.signals.duplicateEdges}</b> 条关系结构重复</span>
          )}
          {graph.totals.isolated > 0 && (
            <span><b>{graph.totals.isolated}</b> 个实体尚未建立关系</span>
          )}
        </div>
      )}

      <div className="project-relation-workspace">
        <div className="project-relation-canvas">
          {layout.nodes.length ? (
            <svg
              viewBox={'0 0 ' + layout.width + ' ' + layout.height}
              role="img"
              aria-label="实体关系网络"
            >
              <defs>
                <marker
                  id="project-relation-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>

              <g className="project-relation-edges">
                {layout.edges.map(edge => {
                  const midX = (edge.source.x + edge.target.x) / 2
                  const midY = (edge.source.y + edge.target.y) / 2
                  return (
                    <g
                      key={edge.id}
                      className={
                        'type-' + edge.type +
                        (selectedRelationId === edge.id ? ' selected' : '')
                      }
                      onClick={() => {
                        setSelectedRelationId(edge.id)
                        setSelectedNodeId('')
                        setDeleteConfirm('')
                      }}
                    >
                      <line
                        x1={edge.source.x}
                        y1={edge.source.y}
                        x2={edge.target.x}
                        y2={edge.target.y}
                        markerEnd={edge.directed ? 'url(#project-relation-arrow)' : undefined}
                      />
                      <text x={midX} y={midY - 4}>
                        {edge.label || edge.typeLabel}
                      </text>
                    </g>
                  )
                })}
              </g>

              <g className="project-relation-nodes">
                {layout.nodes.map(node => (
                  <g
                    key={node.id}
                    className={
                      'project-relation-node type-' + node.type +
                      (selectedNodeId === node.id ? ' selected' : '') +
                      (focusId === node.id ? ' focused' : '')
                    }
                    transform={'translate(' + node.x + ',' + node.y + ')'}
                    role="button"
                    tabIndex="0"
                    onClick={() => {
                      setSelectedNodeId(node.id)
                      setSelectedRelationId('')
                      setDeleteConfirm('')
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedNodeId(node.id)
                        setSelectedRelationId('')
                      }
                    }}
                  >
                    <circle r={Math.max(20, Math.min(30, 20 + node.degree * 2))} />
                    <text y="4">{node.label.slice(0, 8)}</text>
                    <title>
                      {node.label + ' · ' + typeLabel(entityTypes, node.type)}
                    </title>
                  </g>
                ))}
              </g>
            </svg>
          ) : (
            <div className="project-relation-empty">
              当前筛选下没有实体。先给人物 / 地点 / 伏笔建立索引，或添加自定义世界观实体。
            </div>
          )}
        </div>

        <aside className="project-relation-detail">
          {selectedNode ? (
            <>
              <header>
                <div>
                  <span>{typeLabel(entityTypes, selectedNode.type)}</span>
                  <strong>{selectedNode.label}</strong>
                  <small>{selectedNode.degree} 条关系</small>
                </div>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => setFocusId(
                    focusId === selectedNode.id ? '' : selectedNode.id
                  )}
                >
                  {focusId === selectedNode.id ? '显示全部' : '只看相邻'}
                </button>
              </header>

              {selectedNode.description && (
                <p>{selectedNode.description}</p>
              )}

              {selectedNode.noteId && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => onOpenFile?.(selectedNode.noteId)}
                >
                  打开关联笔记
                </button>
              )}

              <div className="project-relation-neighbors">
                {connectedRelations.map(edge => {
                  const otherId = edge.sourceId === selectedNode.id
                    ? edge.targetId
                    : edge.sourceId
                  const other = graph.nodeById.get(otherId)
                  if (!other) return null
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(other.id)
                        setSelectedRelationId(edge.id)
                      }}
                    >
                      <span>{edge.label || edge.typeLabel}</span>
                      <strong>{other.label}</strong>
                    </button>
                  )
                })}
                {!connectedRelations.length && <em>暂无关联实体</em>}
              </div>

              {selectedNode.source === 'custom' && (
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() => removeCustomEntity(selectedNode.id)}
                >
                  {deleteConfirm === selectedNode.id
                    ? '确认删除实体及关系'
                    : '删除自定义实体'}
                </button>
              )}
            </>
          ) : selectedRelation ? (
            <>
              <header>
                <div>
                  <span>{selectedRelation.typeLabel}</span>
                  <strong>
                    {selectedRelation.source.label}
                    {selectedRelation.directed ? ' → ' : ' ↔ '}
                    {selectedRelation.target.label}
                  </strong>
                </div>
              </header>
              {selectedRelation.label && <p>{selectedRelation.label}</p>}
              {selectedRelation.note && <p>{selectedRelation.note}</p>}
              <button
                type="button"
                className="btn small danger"
                onClick={() => removeRelation(selectedRelation.id)}
              >
                删除关系
              </button>
            </>
          ) : (
            <div className="project-relation-detail-empty">
              点击图中的实体查看邻接关系；点击连线查看关系说明。
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
