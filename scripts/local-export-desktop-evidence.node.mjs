import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { PassThrough, Writable } from 'node:stream'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, lstatSync, symlinkSync } from 'node:fs'
import { realpath as realpathAsync } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Script } from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { parse } from 'acorn'
import JSZip from 'jszip'
import { prepareExportPlan, executeExportPlan } from '../electron/local-export.js'
import { localExportDesktopDocument } from './local-export-desktop-fixture.bundle.mjs'
import { verifyLocalExportDesktop } from './check-local-export-desktop.mjs'
import { LOCAL_EXPORT_FIXTURE as F } from './local-export-desktop-values.mjs'
import { LOCAL_EXPORT_VERSION, LOCAL_EXPORT_REPORT, LOCAL_EXPORT_CHECKS, LOCAL_EXPORT_IMAGES, LOCAL_EXPORT_SOURCES,
  exportSHA256 as hash, exportBlob, validateLocalExportDesktopReport, validateExportFeedbackVisibility,
  validateExportFileManifest, verifyLocalExportFiles, verifyLocalExportDesktopReport } from './local-export-desktop-evidence.mjs'
import { assertExportDirectoryBinding, assertExportOwnedDirectory, validateExportDirectoryObservation,
  validateExportDirectoryResult, createExportDirectorySession } from './local-export-directory-session.mjs'
import { desktopWindowWorkerArguments } from './desktop-window-session.mjs'

// All fixtures in this file are contract inputs. Passing these cases does not
// claim that a Windows process, native picker or installed app has been tested.
const HEAD = 'a'.repeat(40), H = 'b'.repeat(64), run = 'C:\\owned-export-contract'
const executable = 'C:\\package\\记事本.exe', binding = { pid: 701, mainHandle: 301, executable }
const dialog = () => ({ pid: binding.pid, handle: 401, title: '选择文档导出目录', cls: '#32770', visible: true,
  image: executable, owner: binding.mainHandle, ownerChain: [binding.mainHandle] })
const directoryResult = (action, directory) => ({ dialog: dialog(), action, dialogClosed: true, controls: [],
  selectedPath: action === 'choose' ? directory : null, inputID: '1152', inputName: 'Folder:', buttonName: '选择此目录',
  valueWrites: action === 'choose' ? 1 : 0, invocations: action === 'choose' ? 1 : 0, closePosts: action === 'cancel' ? 1 : 0 })
const visibility = () => {
  const node = text => ({ text, disabled: false, rendered: true, rect: { left: 10, top: 10, right: 210, bottom: 50 },
    hitPoints: [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([x, y]) => ({ x: 10 + 200 * x, y: 10 + 40 * y, matched: true })) })
  return { viewport: { width: 704, height: 481 }, feedback: node('已停止'), controls: [node('继续未完成项'), node('查回结果')] }
}
function view(prefix, count, status = 'succeeded', format = 'md') {
  return { phase: status === 'ready' ? 'prepared' : 'settled', state: status === 'ready' ? 'prepared' : 'completed',
    items: Array.from({ length: count }, (_, i) => ({ id: (count === 100 ? 'batch-' : 'note-') + i,
      title: count === 100 ? 'EXPORT102 Batch ' + String(i + 1).padStart(3, '0') + '.md' : i ? 'EXPORT102 重名.md' : 'EXPORT102 原文.md',
      path: run + '\\exports\\' + prefix + '\\Notepad-export-contract\\目录\\笔记' + (i === 2 ? ' (2)' : i) + '.' + format,
      preview: F.heading + '\n' + (count === 100 ? F.body + ' batch ' + i : i === 1 && !['preview', 'markdown'].includes(prefix) ? F.frozen : F.body),
      status, message: '', warnings: [], bytes: status === 'succeeded' ? 20 : null,
      sha256: status === 'succeeded' ? H : null })) }
}
function fixture() {
  const preview = view('preview', 3, 'ready'), markdown = view('markdown', 3), retry = view('partial', 3), word = view('word', 3, 'succeeded', 'docx')
  const partial = structuredClone(retry); partial.state = 'partial'; Object.assign(partial.items[2], { status: 'failed', bytes: null, sha256: null, message: '附件读取失败' })
  const cancelled = view('cancelled', 100, 'succeeded', 'docx'); cancelled.state = 'cancelled'
  for (const item of cancelled.items.slice(1)) Object.assign(item, { status: 'cancelled', bytes: null, sha256: null })
  const continued = view('cancelled', 100, 'succeeded', 'docx')
  const closeRequest = { type: 'close', id: 1, pid: binding.pid, completed: true }
  const files = [markdown, retry, word, continued].flatMap(value => value.items.map(item => ({
    filename: 'local-export-files/' + path.win32.relative(run + '\\exports', item.path).replaceAll('\\', '/'), bytes: item.bytes, sha256: item.sha256 })))
  return { schemaVersion: 1, module: '2F.102', version: LOCAL_EXPORT_VERSION, commit: HEAD, productCommit: HEAD,
    scope: 'packaged', platform: 'win32', runnerEnvironment: 'github-hosted', complete: true, syntheticData: true,
    cleanupComplete: true, bridgeOverridden: false, timerAccelerated: false, forceTerminated: false,
    startedAt: '2026-10-21T12:00:00Z', finishedAt: '2026-10-21T12:01:00Z', checks: [...LOCAL_EXPORT_CHECKS],
    app: { executable, executableSHA256: H, asarSHA256: H, backendSHA256: H },
    sourceFiles: Object.fromEntries(LOCAL_EXPORT_SOURCES.map(name => [name, 'c'.repeat(40)])),
    launch: { pid: binding.pid, profile: run + '\\profile', executable, diagnostics: { version: LOCAL_EXPORT_VERSION, packaged: true } },
    exit: { pid: binding.pid, code: 0, signal: null, nativeClose: true, backendStopped: true, closeRequest,
      window: { pid: binding.pid, handle: binding.mainHandle, cls: 'Chrome_WidgetWin_1', visible: true, image: executable, childText: ['Chrome Legacy Window'] } },
    windowHelper: { stoppedCleanly: true, events: [{ type: 'ready' }, closeRequest] },
    directoryHelper: { stoppedCleanly: true, events: [{ type: 'ready' }] },
    minimumWindow: { pid: binding.pid, handle: binding.mainHandle, width: 720, height: 520, applied: true },
    directoryActions: ['cancel', 'markdown', 'partial', 'word', 'cancelled'].map((name, i) => ({ binding,
      ...(i ? { directory: run + '\\exports\\' + name } : {}), result: directoryResult(i ? 'choose' : 'cancel', run + '\\exports\\' + name) })),
    fixture: { folderID: 'folder-main', noteID: 'note-0', frozenID: 'note-1', failingID: 'note-2',
      cancellationFolderID: 'folder-cancel', documents: 103 },
    entries: ['more-notes', 'selector', 'workbench'], preview, afterDirectoryCancel: structuredClone(preview),
    visibility: { directoryCancel: visibility(), partial: visibility(), cancelled: visibility() },
    dirty: { trustedInput: true, explicitNativeInputs: 1, databaseBefore: 'saved', databaseAfter: 'saved',
      afterExportIncludesDraft: true, undoRestoredOriginal: true, rendererWrites: 0, startedAt: 100, finishedAt: 1000 },
    frozen: { originalPreviewIncludesOldBody: true, databaseAfterPreviewIncludesNewBody: true, exportContainsOldBody: true, exportContainsNewBody: false },
    markdown, partial, retry, word, cancelled, continued,
    failure: { realHTTPStatus: 404, restoredOriginalAssetBytes: true, failedDocumentAbsent: true, failedAssetsAbsent: true,
      successfulFilesBeforeRetry: [{ id: 'note-0', bytes: 20, sha256: H, mtimeMs: 5 }, { id: 'note-1', bytes: 20, sha256: H, mtimeMs: 5 }],
      successfulFilesAfterRetry: [{ id: 'note-0', bytes: 20, sha256: H, mtimeMs: 5 }, { id: 'note-1', bytes: 20, sha256: H, mtimeMs: 5 }] },
    cancellation: { confirmedStableWithoutLateFiles: true, filesAtSettled: [], filesAfterObservation: [],
      successfulFilesBeforeContinue: [], successfulFilesAfterContinue: [] },
    reveal: { visibleRequestedFeedback: true }, originalNotesUnchanged: true, rendererMutationRequests: [], exportFilesSurvivedExit: true,
    exportRoot: run + '\\exports', files, screenshots: LOCAL_EXPORT_IMAGES.map(filename => ({ filename, bytes: 2000, sha256: H })) }
}

