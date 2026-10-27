import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { LOCAL_EXPORT_FIXTURE as F } from './local-export-desktop-values.mjs'
import { assertExportOwnedDirectory, validateExportDirectoryResult } from './local-export-directory-session.mjs'

export const LOCAL_EXPORT_VERSION = '4.237.0'
export const LOCAL_EXPORT_REPORT = 'local-export-desktop.json'
export const LOCAL_EXPORT_CHECKS = Object.freeze([
  'actual-app-and-canonical-synthetic-documents', 'original-entry-selection-and-preview',
  'unsaved-editor-draft-excluded', 'native-directory-cancel-retains-preview',
  'native-directory-selection-owned', 'markdown-relative-assets-and-name-collisions',
  'frozen-preview-excludes-later-body-change', 'real-missing-asset-partial-failure',
  'retry-only-failed-preserves-successful-files', 'word-body-table-image-and-attachment',
  'actual-cancel-settles-without-late-files', 'continue-only-unfinished-documents',
  'reveal-requests-export-directory', 'original-note-bodies-and-editor-protection',
  'native-close-keeps-exported-bytes', 'owned-resources-cleaned',
])
export const LOCAL_EXPORT_IMAGES = Object.freeze([
  'local-export-preview.png', 'local-export-markdown.png', 'local-export-partial.png',
  'local-export-word.png', 'local-export-cancelled.png', 'local-export-continued.png',
])
export const LOCAL_EXPORT_SOURCES = Object.freeze([
  'check-local-export-desktop.mjs', 'run-local-export-desktop.mjs', 'local-export-desktop-evidence.mjs',
  'local-export-desktop-values.mjs', 'local-export-desktop-fixture.jsx', 'build-local-export-fixture.mjs',
  'local-export-directory-session.mjs', 'local-export-directory-worker.ps1',
  'desktop-window-session.mjs', 'desktop-window-target.mjs', 'desktop-window-worker.ps1',
])
export const exportSHA256 = bytes => createHash('sha256').update(bytes).digest('hex')
export const exportBlob = bytes => createHash('sha1').update('blob ' + Buffer.byteLength(bytes) + '\0').update(bytes).digest('hex')
const object = value => assert.ok(value && typeof value === 'object' && !Array.isArray(value))
const positive = value => assert.ok(Number.isSafeInteger(value) && value > 0)
const sha256 = value => assert.match(value || '', /^[a-f0-9]{64}$/)
const sha1 = value => assert.match(value || '', /^[a-f0-9]{40}$/)
const statuses = new Set(['ready', 'running', 'succeeded', 'failed', 'cancelled'])

