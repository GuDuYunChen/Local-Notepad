// Local keyboard preferences. This module owns one storage key and never edits notes.
export const SHORTCUT_STORAGE_KEY = 'local-notepad.shortcuts.v1'
export const SHORTCUT_MAX_BYTES = 16384

export const SHORTCUT_COMMANDS = Object.freeze([
  { id: 'quickSwitch', label: '快速切换笔记', category: '全局', defaultBinding: 'Mod+K', description: '按标题查找并打开笔记', keywords: ['quick', 'switch', 'search', '搜索'] },
  { id: 'globalSearch', label: '全局检索', category: '全局', defaultBinding: 'Mod+Shift+K', description: '检索正文、目录和上下文', keywords: ['global', 'search', '搜索'] },
  { id: 'shortcuts', label: '快捷键管理', category: '全局', defaultBinding: 'Mod+/', description: '查找命令并设置快捷键；F1 始终可以打开', keywords: ['keyboard', 'shortcut', 'help', '设置'] },
  { id: 'focusMode', label: '切换专注模式', category: '全局', defaultBinding: 'F11', description: '展开或收起写作空间', keywords: ['focus', '专注'] },
  { id: 'newNote', label: '新建笔记', category: '笔记', defaultBinding: 'Mod+N', description: '在笔记列表中新建笔记', keywords: ['new', 'note', '创建'] },
  { id: 'newFolder', label: '新建文件夹', category: '笔记', defaultBinding: 'Mod+Shift+N', description: '在笔记列表中新建文件夹', keywords: ['new', 'folder', '目录'] },
  { id: 'find', label: '文内查找', category: '编辑器', defaultBinding: 'Mod+F', description: '查找当前笔记中的文字，阅读模式也可用', keywords: ['find', 'search', '搜索'] },
  { id: 'replace', label: '文内替换', category: '编辑器', defaultBinding: 'Mod+H', description: '打开查找替换；替换需要编辑模式', keywords: ['replace', 'find'] },
  { id: 'commandPalette', label: '编辑器命令面板', category: '编辑器', defaultBinding: 'Mod+Shift+P', description: '查找并执行编辑器内容命令', keywords: ['command', 'palette', '插入'] },
  { id: 'outline', label: '切换文档目录', category: '编辑器', defaultBinding: 'Mod+Shift+O', description: '查看标题并定位章节', keywords: ['outline', 'heading', '大纲'] },
  { id: 'formula', label: '插入数学公式', category: '编辑器', defaultBinding: 'Mod+Alt+E', description: '在当前编辑位置插入公式', keywords: ['formula', 'math', 'katex'] },
  { id: 'checklist', label: '插入待办清单', category: '编辑器', defaultBinding: 'Mod+Alt+T', description: '插入或切换待办清单', keywords: ['todo', 'checklist', '任务'] },
  { id: 'copyReference', label: '复制笔记或章节引用', category: '编辑器', defaultBinding: 'Mod+Alt+R', description: '复制当前位置对应的笔记或章节引用', keywords: ['reference', 'link', 'wiki', '链接'] },
  { id: 'mergeCells', label: '合并表格单元格', category: '表格', defaultBinding: 'Mod+Alt+M', description: '合并当前选择的表格单元格', keywords: ['table', 'merge'] },
  { id: 'splitCell', label: '拆分表格单元格', category: '表格', defaultBinding: 'Mod+Alt+S', description: '拆分当前表格单元格', keywords: ['table', 'split'] },
].map(command => Object.freeze({ ...command, keywords: Object.freeze(command.keywords) })))

const commandIds = new Set(SHORTCUT_COMMANDS.map(command => command.id))
const modifierKeys = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph'])
const reserved = new Map([
  ['Mod+S', '保存笔记'], ['Mod+Shift+S', '另存为'],
  ['Mod+A', '全选'], ['Mod+C', '复制'], ['Mod+V', '粘贴'], ['Mod+X', '剪切'],
  ['Mod+Z', '撤销'], ['Mod+Shift+Z', '重做'], ['Mod+Y', '重做'],
  ['Mod+B', '加粗'], ['Mod+I', '斜体'], ['Mod+U', '下划线'],
  ['Mod+Shift+V', '粘贴纯文本'], ['Mod+Shift+F', '选择字体'],
  ['Mod+R', '重新加载'], ['Mod+Shift+R', '重新加载'],
  ['Mod+W', '关闭窗口'], ['Mod+Q', '退出应用'], ['Mod+P', '打印'],
  ['Mod+L', '地址栏'], ['Mod+T', '新建标签页'],
  ['Mod+Shift+I', '开发者工具'], ['Mod+Shift+J', '开发者工具'],
  ['F1', '快捷键帮助'], ['F2', '重命名'], ['F3', '查找导航'],
  ['F4', '窗口操作'], ['F5', '重新加载'], ['F12', '开发者工具'],
])

