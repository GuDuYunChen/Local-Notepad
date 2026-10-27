import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_KEY, APPEARANCE_EVENT, APPEARANCE_EXTERNAL_EVENT, BUILTIN_SCHEMES,
  MAX_CUSTOM_SCHEMES, activeScheme, beginAppearancePreview, contrastRatio,
  defaultAppearance, downloadScheme, exportScheme, importScheme,
  installAppearanceRuntime, newCustomScheme, readAppearance, readThemeFile,
  saveAppearance, validateAppearance, validateScheme,
} from './localAppearance'
import { applyTheme, THEME_STORAGE_KEY } from './themePreference'

let dispose
const forest = () => ({ ...defaultAppearance(), activeId: 'forest' })
const custom = () => ({ id: 'custom-one', name: '个人方案', lightAccent: '#176b4a', darkAccent: '#80d6ad' })
const customState = () => ({ version: 1, activeId: 'custom-one', schemes: [custom()] })
beforeEach(() => {
  localStorage.clear(); document.documentElement.removeAttribute('style')
  document.documentElement.setAttribute('data-theme', 'light')
})
afterEach(() => { dispose?.(); dispose = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('local appearance data contracts', () => {
  it('has built-in palettes readable on both backgrounds', () => {
    for (const palette of BUILTIN_SCHEMES) {
      expect(validateScheme(JSON.parse(exportScheme(palette)).scheme, { portable: true }).name).toBe(palette.name)
    }
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
  })
  it('keeps missing preferences read-only', () => {
    expect(readAppearance()).toEqual({ raw: null, value: defaultAppearance(), error: '' })
    expect(localStorage.length).toBe(0)
  })
  it('persists, reads back, and reloads the exact validated configuration', () => {
    const original = readAppearance(), listener = vi.fn()
    window.addEventListener(APPEARANCE_EVENT, listener)
    const result = saveAppearance(customState(), original)
    expect(readAppearance()).toEqual(result)
    expect(activeScheme(result.value).name).toBe('个人方案')
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(APPEARANCE_EVENT, listener)
  })
  it.each(['{', 'null', '[]', '{"revision":"x","value":{}}', '{"revision":"x","value":{},"extra":1}'])('preserves invalid storage %s', raw => {
    localStorage.setItem(APPEARANCE_KEY, raw)
    expect(readAppearance().error).not.toBe('')
    expect(readAppearance().value).toEqual(defaultAppearance())
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe(raw)
  })
  it('requires explicit repair before replacing corrupt storage', () => {
    localStorage.setItem(APPEARANCE_KEY, '{')
    const baseline = readAppearance()
    expect(() => saveAppearance(forest(), baseline)).toThrow('明确确认')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('{')
    expect(saveAppearance(forest(), baseline, { repair: true }).value.activeId).toBe('forest')
  })
  it('does not overwrite unreadable data even with repair consent', () => {
    const storage = { getItem() { throw new Error('disabled') }, setItem: vi.fn() }
    const baseline = readAppearance(storage)
    expect(baseline.raw).toBeUndefined()
    expect(() => saveAppearance(forest(), baseline, { storage, repair: true })).toThrow('先成功读取')
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('refuses observed intervening writes rather than replacing them', () => {
    const baseline = readAppearance()
    const newer = saveAppearance(customState(), baseline)
    expect(() => saveAppearance(forest(), baseline)).toThrow('其它窗口')
    expect(readAppearance()).toEqual(newer)
  })
  it('changes the revision even for A-B-A configuration values', () => {
    const first = saveAppearance(forest(), readAppearance())
    const second = saveAppearance(defaultAppearance(), first)
    saveAppearance(forest(), second)
    expect(() => saveAppearance(customState(), first)).toThrow('其它窗口')
  })
  it('keeps previous data and reports a quota write failure', () => {
    const prior = saveAppearance(forest(), readAppearance())
    const storage = { getItem: () => prior.raw, setItem() { throw new Error('quota') } }
    expect(() => saveAppearance(customState(), prior, { storage })).toThrow('未能写入')
    expect(readAppearance()).toEqual(prior)
  })
  it('does not advertise success when the read-back changed', () => {
    const target = { dispatchEvent: vi.fn() }
    const storage = { getItem: vi.fn().mockReturnValueOnce(null).mockReturnValue('newer'), setItem: vi.fn() }
    expect(() => saveAppearance(forest(), { raw: null }, { storage, target })).toThrow('读回不一致')
    expect(target.dispatchEvent).not.toHaveBeenCalled()
  })
  it('reports an unavailable read-back without advertising success', () => {
    const storage = { getItem: vi.fn().mockReturnValueOnce(null).mockImplementation(() => { throw Error('denied') }), setItem: vi.fn() }
    const target = { dispatchEvent: vi.fn() }
    expect(() => saveAppearance(forest(), { raw: null }, { storage, target })).toThrow('无法读回确认')
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(target.dispatchEvent).not.toHaveBeenCalled()
  })
  it.each([
    { ...custom(), lightAccent: 'url(x)' }, { ...custom(), lightAccent: '#ffffff' },
    { ...custom(), darkAccent: '#000000' }, { ...custom(), darkAccent: '#fff' },
    { ...custom(), name: ' ' }, { ...custom(), name: 'x'.repeat(33) },
    { ...custom(), name: 'a\nb' }, { ...custom(), id: '../somewhere' },
    { ...custom(), style: 'display:none' }, null, [],
  ])('rejects an unsafe or unreadable scheme %#', value => {
    expect(() => validateScheme(value)).toThrow()
  })
  it('rejects unknown and duplicate active schemes', () => {
    expect(() => validateAppearance({ ...defaultAppearance(), activeId: 'missing' })).toThrow('不存在')
    expect(() => validateAppearance({ ...customState(), schemes: [custom(), custom()] })).toThrow('重复')
    expect(() => validateAppearance({ ...customState(), schemes: [{ ...custom(), name: '松林绿' }] })).toThrow('重复')
  })
  it('rejects unsupported config versions and arbitrary fields', () => {
    expect(() => validateAppearance({ ...forest(), version: 2 })).toThrow()
    expect(() => validateAppearance({ ...forest(), css: 'body {}' })).toThrow()
  })
  it('imports as a new ID without applying or overwriting same-name schemes', () => {
    const one = importScheme(exportScheme(custom()), [custom()])
    expect(one.id).not.toBe('custom-one'); expect(one.name).toBe('个人方案 2')
    expect(localStorage.length).toBe(0)
  })
  it('exports only portable palette data, not IDs or storage identity', () => {
    const data = JSON.parse(exportScheme(custom()))
    expect(Object.keys(data.scheme).sort()).toEqual(['darkAccent', 'lightAccent', 'name'])
    expect(Object.keys(data).sort()).toEqual(['format', 'scheme', 'version'])
  })
  it.each(['{', '{}', '{"format":"other","version":1,"scheme":{}}', '{"format":"local-notepad-appearance","version":2,"scheme":{}}'])('rejects incompatible imports %s', value => {
    expect(() => importScheme(value, [])).toThrow()
  })
  it('refuses oversized JSON and prototype fields', () => {
    expect(() => importScheme(' '.repeat(16385), [])).toThrow('16 KiB')
    const text = exportScheme(custom()).replace('"name":', '"__proto__": {}, "name":')
    expect(() => importScheme(text, [])).toThrow('结构')
    expect({}.polluted).toBeUndefined()
  })
  it('bounds the number of custom schemes and generates unique copies', () => {
    const schemes = []
    for (let i = 0; i < MAX_CUSTOM_SCHEMES; i++) schemes.push(newCustomScheme(BUILTIN_SCHEMES[1], schemes))
    expect(new Set(schemes.map(item => item.name)).size).toBe(MAX_CUSTOM_SCHEMES)
    expect(() => newCustomScheme(BUILTIN_SCHEMES[1], schemes)).toThrow('最多')
    expect(() => validateAppearance({ ...forest(), schemes: [...schemes, custom()] })).toThrow('超过')
  })
})

describe('appearance runtime and preview ownership', () => {
  it('does not persist anything or switch light/dark when starting', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark'); applyTheme('dark', { persist: false })
    dispose = installAppearanceRuntime()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
  })
  it('previews without saving, restores on cancel, and leaves authored colors alone', () => {
    dispose = installAppearanceRuntime()
    const node = document.createElement('span'); node.style.color = 'red'; document.body.append(node)
    const session = beginAppearancePreview(); session.show(forest())
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#176b4a')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
    expect(node.style.color).toBe('red')
    session.clear(); expect(document.documentElement.style.getPropertyValue('--clay')).toBe('')
    node.remove()
  })
  it('uses the correct palette after the existing theme switch', () => {
    saveAppearance(forest(), readAppearance()); dispose = installAppearanceRuntime()
    applyTheme('dark')
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#80d6ad')
    applyTheme('light')
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#176b4a')
  })
  it('restores existing inline values and priorities on default or disposal', () => {
    document.documentElement.style.setProperty('--clay', '#123456', 'important')
    dispose = installAppearanceRuntime()
    const session = beginAppearancePreview(); session.show(forest()); session.clear()
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#123456')
    expect(document.documentElement.style.getPropertyPriority('--clay')).toBe('important')
    session.show(forest()); dispose(); dispose = null
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#123456')
  })
  it('ignores cleanup from an older preview owner', () => {
    dispose = installAppearanceRuntime()
    const first = beginAppearancePreview(), second = beginAppearancePreview()
    first.show(forest()); second.show({ ...forest(), activeId: 'ocean' }); first.clear()
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#185fa5')
    second.clear(); expect(document.documentElement.style.getPropertyValue('--clay')).toBe('')
  })
  it('ignores a same-named sessionStorage event without losing the preview', () => {
    dispose = installAppearanceRuntime()
    const session = beginAppearancePreview(); session.show(forest())
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY, storageArea: sessionStorage }))
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#176b4a')
    session.clear()
  })
  it('drops previews on external writes and applies the actual new stored value', () => {
    dispose = installAppearanceRuntime()
    const session = beginAppearancePreview(); session.show(forest())
    const listener = vi.fn(); window.addEventListener(APPEARANCE_EXTERNAL_EVENT, listener)
    saveAppearance({ ...forest(), activeId: 'plum' }, readAppearance(), { target: null })
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY }))
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#85429a')
    session.clear(); expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#85429a')
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(APPEARANCE_EXTERNAL_EVENT, listener)
  })
  it('ignores unrelated storage changes and invalid previews', () => {
    dispose = installAppearanceRuntime()
    const session = beginAppearancePreview(); session.show(forest())
    window.dispatchEvent(new StorageEvent('storage', { key: 'editor:cache:a' }))
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#176b4a')
    expect(() => session.show({ ...forest(), activeId: 'unknown' })).toThrow()
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#176b4a')
  })
  it('does not retain a failed preview when saving a real selection', () => {
    dispose = installAppearanceRuntime()
    const session = beginAppearancePreview(); session.show(forest())
    saveAppearance({ ...forest(), activeId: 'ocean' }, readAppearance())
    session.clear()
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#185fa5')
  })
})

