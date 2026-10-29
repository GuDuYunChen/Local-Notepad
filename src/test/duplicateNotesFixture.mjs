import { createHash } from 'node:crypto'
export const duplicateBody = group => `重复正文 ${group} <b>literal</b> 😀`
export function duplicateFixture(sizes = [2, 3]) {
  const notes = [], groups = []
  sizes.forEach((size, index) => {
    const content = duplicateBody(index), content_hash = createHash('sha256').update(content).digest('hex'), content_bytes = Buffer.byteLength(content), ids = []
    for (let member = 0; member < size; member++) { const id = `note-${index}-${member}`; ids.push(id); notes.push({ id, title: `笔记 ${index}.${member}`, folder: member % 2 ? '其他目录' : '资料', parent_id: member % 2 ? 'other' : 'folder', updated_at: 100 + index, content_hash, content_bytes }) }
    if (size > 1) groups.push({ hash: content_hash, content_bytes, ids })
  })
  const duplicate_notes = groups.reduce((n, g) => n + g.ids.length, 0)
  return { version: 1, complete: true, revision: 'a'.repeat(64), captured_at: 1793250000, totals: { notes: notes.length, groups: groups.length, duplicate_notes, additional_copies: duplicate_notes - groups.length, content_bytes: notes.reduce((n, v) => n + v.content_bytes, 0), empty: 0, folders: 2, templates: 1, trash: 1 }, notes, groups }
}
