import path from 'node:path'
import { LOCAL_EXPORT_FIXTURE as F } from './local-export-desktop-values.mjs'
import { LOCAL_EXPORT_VERSION, LOCAL_EXPORT_CHECKS, LOCAL_EXPORT_IMAGES, LOCAL_EXPORT_SOURCES } from './local-export-desktop-evidence.mjs'

// Controlled validator fixture only, never a Windows execution record.
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
export function localExportEvidenceFixture() {
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
