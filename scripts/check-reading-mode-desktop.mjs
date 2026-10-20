import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readingModeDesktopFixture, READING_FIXTURE_TEXT } from './reading-mode-desktop-fixture.bundle.mjs'
import { READING_CHECKS, READING_MODE_VERSION, READING_DRAFT_VALUES, assertReadingCommittedDraftView,
  validateReadingModeDesktopReport } from './reading-mode-desktop-evidence.mjs'
import { READING_CAPTION_SELECTOR, READING_EMBED_TITLE_SELECTOR,
  replaceNativeTextInput, replaceNativeFormulaInput, replaceNativeUrlInput } from './reading-mode-native-input.mjs'
import { assertDesktopWindowImage, selectDesktopMainWindow, selectDesktopUnappliedDialog,
  isDesktopUnappliedDialogWindow, assertDesktopAccessibleText } from './desktop-window-target.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const q = JSON.stringify

// Persist the actual native return before any selector or renderer read can
// fail. Repeated polls retain the last receipt; changed rows retain their own
// original receipt as well. No expected title or message enters the observation.
export async function inspectReadingNativeWindows({ windowSession, processID, executablePath, quit, phase, firstNativeEvent, save }) {
  const windows = await windowSession.inspect(processID, executablePath)
  const events = windowSession.events()
  const observation = { phase, nativeRequest: { ...events.at(-1) }, windows: structuredClone(windows) }
  quit.nativeObservations ||= { last: null, changes: [] }
  const previous = quit.nativeObservations.last
  if (!previous || previous.phase !== phase || q(previous.windows) !== q(observation.windows)) {
    quit.nativeObservations.changes.push(structuredClone(observation))
  }
  quit.nativeObservations.last = observation
  quit.helperEvents = events.slice(firstNativeEvent)
  save()
  assert.equal(observation.nativeRequest.type, 'inspect')
  assert.equal(observation.nativeRequest.pid, processID)
  assert.equal(observation.nativeRequest.completed, true)
  assert.ok(Number.isSafeInteger(observation.nativeRequest.id) && observation.nativeRequest.id > 0)
  assert.ok(Number.isFinite(observation.nativeRequest.elapsedMs) && observation.nativeRequest.elapsedMs >= 0)
  for (const window of windows) if (window.accessibility != null) assertDesktopAccessibleText(window)
  return windows
}

