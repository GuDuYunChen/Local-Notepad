import { createHash } from 'node:crypto'
export const RESEARCH_FILE_ID = 'b10a6df6-a1bb-4f8c-8e09-c66f06b36b19'
export const researchHash = body => createHash('sha256').update(body.title + '\0' + (body.parent_id || '') + '\0' + body.content).digest('hex')
export function researchReceipt(path, body, patch = {}) {
  return { found: true, request_id: path.split('/').at(-1), payload_sha256: researchHash(body), file_id: RESEARCH_FILE_ID,
    title: body.title, parent_id: body.parent_id || '', created_at: 1790254800, state: 'available', ...patch }
}
export const testLocks = { request: (_name, options, fn) => options.signal?.aborted ? Promise.reject(new DOMException('aborted', 'AbortError')) : Promise.resolve().then(fn) }