test('complete export contract binds 109 displayed successes, source receipts and native operations', () => {
  assert.equal(validateLocalExportDesktopReport(fixture(), HEAD), true)
})
for (const [name, mutate] of [
  ['old application', r => { r.version = '4.234.0' }], ['wrong product', r => { r.productCommit = 'f'.repeat(40) }],
  ['incomplete module', r => { r.complete = false }], ['missing gate', r => r.checks.pop()], ['reordered gate', r => r.checks.reverse()],
  ['renderer bridge override', r => { r.bridgeOverridden = true }], ['accelerated timers', r => { r.timerAccelerated = true }],
  ['force killed application', r => { r.forceTerminated = true }], ['unpackaged renderer', r => { r.launch.diagnostics.packaged = false }],
  ['stale source', r => { delete r.sourceFiles['local-export-directory-worker.ps1'] }],
  ['failed native close', r => { r.exit.closeRequest.completed = false }], ['wrong close PID', r => { r.exit.pid++ }],
  ['backend left alive', r => { r.exit.backendStopped = false }], ['helper leak', r => { r.directoryHelper.stoppedCleanly = false }],
  ['helper failure', r => r.directoryHelper.events.push({ type: 'failed' })], ['wrong minimum window', r => { r.minimumWindow.width++ }],
  ['selection skip', r => r.entries.shift()], ['cancel removed preview', r => r.afterDirectoryCancel.items.pop()],
  ['dirty saved body', r => { r.dirty.databaseAfter += F.dirty }], ['untrusted draft', r => { r.dirty.trustedInput = false }],
  ['native input replay', r => { r.dirty.explicitNativeInputs++ }], ['dirty editor lost', r => { r.dirty.afterExportIncludesDraft = false }],
  ['autosave overlap', r => { r.dirty.finishedAt = r.dirty.startedAt + 30000 }], ['nonfrozen body', r => { r.frozen.exportContainsNewBody = true }],
  ['swallowed real failure', r => { r.failure.realHTTPStatus = 200 }], ['orphan failed asset', r => { r.failure.failedAssetsAbsent = false }],
  ['failure source not restored', r => { r.failure.restoredOriginalAssetBytes = false }],
  ['retry rewrote success', r => { r.failure.successfulFilesAfterRetry[0].mtimeMs++ }],
  ['nothing actually cancelled', r => { r.cancelled = structuredClone(r.continued); r.cancelled.state = 'cancelled' }],
  ['late output after cancel', r => r.cancellation.filesAfterObservation.push({ filename: 'late.docx' })],
  ['continue rewrote success', r => r.cancellation.successfulFilesAfterContinue.push({ bytes: 2 })],
  ['continue incomplete', r => { r.continued.items[90].status = 'cancelled' }], ['native destination skipped', r => r.directoryActions.pop()],
  ['native destination escaped owned run', r => { r.directoryActions[1].directory = 'C:\\unowned'; r.directoryActions[1].result.selectedPath = 'C:\\unowned' }],
  ['same batch reused', r => { r.directoryActions[2] = structuredClone(r.directoryActions[1]) }],
  ['note mutation', r => r.rendererMutationRequests.push({ method: 'PUT' })], ['export lost on exit', r => { r.exportFilesSurvivedExit = false }],
  ['receipt wrong bytes', r => r.word.items[0].bytes++], ['receipt wrong hash', r => { r.word.items[0].sha256 = '0'.repeat(64) }],
  ['successful file outside output root', r => { r.word.items[0].path = 'C:\\another\\note.docx' }],
  ['missing raw output', r => r.files.pop()], ['missing screenshot', r => r.screenshots.pop()],
]) test('export evidence refuses ' + name, () => { const report = fixture(); mutate(report); assert.throws(() => validateLocalExportDesktopReport(report, HEAD)) })

for (const [name, mutate] of [
  ['hidden ancestor', value => { value.feedback.rendered = false }], ['occluded feedback', value => { value.feedback.hitPoints[4].matched = false }],
  ['disabled continue', value => { value.controls[0].disabled = true }], ['clipped footer', value => { value.controls[1].rect.bottom = 900 }],
  ['missing real hit test', value => value.feedback.hitPoints.pop()], ['larger viewport substitute', value => { value.viewport.width = 900 }],
]) test('minimum-window feedback refuses ' + name, () => { const value = visibility(); mutate(value); assert.throws(() => validateExportFeedbackVisibility(value)) })

test('installed export requires separate exact verifier and product identities', () => {
  const report = fixture(); report.scope = 'installed'; report.productCommit = 'd'.repeat(40)
  assert.equal(validateLocalExportDesktopReport(report, HEAD, report.productCommit, 'installed'), true)
  assert.throws(() => validateLocalExportDesktopReport(report, HEAD))
})
test('owned directory validation rejects root, traversal, sibling and drive changes', () => {
  assert.equal(assertExportDirectoryBinding(binding), true)
  assert.equal(assertExportOwnedDirectory(run, run + '\\exports\\文档'), true)
  for (const value of [run, run + '\\..\\escape', run + '-sibling\\x', 'D:\\owned-export-contract\\x', 'relative', '\\rooted-only'])
    assert.throws(() => assertExportOwnedDirectory(run, value))
})
for (const [name, mutate] of [
  ['different process', d => d.pid++], ['different image', d => { d.image = 'C:\\other.exe' }],
  ['same-title foreign owner', d => { d.owner = 302; d.ownerChain = [302] }], ['cyclic owner chain', d => d.ownerChain.push(301)],
  ['main window substituted', d => { d.handle = binding.mainHandle }], ['unexpected title', d => { d.title = 'Open' }],
  ['hidden dialog', d => { d.visible = false }], ['different class', d => { d.cls = 'Chrome_WidgetWin_1' }],
]) test('native picker identity refuses ' + name, () => { const value = dialog(); mutate(value); assert.throws(() => validateExportDirectoryObservation(value, binding)) })
test('native picker requires exactly one action and a closed original dialog', () => {
  const directory = run + '\\exports\\word'
  for (const operation of ['choose', 'cancel']) {
    assert.equal(validateExportDirectoryResult(directoryResult(operation, directory), binding, operation, directory), true)
    for (const mutate of [r => { r.dialogClosed = false }, r => r.invocations++, r => r.valueWrites++, r => r.closePosts++]) {
      const value = directoryResult(operation, directory); mutate(value)
      assert.throws(() => validateExportDirectoryResult(value, binding, operation, directory))
    }
  }
})

