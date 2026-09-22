import React, { useMemo, useState } from 'react'
import {
  buildProjectStoryMap,
  filterProjectStoryMap,
} from './projectStructureUtils'
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
  onOpenFile,
  onNavigateView,
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [marker, setMarker] = useState('all')
  const [detailMode, setDetailMode] = useState(true)

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
                      ' word-' + chapter.wordBand
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
