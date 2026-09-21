import { describe, expect, it } from 'vitest'
import { getEditorShortcut } from './EditorShortcutPlugin'

describe('editor shortcuts', () => {
  it('maps reference copy to Ctrl/Cmd + Alt + R', () => {
    expect(getEditorShortcut({ ctrlKey: true, metaKey: false, altKey: true, key: 'r' }))
      .toBe('copy-reference')
    expect(getEditorShortcut({ ctrlKey: false, metaKey: true, altKey: true, key: 'R' }))
      .toBe('copy-reference')
  })

  it('preserves formula and checklist shortcuts', () => {
    expect(getEditorShortcut({ ctrlKey: true, altKey: true, key: 'e' })).toBe('formula')
    expect(getEditorShortcut({ ctrlKey: true, altKey: true, key: 't' })).toBe('checklist')
  })

  it('ignores shortcuts without the required modifiers', () => {
    expect(getEditorShortcut({ ctrlKey: true, altKey: false, key: 'r' })).toBeNull()
    expect(getEditorShortcut({ ctrlKey: false, metaKey: false, altKey: true, key: 'r' })).toBeNull()
  })
})