function fakeWorker({ response, ready = true, holdExit = false } = {}) {
  const child = new EventEmitter(), commands = [], spawns = []; let ended = false, kills = 0
  child.pid = 991; child.stdout = new PassThrough(); child.stderr = new PassThrough()
  const exit = (code, signal = null) => { if (!ended) { ended = true; child.emit('exit', code, signal) } }
  const send = value => child.stdout.write(JSON.stringify(value) + '\r\n')
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    const request = JSON.parse(chunk.toString()); commands.push(request); done()
    const value = response ? response(request) : request.op === 'inspect' ? { id: request.id, ok: true, dialog: dialog() }
      : request.op === 'minimum-window' ? { id: request.id, ok: true, result: { handle: binding.mainHandle, pid: binding.pid, width: 720, height: 520, applied: true } }
        : { id: request.id, ok: true, result: directoryResult(request.op, request.directory) }
    if (value !== undefined) queueMicrotask(() => send(value))
  }, final(done) { done(); if (!holdExit) queueMicrotask(() => exit(0)) } })
  child.kill = () => { kills++; queueMicrotask(() => exit(null, 'SIGTERM')); return true }
  const spawnWorker = (...args) => { spawns.push(args); if (ready) queueMicrotask(() => send({ protocol: 1, ready: true })); return child }
  return { child, commands, spawns, spawnWorker, send, exit, get kills() { return kills } }
}
function session(t, options = {}, budget = {}) {
  const worker = fakeWorker(options), value = createExportDirectorySession({ ownedRoot: run, spawnWorker: worker.spawnWorker,
    startupMs: 500, requestMs: 500, ...budget }); t.after(() => value.dispose()); return { worker, value }
}
test('one native helper decodes exact UTF8 worker below CreateProcessW limit and stops cleanly', async t => {
  const { worker, value } = session(t); await value.ready
  const [command, args, options] = worker.spawns[0]
  assert.equal(command, 'powershell.exe'); assert.deepEqual(args.slice(0, 4), ['-NoProfile', '-Mta', '-NonInteractive', '-EncodedCommand'])
  assert.deepEqual(options, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  assert.ok([command, ...args].map(item => '"' + item + '"').join(' ').length + 1 < 32767)
  const bootstrap = Buffer.from(args[4], 'base64').toString('utf16le')
  const payload = bootstrap.match(/FromBase64String\('([A-Za-z0-9+/]+={0,2})'\)/)?.[1]; assert.ok(payload)
  const source = readFileSync(new URL('./local-export-directory-worker.ps1', import.meta.url))
  assert.deepEqual(gunzipSync(Buffer.from(payload, 'base64')), source)
  assert.equal((await value.minimumWindow(binding)).width, 720)
  assert.equal((await value.inspect(binding)).handle, 401)
  assert.equal((await value.cancel(binding)).closePosts, 1)
  assert.equal((await value.choose(binding, run + '\\exports\\中文')).invocations, 1)
  assert.equal(worker.spawns.length, 1); assert.equal(worker.commands.length, 4)
  assert.equal(await value.dispose(), true); assert.equal(await value.dispose(), true); assert.equal(worker.kills, 0)
  // Reverse only the five identity-validator identifiers. The resulting C#
  // and five references must exactly match the observed 7ba Windows failure.
  const text = source.toString('utf8')
  assert.equal((text.match(/\bValidateMainWindow\(/g) || []).length, 5)
  assert.doesNotMatch(text, /\bMain\(/)
  const originalNaming = Buffer.from(text.replace(/\bValidateMainWindow\(/g, 'Main('))
  const csharp = originalNaming.toString('utf8').match(/Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@ -ReferencedAssemblies \$references/)?.[1]
  const references = text.match(/  \$references = @\([\s\S]*?\r?\n    \[System\.Windows\.Automation\.TreeScope\]\.Assembly\.Location, \[System\.Windows\.DependencyObject\]\.Assembly\.Location\)/)?.[0]
  assert.ok(csharp && references)
  assert.equal(hash(Buffer.from(csharp.replace(/\r\n/g, '\n'))), '320ee6364b208756a72978f231bea1dc4f3c5ba24a5eace211b417f746c23f2f')
  assert.equal(hash(Buffer.from(references.replace(/\r\n/g, '\n'))), '4f7812356172ece23d84e60bdd72ac4e78c85d6e1c907327495ac149ec4b5f6d')
  const originalArguments = desktopWindowWorkerArguments(originalNaming); originalArguments.splice(1, 0, '-Mta')
  assert.ok([command, ...originalArguments].map(item => '"' + item + '"').join(' ').length + 1 < 32767)
  const originalBootstrap = Buffer.from(originalArguments[4], 'base64').toString('utf16le')
  const originalPayload = originalBootstrap.match(/FromBase64String\('([A-Za-z0-9+/]+={0,2})'\)/)?.[1]; assert.ok(originalPayload)
  assert.deepEqual(gunzipSync(Buffer.from(originalPayload, 'base64')), originalNaming)
  if (process.platform === 'win32') {
    let originalSpawns = 0, originalChild, originalExit = null
    const original = createExportDirectorySession({ ownedRoot: tmpdir(), spawnWorker: (name, actualArgs, actualOptions) => {
      originalSpawns++; assert.equal(originalSpawns, 1)
      assert.equal(name, command); assert.deepEqual(actualArgs, args); assert.deepEqual(actualOptions, options)
      originalChild = spawn(name, originalArguments, actualOptions)
      originalChild.once('exit', (code, signal) => { originalExit = { code, signal } })
      return originalChild
    } })
    t.after(() => original.dispose())
    try {
      await assert.rejects(original.ready, { code: 'STARTUP_REFUSED' })
      const diagnostic = original.events().find(event => event.type === 'failed')?.startupDiagnostic
      assert.equal(diagnostic?.stage, 'SOURCE_COMPILATION')
      assert.deepEqual(diagnostic.compilerCodes, ['CS0028'])
      assert.deepEqual(diagnostic.compilerErrors, [{ code: 'CS0028', line: 54, column: 15, isWarning: false }])
    } finally {
      const stoppedCleanly = await original.dispose()
      t.diagnostic(JSON.stringify({ scope: 'windows-native-directory-original-entrypoint-negative', executed: true,
        platform: process.platform, node: process.version, startupMs: 30000, requestMs: 10000,
        nativeCommands: 0, originalCSharpSHA256: hash(Buffer.from(csharp.replace(/\r\n/g, '\n'))),
        expectedStartupRefusal: true, stoppedCleanly, pid: originalChild?.pid ?? null,
        exitObserved: originalExit !== null, exit: originalExit, events: original.events() }))
      assert.equal(stoppedCleanly, false)
      assert.notEqual(originalExit, null, 'The owned rejected helper must exit before starting the repaired helper')
      assert.equal(original.events()[0].pid, originalChild.pid)
    }
    assert.equal(originalSpawns, 1)
    // This branch actually compiles the same worker under Windows PowerShell.
    // Readiness then EOF is the entire operation: no window commands or input.
    const native = createExportDirectorySession({ ownedRoot: tmpdir() }); let clean = false
    t.after(() => native.dispose())
    try { await native.ready } finally {
      clean = await native.dispose()
      t.diagnostic(JSON.stringify({ scope: 'windows-native-directory-cold-start', executed: true,
        platform: process.platform, node: process.version, startupMs: 30000, requestMs: 10000,
        nativeCommands: 0, stoppedCleanly: clean, events: native.events() }))
    }
    assert.equal(clean, true)
    assert.deepEqual(native.events().map(event => event.type), ['spawn', 'ready', 'dispose'])
    assert.ok(Number.isSafeInteger(native.events()[0].pid) && native.events()[0].pid > 0)
    assert.equal(native.events()[1].pid, native.events()[0].pid)
  } else {
    t.diagnostic(JSON.stringify({ scope: 'windows-native-directory-original-entrypoint-negative', executed: false,
      platform: process.platform, reason: 'Requires Windows PowerShell and Windows UIAutomation assemblies' }))
    t.diagnostic(JSON.stringify({ scope: 'windows-native-directory-cold-start', executed: false,
      platform: process.platform, reason: 'Requires Windows PowerShell and Windows UIAutomation assemblies' }))
  }
})
for (const [name, response, expected] of [
  ['wrong sequence', r => ({ id: r.id + 1, ok: true, dialog: dialog() }), 'UNCONFIRMED_REPLY'],
  ['native refusal', r => ({ id: r.id, ok: false, error: 'AMBIGUOUS_DIALOG', observation: { controls: [] } }), 'UNCONFIRMED_REPLY'],
  ['wrong dialog identity', r => ({ id: r.id, ok: true, dialog: { ...dialog(), pid: 999 } }), 'IDENTITY_OR_ACTION_MISMATCH'],
  ['no reply', () => undefined, 'REQUEST_TIMEOUT'],
]) test('uncertain directory operation is never replayed after ' + name, async t => {
  const { worker, value } = session(t, { response }, { requestMs: 20 }); await value.ready
  await assert.rejects(value.inspect(binding), { code: expected })
  await assert.rejects(value.inspect(binding), { code: 'UNAVAILABLE' })
  assert.equal(worker.commands.length, 1); assert.equal(worker.spawns.length, 1); assert.equal(worker.kills, 1)
  assert.equal(await value.dispose(), false)
})
test('concurrent native requests refuse without posting a second operation', async t => {
  const { worker, value } = session(t, { response: () => undefined }); await value.ready
  const first = value.inspect(binding); const rejected = assert.rejects(first, { code: 'DISPOSED' })
  await assert.rejects(value.cancel(binding), { code: 'REQUEST_IN_PROGRESS' })
  assert.equal(worker.commands.length, 1); await value.dispose(); await rejected
})
for (const pipe of ['stdin', 'stdout', 'stderr']) test('native directory helper absorbs ' + pipe + ' errors throughout cleanup', async t => {
  const { worker, value } = session(t); await value.ready
  worker.child[pipe].emit('error', new Error('controlled pipe failure'))
  await assert.rejects(value.inspect(binding), { code: 'UNAVAILABLE' }); assert.equal(await value.dispose(), false)
  assert.doesNotThrow(() => worker.child[pipe].emit('error', new Error('late pipe failure')))
  assert.equal(worker.commands.length, 0)
})
test('directory helper startup refusal and timeout are terminal', async t => {
  for (const timeout of [false, true]) {
    const { worker, value } = session(t, { ready: false }, { startupMs: 20 })
    if (!timeout) worker.send({ protocol: 1, ready: false })
    await assert.rejects(value.ready, { code: timeout ? 'STARTUP_TIMEOUT' : 'STARTUP_REFUSED' })
    assert.equal(worker.commands.length, 0); assert.equal(await value.dispose(), false)
  }
})
function diagnosticFixture() {
  return { stage: 'SOURCE_COMPILATION', errorType: 'System.InvalidOperationException', hresult: -2146233079,
    compilerCodes: ['CS0246'], compilerErrors: [], powerShellVersion: '5.1.26100.6584',
    references: ['System.dll', 'System.Core.dll', 'UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll'] }
}
test('directory helper retains only allowlisted startup diagnostics without exposing stderr', async t => {
  const atLimits = { ...diagnosticFixture(), hresult: -2147483648, powerShellVersion: '65535.65535.65535.65535',
    compilerCodes: Array.from({ length: 8 }, (_, i) => 'CS' + String(1000 + i)) }
  const unknown = { stage: 'CONSOLE_ENCODING', errorType: 'UNKNOWN', hresult: null,
    compilerCodes: [], compilerErrors: [], powerShellVersion: null, references: [] }
  const observedError = { ...diagnosticFixture(), errorType: 'System.Exception', hresult: -2146233088,
    compilerCodes: ['CS0028'], compilerErrors: [{ code: 'CS0028', line: 54, column: 15, isWarning: false }] }
  const errorLimits = { ...atLimits, compilerErrors: atLimits.compilerCodes.map(code => ({ code, line: 65535, column: 65535, isWarning: true })) }
  const zeroPosition = { ...diagnosticFixture(), compilerErrors: [{ code: 'CS0246', line: 0, column: 0, isWarning: false }] }
  for (const diagnostic of [diagnosticFixture(), atLimits, unknown, observedError, errorLimits, zeroPosition]) {
    const { worker, value } = session(t, { ready: false })
    worker.child.stderr.write('private native exception C:\\private\\source.ps1 secret payload')
    worker.send({ protocol: 1, ready: false, error: 'DIRECTORY_HELPER_STARTUP', diagnostic,
      message: 'private native exception', command: 'secret payload' })
    await assert.rejects(value.ready, { code: 'STARTUP_REFUSED' })
    assert.deepEqual(value.events().find(event => event.type === 'failed').startupDiagnostic, diagnostic)
    assert.doesNotMatch(JSON.stringify(value.events()), /private|secret|source\.ps1|message|command/)
    assert.equal(worker.commands.length, 0); assert.equal(worker.spawns.length, 1); assert.equal(worker.kills, 1)
    assert.equal(await value.dispose(), false)
  }
})
test('directory helper refuses malformed startup diagnostics without trusting arbitrary contents', async t => {
  const variants = [null, [], 'private native exception', {},
    { ...diagnosticFixture(), stage: 'SOURCE_COMPILATION private' },
    { ...diagnosticFixture(), errorType: 'Private.User.Secret' },
    { ...diagnosticFixture(), hresult: '0x80131509' },
    { ...diagnosticFixture(), hresult: 1.5 },
    { ...diagnosticFixture(), compilerCodes: 'CS0246' },
    { ...diagnosticFixture(), compilerCodes: ['CS0246 private'] },
    { ...diagnosticFixture(), compilerCodes: [246] },
    { ...diagnosticFixture(), compilerErrors: null },
    { ...diagnosticFixture(), compilerErrors: {} },
    { ...diagnosticFixture(), compilerErrors: [null] },
    { ...diagnosticFixture(), compilerErrors: [[]] },
    { ...diagnosticFixture(), compilerErrors: [{ code: 'CS0246', line: 1, column: 2 }] },
    { ...diagnosticFixture(), compilerErrors: [{ code: 'CS0028', line: 54, column: 15, isWarning: false }] },
    { ...diagnosticFixture(), compilerErrors: [{ code: 'CS0246 private', line: 1, column: 2, isWarning: false }] },
    { ...diagnosticFixture(), compilerErrors: [{ code: 'CS0246', line: '54', column: 15, isWarning: false }] },
    { ...diagnosticFixture(), compilerErrors: [{ code: 'CS0246', line: 54, column: 1.5, isWarning: false }] },
    { ...diagnosticFixture(), compilerErrors: [{ code: 'CS0246', line: 54, column: 15, isWarning: 'false' }] },
    { ...diagnosticFixture(), compilerErrors: [{ code: 'CS0246', line: 54, column: 15, isWarning: false, errorText: 'private native exception' }] },
    { ...diagnosticFixture(), compilerErrors: [{ code: 'CS0246', line: 54, column: 15, isWarning: false, fileName: 'C:\\private\\source.cs' }] },
    { ...diagnosticFixture(), stage: 'UIA_READINESS', compilerErrors: [{ code: 'CS0246', line: 1, column: 2, isWarning: false }] },
    { ...diagnosticFixture(), powerShellVersion: '5.1 private' },
    { ...diagnosticFixture(), powerShellVersion: 5.1 },
    { ...diagnosticFixture(), references: 'System.Core.dll' },
    { ...diagnosticFixture(), references: ['C:\\private\\System.Core.dll'] },
    { ...diagnosticFixture(), references: ['Unexpected.dll'] },
    { ...diagnosticFixture(), message: 'private native exception' }]
  for (const key of Object.keys(diagnosticFixture())) {
    const missing = diagnosticFixture(); delete missing[key]; variants.push(missing)
  }
  for (const diagnostic of variants) {
    const { worker, value } = session(t, { ready: false })
    worker.send({ protocol: 1, ready: false, error: 'DIRECTORY_HELPER_STARTUP', diagnostic })
    await assert.rejects(value.ready, { code: 'STARTUP_REFUSED' })
    assert.equal(value.events().find(event => event.type === 'failed').startupDiagnostic, null)
    assert.doesNotMatch(JSON.stringify(value.events()), /private|Private|Unexpected/)
    assert.equal(worker.commands.length, 0); assert.equal(worker.spawns.length, 1); assert.equal(worker.kills, 1)
    assert.equal(await value.dispose(), false)
  }
})
test('directory helper refuses oversized diagnostics and incompatible startup envelopes', async t => {
  const variants = [
    { diagnostic: { ...diagnosticFixture(), hresult: -2147483649 } },
    { diagnostic: { ...diagnosticFixture(), hresult: 2147483648 } },
    { diagnostic: { ...diagnosticFixture(), compilerCodes: Array.from({ length: 9 }, (_, i) => 'CS' + String(1000 + i)) } },
    { diagnostic: { ...diagnosticFixture(), compilerCodes: ['CS0246', 'CS0246'] } },
    { diagnostic: { ...diagnosticFixture(), compilerErrors: Array.from({ length: 9 }, (_, line) => ({ code: 'CS0246', line, column: 1, isWarning: false })) } },
    { diagnostic: { ...diagnosticFixture(), compilerErrors: Array.from({ length: 2 }, () => ({ code: 'CS0246', line: 1, column: 1, isWarning: false })) } },
    ...['line', 'column'].flatMap(key => [-1, 65536].map(position => ({ diagnostic: { ...diagnosticFixture(),
      compilerErrors: [{ code: 'CS0246', line: 1, column: 1, isWarning: false, [key]: position }] } }))),
    { diagnostic: { ...diagnosticFixture(), powerShellVersion: '100000.1' } },
    { diagnostic: { ...diagnosticFixture(), powerShellVersion: '1.2.3.4.5' } },
    { diagnostic: { ...diagnosticFixture(), references: [...diagnosticFixture().references, 'System.dll'] } },
    { diagnostic: { ...diagnosticFixture(), references: ['System.dll', 'System.dll'] } },
    { diagnostic: { ...diagnosticFixture(), errorType: 'System.' + 'x'.repeat(1024) } },
    { diagnostic: { ...diagnosticFixture(), stage: 'SOURCE_COMPILATION' + 'x'.repeat(1024) } },
    { protocol: 2 }, { ready: 'false' }, { error: 'private startup failure' }, { error: null },
  ]
  for (const change of variants) {
    const { worker, value } = session(t, { ready: false })
    worker.send({ protocol: 1, ready: false, error: 'DIRECTORY_HELPER_STARTUP', diagnostic: diagnosticFixture(), ...change })
    await assert.rejects(value.ready, { code: 'STARTUP_REFUSED' })
    assert.equal(value.events().find(event => event.type === 'failed').startupDiagnostic, null)
    assert.doesNotMatch(JSON.stringify(value.events()), /private|xxx/)
    assert.equal(worker.commands.length, 0); assert.equal(worker.spawns.length, 1); assert.equal(worker.kills, 1)
    assert.equal(await value.dispose(), false)
  }
})
test('minimum native window result cannot claim a renderer-only resize', async t => {
  const { value } = session(t, { response: r => ({ id: r.id, ok: true, result: { handle: binding.mainHandle, pid: binding.pid, width: 1024, height: 700, applied: true } }) })
  await value.ready; await assert.rejects(value.minimumWindow(binding), { code: 'IDENTITY_OR_ACTION_MISMATCH' })
})

// Inspect every actual renderer expression rather than merely parsing its
// enclosing .mjs file. Quoted/multiline values must remain data in generated JS.
function rendererExpressions(filename, bindings = {}) {
  const source = readFileSync(new URL('./' + filename, import.meta.url), 'utf8')
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }), sites = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'evaluate') {
      assert.equal(node.arguments.length, 1); const argument = node.arguments[0]
      assert.ok(['Literal', 'TemplateLiteral'].includes(argument.type))
      const generated = new Script(source.slice(argument.start, argument.end)).runInNewContext({ q: JSON.stringify,
        panel: '[data-local-export-workspace]', F, folder: { id: 'folder-1' }, failing: { id: 'note-2' },
        itemSelector: id => '[data-local-export-item=' + JSON.stringify(id) + ']', feedback: '[data-local-export-feedback]',
        controls: ['[data-local-export-continue]'], requested: { selector: 'button', text: '中文' }, ...bindings })
      sites.push({ line: node.loc.start.line, generated }); assert.equal(typeof generated, 'string')
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value)
  }
  visit(ast); return sites
}
const edge = 'quotes\'" slash\\ line\r\n \u2028\u2029 ` ${globalThis.unexpectedMutation=true}'
for (const [filename, expected] of [['check-local-export-desktop.mjs', 20], ['run-local-export-desktop.mjs', 6]])
  for (const [name, bindings] of [['normal', {}], ['quoted multiline', { F: { ...F, body: edge, dirty: edge }, feedback: edge,
    controls: [edge], requested: { selector: 'button', text: edge } }]]) test(filename + ' compiles all renderer boundaries with ' + name + ' values', () => {
    const sites = rendererExpressions(filename, bindings); assert.equal(sites.length, expected)
    for (const site of sites) assert.doesNotThrow(() => new Script(site.generated), filename + ':' + site.line)
  })
