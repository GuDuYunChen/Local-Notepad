import React, { useEffect, useMemo, useState } from 'react'
import {
  buildProjectStoryMap,
  filterProjectStoryMap,
} from './projectStructureUtils'
import {
  buildProjectStorylineDiagnostics,
  buildProjectStorylineModel,
  getProjectStorylineStages,
  getProjectStorylineSuggestions,
  getProjectStorylineTypes,
} from './projectStorylineUtils'
import './ProjectStructurePanel.css'

function stripExtension(value) {
  return String(value || '未命名').replace(/\.[^.]+$/, '')
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function statusLabel(status) {
  if (status === 'done') return '完成'
  if (status === 'review') return '修订'
  return '草稿'
}

const MARKER_COPY = {
  characters: '人物',
  locations: '地点',
  foreshadows: '伏笔',
}

export default function ProjectStructurePanel({
  workspace,
  projectMeta,
  projectIndexes,
  onMetaChange,
  onOpenFile,
  onNavigateView,
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [marker, setMarker] = useState('all')
  const [detailMode, setDetailMode] = useState(true)
  const [storylineType, setStorylineType] = useState('plot')
  const [storylineTitle, setStorylineTitle] = useState('')
  const [storylineSource, setStorylineSource] = useState('')
  const [selectedTrackId, setSelectedTrackId] = useState('')
  const [eventChapterId, setEventChapterId] = useState('')
  const [eventStage, setEventStage] = useState('setup')
  const [eventNote, setEventNote] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState('')

  const storyMap = useMemo(
    () => buildProjectStoryMap(
      workspace,
      projectMeta,
      projectIndexes,
    ),
    [projectIndexes, projectMeta, workspace]
  )

  const filtered = useMemo(
    () => filterProjectStoryMap(storyMap, {
      query,
      status,
      marker,
    }),
    [marker, query, status, storyMap]
  )

  const storylineModel = useMemo(
    () => buildProjectStorylineModel(workspace, projectMeta),
    [projectMeta, workspace]
  )
  const storylineDiagnostics = useMemo(
    () => buildProjectStorylineDiagnostics(workspace, projectMeta),
    [projectMeta, workspace]
  )
  const storylineTypes = useMemo(
    () => getProjectStorylineTypes(),
    []
  )
  const selectedTrack = storylineModel.tracks.find(track => (
    track.id === selectedTrackId
  )) || null
  const storylineStages = useMemo(
    () => getProjectStorylineStages(selectedTrack?.type || storylineType),
    [selectedTrack?.type, storylineType]
  )
  const storylineSuggestions = useMemo(
    () => getProjectStorylineSuggestions(
      projectIndexes,
      projectMeta?.storylines,
      storylineType,
    ),
    [projectIndexes, projectMeta?.storylines, storylineType]
  )

  useEffect(() => {
    const stages = getProjectStorylineStages(selectedTrack?.type || storylineType)
    setEventStage(stages[0]?.id || '')
    setEventChapterId('')
    setEventNote('')
    setDeleteConfirmId('')
  }, [selectedTrack?.id, selectedTrack?.type, storylineType])

  useEffect(() => {
    if (
      selectedTrackId &&
      !storylineModel.tracks.some(track => track.id === selectedTrackId)
    ) {
      setSelectedTrackId('')
    }
  }, [selectedTrackId, storylineModel.tracks])

  if (!workspace?.project?.id) return null

  const labels = storyMap.labels
  const visibleCount = filtered.volumes.reduce(
    (sum, volume) => sum + volume.chapters.length,
    0,
  )
  const filterActive = Boolean(
    query.trim() ||
    status !== 'all' ||
    marker !== 'all'
  )

  const signalItems = [
    {
      id: 'empty-volume',
      count: storyMap.signals.emptyVolumes,
      label: '空' + labels.volume,
    },
    {
      id: 'zero-words',
      count: storyMap.signals.zeroWordChapters,
      label: '0 字' + labels.chapter,
    },
    {
      id: 'outliers',
      count: storyMap.signals.wordOutliers,
      label: '字数偏离' + labels.chapter,
    },
    {
      id: 'summaries',
      count: storyMap.signals.missingManualSummaries,
      label: '未写手工摘要',
    },
    {
      id: 'untagged',
      count: storyMap.signals.untaggedChapters,
      label: '无索引标签' + labels.chapter,
    },
    {
      id: 'volume-targets',
      count: storyMap.signals.volumesWithoutTargets,
      label: '未设字数目标' + labels.volume,
    },
  ].filter(item => item.count > 0)

  const indexGroups = [
    {
      id: 'characters',
      label: '人物索引',
      items: storyMap.indexes.characters,
    },
    {
      id: 'locations',
      label: '地点索引',
      items: storyMap.indexes.locations,
    },
    {
      id: 'foreshadows',
      label: '伏笔索引',
      items: storyMap.indexes.foreshadows,
    },
  ]

  const updateStorylines = updater => {
    onMetaChange?.(previous => ({
      ...previous,
      storylines: typeof updater === 'function'
        ? updater(previous.storylines || [])
        : updater,
    }))
  }

  const createStoryline = () => {
    const typeCopy = storylineTypes.find(item => item.id === storylineType)
    const source = storylineSuggestions.find(item => (
      String(item.id) === String(storylineSource)
    ))
    const title = storylineTitle.trim() ||
      stripExtension(source?.title) ||
      ((typeCopy?.label || '轨迹') + ' ' + (storylineModel.totals.tracks + 1))
    const id = 'storyline-' + Date.now().toString(36) + '-' +
      (storylineModel.totals.tracks + 1)

    updateStorylines(previous => [
      ...previous,
      {
        id,
        title,
        type: storylineType,
        description: '',
        sourceNoteId: storylineSource,
        events: [],
      },
    ])
    setSelectedTrackId(id)
    setStorylineTitle('')
    setStorylineSource('')
  }

  const updateTrack = patch => {
    if (!selectedTrack) return
    updateStorylines(previous => previous.map(track => (
      track.id === selectedTrack.id
        ? { ...track, ...patch }
        : track
    )))
  }

  const addTrackEvent = () => {
    if (!selectedTrack || !eventChapterId || !eventStage) return

    const eventId = 'event-' + Date.now().toString(36) + '-' +
      (selectedTrack.events.length + 1)
    const shouldRecover = Boolean(
      selectedTrack.type === 'foreshadow' &&
      selectedTrack.sourceNoteId &&
      eventStage === 'payoff'
    )

    onMetaChange?.(previous => ({
      ...previous,
      storylines: (previous.storylines || []).map(track => {
        if (track.id !== selectedTrack.id) return track
        const existing = (track.events || []).find(event => (
          event.noteId === eventChapterId &&
          event.stage === eventStage
        ))

        if (existing) {
          return {
            ...track,
            events: track.events.map(event => (
              event.id === existing.id
                ? { ...event, note: eventNote.trim() }
                : event
            )),
          }
        }

        return {
          ...track,
          events: [
            ...(track.events || []),
            {
              id: eventId,
              noteId: eventChapterId,
              stage: eventStage,
              note: eventNote.trim(),
            },
          ],
        }
      }),
      foreshadowStates: shouldRecover
        ? {
          ...previous.foreshadowStates,
          [selectedTrack.sourceNoteId]: 'recovered',
        }
        : previous.foreshadowStates,
    }))

    setEventNote('')
  }

  const removeTrackEvent = (trackId, eventId) => {
    updateStorylines(previous => previous.map(track => (
      track.id !== trackId
        ? track
        : {
          ...track,
          events: track.events.filter(event => event.id !== eventId),
        }
    )))
  }

  const deleteSelectedTrack = () => {
    if (!selectedTrack) return
    if (deleteConfirmId !== selectedTrack.id) {
      setDeleteConfirmId(selectedTrack.id)
      return
    }
    updateStorylines(previous => previous.filter(track => (
      track.id !== selectedTrack.id
    )))
    setSelectedTrackId('')
    setDeleteConfirmId('')
  }

  return (
    <section className="project-structure-panel" aria-label="长篇结构总览">
      <header className="project-structure-head">
        <div>
          <strong>长篇结构总览</strong>
          <span>
            按真实阅读顺序查看{labels.volume}、{labels.chapter}、状态、字数与人物 / 地点 / 伏笔覆盖。
          </span>
        </div>
        <div>
          <button
            type="button"
            className="btn small"
            onClick={() => onNavigateView?.('project')}
          >
            返回项目看板
          </button>
          <button
            type="button"
            className={'btn small' + (detailMode ? ' active' : '')}
            aria-pressed={detailMode}
            onClick={() => setDetailMode(value => !value)}
          >
            {detailMode ? '精简节点' : '显示摘要'}
          </button>
        </div>
      </header>

      <div className="project-structure-overview">
        <div>
          <span>{labels.volume}</span>
          <strong>{storyMap.totals.volumes}</strong>
          <small>{storyMap.signals.emptyVolumes} 个空{labels.volume}</small>
        </div>
        <div>
          <span>{labels.chapter}</span>
          <strong>{storyMap.totals.chapters}</strong>
          <small>{storyMap.totals.donePercent}% 已完成</small>
        </div>
        <div>
          <span>总字数</span>
          <strong>{formatNumber(storyMap.totals.words)}</strong>
          <small>
            中位{labels.chapter} {formatNumber(storyMap.totals.medianWords)} 字
          </small>
        </div>
        <div>
          <span>状态</span>
          <strong>
            {storyMap.totals.statusCounts.done}/
            {storyMap.totals.statusCounts.review}/
            {storyMap.totals.statusCounts.draft}
          </strong>
          <small>完成 / 修订 / 草稿</small>
        </div>
        <div>
          <span>手工摘要</span>
          <strong>{storyMap.totals.summaryCoverage}%</strong>
          <small>
            {storyMap.totals.manualSummaryCount}/{storyMap.totals.chapters} {labels.chapter}
          </small>
        </div>
        <div>
          <span>索引覆盖</span>
          <strong>{storyMap.totals.taggedCoverage}%</strong>
          <small>
            {storyMap.totals.taggedChapterCount}/{storyMap.totals.chapters} {labels.chapter}
          </small>
        </div>
      </div>

      <section className="project-structure-controls" aria-label="结构图筛选">
        <div className="project-structure-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={'搜索' + labels.chapter + '标题或摘要'}
            aria-label="搜索故事地图"
          />
        </div>

        <select
          value={status}
          onChange={event => setStatus(event.target.value)}
          aria-label="故事地图状态筛选"
        >
          <option value="all">全部状态</option>
          <option value="draft">草稿</option>
          <option value="review">修订</option>
          <option value="done">完成</option>
        </select>

        <select
          value={marker}
          onChange={event => setMarker(event.target.value)}
          aria-label="故事地图索引筛选"
        >
          <option value="all">全部索引</option>
          <option value="characters">人物</option>
          <option value="locations">地点</option>
          <option value="foreshadows">伏笔</option>
        </select>

        <div className="project-structure-filter-summary">
          <strong>{visibleCount}</strong>
          <span>当前可见{labels.chapter}</span>
        </div>

        {filterActive && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setQuery('')
              setStatus('all')
              setMarker('all')
            }}
          >
            清除筛选
          </button>
        )}
      </section>

      {signalItems.length > 0 && (
        <section className="project-structure-signals" aria-label="结构数据提示">
          <strong>结构数据提示</strong>
          <div>
            {signalItems.map(item => (
              <span key={item.id}>
                <b>{item.count}</b>
                {item.label}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="project-storyline-system" aria-label="故事线与生命周期">
        <header>
          <div>
            <strong>故事线与生命周期</strong>
            <span>
              将剧情线、人物弧光和伏笔生命周期绑定到真实{labels.chapter}节点。
            </span>
          </div>
          <div className="project-storyline-metrics">
            <span><b>{storylineModel.totals.tracks}</b>轨迹</span>
            <span><b>{storylineModel.totals.events}</b>节点</span>
            <span><b>{storylineModel.totals.active}</b>进行中</span>
            <span><b>{storylineModel.totals.resolved}</b>已收束</span>
          </div>
        </header>

        <div className="project-storyline-create">
          <select
            value={storylineType}
            onChange={event => {
              setStorylineType(event.target.value)
              setStorylineSource('')
            }}
            aria-label="新建轨迹类型"
          >
            {storylineTypes.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>

          {(storylineType === 'character' || storylineType === 'foreshadow') && (
            <select
              value={storylineSource}
              onChange={event => {
                const value = event.target.value
                setStorylineSource(value)
                if (!storylineTitle.trim()) {
                  const item = storylineSuggestions.find(entry => (
                    String(entry.id) === String(value)
                  ))
                  if (item) setStorylineTitle(stripExtension(item.title))
                }
              }}
              aria-label="关联现有索引"
            >
              <option value="">不关联索引笔记</option>
              {storylineSuggestions.map(item => (
                <option key={item.id} value={item.id}>
                  {stripExtension(item.title)}
                </option>
              ))}
            </select>
          )}

          <input
            value={storylineTitle}
            onChange={event => setStorylineTitle(event.target.value)}
            placeholder="轨迹名称"
            aria-label="轨迹名称"
          />
          <button
            type="button"
            className="btn small primary"
            onClick={createStoryline}
          >
            新建轨迹
          </button>
        </div>

        <div className="project-storyline-workspace">
          <aside className="project-storyline-list">
            {storylineModel.tracks.map(track => (
              <button
                key={track.id}
                type="button"
                className={
                  'type-' + track.type +
                  (selectedTrackId === track.id ? ' active' : '')
                }
                onClick={() => setSelectedTrackId(track.id)}
              >
                <span>
                  {storylineTypes.find(item => item.id === track.type)?.label}
                </span>
                <strong>{track.title}</strong>
                <small>
                  {track.events.length} 节点 ·
                  {' '}
                  {track.status === 'resolved'
                    ? '已收束'
                    : track.status === 'active'
                      ? '进行中'
                      : '未开始'}
                </small>
              </button>
            ))}
            {!storylineModel.tracks.length && (
              <div className="project-storyline-empty">
                还没有轨迹。可从剧情线、人物弧光或伏笔生命周期开始。
              </div>
            )}
          </aside>

          <div className="project-storyline-editor">
            {selectedTrack ? (
              <>
                <div className="project-storyline-editor-head">
                  <div>
                    <span>
                      {storylineTypes.find(item => item.id === selectedTrack.type)?.label}
                    </span>
                    <strong>{selectedTrack.title}</strong>
                  </div>
                  <em className={'status-' + selectedTrack.status}>
                    {selectedTrack.status === 'resolved'
                      ? '已收束'
                      : selectedTrack.status === 'active'
                        ? '进行中'
                        : '未开始'}
                  </em>
                </div>

                <div className="project-storyline-fields">
                  <label>
                    <span>名称</span>
                    <input
                      value={selectedTrack.title}
                      onChange={event => updateTrack({
                        title: event.target.value,
                      })}
                      aria-label="编辑轨迹名称"
                    />
                  </label>
                  <label className="wide">
                    <span>轨迹说明</span>
                    <input
                      value={selectedTrack.description}
                      onChange={event => updateTrack({
                        description: event.target.value,
                      })}
                      placeholder="这条线在整部作品中承担什么作用"
                      aria-label="轨迹说明"
                    />
                  </label>
                  {selectedTrack.sourceNoteId && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => onOpenFile?.(selectedTrack.sourceNoteId)}
                    >
                      打开关联索引
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={deleteSelectedTrack}
                  >
                    {deleteConfirmId === selectedTrack.id
                      ? '确认删除'
                      : '删除轨迹'}
                  </button>
                </div>

                <div className="project-storyline-event-form">
                  <select
                    value={eventChapterId}
                    onChange={event => setEventChapterId(event.target.value)}
                    aria-label="轨迹节点章节"
                  >
                    <option value="">选择{labels.chapter}</option>
                    {storylineModel.catalog.map(chapter => (
                      <option key={chapter.id} value={chapter.id}>
                        #{chapter.ordinal} {stripExtension(chapter.title)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={eventStage}
                    onChange={event => setEventStage(event.target.value)}
                    aria-label="轨迹生命周期阶段"
                  >
                    {storylineStages.map(stage => (
                      <option key={stage.id} value={stage.id}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={eventNote}
                    onChange={event => setEventNote(event.target.value)}
                    placeholder="节点说明（可选）"
                    aria-label="轨迹节点说明"
                  />
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={!eventChapterId}
                    onClick={addTrackEvent}
                  >
                    添加节点
                  </button>
                </div>
              </>
            ) : (
              <div className="project-storyline-select-empty">
                选择左侧轨迹即可编辑说明、生命周期节点和章节关联。
              </div>
            )}
          </div>
        </div>

        {storylineModel.tracks.length > 0 && (
          <div className="project-storyline-lanes">
            {storylineModel.tracks.map(track => (
              <article key={track.id} className={'type-' + track.type}>
                <header>
                  <span>
                    {storylineTypes.find(item => item.id === track.type)?.label}
                  </span>
                  <strong>{track.title}</strong>
                  <small>
                    {track.startOrdinal && track.endOrdinal
                      ? '#' + track.startOrdinal + ' → #' + track.endOrdinal
                      : '尚未绑定章节'}
                  </small>
                </header>
                <div>
                  {track.events.map(event => (
                    <span
                      key={event.id}
                      className={'project-storyline-event' + (!event.chapter ? ' orphan' : '')}
                    >
                      <button
                        type="button"
                        disabled={!event.chapter}
                        onClick={() => event.chapter && onOpenFile?.(event.noteId)}
                      >
                        <b>{event.stageLabel}</b>
                        <em>
                          {event.chapter
                            ? '#' + event.chapter.ordinal + ' ' +
                              stripExtension(event.chapter.title)
                            : '原章节已不存在'}
                        </em>
                        {event.note && <small>{event.note}</small>}
                      </button>
                      {selectedTrackId === track.id && (
                        <button
                          type="button"
                          className="remove"
                          onClick={() => removeTrackEvent(track.id, event.id)}
                          aria-label={'删除轨迹节点 ' + event.stageLabel}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  {!track.events.length && (
                    <em className="project-storyline-lane-empty">
                      尚未添加生命周期节点
                    </em>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {(storylineModel.signals.unresolvedForeshadows > 0 ||
          storylineModel.signals.emptyTracks > 0 ||
          storylineModel.signals.orphanEvents > 0) && (
          <div className="project-storyline-signals">
            {storylineModel.signals.unresolvedForeshadows > 0 && (
              <span>
                <b>{storylineModel.signals.unresolvedForeshadows}</b>
                条伏笔轨迹尚未回收
              </span>
            )}
            {storylineModel.signals.emptyTracks > 0 && (
              <span>
                <b>{storylineModel.signals.emptyTracks}</b>
                条轨迹尚未绑定章节
              </span>
            )}
            {storylineModel.signals.orphanEvents > 0 && (
              <span>
                <b>{storylineModel.signals.orphanEvents}</b>
                个节点引用了已不存在章节
              </span>
            )}
          </div>
        )}
      </section>

      {storylineModel.tracks.length > 0 && (
        <section className="project-storyline-diagnostics" aria-label="剧情线交叉与节奏诊断">
          <header>
            <div>
              <strong>剧情线交叉与节奏诊断</strong>
              <span>
                只按章节位置、轨迹节点和生命周期阶段计算，不评价剧情好坏。
              </span>
            </div>
            <div className="project-storyline-diagnostic-metrics">
              <span><b>{storylineDiagnostics.totals.intersections}</b>交汇章</span>
              <span><b>{storylineDiagnostics.totals.overloadedChapters}</b>高密度章</span>
              <span><b>{storylineDiagnostics.totals.longGapTracks}</b>长断档轨迹</span>
              <span><b>{storylineDiagnostics.totals.regressionTracks}</b>阶段倒退</span>
            </div>
          </header>

          <div className="project-storyline-diagnostic-grid">
            <article className="project-storyline-matrix-card">
              <header>
                <strong>跨卷轨迹矩阵</strong>
                <span>数字表示该轨迹在对应{labels.volume}中的节点数</span>
              </header>
              <div className="project-storyline-matrix">
                <div
                  className="project-storyline-matrix-row head"
                  style={{ '--story-volume-count': Math.max(1, (workspace.volumes || []).length) }}
                >
                  <span>轨迹</span>
                  {(workspace.volumes || []).map(volume => (
                    <b key={volume.id || '__ungrouped__'}>
                      {volume.id ? volume.title : labels.ungrouped}
                    </b>
                  ))}
                </div>
                {storylineDiagnostics.volumeMatrix.map(track => (
                  <div
                    key={track.id}
                    className={'project-storyline-matrix-row type-' + track.type}
                    style={{ '--story-volume-count': Math.max(1, (workspace.volumes || []).length) }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTrackId(track.id)}
                      title={track.title}
                    >
                      {track.title}
                    </button>
                    {(workspace.volumes || []).map(volume => {
                      const key = String(volume.id || '__ungrouped__')
                      const cell = track.byVolume[key] || { count: 0, stages: [] }
                      return (
                        <span
                          key={key}
                          className={cell.count > 0 ? 'active' : ''}
                          title={cell.stages.join(' / ') || '本卷无节点'}
                        >
                          {cell.count || '·'}
                        </span>
                      )
                    })}
                  </div>
                ))}
              </div>
            </article>

            <article className="project-storyline-rhythm-card">
              <header>
                <strong>轨迹节奏</strong>
                <span>断档 ≥3 章、生命周期缺失或阶段倒退会明确标记</span>
              </header>
              <div className="project-storyline-rhythm-list">
                {storylineDiagnostics.tracks.map(track => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => setSelectedTrackId(track.id)}
                    className={
                      (track.longGap || track.regressions > 0 || track.terminalMissing)
                        ? 'attention'
                        : ''
                    }
                  >
                    <span>
                      <strong>{track.title}</strong>
                      <small>
                        {track.eventCount} 节点 · 跨 {track.volumeCount || 0} {labels.volume}
                        {' · '}覆盖 {track.span || 0} {labels.chapter}
                      </small>
                    </span>
                    <em>
                      {track.longGap
                        ? '最长断档 ' + track.maxGap + ' 章'
                        : track.regressions > 0
                          ? '阶段倒退 ' + track.regressions + ' 次'
                          : track.terminalMissing
                            ? '尚未收束'
                            : '节奏连续'}
                    </em>
                  </button>
                ))}
              </div>
            </article>

            <article className="project-storyline-stage-card">
              <header>
                <strong>生命周期缺口</strong>
                <span>列出每条轨迹尚未出现的标准阶段</span>
              </header>
              <div className="project-storyline-stage-list">
                {storylineDiagnostics.tracks.map(track => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => setSelectedTrackId(track.id)}
                  >
                    <strong>{track.title}</strong>
                    <span>
                      {track.missingStages.length
                        ? track.missingStages.join(' · ')
                        : '阶段已覆盖'}
                    </span>
                  </button>
                ))}
              </div>
            </article>
          </div>

          {storylineDiagnostics.chapterLoad.some(item => item.intersection) && (
            <div className="project-storyline-hotspots">
              <strong>章节交汇热点</strong>
              <div>
                {storylineDiagnostics.chapterLoad
                  .filter(item => item.intersection)
                  .map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={item.overloaded ? 'overloaded' : ''}
                      onClick={() => onOpenFile?.(item.id)}
                    >
                      <b>#{item.ordinal}</b>
                      <span>{stripExtension(item.title)}</span>
                      <em>{item.trackCount} 条轨迹 / {item.eventCount} 节点</em>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="project-story-map">
        {filtered.volumes.map(volume => {
          const progress = volume.progress || {}
          const progressPercent = progress.targetWords > 0
            ? progress.wordPercent
            : progress.chapterPercent

          return (
            <section
              key={volume.key}
              className="project-story-volume"
              aria-label={volume.title}
            >
              <header>
                <div>
                  <strong>{volume.title}</strong>
                  <span>
                    {volume.chapters.length}
                    {filterActive ? ' 可见' : ''}
                    {' '}{labels.chapter} · {formatNumber(volume.wordCount)} 字
                  </span>
                </div>
                <div className="project-story-volume-progress">
                  <span>
                    {progress.targetWords > 0
                      ? formatNumber(progress.wordCount) + ' / ' +
                        formatNumber(progress.targetWords) + ' 字'
                      : progress.completed + '/' + progress.total + ' 完成'}
                  </span>
                  <div>
                    <i style={{ width: progressPercent + '%' }} />
                  </div>
                </div>
              </header>

              <div className="project-story-track">
                {volume.chapters.map(chapter => (
                  <button
                    key={chapter.id}
                    type="button"
                    className={
                      'project-story-node status-' + chapter.status +
                      ' word-' + chapter.wordBand +
                      (
                        storylineDiagnostics.chapterLoadById.get(String(chapter.id))?.overloaded
                          ? ' storyline-overloaded'
                          : ''
                      )
                    }
                    onClick={() => onOpenFile?.(chapter.id)}
                    title={'打开 ' + stripExtension(chapter.title)}
                  >
                    <span className="project-story-node-top">
                      <em>#{chapter.ordinal}</em>
                      <b>{statusLabel(chapter.status)}</b>
                    </span>

                    <strong>{stripExtension(chapter.title)}</strong>
                    <span className="project-story-node-meta">
                      {formatNumber(chapter.wordCount)} 字
                      {!chapter.hasManualSummary && ' · 自动摘要'}
                    </span>

                    {detailMode && (
                      <small>{chapter.summary}</small>
                    )}

                    {chapter.markers.length > 0 && (
                      <span className="project-story-markers">
                        {chapter.markers.map(item => (
                          <i key={item} className={'marker-' + item}>
                            {MARKER_COPY[item]}
                          </i>
                        ))}
                      </span>
                    )}

                    {(storylineModel.chapterEvents[chapter.id] || []).length > 0 && (
                      <span className="project-storyline-node-links">
                        {(storylineModel.chapterEvents[chapter.id] || []).slice(0, 3).map(item => (
                          <i key={item.eventId} className={'type-' + item.trackType}>
                            {item.stageLabel}
                          </i>
                        ))}
                        {(storylineModel.chapterEvents[chapter.id] || []).length > 3 && (
                          <i>+{storylineModel.chapterEvents[chapter.id].length - 3}</i>
                        )}
                      </span>
                    )}
                  </button>
                ))}

                {!volume.chapters.length && (
                  <div className="project-story-empty">
                    {filterActive
                      ? '当前筛选下没有匹配' + labels.chapter
                      : '本' + labels.volume + '尚无' + labels.chapter}
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      <section className="project-structure-indexes" aria-label="项目索引总览">
        {indexGroups.map(group => (
          <article key={group.id}>
            <header>
              <strong>{group.label}</strong>
              <span>{group.items.length}</span>
            </header>
            <div>
              {group.items.slice(0, 10).map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenFile?.(item.id)}
                  title={stripExtension(item.title)}
                >
                  {stripExtension(item.title)}
                </button>
              ))}
              {!group.items.length && <em>暂无索引项</em>}
              {group.items.length > 10 && (
                <em>另有 {group.items.length - 10} 项</em>
              )}
            </div>
          </article>
        ))}
      </section>
    </section>
  )
}
