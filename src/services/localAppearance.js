// Local-only appearance data. Never read/write note bodies, backend settings,
// arbitrary CSS, external fonts or URLs. The original light/dark choice is separate.
export const APPEARANCE_KEY = 'localNotepad.appearance.v1'
export const APPEARANCE_EVENT = 'appearance:changed'
export const APPEARANCE_EXTERNAL_EVENT = 'appearance:external-change'
export const MAX_CUSTOM_SCHEMES = 12
export const MAX_THEME_FILE_BYTES = 16 * 1024
const FORMAT = 'local-notepad-appearance'
const PAIRS = Object.freeze({ light: ['#ffffff', '#f6f6f8'], dark: ['#0f131a', '#232e3d'] })
export const BUILTIN_SCHEMES = Object.freeze([
  { id: 'default', name: '原生主题', lightAccent: '#7057d9', darkAccent: '#75baff' },
  { id: 'forest', name: '松林绿', lightAccent: '#176b4a', darkAccent: '#80d6ad' },
  { id: 'ocean', name: '海洋蓝', lightAccent: '#185fa5', darkAccent: '#88c9ff' },
  { id: 'plum', name: '梅子紫', lightAccent: '#85429a', darkAccent: '#deb1ef' },
].map(item => Object.freeze(item)))
const safeObject = value => value && Object.getPrototypeOf(value) === Object.prototype
function exactKeys(value, keys, label) {
  if (!safeObject(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error(`${label}结构不受支持`)
}
export function contrastRatio(a, b) {
  const luminance = hex => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('颜色必须是六位十六进制值，例如 #176b4a')
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const left = luminance(a), right = luminance(b)
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
}
export function validateScheme(value, { portable = false } = {}) {
  exactKeys(value, portable ? ['name', 'lightAccent', 'darkAccent'] : ['id', 'name', 'lightAccent', 'darkAccent'], '主题方案')
  if (!portable && !/^custom-[a-z0-9-]{1,64}$/.test(value.id)) throw new Error('自定义方案标识无效')
  if (typeof value.name !== 'string' || !value.name.trim() || [...value.name].length > 32 || /[\u0000-\u001f\u007f]/u.test(value.name)) throw new Error('方案名称须为 1～32 个字符，不能包含控制字符')
  for (const mode of ['light', 'dark']) {
    const color = value[`${mode}Accent`]
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('颜色必须是六位十六进制值，例如 #176b4a')
    if (PAIRS[mode].some(background => contrastRatio(color, background) < 4.5)) throw new Error(`${mode === 'light' ? '浅色' : '深色'}主题强调色与界面的对比度不足 4.5:1，请调整颜色`)
  }
  return { ...(!portable ? { id: value.id } : {}), name: value.name.trim(), lightAccent: value.lightAccent.toLowerCase(), darkAccent: value.darkAccent.toLowerCase() }
}
export function defaultAppearance() { return { version: 1, activeId: 'default', schemes: [] } }
export function validateAppearance(value) {
  exactKeys(value, ['version', 'activeId', 'schemes'], '外观配置')
  if (value.version !== 1 || !Array.isArray(value.schemes) || value.schemes.length > MAX_CUSTOM_SCHEMES) throw new Error(`配置版本无效或自定义方案超过 ${MAX_CUSTOM_SCHEMES} 个`)
  const schemes = value.schemes.map(item => validateScheme(item))
  const all = [...BUILTIN_SCHEMES, ...schemes]
  if (new Set(all.map(item => item.id)).size !== all.length) throw new Error('方案标识重复')
  if (new Set(all.map(item => item.name.toLocaleLowerCase())).size !== all.length) throw new Error('方案名称重复，请更换名称')
  if (!all.some(item => item.id === value.activeId)) throw new Error('当前方案不存在')
  return { version: 1, activeId: value.activeId, schemes }
}
export function activeScheme(value) {
  return [...BUILTIN_SCHEMES, ...value.schemes].find(item => item.id === value.activeId) || BUILTIN_SCHEMES[0]
}
function browserStorage() { return globalThis.localStorage }
export function readAppearance(storage) {
  let raw
  try {
    const target = storage ?? browserStorage()
    raw = target.getItem(APPEARANCE_KEY)
    if (raw === null) return { raw, value: defaultAppearance(), error: '' }
    if (typeof raw !== 'string' || raw.length > MAX_THEME_FILE_BYTES * 4) throw new Error('配置超限')
    const envelope = JSON.parse(raw)
    exactKeys(envelope, ['revision', 'value'], '存储配置')
    if (typeof envelope.revision !== 'string' || !/^[a-z0-9-]{1,80}$/.test(envelope.revision)) throw new Error('配置修订标识无效')
    return { raw, value: validateAppearance(envelope.value), error: '' }
  } catch {
    return { raw, value: defaultAppearance(), error: raw === undefined ? '无法读取本机外观配置；不会覆盖现有数据，请重试读取。' : '本机外观配置损坏或版本不兼容，已临时使用原生主题；原始数据未被覆盖。' }
  }
}
function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
export function newCustomScheme(scheme, existing, name = `${scheme.name} 副本`) {
  if (existing.length >= MAX_CUSTOM_SCHEMES) throw new Error(`最多保存 ${MAX_CUSTOM_SCHEMES} 个自定义方案`)
  const names = new Set([...BUILTIN_SCHEMES, ...existing].map(item => item.name.toLocaleLowerCase()))
  let candidate = [...name].slice(0, 26).join(''), count = 2
  while (names.has(candidate.toLocaleLowerCase())) candidate = `${[...name].slice(0, 26).join('')} ${count++}`
  return validateScheme({ id: `custom-${makeId()}`, name: candidate, lightAccent: scheme.lightAccent, darkAccent: scheme.darkAccent })
}
export function saveAppearance(value, baseline, { storage, repair = false, target = globalThis.window } = {}) {
  const normalized = validateAppearance(value)
  if (!baseline || baseline.raw === undefined) throw new Error('先成功读取本机配置，再应用方案')
  if (baseline.error && !repair) throw new Error('原配置有错误；请先明确确认恢复默认或修复配置')
  const store = storage ?? browserStorage()
  // This detects observed intervening writes; localStorage is not a cross-process
  // CAS transaction. The storage event also invalidates any open preview/session.
  if (store.getItem(APPEARANCE_KEY) !== baseline.raw) throw new Error('外观配置已在其它窗口更改，请重新载入后再应用')
  const raw = JSON.stringify({ revision: makeId(), value: normalized })
  try { store.setItem(APPEARANCE_KEY, raw) } catch { throw new Error('外观配置未能写入本机，原设置未被替换；可重试或取消预览') }
  let readBack
  try { readBack = store.getItem(APPEARANCE_KEY) } catch { throw new Error('配置写入后无法读回确认，请重新载入；不宣称保存成功') }
  if (readBack !== raw) throw new Error('写入后读回不一致，请重新载入；不宣称保存成功')
  target?.dispatchEvent(new CustomEvent(APPEARANCE_EVENT))
  return { raw, value: normalized, error: '' }
}
export function exportScheme(scheme) {
  const { name, lightAccent, darkAccent } = scheme
  const value = validateScheme({ name, lightAccent, darkAccent }, { portable: true })
  return JSON.stringify({ format: FORMAT, version: 1, scheme: value }, null, 2) + '\n'
}
export function importScheme(text, existing) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_THEME_FILE_BYTES) throw new Error('主题文件超过 16 KiB')
  let value
  try { value = JSON.parse(text) } catch { throw new Error('无法解析主题 JSON 文件') }
  exactKeys(value, ['format', 'version', 'scheme'], '导入文件')
  if (value.format !== FORMAT || value.version !== 1) throw new Error('不是受支持的 Local Notepad 主题文件')
  const scheme = validateScheme(value.scheme, { portable: true })
  return newCustomScheme(scheme, existing, scheme.name)
}
export function readThemeFile(file, { signal, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_THEME_FILE_BYTES) { reject(new Error('请选择不超过 16 KiB 的非空主题 JSON 文件')); return }
    const reader = new FileReader()
    let settled = false
    const finish = (error, text) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      reader.onload = reader.onerror = reader.onabort = null
      if (error) reject(error); else resolve(text)
    }
    const abort = () => { finish(new DOMException('已取消导入', 'AbortError')); if (reader.readyState === 1) reader.abort() }
    const timer = setTimeout(() => { finish(new Error('读取主题文件超时，请重试')); if (reader.readyState === 1) reader.abort() }, timeout)
    reader.onload = () => typeof reader.result === 'string' ? finish(null, reader.result) : finish(new Error('无法读取主题文件'))
    reader.onerror = () => finish(new Error('读取主题文件失败，请重新选择'))
    reader.onabort = () => finish(new DOMException('已取消导入', 'AbortError'))
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    try { reader.readAsText(file, 'utf-8') } catch { finish(new Error('读取主题文件失败')) }
  })
}
export function downloadScheme(scheme) {
  const bytes = exportScheme(scheme)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  try {
    anchor.href = url; anchor.download = 'local-notepad-theme.json'; anchor.hidden = true
    document.body.appendChild(anchor); anchor.click()
  } finally {
    anchor.remove()
    // The browser still needs to consume the navigation URL after click.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

const STYLE_KEYS = ['--clay', '--clay-hover', '--clay-light', '--clay-medium', '--action-fill', '--action-hover', '--on-accent', '--link', '--accent2']
let runtime = null
function mix(hex, background, amount) {
  const values = [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * amount + parseInt(background.slice(i, i + 2), 16) * (1 - amount)))
  return '#' + values.map(v => v.toString(16).padStart(2, '0')).join('')
}
export function installAppearanceRuntime({ document: doc = globalThis.document, target = globalThis.window, storage } = {}) {
  if (!doc || !target) return () => {}
  if (runtime) return () => {} // Exactly one startup owner, independent of menus.
  const root = doc.documentElement
  const original = new Map(STYLE_KEYS.map(key => [key, [root.style.getPropertyValue(key), root.style.getPropertyPriority(key)]]))
  const state = { preview: null, owner: null }
  const restore = () => { for (const [key, [value, priority]] of original) value ? root.style.setProperty(key, value, priority) : root.style.removeProperty(key) }
  const render = () => {
    const value = state.preview || readAppearance(storage).value
    const scheme = activeScheme(value)
    if (scheme.id === 'default') { restore(); return }
    const dark = root.getAttribute('data-theme') === 'dark'
    const accent = dark ? scheme.darkAccent : scheme.lightAccent
    const bg = dark ? '#1b2330' : '#ffffff'
    const tokens = [accent, accent, mix(accent, bg, 0.10), mix(accent, bg, 0.18), accent, accent, dark ? '#081523' : '#ffffff', accent, accent]
    STYLE_KEYS.forEach((key, i) => root.style.setProperty(key, tokens[i]))
  }
  const onStorage = event => {
    if (event.key !== APPEARANCE_KEY && event.key !== null) return
    if (event.storageArea) {
      try { if (event.storageArea !== (storage ?? browserStorage())) return } catch { return }
    }
    state.preview = null; state.owner = null; render()
    target.dispatchEvent(new CustomEvent(APPEARANCE_EXTERNAL_EVENT))
  }
  const onSaved = () => { state.preview = null; state.owner = null; render() }
  const observer = new MutationObserver(render)
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  target.addEventListener('theme:changed', render)
  target.addEventListener(APPEARANCE_EVENT, onSaved)
  target.addEventListener('storage', onStorage)
  runtime = { state, render }
  render()
  return () => {
    observer.disconnect(); target.removeEventListener('theme:changed', render)
    target.removeEventListener(APPEARANCE_EVENT, onSaved); target.removeEventListener('storage', onStorage)
    state.preview = null; state.owner = null; restore(); runtime = null
  }
}
export function beginAppearancePreview() {
  const owner = Symbol('appearance-preview')
  return {
    show(value) {
      const normalized = validateAppearance(value)
      if (!runtime) throw new Error('外观预览尚未初始化，请重新打开应用')
      runtime.state.preview = normalized; runtime.state.owner = owner; runtime.render()
    },
    clear() {
      if (runtime?.state.owner !== owner) return
      runtime.state.preview = null; runtime.state.owner = null; runtime.render()
    },
  }
}