test('new export runner keeps original save, reading and shortcut evidence as independent prerequisites', () => {
  const runner = readFileSync(new URL('./run-local-export-desktop.mjs', import.meta.url), 'utf8')
  assert.match(runner, /verifyDesktopSaveReadingReport\(out, process\.env\.GITHUB_SHA\)/)
  assert.match(runner, /verifyShortcutManagementDesktopReport\(out, process\.env\.GITHUB_SHA\)/)
  assert.match(runner, /sameOriginalApplicationBytes: true/)
  assert.doesNotMatch(runner, /Page\.reload|localStorage\.setItem|\.dispatchEvent\(new KeyboardEvent/)
  const old = readFileSync(new URL('./check-desktop-save.mjs', import.meta.url), 'utf8'); assert.doesNotMatch(old, /runLocalExportLifecycle/)
})
test('canonical export fixture uses actual production nodes and stable Lexical serialization', () => {
  const body = localExportDesktopDocument({ image: '/uploads/image.png', attachment: '/uploads/a.txt' })
  const nodes = JSON.parse(body).root.children
  assert.deepEqual(nodes.map(item => item.type), ['heading', 'paragraph', 'paragraph', 'table', 'image', 'attachment', 'paragraph'])
  assert.equal(nodes[2].children[0].format, 1); assert.equal(nodes[3].children.length, 2)
  assert.equal(nodes[4].caption, F.imageCaption); assert.equal(nodes[5].name, F.attachmentName)
})

test('export fixture upload preserves the third attachment refusal and original request bytes', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'export102-upload-contract-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(path.join(directory, 'uploads'))
  const names = ['export102-a.png', 'export102-b.png', 'export102.txt'], saved = [], report = {}
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const index = calls++, file = options.body.get('file'), bytes = Buffer.from(await file.arrayBuffer())
    assert.equal(url, 'http://127.0.0.1:27121/api/upload'); assert.equal(options.method, 'POST')
    assert.equal(options.headers.Origin, 'null'); assert.ok(options.signal instanceof AbortSignal)
    assert.deepEqual([...options.body.keys()], ['file']); assert.equal(file.name, names[index])
    assert.equal(file.type, index === 2 ? 'text/plain' : 'image/png')
    assert.deepEqual(bytes, index === 2 ? Buffer.from(F.attachment) : Buffer.from(F.pngBase64, 'base64'))
    if (index === 2) {
      assert.equal(bytes.length, 46)
      return Response.json({ code: 1010, message: '文件内容类型不匹配: application/octet-stream', detail: 'PRIVATE_UPLOAD_DETAIL' })
    }
    const filename = 'uploaded-' + index + '.png'; writeFileSync(path.join(directory, 'uploads', filename), bytes)
    return Response.json({ code: 0, message: 'OK', data: { url: '/uploads/' + filename }, detail: 'PRIVATE_UPLOAD_DETAIL' })
  })
  await assert.rejects(verifyLocalExportDesktop({ report, save: () => saved.push(structuredClone(report)), dataDirectory: directory }), error => {
    assert.equal(error.code, 'ERR_ASSERTION'); assert.equal(error.actual, 1010); assert.equal(error.expected, 0)
    assert.match(error.message, /export102\.txt/); assert.match(error.message, /application\/octet-stream/)
    assert.doesNotMatch(error.message, /PRIVATE_UPLOAD_DETAIL/); return true
  })
  assert.equal(calls, 3)
  assert.deepEqual(report.fixtureUploads, names.map((name, index) => ({ name, httpStatus: 200, code: index === 2 ? 1010 : 0,
    message: index === 2 ? '文件内容类型不匹配: application/octet-stream' : 'OK' })))
  assert.deepEqual(saved.at(-1).fixtureUploads, report.fixtureUploads)
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_UPLOAD_DETAIL|uploaded-0|uploaded-1/)
})

