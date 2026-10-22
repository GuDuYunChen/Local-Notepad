import { createHash } from 'node:crypto'
import { READING_CHECKS, READING_ATTEMPTS, READING_MODE_VERSION, READING_SCREENSHOTS, READING_DRAFT_VALUES as text } from './reading-mode-desktop-evidence.mjs'
import { readingModeDesktopFixture } from './reading-mode-desktop-fixture.bundle.mjs'
import { READING_FORMULA_SELECTOR, READING_EMBED_URL_SELECTOR, READING_EMBED_TITLE_SELECTOR } from './reading-mode-native-input.mjs'
import { DESKTOP_ACCESSIBILITY_SOURCE, UNAPPLIED_QUIT_DIALOG_CAPTION, UNAPPLIED_QUIT_DIALOG_TITLE, UNAPPLIED_QUIT_DIALOG_MESSAGE } from './desktop-window-target.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const body = value => { const content = JSON.stringify(value); return { content, sha256: hash(content) } }
const node = (value, type) => value.root.children.find(item => item.type === type)
const selection = (selector, value, formula = false) => ({
  selector, found: true, focused: true, tagName: formula ? 'TEXTAREA' : 'INPUT',
  type: formula ? 'textarea' : 'text', value, readOnly: false, disabled: false,
  selectionStart: 0, selectionEnd: value.length,
})
const formulaSelection = value => selection(READING_FORMULA_SELECTOR, value, true)
const titleSelection = value => selection(READING_EMBED_TITLE_SELECTOR, value)
const urlReplacement = (before, after) => {
  const observation = value => ({ ...selection(READING_EMBED_URL_SELECTOR, value), type: 'url', selectionStart: null, selectionEnd: null })
  return { strategy: 'native-line-selection-backspace-observed-empty',
    before: observation(before), cleared: observation(''), after: observation(after) }
}
function ui(formula, title, pending = [], reading = false, patch = {}) {
  return { reading, sourceVisible: true, destinationVisible: false,
    formulaExpression: formula, formulaBlock: true, formulaDraft: null, formulaDraftBlock: null,
    embedTitle: title, iframeSrc: null, embedDraftURL: null, embedDraftTitle: null,
    pendingText: pending.map(kind => kind === 'formula' ? '公式' : '嵌入内容').join('、'),
    notices: { formula: reading && pending.includes('formula') ? '有未应用的公式修改' : '',
      embed: reading && pending.includes('embed') ? '有未应用的嵌入修改' : '' },
    dialogTitle: '', dialogMessage: '', saveReady: false, failureText: '', ...patch }
}
function resumed(kind, formula, title) {
  return ui(formula, title, [kind], false, kind === 'formula'
    ? { formulaExpression: null, formulaBlock: null, formulaDraft: text.formulaPending, formulaDraftBlock: false }
    : { embedTitle: '', embedDraftURL: text.embedPendingURL, embedDraftTitle: text.embedPendingTitle })
}
function navigation(kind, formula, title, sha256) {
  const failureText = (kind === 'formula' ? '公式' : '嵌入内容') + '有未应用更改。'
  const dialog = { dialogTitle: '当前笔记未保存', dialogMessage: '还有未应用的块或源码更改。', buttonEnabled: true, bodySHA256: sha256 }
  return {
    cancel: { ...dialog, buttonLabel: '取消', dialogRemained: false, ui: ui(formula, title, [kind], true) },
    save: { ...dialog, buttonLabel: '保存', dialogRemained: true, failureText,
      ui: ui(formula, title, [kind], true, { dialogTitle: dialog.dialogTitle, dialogMessage: dialog.dialogMessage, saveReady: true, failureText }) },
    returned: { ui: resumed(kind, formula, title), bodySHA256: sha256 },
  }
}