export function validateExportView(view, expectedCount) {
  object(view); assert.ok(['prepared', 'choosing', 'running', 'cancelling', 'settled'].includes(view.phase))
  assert.ok(['prepared', 'running', 'completed', 'partial', 'cancelled'].includes(view.state))
  assert.ok(Array.isArray(view.items)); assert.equal(view.items.length, expectedCount)
  assert.equal(new Set(view.items.map(item => item.id)).size, expectedCount)
  for (const item of view.items) {
    assert.match(item.id || '', /^[a-zA-Z0-9-]+$/); assert.ok(statuses.has(item.status))
    for (const key of ['title', 'path', 'preview', 'message']) assert.equal(typeof item[key], 'string')
    assert.ok(item.title.length > 0 && item.path.length > 0); assert.ok(Array.isArray(item.warnings))
    assert.ok(item.warnings.every(value => typeof value === 'string'))
    if (item.status === 'succeeded') { positive(item.bytes); sha256(item.sha256) }
  }
  return true
}
export function validateExportFileManifest(manifest) {
  assert.ok(Array.isArray(manifest) && manifest.length > 0 && manifest.length <= 1000)
  assert.equal(new Set(manifest.map(item => item.filename.toLowerCase())).size, manifest.length)
  let total = 0
  for (const item of manifest) {
    object(item); assert.equal(typeof item.filename, 'string')
    assert.ok(item.filename.startsWith('local-export-files/') && !item.filename.includes('\\'))
    assert.ok(!path.posix.isAbsolute(item.filename) && !path.win32.isAbsolute(item.filename))
    assert.ok(item.filename.split('/').every(part => part && part !== '.' && part !== '..'))
    positive(item.bytes); assert.ok(item.bytes <= 32 * 1024 * 1024); sha256(item.sha256)
    total += item.bytes
  }
  assert.ok(total <= 128 * 1024 * 1024)
  return true
}
export function validateExportFeedbackVisibility(value) {
  object(value); positive(value.viewport?.width); positive(value.viewport?.height)
  assert.ok(value.viewport.width <= 720 && value.viewport.height <= 520)
  assert.ok(Array.isArray(value.controls) && value.controls.length > 0)
  for (const node of [value.feedback, ...value.controls]) {
    object(node); assert.equal(node.rendered, true); assert.equal(node.disabled, false)
    assert.equal(typeof node.text, 'string'); assert.ok(node.text.length > 0)
    const rect = node.rect; object(rect)
    for (const key of ['left', 'right', 'top', 'bottom']) assert.ok(Number.isFinite(rect[key]))
    assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right > rect.left && rect.bottom > rect.top)
    assert.ok(rect.right <= value.viewport.width && rect.bottom <= value.viewport.height)
    assert.ok(Array.isArray(node.hitPoints) && node.hitPoints.length === 5)
    for (const [i, [fx, fy]] of [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]].entries()) {
      assert.equal(node.hitPoints[i].x, rect.left + (rect.right - rect.left) * fx)
      assert.equal(node.hitPoints[i].y, rect.top + (rect.bottom - rect.top) * fy)
      assert.equal(node.hitPoints[i].matched, true)
    }
  }
  return true
}
// The caller selects the expected provenance, never the report itself. Existing
// CI/install callers keep the hosted default and cannot accept local evidence.
export function validateExportExecutionIdentity(report, execution = 'github-hosted') {
  object(report)
  assert.ok(['github-hosted', 'local-windows'].includes(execution))
  assert.equal(report.runnerEnvironment, execution)
  if (execution === 'github-hosted') {
    assert.equal(report.localValidation, undefined, 'Local evidence is not hosted acceptance')
    return true
  }
  assert.equal(report.scope, 'packaged', 'Local evidence cannot accept installed user data')
  assert.equal(report.productCommit, report.commit, 'Local product commit is only a source reference')
  assert.equal(report.moduleAccepted, false)
  assert.equal(report.installationVerified, false)
  assert.equal(report.buildProvenanceVerified, false)
  const local = report.localValidation; object(local)
  assert.equal(local.sourceReferenceOnly, true)
  assert.equal(typeof local.sourceWorktreeDirty, 'boolean')
  const profile = report.launch?.profile
  assert.ok(typeof profile === 'string' && path.win32.isAbsolute(profile))
  assert.equal(path.win32.basename(profile), 'profile')
  const scratch = path.win32.dirname(profile)
  assert.ok(/^notepad-export-[A-Za-z0-9_-]+$/.test(path.win32.basename(scratch)))
  assert.equal(path.win32.normalize(local.isolatedDataDirectory || '').toLowerCase(),
    path.win32.join(scratch, 'data').toLowerCase())
  return true
}

