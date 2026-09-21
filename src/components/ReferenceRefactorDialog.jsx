import React from 'react'
import { formatSectionPath } from './Editor/utils/referenceUtils'
import './ReferenceRefactorDialog.css'

function modeCopy(mode) {
  if (mode === 'rename') {
    return {
      title: '改名前检查引用影响',
      action: '继续改名',
      intro: '目标标题变化后，其他笔记中的 Wiki 引用标题可能需要同步。',
    }
  }
  if (mode === 'delete') {
    return {
      title: '删除前检查引用影响',
      action: '仍然移到回收站',
      intro: '删除目标后，这些跨笔记引用会变成失效引用。',
    }
  }
  if (mode === 'extract') {
    return {
      title: '拆出章节前检查引用',
      action: '拆出为独立笔记',
      intro: '拆出后，指向该章节及其子章节的引用会改为指向新笔记。',
    }
  }
  return {
    title: '章节结构变化影响',
    action: '保存结构变化',
    intro: '章节移动或重命名可能影响其他笔记中的章节级引用。',
  }
}

function issueLabel(issue) {
  if (issue === 'title-stale') return '标题需同步'
  if (issue === 'section-moved') return '章节可自动迁移'
  if (issue === 'section-missing') return '章节需人工确认'
  if (issue === 'target-missing') return '目标不存在'
  return issue
}

export default function ReferenceRefactorDialog({
  mode,
  targetTitle,
  nextTitle,
  plan,
  busy = false,
  onConfirm,
  onCancel,
  onOpenSource,
}) {
  if (!plan) return null

  const copy = modeCopy(mode)
  const summary = plan.summary || {}
  const sources = mode === 'structure'
    ? (plan.sources || []).filter(source => source.repairable || source.broken)
    : (plan.sources || [])
  const affectedReferenceCount = mode === 'structure'
    ? (Number(summary.repairable) || 0) + (Number(summary.broken) || 0)
    : (Number(summary.incomingReferences) || 0)

  return (
    <div
      className="modal-overlay consumer-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel?.()
      }}
    >
      <section
        className="modal consumer-modal reference-refactor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reference-refactor-title"
      >
        <header className="reference-refactor-head">
          <div>
            <div className="reference-refactor-eyebrow">Reference Safety</div>
            <h2 id="reference-refactor-title">{copy.title}</h2>
            <p>{copy.intro}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onCancel}
            disabled={busy}
            aria-label="关闭"
            title="关闭"
          >
            ×
          </button>
        </header>

        {(mode === 'rename' || mode === 'extract') && (
          <div className="reference-refactor-target-change">
            <code>{targetTitle || '未命名'}</code>
            <span>→</span>
            <code>{nextTitle || '未命名'}</code>
          </div>
        )}

        <div className="reference-refactor-summary">
          <div>
            <span>受影响引用</span>
            <strong>{affectedReferenceCount}</strong>
          </div>
          <div>
            <span>来源笔记</span>
            <strong>{mode === 'structure' ? sources.length : (summary.affectedFiles || 0)}</strong>
          </div>
          {mode !== 'delete' && (
            <>
              <div className={(summary.repairable || 0) > 0 ? 'warning' : ''}>
                <span>可安全同步</span>
                <strong>{summary.repairable || 0}</strong>
              </div>
              <div className={(summary.broken || 0) > 0 ? 'danger' : ''}>
                <span>需人工处理</span>
                <strong>{summary.broken || 0}</strong>
              </div>
            </>
          )}
        </div>

        {sources.length > 0 ? (
          <div className="reference-refactor-source-list">
            {sources.map(source => (
              <article key={source.id} className="reference-refactor-source">
                <header>
                  <button
                    type="button"
                    onClick={() => onOpenSource?.(source.id)}
                    disabled={busy}
                  >
                    {source.title}
                  </button>
                  <span>
                    {mode === 'delete'
                      ? source.references?.length || 0
                      : source.incomingReferences || 0} 处
                  </span>
                </header>

                {mode === 'delete' ? (
                  <div className="reference-refactor-delete-locations">
                    {(source.references || []).slice(0, 5).map((reference, index) => (
                      <div key={String(reference.ordinal) + ':' + index}>
                        <strong>{reference.targetTitle}</strong>
                        <span>
                          {formatSectionPath(reference.sourceSectionPath) || '笔记正文'}
                        </span>
                      </div>
                    ))}
                    {(source.references || []).length > 5 && (
                      <small>另有 {(source.references || []).length - 5} 处引用</small>
                    )}
                  </div>
                ) : (
                  <>
                    {(source.changes || []).length > 0 && (
                      <div className="reference-refactor-change-list">
                        {(source.changes || []).slice(0, 5).map(change => (
                          <div
                            key={String(change.ordinal) + ':' + change.before}
                            className="reference-refactor-change"
                          >
                            <div>
                              {(change.issues || []).map(issue => (
                                <span key={issue}>{issueLabel(issue)}</span>
                              ))}
                            </div>
                            <code>{change.before}</code>
                            <i>↓</i>
                            <code>{change.after}</code>
                          </div>
                        ))}
                      </div>
                    )}

                    {source.broken > 0 && (
                      <div className="reference-refactor-unresolved">
                        {source.broken} 处引用无法唯一判断，不会自动改写。
                      </div>
                    )}
                  </>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="reference-refactor-empty">
            没有其他笔记引用这个目标，可以直接继续。
          </div>
        )}

        <div className="reference-refactor-guidance">
          {mode === 'delete' ? (
            <>
              <strong>删除不会自动清除来源笔记里的引用。</strong>
              <span>建议先打开受影响来源决定替代内容；如果仍继续删除，4.20/4.21 的引用体检会持续标记这些断链。</span>
            </>
          ) : mode === 'extract' ? (
            <>
              <strong>新笔记会保留原章节路径。</strong>
              <span>来源引用在改写前都会创建版本快照；正文发生变化的来源会被跳过，不覆盖较新的内容。</span>
            </>
          ) : (
            <>
              <strong>可确定的引用可以在操作后自动同步。</strong>
              <span>同步前会创建版本快照；来源正文发生变化时会跳过，避免覆盖较新的内容。</span>
            </>
          )}
        </div>

        <div className="modal-actions consumer-modal-actions reference-refactor-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={'btn ' + (mode === 'delete' ? 'danger' : 'primary')}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '处理中…' : copy.action}
          </button>
        </div>
      </section>
    </div>
  )
}
