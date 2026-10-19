import { describe, expect, it, vi } from 'vitest'
import { createEditorPendingDrafts } from './editorPendingDrafts.mjs'

function field(registry, label = '公式', value = 'x = 2', token = Symbol(label)) {
  const current = { label, value, dirty: true }
  current.discard = vi.fn(() => { current.dirty = false })
  const remove = registry.register(token, () => current)
  return { current, remove, token }
}

describe('one-editor unapplied draft registry', () => {
  it('requires an explicit exact review before discarding every pending field', () => {
    const registry = createEditorPendingDrafts()
    const formula = field(registry), embed = field(registry, '嵌入内容', 'unsubmitted')
    expect(registry.hasPending()).toBe(true)
    expect(registry.discard(undefined)).toBe(false)
    expect(formula.current.discard).not.toHaveBeenCalled()
    expect(registry.discard(registry.capture())).toBe(true)
    expect(formula.current.discard).toHaveBeenCalledOnce()
    expect(embed.current.discard).toHaveBeenCalledOnce()
    expect(registry.hasPending()).toBe(false)
  })
  it('refuses a field changed after review even before its React effect notifies', () => {
    const registry = createEditorPendingDrafts(), item = field(registry)
    const review = registry.capture()
    item.current.value = 'newer typing'
    expect(registry.discard(review)).toBe(false)
    expect(item.current.discard).not.toHaveBeenCalled()
    expect(registry.hasPending()).toBe(true)
  })
  it('refuses a change-and-return generation instead of accepting a stale review', () => {
    const registry = createEditorPendingDrafts(), item = field(registry)
    const review = registry.capture()
    item.current.value = 'other'; registry.changed()
    item.current.value = 'x = 2'; registry.changed()
    expect(registry.discard(review)).toBe(false)
    expect(item.current.discard).not.toHaveBeenCalled()
  })
  it('does not apply a review from another mounted editor or another node', () => {
    const a = createEditorPendingDrafts(), b = createEditorPendingDrafts()
    field(a); const item = field(b)
    expect(b.discard(a.capture())).toBe(false)
    expect(item.current.discard).not.toHaveBeenCalled()
    expect(a.hasPending()).toBe(true)
  })
  it('a newly mounted pending field invalidates an earlier empty review', () => {
    const registry = createEditorPendingDrafts(), review = registry.capture()
    const item = field(registry)
    expect(registry.discard(review)).toBe(false)
    expect(item.current.discard).not.toHaveBeenCalled()
  })
  it('preflights missing discard callbacks before clearing any other field', () => {
    const registry = createEditorPendingDrafts(), item = field(registry)
    registry.register(Symbol('broken'), () => ({ label: '嵌入内容', value: 'draft', dirty: true }))
    expect(registry.discard(registry.capture())).toBe(false)
    expect(item.current.discard).not.toHaveBeenCalled()
    expect(registry.capture().drafts).toHaveLength(2)
  })
  it('a failing field reset refuses navigation and retains unresolved state', () => {
    const registry = createEditorPendingDrafts(), item = field(registry)
    item.current.discard.mockImplementation(() => { throw new Error('field reset failed') })
    expect(registry.discard(registry.capture())).toBe(false)
    expect(registry.hasPending()).toBe(true)
  })
  it('does not mistake a callback that leaves dirty state for a completed discard', () => {
    const registry = createEditorPendingDrafts(), item = field(registry)
    item.current.discard.mockImplementation(() => {})
    expect(registry.discard(registry.capture())).toBe(false)
    expect(registry.hasPending()).toBe(true)
  })
  it('unregistering an older node never removes its replacement registration', () => {
    const registry = createEditorPendingDrafts(), token = Symbol('same-node')
    const old = field(registry, '公式', 'old', token)
    const replacement = field(registry, '公式', 'replacement', token)
    old.remove()
    expect(registry.capture().drafts.map(item => item.value)).toEqual(['replacement'])
    expect(registry.discard(registry.capture())).toBe(true)
    expect(old.current.discard).not.toHaveBeenCalled()
    expect(replacement.current.discard).toHaveBeenCalledOnce()
  })
  it('clean fields are neither pending nor reset and listeners stop after disposal', () => {
    const registry = createEditorPendingDrafts(), listener = vi.fn()
    const unsubscribe = registry.subscribe(listener), item = field(registry)
    expect(listener).toHaveBeenCalledOnce()
    item.current.dirty = false; registry.changed()
    expect(registry.hasPending()).toBe(false)
    expect(registry.discard(registry.capture())).toBe(true)
    expect(item.current.discard).not.toHaveBeenCalled()
    unsubscribe(); listener.mockClear(); item.remove(); registry.changed()
    expect(listener).not.toHaveBeenCalled()
  })
})
