import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressImage } from './fileUpload'

describe('image compression completion and image bounds', () => {
  let reader, image, canvas
  beforeEach(() => {
    vi.useFakeTimers(); reader = undefined; image = undefined
    vi.stubGlobal('FileReader', class {
      constructor() { reader = this; this.readyState = 0 }
      readAsDataURL() { this.readyState = 1 }
      abort() { this.readyState = 2; this.onabort?.() }
    })
    vi.stubGlobal('Image', class { constructor() { image = this; this.width = 1800; this.height = 1500 } })
    canvas = { width: 0, height: 0, getContext: () => ({ drawImage(_image, _x, _y, width, height) { canvas.drawn = { width, height } } }), toBlob: fn => fn(new Blob(['jpg'], { type: 'image/jpeg' })) }
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(tag => tag === 'canvas' ? canvas : create(tag))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
  function load() { reader.readyState = 2; reader.onload({ target: { result: 'data:image/jpeg;base64,eA==' } }); image.onload() }
  it('fits BOTH maximum dimensions instead of using only the longer axis', async () => {
    const promise = compressImage(new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' }))
    load(); await promise
    expect(canvas.drawn.width).toBe(1296); expect(canvas.drawn.height).toBe(1080)
  })
  it('canvas failure rejects the operation instead of throwing out of the callback and hanging', async () => {
    canvas.getContext = () => null
    let settled = false, failure
    const promise = compressImage(new File(['jpg'], 'photo.jpg')).then(() => { settled = true }, error => { settled = true; failure = error })
    let callbackError
    try { load() } catch (error) { callbackError = error }
    await vi.advanceTimersByTimeAsync(16000)
    expect(callbackError).toBeUndefined(); expect(settled).toBe(true); expect(failure).toBeInstanceOf(Error)
    if (settled) await promise
  })
  it('a decoder which never replies has a bounded rejection', async () => {
    let settled = false, failure
    const promise = compressImage(new File(['jpg'], 'photo.jpg')).then(() => { settled = true }, error => { settled = true; failure = error })
    reader.readyState = 2; reader.onload({ target: { result: 'data:image/jpeg;base64,eA==' } })
    await vi.advanceTimersByTimeAsync(16000)
    expect(settled).toBe(true); expect(failure).toBeInstanceOf(Error)
    if (settled) await promise
  })
  it('a compressed JPEG has a JPEG extension without altering the original file', async () => {
    const file = new File(['webp'], 'photo.webp', { type: 'image/webp' })
    const promise = compressImage(file); load()
    const result = await promise
    expect(result.type).toBe('image/jpeg'); expect(result.name).toMatch(/\.jpe?g$/)
    expect(file.name).toBe('photo.webp'); expect(file.type).toBe('image/webp')
  })
  it('aborting before reading rejects without starting a decoder', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(compressImage(new File(['x'], 'x.jpg'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(reader).toBeUndefined(); expect(image).toBeUndefined()
  })
  it('cancelling pending encoding releases callbacks and rejects a late blob', async () => {
    let reply
    canvas.toBlob = callback => { reply = callback }
    const controller = new AbortController()
    const promise = compressImage(new File(['x'], 'x.jpg'), { signal: controller.signal })
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    load(); controller.abort(); await rejected
    expect(reader.onload).toBeNull(); expect(image.onload).toBeNull(); expect(canvas.width).toBe(0)
    reply(new Blob(['late'], { type: 'image/jpeg' })); expect(vi.getTimerCount()).toBe(0)
  })
  it('synchronous encoding exceptions are a recoverable rejection', async () => {
    canvas.toBlob = () => { throw new Error('encoding failed') }
    const promise = compressImage(new File(['x'], 'x.jpg'))
    const rejected = expect(promise).rejects.toThrow('encoding failed')
    load(); await rejected
  })
  it('a null encoded image is rejected and all timers are released', async () => {
    canvas.toBlob = callback => callback(null)
    const promise = compressImage(new File(['x'], 'x.jpg'))
    const rejected = expect(promise).rejects.toThrow('无法生成')
    load(); await rejected; expect(vi.getTimerCount()).toBe(0)
  })
  it('empty decoder dimensions cannot create an invalid canvas', async () => {
    const promise = compressImage(new File(['x'], 'x.jpg'))
    const rejected = expect(promise).rejects.toThrow('尺寸无效')
    image.width = 0; load(); await rejected
  })

})