// Shared by the packaged desktop check and the installed lifecycle check. All
// mutations after fixture creation use native CDP mouse/keyboard input. Runtime
// evaluation reads the public UI/real preload and sends library's refresh event;
// it never replaces a bridge, editor, timer, network response or input value.
export async function verifyReadingModeDesktop(context) {
  const { api, evaluate, click, cdp, until, out, processID, windowSession, executablePath,
    productCommit = process.env.GITHUB_SHA, version = READING_MODE_VERSION } = context
  assert.equal(process.platform, 'win32')
  assert.equal(version, READING_MODE_VERSION)
  assert.ok(Number.isSafeInteger(processID) && processID > 0)
  assert.match(productCommit || '', /^[a-f0-9]{40}$/)
  assert.ok(path.win32.isAbsolute(executablePath || ''))
  for (const method of ['inspect', 'close', 'dismissUnappliedDialog', 'events']) assert.equal(typeof windowSession?.[method], 'function', method)
  const report = { complete: false, commit: process.env.GITHUB_SHA, productCommit, version,
    platform: process.platform, processID, realPackagedApp: false, realBackend: false,
    realPreload: false, syntheticData: true, bridgeOverridden: false, timerAccelerated: false,
    checks: [], attempts: {}, screenshots: [] }
  mkdirSync(out, { recursive: true })
  const save = () => writeFileSync(path.join(out, 'reading-mode-desktop.json'), JSON.stringify(report, null, 2))
  const mark = name => { assert.equal(name, READING_CHECKS[report.checks.length]); report.checks.push(name); save() }
  const value = selector => evaluate(`document.querySelector(${q(selector)})?.value`)
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  const reload = async () => {
    const origin = await evaluate('performance.timeOrigin')
    await cdp.send('Page.reload')
    await until(() => evaluate(`performance.timeOrigin!==${origin}&&!!document.querySelector('.workspace-sidebar')`), 'Reading-check renderer did not reload')
  }
  const key = async (name, code, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: name, windowsVirtualKeyCode: code, modifiers })
  }
  const mode = async reading => {
    const target = reading ? '[aria-label="切换到阅读模式"]' : '[aria-label="切换到编辑模式"]'
    if (await evaluate(`!!document.querySelector(${q(target)})`)) await click(target)
    await until(() => evaluate(`!!document.querySelector(${q('.editor-input[contenteditable="' + !reading + '"]')})`), 'Reading-mode state did not settle')
    assert.equal(await evaluate("!!document.querySelector('.editor-shell.editor-reading-mode')"), reading)
    await settle()
  }
  const open = async id => {
    await evaluate("window.dispatchEvent(new Event('library:refresh'))")
    await until(() => evaluate(`!!document.querySelector('[data-file-id="${id}"]')`), 'Reading fixture missing from real library')
    await click(`[data-file-id="${id}"]`)
    await until(() => evaluate(`document.querySelector('.editor-input')?.innerText.includes(${q(READING_FIXTURE_TEXT.body)})`), 'Reading fixture missing from real editor')
    await until(() => evaluate("document.querySelector('.editor-image-caption-input')?.value==='原始图片说明'||document.querySelector('.editor-image-caption-input')?.value==='reading100-native-caption'"), 'Canonical image caption did not render')
  }
  const body = async () => (await api('/api/files/' + report.noteID)).content
  const assertBody = async expected => assert.equal(await body(), expected, 'Reading-only action changed the persisted document')
  const saveBody = async expected => {
    await key('s', 83, 2)
    await until(async () => { try { assert.deepEqual(JSON.parse(await body()), expected); return true } catch { return false } }, 'Native save did not persist the exact intended changes')
    await until(() => evaluate("!document.querySelector('.save-state')"), 'Reading fixture save did not settle')
    return body()
  }
  const typeReadonly = async (selector, attempt) => {
    const before = await value(selector)
    assert.equal(typeof before, 'string', 'Missing independent input: ' + selector)
    assert.equal(await evaluate(`document.querySelector(${q(selector)})?.readOnly`), true, 'Independent input is still writable: ' + selector)
    await click(selector)
    await cdp.send('Input.insertText', { text: 'READING100-FORBIDDEN-' + attempt })
    await settle()
    assert.equal(await value(selector), before, 'Native input changed a reading-only field: ' + selector)
    report.attempts[attempt] = true
  }
  const capture = async filename => {
    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    writeFileSync(path.join(out, filename), bytes)
    report.screenshots.push({ filename, bytes: bytes.length, sha256: hash(bytes) }); save()
  }
  const doubleClick = async selector => {
    const point = await evaluate(`(()=>{const node=document.querySelector(${q(selector)});if(!node)return null;node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    assert.ok(point, 'Missing formula in real renderer')
    for (const clickCount of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount })
    await settle()
  }
  const text = READING_DRAFT_VALUES
  const nativeInput = { evaluate, click, cdp, settle }
  const snapshotBody = content => ({ content, sha256: hash(content) })
  const observeDrafts = () => evaluate('(' + function (markers) {
    const root = document.querySelector('.editor-input')
    const formula = document.querySelector('.formula-rendered')
    const formulaEditor = document.querySelector('.formula-editor')
    const dialog = document.querySelector('.consumer-confirm-modal')
    return {
      reading: !!document.querySelector('.editor-shell.editor-reading-mode') && root?.getAttribute('contenteditable') === 'false',
      sourceVisible: !!root?.innerText.includes(markers.sourceBody),
      destinationVisible: !!root?.innerText.includes(markers.destinationBody),
      formulaExpression: formula?.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? null,
      formulaBlock: formula ? formula.classList.contains('block') : null,
      formulaDraft: formulaEditor?.querySelector('textarea')?.value ?? null,
      formulaDraftBlock: formulaEditor ? formulaEditor.classList.contains('block') : null,
      embedTitle: document.querySelector('.embed-title')?.textContent ?? '',
      iframeSrc: document.querySelector('.embed-iframe')?.getAttribute('src') ?? null,
      embedDraftURL: document.querySelector('.embed-editing input[type="url"]')?.value ?? null,
      embedDraftTitle: document.querySelector('.embed-editing input[type="text"]')?.value ?? null,
      pendingText: document.querySelector('.editor-unapplied-draft-pill')?.textContent ?? '',
      notices: {
        formula: formula?.querySelector('.decorator-pending-draft')?.textContent.trim() ?? '',
        embed: document.querySelector('.embed-block .decorator-pending-draft')?.textContent.trim() ?? '',
      },
      dialogTitle: dialog?.querySelector('.modal-title')?.textContent ?? '',
      dialogMessage: dialog?.querySelector('.modal-message')?.textContent ?? '',
      saveReady: !!Array.from(dialog?.querySelectorAll('button') || []).find(button => button.textContent.trim() === '保存' && !button.disabled),
      failureText: Array.from(document.querySelectorAll('.app-toast-content')).map(node => node.textContent).filter(value => value.includes('未应用')).join('\n'),
    }
  }.toString() + ')(' + q(text) + ')')
  const namedButton = async (scope, label) => {
    const observed = await evaluate('(' + function (scope, label) {
      const buttons = Array.from(document.querySelectorAll(scope + ' > button'))
      const matching = buttons.map((button, index) => ({ index, label: button.textContent.trim(), disabled: button.disabled })).filter(button => button.label === label)
      return matching
    }.toString() + ')(' + q(scope) + ',' + q(label) + ')')
    assert.equal(observed.length, 1, 'Expected one visible action: ' + label)
    assert.equal(observed[0].disabled, false, 'Native action was disabled: ' + label)
    await click(scope + ' > button:nth-of-type(' + (observed[0].index + 1) + ')')
    await settle()
    return { buttonLabel: label, buttonEnabled: true }
  }
  const untouched = async expected => {
    const content = await body(); assert.equal(content, expected, 'Pending block draft changed the real database')
    return hash(content)
  }
  const requireSource = async () => {
    const ui = await observeDrafts()
    assert.equal(ui.sourceVisible, true); assert.equal(ui.destinationVisible, false)
    return ui
  }
  const editFormula = async (original, next, inline) => {
    await requireSource(); await doubleClick('.formula-rendered')
    const selection = await replaceNativeFormulaInput(nativeInput, original, next)
    if (inline) await namedButton('.formula-editor-actions', '行内公式')
    await until(async () => (await observeDrafts()).formulaDraft === next, 'Native formula draft did not arrive')
    await until(async () => (await observeDrafts()).pendingText.includes('公式'), 'Formula draft did not register with the editor')
    return selection
  }
  const editEmbed = async (originalURL, originalTitle, nextURL, nextTitle) => {
    await requireSource(); await click('.embed-edit-btn[aria-label="编辑嵌入内容"]'); await settle()
    const url = await replaceNativeUrlInput(nativeInput, originalURL, nextURL)
    const titleSelection = await replaceNativeTextInput(nativeInput, READING_EMBED_TITLE_SELECTOR, originalTitle, nextTitle)
    await until(async () => (await observeDrafts()).embedDraftTitle === nextTitle, 'Native embed draft did not arrive')
    await until(async () => (await observeDrafts()).pendingText.includes('嵌入内容'), 'Embed draft did not register with the editor')
    return { url, titleSelection }
  }
  const navigationGuard = async (kind, expectedBody, formula, embedTitle) => {
    const result = {}
    for (const choice of ['cancel', 'save']) {
      await click('[data-file-id="' + report.pendingDrafts.destinationNoteID + '"]')
      const dialog = await until(async () => {
        const ui = await observeDrafts()
        return ui.dialogTitle === '当前笔记未保存' && ui.dialogMessage.includes('未应用') && ui
      }, 'Pending draft did not block real note navigation')
      const action = await namedButton('.consumer-modal-actions', choice === 'cancel' ? '取消' : '保存')
      if (choice === 'cancel') {
        await until(async () => (await observeDrafts()).dialogTitle === '', 'Cancelling navigation did not close its dialog')
      } else {
        await until(async () => {
          const ui = await observeDrafts()
          return ui.dialogTitle === '当前笔记未保存' && ui.saveReady && ui.failureText.includes(kind === 'formula' ? '公式' : '嵌入内容')
        }, 'Save did not report the pending draft and refuse navigation')
      }
      const ui = await requireSource()
      assertReadingCommittedDraftView(ui, formula, embedTitle, [kind])
      result[choice] = { dialogTitle: dialog.dialogTitle, dialogMessage: dialog.dialogMessage, ...action,
        dialogRemained: ui.dialogTitle === '当前笔记未保存', ui, bodySHA256: await untouched(expectedBody),
        ...(choice === 'save' ? { failureText: ui.failureText } : {}) }
      if (choice === 'save') await namedButton('.consumer-modal-actions', '取消')
    }
    await mode(false)
    result.returned = { ui: await requireSource(), bodySHA256: await untouched(expectedBody) }
    return result
  }
  save()
  try {
    // A real renderer reload starts a fresh, unmodified 30-second autosave
    // interval. The short dirty-draft round is completed before the longer
    // clean-document guard checks, which remain valid across any autosave tick.
    await reload()
    const diagnostics = await evaluate('window.electronAPI.appDiagnostics()')
    assert.equal(diagnostics.packaged, true); assert.equal(diagnostics.version, version)
    report.realPackagedApp = true; report.realPreload = true
    mark('current-version-real-packaged-preload')

    const serialized = readingModeDesktopFixture()
    const created = await api('/api/files', { method: 'POST', body: JSON.stringify({
      title: '阅读100独立输入验证-' + processID, content: serialized, is_folder: false,
    }) })
    assert.match(created.id, /^[a-zA-Z0-9-]+$/); report.noteID = created.id
    assert.equal(await body(), serialized); report.realBackend = true
    const destinationJSON = JSON.parse(serialized)
    const marker = destinationJSON.root.children.filter(node => node.type === 'paragraph' && node.children?.[0]?.text === text.sourceBody)
    assert.equal(marker.length, 1); marker[0].children[0].text = text.destinationBody
    const destinationContent = JSON.stringify(destinationJSON)
    const destination = await api('/api/files', { method: 'POST', body: JSON.stringify({
      title: '阅读100草稿切换目标-' + processID, content: destinationContent, is_folder: false,
    }) })
    assert.match(destination.id, /^[a-zA-Z0-9-]+$/); assert.notEqual(destination.id, created.id)
    assert.equal((await api('/api/files/' + destination.id)).content, destinationContent)
    report.pendingDrafts = { destinationNoteID: destination.id, destinationBodySHA256: hash(destinationContent),
      bodies: {}, formula: {}, embed: {}, quit: {}, recovery: {} }
    await open(created.id); await mode(false)
    assert.equal(await evaluate("document.querySelector('.todo-checkbox')?.checked"), false)
    assert.equal(await value('.callout-textarea'), READING_FIXTURE_TEXT.callout)
    assert.equal(await value('.code-textarea'), READING_FIXTURE_TEXT.code)
    assert.equal(await evaluate("!!document.querySelector('.formula-rendered')&&!!document.querySelector('.attachment-preview-button')"), true)
    mark('canonical-decorators-created-through-real-service')

    const source = await body(), caption = 'reading100-native-caption'
    report.draftSourceSHA256 = hash(source)
    await replaceNativeTextInput({ evaluate, click, cdp, settle,
      onSelection(selection) { report.captionSelection = selection; save() },
    }, READING_CAPTION_SELECTOR, READING_FIXTURE_TEXT.caption, caption)
    await until(() => value('.editor-image-caption-input').then(result => result === caption), 'Native caption edit was not applied')
    await mode(true)
    assert.equal(await evaluate("!!document.querySelector('.editor-reading-draft-pill')"), true, 'Reading mode lost the unsaved caption draft')
    report.dirtyWhileReading = true
    await typeReadonly('.editor-image-caption-input', 'caption')
    assert.equal(await value('.editor-image-caption-input'), caption)
    await assertBody(source); report.databaseDuringDraftSHA256 = hash(await body())
    mark('reading-retains-unsaved-caption-and-rejects-native-input')

    await mode(false)
    assert.equal(await value('.editor-image-caption-input'), caption)
    const captionExpected = JSON.parse(source)
    const images = captionExpected.root.children.filter(node => node.type === 'image')
    assert.equal(images.length, 1); images[0].caption = caption
    const captionSaved = await saveBody(captionExpected)
    report.onlyIntendedCaptionSaved = true; report.captionSavedSHA256 = hash(captionSaved)
    mark('returned-edit-mode-saves-only-intended-caption')

    await mode(true); report.beforeReadSHA256 = hash(await body())
    await typeReadonly('.editor-image-caption-input', 'caption')
    await typeReadonly('.editor-image-grid-caption', 'gridCaption')
    await typeReadonly('.callout-textarea', 'callout')
    await typeReadonly('.toggle-title-input', 'toggleTitle')
    await typeReadonly('.toggle-textarea', 'toggleContent')
    await typeReadonly('.code-textarea', 'code')
    const rootText = await evaluate("document.querySelector('.editor-input')?.innerText")
    await click('.editor-input[contenteditable="false"] .editor-paragraph')
    await cdp.send('Input.insertText', { text: 'READING100-FORBIDDEN-root' }); await settle()
    assert.equal(await evaluate("document.querySelector('.editor-input')?.innerText"), rootText)
    report.attempts.root = true
    mark('reading-blocks-independent-native-text-inputs')

    assert.equal(await evaluate("document.querySelector('.todo-checkbox')?.disabled"), true)
    await click('.todo-checkbox'); await settle()
    assert.equal(await evaluate("document.querySelector('.todo-checkbox')?.checked"), false); report.attempts.todo = true
    assert.equal(await evaluate("document.querySelector('.todo-text-button')?.disabled"), true)
    await click('.todo-text-button'); await settle()
    assert.equal(await evaluate("!!document.querySelector('.todo-input')"), false)
    assert.equal(await evaluate("document.querySelector('.callout-icon-btn')?.disabled"), true)
    assert.equal(await evaluate("document.querySelector('.language-selector-button')?.disabled"), true)
    await doubleClick('.formula-rendered')
    assert.equal(await evaluate("!!document.querySelector('.formula-editor')"), false); report.attempts.formula = true
    await click('.editor-image-block'); await settle()
    const imageActions = await evaluate("Array.from(document.querySelectorAll('.editor-image-toolbar button')).map(button=>button.textContent.trim())")
    assert.deepEqual(imageActions, ['下载']); report.attempts.imageControls = true
    await click('.editor-image-grid-block'); await settle()
    assert.equal(await evaluate("!!document.querySelector('.editor-image-grid-block.selected')"), true)
    assert.equal(await evaluate("!!document.querySelector('.editor-image-grid-toolbar,.editor-image-grid-drag,.editor-image-grid-card-actions')"), false)
    assert.equal(await evaluate("document.querySelector('.editor-image-grid-block input[type=file]')?.disabled"), true)
    report.attempts.gridControls = true
    assert.equal(await evaluate("!!document.querySelector('.attachment-replace-button,.attachment-delete-button')"), false)
    await click('.attachment-preview-button')
    await until(() => evaluate("(()=>{const image=document.querySelector('.attachment-preview-dialog .attachment-preview-body img');return Boolean(image?.complete&&image.naturalWidth===8&&image.naturalHeight===8)})()"), 'Read-only attachment preview did not display its real PNG content')
    assert.equal(await evaluate("!!document.querySelector('.attachment-preview-delete')"), false)
    await click('.attachment-preview-close'); report.attempts.attachmentPreview = true
    mark('reading-blocks-todo-formula-and-media-mutations')

    await click('.toggle-arrow-button'); await settle()
    assert.equal(await evaluate("!!document.querySelector('.toggle-textarea')"), false)
    await click('.toggle-arrow-button'); await settle()
    assert.equal(await value('.toggle-textarea'), READING_FIXTURE_TEXT.toggleContent)
    await assertBody(captionSaved); report.afterReadSHA256 = hash(await body())
    await click('.callout-textarea')
    await capture('reading-mode-decorators.png')
    mark('reading-toggle-expansion-keeps-database-body')

    await mode(false); await click('.todo-checkbox')
    await until(() => evaluate("document.querySelector('.todo-checkbox')?.checked===true"), 'Editable Todo cannot be toggled')
    const todoExpected = JSON.parse(captionSaved), todos = todoExpected.root.children.filter(node => node.type === 'todo')
    assert.equal(todos.length, 1); todos[0].checked = true
    const saved = await saveBody(todoExpected)
    report.onlyIntendedTodoSaved = true; report.savedSHA256 = hash(saved)
    mark('editable-todo-still-saves')

    await mode(true); await reload()
    await open(report.noteID)
    assert.equal(await evaluate("!!document.querySelector('.editor-shell.editor-reading-mode .editor-input[contenteditable=false]')"), true)
    assert.equal(await evaluate("document.querySelector('.todo-checkbox')?.disabled&&document.querySelector('.todo-checkbox')?.checked"), true)
    for (const selector of ['.editor-image-caption-input', '.editor-image-grid-caption', '.callout-textarea', '.toggle-title-input', '.toggle-textarea', '.code-textarea']) assert.equal(await evaluate(`document.querySelector(${q(selector)})?.readOnly`), true, selector)
    assert.equal(await value('.editor-image-caption-input'), caption)
    await assertBody(saved); report.reloadedSHA256 = hash(await body()); report.rendererReloaded = true
    await click('.callout-textarea'); await capture('reading-mode-decorators-reloaded.png')
    mark('reading-preference-survives-real-renderer-reload')

    const pending = report.pendingDrafts
    pending.bodies.before = snapshotBody(await body())
    await mode(false)
    pending.formula.pendingSelection = await editFormula(text.formulaOriginal, text.formulaPending, true)
    await mode(true)
    pending.formula.reading = await requireSource()
    assertReadingCommittedDraftView(pending.formula.reading, text.formulaOriginal, text.embedOriginalTitle, ['formula'])
    pending.formula.readingBodySHA256 = await untouched(pending.bodies.before.content)
    await click('.formula-rendered'); await capture('reading-mode-formula-pending.png')
    pending.formula.navigation = await navigationGuard('formula', pending.bodies.before.content, text.formulaOriginal, text.embedOriginalTitle)
    assert.equal(pending.formula.navigation.returned.ui.formulaDraft, text.formulaPending)
    assert.equal(pending.formula.navigation.returned.ui.formulaDraftBlock, false)
    mark('formula-pending-draft-reading-navigation-cancel-and-save-guard')

    await namedButton('.formula-editor-actions', '取消')
    pending.formula.cancelled = { ui: await requireSource(), bodySHA256: await untouched(pending.bodies.before.content) }
    assert.equal(pending.formula.cancelled.ui.formulaExpression, text.formulaOriginal)
    assert.equal(pending.formula.cancelled.ui.formulaBlock, true)
    assert.equal(pending.formula.cancelled.ui.pendingText, '')
    pending.formula.appliedSelection = await editFormula(text.formulaOriginal, text.formulaApplied, false)
    await namedButton('.formula-editor-actions', '完成')
    await until(async () => (await observeDrafts()).pendingText === '', 'Completed formula still has an unapplied draft')
    const formulaExpected = JSON.parse(pending.bodies.before.content)
    const formulaNodes = formulaExpected.root.children.filter(node => node.type === 'formula')
    assert.equal(formulaNodes.length, 1); formulaNodes[0].expression = text.formulaApplied
    pending.bodies.afterFormula = snapshotBody(await saveBody(formulaExpected))
    pending.formula.saveKey = 'Control+S'; pending.formula.saved = await requireSource()
    mark('formula-cancel-and-completion-preserve-exact-body')

    const embedPending = await editEmbed(text.embedOriginalURL, text.embedOriginalTitle, text.embedPendingURL, text.embedPendingTitle)
    pending.embed.pendingURL = embedPending.url; pending.embed.pendingTitleSelection = embedPending.titleSelection
    await mode(true)
    pending.embed.reading = await requireSource()
    assertReadingCommittedDraftView(pending.embed.reading, text.formulaApplied, text.embedOriginalTitle, ['embed'])
    pending.embed.readingBodySHA256 = await untouched(pending.bodies.afterFormula.content)
    await click('.embed-block'); await capture('reading-mode-embed-pending.png')
    pending.embed.navigation = await navigationGuard('embed', pending.bodies.afterFormula.content, text.formulaApplied, text.embedOriginalTitle)
    assert.equal(pending.embed.navigation.returned.ui.embedDraftURL, text.embedPendingURL)
    assert.equal(pending.embed.navigation.returned.ui.embedDraftTitle, text.embedPendingTitle)
    mark('embed-pending-draft-reading-navigation-cancel-and-save-guard')

    await namedButton('.embed-edit-actions', '取消')
    pending.embed.cancelled = { ui: await requireSource(), bodySHA256: await untouched(pending.bodies.afterFormula.content) }
    assert.equal(pending.embed.cancelled.ui.embedTitle, text.embedOriginalTitle)
    assert.equal(pending.embed.cancelled.ui.pendingText, '')
    const embedApplied = await editEmbed(text.embedOriginalURL, text.embedOriginalTitle, text.embedAppliedURL, text.embedAppliedTitle)
    pending.embed.appliedURL = embedApplied.url; pending.embed.appliedTitleSelection = embedApplied.titleSelection
    await namedButton('.embed-edit-actions', '保存')
    await until(async () => (await observeDrafts()).pendingText === '', 'Completed embed still has an unapplied draft')
    const embedExpected = JSON.parse(pending.bodies.afterFormula.content)
    const embedNodes = embedExpected.root.children.filter(node => node.type === 'embed')
    assert.equal(embedNodes.length, 1)
    Object.assign(embedNodes[0], { url: text.embedAppliedURL, title: text.embedAppliedTitle })
    pending.bodies.afterEmbed = snapshotBody(await saveBody(embedExpected))
    pending.embed.saveKey = 'Control+S'; pending.embed.saved = await requireSource()
    mark('embed-cancel-and-completion-preserve-exact-body')

    const quit = pending.quit
    quit.formulaSelection = await editFormula(text.formulaApplied, text.formulaQuit, true)
    const quitEmbed = await editEmbed(text.embedAppliedURL, text.embedAppliedTitle, text.embedPendingURL, text.embedPendingTitle)
    quit.embedURL = quitEmbed.url; quit.embedTitleSelection = quitEmbed.titleSelection
    await mode(true)
    quit.before = await requireSource()
    assertReadingCommittedDraftView(quit.before, text.formulaApplied, text.embedAppliedTitle, ['formula', 'embed'])
    quit.beforeBodySHA256 = await untouched(pending.bodies.afterEmbed.content)
    quit.timeOriginBefore = await evaluate('performance.timeOrigin')
    quit.windowTitle = await evaluate('document.title'); quit.executablePath = executablePath
    const firstNativeEvent = windowSession.events().length
    const inspect = phase => inspectReadingNativeWindows({ windowSession, processID, executablePath, quit, phase, firstNativeEvent, save })
    quit.windowsBeforeClose = await inspect('before-close')
    quit.target = selectDesktopMainWindow(quit.windowsBeforeClose, processID, quit.windowTitle)
    assertDesktopWindowImage(quit.target, executablePath)
    await windowSession.close(quit.target)
    const blocked = await until(async () => {
      const windows = await inspect('awaiting-unapplied-dialog')
      if (!windows.some(window => isDesktopUnappliedDialogWindow(window, processID))) return false
      return { windows, dialog: selectDesktopUnappliedDialog(windows, processID, executablePath) }
    }, 'Native close did not produce the owned unapplied-draft rejection dialog')
    quit.windowsDuringBlock = blocked.windows; quit.dialog = blocked.dialog
    assertDesktopWindowImage(selectDesktopMainWindow(blocked.windows, processID, quit.windowTitle), executablePath)
    quit.processStillAlive = true
    assert.ok(await api('/api/health')); quit.backendStillAlive = true
    quit.afterBodySHA256 = await untouched(pending.bodies.afterEmbed.content)
    assert.equal(await windowSession.dismissUnappliedDialog(quit.dialog, executablePath), true)
    quit.dismissed = true
    quit.windowsAfterDismiss = await until(async () => {
      const windows = await inspect('after-dismiss')
      if (windows.some(window => window.pid === processID && window.visible &&
        (window.handle === quit.dialog.handle || isDesktopUnappliedDialogWindow(window, processID)))) return false
      assertDesktopWindowImage(selectDesktopMainWindow(windows, processID, quit.windowTitle), executablePath)
      return windows
    }, 'The verified native error dialog did not dismiss while preserving the app')
    quit.helperEvents = windowSession.events().slice(firstNativeEvent)
    quit.timeOriginAfter = await evaluate('performance.timeOrigin')
    assert.equal(quit.timeOriginAfter, quit.timeOriginBefore)
    await settle(); quit.after = await requireSource()
    assertReadingCommittedDraftView(quit.after, text.formulaApplied, text.embedAppliedTitle, ['formula', 'embed'])
    quit.dialogEvidence = 'native-window-title-and-child-text'
    await click('.editor-unapplied-draft-pill'); await capture('reading-mode-unapplied-after-close.png')
    mark('reading-unapplied-drafts-refuse-native-window-close')

    await mode(false)
    pending.recovery.returned = await requireSource()
    assert.equal(pending.recovery.returned.formulaDraft, text.formulaQuit)
    assert.equal(pending.recovery.returned.formulaDraftBlock, false)
    assert.equal(pending.recovery.returned.embedDraftURL, text.embedPendingURL)
    assert.equal(pending.recovery.returned.embedDraftTitle, text.embedPendingTitle)
    await namedButton('.formula-editor-actions', '取消')
    await namedButton('.embed-edit-actions', '取消')
    pending.recovery.cancelled = await requireSource()
    assert.equal(pending.recovery.cancelled.pendingText, '')
    await saveBody(embedExpected); pending.recovery.saveKey = 'Control+S'
    pending.recovery.bodySHA256 = await untouched(pending.bodies.afterEmbed.content)
    await click('[data-file-id="' + pending.destinationNoteID + '"]')
    pending.recovery.destination = await until(async () => {
      const ui = await observeDrafts()
      return ui.destinationVisible && !ui.sourceVisible && ui.dialogTitle === '' && ui
    }, 'Cancelling both drafts did not restore normal note navigation')
    const destinationAfter = await api('/api/files/' + pending.destinationNoteID)
    pending.recovery.destinationBodySHA256 = hash(destinationAfter.content)
    assert.equal(pending.recovery.destinationBodySHA256, pending.destinationBodySHA256)
    await open(report.noteID); await mode(false)
    pending.recovery.reopened = await requireSource()
    assert.equal(pending.recovery.reopened.pendingText, ''); assert.equal(pending.recovery.reopened.dialogTitle, '')
    pending.bodies.final = snapshotBody(await body())
    assert.equal(pending.bodies.final.content, pending.bodies.afterEmbed.content)
    mark('returned-editing-discards-pending-drafts-and-navigation-resumes')

    report.complete = true
    validateReadingModeDesktopReport(report, process.env.GITHUB_SHA, productCommit); save()
    return report
  } catch (error) { report.complete = false; report.error = String(error.stack || error); save(); throw error }
}
