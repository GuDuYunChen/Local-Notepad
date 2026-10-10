import { extractHeadingReferences, planTargetReferenceRefactor } from '../components/Editor/utils/referenceUtils.js'
import { boundedEditorRequest } from './editorSaveTransaction.mjs'

// Runs outside every body-save promise. The database owns pending work, not an
// in-memory timer: app restart or closing the window cannot lose the mapping.
export async function maintainSavedReferences({ load, listFiles, hasDraft, signal, retryManual = false }) {
  const jobs = await boundedEditorRequest(load, '/api/editor-reference-jobs', { signal })
  if (!Array.isArray(jobs)) throw new Error('引用待办响应无效')
  let done = 0, pending = 0
  for (const job of jobs) {
    if (signal?.aborted) break
    if (job.state === 'manual' && !retryManual) { pending++; continue }
    try {
      const files = await listFiles(signal)
      const target = files.find(file => file.id === job.file_id)
      if (!target || JSON.stringify(extractHeadingReferences(target.content)) !== JSON.stringify(extractHeadingReferences(job.after_content))) {
        pending++; continue // a newer structural edit needs a fresh plan, not a guess
      }
      const previous = files.map(file => file.id === job.file_id ? { ...file, content: job.before_content } : file)
      const plan = planTargetReferenceRefactor(previous, job.file_id, { title: target.title,
        content: job.after_content, sectionPathMappings: JSON.parse(job.section_mappings) })
      const updates = (plan.sources || []).filter(source => source.repairContent).map(source => ({
        id: source.id, expected_content: source.content, content: source.repairContent,
      }))
      // Ambiguous references and active drafts never receive automatic writes.
      const manual = !!plan.summary?.broken || updates.some(source => source.id === job.file_id || hasDraft(source.id))
      const result = await boundedEditorRequest(load, '/api/editor-reference-jobs/' + job.request_id, {
        method: 'POST', signal, body: JSON.stringify({ state: manual ? 'manual' : 'done', target_content: target.content,
          updates: manual ? [] : updates }),
      })
      if (result !== true) throw new Error('引用维护未确认')
      if (manual) pending++; else done++
    } catch { pending++ }
  }
  return { done, pending, limited: jobs.length === 100 }
}
