import React, { useMemo, useState } from 'react'
import { toast } from '~/services/toast'
import {
  buildLongFormStructure,
  mergeStructureSectionWithPrevious,
  moveStructureSection,
  moveStructureSectionAdjacent,
} from './Editor/utils/structureUtils'
import './LongFormStructurePanel.css'

function typeLabel(level) {
  if (level === 1) return '卷'
  if (level === 2) return '章'
  if (level === 3) return '场'
  return 'H' + level
}

function flattenTree(nodes, out = []) {
  for (const node of nodes || []) {
    out.push(node)
    flattenTree(node.children, out)
  }
  return out
}

export default function LongFormStructurePanel({
  content,
  onApplyDraft,
  onExtractSection,
  busy = false,
}) {
  const structure = useMemo(
    () => buildLongFormStructure(content),
    [content]
  )
  const [draggingId, setDraggingId] = useState('')
  const [dropTarget, setDropTarget] = useState(null)
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  const flat = useMemo(
    () => flattenTree(structure.roots),
    [structure.roots]
  )

  const applyMove = (sectionId, direction) => {
    if (busy) return
    const result = moveStructureSectionAdjacent(content, sectionId, direction)
    if (!result.changed) return
    onApplyDraft?.(result.content, {
      sectionPathMappings: [],
      reason: 'reorder',
    })
  }

  const applyDragMove = (sourceId, targetId, position) => {
    if (busy || !sourceId || !targetId || sourceId === targetId) return

    const result = moveStructureSection(
      content,
      sourceId,
      targetId,
      position,
    )

    if (!result.changed) {
      toast.warning('只能在同一父级内调整同级章节顺序')
      return
    }

    onApplyDraft?.(result.content, {
      sectionPathMappings: [],
      reason: 'reorder',
    })
  }

  const mergePrevious = section => {
    if (busy) return
    const result = mergeStructureSectionWithPrevious(content, section.id)
    if (!result.changed) {
      toast.warning('当前章节前面没有可合并的同级章节')
      return
    }

    onApplyDraft?.(result.content, {
      sectionPathMappings: result.mappings,
      reason: 'merge',
    })

    toast.success('已合并到“' + result.previous.text + '”，保存时会检查引用影响')
  }

  const siblingsFor = section => flat.filter(item => (
    item.level === section.level &&
    item.parentId === section.parentId
  ))

  const renderNode = (section, depth = 0) => {
    const siblings = siblingsFor(section)
    const siblingIndex = siblings.findIndex(item => item.id === section.id)
    const hasChildren = section.children?.length > 0
    const expanded = expandedIds.has(section.id)
    const isDragging = draggingId === section.id
    const isDropTarget = dropTarget?.id === section.id

    return (
      <React.Fragment key={section.id}>
        <div
          className={
            'long-structure-row' +
            (isDragging ? ' dragging' : '') +
            (isDropTarget ? ' drop-target ' + dropTarget.position : '')
          }
          style={{ '--structure-depth': depth }}
          draggable={!busy}
          onDragStart={event => {
            if (busy) {
              event.preventDefault()
              return
            }
            setDraggingId(section.id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', section.id)
          }}
          onDragEnd={() => {
            setDraggingId('')
            setDropTarget(null)
          }}
          onDragOver={event => {
            if (!draggingId || draggingId === section.id) return
            event.preventDefault()

            const rect = event.currentTarget.getBoundingClientRect()
            const position = event.clientY < rect.top + rect.height / 2
              ? 'before'
              : 'after'

            setDropTarget({
              id: section.id,
              position,
            })
          }}
          onDrop={event => {
            event.preventDefault()
            const sourceId = draggingId || event.dataTransfer.getData('text/plain')
            const position = dropTarget?.id === section.id
              ? dropTarget.position
              : 'before'
            setDraggingId('')
            setDropTarget(null)
            applyDragMove(sourceId, section.id, position)
          }}
        >
          <div
            className="long-structure-indent"
            style={{ width: String(depth * 13) + 'px' }}
          />

          <button
            type="button"
            className="long-structure-expand"
            disabled={!hasChildren}
            onClick={() => {
              if (!hasChildren) return
              setExpandedIds(previous => {
                const next = new Set(previous)
                if (next.has(section.id)) next.delete(section.id)
                else next.add(section.id)
                return next
              })
            }}
            aria-label={expanded ? '收起子章节' : '展开子章节'}
          >
            {hasChildren ? (expanded ? '⌄' : '›') : '·'}
          </button>

          <span className={'long-structure-kind level-' + section.level}>
            {typeLabel(section.level)}
          </span>

          <div className="long-structure-copy" title={section.path.join(' › ')}>
            <strong>{section.text}</strong>
            <small>{section.path.join(' › ')}</small>
          </div>

          <div className="long-structure-actions">
            <button
              type="button"
              disabled={busy || siblingIndex <= 0}
              onClick={() => applyMove(section.id, 'up')}
              title="上移"
              aria-label={'上移 ' + section.text}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={busy || siblingIndex < 0 || siblingIndex >= siblings.length - 1}
              onClick={() => applyMove(section.id, 'down')}
              title="下移"
              aria-label={'下移 ' + section.text}
            >
              ↓
            </button>
            <button
              type="button"
              disabled={busy || siblingIndex <= 0}
              onClick={() => mergePrevious(section)}
              title="合并到上一个同级章节"
            >
              合
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onExtractSection?.(section)}
              title="拆出为独立笔记"
            >
              拆
            </button>
          </div>
        </div>

        {hasChildren && expanded && (
          <div className="long-structure-children">
            {section.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </React.Fragment>
    )
  }

  if (!structure.valid) {
    return (
      <div className="long-structure-empty">
        当前正文无法解析为结构化文档。
      </div>
    )
  }

  if (!structure.sections.length) {
    return (
      <div className="long-structure-empty">
        <strong>还没有章节结构</strong>
        <span>使用 H1 / H2 / H3 标题后，这里会按卷 / 章 / 场显示结构。</span>
      </div>
    )
  }

  return (
    <div className="long-structure-panel">
      <div className="long-structure-summary">
        <div><span>卷</span><strong>{structure.counts.volumes}</strong></div>
        <div><span>章</span><strong>{structure.counts.chapters}</strong></div>
        <div><span>场</span><strong>{structure.counts.scenes}</strong></div>
        <div><span>标题</span><strong>{structure.counts.headings}</strong></div>
      </div>

      <div className="long-structure-help">
        <span>拖动只调整同一父级下的同级章节。</span>
        <span>“合”会移除当前标题并并入上一节；“拆”会拆成独立笔记。</span>
      </div>

      <div className="long-structure-tree">
        {structure.roots.map(section => renderNode(section))}
      </div>
    </div>
  )
}
