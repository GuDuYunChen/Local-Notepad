import React, { useMemo, useState } from 'react'
import {
  api,
  createFileVersionSnapshot,
  listAllFilesWithContent,
} from '~/services/api'
import { toast } from '~/services/toast'
import {
  collectWikiReferences,
  diagnoseLibraryReferences,
  formatSectionPath,
  repairWikiReferences,
} from './Editor/utils/referenceUtils'
import './LibraryReferenceHealthPanel.css'

function pluralFiles(value) {
  return Number(value || 0).toLocaleString()
}

function issueLabel(issue) {
  if (issue === 'title-stale') return '标题过期'
  if (issue === 'section-moved') return '章节可迁移'
  if (issue === 'section-missing') return '章节无法唯一定位'
  if (issue === 'target-missing') return '目标不存在'
  return issue
}

export default function LibraryReferenceHealthPanel({ onOpenFile }) {
  const [diagnosis, setDiagnosis] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [progress, setProgress] = useState(null)

  const repairSources = useMemo(
    () => (diagnosis?.sources || []).filter(item => item.repairContent),
    [diagnosis]
  )

  const brokenSources = useMemo(
    () => (diagnosis?.sources || []).filter(item => item.broken > 0),
    [diagnosis]
  )

  const scan = async () => {
    if (scanning || repairing) return
    setScanning(true)
    setProgress(null)

    try {
      const files = await listAllFilesWithContent()
      const next = diagnoseLibraryReferences(files)
      setDiagnosis(next)
      setPreviewOpen(false)

      if (!next.summary.totalReferences) {
        toast.success('全库扫描完成：暂无 Wiki 引用')
      } else if (!next.summary.repairable && !next.summary.broken) {
        toast.success('全库扫描完成：引用状态正常')
      }
    } catch (error) {
      console.error('全库引用扫描失败', error)
      toast.error(error.message || '全库引用扫描失败')
    } finally {
      setScanning(false)
    }
  }

  const applyRepairPlan = async () => {
    if (repairing || !repairSources.length) return

    setRepairing(true)
    setProgress({ completed: 0, total: repairSources.length })

    let repairedFiles = 0
    let repairedReferences = 0
    const failed = []

    for (let index = 0; index < repairSources.length; index++) {
      const source = repairSources[index]

      try {
        const latestSource = await api('/api/files/' + source.id)
        const latestReferences = collectWikiReferences(latestSource?.content || '')
        const targetIds = [
          ...new Set(latestReferences.map(item => item.id).filter(Boolean)),
        ]

        const targetEntries = await Promise.all(targetIds.map(async id => {
          try {
            return [id, await api('/api/files/' + id)]
          } catch {
            return [id, null]
          }
        }))

        const freshRepair = repairWikiReferences(
          latestSource?.content || '',
          new Map(targetEntries),
        )

        if (
          !freshRepair.changed ||
          freshRepair.content !== source.repairContent
        ) {
          throw new Error('扫描后引用关系已变化，请重新扫描后再修复')
        }

        await createFileVersionSnapshot(source.id)

        await api('/api/files/' + source.id, {
          method: 'PUT',
          body: JSON.stringify({ content: freshRepair.content }),
        })

        repairedFiles += 1
        repairedReferences += freshRepair.repairedCount
      } catch (error) {
        console.error('批量修复引用失败', source.id, error)
        failed.push({
          id: source.id,
          title: source.title,
          message: error.message || '修复失败',
        })
      } finally {
        setProgress({
          completed: index + 1,
          total: repairSources.length,
        })
      }
    }

    if (failed.length) {
      toast.warning(
        '已修复 ' + repairedFiles + ' 篇笔记，' +
        failed.length + ' 篇因快照或保存失败被跳过'
      )
    } else {
      toast.success(
        '已安全修复 ' + repairedFiles + ' 篇笔记，共 ' +
        repairedReferences + ' 处引用'
      )
    }

    try {
      const files = await listAllFilesWithContent()
      setDiagnosis(diagnoseLibraryReferences(files))
      setPreviewOpen(false)
    } catch (error) {
      console.error('修复后重新扫描失败', error)
    } finally {
      setRepairing(false)
      setProgress(null)
    }
  }

  const summary = diagnosis?.summary

  return (
    <section className="library-reference-health">
      <div className="library-reference-health-head">
        <div>
          <strong>全库引用体检</strong>
          <span>
            检查 WikiLink、章节路径和失效目标。扫描只读取本地数据，不会修改正文。
          </span>
        </div>
        <button
          type="button"
          className="btn"
          disabled={scanning || repairing}
          onClick={() => void scan()}
        >
          {scanning ? '扫描中…' : diagnosis ? '重新扫描' : '开始扫描'}
        </button>
      </div>

      {!diagnosis && !scanning && (
        <div className="library-reference-health-intro">
          <span>适合在大量改名、章节重构或删除笔记之后执行。</span>
          <span>批量修复前，每篇笔记都会先写入一份明确的版本历史快照。</span>
        </div>
      )}

      {scanning && (
        <div className="library-reference-health-state">
          正在读取全库笔记并检查引用关系…
        </div>
      )}

      {summary && (
        <>
          <div className="library-reference-health-summary">
            <div>
              <span>扫描笔记</span>
              <strong>{pluralFiles(summary.scannedNotes)}</strong>
            </div>
            <div>
              <span>引用总数</span>
              <strong>{pluralFiles(summary.totalReferences)}</strong>
            </div>
            <div className={summary.repairable ? 'warning' : ''}>
              <span>可安全修复</span>
              <strong>{pluralFiles(summary.repairable)}</strong>
            </div>
            <div className={summary.broken ? 'danger' : ''}>
              <span>需人工处理</span>
              <strong>{pluralFiles(summary.broken)}</strong>
            </div>
          </div>

          <div className="library-reference-health-toolbar">
            <div>
              <strong>{summary.affectedFiles} 篇笔记受到影响</strong>
              <span>
                {summary.repairableFiles
                  ? summary.repairableFiles + ' 篇存在可安全自动修复项'
                  : '当前没有可自动修复项'}
              </span>
            </div>

            <button
              type="button"
              className="btn primary"
              disabled={!repairSources.length || repairing}
              onClick={() => setPreviewOpen(value => !value)}
            >
              {previewOpen ? '收起修复预览' : '预览安全修复'}
            </button>
          </div>

          {previewOpen && (
            <div className="library-reference-repair-preview">
              <div className="library-reference-repair-header">
                <div>
                  <strong>修复前差异预览</strong>
                  <span>
                    只展示能够确定的新标题或唯一章节路径。无法唯一判断的引用不会进入此计划。
                  </span>
                </div>
                <button
                  type="button"
                  className="btn primary"
                  disabled={repairing || !repairSources.length}
                  onClick={() => void applyRepairPlan()}
                >
                  {repairing ? '正在修复…' : '创建快照并执行修复'}
                </button>
              </div>

              {progress && (
                <div className="library-reference-repair-progress">
                  <span
                    style={{
                      width: String(
                        Math.round((progress.completed / Math.max(1, progress.total)) * 100)
                      ) + '%',
                    }}
                  />
                  <small>
                    {progress.completed}/{progress.total}
                  </small>
                </div>
              )}

              <div className="library-reference-repair-files">
                {repairSources.map(source => (
                  <article key={source.id} className="library-reference-file-card repairable">
                    <header>
                      <div>
                        <strong>{source.title}</strong>
                        <span>
                          {source.repairedCount} 处可修复
                          {source.unresolvedCount
                            ? ' · ' + source.unresolvedCount + ' 处仍需人工处理'
                            : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenFile?.(source.id)}
                      >
                        打开
                      </button>
                    </header>

                    <div className="library-reference-change-list">
                      {source.changes.map(change => (
                        <div
                          key={String(change.ordinal) + ':' + change.targetId}
                          className="library-reference-change"
                        >
                          <div className="library-reference-change-tags">
                            {change.issues.map(issue => (
                              <span key={issue}>{issueLabel(issue)}</span>
                            ))}
                          </div>
                          <code>{change.before}</code>
                          <span className="library-reference-change-arrow">↓</span>
                          <code>{change.after}</code>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>

              <div className="library-reference-repair-note">
                每篇笔记会先调用“修复前版本快照”，只有快照成功后才会写入修复内容。
                后续可在该笔记的“历史”中恢复。
              </div>
            </div>
          )}

          <div className="library-reference-diagnosis-list">
            {(diagnosis.sources || [])
              .filter(source => source.repairable || source.broken)
              .map(source => (
                <article key={source.id} className="library-reference-diagnosis-row">
                  <button
                    type="button"
                    className="library-reference-diagnosis-main"
                    onClick={() => onOpenFile?.(source.id)}
                  >
                    <strong>{source.title}</strong>
                    <span>
                      {source.repairable ? source.repairable + ' 可修复' : ''}
                      {source.repairable && source.broken ? ' · ' : ''}
                      {source.broken ? source.broken + ' 需处理' : ''}
                    </span>
                  </button>
                  <div className="library-reference-diagnosis-badges">
                    {source.repairable > 0 && <span className="repairable">可修复</span>}
                    {source.broken > 0 && <span className="broken">需处理</span>}
                  </div>
                </article>
              ))}
          </div>

          {brokenSources.length > 0 && (
            <div className="library-reference-manual-note">
              <strong>为什么还有“需人工处理”？</strong>
              <span>
                这些引用指向已删除目标，或章节改名后存在多个同名候选。
                系统不会根据猜测批量改写。
              </span>
            </div>
          )}
        </>
      )}
    </section>
  )
}