describe('bounded local theme file IO', () => {
  it('reads a real browser File as text', async () => {
    const text = exportScheme(custom())
    expect(await readThemeFile(new File([text], 'theme.json'))).toBe(text)
  })
  it.each([null, { size: 0 }, { size: 16385 }, { size: NaN }])('rejects invalid file size %#', async file => {
    await expect(readThemeFile(file)).rejects.toThrow('16 KiB')
  })
  it('honors already-aborted requests', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(readThemeFile(new File(['{}'], 'theme.json'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('aborts a hung read at the deadline', async () => {
    vi.useFakeTimers()
    let reader
    vi.stubGlobal('FileReader', class { constructor() { reader = this; this.readyState = 0 } readAsText() { this.readyState = 1 } abort = vi.fn() })
    const promise = readThemeFile({ size: 2 }, { timeout: 30 })
    const rejection = expect(promise).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(30); await rejection
    expect(reader.abort).toHaveBeenCalledTimes(1)
    expect(reader.onload).toBeNull()
  })
  it('cleans up a failed read and permits a fresh retry', async () => {
    let reader
    vi.stubGlobal('FileReader', class { constructor() { reader = this } readAsText() {} })
    const promise = readThemeFile({ size: 2 }); const rejection = expect(promise).rejects.toThrow('读取主题文件失败')
    reader.onerror(); await rejection
    expect(reader.onload).toBeNull()
  })
  it('releases download object URLs after navigation and does not touch storage', async () => {
    vi.useFakeTimers(); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:theme')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    downloadScheme(custom())
    expect(document.querySelector('a[download]')).toBeNull()
    expect(localStorage.length).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(revoke).toHaveBeenCalledWith('blob:theme')
  })
})
