import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import * as XLSX from 'xlsx'
import { LOCAL_IMPORT_CHECKS, LOCAL_IMPORT_WORKBOOK_HEADINGS, LOCAL_IMPORT_WORKBOOK_CELLS,
  extractImportedWorkbookHeadings, extractImportedWorkbookCells,
  validateLocalImportDesktopReport, verifyLocalImportDesktopReport } from './local-import-desktop-evidence.mjs'
import { createLocalImportDesktopFixtures } from './local-import-desktop-fixture.mjs'

const commit = 'a'.repeat(40), sha = 'f'.repeat(64)
const id = n => n.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000'
// These are deliberately synthetic validator-unit inputs, never Windows proof.
function fixture() {
  const titles = ['导入99目标子目录.md', '导入99纯文本.md', '导入99两张表.md', '导入99同名修复.md', '导入99目录修复.md', '导入99回执查回.md', '导入99停止首项.md', '导入99关闭首项.md', '导入99拖入.md']
  const committed = titles.map((title, i) => ({ requestId: id(i + 1), fileId: id(i + 101), title, parentId: i ? '' : id(200),
    initialContentSHA256: sha, savedContentSHA256: sha, payloadSHA256: sha, receiptState: 'available', postCount: 1,
    restartedContentMatches: true, restartedReceiptMatches: true }))
  const posts = committed.map((item, index) => ({ networkId: String(index + 1), requestId: item.requestId, method: 'POST', title: item.title }))
  const rejected = [20, 21].map((value, i) => ({ networkId: String(value), requestId: id(value), method: 'POST', title: titles[i + 1] }))
  const gets = [6, 7, 8].map(value => ({ networkId: String(value + 30), requestId: id(value), method: 'GET', title: null }))
  const image = filename => ({ filename, bytes: 100, sha256: sha })
  return {
    complete: true, commit, platform: 'win32', appVersion: '4.234.0', realPackagedApp: true, realBackend: true,
    realPreload: true, syntheticData: true, cleanupComplete: true, timerAccelerated: false, bridgeOverridden: false,
    checks: [...LOCAL_IMPORT_CHECKS], fileInput: { method: 'DOM.setFileInputFiles', selector: '[data-local-import-input]', ownedNativeFiles: true },
    preview: { validRows: 3, errorRows: 1, noteWrites: 0, unchangedInventory: true, markers: ['import99-markdown-body', 'import99-text-body', 'import99-sheet-one', 'import99-sheet-two'] },
    workbook: { sheetHeadings: [...LOCAL_IMPORT_WORKBOOK_HEADINGS], tableCount: 2, bothMarkersPreserved: true,
      cells: structuredClone(LOCAL_IMPORT_WORKBOOK_CELLS), restartedCells: structuredClone(LOCAL_IMPORT_WORKBOOK_CELLS) },
    plainText: { paragraphsRetained: true, secondLine: '第二行保持原文。' },
    richContent: { nodeTypes: ['code-block', 'formula', 'heading', 'table'], code: 'const import99 = "代码保留";', formula: 'x^2 + y^2 = z^2', tableTextIncludes: '表格99', savedMarker: 'import99-native-saved' },
    guards: { cancel: { confirmed: true, sourceDraftRetained: true, databaseUnchanged: true }, discard: { confirmed: true, databaseUnchanged: true }, save: { confirmed: true, persistedBeforeOpen: true } },
    nameConflict: { reason: 'name-conflict', rejectedRequestId: id(20), repairedRequestId: id(4), existingFileUnchanged: true, revisedTitle: titles[3] },
    staleDestination: { reason: 'folder-unavailable', rejectedRequestId: id(21), repairedRequestId: id(5), noNoteCreated: true, repairedByExplicitRevision: true },
    reconciliation: { requestId: id(6), fileId: id(106), method: 'POST', responseStatusCode: 200, realCommittedResponseFailed: true,
      lookupMethod: 'GET', postCountBefore: 1, postCountAfter: 1, browserGetCount: 1, sameFileRecovered: true },
    cancellation: Object.fromEntries([['stop', 7, '导入99停止后项.md'], ['close', 8, '导入99关闭后项.md']].map(([kind, value, title]) => [kind,
      { requestId: id(value), method: 'POST', realResponseStatusCode: 200, heldRealResponse: true, followingTitle: title, followingRequestId: id(value + 300), followingState: 'pending', followingPostCount: 0, followingNoteCount: 0, recoveredByGet: true, unstartedRecordExplicitlyCancelled: true }])),
    drag: { method: 'Input.dispatchDragEvent', realFilePath: true, previewBeforeWrite: true, explicitConfirmation: true },
    originalNotesUnchanged: true, committed, observedRequests: [...posts, ...rejected, ...gets],
    restart: { firstPID: 1200, secondPID: 1300, freshProfile: true, nativeProcessRestart: true, draftCacheUsed: false, openedSavedBody: true },
    screenshots: ['local-import-preview.png', 'local-import-results.png', 'local-import-reconciled.png', 'local-import-restarted.png'].map(image),
    inputFiles: ['导入99富文本.md', '导入99纯文本.txt', '导入99工作簿.xlsx', '导入99损坏.docx', '导入99回执查回.txt', '导入99失效目录.txt', '导入99停止首项.txt', '导入99停止后项.txt', '导入99关闭首项.txt', '导入99关闭后项.txt', '导入99拖入.txt'].map(name => image('local-import-fixtures/' + name)),
  }
}

