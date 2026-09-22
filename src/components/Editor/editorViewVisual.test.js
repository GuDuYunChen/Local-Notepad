import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EDITOR_VIEW_SETTINGS,
  normalizeEditorViewSettings,
} from './plugins/EditorViewSettingsPlugin'

describe('editor visual defaults', () => {
  it('uses the denser Office-inspired reading baseline', () => {
    expect(DEFAULT_EDITOR_VIEW_SETTINGS).toMatchObject({
      fontSize: 13,
      lineHeight: 1.7,
      pageWidth: 0,
      fontFamily: 'system',
    })
  })

  it('uses fluid width as the Office Viewer default', () => {
    expect(DEFAULT_EDITOR_VIEW_SETTINGS.pageWidth).toBe(0)
    expect(normalizeEditorViewSettings({})).toMatchObject({
      fontSize: 13,
      lineHeight: 1.7,
      pageWidth: 0,
    })
  })

  it('preserves explicit user view choices within supported bounds', () => {
    expect(normalizeEditorViewSettings({
      fontSize: 18,
      lineHeight: 2,
      pageWidth: 1040,
      fontFamily: 'serif',
      typewriter: true,
    })).toEqual({
      fontSize: 18,
      lineHeight: 2,
      pageWidth: 1040,
      fontFamily: 'serif',
      typewriter: true,
    })
  })
})
