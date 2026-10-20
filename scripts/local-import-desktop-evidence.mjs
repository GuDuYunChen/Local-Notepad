import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

export const LOCAL_IMPORT_CHECKS = Object.freeze([
  'original-library-menu-opens-the-local-import-workspace',
  'real-file-input-uses-production-preload-for-owned-local-files',
  'markdown-text-and-both-workbook-sheets-reach-the-preview',
  'one-malformed-file-is-an-individual-error-with-valid-rows-retained',
  'preview-and-selection-perform-zero-note-writes',
  'edited-title-and-child-folder-determine-the-confirmed-destination',
  'explicit-confirmation-returns-one-durable-receipt-per-valid-row',
  'imported-markdown-retains-native-code-table-and-formula-nodes',
  'result-opens-the-real-editor-and-original-save-persists-its-edit',
  'original-cancel-decision-retains-the-source-draft-and-database-body',
  'original-discard-decision-opens-the-result-without-saving-the-draft',
  'original-save-decision-persists-the-source-before-opening-the-result',
  'same-name-rejection-does-not-overwrite-the-existing-note',
  'explicit-revision-after-name-rejection-creates-the-renamed-note',
  'deleted-destination-is-rejected-with-no-created-note',
  'explicit-destination-repair-reuses-the-retained-preview',
  'lost-real-post-commit-response-retains-the-original-request-identity',
  'read-only-reconciliation-recovers-the-same-file-without-another-post',
  'stopping-a-held-real-response-leaves-following-items-unsubmitted',
  'closing-a-held-real-response-cannot-submit-following-items-later',
  'reopen-retains-unresolved-records-and-allows-explicit-recovery',
  'real-file-drag-opens-the-same-preview-before-explicit-import',
  'unrelated-note-bodies-metadata-and-pins-remain-unchanged',
  'fresh-native-process-recovers-identical-files-and-request-receipts',
  'restarted-imported-note-opens-its-saved-rich-body-without-draft-cache',
])

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const digest = /^[a-f0-9]{64}$/
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

// Expected original workbook values. This oracle is independent of the Office
// parser and never decodes the product's temporary table-cell encoding.
export const LOCAL_IMPORT_WORKBOOK_HEADINGS = Object.freeze(['成本$100$', '_名称_'])
export const LOCAL_IMPORT_WORKBOOK_CELLS = Object.freeze([
  [['中文列', '数值'], ['import99-sheet-one', '101'], ['Windows 路径', 'C:\\temp\\file.txt'],
    ['反斜杠与管道', 'A\\|B'], ['字面金额', '$100$']],
  [['中文列', '数值'], ['import99-sheet-two', '202'], ['字面 HTML', 'literal <br> tag'],
    ['内嵌换行', '首行99\n次行99'], ['占位符样文本', 'NPIMPORTCELLV1:5Lit5paH']],
])

export function extractImportedWorkbookHeadings(content) {
  return JSON.parse(content).root.children.filter(node => node.type === 'heading').map(heading => {
    assert.equal(heading.tag, 'h2', 'An Excel sheet name lost its second-level heading')
    assert.ok(heading.children.length > 0)
    return heading.children.map(node => {
      assert.equal(node.type, 'text', 'An Excel sheet name was interpreted as a non-text node')
      assert.equal(node.format, 0, 'An Excel sheet name acquired Markdown text formatting')
      assert.equal(typeof node.text, 'string')
      return node.text
    }).join('')
  })
}

export function extractImportedWorkbookCells(content) {
  return JSON.parse(content).root.children.filter(node => node.type === 'table').map(table =>
    table.children.map(row => {
      assert.equal(row.type, 'tablerow')
      return row.children.map(cell => {
        assert.equal(cell.type, 'tablecell')
        assert.ok(cell.children.length > 0)
        return cell.children.map(paragraph => {
          assert.equal(paragraph.type, 'paragraph')
          return paragraph.children.map(node => {
            if (node.type === 'linebreak') return '\n'
            assert.equal(node.type, 'text', 'An Office cell was interpreted as a non-text node')
            assert.equal(node.format, 0, 'An Office cell acquired Markdown text formatting')
            assert.equal(typeof node.text, 'string')
            return node.text
          }).join('')
        }).join('\n')
      })
    }))
}