test('complete synthetic evidence exercises the report contract only', () => {
  assert.equal(validateLocalImportDesktopReport(fixture(), commit).checks.length, 25)
})

const refusals = [
  ['foreign commit', r => r.commit = 'b'.repeat(40)], ['incomplete', r => r.complete = false],
  ['recorded error', r => r.error = 'failed'], ['non-Windows', r => r.platform = 'linux'],
  ['old package version', r => r.appVersion = '4.231.2'],
  ...['realPackagedApp', 'realBackend', 'realPreload', 'syntheticData', 'cleanupComplete'].map(key => ['missing ' + key, r => r[key] = false]),
  ['accelerated timer', r => r.timerAccelerated = true], ['replaced bridge', r => r.bridgeOverridden = true],
  ['missing check', r => r.checks.pop()], ['duplicate check', r => r.checks[1] = r.checks[0]],
  ['reordered checks', r => r.checks.reverse()], ['mock file selection', r => r.fileInput.method = 'Runtime.evaluate'],
  ['foreign file input', r => r.fileInput.ownedNativeFiles = false], ['preview writes', r => r.preview.noteWrites = 1],
  ['preview inventory changed', r => r.preview.unchangedInventory = false], ['lost second sheet', r => r.preview.markers.pop()],
  ['lost worksheet heading', r => r.workbook.sheetHeadings.pop()], ['lost worksheet native table', r => r.workbook.tableCount = 1],
  ['worksheet dollars interpreted', r => r.workbook.sheetHeadings[0] = '成本100'],
  ['worksheet underscores interpreted', r => r.workbook.sheetHeadings[1] = '名称'],
  ...[['cells', 'initial'], ['restartedCells', 'restarted']].flatMap(([key, phase]) => [
    ['changed ' + phase + ' XLSX Windows path', r => r.workbook[key][0][2][1] = 'C:tempfile.txt'],
    ['changed ' + phase + ' XLSX literal pipe', r => r.workbook[key][0][3][1] = 'A|B'],
    ['changed ' + phase + ' XLSX literal dollars', r => r.workbook[key][0][4][1] = '100'],
    ['changed ' + phase + ' XLSX literal HTML', r => r.workbook[key][1][2][1] = 'literal \n tag'],
    ['changed ' + phase + ' XLSX embedded newline', r => r.workbook[key][1][3][1] = '首行99 次行99'],
    ['decoded ' + phase + ' XLSX placeholder-like text twice', r => r.workbook[key][1][4][1] = '中文'],
  ]),
  ['changed plain text structure', r => r.plainText.paragraphsRetained = false],
  ['discarded parser error', r => r.preview.errorRows = 0], ['lost native table', r => r.richContent.nodeTypes.pop()],
  ['changed code', r => r.richContent.code = 'empty'], ['lost equation', r => r.richContent.formula = 'empty'],
  ['no original save', r => r.richContent.savedMarker = 'preview-only'],
  ['cancel discarded draft', r => r.guards.cancel.sourceDraftRetained = false], ['cancel wrote source', r => r.guards.cancel.databaseUnchanged = false],
  ['discard wrote source', r => r.guards.discard.databaseUnchanged = false], ['open preceded source save', r => r.guards.save.persistedBeforeOpen = false],
  ['same-name overwrite', r => r.nameConflict.existingFileUnchanged = false], ['wrong name failure', r => r.nameConflict.reason = 'unknown'],
  ['revision reused rejected identity', r => r.nameConflict.repairedRequestId = r.nameConflict.rejectedRequestId],
  ['stale directory wrote note', r => r.staleDestination.noNoteCreated = false], ['unconfirmed directory repair', r => r.staleDestination.repairedByExplicitRevision = false],
  ['lost response before actual commit', r => r.reconciliation.responseStatusCode = 500], ['synthetic lost response', r => r.reconciliation.realCommittedResponseFailed = false],
  ['reconciliation reposted', r => r.reconciliation.postCountAfter = 2], ['reconciliation used POST', r => r.reconciliation.lookupMethod = 'POST'],
  ['reconciliation lacked browser GET', r => r.reconciliation.browserGetCount = 0], ['reconciliation changed file', r => r.reconciliation.fileId = id(900)],
  ['reconciliation changed request', r => r.reconciliation.requestId = id(901)],
  ['stop was not actual response', r => r.cancellation.stop.heldRealResponse = false], ['stop submitted following item', r => r.cancellation.stop.followingPostCount = 1],
  ['close left a new note', r => r.cancellation.close.followingNoteCount = 1], ['close unresolved identity lost', r => r.cancellation.close.recoveredByGet = false],
  ['close lost the unstarted record', r => r.cancellation.close.followingState = 'prepared'], ['unstarted record silently removed', r => r.cancellation.stop.unstartedRecordExplicitlyCancelled = false],
  ['fake file drag', r => r.drag.realFilePath = false], ['drag wrote before consent', r => r.drag.previewBeforeWrite = false],
  ['unrelated note changed', r => r.originalNotesUnchanged = false], ['missing imported result', r => r.committed.pop()],
  ['duplicate file result', r => r.committed[1].fileId = r.committed[0].fileId], ['duplicate request result', r => r.committed[1].requestId = r.committed[0].requestId],
  ['absent saved hash', r => r.committed[0].savedContentSHA256 = 'not-a-hash'], ['deleted result', r => r.committed[0].receiptState = 'deleted'],
  ['restart body differs', r => r.committed[0].restartedContentMatches = false], ['restart receipt differs', r => r.committed[0].restartedReceiptMatches = false],
  ['missing child directory', r => r.committed[0].parentId = ''], ['omitted real POST trace', r => r.observedRequests.shift()],
  ['duplicate actual POST trace', r => r.observedRequests.push({ ...r.observedRequests[0] })],
  ['mismatched browser read trace', r => r.observedRequests.at(-3).requestId = id(900)],
  ['late following POST trace', r => r.observedRequests[0].title = r.cancellation.close.followingTitle],
  ['same process as restart', r => r.restart.secondPID = r.restart.firstPID], ['renderer-only restart', r => r.restart.nativeProcessRestart = false],
  ['old Chromium profile', r => r.restart.freshProfile = false], ['draft cache replay', r => r.restart.draftCacheUsed = true],
  ['restart never opened body', r => r.restart.openedSavedBody = false], ['missing result screenshot', r => r.screenshots.pop()],
  ['screenshot traversal', r => r.screenshots[0].filename = '../local-import-preview.png'], ['invalid screenshot digest', r => r.screenshots[0].sha256 = 'bad'],
  ['missing source workbook', r => r.inputFiles.splice(2, 1)], ['fixture traversal', r => r.inputFiles[0].filename = '../outside.md'],
  ['fixture Windows path', r => r.inputFiles[0].filename = 'C:\\private.md'], ['empty source file', r => r.inputFiles[0].bytes = 0],
]
for (const [name, mutate] of refusals) test('rejects ' + name, () => {
  const report = fixture(); mutate(report)
  assert.throws(() => validateLocalImportDesktopReport(report, commit))
})

