import { describe, expect, it, vi } from 'vitest'
import {
  SHORTCUT_COMMANDS, SHORTCUT_STORAGE_KEY, captureShortcut, createShortcutPreferenceStore,
  findShortcutConflict, formatShortcut, getDefaultShortcutBindings, isShortcutContextBlocked,
  matchShortcut, normalizeShortcutBinding, parseShortcutPreferences, serializeShortcutPreferences,
  validateShortcutBindings,
} from './localShortcuts'

function fixture(initial = null) {
  const values = new Map(initial === null ? [] : [[SHORTCUT_STORAGE_KEY, initial]])
  const storage = { getItem: vi.fn(key => values.get(key) ?? null), setItem: vi.fn((key, value) => values.set(key, value)) }
  const target = new EventTarget()
  const store = createShortcutPreferenceStore({ getStorage: () => storage, eventTarget: target })
  return { store, storage, values, target }
}
const config = bindings => serializeShortcutPreferences(bindings).raw
const event = (key, flags = {}) => ({ key, ctrlKey: true, ...flags })

describe('local shortcut keyboard ownership', () => {
  it('keeps the original fifteen command bindings unique and usable', () => {
    const bindings = getDefaultShortcutBindings()
    expect(Object.keys(bindings)).toHaveLength(15)
    expect(new Set(Object.values(bindings)).size).toBe(15)
    expect(validateShortcutBindings(bindings)).toEqual({ ok: true, bindings })
    for (const command of SHORTCUT_COMMANDS) expect(normalizeShortcutBinding(command.defaultBinding).ok).toBe(true)
  })
  it('matches a new key once and releases its old key immediately', () => {
    const bindings = { ...getDefaultShortcutBindings(), quickSwitch: 'Mod+Alt+J' }
    expect(matchShortcut(event('j', { altKey: true }), 'quickSwitch', bindings)).toBe(true)
    expect(matchShortcut(event('k'), 'quickSwitch', bindings)).toBe(false)
    expect(matchShortcut(event('J', { altKey: true, shiftKey: true }), 'quickSwitch', bindings)).toBe(false)
    expect(matchShortcut(event('j', { altKey: true, defaultPrevented: true }), 'quickSwitch', bindings)).toBe(false)
  })
  it.each([
    { isComposing: true }, { keyCode: 229 }, { which: 229 }, { repeat: true },
    { getModifierState: key => key === 'AltGraph' }, { metaKey: true },
  ])('does not run commands for composition, repeat, AltGraph or two primary modifiers: %j', flags => {
    expect(matchShortcut(event('k', flags), 'quickSwitch', getDefaultShortcutBindings())).toBe(false)
  })
  it('accepts Ctrl and Command, exact modifiers, and shifted punctuation', () => {
    expect(captureShortcut(event('K', { shiftKey: true })).binding).toBe('Mod+Shift+K')
    expect(captureShortcut(event('k', { ctrlKey: false, metaKey: true })).binding).toBe('Mod+K')
    expect(captureShortcut(event('?', { shiftKey: true })).binding).toBe('Mod+Shift+/')
    expect(captureShortcut(event('Process', { code: 'KeyK' })).ok).toBe(false)
    expect(captureShortcut(event('Dead', { code: 'KeyK' })).ok).toBe(false)
  })
  it.each(['Mod+S', 'Mod+Z', 'Mod+Shift+Z', 'Mod+C', 'Mod+Shift+F', 'Mod+R', 'F1', 'F2', 'F5', 'F12'])('preserves reserved key %s', binding => {
    expect(normalizeShortcutBinding(binding)).toMatchObject({ ok: false, error: { code: 'reserved' } })
  })
  it.each(['K', 'Shift+K', 'Alt+K', 'Mod+Mod+K', 'Mod+Ctrl+K', 'Mod+k', 'Mod+Enter', 'Mod+ArrowLeft', 'Mod+', '', 7, undefined])('rejects ambiguous, plain text or navigation binding %s', binding => {
    expect(normalizeShortcutBinding(binding).ok).toBe(false)
  })
  it('does not confuse split-cell, ordinary save, or an extra modifier', () => {
    const defaults = getDefaultShortcutBindings()
    expect(matchShortcut(event('s'), 'splitCell', defaults)).toBe(false)
    expect(matchShortcut(event('s', { altKey: true }), 'splitCell', defaults)).toBe(true)
    expect(matchShortcut(event('s', { altKey: true, shiftKey: true }), 'splitCell', defaults)).toBe(false)
  })
  it('clears one binding without assigning a substitute', () => {
    const bindings = { ...getDefaultShortcutBindings(), quickSwitch: null }
    expect(validateShortcutBindings(bindings).ok).toBe(true)
    expect(matchShortcut(event('k'), 'quickSwitch', bindings)).toBe(false)
    expect(formatShortcut(null)).toBe('未设置')
  })
  it('identifies the exact conflicting command before the user replaces it', () => {
    const defaults = getDefaultShortcutBindings()
    expect(findShortcutConflict(defaults, 'quickSwitch', 'Mod+F')?.id).toBe('find')
    expect(validateShortcutBindings({ ...defaults, quickSwitch: 'Mod+F' })).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect(validateShortcutBindings({ ...defaults, quickSwitch: 'Mod+F', find: null }).ok).toBe(true)
  })
  it('formats platform labels without changing stored keys', () => {
    expect(formatShortcut('Mod+Shift+K', false)).toBe('Ctrl + Shift + K')
    expect(formatShortcut('Mod+Shift+K', true)).toBe('⌘ + Shift + K')
  })
  it('ignores recorded keys and modal contexts, but allows an explicitly owned search dialog', () => {
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    const input = document.createElement('input')
    modal.append(input)
    document.body.append(modal)
    try {
      expect(isShortcutContextBlocked({ key: 'k', target: input })).toBe(true)
      expect(isShortcutContextBlocked({ key: 'f', target: input }, { allowDialogs: true })).toBe(false)
      modal.setAttribute('data-shortcut-settings', '')
      expect(isShortcutContextBlocked({ key: 's', target: input }, { allowDialogs: true })).toBe(true)
    } finally { modal.remove() }
  })
})

