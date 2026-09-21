import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EDITOR_VIEW_SETTINGS,
  getEditorWheelFontStep,
  normalizeEditorViewSettings,
} from './EditorViewSettingsPlugin'

describe('editor view settings', () => {
  it('normalizes persisted writing view preferences into supported bounds', () => {
    expect(normalizeEditorViewSettings({
      fontSize: 99,
      lineHeight: 0.8,
      pageWidth: 999,
      fontFamily: 'unknown',
      typewriter: true,
    })).toEqual({
      fontSize: 22,
      lineHeight: 1.4,
      pageWidth: DEFAULT_EDITOR_VIEW_SETTINGS.pageWidth,
      fontFamily: DEFAULT_EDITOR_VIEW_SETTINGS.fontFamily,
      typewriter: true,
    })
  })

  it('preserves supported width typography and writing mode preferences', () => {
    expect(normalizeEditorViewSettings({
      fontSize: 18,
      lineHeight: 2,
      pageWidth: 1040,
      fontFamily: 'serif',
      typewriter: false,
    })).toEqual({
      fontSize: 18,
      lineHeight: 2,
      pageWidth: 1040,
      fontFamily: 'serif',
      typewriter: false,
    })
  })

  it('maps Ctrl/Cmd + wheel to bounded font-size steps', () => {
    expect(getEditorWheelFontStep({ ctrlKey: true, deltaY: -10 })).toBe(1)
    expect(getEditorWheelFontStep({ metaKey: true, deltaY: 10 })).toBe(-1)
    expect(getEditorWheelFontStep({ ctrlKey: false, metaKey: false, deltaY: -10 })).toBe(0)
    expect(getEditorWheelFontStep({ ctrlKey: true, shiftKey: true, deltaY: -10 })).toBe(0)
  })
})
