import React, { useEffect, useMemo, useState } from 'react'
import {
  analyzeChapterLengths,
  findStaleProjectChapters,
  getForeshadowAnalysis,
  getProjectEntityFrequencies,
  getVolumeCompletion,
  getWritingRhythm,
  recordProjectAnalyticsSnapshot,
} from './projectAnalyticsUtils'
import './ProjectAnalyticsPanel.css'

function formatNumber(value) {
  const number = Number(value) || 0
  const sign = number > 0 ? '+' : ''
  return sign + number.toLocaleString('zh-CN')
}

function stripExtension(value) {
  return String(value || '').replace(/\.[^.]+$/, '')
}

export default function ProjectAnalyticsPanel({
  workspace,
  projectMeta,
  projectIndexes,
  onMetaChange,
  onOpenFile,
}) {
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!workspace?.project?.id) {
      setHistory([])
      return
    }

    const next = recordProjectAnalyticsSnapshot(
      workspace.project.id,
      workspace,
      new Date(),
    )
    setHistory(next)
  }, [workspace?.project?.id, workspace?.totalWords])

  const rhythm = useMemo(
    () => getWritingRhythm(history, new Date()),
    [history]
  )
  const chapterLengths = useMemo(
    () => analyzeChapterLengths(workspace, {
      projectType: workspace?.project?.type || 'novel',
      targetWords: projectMeta?.chapterTargetWords || 0,
    }),
    [projectMeta?.chapterTargetWords, workspace]
  )
  const staleChapters = useMemo(
    () => findStaleProjectChapters(workspace, projectMeta),
    [projectMeta, workspace]
  )
  const volumeCompletion = useMemo(
    () => getVolumeCompletion(workspace),
    [workspace]
  )
  const frequencies = useMemo(
    () => getProjectEntityFrequencies(workspace, projectIndexes),
    [projectIndexes, workspace]
  )
  const foreshadows = useMemo(
    () => getForeshadowAnalysis(projectIndexes, projectMeta),
    [projectIndexes, projectMeta]
  )

  const updateChapterTarget = event => {
    const value = Math.max(0, Number(event.target.value) || 0)
    onMetaChange?.(previous => ({
      ...previous,
      chapterTargetWords: value,
    }))
  }

  const toggleForeshadow = item => {
    const current = projectMeta?.foreshadowStates?.[item.id]
    onMetaChange?.(previous => ({
      ...previous,
      foreshadowStates: {
        ...previous.foreshadowStates,
        [item.id]: current === 'recovered' ? 'open' : 'recovered',
      },
    }))
  }

  return (
    <section className="project-analytics-panel" aria-label="创作分析">
      <div className="project-analytics-head">
        <div>
          <strong>创作分析</strong>
          <span>
            写作增量从 4.26 第一次打开项目后开始按天记录；不会伪造此前历史。
          </span>
        </div>
      </div>

      <div className="project-analytics-grid">
        <article className="project-analysis-card rhythm">
          <header>
            <strong>写作节奏</strong>
            <span>{rhythm.baselineReady ? '最近 7 天' : '正在建立基线'}</span>
          </header>
          <div className="project-analysis-metrics">
            <div>
              <span>今日净增</span>
              <strong>{formatNumber(rhythm.dailyDelta)}</strong>
            </div>
            <div>
              <span>7 天净增</span>
              <strong>{formatNumber(rhythm.weeklyDelta)}</strong>
            </div>
            <div>
              <span>活跃天</span>
              <strong>{rhythm.activeDays}</strong>
            </div>
            <div>
              <span>连续写作</span>
              <strong>{rhythm.streak} 天</strong>
            </div>
          </div>
          <p>
            {rhythm.baselineReady
              ? '活跃写作日平均 ' + formatNumber(rhythm.averageActiveDay) + ' 字。'
              : '至少保留两个不同日期的项目快照后，会开始显示真实日/周增量。'}
          </p>
        </article>

        <article className="project-analysis-card chapter-lengths">
          <header>
            <strong>章节篇幅</strong>
            <label>
              <span>单章目标</span>
              <input
                type="number"
                min="0"
                step="100"
                value={projectMeta?.chapterTargetWords || ''}
                placeholder={
                  chapterLengths.medianWords
                    ? String(chapterLengths.medianWords)
                    : '自动'
                }
                onChange={updateChapterTarget}
              />
            </label>
          </header>

          <div className="project-analysis-inline">
            <span>中位数 {chapterLengths.medianWords.toLocaleString()} 字</span>
            <span>平均 {chapterLengths.averageWords.toLocaleString()} 字</span>
          </div>

          <div className="project-analysis-list compact">
            {chapterLengths.alerts.length ? (
              chapterLengths.alerts.slice(0, 5).map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenFile?.(item.id)}
                >
                  <span>
                    <strong>{stripExtension(item.title)}</strong>
                    <small>{item.volumeTitle || '未分卷'}</small>
                  </span>
                  <em className={item.type}>
                    {item.type === 'short' ? '偏短' : '偏长'} · {item.wordCount.toLocaleString()}
                  </em>
                </button>
              ))
            ) : (
              <div className="project-analysis-empty">
                {chapterLengths.targetWords
                  ? '目前没有明显偏长或偏短的章节。'
                  : '设置单章目标，或累计至少 3 个有字数章节后开始判断。'}
              </div>
            )}
          </div>
        </article>

        <article className="project-analysis-card stale">
          <header>
            <strong>长期未推进</strong>
            <span>未完成且 14 天未修改</span>
          </header>
          <div className="project-analysis-list compact">
            {staleChapters.length ? (
              staleChapters.slice(0, 5).map(note => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => onOpenFile?.(note.id)}
                >
                  <span>
                    <strong>{stripExtension(note.title)}</strong>
                    <small>{note.volumeTitle || '未分卷'}</small>
                  </span>
                  <em>{note.idleDays} 天</em>
                </button>
              ))
            ) : (
              <div className="project-analysis-empty">
                没有长期搁置的未完成章节。
              </div>
            )}
          </div>
        </article>

        <article className="project-analysis-card volume-progress">
          <header>
            <strong>卷级完成度</strong>
            <span>按章节状态计算</span>
          </header>
          <div className="project-volume-progress-list">
            {volumeCompletion.map(volume => (
              <div key={volume.id || '__ungrouped__'}>
                <div>
                  <strong>{volume.title}</strong>
                  <span>
                    {volume.completed}/{volume.total} · {volume.wordCount.toLocaleString()} 字
                  </span>
                </div>
                <div className="project-volume-progress-track">
                  <span style={{ width: String(volume.percent) + '%' }} />
                </div>
                <em>{volume.percent}%</em>
              </div>
            ))}
          </div>
        </article>

        <article className="project-analysis-card frequencies">
          <header>
            <strong>角色 / 地点提及</strong>
            <span>按正文中的名称匹配统计</span>
          </header>
          <div className="project-frequency-columns">
            <div>
              <strong>角色</strong>
              {(frequencies.characters || []).slice(0, 5).map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenFile?.(item.id)}
                >
                  <span>{stripExtension(item.title)}</span>
                  <em>{item.count}</em>
                </button>
              ))}
              {!frequencies.characters?.length && <small>暂无角色索引</small>}
            </div>
            <div>
              <strong>地点</strong>
              {(frequencies.locations || []).slice(0, 5).map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenFile?.(item.id)}
                >
                  <span>{stripExtension(item.title)}</span>
                  <em>{item.count}</em>
                </button>
              ))}
              {!frequencies.locations?.length && <small>暂无地点索引</small>}
            </div>
          </div>
        </article>

        <article className="project-analysis-card foreshadows">
          <header>
            <strong>伏笔回收</strong>
            <span>{foreshadows.open} 待回收 · {foreshadows.recovered} 已回收</span>
          </header>
          <div className="project-foreshadow-list">
            {foreshadows.items.length ? (
              foreshadows.items.slice(0, 8).map(item => (
                <div key={item.id}>
                  <button
                    type="button"
                    className="project-foreshadow-title"
                    onClick={() => onOpenFile?.(item.id)}
                  >
                    {stripExtension(item.title)}
                  </button>
                  <button
                    type="button"
                    className={'project-foreshadow-state ' + item.state}
                    onClick={() => toggleForeshadow(item)}
                  >
                    {item.state === 'recovered' ? '已回收' : '待回收'}
                  </button>
                </div>
              ))
            ) : (
              <div className="project-analysis-empty">
                给项目笔记添加“伏笔”或“线索”标签后，可在这里跟踪回收状态。
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  )
}