// Synthetic contract-test objects only. The canonical serializer supplies body
// shape, not a desktop execution result or evidence that native input occurred.
export function readingEvidenceFixture({ processID = 104 } = {}) {
  const original = JSON.parse(readingModeDesktopFixture()), originalBody = body(original)
  const caption = structuredClone(original); node(caption, 'image').caption = 'reading100-native-caption'
  const captionBody = body(caption)
  const initial = structuredClone(caption); node(initial, 'todo').checked = true
  const before = body(initial)
  const appliedFormula = structuredClone(initial); node(appliedFormula, 'formula').expression = text.formulaApplied
  const afterFormula = body(appliedFormula)
  const appliedEmbed = structuredClone(appliedFormula)
  Object.assign(node(appliedEmbed, 'embed'), { url: text.embedAppliedURL, title: text.embedAppliedTitle })
  const afterEmbed = body(appliedEmbed)
  const executablePath = 'C:\\owned-reading-contract\\Notepad.exe'
  const main = { pid: processID, handle: 300, title: '记事本', cls: 'Chrome_WidgetWin_1',
    visible: true, childText: ['Chrome Legacy Window'], image: executablePath }
  const dialog = { pid: processID, handle: 400, title: UNAPPLIED_QUIT_DIALOG_CAPTION, cls: '#32770',
    visible: true, childText: ['OK'], image: executablePath }
  const boundWindow = Object.fromEntries(['pid', 'handle', 'image', 'title', 'cls', 'visible'].map(key => [key, dialog[key]]))
  dialog.accessibility = { source: DESKTOP_ACCESSIBILITY_SOURCE, status: 'complete', budgetMs: 2000, elapsedMs: 12,
    boundWindow, revalidatedWindow: { ...boundWindow }, root: { pid: processID, handle: 400, name: 'Error', cls: '#32770' },
    elements: [UNAPPLIED_QUIT_DIALOG_TITLE, UNAPPLIED_QUIT_DIALOG_MESSAGE, 'OK'].map(name => ({ pid: processID, handle: 0, name, cls: 'Text' })),
    errorCode: null, errorType: null }
  const pendingDrafts = {
    destinationNoteID: 'synthetic-navigation-target', destinationBodySHA256: '6'.repeat(64),
    bodies: { before, afterFormula, afterEmbed, final: { ...afterEmbed } },
    formula: {
      pendingSelection: formulaSelection(text.formulaOriginal),
      reading: ui(text.formulaOriginal, text.embedOriginalTitle, ['formula'], true), readingBodySHA256: before.sha256,
      navigation: navigation('formula', text.formulaOriginal, text.embedOriginalTitle, before.sha256),
      cancelled: { ui: ui(text.formulaOriginal, text.embedOriginalTitle), bodySHA256: before.sha256 },
      appliedSelection: formulaSelection(text.formulaOriginal), saveKey: 'Control+S',
      saved: ui(text.formulaApplied, text.embedOriginalTitle),
    },
    embed: {
      pendingURL: urlReplacement(text.embedOriginalURL, text.embedPendingURL),
      pendingTitleSelection: titleSelection(text.embedOriginalTitle),
      reading: ui(text.formulaApplied, text.embedOriginalTitle, ['embed'], true), readingBodySHA256: afterFormula.sha256,
      navigation: navigation('embed', text.formulaApplied, text.embedOriginalTitle, afterFormula.sha256),
      cancelled: { ui: ui(text.formulaApplied, text.embedOriginalTitle), bodySHA256: afterFormula.sha256 },
      appliedURL: urlReplacement(text.embedOriginalURL, text.embedAppliedURL),
      appliedTitleSelection: titleSelection(text.embedOriginalTitle), saveKey: 'Control+S',
      saved: ui(text.formulaApplied, text.embedAppliedTitle),
    },
    quit: {
      formulaSelection: formulaSelection(text.formulaApplied),
      embedURL: urlReplacement(text.embedAppliedURL, text.embedPendingURL), embedTitleSelection: titleSelection(text.embedAppliedTitle),
      before: ui(text.formulaApplied, text.embedAppliedTitle, ['formula', 'embed'], true),
      after: ui(text.formulaApplied, text.embedAppliedTitle, ['formula', 'embed'], true),
      beforeBodySHA256: afterEmbed.sha256, afterBodySHA256: afterEmbed.sha256,
      timeOriginBefore: 10000, timeOriginAfter: 10000, executablePath, windowTitle: main.title, target: { ...main },
      windowsBeforeClose: [{ ...main }], windowsDuringBlock: [{ ...main }, { ...dialog }],
      dialog: { ...dialog }, windowsAfterDismiss: [{ ...main }],
      processStillAlive: true, backendStillAlive: true, dismissed: true,
      dialogEvidence: 'native-window-title-and-child-text',
      helperEvents: ['inspect', 'close', 'inspect', 'dismiss-unapplied', 'inspect'].map((type, index) => ({
        type, completed: true, pid: processID, id: index + 3, elapsedMs: index + 10,
      })),
    },
    recovery: {
      returned: ui(text.formulaApplied, text.embedAppliedTitle, ['formula', 'embed'], false, {
        formulaExpression: null, formulaBlock: null, formulaDraft: text.formulaQuit, formulaDraftBlock: false,
        embedTitle: '', embedDraftURL: text.embedPendingURL, embedDraftTitle: text.embedPendingTitle,
      }),
      cancelled: ui(text.formulaApplied, text.embedAppliedTitle), saveKey: 'Control+S', bodySHA256: afterEmbed.sha256,
      destination: ui(text.formulaOriginal, text.embedOriginalTitle, [], false, { sourceVisible: false, destinationVisible: true }),
      destinationBodySHA256: '6'.repeat(64), reopened: ui(text.formulaApplied, text.embedAppliedTitle),
    },
  }
  const quit = pendingDrafts.quit
  const fresh = quit.helperEvents.find(event => event.type === 'dismiss-unapplied')
  fresh.window = structuredClone(dialog); fresh.windows = [structuredClone(main), structuredClone(dialog)]
  const changes = [
    ['before-close', 0, quit.windowsBeforeClose],
    ['awaiting-unapplied-dialog', 2, quit.windowsDuringBlock],
    ['after-dismiss', 4, quit.windowsAfterDismiss],
  ].map(([phase, index, windows]) => ({ phase, nativeRequest: { ...quit.helperEvents[index] }, windows: structuredClone(windows) }))
  quit.nativeObservations = { changes, last: structuredClone(changes.at(-1)) }
  return { complete: true, commit: 'b'.repeat(40), productCommit: 'a'.repeat(40), version: READING_MODE_VERSION,
    platform: 'win32', processID, noteID: 'synthetic-contract-note',
    realPackagedApp: true, realBackend: true, realPreload: true, syntheticData: true,
    bridgeOverridden: false, timerAccelerated: false, dirtyWhileReading: true,
    onlyIntendedCaptionSaved: true, onlyIntendedTodoSaved: true, rendererReloaded: true,
    checks: [...READING_CHECKS], attempts: { ...READING_ATTEMPTS },
    captionSelection: selection('.editor-image-caption-input', '原始图片说明'),
    draftSourceSHA256: originalBody.sha256, databaseDuringDraftSHA256: originalBody.sha256,
    captionSavedSHA256: captionBody.sha256, beforeReadSHA256: captionBody.sha256, afterReadSHA256: captionBody.sha256,
    savedSHA256: before.sha256, reloadedSHA256: before.sha256, pendingDrafts,
    screenshots: READING_SCREENSHOTS.map(filename => ({ filename, bytes: 100, sha256: '4'.repeat(64) })),
  }
}