export const FIXED_SHORTCUTS = Object.freeze([
  { binding: 'Mod+S', label: '保存笔记', description: '保存正文；尚未应用的字段会明确提示' },
  { binding: 'F1', label: '打开快捷键管理', description: '始终保留的帮助入口' },
  { binding: 'F2', label: '重命名', description: '笔记或列表项目获得焦点时可用' },
  { binding: 'Mod+Z', label: '撤销', description: '由当前编辑器或笔记列表处理' },
  { binding: 'Mod+Shift+Z', label: '重做', description: '由当前编辑器或笔记列表处理' },
  { binding: 'Mod+C', label: '复制', description: '保留标准文本与表格复制操作' },
  { binding: 'Mod+V', label: '粘贴', description: '保留标准文本与表格粘贴操作' },
  { binding: 'Mod+Shift+F', label: '选择字体', description: '在编辑器中选择字体' },
  { binding: 'Mod+R', label: '重新加载', description: '桌面窗口的固定快捷键' },
].map(item => Object.freeze(item)))

const fail = (code, message, fields = {}) => ({ ok: false, error: { code, message, ...fields } })
const isRecord = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))

export function getDefaultShortcutBindings() {
  return Object.fromEntries(SHORTCUT_COMMANDS.map(command => [command.id, command.defaultBinding]))
}

