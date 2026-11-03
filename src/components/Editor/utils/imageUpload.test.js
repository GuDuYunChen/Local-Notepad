import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { uploadImage, IMAGE_UPLOAD_TIMEOUT_MS } from './imageUpload'
const mocks = vi.hoisted(() => ({ compressImage: vi.fn(), uploadFile: vi.fn() }))
vi.mock('./fileUpload', () => mocks)

describe('single-attempt image upload and optional preview recovery', () => {
  let original, preview
  beforeEach(() => {
    vi.useFakeTimers()
    original = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'original.jpg', { type: 'image/jpeg' })
    preview = new File(['small'], 'original.jpg', { type: 'image/jpeg' })
    mocks.compressImage.mockReset().mockResolvedValue(preview)
    mocks.uploadFile.mockReset().mockResolvedValue({ url: '/uploads/1.jpg' })
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
  it('uploads original before preview and retains both exact receipts', async () => {
    mocks.uploadFile.mockImplementation(async file => ({ url: file === original ? '/uploads/1.jpg' : '/uploads/2.jpg' }))
    expect(await uploadImage(original)).toEqual({ src: '/uploads/2.jpg', originalSrc: '/uploads/1.jpg', alt: 'original.jpg', originalOnly: false })
    expect(mocks.uploadFile.mock.calls.map(([file]) => file)).toEqual([original, preview])
  })
  for (const error of [new Error('preview failure'), null, undefined, 'failure']) {
    it(`uses original if optional transport rejects with ${String(error)}`, async () => {
      mocks.uploadFile.mockImplementation(file => file === preview ? Promise.reject(error) : Promise.resolve({ url: '/uploads/1.jpg' }))
      expect(await uploadImage(original)).toMatchObject({ src: '/uploads/1.jpg', originalSrc: '/uploads/1.jpg', originalOnly: true })
      expect(mocks.uploadFile).toHaveBeenCalledTimes(2)
    })
  }
  it('does not upload a preview after required original failure', async () => {
    mocks.uploadFile.mockRejectedValue(new Error('missing original'))
    await expect(uploadImage(original)).rejects.toThrow('missing original')
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
  })
  for (const type of ['image/png', 'image/gif', 'image/svg+xml']) {
    it(`does not flatten ${type}`, async () => {
      await uploadImage(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'image.bin', { type }))
      expect(mocks.compressImage).not.toHaveBeenCalled(); expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    })
  }
  it('preserves small images unchanged', async () => {
    await uploadImage(preview)
    expect(mocks.compressImage).not.toHaveBeenCalled(); expect(mocks.uploadFile.mock.calls[0][0]).toBe(preview)
  })
  it('rejects non-images and oversized images before any transport', async () => {
    await expect(uploadImage(new File(['text'], 'x.txt', { type: 'text/plain' }))).rejects.toThrow('请选择图片')
    await expect(uploadImage(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' }))).rejects.toThrow('10 MB')
    expect(mocks.uploadFile).not.toHaveBeenCalled()
  })
  it('pre-cancelled operations never read or upload files', async () => {
    const c = new AbortController(); c.abort()
    await expect(uploadImage(original, { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.compressImage).not.toHaveBeenCalled(); expect(mocks.uploadFile).not.toHaveBeenCalled()
  })
  it('bounded original timeout aborts transport without retry and rejects late receipt', async () => {
    let finish
    mocks.uploadFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const promise = uploadImage(preview)
    const check = expect(promise).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(IMAGE_UPLOAD_TIMEOUT_MS)
    await check
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    expect(mocks.uploadFile.mock.calls[0][1].signal.aborted).toBe(true)
    finish({ url: '/uploads/late.jpg' }); await Promise.resolve()
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
  })
  it('optional preview timeout settles using original without uploading original twice', async () => {
    mocks.uploadFile.mockImplementation(file => file === original ? Promise.resolve({ url: '/uploads/1.jpg' }) : new Promise(() => {}))
    const promise = uploadImage(original)
    await vi.advanceTimersByTimeAsync(IMAGE_UPLOAD_TIMEOUT_MS)
    expect(await promise).toMatchObject({ src: '/uploads/1.jpg', originalOnly: true })
    expect(mocks.uploadFile).toHaveBeenCalledTimes(2)
  })
  it('abort during original upload settles even when the transport ignores cancellation', async () => {
    const c = new AbortController()
    mocks.uploadFile.mockImplementation(() => new Promise(() => {}))
    const promise = uploadImage(preview, { signal: c.signal })
    const check = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve(); c.abort(); await check
    expect(mocks.uploadFile.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('stale compression cannot start transport', async () => {
    let current = true
    mocks.compressImage.mockImplementation(async () => { current = false; return preview })
    await expect(uploadImage(original, { isCurrent: () => current })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.uploadFile).not.toHaveBeenCalled()
  })
  it('bad original receipt cannot create an image', async () => {
    mocks.uploadFile.mockResolvedValue({ url: '' })
    await expect(uploadImage(original)).rejects.toThrow('结果无效')
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
  })
  it('retains supported JPEG files whose browser MIME metadata is empty', async () => {
    const file = new File([original], 'camera.JPG', { type: '' })
    await expect(uploadImage(file)).resolves.toMatchObject({ originalSrc: '/uploads/1.jpg', alt: 'camera.JPG' })
    expect(mocks.compressImage).toHaveBeenCalledOnce(); expect(mocks.uploadFile).toHaveBeenCalledTimes(2)
  })
  it('does not flatten MIME-less PNG files selected by their extension', async () => {
    const file = new File([original], 'transparent.PNG', { type: '' })
    await expect(uploadImage(file)).resolves.toMatchObject({ originalSrc: '/uploads/1.jpg' })
    expect(mocks.compressImage).not.toHaveBeenCalled(); expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
  })

})
