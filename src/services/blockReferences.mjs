import { readWikiFile } from './wikiNavigation.mjs'
import { findReferenceBlock, referenceBlockText, requireBlockId } from './blockReferenceModel.mjs'
export async function readBlockReference(api, request, signal) {
  requireBlockId(request?.blockId)
  try {
    const file = await readWikiFile(api, { id: request.id }, signal)
    if (signal?.aborted) throw Object.assign(new Error('已停止读取。'), { code: 'cancelled' })
    const block = findReferenceBlock(file.content, request.blockId)
    return Object.freeze({ id: file.id, blockId: request.blockId, title: file.title, updatedAt: file.updated_at,
      text: referenceBlockText(block), blockJSON: JSON.stringify(block) })
  } catch (error) {
    if (['block-identity', 'block-missing', 'block-ambiguous', 'block-type', 'block-shape', 'block-limit', 'target', 'cancelled', 'timeout'].includes(error?.code)) throw error
    throw Object.assign(new Error('无法读取来源块，请检查本地服务后明确重试。'), { code: 'block-read' })
  }
}
// Bounded shared queue prevents a document full of embeds flooding the local API.
let running = 0
const waiting = []
function drain() {
  while (running < 4 && waiting.length) {
    const job = waiting.shift(); job.signal?.removeEventListener('abort', job.abort)
    if (job.signal?.aborted) { job.reject(new Error('已停止读取。')); continue }
    running++
    readBlockReference(job.api, job.request, job.signal).then(job.resolve, job.reject).finally(() => { running--; drain() })
  }
}
export function queueBlockReference(api, request, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('已停止读取。')); return }
    if (waiting.length >= 64) { reject(new Error('等待中的嵌入过多，请稍后手动刷新。')); return }
    const job = { api, request, signal, resolve, reject, abort: null }
    job.abort = () => { const index = waiting.indexOf(job); if (index >= 0) waiting.splice(index, 1); reject(new Error('已停止读取。')) }
    signal?.addEventListener('abort', job.abort, { once: true }); waiting.push(job); drain()
  })
}