export function validateLocalExportDesktopReport(report, commit, productCommit = commit, scope = 'packaged', execution = 'github-hosted') {
  sha1(commit); sha1(productCommit); object(report)
  assert.equal(report.schemaVersion, 1); assert.equal(report.module, '2F.102'); assert.equal(report.version, LOCAL_EXPORT_VERSION)
  assert.equal(report.commit, commit); assert.equal(report.productCommit, productCommit); assert.equal(report.scope, scope)
  assert.ok(['packaged', 'installed'].includes(scope)); assert.equal(report.platform, 'win32')
  validateExportExecutionIdentity(report, execution)
  for (const key of ['complete', 'syntheticData', 'cleanupComplete']) assert.equal(report[key], true, key)
  for (const key of ['bridgeOverridden', 'timerAccelerated', 'forceTerminated']) assert.equal(report[key], false, key)
  assert.equal(report.error, undefined); assert.deepEqual(report.checks, LOCAL_EXPORT_CHECKS)
  assert.ok(Number.isFinite(Date.parse(report.startedAt)) && Number.isFinite(Date.parse(report.finishedAt)))
  assert.ok(Date.parse(report.finishedAt) >= Date.parse(report.startedAt))
  assert.ok(path.win32.isAbsolute(report.app?.executable || ''))
  for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) sha256(report.app[key])
  assert.deepEqual(Object.keys(report.sourceFiles).sort(), [...LOCAL_EXPORT_SOURCES].sort())
  for (const value of Object.values(report.sourceFiles)) sha1(value)
  const launch = report.launch, exit = report.exit
  positive(launch.pid); assert.ok(path.win32.isAbsolute(launch.profile)); assert.equal(launch.executable, report.app.executable)
  assert.equal(launch.diagnostics.version, LOCAL_EXPORT_VERSION); assert.equal(launch.diagnostics.packaged, true)
  assert.equal(exit.pid, launch.pid); assert.equal(exit.code, 0); assert.equal(exit.signal, null)
  assert.equal(exit.nativeClose, true); assert.equal(exit.backendStopped, true)
  assert.equal(exit.window.pid, launch.pid); positive(exit.window.handle)
  assert.equal(exit.window.cls, 'Chrome_WidgetWin_1'); assert.equal(exit.window.visible, true)
  assert.ok(exit.window.childText.includes('Chrome Legacy Window'))
  assert.equal(path.win32.normalize(exit.window.image).toLowerCase(), path.win32.normalize(report.app.executable).toLowerCase())
  assert.equal(exit.closeRequest.type, 'close'); assert.equal(exit.closeRequest.completed, true)
  assert.equal(exit.closeRequest.pid, launch.pid); positive(exit.closeRequest.id)
  for (const helper of [report.windowHelper, report.directoryHelper]) {
    assert.equal(helper.stoppedCleanly, true)
    assert.equal(helper.events.filter(event => event.type === 'ready').length, 1)
    assert.equal(helper.events.some(event => event.type === 'failed'), false)
  }
  assert.equal(report.windowHelper.events.filter(event => event.type === 'close' && event.completed).length, 1)
  assert.equal(report.minimumWindow.pid, launch.pid); assert.equal(report.minimumWindow.handle, exit.window.handle)
  assert.equal(report.minimumWindow.width, 720); assert.equal(report.minimumWindow.height, 520); assert.equal(report.minimumWindow.applied, true)
  assert.equal(report.directoryActions.length, 5)
  for (const [index, action] of report.directoryActions.entries()) {
    assert.equal(action.binding.pid, launch.pid); assert.equal(action.binding.executable, report.app.executable)
    assert.equal(action.binding.mainHandle, exit.window.handle)
    if (index) assertExportOwnedDirectory(path.win32.dirname(launch.profile), action.directory)
    validateExportDirectoryResult(action.result, action.binding, index === 0 ? 'cancel' : 'choose', action.directory)
  }
  assert.equal(new Set(report.directoryActions.slice(1).map(action => path.win32.normalize(action.directory).toLowerCase())).size, 4)
  assert.deepEqual(report.entries, ['more-notes', 'selector', 'workbench'])
  validateExportView(report.preview, 3); assert.equal(report.preview.phase, 'prepared')
  assert.ok(report.preview.items.every(item => item.status === 'ready'))
  assert.deepEqual(report.afterDirectoryCancel, report.preview)
  assert.deepEqual(Object.keys(report.visibility).sort(), ['cancelled', 'directoryCancel', 'partial'])
  for (const value of Object.values(report.visibility)) validateExportFeedbackVisibility(value)
  assert.equal(report.dirty.trustedInput, true); assert.equal(report.dirty.explicitNativeInputs, 1)
  assert.equal(report.dirty.databaseBefore, report.dirty.databaseAfter)
  assert.ok(!report.dirty.databaseAfter.includes(F.dirty))
  assert.equal(report.dirty.afterExportIncludesDraft, true); assert.equal(report.dirty.undoRestoredOriginal, true)
  assert.equal(report.dirty.rendererWrites, 0)
  assert.ok(report.dirty.finishedAt - report.dirty.startedAt >= 0 && report.dirty.finishedAt - report.dirty.startedAt < 30000,
    'Dirty export must stay within the original autosave interval')
  assert.equal(report.frozen.originalPreviewIncludesOldBody, true)
  assert.equal(report.frozen.databaseAfterPreviewIncludesNewBody, true)
  assert.equal(report.frozen.exportContainsOldBody, true); assert.equal(report.frozen.exportContainsNewBody, false)
  for (const value of [report.markdown, report.retry, report.word]) {
    validateExportView(value, 3); assert.equal(value.state, 'completed'); assert.equal(value.phase, 'settled')
    assert.ok(value.items.every(item => item.status === 'succeeded'))
  }
  assert.equal(new Set(report.markdown.items.map(item => item.path.toLowerCase())).size, 3)
  assert.ok(report.markdown.items.some(item => /\(2\)\.md$/.test(item.path)))
  validateExportView(report.partial, 3); assert.equal(report.partial.state, 'partial'); assert.equal(report.partial.phase, 'settled')
  assert.equal(report.partial.items.filter(item => item.status === 'succeeded').length, 2)
  assert.equal(report.partial.items.filter(item => item.status === 'failed').length, 1)
  const failed = report.partial.items.find(item => item.status === 'failed')
  assert.ok(failed.message.includes('失败') || failed.message.includes('附件'))
  assert.equal(report.failure.realHTTPStatus, 404); assert.equal(report.failure.restoredOriginalAssetBytes, true)
  assert.equal(report.failure.failedDocumentAbsent, true); assert.equal(report.failure.failedAssetsAbsent, true)
  assert.deepEqual(report.failure.successfulFilesBeforeRetry, report.failure.successfulFilesAfterRetry)
  assert.equal(report.failure.successfulFilesBeforeRetry.length, 2)
  validateExportView(report.cancelled, 100); assert.equal(report.cancelled.phase, 'settled'); assert.equal(report.cancelled.state, 'cancelled')
  assert.ok(report.cancelled.items.some(item => item.status === 'cancelled'))
  assert.ok(report.cancelled.items.every(item => ['succeeded', 'cancelled'].includes(item.status)))
  assert.equal(report.cancellation.confirmedStableWithoutLateFiles, true)
  assert.deepEqual(report.cancellation.filesAtSettled, report.cancellation.filesAfterObservation)
  validateExportView(report.continued, 100); assert.equal(report.continued.phase, 'settled'); assert.equal(report.continued.state, 'completed')
  assert.ok(report.continued.items.every(item => item.status === 'succeeded'))
  assert.deepEqual(report.cancellation.successfulFilesBeforeContinue, report.cancellation.successfulFilesAfterContinue)
  assert.equal(report.reveal.visibleRequestedFeedback, true); assert.equal(report.originalNotesUnchanged, true)
  assert.equal(report.rendererMutationRequests.length, 0); assert.equal(report.exportFilesSurvivedExit, true)
  validateExportFileManifest(report.files)
  assert.ok(path.win32.isAbsolute(report.exportRoot || ''))
  const outputNames = new Set()
  for (const view of [report.markdown, report.retry, report.word, report.continued]) for (const item of view.items) {
    assert.ok(path.win32.isAbsolute(item.path))
    const relative = path.win32.relative(report.exportRoot, item.path)
    assert.ok(relative && relative !== '..' && !relative.startsWith('..\\') && !path.win32.isAbsolute(relative))
    const filename = 'local-export-files/' + relative.replaceAll('\\', '/')
    const file = report.files.find(file => file.filename === filename)
    assert.ok(file, 'Displayed successful output is absent from the raw archive')
    assert.equal(item.bytes, file.bytes); assert.equal(item.sha256, file.sha256)
    assert.equal(outputNames.has(filename), false); outputNames.add(filename)
  }
  assert.equal(outputNames.size, 109)
  expectedExportDocuments(report)
  assert.deepEqual(report.screenshots.map(item => item.filename), LOCAL_EXPORT_IMAGES)
  for (const item of report.screenshots) { positive(item.bytes); sha256(item.sha256); assert.ok(item.bytes > 1000) }
  return true
}