test('driver retains every independent checkpoint including the true process restart phase', () => {
  const source = readFileSync(new URL('./check-local-import-desktop.mjs', import.meta.url), 'utf8')
  for (const check of LOCAL_IMPORT_CHECKS) assert.equal(source.split("'" + check + "'").length, 2, check)
  assert.doesNotMatch(source, /window\.electronAPI\s*=|Fetch\.fulfillRequest|Emulation\.setVirtualTimePolicy/)
})

test('owned XLSX bytes preserve the independently expected literal cells in both sheets', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'local-import-xlsx-cells-'))
  try {
    const inputs = createLocalImportDesktopFixtures(out)
    const workbook = XLSX.read(readFileSync(inputs.files.workbook), { type: 'buffer' })
    assert.deepEqual(workbook.SheetNames, LOCAL_IMPORT_WORKBOOK_HEADINGS)
    const cells = workbook.SheetNames.map(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false }))
    assert.deepEqual(cells, LOCAL_IMPORT_WORKBOOK_CELLS)
  } finally { rmSync(out, { recursive: true, force: true }) }
})

function serializedHeadings() {
  return { root: { children: LOCAL_IMPORT_WORKBOOK_HEADINGS.map(text => ({ type: 'heading', tag: 'h2',
    children: [{ type: 'text', format: 0, text }] })) } }
}
test('worksheet heading reader preserves dollars and underscores as exact unformatted h2 text', () => {
  assert.deepEqual(extractImportedWorkbookHeadings(JSON.stringify(serializedHeadings())), LOCAL_IMPORT_WORKBOOK_HEADINGS)
})
for (const [name, mutate] of [
  ['another heading level', heading => heading.tag = 'h1'],
  ['a formula', heading => heading.children = [{ type: 'formula', expression: '100' }]],
  ['a link', heading => heading.children = [{ type: 'link', children: [{ type: 'text', format: 0, text: '成本$100$' }] }]],
  ['Markdown formatting', heading => heading.children[0].format = 1],
]) test('worksheet heading reader rejects ' + name, () => {
  const content = serializedHeadings(); mutate(content.root.children[0])
  assert.throws(() => extractImportedWorkbookHeadings(JSON.stringify(content)))
})

