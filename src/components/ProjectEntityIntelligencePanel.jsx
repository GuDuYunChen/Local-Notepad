import React, { useEffect, useMemo, useState } from 'react'
import { toast } from '~/services/toast'
import { buildProjectEntityIntelligence } from './projectEntityIntelligenceUtils'
import { getProjectRelationEntityTypes } from './projectRelationsUtils'
import {
  entityTermKey,
  getProjectEntityAliasError,
  normalizeEntityTerm,
  normalizeProjectEntityAliases,
} from './projectEntityMentionUtils'
import ProjectEntityEvidencePanel from './ProjectEntityEvidencePanel'
import './ProjectEntityIntelligencePanel.css'

function stripExtension(value) {
  return String(value || '未命名').replace(/\.[^.]+$/, '')
}

export default function ProjectEntityIntelligencePanel({
  workspace,
  projectIndexes,
  projectMeta,
  onMetaChange,
  onOpenFile,
}) {
  const [selectedEntityId, setSelectedEntityId] = useState('')
  const [aliasDraft, setAliasDraft] = useState('')
  const [heatmapLimit, setHeatmapLimit] = useState(12)

  const entityTypes = useMemo(() => getProjectRelationEntityTypes(), [])
  const intelligence = useMemo(
    () => buildProjectEntityIntelligence(
      workspace,
      projectIndexes,
      projectMeta,
      { minChapters: 2 },
    ),
    [projectIndexes, projectMeta, workspace],
  )

  const visibleEntities = intelligence.entities
    .filter(entity => entity.chapterCount > 0 || entity.aliases.length > 0)
    .slice(0, heatmapLimit)

  useEffect(() => {
    if (
      selectedEntityId &&
      intelligence.entityById.has(selectedEntityId)
    ) {
      return
    }
    setSelectedEntityId(
      intelligence.entities.find(entity => entity.chapterCount > 0)?.id ||
      intelligence.entities[0]?.id ||
      '',
    )
  }, [intelligence, selectedEntityId])

  const selectedEntity = intelligence.entityById.get(selectedEntityId) || null
  const selectedAliases = selectedEntity?.aliases || []
  const typeLabel = type => (
    entityTypes.find(item => item.id === type)?.label || type
  )

  const addAlias = () => {
    if (!selectedEntity) return
    const alias = normalizeEntityTerm(aliasDraft)
    const error = getProjectEntityAliasError(
      intelligence.entities, selectedEntity.id, alias,
    )
    if (error) {
      toast.error(error)
      return
    }

    onMetaChange?.(previous => {
      const aliases = normalizeProjectEntityAliases(previous.entityAliases)
      const current = Object.hasOwn(aliases, selectedEntity.id)
        ? aliases[selectedEntity.id]
        : []
      return {
        ...previous,
        entityAliases: normalizeProjectEntityAliases({
          ...aliases,
          [selectedEntity.id]: [...current, alias],
        }),
      }
    })
    setAliasDraft('')
  }

  const removeAlias = alias => {
    if (!selectedEntity) return
    onMetaChange?.(previous => {
      const nextAliases = normalizeProjectEntityAliases(previous.entityAliases)
      const current = Object.hasOwn(nextAliases, selectedEntity.id)
        ? nextAliases[selectedEntity.id]
        : []
      const remaining = current.filter(item => entityTermKey(item) !== entityTermKey(alias))
      if (remaining.length) {
        nextAliases[selectedEntity.id] = remaining
      } else {
        delete nextAliases[selectedEntity.id]
      }
      return {
        ...previous,
        entityAliases: nextAliases,
      }
    })
  }

  return (
    <section
      className="project-entity-intelligence"
      aria-label="实体智能分析"
    >
      <header>
        <div>
          <strong>实体智能层</strong>
          <span>
            把 WikiLink、实体原名和你确认的别名合并成可解释的正文提及证据。
          </span>
        </div>
        <div className="project-entity-intelligence-metrics">
          <span><b>{intelligence.stats.activeEntities}</b>活跃实体</span>
          <span><b>{intelligence.stats.recognizedWikiReferences}</b>WikiLink</span>
          <span><b>{intelligence.stats.plainTextMentions}</b>原名提及</span>
          <span><b>{intelligence.stats.aliasMentions}</b>别名提及</span>
          {intelligence.stats.canonicalConflictCount > 0 && (
            <span className="warning">
              <b>{intelligence.stats.canonicalConflictCount}</b>原名冲突
            </span>
          )}
          {intelligence.stats.aliasConflictCount > 0 && (
            <span className="warning">
              <b>{intelligence.stats.aliasConflictCount}</b>别名冲突
            </span>
          )}
        </div>
      </header>

      {intelligence.canonicalConflicts.length > 0 && (
        <div className="project-entity-alias-conflicts" role="status">
          <strong>同名实体已暂停原名识别，请用 WikiLink 或独有别名区分</strong>
          <div>
            {intelligence.canonicalConflicts.map(item => (
              <span key={item.label}>
                {item.label} · {item.entityIds.length} 个实体
              </span>
            ))}
          </div>
        </div>
      )}

      {intelligence.aliasConflicts.length > 0 && (
        <div className="project-entity-alias-conflicts">
          <strong>别名冲突已停止参与自动识别</strong>
          <div>
            {intelligence.aliasConflicts.map(item => (
              <span key={item.alias}>
                {item.alias} · {item.entityIds.length} 个实体
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="project-entity-intelligence-grid">
        <article className="project-entity-alias-editor">
          <header>
            <strong>实体别名库</strong>
            <span>只识别你确认过的别名；单字代词默认不参与扫描，每个实体最多 24 个别名。</span>
          </header>

          <select
            value={selectedEntityId}
            onChange={event => {
              setSelectedEntityId(event.target.value)
              setAliasDraft('')
            }}
            aria-label="选择实体别名对象"
          >
            <option value="">选择实体</option>
            {intelligence.entities.map(entity => (
              <option key={entity.id} value={entity.id}>
                {entity.label} · {typeLabel(entity.type)}
              </option>
            ))}
          </select>

          {selectedEntity ? (
            <>
              <div className="project-entity-alias-summary">
                <div>
                  <span>{typeLabel(selectedEntity.type)}</span>
                  <strong>{selectedEntity.label}</strong>
                  <small>
                    {selectedEntity.chapterCount} 章出现 ·
                    {' '}{selectedEntity.mentionCount} 次提及 ·
                    {' '}跨 {selectedEntity.volumeCount} 卷
                  </small>
                </div>
                {selectedEntity.noteId && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => onOpenFile?.(selectedEntity.noteId)}
                  >
                    打开实体笔记
                  </button>
                )}
              </div>

              <div className="project-entity-alias-list">
                <span className="canonical">
                  原名 · {selectedEntity.label}
                </span>
                {selectedAliases.map(alias => (
                  <span key={alias}>
                    {alias}
                    <button
                      type="button"
                      onClick={() => removeAlias(alias)}
                      aria-label={'删除实体别名 ' + alias}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {!selectedAliases.length && <em>暂无别名</em>}
              </div>

              <div className="project-entity-alias-add">
                <input
                  value={aliasDraft}
                  onChange={event => setAliasDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.nativeEvent?.isComposing && event.keyCode !== 229) {
                      event.preventDefault()
                      addAlias()
                    }
                  }}
                  placeholder="例如：关姑娘 / 小关"
                  aria-label="新增实体别名"
                />
                <button
                  type="button"
                  className="btn small primary"
                  onClick={addAlias}
                >
                  添加别名
                </button>
              </div>

            </>
          ) : (
            <div className="project-entity-alias-empty">
              当前项目还没有可分析的实体索引。
            </div>
          )}
        </article>

        <article className="project-entity-heatmap-card">
          <header>
            <div>
              <strong>实体出场热力图</strong>
              <span>
                每格代表一个章节：W=WikiLink，N=原名，A=别名；颜色深浅代表该章提及次数。
              </span>
            </div>
            <select
              value={heatmapLimit}
              onChange={event => setHeatmapLimit(Number(event.target.value))}
              aria-label="实体热力图显示数量"
            >
              <option value="8">前 8 个</option>
              <option value="12">前 12 个</option>
              <option value="20">前 20 个</option>
            </select>
          </header>

          <div className="project-entity-heatmap">
            <div
              className="project-entity-heatmap-row head"
              style={{ '--chapter-count': Math.max(1, intelligence.chapters.length) }}
            >
              <span>实体</span>
              {intelligence.chapters.map(chapter => (
                <b
                  key={chapter.id}
                  title={
                    '#' + chapter.ordinal + ' ' +
                    stripExtension(chapter.title)
                  }
                >
                  {chapter.ordinal}
                </b>
              ))}
            </div>

            {visibleEntities.map(entity => (
              <div
                key={entity.id}
                className="project-entity-heatmap-row"
                style={{ '--chapter-count': Math.max(1, intelligence.chapters.length) }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedEntityId(entity.id)}
                  title={entity.label}
                >
                  <strong>{entity.label}</strong>
                  <small>{entity.chapterCount}章</small>
                </button>

                {intelligence.chapters.map(chapter => {
                  const evidence = (
                    intelligence.chapterEntities[chapter.id] || []
                  ).find(item => item.node.id === entity.id)
                  const count = evidence
                    ? evidence.explicitCount +
                      evidence.canonicalCount +
                      evidence.aliasCount
                    : 0
                  const code = evidence?.bestSource === 'wiki'
                    ? 'W'
                    : evidence?.bestSource === 'canonical'
                      ? 'N'
                      : evidence?.bestSource === 'alias'
                        ? 'A'
                        : ''

                  return (
                    <button
                      key={chapter.id}
                      type="button"
                      className={
                        'project-entity-heatmap-cell' +
                        (count > 0 ? ' active' : '') +
                        (count >= 3 ? ' strong' : '')
                      }
                      disabled={!count}
                      onClick={() => count && onOpenFile?.(chapter.id)}
                      title={
                        count
                          ? stripExtension(chapter.title) +
                            ' · ' + evidence.sourceLabel +
                            ' · ' + count + ' 次'
                          : stripExtension(chapter.title) + ' · 未识别'
                      }
                    >
                      {code || '·'}
                    </button>
                  )
                })}
              </div>
            ))}

            {!visibleEntities.length && (
              <div className="project-entity-heatmap-empty">
                暂无正文实体提及。给正文添加 WikiLink，或为索引实体设置别名后即可分析。
              </div>
            )}
          </div>
        </article>
      </div>
      <ProjectEntityEvidencePanel
        projectId={workspace?.project?.id}
        intelligence={intelligence}
        entityId={selectedEntityId}
        projectMeta={projectMeta}
        onOpenFile={onOpenFile}
      />
    </section>
  )
}
