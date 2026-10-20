import { desktopNote } from './desktop-save-fixture.mjs'

export const SHORTCUT_FIXTURE = Object.freeze({
  title: '快捷键管理验收 2F101.md',
  heading: '快捷键管理验收',
  body: 'SHORTCUT101 original body — isolated desktop data',
  savedMarker: ' SHORTCUT101 real fixed save',
  binding: 'Mod+Alt+J',
})

// Use the existing production Lexical serializer; no handwritten editor state.
export function shortcutManagementNote(saved = false) {
  return desktopNote(SHORTCUT_FIXTURE.heading,
    SHORTCUT_FIXTURE.body + (saved ? SHORTCUT_FIXTURE.savedMarker : ''))
}
