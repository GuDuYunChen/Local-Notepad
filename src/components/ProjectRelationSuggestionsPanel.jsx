import React, { useMemo, useState } from 'react'
import {
  buildProjectRelationSuggestions,
} from './projectRelationSuggestionUtils'
import {
  getProjectRelationEntityTypes,
  getProjectRelationTypes,
} from './projectRelationsUtils'
import './ProjectRelationSuggestionsPanel.css'

function stripExtension(value) {
  return String(value || '未命名').replace(/\.[^.]+$/, '')
}

export default function ProjectRelationSuggestionsPanel({
  workspace,
  projectIndexes,
  projectMeta,
  onMetaChange,
  onOpenFile,
}) {
  const [minChapters, setMinChapters] = useState(2)
  const [drafts, setDrafts] = useState({})

  const relationTypes = useMemo(() => getProjectRelationTypes(), [])
  const entityTypes = useMemo(() => getProjectRelationEntityTypes(), [])
  const model = useMemo(
    () => buildProjectRelationSuggestions(
      workspace,
      projectIndexes,
      projectMeta,
      { minChapters },
    ),
    [minChapters, projectIndexes, projectMeta, workspace],
  )

  const typeLabel = type => (
    entityTypes.find(item => item.id === type)?.label || type
  )

  const relationDraft = suggestion => drafts[suggestion.signature] || {
    type: 'related',
    reversed: false,
  }

  const updateDraft = (signature, patch) => {
    setDrafts(previous => ({
      ...previous,
      [signature]: {
        type: 'related',
        reversed: false,
        ...(previous[signature] || {}),
        ...patch,
      },
    }))
  }

  const acceptSuggestion = suggestion => {
    const draft = relationDraft(suggestion)
    const relationType = relationTypes.find(item => item.id === draft.type) ||
      relationTypes[0]
    const source = draft.reversed ? suggestion.target : suggestion.source
    const target = draft.reversed ? suggestion.source : suggestion.target
    const id = 'relation-' + Date.now().toString(36) + '-' +
      ((projectMeta?.relations?.length || 0) + 1)

    onMetaChange?.(previous => ({
      ...previous,
      relations: [
        ...(previous.relations || []),
        {
          id,
          sourceId: source.id,
          targetId: target.id,
          type: relationType?.id || 'related',
          directed: Boolean(relationType?.directed),
          label: '',
          note:
            '由正文明确 WikiLink 共现建议建立；证据 ' +
            suggestion.chapterCount +
            ' 个章节。',
          events: [],
        },
      ],
    }))

    setDrafts(previous => {
      const next = { ...previous }
      delete next[suggestion.signature]
      return next
    })
  }

  const ignoreSuggestion = suggestion => {
    onMetaChange?.(previous => ({
      ...previous,
      relationSuggestionIgnores: [
        ...new Set([
          ...(previous.relationSuggestionIgnores || []),
          suggestion.signature,
        ]),
      ],
    }))
  }

  const restoreIgnored = () => {
    onMetaChange?.(previous => ({
      ...previous,
      relationSuggestionIgnores: [],
    }))
  }

  return (
    <section
      className="project-relation-suggestions"
      aria-label="关系自动发现建议"
    >
      <header>
        <div>
          <strong>关系自动发现</strong>
          <span>
            仅分析正文中明确的 [[WikiLink]] 共现；系统不会自动写入关系图。
          </span>
        </div>
        <div className="project-relation-suggestion-metrics">
          <span><b>{model.stats.recognizedReferences}</b>已识别引用</span>
          <span><b>{model.stats.chaptersWithCooccurrence}</b>共现章节</span>
          <span><b>{model.stats.candidateCount}</b>候选关系</span>
        </div>
      </header>

      <div className="project-relation-suggestion-controls">
        <label>
          <span>至少共同出现</span>
          <select
            value={minChapters}
            onChange={event => setMinChapters(Number(event.target.value))}
            aria-label="关系建议最少共现章节"
          >
            <option value="2">2 章</option>
            <option value="3">3 章</option>
            <option value="4">4 章</option>
            <option value="5">5 章</option>
          </select>
        </label>
        <span>
          已扫描 {model.stats.chapters} 章 ·
          {' '}{model.stats.totalWikiReferences} 个 WikiLink
        </span>
        {model.stats.ignoredCount > 0 && (
          <button
            type="button"
            className="btn small"
            onClick={restoreIgnored}
          >
            恢复 {model.stats.ignoredCount} 个已忽略候选
          </button>
        )}
      </div>

      {model.suggestions.length ? (
        <div className="project-relation-suggestion-list">
          {model.suggestions.map(suggestion => {
            const draft = relationDraft(suggestion)
            const source = draft.reversed
              ? suggestion.target
              : suggestion.source
            const target = draft.reversed
              ? suggestion.source
              : suggestion.target
            const selectedType = relationTypes.find(item => (
              item.id === draft.type
            ))

            return (
              <article key={suggestion.signature}>
                <div className="project-relation-suggestion-main">
                  <div className="project-relation-suggestion-pair">
                    <div>
                      <span>{typeLabel(source.type)}</span>
                      <strong>{source.label}</strong>
                    </div>
                    <b aria-hidden="true">
                      {selectedType?.directed ? '→' : '↔'}
                    </b>
                    <div>
                      <span>{typeLabel(target.type)}</span>
                      <strong>{target.label}</strong>
                    </div>
                  </div>

                  <div className="project-relation-suggestion-stats">
                    <span>
                      <b>{suggestion.chapterCount}</b> 章共同出现
                    </span>
                    <span>
                      跨 {suggestion.volumeCount} 卷 ·
                      覆盖全书 {suggestion.coveragePercent}%
                    </span>
                    {suggestion.repeatedAcrossVolumes && (
                      <em>跨卷重复共现</em>
                    )}
                  </div>
                </div>

                <div className="project-relation-suggestion-evidence">
                  <strong>证据章节</strong>
                  <div>
                    {suggestion.evidence.slice(0, 8).map(item => (
                      <button
                        key={item.chapterId}
                        type="button"
                        onClick={() => onOpenFile?.(item.chapterId)}
                        title={
                          (item.volumeTitle ? item.volumeTitle + ' · ' : '') +
                          stripExtension(item.chapterTitle)
                        }
                      >
                        <b>#{item.ordinal}</b>
                        <span>{stripExtension(item.chapterTitle)}</span>
                      </button>
                    ))}
                    {suggestion.evidence.length > 8 && (
                      <em>另有 {suggestion.evidence.length - 8} 章</em>
                    )}
                  </div>
                </div>

                <div className="project-relation-suggestion-actions">
                  <select
                    value={draft.type}
                    onChange={event => updateDraft(
                      suggestion.signature,
                      { type: event.target.value },
                    )}
                    aria-label={
                      '候选关系类型 ' +
                      suggestion.source.label +
                      ' ' +
                      suggestion.target.label
                    }
                  >
                    {relationTypes.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>

                  {selectedType?.directed && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => updateDraft(
                        suggestion.signature,
                        { reversed: !draft.reversed },
                      )}
                    >
                      调换方向
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn small primary"
                    onClick={() => acceptSuggestion(suggestion)}
                  >
                    接受建议
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => ignoreSuggestion(suggestion)}
                  >
                    忽略
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="project-relation-suggestion-empty">
          <strong>当前没有满足阈值的新关系候选</strong>
          <span>
            只有正文中明确链接到人物 / 地点 / 伏笔索引，并在多个章节共同出现的实体对才会被建议。
          </span>
        </div>
      )}
    </section>
  )
}