describe('local shortcut preference transactions', () => {
  it('uses defaults without writing anything on first open', () => {
    const { store, storage } = fixture()
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', bindings: getDefaultShortcutBindings() })
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('applies only verified bytes, notifies the active window, and survives a fresh store', () => {
    const { store, storage } = fixture()
    const before = store.getSnapshot()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const next = { ...before.bindings, quickSwitch: 'Mod+Alt+J' }
    expect(store.apply(next, { expectedRevision: before.revision }).ok).toBe(true)
    expect(store.getSnapshot().bindings.quickSwitch).toBe('Mod+Alt+J')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith(SHORTCUT_STORAGE_KEY, config(next))
    const restarted = createShortcutPreferenceStore({ getStorage: () => storage })
    expect(restarted.getSnapshot().bindings).toEqual(next)
    unsubscribe()
  })
  it('restores one command or all defaults through the same verified transaction', () => {
    const defaults = getDefaultShortcutBindings()
    const { store } = fixture(config({ ...defaults, quickSwitch: null, focusMode: 'Mod+Alt+J' }))
    expect(store.apply({ ...store.getSnapshot().bindings, quickSwitch: defaults.quickSwitch }, { expectedRevision: store.getSnapshot().revision }).ok).toBe(true)
    expect(store.getSnapshot().bindings.focusMode).toBe('Mod+Alt+J')
    expect(store.apply(defaults, { expectedRevision: store.getSnapshot().revision }).ok).toBe(true)
    expect(store.getSnapshot().bindings).toEqual(defaults)
  })
  it.each(['{bad', 'null', '[]', '{"schemaVersion":2,"bindings":{}}', '{"schemaVersion":1,"bindings":{"unknown":"Mod+K"}}', '{"schemaVersion":1,"bindings":{"quickSwitch":false}}', '{"schemaVersion":1,"bindings":{},"extra":true}', ' '.repeat(16385)])('retains damaged bytes until explicitly repaired', raw => {
    const { store, storage, values } = fixture(raw)
    const before = store.getSnapshot()
    expect(before.status).toBe('invalid')
    expect(before.bindings).toEqual(getDefaultShortcutBindings())
    expect(store.apply(before.bindings, { expectedRevision: before.revision })).toMatchObject({ ok: false, error: { code: 'repair-required' } })
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(values.get(SHORTCUT_STORAGE_KEY)).toBe(raw)
    expect(store.apply(before.bindings, { expectedRevision: before.revision, repairInvalid: true }).ok).toBe(true)
    expect(store.getSnapshot().status).toBe('ready')
  })
  it('rejects prototype and duplicate-key configuration as a whole', () => {
    expect(parseShortcutPreferences('{"schemaVersion":1,"bindings":{"__proto__":"Mod+K"}}').ok).toBe(false)
    expect(validateShortcutBindings(Object.assign(Object.create({ quickSwitch: 'Mod+K' }), { find: 'Mod+F' })).ok).toBe(false)
    expect(parseShortcutPreferences(config(getDefaultShortcutBindings()).replace('Mod+K', 'Mod+F')).ok).toBe(false)
  })
  it('keeps active bindings and edits unchanged after a quota failure, then allows explicit retry', () => {
    const { store, storage } = fixture()
    const before = store.getSnapshot()
    const next = { ...before.bindings, focusMode: 'Mod+Alt+J' }
    storage.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError: private value') })
    const failure = store.apply(next, { expectedRevision: before.revision })
    expect(failure).toMatchObject({ ok: false, error: { code: 'write-failed' } })
    expect(JSON.stringify(failure)).not.toContain('private value')
    expect(store.getSnapshot().bindings).toEqual(before.bindings)
    expect(store.getSnapshot().revision).toBe(before.revision)
    expect(store.apply(next, { expectedRevision: before.revision }).ok).toBe(true)
    expect(store.getSnapshot().bindings).toEqual(next)
  })
  it('does not claim success for a dropped write', () => {
    const { store, storage } = fixture()
    const before = store.getSnapshot()
    storage.setItem.mockImplementationOnce(() => {})
    expect(store.apply({ ...before.bindings, quickSwitch: null }, { expectedRevision: before.revision })).toMatchObject({ ok: false, error: { code: 'verify-failed' } })
    expect(store.getSnapshot().bindings).toEqual(before.bindings)
    expect(store.getSnapshot().status).toBe('unconfirmed')
  })
  it('reconciles an acknowledged read-back failure without writing the same bytes twice', () => {
    const { store, storage, values } = fixture()
    const before = store.getSnapshot()
    const next = { ...before.bindings, quickSwitch: null }
    storage.setItem.mockImplementationOnce((key, value) => {
      values.set(key, value)
      storage.getItem.mockImplementationOnce(() => { throw new Error('read back unavailable') })
    })
    expect(store.apply(next, { expectedRevision: before.revision }).ok).toBe(false)
    expect(store.getSnapshot().bindings.quickSwitch).toBe('Mod+K')
    expect(store.apply(next, { expectedRevision: before.revision }).ok).toBe(true)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().bindings.quickSwitch).toBeNull()
  })
  it('restores defaults over its own unconfirmed write without enabling that previous draft', () => {
    const { store, storage, values } = fixture()
    const before = store.getSnapshot()
    const next = { ...before.bindings, focusMode: 'Mod+Alt+J' }
    const observedBindings = []
    const stop = store.subscribe(() => observedBindings.push(store.getSnapshot().bindings.focusMode))
    storage.setItem.mockImplementationOnce((key, value) => {
      values.set(key, value)
      storage.getItem.mockImplementationOnce(() => { throw new Error('read back unavailable') })
    })
    expect(store.apply(next, { expectedRevision: before.revision })).toMatchObject({ ok: false, error: { code: 'verify-failed' } })
    expect(values.get(SHORTCUT_STORAGE_KEY)).toBe(config(next))
    expect(store.apply(before.bindings, { expectedRevision: before.revision }).ok).toBe(true)
    expect(values.get(SHORTCUT_STORAGE_KEY)).toBe(config(before.bindings))
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', bindings: before.bindings, revision: before.revision + 1 })
    expect(observedBindings).not.toContain('Mod+Alt+J')
    expect(storage.setItem).toHaveBeenCalledTimes(2)
    stop()
  })
  it('can retry an explicit reset when its first replacement of an unconfirmed write also fails', () => {
    const { store, storage, values } = fixture()
    const before = store.getSnapshot()
    const next = { ...before.bindings, focusMode: 'Mod+Alt+J' }
    storage.setItem.mockImplementationOnce((key, value) => {
      values.set(key, value)
      storage.getItem.mockImplementationOnce(() => { throw new Error('read back unavailable') })
    })
    expect(store.apply(next, { expectedRevision: before.revision }).ok).toBe(false)
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota unavailable') })
    expect(store.apply(before.bindings, { expectedRevision: before.revision })).toMatchObject({ ok: false, error: { code: 'write-failed' } })
    expect(store.getSnapshot().bindings).toEqual(before.bindings)
    expect(store.apply(before.bindings, { expectedRevision: before.revision }).ok).toBe(true)
    expect(store.getSnapshot().status).toBe('ready')
    expect(values.get(SHORTCUT_STORAGE_KEY)).toBe(config(before.bindings))
    expect(storage.setItem).toHaveBeenCalledTimes(3)
  })
  it('still refuses unknown external bytes after a pending write, including an explicit reset', () => {
    const { store, storage, values } = fixture()
    const before = store.getSnapshot()
    storage.setItem.mockImplementationOnce((key, value) => {
      values.set(key, value)
      storage.getItem.mockImplementationOnce(() => { throw new Error('read back unavailable') })
    })
    expect(store.apply({ ...before.bindings, focusMode: 'Mod+Alt+J' }, { expectedRevision: before.revision }).ok).toBe(false)
    const external = { ...before.bindings, focusMode: 'Mod+Alt+G' }
    values.set(SHORTCUT_STORAGE_KEY, config(external))
    expect(store.apply(before.bindings, { expectedRevision: before.revision })).toMatchObject({ ok: false, error: { code: 'changed' } })
    expect(values.get(SHORTCUT_STORAGE_KEY)).toBe(config(external))
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().bindings).toEqual(external)
    expect(store.apply(before.bindings, { expectedRevision: before.revision })).toMatchObject({ ok: false, error: { code: 'changed' } })
  })
  it('refuses to overwrite a changed local configuration with an older draft', () => {
    const { store, storage, values } = fixture()
    const before = store.getSnapshot()
    const external = { ...before.bindings, quickSwitch: 'Mod+Alt+J' }
    values.set(SHORTCUT_STORAGE_KEY, config(external))
    expect(store.apply({ ...before.bindings, focusMode: null }, { expectedRevision: before.revision })).toMatchObject({ ok: false, error: { code: 'changed' } })
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(store.getSnapshot().bindings).toEqual(external)
    expect(store.apply(before.bindings, { expectedRevision: before.revision })).toMatchObject({ ok: false, error: { code: 'changed' } })
  })
  it('reads current storage on external events and ignores a queued stale value', () => {
    const { store, values, target } = fixture()
    const original = store.getSnapshot()
    const subscriber = vi.fn()
    const stop = store.subscribe(subscriber)
    const latest = { ...original.bindings, quickSwitch: null }
    values.set(SHORTCUT_STORAGE_KEY, config(latest))
    const change = new Event('storage')
    Object.assign(change, { key: SHORTCUT_STORAGE_KEY, newValue: config(original.bindings) })
    target.dispatchEvent(change)
    expect(store.getSnapshot().bindings).toEqual(latest)
    expect(subscriber).toHaveBeenCalledTimes(1)
    stop()
  })
  it('rejects a failed initial read and recovers through an explicit read', () => {
    const { store, storage } = fixture()
    storage.getItem.mockImplementationOnce(() => { throw new Error('denied') })
    expect(store.getSnapshot().status).toBe('unavailable')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(store.reload().ok).toBe(true)
    expect(store.getSnapshot().status).toBe('ready')
  })
})
