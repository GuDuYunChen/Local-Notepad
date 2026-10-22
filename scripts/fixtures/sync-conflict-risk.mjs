import { queueFixture, queueAttachment } from './sync-conflict-queue.mjs'
export const tombstone = record => ({ format: record.format, version: record.version, kind: record.kind, id: record.id, state: 'purged' })
export function riskFixture() {
  const values = queueFixture(6)
  values[1].remote_record = tombstone(values[1].remote_record)
  values[2].local_record.file.is_deleted = true
  values[3].remote_record = null; values[3].remote_hash = ''
  values[4].local_record.file.is_deleted = 'false'
  values[5].local_record.file.is_deleted = true
  values[5].remote_record = tombstone(values[5].remote_record)
  return [...values, queueAttachment()]
}
