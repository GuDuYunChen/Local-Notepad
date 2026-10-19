import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readingModeDesktopFixture, READING_FIXTURE_TEXT } from './reading-mode-desktop-fixture.bundle.mjs'
import { READING_CHECKS, READING_MODE_VERSION, validateReadingModeDesktopReport } from './reading-mode-desktop-evidence.mjs'
import { READING_CAPTION_SELECTOR, replaceNativeTextInput } from './reading-mode-native-input.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const q = JSON.stringify

// Shared by the packaged desktop check and the installed lifecycle check. All
// mutations after fixture creation use native CDP mouse/keyboard input. Runtime
// evaluation reads the public UI/real preload and sends library's refresh event;
// it never replaces a bridge, editor, timer, network response or input value.
export async function verifyReadingModeDesktop(context) {
  const { api, evaluate, click, cdp, until, out, processID,
    productCommit = process.env.GITHUB_SHA, version = READING_MODE_VERSION } = context
  assert.equal(process.platform, 'win32')
  assert.equal(version, READING_MODE_VERSION)
  assert.ok(Number.isSafeInteger(processID) && processID > 0)
  assert.match(productCommit || '', /^[a-f0-9]{40}$/)
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
    await mode(false)
    report.complete = true
    validateReadingModeDesktopReport(report, process.env.GITHUB_SHA, productCommit); save()
    return report
  } catch (error) { report.complete = false; report.error = String(error.stack || error); save(); throw error }
}