test('export fixture upload bounds HTTP failures and untrusted response details', async t => {
  const secret = 'PRIVATE_UPLOAD_MARKER C:\\private\\token /private/token ' + 'x'.repeat(8192)
  const cases = [
    { response: () => new Response(secret, { status: 503 }), httpStatus: 503, code: null, message: 'RESPONSE_NOT_READ', actual: 503, expected: 200 },
    { response: () => new Response(secret, { status: 200 }), httpStatus: 200, code: null, message: 'RESPONSE_JSON_UNAVAILABLE', actual: false, expected: true },
    { response: () => Response.json({ code: 1010, message: secret, detail: secret }), httpStatus: 200, code: 1010, message: 'UNRECOGNIZED_SERVER_MESSAGE', actual: 1010, expected: 0 },
    { response: () => Response.json({ code: secret, message: { path: secret } }), httpStatus: 200, code: null, message: 'UNRECOGNIZED_SERVER_MESSAGE', actual: false, expected: true },
    { response: () => Response.json({ code: 70000, message: secret }), httpStatus: 200, code: null, message: 'UNRECOGNIZED_SERVER_MESSAGE', actual: false, expected: true },
  ]
  let selected, calls = 0, response
  t.mock.method(globalThis, 'fetch', async () => { calls++; response = selected.response(); return response })
  for (const sample of cases) {
    selected = sample
    const report = {}, saved = [], before = calls
    await assert.rejects(verifyLocalExportDesktop({ report, save: () => saved.push(structuredClone(report)), dataDirectory: run }), error => {
      assert.equal(error.code, 'ERR_ASSERTION'); assert.equal(error.actual, sample.actual); assert.equal(error.expected, sample.expected)
      assert.match(error.message, /export102-a\.png/); assert.doesNotMatch(error.stack, /PRIVATE_UPLOAD_MARKER|private\\\\token|private\/token/)
      assert.ok(error.message.length < 256); return true
    })
    assert.equal(calls, before + 1)
    assert.deepEqual(report.fixtureUploads, [{ name: 'export102-a.png', httpStatus: sample.httpStatus, code: sample.code, message: sample.message }])
    assert.deepEqual(saved.at(-1).fixtureUploads, report.fixtureUploads)
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_UPLOAD_MARKER/); assert.ok(JSON.stringify(report).length < 256)
    if (sample.httpStatus !== 200) assert.equal(response.bodyUsed, false)
  }
  const before = calls, full = { fixtureUploads: Array(3).fill({ name: 'export102.txt' }) }
  await assert.rejects(verifyLocalExportDesktop({ report: full, save: () => assert.fail('Full fixture log must not be changed'), dataDirectory: run }), /Export fixture upload limit/)
  assert.equal(calls, before); assert.equal(full.fixtureUploads.length, 3)
})