function serializedCells() {
  return { root: { children: LOCAL_IMPORT_WORKBOOK_CELLS.map(rows => ({ type: 'table', children: rows.map(values =>
    ({ type: 'tablerow', children: values.map(value => ({ type: 'tablecell', children: [{ type: 'paragraph',
      children: value.split('\n').flatMap((text, index) => [...(index ? [{ type: 'linebreak' }] : []), { type: 'text', format: 0, text }]),
    }] })) })) })) } }
}
test('literal workbook reader preserves exact text and real cell line breaks', () => {
  assert.deepEqual(extractImportedWorkbookCells(JSON.stringify(serializedCells())), LOCAL_IMPORT_WORKBOOK_CELLS)
})
for (const [name, node] of [['formula', { type: 'formula', expression: '100' }],
  ['link', { type: 'link', url: 'file://example', children: [{ type: 'text', format: 0, text: 'C:\\temp\\file.txt' }] }],
  ['formatting', { type: 'text', format: 1, text: '$100$' }]]) {
  test('literal workbook reader rejects acquired ' + name + ' semantics', () => {
    const content = serializedCells()
    content.root.children[0].children[4].children[1].children[0].children = [node]
    assert.throws(() => extractImportedWorkbookCells(JSON.stringify(content)))
  })
}

function png() {
  const chunk = (kind, data) => {
    const bytes = Buffer.concat([Buffer.from(kind), data]); let crc = 0xffffffff
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    const head = Buffer.alloc(4), tail = Buffer.alloc(4)
    head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([head, bytes, tail])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1008, 0); header.writeUInt32BE(655, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((1008 * 4 + 1) * 655))), chunk('IEND', Buffer.alloc(0))])
}
test('raw file verification rejects byte changes without accepting a metadata-only record', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'local-import-evidence-contract-'))
  try {
    const report = fixture(), inputs = createLocalImportDesktopFixtures(out), bytes = png()
    report.inputFiles = inputs.manifest
    for (const item of report.screenshots) {
      writeFileSync(path.join(out, item.filename), bytes)
      item.bytes = bytes.length; item.sha256 = createHash('sha256').update(bytes).digest('hex')
    }
    writeFileSync(path.join(out, 'local-import.json'), JSON.stringify(report))
    assert.equal(verifyLocalImportDesktopReport(out, commit).complete, true)
    writeFileSync(path.join(out, report.inputFiles[2].filename), 'changed-workbook')
    assert.throws(() => verifyLocalImportDesktopReport(out, commit))
    writeFileSync(path.join(out, report.inputFiles[2].filename), readFileSync(inputs.files.markdown))
    assert.throws(() => verifyLocalImportDesktopReport(out, commit))
  } finally { rmSync(out, { recursive: true, force: true }) }
})