export function normalizeShortcutBinding(value) {
  if (value === null) return { ok: true, binding: null }
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return fail('invalid-binding', '请选择有效的组合键。')
  const parts = value.split('+')
  const key = parts.pop()
  if (!key || new Set(parts).size !== parts.length || parts.some(part => !['Mod', 'Shift', 'Alt'].includes(part))) {
    return fail('invalid-binding', '组合键格式无法识别，请重新录入。')
  }
  if (!/^(?:[A-Z0-9]|[\/.,;\[\]\\\-=`']|F(?:[1-9]|1[0-2]))$/.test(key)) {
    return fail('unsupported-key', '请选择字母、数字、常用符号或 F6–F11。')
  }
  const hasMod = parts.includes('Mod')
  if (!hasMod && (parts.length !== 0 || !/^F\d+$/.test(key))) {
    return fail('modifier-required', '字母和符号需要搭配 Ctrl（Mac 为 ⌘），避免影响正常输入。')
  }
  const binding = [...(hasMod ? ['Mod'] : []), ...(parts.includes('Shift') ? ['Shift'] : []), ...(parts.includes('Alt') ? ['Alt'] : []), key].join('+')
  if (reserved.has(binding) || (/^F\d+$/.test(key) && key !== 'F6' && key !== 'F7' && key !== 'F8' && key !== 'F9' && key !== 'F10' && key !== 'F11')) {
    return fail('reserved', `该快捷键用于${reserved.get(binding) || '系统操作'}，请使用其他组合。`)
  }
  return { ok: true, binding }
}

function eventKey(event) {
  const key = String(event?.key || '')
  // Prefer the typed key, preserving keyboard layouts; code is a fallback for IME layouts.
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase()
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) return key
  const punctuation = {
    '/': '/', '?': '/', '.': '.', '>': '.', ',': ',', '<': ',', ';': ';', ':': ';',
    '[': '[', '{': '[', ']': ']', '}': ']', '\\': '\\', '|': '\\', '-': '-', '_': '-',
    '=': '=', '+': '=', '`': '`', '~': '`', "'": "'", '"': "'",
  }
  if (Object.hasOwn(punctuation, key)) return punctuation[key]
  const code = String(event?.code || '')
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  return null
}

export function isShortcutComposition(event) {
  return Boolean(event?.isComposing || event?.keyCode === 229 || event?.which === 229
    || event?.key === 'Process' || event?.key === 'Dead'
    || event?.getModifierState?.('AltGraph'))
}

export function shortcutFromEvent(event) {
  if (!event || isShortcutComposition(event) || event.repeat || (event.ctrlKey && event.metaKey)) return null
  const key = eventKey(event)
  if (!key) return null
  const hasMod = Boolean(event.ctrlKey || event.metaKey)
  return [...(hasMod ? ['Mod'] : []), ...(event.shiftKey ? ['Shift'] : []), ...(event.altKey ? ['Alt'] : []), key].join('+')
}

export function captureShortcut(event) {
  if (modifierKeys.has(String(event?.key || ''))) return fail('incomplete', '请再按一个字母、数字或功能键。')
  if (isShortcutComposition(event)) return fail('composing', '请先结束输入法组合，再录入快捷键。')
  if (event?.repeat) return fail('repeat', '请松开按键后重新录入。')
  const binding = shortcutFromEvent(event)
  if (!binding) return fail('unsupported-key', '无法使用这个按键，请选择其他组合。')
  return normalizeShortcutBinding(binding)
}

export function findShortcutConflict(bindings, commandId, binding) {
  if (binding === null) return null
  return SHORTCUT_COMMANDS.find(command => command.id !== commandId && bindings?.[command.id] === binding) || null
}

export function validateShortcutBindings(candidate) {
  if (!isRecord(candidate) || Object.keys(candidate).length > SHORTCUT_COMMANDS.length
    || Object.keys(candidate).some(id => !commandIds.has(id))) return fail('invalid-commands', '快捷键设置包含无法识别的命令。')
  const bindings = getDefaultShortcutBindings()
  for (const command of SHORTCUT_COMMANDS) {
    if (!Object.hasOwn(candidate, command.id)) continue
    const checked = normalizeShortcutBinding(candidate[command.id])
    if (!checked.ok) return { ...checked, error: { ...checked.error, commandId: command.id } }
    bindings[command.id] = checked.binding
  }
  const seen = new Map()
  for (const command of SHORTCUT_COMMANDS) {
    const binding = bindings[command.id]
    if (binding === null) continue
    const conflictCommand = seen.get(binding)
    if (conflictCommand) return fail('conflict', `该快捷键已分配给“${conflictCommand.label}”。`, { commandId: command.id, conflictCommand: conflictCommand.id })
    seen.set(binding, command)
  }
  return { ok: true, bindings }
}

export function parseShortcutPreferences(raw) {
  if (raw === null) return { ok: true, bindings: getDefaultShortcutBindings() }
  if (typeof raw !== 'string' || raw.length > SHORTCUT_MAX_BYTES) return fail('invalid-config', '本机快捷键配置无法识别。')
  try {
    const decoded = JSON.parse(raw)
    if (!isRecord(decoded) || decoded.schemaVersion !== 1
      || Object.keys(decoded).some(key => !['schemaVersion', 'bindings'].includes(key))
      || !Object.hasOwn(decoded, 'bindings')) return fail('invalid-config', '本机快捷键配置版本或结构无法识别。')
    return validateShortcutBindings(decoded.bindings)
  } catch {
    return fail('invalid-config', '本机快捷键配置无法读取。')
  }
}

export function serializeShortcutPreferences(bindings) {
  const checked = validateShortcutBindings(bindings)
  if (!checked.ok) return checked
  return { ok: true, raw: JSON.stringify({ schemaVersion: 1, bindings: checked.bindings }), bindings: checked.bindings }
}

// Exposed as a factory so tests can use isolated storage, with no access to user data.
export function createShortcutPreferenceStore({ getStorage = () => globalThis.localStorage, eventTarget = globalThis.window } = {}) {
  let initialized = false
  let baselineRaw
  let pendingWrite = null
  let snapshot = Object.freeze({ bindings: Object.freeze(getDefaultShortcutBindings()), revision: 0, status: 'ready', message: '' })
  const listeners = new Set()
  const notify = () => { for (const listener of [...listeners]) listener() }
  const storage = () => {
    const value = getStorage()
    if (!value || typeof value.getItem !== 'function' || typeof value.setItem !== 'function') throw new Error('storage unavailable')
    return value
  }
  const publish = ({ bindings = snapshot.bindings, status = 'ready', message = '', changed = false } = {}) => {
    snapshot = Object.freeze({ bindings: Object.freeze({ ...bindings }), revision: snapshot.revision + Number(changed), status, message })
    notify()
    return snapshot
  }
  const read = () => {
    initialized = true
    let raw
    try { raw = storage().getItem(SHORTCUT_STORAGE_KEY) } catch {
      publish({ status: 'unavailable', message: '无法读取本机快捷键设置，当前窗口保留原快捷键。请重试读取。' })
      return fail('read-failed', snapshot.message)
    }
    const checked = parseShortcutPreferences(raw)
    const changed = baselineRaw !== raw
    baselineRaw = raw
    pendingWrite = null
    if (!checked.ok) {
      publish({ bindings: getDefaultShortcutBindings(), changed, status: 'invalid', message: '本机快捷键配置无法识别，当前使用默认快捷键。请确认恢复默认后重新设置。' })
      return { ...fail('invalid-config', snapshot.message), snapshot }
    }
    if (changed || snapshot.status !== 'ready') publish({ bindings: checked.bindings, changed })
    return { ok: true, snapshot }
  }
  const getSnapshot = () => {
    if (!initialized) read()
    return snapshot
  }
  const onStorage = event => {
    if (event?.key !== null && event?.key !== SHORTCUT_STORAGE_KEY) return
    // Read the current bytes; an old queued storage event must not resurrect an old map.
    read()
  }
  const subscribe = listener => {
    if (listeners.size === 0) eventTarget?.addEventListener?.('storage', onStorage)
    listeners.add(listener)
    getSnapshot()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) eventTarget?.removeEventListener?.('storage', onStorage)
    }
  }
  const apply = (bindings, { expectedRevision, repairInvalid = false } = {}) => {
    getSnapshot()
    const serialized = serializeShortcutPreferences(bindings)
    if (!serialized.ok) return serialized
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== snapshot.revision) {
      return fail('changed', '快捷键设置已发生变化，请重新读取后再应用。')
    }
    if (snapshot.status === 'invalid' && !repairInvalid) return fail('repair-required', '请先确认恢复无法识别的快捷键配置。')
    let target
    let currentRaw
    try { target = storage(); currentRaw = target.getItem(SHORTCUT_STORAGE_KEY) } catch {
      publish({ status: 'unavailable', message: '无法读取本机快捷键设置，修改尚未应用。请重试。' })
      return fail('read-failed', snapshot.message)
    }
    if (pendingWrite?.raw === currentRaw) {
      // The read proves these bytes belong to our earlier unconfirmed write.
      // A current, explicit draft may replace them (including restoring defaults)
      // without activating that earlier draft. Keep this known baseline if the
      // replacement itself fails, so an explicit retry still works.
      baselineRaw = currentRaw
      if (serialized.raw === currentRaw) {
        pendingWrite = null
        publish({ bindings: serialized.bindings, changed: true })
        return { ok: true, snapshot }
      }
    }
    if (baselineRaw !== currentRaw) {
      read()
      return { ...fail('changed', '快捷键已在另一窗口或其他操作中更改，请重新读取后再应用。'), snapshot }
    }
    pendingWrite = { raw: serialized.raw }
    try { target.setItem(SHORTCUT_STORAGE_KEY, serialized.raw) } catch {
      publish({ status: 'unconfirmed', message: '无法确认快捷键已保存，当前窗口仍使用原快捷键。修改已保留，请重试。' })
      return fail('write-failed', snapshot.message)
    }
    try {
      if (target.getItem(SHORTCUT_STORAGE_KEY) !== serialized.raw) {
        publish({ status: 'unconfirmed', message: '快捷键写入后的核对未通过，当前窗口仍使用原快捷键。请重新读取或重试。' })
        return fail('verify-failed', snapshot.message)
      }
    } catch {
      publish({ status: 'unconfirmed', message: '快捷键已发起保存，但无法确认写入结果。当前窗口仍使用原快捷键，请重试核对。' })
      return fail('verify-failed', snapshot.message)
    }
    baselineRaw = serialized.raw
    pendingWrite = null
    publish({ bindings: serialized.bindings, changed: true })
    return { ok: true, snapshot }
  }
  return { getSnapshot, subscribe, apply, reload: read }
}