test('export fixture upload retains a bounded request failure before any response', async t => {
  const report = {}, saved = []; let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('PRIVATE_UPLOAD_NETWORK C:\\private\\credential') })
  await assert.rejects(verifyLocalExportDesktop({ report, save: () => saved.push(structuredClone(report)), dataDirectory: run }), error => {
    assert.match(error.message, /export102-a\.png/); assert.match(error.message, /REQUEST_FAILED/)
    assert.doesNotMatch(error.stack, /PRIVATE_UPLOAD_NETWORK|credential/); return true
  })
  assert.equal(calls, 1)
  assert.deepEqual(report.fixtureUploads, [{ name: 'export102-a.png', httpStatus: null, code: null, message: 'REQUEST_FAILED' }])
  assert.deepEqual(saved.at(-1).fixtureUploads, report.fixtureUploads)
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_UPLOAD_NETWORK|credential/)
})

async function actualOutputFixture(directory) {
  // Match the core's native realpath operation: the default sync implementation
  // resolves links but preserves Windows 8.3 directory aliases. Canonicalize
  // both roots before mapping native receipts into the retained file manifest.
  directory = realpathSync.native(directory)
  const report = fixture(), exportDirectory = path.join(directory, 'local-export-files'); mkdirSync(exportDirectory)
  const root = realpathSync.native(exportDirectory)
  const apiResponse = value => new Response(JSON.stringify({ code: 0, data: value }), { headers: { 'content-type': 'application/json' } })
  for (const [label, count, format] of [['markdown', 3, 'markdown'], ['partial', 3, 'markdown'], ['word', 3, 'docx'], ['cancelled', 100, 'docx']]) {
    const parent = { id: count === 100 ? 'folder-cancel' : 'folder-main', title: '目录', is_folder: true, parent_id: '' }
    const documents = Array.from({ length: count }, (_, i) => ({ id: (count === 100 ? 'batch-' : 'note-') + i, is_folder: false, parent_id: parent.id,
      title: count === 100 ? 'EXPORT102 Batch ' + String(i + 1).padStart(3, '0') + '.md' : i ? 'EXPORT102 重名.md' : 'EXPORT102 原文.md',
      content: localExportDesktopDocument(count === 3 ? { body: label !== 'markdown' && i === 1 ? F.frozen : F.body,
        image: '/uploads/image.png', attachment: '/uploads/a.txt' } : { body: F.body + ' batch ' + i }) }))
    const fetchImpl = async url => {
      const pathname = new URL(url).pathname
      if (pathname === '/api/files') return apiResponse([parent, ...documents].map(({ content, ...rest }) => rest))
      if (pathname.startsWith('/api/files/')) return apiResponse(documents.find(item => pathname.endsWith('/' + item.id)))
      if (pathname === '/uploads/image.png') return new Response(Buffer.from(F.pngBase64, 'base64'), { headers: { 'content-type': 'image/png' } })
      if (pathname === '/uploads/a.txt') return new Response(F.attachment, { headers: { 'content-type': 'text/plain' } })
      return new Response('', { status: 404 })
    }
    const selected = await prepareExportPlan({ ids: [parent.id], format, fetchImpl }), targetDir = path.join(root, label); mkdirSync(targetDir)
    const result = await executeExportPlan(selected, { targetDir }); assert.equal(result.state, 'completed')
    const observed = { phase: 'settled', state: 'completed', items: result.items.map(item => ({ id: item.id, title: item.title,
      status: item.status, path: report.exportRoot + '\\' + path.relative(root, item.outputPath).replaceAll(path.sep, '\\'),
      preview: item.preview, bytes: item.bytes, sha256: item.sha256, warnings: item.warnings, message: item.message || '' })) }
    report[label === 'partial' ? 'retry' : label === 'cancelled' ? 'continued' : label] = observed
  }
  const files = []; const walk = current => {
    for (const name of readdirSync(current)) { const filename = path.join(current, name), stat = lstatSync(filename)
      if (stat.isDirectory()) walk(filename); else { const bytes = readFileSync(filename); files.push({ filename: path.relative(directory, filename).replaceAll(path.sep, '/'), bytes: bytes.length, sha256: hash(bytes) }) }
    }
  }; walk(root); report.files = files
  report.sourceFiles = Object.fromEntries(LOCAL_EXPORT_SOURCES.map(name => [name, exportBlob(readFileSync(new URL('./' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n'))]))
  // Only a byte-verifier fixture, deliberately not represented as a UI screenshot.
  const png = Buffer.concat([Buffer.from(F.pngBase64, 'base64'), Buffer.alloc(2048)])
  report.screenshots = LOCAL_EXPORT_IMAGES.map(filename => { writeFileSync(path.join(directory, filename), png); return { filename, bytes: png.length, sha256: hash(png) } })
  writeFileSync(path.join(directory, LOCAL_EXPORT_REPORT), JSON.stringify(report)); return report
}
test('raw oracle reads real core Markdown, DOCX ZIP/CRC, embedded images and every sidecar byte', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'local-export-file-contract-')); t.after(() => rmSync(directory, { recursive: true, force: true }))
  const report = await actualOutputFixture(directory)
  assert.equal((await verifyLocalExportDesktopReport(directory, HEAD)).complete, true)
  assert.deepEqual(await verifyLocalExportFiles(directory, report), { markdownDocuments: 6, wordDocuments: 103, wordWithMedia: 3, offlineImages: 6, offlineAttachments: 9 })
  const markdown = report.files.find(item => item.filename.endsWith('.md')), original = readFileSync(path.join(directory, markdown.filename))
  writeFileSync(path.join(directory, markdown.filename), Buffer.concat([original, Buffer.from('changed')]))
  await assert.rejects(verifyLocalExportFiles(directory, report)); writeFileSync(path.join(directory, markdown.filename), original)
  const docx = report.files.find(item => item.filename.endsWith('.docx')), saved = readFileSync(path.join(directory, docx.filename))
  const zip = await JSZip.loadAsync(saved); zip.file('word/document.xml', '<w:document>silently missing table and body</w:document>')
  const altered = await zip.generateAsync({ type: 'nodebuffer' }); writeFileSync(path.join(directory, docx.filename), altered)
  const corrupt = structuredClone(report), edited = corrupt.files.find(item => item.filename === docx.filename)
  Object.assign(edited, { bytes: altered.length, sha256: hash(altered) }); await assert.rejects(verifyLocalExportFiles(directory, corrupt))
  writeFileSync(path.join(directory, docx.filename), saved)
  const attachment = report.files.find(item => item.filename.endsWith('.txt')); const absent = structuredClone(report)
  absent.files = absent.files.filter(item => item !== absent.files.find(file => file.filename === attachment.filename))
  await assert.rejects(verifyLocalExportFiles(directory, absent))

  // The output and displayed receipt remain internally consistent. These
  // refusals must depend on the source fixture's body/reference expectations,
  // not on a stale checksum, missing heading/table/media or a missing sidecar.
  const entryFor = item => report.files.find(file => file.filename === 'local-export-files/' +
    path.win32.relative(report.exportRoot, item.path).replaceAll('\\', '/'))
  const rewriteZip = async (bytes, change) => {
    const value = await JSZip.loadAsync(bytes); await change(value)
    return value.generateAsync({ type: 'nodebuffer' })
  }
  const replaceXML = async (zip, filename, change) => {
    const before = await zip.file(filename).async('string'), after = change(before)
    assert.notEqual(after, before, 'The corruption fixture did not change the intended XML')
    zip.file(filename, after)
  }
  const consistentCorruption = async (name, item, change) => {
    const entry = entryFor(item); assert.ok(entry)
    const filename = path.join(directory, entry.filename), before = readFileSync(filename), after = await change(before)
    assert.notDeepEqual(after, before, name)
    const corrupted = structuredClone(report), receipt = { bytes: after.length, sha256: hash(after) }
    Object.assign(corrupted.files.find(file => file.filename === entry.filename), receipt)
    for (const group of ['markdown', 'retry', 'word', 'continued'])
      for (const observed of corrupted[group].items) if (observed.path === item.path) Object.assign(observed, receipt)
    writeFileSync(filename, after)
    try { await assert.rejects(verifyLocalExportFiles(directory, corrupted), undefined, name) }
    finally { writeFileSync(filename, before) }
  }
  const markdownNote = report.markdown.items.find(item => item.id === report.fixture.noteID)
  const wordNote = report.word.items.find(item => item.id === report.fixture.noteID)
  const wordFrozen = report.word.items.find(item => item.id === report.fixture.frozenID)
  await consistentCorruption('Markdown body missing with valid receipt', markdownNote,
    bytes => Buffer.from(bytes.toString('utf8').replace(/^EXPORT102 saved body[^\n]*$/m, '正文丢失')))
  await consistentCorruption('Word body missing but heading table and media remain', wordNote,
    bytes => rewriteZip(bytes, zip => replaceXML(zip, 'word/document.xml', xml =>
      xml.replace(/<w:t(?:\s[^>]*)?>EXPORT102 saved body[^<]*<\/w:t>/, '<w:t>正文丢失</w:t>'))))
  await consistentCorruption('Word later snapshot replaced by old body', wordFrozen,
    bytes => rewriteZip(bytes, zip => replaceXML(zip, 'word/document.xml', xml =>
      xml.replace(F.frozen, F.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')))))
  await consistentCorruption('Continued document contains another batch body', report.continued.items.find(item => item.id === 'batch-42'),
    bytes => rewriteZip(bytes, zip => replaceXML(zip, 'word/document.xml', xml => xml.replace(/batch 42\b/g, 'batch 7'))))
  await consistentCorruption('Markdown attachment reference removed but sidecar remains', markdownNote,
    bytes => Buffer.from(bytes.toString('utf8').replace(/^\[[^\]\n]+\]\([^\n]+\)\s*$/m, '附件文字保留')))
  await consistentCorruption('Word attachment relationship removed but sidecar remains', wordNote,
    bytes => rewriteZip(bytes, zip => replaceXML(zip, 'word/_rels/document.xml.rels', xml =>
      xml.replace(/<Relationship\b[^>]*Type="[^"]*\/hyperlink"[^>]*\/>/g, ''))))
  await consistentCorruption('Word relationship exists but the document hyperlink is missing', wordNote,
    bytes => rewriteZip(bytes, zip => replaceXML(zip, 'word/document.xml', xml => xml.replace(/<w:hyperlink\b[^>]*>[\s\S]*?<\/w:hyperlink>/g, ''))))
  const otherAssets = path.posix.basename(entryFor(report.word.items.find(item => item.id === report.fixture.frozenID)).filename, '.docx') + '_assets/' + F.attachmentName
  const wrongTarget = otherAssets.replace(/[\s()<>"\\]/g, char => encodeURIComponent(char))
  await consistentCorruption('Word attachment points to another document sidecar with identical bytes', wordNote,
    bytes => rewriteZip(bytes, zip => replaceXML(zip, 'word/_rels/document.xml.rels', xml =>
      xml.replace(/(<Relationship\b[^>]*Type="[^"]*\/hyperlink"[^>]*Target=")[^"]+/, '$1' + wrongTarget))))
})
test('raw output fixture canonicalizes an owned directory alias before mapping receipts', async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'local-export-alias-contract-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const directory = path.join(parent, 'actual'), alias = path.join(parent, 'alias'); mkdirSync(directory)
  symlinkSync(directory, alias, 'junction')
  assert.notEqual(path.resolve(alias), realpathSync(alias)); assert.equal(realpathSync(alias), realpathSync(directory))
  const canonicalDirectory = await realpathAsync(directory)
  assert.equal(realpathSync.native(directory), canonicalDirectory)
  assert.equal(realpathSync.native(alias), canonicalDirectory)
  assert.equal(await realpathAsync(alias), canonicalDirectory)
  const report = await actualOutputFixture(alias)
  const output = report.files.find(file => file.filename.endsWith('.docx')); assert.ok(output)
  const canonicalFile = await realpathAsync(path.join(alias, output.filename)), lexicalRelative = path.relative(alias, canonicalFile)
  assert.ok(lexicalRelative.startsWith('..' + path.sep), 'The fixture must exercise an actual filesystem alias')
  t.diagnostic('Owned alias resolves to the same root while lexical mapping escapes: ' + lexicalRelative)
  assert.equal((await verifyLocalExportDesktopReport(alias, HEAD)).complete, true)
  assert.equal(validateLocalExportDesktopReport(report, HEAD), true)
})
test('raw output manifest rejects unsafe paths, duplicates, empty files and excessive totals', () => {
  const entry = { filename: 'local-export-files/one.md', bytes: 1, sha256: H }
  for (const filename of ['../escape', '/absolute', 'C:\\escape', 'local-export-files/../escape', 'local-export-files/a\\b', 'local-export-files//a'])
    assert.throws(() => validateExportFileManifest([{ ...entry, filename }]))
  assert.throws(() => validateExportFileManifest([entry, { ...entry, filename: 'local-export-files/ONE.md' }]))
  assert.throws(() => validateExportFileManifest([{ ...entry, bytes: 0 }]))
  assert.throws(() => validateExportFileManifest(Array.from({ length: 5 }, (_, i) => ({ ...entry, filename: 'local-export-files/' + i, bytes: 32 * 1024 * 1024 }))))
})
test('raw output reader refuses a symlink to bytes outside the retained archive', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'local-export-link-contract-')); t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(path.join(directory, 'local-export-files')); mkdirSync(path.join(directory, 'outside'))
  writeFileSync(path.join(directory, 'outside', 'one.md'), 'x')
  symlinkSync(path.join(directory, 'outside'), path.join(directory, 'local-export-files', 'linked'), 'junction')
  await assert.rejects(verifyLocalExportFiles(directory, { files: [{ filename: 'local-export-files/linked/one.md', bytes: 1, sha256: hash('x') }] }))
})
