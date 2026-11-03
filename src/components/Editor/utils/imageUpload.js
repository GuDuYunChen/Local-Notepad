import { compressImage, uploadFile } from './fileUpload'

export const IMAGE_UPLOAD_TIMEOUT_MS = 30000
export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
const cancelled = () => new DOMException('图片上传已取消', 'AbortError')

function uploadOnce(file, { signal, isCurrent }) {
  // A timeout/cancellation settles even if a late transport callback ignores
  // abort. No automatic retry: a missing response is not proof of no write.
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    let settled = false, timer
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (error) { controller.abort(); reject(error) } else resolve(result)
    }
    const abort = () => finish(cancelled())
    if (signal?.aborted || !isCurrent()) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => finish(new Error('图片上传超时，请重新选择失败的图片')), IMAGE_UPLOAD_TIMEOUT_MS)
    Promise.resolve().then(() => {
      if (signal?.aborted || !isCurrent()) throw cancelled()
      return uploadFile(file, { signal: controller.signal })
    }).then(result => {
      if (signal?.aborted || !isCurrent()) { abort(); return }
      if (typeof result?.url !== 'string' || !result.url) { finish(new Error('图片上传结果无效')); return }
      finish(null, result)
    }, error => finish(error instanceof Error ? error : new Error('图片上传失败')))
  })
}

// The original is required and is uploaded at most once per explicit attempt.
// A failed optional preview must not discard it or silently upload it again.
export async function uploadImage(file, { signal, isCurrent = () => true } = {}) {
  const check = () => { if (signal?.aborted || !isCurrent()) throw cancelled() }
  check()
  // File.type may legitimately be empty on a file-picker upload. Preserve
  // supported image extensions; the existing server still sniffs the bytes.
  const extension = String(file?.name || '').match(/\.(jpe?g|png|gif|webp|svg|bmp|ico)$/i)?.[1].toLowerCase()
  const extensionType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' }[extension]
  const type = file?.type?.toLowerCase() || extensionType || ''
  if (!file || !type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) throw new Error('单张图片不能超过 10 MB')
  let compressed = null, originalOnly = false
  const skipCompression = ['image/png', 'image/gif', 'image/svg+xml'].includes(type)
  if (!skipCompression && file.size > 2 * 1024 * 1024) {
    try { compressed = await compressImage(file, { signal }) }
    catch (error) { check(); if (error?.name === 'AbortError') throw error; originalOnly = true }
  }
  check()
  const original = await uploadOnce(file, { signal, isCurrent })
  check()
  let preview = original
  if (compressed) {
    try { preview = await uploadOnce(compressed, { signal, isCurrent }) }
    catch (error) { check(); if (error?.name === 'AbortError') throw error; originalOnly = true }
  }
  check()
  return { src: preview.url, originalSrc: original.url, alt: file.name || '图片', originalOnly }
}

export function imageFailureMessage(inserted, failures, entry) {
  const names = failures.slice(0, 3).map(name => String(name || '未命名图片').slice(0, 60)).join('、')
  const more = failures.length > 3 ? '等' : ''
  return `已插入 ${inserted} 张图片，${failures.length} 张失败：${names}${more}。请重新${entry}失败的图片（单张不超过 10 MB）。`
}