let defaultStore
const currentStore = () => defaultStore ||= createShortcutPreferenceStore()
export const getShortcutSnapshot = () => currentStore().getSnapshot()
export const subscribeShortcuts = listener => currentStore().subscribe(listener)
export const applyShortcutBindings = (bindings, options) => currentStore().apply(bindings, options)
export const reloadShortcutPreferences = () => currentStore().reload()

export function matchShortcut(event, id, bindings = getShortcutSnapshot().bindings) {
  return !event?.defaultPrevented && commandIds.has(id) && bindings[id] !== null
    && shortcutFromEvent(event) === bindings[id]
}

export function isShortcutContextBlocked(event, { allowDialogs = false, allowFormFields = true } = {}) {
  if (!event || event.defaultPrevented || event.repeat || isShortcutComposition(event)) return true
  const target = event.target?.nodeType === 1 ? event.target : globalThis.document?.activeElement
  if (target?.closest?.('[data-shortcut-recorder], [data-shortcut-settings]')) return true
  if (!allowDialogs && (target?.closest?.('[role="dialog"]')
    || globalThis.document?.querySelector?.('[role="dialog"][aria-modal="true"]'))) return true
  if (!allowFormFields && (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]'))) return true
  return false
}

export function formatShortcut(binding, mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '')) {
  if (binding === null || binding === undefined) return '未设置'
  return String(binding).split('+').map(part => part === 'Mod' ? (mac ? '⌘' : 'Ctrl') : part).join(' + ')
}

export const shortcutLabel = (id, bindings = getShortcutSnapshot().bindings) => formatShortcut(bindings[id])
