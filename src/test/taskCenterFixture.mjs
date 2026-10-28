import { createHash } from 'node:crypto'
export const taskFixtureBody = (count = 60) => Array.from({ length: count }, (_, i) => `- [ ] 任务 ${i + 1}`).join('\n')
export function taskCenterFixture(count = 60) {
  const body = taskFixtureBody(count), now = 1793188800
  return { version: 1, complete: true, revision: 'a'.repeat(64), captured_at: now,
    totals: { notes: 1, with_tasks: count ? 1 : 0, unsupported: 0, tasks: count, pending: count, done: 0, folders: 0, templates: 0, trash: 0 },
    notes: [{ id: 'task-source', title: '待办源笔记', updated_at: now, content_hash: createHash('sha256').update(body).digest('hex'), supported: true }],
    items: Array.from({ length: count }, (_, i) => ({ note_id: 'task-source', ordinal: i + 1, text: `任务 ${i + 1}`, done: false, format: 'markdown', line: i + 1, block_id: '', truncated: false })) }
}