export function validateLocalImportDesktopReport(report, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/)
  assert.equal(report.commit, commit)
  assert.equal(report.complete, true)
  assert.equal(report.error, undefined)
  assert.equal(report.platform, 'win32')
  assert.equal(report.appVersion, '4.234.0')
  for (const name of ['realPackagedApp', 'realBackend', 'realPreload', 'syntheticData', 'cleanupComplete']) assert.equal(report[name], true)
  assert.equal(report.timerAccelerated, false)
  assert.equal(report.bridgeOverridden, false)
  assert.deepEqual(report.checks, LOCAL_IMPORT_CHECKS)
  assert.deepEqual(report.fileInput, { method: 'DOM.setFileInputFiles', selector: '[data-local-import-input]', ownedNativeFiles: true })
  assert.deepEqual(report.preview, {
    validRows: 3, errorRows: 1, noteWrites: 0, unchangedInventory: true,
    markers: ['import99-markdown-body', 'import99-text-body', 'import99-sheet-one', 'import99-sheet-two'],
  })
  assert.deepEqual(report.workbook, { sheetHeadings: LOCAL_IMPORT_WORKBOOK_HEADINGS, tableCount: 2, bothMarkersPreserved: true,
    cells: LOCAL_IMPORT_WORKBOOK_CELLS, restartedCells: LOCAL_IMPORT_WORKBOOK_CELLS })
  assert.deepEqual(report.plainText, { paragraphsRetained: true, secondLine: '第二行保持原文。' })
  assert.deepEqual(report.richContent.nodeTypes, ['code-block', 'formula', 'heading', 'table'])
  assert.equal(report.richContent.code, 'const import99 = "代码保留";')
  assert.equal(report.richContent.formula, 'x^2 + y^2 = z^2')
  assert.equal(report.richContent.tableTextIncludes, '表格99')
  assert.equal(report.richContent.savedMarker, 'import99-native-saved')
  for (const name of ['cancel', 'discard', 'save']) assert.equal(report.guards[name].confirmed, true)
  assert.equal(report.guards.cancel.sourceDraftRetained, true)
  assert.equal(report.guards.cancel.databaseUnchanged, true)
  assert.equal(report.guards.discard.databaseUnchanged, true)
  assert.equal(report.guards.save.persistedBeforeOpen, true)
  assert.equal(report.nameConflict.reason, 'name-conflict')
  assert.equal(report.nameConflict.existingFileUnchanged, true)
  assert.equal(report.nameConflict.revisedTitle, '导入99同名修复.md')
  assert.equal(report.staleDestination.reason, 'folder-unavailable')
  assert.equal(report.staleDestination.noNoteCreated, true)
  assert.equal(report.staleDestination.repairedByExplicitRevision, true)
  for (const item of [report.nameConflict, report.staleDestination]) {
    assert.match(item.rejectedRequestId, uuid)
    assert.match(item.repairedRequestId, uuid)
    assert.notEqual(item.rejectedRequestId, item.repairedRequestId)
  }
  const recovery = report.reconciliation
  assert.match(recovery.requestId, uuid)
  assert.match(recovery.fileId, uuid)
  assert.equal(recovery.method, 'POST')
  assert.equal(recovery.responseStatusCode, 200)
  assert.equal(recovery.realCommittedResponseFailed, true)
  assert.equal(recovery.lookupMethod, 'GET')
  assert.equal(recovery.postCountBefore, 1)
  assert.equal(recovery.postCountAfter, 1)
  assert.ok(Number.isSafeInteger(recovery.browserGetCount) && recovery.browserGetCount >= 1)
  assert.equal(recovery.sameFileRecovered, true)
  for (const [kind, title] of [['stop', '导入99停止后项.md'], ['close', '导入99关闭后项.md']]) {
    const item = report.cancellation[kind]
    assert.match(item.requestId, uuid)
    assert.equal(item.realResponseStatusCode, 200)
    assert.equal(item.method, 'POST')
    assert.equal(item.heldRealResponse, true)
    assert.equal(item.followingTitle, title)
    assert.match(item.followingRequestId, uuid)
    assert.notEqual(item.followingRequestId, item.requestId)
    assert.equal(item.followingState, 'pending')
    assert.equal(item.followingPostCount, 0)
    assert.equal(item.followingNoteCount, 0)
    assert.equal(item.recoveredByGet, true)
    assert.equal(item.unstartedRecordExplicitlyCancelled, true)
  }
  assert.deepEqual(report.drag, { method: 'Input.dispatchDragEvent', realFilePath: true, previewBeforeWrite: true, explicitConfirmation: true })
  assert.equal(report.originalNotesUnchanged, true)
  assert.equal(report.committed.length, 9)
  assert.ok(Array.isArray(report.observedRequests))
  const posts = report.observedRequests.filter(item => item.method === 'POST')
  assert.equal(posts.length, 11)
  for (const request of report.observedRequests) {
    assert.match(request.requestId, uuid)
    assert.ok(['GET', 'POST'].includes(request.method))
    assert.equal(typeof request.networkId, 'string')
    assert.ok(request.networkId.length > 0)
  }
  const ids = new Set(), requests = new Set()
  for (const item of report.committed) {
    assert.match(item.requestId, uuid); assert.match(item.fileId, uuid)
    assert.ok(!ids.has(item.fileId)); ids.add(item.fileId)
    assert.ok(!requests.has(item.requestId)); requests.add(item.requestId)
    for (const field of ['initialContentSHA256', 'savedContentSHA256', 'payloadSHA256']) assert.match(item[field], digest)
    assert.equal(item.receiptState, 'available')
    assert.equal(item.postCount, 1)
    assert.equal(posts.filter(request => request.requestId === item.requestId && request.title === item.title).length, 1)
    assert.equal(item.restartedContentMatches, true)
    assert.equal(item.restartedReceiptMatches, true)
  }
  assert.equal(new Set(posts.map(item => item.requestId)).size, posts.length)
  for (const item of [report.nameConflict, report.staleDestination]) {
    assert.equal(posts.filter(request => request.requestId === item.rejectedRequestId).length, 1)
    assert.ok(requests.has(item.repairedRequestId))
    assert.ok(!requests.has(item.rejectedRequestId))
  }
  assert.equal(report.committed.filter(item => item.requestId === recovery.requestId && item.fileId === recovery.fileId).length, 1)
  assert.equal(report.observedRequests.filter(item => item.requestId === recovery.requestId && item.method === 'GET').length, recovery.browserGetCount)
  for (const item of Object.values(report.cancellation)) {
    assert.ok(requests.has(item.requestId))
    assert.equal(posts.filter(request => request.title === item.followingTitle).length, 0)
    assert.equal(posts.filter(request => request.requestId === item.followingRequestId).length, 0)
    assert.ok(report.observedRequests.some(request => request.requestId === item.requestId && request.method === 'GET'))
  }
  assert.equal(report.committed.filter(item => item.title === '导入99目标子目录.md' && uuid.test(item.parentId)).length, 1)
  assert.equal(report.restart.freshProfile, true)
  assert.equal(report.restart.nativeProcessRestart, true)
  assert.ok(Number.isInteger(report.restart.firstPID) && report.restart.firstPID > 0)
  assert.ok(Number.isInteger(report.restart.secondPID) && report.restart.secondPID > 0)
  assert.notEqual(report.restart.firstPID, report.restart.secondPID)
  assert.equal(report.restart.openedSavedBody, true)
  assert.equal(report.restart.draftCacheUsed, false)
  assert.deepEqual(report.screenshots.map(item => item.filename), [
    'local-import-preview.png', 'local-import-results.png',
    'local-import-reconciled.png', 'local-import-restarted.png',
  ])
  for (const item of [...report.screenshots, ...report.inputFiles]) {
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes > 0)
    assert.match(item.sha256, digest)
  }
  assert.equal(report.inputFiles.length, 11)
  assert.deepEqual(report.inputFiles.map(item => item.filename), [
    'local-import-fixtures/导入99富文本.md', 'local-import-fixtures/导入99纯文本.txt',
    'local-import-fixtures/导入99工作簿.xlsx', 'local-import-fixtures/导入99损坏.docx',
    'local-import-fixtures/导入99回执查回.txt', 'local-import-fixtures/导入99失效目录.txt',
    'local-import-fixtures/导入99停止首项.txt', 'local-import-fixtures/导入99停止后项.txt',
    'local-import-fixtures/导入99关闭首项.txt', 'local-import-fixtures/导入99关闭后项.txt',
    'local-import-fixtures/导入99拖入.txt',
  ])
  return report
}

export function verifyLocalImportDesktopReport(directory, commit) {
  const report = validateLocalImportDesktopReport(JSON.parse(readFileSync(path.join(directory, 'local-import.json'), 'utf8')), commit)
  for (const item of report.inputFiles) {
    assert.match(item.filename, /^local-import-fixtures\/[\p{L}\p{N} ._-]+\.(md|txt|xlsx|docx)$/u)
    assert.equal(path.posix.normalize(item.filename), item.filename)
    assert.equal(path.win32.isAbsolute(item.filename), false)
    const bytes = readFileSync(path.join(directory, item.filename))
    assert.equal(bytes.length, item.bytes)
    assert.equal(hash(bytes), item.sha256)
  }
  for (const item of report.screenshots) {
    assert.equal(path.posix.basename(item.filename), item.filename)
    assert.equal(path.win32.basename(item.filename), item.filename)
    const bytes = readFileSync(path.join(directory, item.filename))
    assert.equal(bytes.length, item.bytes)
    assert.equal(hash(bytes), item.sha256)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.ok(bytes.length >= 24)
    assert.ok(bytes.readUInt32BE(16) >= 700 && bytes.readUInt32BE(20) >= 480)
  }
  return report
}
