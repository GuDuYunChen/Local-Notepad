import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
import {
  analyzeWikiReferenceHealth,
  collectWikiReferences,
  formatSectionPath,
  repairWikiReferences,
} from './Editor/utils/referenceUtils'
import './ReferenceHealthPanel.css'

const ISSUE_LABELS = {
  'target-missing': '目标不存在或已删除',
  'title-stale': '目标笔记已改名',
  'section-moved': '章节路径已变化，可安全迁移',
  'section-missing': '章节不存在或匹配不唯一',
}

function statusCopy(status) {
  if (status === 'healthy') return ['健康', 'healthy']
  if (status === 'repairable') return ['可修复', 'repairable']
  return ['需处理', 'broken']
}

export default function ReferenceHealthPanel({
  file,
  unsaved,
  onSelectFile,
  onRepairContent,
}) {
  const [health, setHealth] = useState([])
  const [targets, setTargets] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!file?.id) {
      setHealth([])
      setTargets(new Map())
      return undefined
    }

    const references = collectWikiReferences(file.content || '')
    if (!references.length) {
      setHealth([])
      setTargets(new Map())
      return undefined
    }

    const requestId = ++requestRef.current
    const ids = [...new Set(references.map(item => item.id).filter(Boolean))]
    setLoading(true)

    Promise.all(ids.map(async id => {
      try {
        const target = await api('/api/files/' + id)
        return [id, target]
      } catch {
        return [id, null]
      }
    }))
      .then(entries => {
        if (requestRef.current !== requestId) return
        const nextTargets = new Map(entries)
        setTargets(nextTargets)
        setHealth(analyzeWikiReferenceHealth(file.content || '', nextTargets))
      })
      .finally(() => {
        if (requestRef.current === requestId) setLoading(false)
      })

    return () => {
      requestRef.current += 1
    }
  }, [file?.id, file?.content, refreshToken])

  const summary = useMemo(() => {
    const result = {
      total: health.length,
      healthy: 0,
      repairable: 0,
      broken: 0,
    }

    for (const item of health) {
      if (item.status === 'healthy') result.healthy += 1
      if (item.status === 'broken') result.broken += 1
      if (item.repairable) result.repairable += 1
    }

    return result
  }, [health])

  const repairAll = async () => {
    if (!file?.content || !onRepairContent || repairing || unsaved) return

    const result = repairWikiReferences(file.content, targets)
    if (!result.changed) {
      if (result.unresolvedCount) {
        toast.warning('没有可安全自动修复的引用')
      } else {
        toast.success('引用已经是最新状态')
      }
      return
    }

    setRepairing(true)
    try {
      await onRepairContent(result.content)
      toast.success(
        result.unresolvedCount
          ? '已修复 ' + result.repairedCount + ' 处，仍有 ' + result.unresolvedCount + ' 处需人工处理'
          : '已修复 ' + result.repairedCount + ' 处引用'
      )
      setRefreshToken(value => value + 1)
    } catch (error) {
      console.error('修复引用失败', error)
      toast.error(error.message || '修复引用失败')
    } finally {
      setRepairing(false)
    }
  }

  if (loading) {
    return <div className="reference-health-state">正在检查引用健康…</div>
  }

  if (!health.length) {
    return (
      <div className="reference-health-empty">
        <strong>暂无出站引用</strong>
        <span>输入 [[笔记]] 或 [[笔记#章节]] 后，这里会显示引用健康状态。</span>
      </div>
    )
  }

  return (
    <div className="reference-health-panel">
      <div className="reference-health-summary">
        <div>
          <span>引用</span>
          <strong>{summary.total}</strong>
        </div>
        <div>
          <span>健康</span>
          <strong>{summary.healthy}</strong>
        </div>
        <div className={summary.repairable ? 'warning' : ''}>
          <span>可修复</span>
          <strong>{summary.repairable}</strong>
        </div>
        <div className={summary.broken ? 'danger' : ''}>
          <span>需处理</span>
          <strong>{summary.broken}</strong>
        </div>
      </div>

      <div className="reference-health-actions">
        <button
          type="button"
          className="btn primary"
          disabled={repairing || unsaved || summary.repairable === 0}
          onClick={() => void repairAll()}
        >
          {repairing ? '修复中…' : '安全修复全部'}
        </button>
        {unsaved && <span>请先保存当前正文，再执行引用修复。</span>}
        {!unsaved && summary.broken > 0 && (
          <span>无法唯一判断的章节或已删除目标不会被自动修改。</span>
        )}
      </div>

      <div className="reference-health-list">
        {health.map(item => {
          const [label, statusClass] = statusCopy(item.status)
          const targetTitle = item.target?.title || item.title || '未知目标'
          const targetSection = formatSectionPath(item.sectionPath)
          const suggestedSection = formatSectionPath(item.suggestedSectionPath)
          const sourceSection = formatSectionPath(item.sourceSectionPath)

          return (
            <article
              key={item.key + ':' + item.ordinal}
              className={'reference-health-item ' + statusClass}
            >
              <div className="reference-health-item-head">
                <div className="reference-health-target">
                  <strong>{targetTitle}</strong>
                  {targetSection && <span>› {targetSection}</span>}
                </div>
                <span className={'reference-health-badge ' + statusClass}>{label}</span>
              </div>

              {sourceSection && (
                <div className="reference-health-source">
                  来源位置：{sourceSection}
                </div>
              )}

              {item.issues.length > 0 && (
                <div className="reference-health-issues">
                  {item.issues.map(issue => (
                    <span key={issue}>{ISSUE_LABELS[issue] || issue}</span>
                  ))}
                </div>
              )}

              {item.issues.includes('title-stale') && item.target?.title && (
                <div className="reference-health-suggestion">
                  标题：{item.title || '未命名'} → {item.target.title}
                </div>
              )}

              {item.issues.includes('section-moved') && suggestedSection && (
                <div className="reference-health-suggestion">
                  章节：{targetSection || '—'} → {suggestedSection}
                </div>
              )}

              <div className="reference-health-item-actions">
                {item.target && (
                  <button
                    type="button"
                    onClick={() => onSelectFile?.(item.target.id, {
                      headingPath: item.status === 'repairable'
                        ? item.suggestedSectionPath
                        : item.sectionPath,
                    })}
                  >
                    打开目标
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
