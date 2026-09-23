import React from 'react'
import { toast } from '~/services/toast'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { createTextEvidenceTarget, createWikiEvidenceTarget } from './Editor/utils/evidenceNavigationUtils'

import './Editor/plugins/EvidenceNavigationPlugin.css'

export default function EvidenceLocateButton({ chapterId, content, sample, noteId, occurrence = 0, onOpenFile, label }) {
  const locate = () => {
    if (!chapterId || !onOpenFile || content == null) return
    const target = sample
      ? createTextEvidenceTarget(content, sample)
      : createWikiEvidenceTarget(content, noteId, occurrence)
    if (!target) { toast.warning('证据位置不可用，请刷新证据或直接打开章节'); return }
    const id = evidenceNavigation.start(chapterId, target, () => {
      toast.warning('章节尚未就绪，定位请求已取消；可在章节打开后重新定位')
    })
    const failed = () => {
      if (evidenceNavigation.cancel(id)) toast.error('打开证据章节失败，定位已取消')
    }
    try {
      Promise.resolve(onOpenFile(chapterId)).then(accepted => {
        if (accepted === false) evidenceNavigation.cancel(id)
      }, failed)
    } catch { failed() }
  }
  return (
    <button type="button" className="project-entity-evidence-locate"
      disabled={!chapterId || !onOpenFile || content == null} aria-label={label} onClick={locate}>
      定位此处
    </button>
  )
}