function readEvidence(directory, entry) {
  const base = realpathSync(directory), target = path.resolve(base, entry.filename)
  assert.ok(target.startsWith(base + path.sep)); const stat = lstatSync(target)
  assert.equal(stat.isSymbolicLink(), false); assert.equal(stat.isFile(), true); assert.equal(realpathSync(target), target)
  const bytes = readFileSync(target); assert.equal(bytes.length, entry.bytes); assert.equal(exportSHA256(bytes), entry.sha256)
  return bytes
}
function expectedExportDocuments(report) {
  // These IDs are recorded directly from fixture creation by the desktop
  // driver. The expected body comes from fixed source constants, never from an
  // output file, its checksum or the renderer's preview of that same output.
  const fixture = report.fixture; object(fixture); assert.equal(fixture.documents, 103)
  const ids = ['folderID', 'noteID', 'frozenID', 'failingID', 'cancellationFolderID'].map(key => {
    assert.match(fixture[key] || '', /^[a-zA-Z0-9-]+$/); return fixture[key]
  })
  assert.equal(new Set(ids).size, ids.length)
  const mainIDs = [fixture.noteID, fixture.frozenID, fixture.failingID].sort()
  for (const name of ['preview', 'markdown', 'partial', 'retry', 'word']) {
    assert.deepEqual(report[name].items.map(item => item.id).sort(), mainIDs, 'Fixture note IDs differ: ' + name)
    for (const item of report[name].items) assert.equal(item.title,
      item.id === fixture.noteID ? 'EXPORT102 原文.md' : item.id === fixture.frozenID ? 'EXPORT102 重名.md' : 'EXPORT102 重名.txt')
  }
  const cancelled = new Map(report.cancelled.items.map(item => [item.id, item]))
  assert.equal(cancelled.size, 100)
  assert.deepEqual(report.continued.items.map(item => item.id).sort(), [...cancelled.keys()].sort())
  const batchNumbers = new Set(), documents = new Map()
  for (const name of ['markdown', 'retry', 'word', 'continued']) for (const item of report[name].items) {
    const relative = path.win32.relative(report.exportRoot, item.path)
    assert.ok(relative && relative !== '..' && !relative.startsWith('..\\') && !path.win32.isAbsolute(relative))
    const filename = 'local-export-files/' + relative.replaceAll('\\', '/')
    assert.equal(documents.has(filename), false)
    const format = name === 'markdown' || name === 'retry' ? 'markdown' : 'docx'
    assert.ok(filename.endsWith(format === 'markdown' ? '.md' : '.docx'))
    let body = item.id === fixture.frozenID && name !== 'markdown' ? F.frozen : F.body
    if (name === 'continued') {
      assert.equal(ids.includes(item.id), false)
      assert.equal(cancelled.get(item.id)?.title, item.title, 'Continuation changed a fixture note identity')
      const match = /^EXPORT102 Batch (\d{3})\.md$/.exec(item.title)
      assert.ok(match, 'Unknown cancellation fixture title')
      const number = Number(match[1]); assert.ok(number >= 1 && number <= 100)
      assert.equal(batchNumbers.has(number), false); batchNumbers.add(number)
      body = F.body + ' batch ' + (number - 1)
    }
    documents.set(filename, { id: item.id, body, format, hasAttachment: name !== 'continued' })
  }
  assert.equal(batchNumbers.size, 100); assert.equal(documents.size, 109)
  return documents
}
function decodeTextEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_all, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()]
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    assert.ok(Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff))
    return String.fromCodePoint(code)
  })
}
function validateExpectedBody(text, expected, filename) {
  const body = text.split(/\r?\n/).map(line => line.trim()).filter(line =>
    line.startsWith('EXPORT102 saved body') || line.startsWith(F.frozen))
  assert.deepEqual(body, [expected], 'Exported body differs from its fixture note: ' + filename)
}
function xmlAttributes(text) {
  const attributes = new Map()
  for (const match of text.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    assert.equal(attributes.has(match[1]), false)
    attributes.set(match[1], decodeTextEntities(match[2] ?? match[3]))
  }
  return attributes
}
function requireOwnedAttachment(filename, target, bytesByName, attachment) {
  assert.equal(typeof target, 'string')
  const decoded = decodeURIComponent(target)
  assert.ok(!/^[a-z]+:/i.test(decoded) && !decoded.includes('\\'))
  assert.ok(!path.posix.isAbsolute(decoded) && !path.win32.isAbsolute(decoded))
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filename), decoded))
  const expected = filename.replace(/\.(?:md|docx)$/, '_assets/') + F.attachmentName
  assert.equal(resolved, expected, 'Attachment reference belongs to another document or location')
  assert.ok(bytesByName.get(resolved)?.equals(attachment), 'Attachment reference does not target the original sidecar bytes')
}
function markdownTargets(text) {
  const result = []
  // CommonMark destinations may contain balanced parentheses, including the
  // actual portable collision suffix " (2)". A first-')' regex truncates them.
  for (let cursor = 0; cursor < text.length;) {
    const start = text.indexOf('](', cursor); if (start < 0) break
    let depth = 1, end = start + 2
    for (; end < text.length && depth; end++) {
      if (text[end] === '\\') { end++; continue }
      if (text[end] === '(') depth++
      if (text[end] === ')') depth--
    }
    assert.equal(depth, 0, 'Exported Markdown contains an unfinished link')
    result.push(text.slice(start + 2, end - 1)); cursor = end
  }
  return result
}
export async function verifyLocalExportFiles(directory, report) {
  validateExportFileManifest(report.files)
  const bytesByName = new Map(report.files.map(entry => [entry.filename, readEvidence(directory, entry)]))
  const expectedDocuments = expectedExportDocuments(report)
  const image = Buffer.from(F.pngBase64, 'base64'), attachment = Buffer.from(F.attachment)
  let markdownDocuments = 0, wordDocuments = 0, wordWithMedia = 0, offlineImages = 0, offlineAttachments = 0
  for (const [filename, bytes] of bytesByName) {
    if (bytes.equals(image)) offlineImages++
    if (bytes.equals(attachment)) offlineAttachments++
    if (filename.endsWith('.md')) {
      markdownDocuments++; const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const expected = expectedDocuments.get(filename); assert.ok(expected); assert.equal(expected.format, 'markdown')
      assert.ok(text.includes(F.heading) && text.includes('EXPORT102 end'))
      assert.ok(!text.includes(F.dirty)); assert.doesNotMatch(text, /http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):27121\/uploads/)
      validateExpectedBody(decodeTextEntities(text.replace(/\\([^\w\s])/g, '$1')), expected.body, filename)
      for (const value of markdownTargets(text)) {
        const target = decodeURIComponent(value); if (/^[a-z]+:/i.test(target)) continue
        assert.ok(!path.posix.isAbsolute(target) && !path.win32.isAbsolute(target))
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filename), target))
        assert.ok(bytesByName.has(resolved), 'Markdown refers to a missing offline asset: ' + resolved)
      }
      const attachmentLines = text.split(/\r?\n/).filter(line => /^\[/.test(line) &&
        decodeTextEntities(line.slice(1, line.indexOf('](')).replace(/\\([^\w\s])/g, '$1')) === F.attachmentName)
      assert.equal(attachmentLines.length, 1, 'Required Markdown attachment reference is missing or duplicated')
      const targets = markdownTargets(attachmentLines[0]); assert.equal(targets.length, 1)
      requireOwnedAttachment(filename, targets[0], bytesByName, attachment)
    } else if (filename.endsWith('.docx')) {
      wordDocuments++; const zip = await JSZip.loadAsync(bytes, { checkCRC32: true })
      const expected = expectedDocuments.get(filename); assert.ok(expected); assert.equal(expected.format, 'docx')
      const names = Object.keys(zip.files)
      assert.ok(names.length > 3 && names.length < 1000 && names.every(name => !name.startsWith('/') && !name.split('/').includes('..')))
      const document = await zip.file('word/document.xml')?.async('string')
      assert.equal(typeof document, 'string'); assert.ok(document.includes('EXPORT102 end'))
      assert.ok(document.includes('<w:tbl>'), 'Canonical table disappeared from Word')
      const text = (await mammoth.extractRawText({ buffer: bytes })).value
      assert.ok(text.includes(F.heading)); assert.ok(!text.includes(F.dirty))
      validateExpectedBody(text, expected.body, filename)
      const media = names.filter(name => /^word\/media\//.test(name) && !zip.files[name].dir)
      if (media.length) {
        wordWithMedia++
        assert.ok((await Promise.all(media.map(name => zip.files[name].async('nodebuffer')))).some(value => value.equals(image)))
      }
      const relationships = await zip.file('word/_rels/document.xml.rels')?.async('string')
      assert.equal(typeof relationships, 'string'); assert.ok(!relationships.includes('127.0.0.1:27121/uploads'))
      for (const match of relationships.matchAll(/Target="([^"]+)"[^>]*TargetMode="External"/g)) {
        const target = match[1].replace(/&amp;/g, '&')
        if (/^[a-z]+:/i.test(target)) continue
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filename), decodeURIComponent(target)))
        assert.ok(bytesByName.has(resolved), 'Word refers to a missing sidecar attachment')
      }
      if (expected.hasAttachment) {
        const references = new Map()
        for (const match of relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
          const attributes = xmlAttributes(match[1]), id = attributes.get('Id')
          assert.ok(id && !references.has(id)); references.set(id, attributes)
        }
        const links = [...document.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g)].filter(match =>
          [...match[2].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(value => decodeTextEntities(value[1])).join('') === F.attachmentName)
        assert.equal(links.length, 1, 'Required Word attachment hyperlink is missing or duplicated')
        const reference = references.get(xmlAttributes(links[0][1]).get('r:id'))
        assert.ok(reference, 'Word attachment hyperlink has no relationship')
        assert.equal(reference.get('Type'), 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink')
        assert.equal(reference.get('TargetMode'), 'External')
        requireOwnedAttachment(filename, reference.get('Target'), bytesByName, attachment)
      }
    }
  }
  assert.equal(markdownDocuments, 6); assert.equal(wordDocuments, 103)
  assert.ok(wordWithMedia >= 3 && offlineImages >= 6 && offlineAttachments >= 9)
  return { markdownDocuments, wordDocuments, wordWithMedia, offlineImages, offlineAttachments }
}
export async function verifyLocalExportDesktopReport(directory, commit, productCommit = commit, scope = 'packaged', sources, execution = 'github-hosted') {
  const report = JSON.parse(readFileSync(path.join(directory, LOCAL_EXPORT_REPORT), 'utf8'))
  validateLocalExportDesktopReport(report, commit, productCommit, scope, execution)
  const expected = sources || Object.fromEntries(LOCAL_EXPORT_SOURCES.map(name => [name,
    exportBlob(readFileSync(new URL('./' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n'))]))
  assert.deepEqual(report.sourceFiles, expected)
  for (const entry of report.screenshots) {
    const bytes = readEvidence(directory, entry)
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
  }
  await verifyLocalExportFiles(directory, report)
  return report
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyLocalExportDesktopReport(path.resolve('test-results/desktop-save'), process.env.GITHUB_SHA)
  console.log(JSON.stringify({ complete: true, checks: report.checks.length, files: report.files.length }))
}
