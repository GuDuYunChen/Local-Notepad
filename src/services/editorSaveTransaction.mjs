// A bounded wait is NOT a rollback. A retry carries the same immutable request
// token and payload; the database receipt prevents a delayed duplicate write.
export const EDITOR_SAVE_WAIT_MS = 8000
export function createEditorSaveAttempt(id, expected, content, mappings = []) {
  if (!id || typeof expected !== 'string' || typeof content !== 'string') throw new Error('正文尚未加载完成')
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes)
  return Object.freeze({ id, content, expected,
    requestID: Array.from(bytes, n => n.toString(16).padStart(2, '0')).join(''),
    mappings: JSON.stringify(mappings),
  })
}
export async function boundedEditorRequest(load, path, init = {}, timeoutMs = EDITOR_SAVE_WAIT_MS) {
  const ctl = new AbortController(); let timer, abort
  const stopped = new Promise((_, reject) => {
    abort = () => {
      ctl.abort()
      reject(Object.assign(new Error('保存结果尚未确认，草稿已保留；请重试核对，不要清除缓存。'), { code: 'save-uncertain', name: init.signal?.aborted ? 'AbortError' : 'Error' }))
    }
    timer = setTimeout(abort, timeoutMs)
    init.signal?.addEventListener('abort', abort, { once: true })
  })
  try {
    if (init.signal?.aborted) abort()
    if (ctl.signal.aborted) return await stopped
    return await Promise.race([stopped, load(path, { ...init, signal: ctl.signal })])
  } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort) }
}
export async function commitEditorSave(load, attempt, signal, timeoutMs) {
  const result = await boundedEditorRequest(load, '/api/files/' + encodeURIComponent(attempt.id), {
    method: 'PUT', signal,
    body: JSON.stringify({ content: attempt.content, expected_content: attempt.expected,
      save_request_id: attempt.requestID, section_mappings: attempt.mappings }),
  }, timeoutMs)
  const receipt = result?.save_receipt
  if (result?.id !== attempt.id || typeof result.content !== 'string' ||
      receipt?.request_id !== attempt.requestID || typeof receipt.reference_pending !== 'boolean' ||
      !['applied', 'conflict', 'superseded'].includes(receipt.outcome)) {
    throw new Error('正文保存响应未确认，请检查前后端是否一起更新；当前草稿保留。')
  }
  if (receipt.outcome !== 'applied') {
    throw Object.assign(new Error('数据库中已有不同正文，当前草稿未被覆盖。请处理保存冲突后再保存。'), {
      code: 'save-conflict', currentFile: result,
    })
  }
  if (result.content !== attempt.content) throw new Error('正文保存回执与提交内容不一致，草稿保留。')
  return result
}
