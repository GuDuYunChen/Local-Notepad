// Reproduce the two reported defects against the immutable accepted product.
// A successful wrapper result is negative evidence, never product acceptance.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const BASELINE_PRODUCT_COMMIT = 'e9da2419e073af155d9a8458c8508ce8d03b600b'
export const BASELINE_PRODUCT_TREE = 'bc510d581c3b54f38702912701abcb305408d71d'
export const BASELINE_PRODUCT_VERSION = '4.249.0'
export const NATIVE_BUDGET_MS = 90000
export const VERIFIER_RUNTIME_FILES = Object.freeze([
  'scripts/build-ui-control-render-fixture.mjs',
  'scripts/ui-control-render-fixture.jsx',
  'scripts/check-ui-control-render.cjs',
])
export const EXPECTED_FEEDBACK_CATEGORIES = Object.freeze(['focus-outline-outside', 'hover-geometry'])
const OUTPUT_RELATIVE = 'test-results/ui-feedback-baseline'
const NATIVE_RELATIVE = 'test-results/ui-controls-render'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const shaPattern = /^[a-f0-9]{40}$/
const digestPattern = /^[a-f0-9]{64}$/
const root = fileURLToPath(new URL('../', import.meta.url))

function details(error) {
  const result = { name: String(error?.name || 'Error'), message: String(error?.message || error) }
  for (const key of ['code', 'actual', 'expected', 'operator', 'stack']) {
    if (error && key in Object(error)) result[key] = error[key]
  }
  return result
}

export function parseGitStatus(output) {
  assert.equal(typeof output, 'string')
  if (!output) return []
  assert.ok(output.endsWith('\0'), 'Git status must be a complete NUL-delimited receipt')
  const parts = output.slice(0, -1).split('\0'), changes = []
  for (let index = 0; index < parts.length; index++) {
    const record = parts[index]
    assert.ok(record.length > 3 && record[2] === ' ', 'Malformed Git status record')
    const status = record.slice(0, 2), filename = record.slice(3)
    const change = { status, path: filename }
    if (/[RC]/.test(status)) {
      assert.ok(parts[index + 1], 'Renamed Git path is incomplete')
      change.originalPath = parts[++index]
    }
    changes.push(change)
  }
  return changes
}

export function assertAllowedVerifierChanges(changes) {
  assert.ok(Array.isArray(changes))
  for (const change of changes) {
    assert.equal(change.status, ' M', 'Baseline may only contain unstaged verifier replacements')
    assert.equal(change.originalPath, undefined, 'Baseline verifier files must not be renamed')
    assert.ok(VERIFIER_RUNTIME_FILES.includes(change.path), 'Baseline product source changed: ' + change.path)
  }
}

export function assertSourceIdentity(identity) {
  assert.equal(identity.platform, 'win32', 'Baseline evidence requires the actual Windows native run')
  assert.equal(identity.baselineCommit, BASELINE_PRODUCT_COMMIT, 'Wrong accepted baseline commit')
  assert.equal(identity.baselineTree, BASELINE_PRODUCT_TREE, 'Wrong accepted baseline product tree')
  assert.equal(identity.baselineVersion, BASELINE_PRODUCT_VERSION, 'Baseline version must remain unchanged')
  assert.match(identity.verifierCommit || '', shaPattern, 'Current GITHUB_SHA is required')
  assert.equal(identity.candidateCommit, identity.verifierCommit, 'Verifier checkout must equal GITHUB_SHA')
  assert.equal(identity.baselineShallow, false, 'Baseline must retain a normal complete Git checkout')
  assert.equal(identity.candidateShallow, false, 'Verifier must retain a normal complete Git checkout')
  assert.match(identity.runId || '', /^\d+$/, 'GitHub run identity is required')
  assert.match(identity.attempt || '', /^[1-9]\d*$/, 'GitHub run attempt is required')
}

export function safeEvidenceFile(directory, name) {
  assert.equal(typeof name, 'string')
  assert.ok(name && !name.includes('\\') && !name.includes('\0') && !path.posix.isAbsolute(name) && !path.win32.isAbsolute(name) &&
    !name.split('/').some(part => !part || part === '.' || part === '..'), 'Unsafe evidence filename')
  const base = fs.realpathSync(directory), filename = path.join(base, ...name.split('/'))
  assert.equal(fs.lstatSync(filename).isSymbolicLink(), false, 'Evidence cannot be a symlink')
  const real = fs.realpathSync(filename), relative = path.relative(base, real)
  assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
    'Evidence escaped its source directory')
  assert.equal(fs.statSync(real).isFile(), true, 'Evidence must be a regular file')
  return real
}

export function verifyPngReceipt(directory, receipt) {
  assert.ok(receipt && typeof receipt === 'object')
  assert.ok(receipt.name?.endsWith('.png'), 'Native evidence must name a PNG')
  assert.ok(Number.isSafeInteger(receipt.bytes) && receipt.bytes > 100, 'Empty or incomplete native PNG receipt')
  assert.match(receipt.sha256 || '', digestPattern)
  for (const key of ['width', 'height']) assert.ok(Number.isSafeInteger(receipt[key]) && receipt[key] > 0)
  const filename = safeEvidenceFile(directory, receipt.name)
  const bytes = fs.readFileSync(filename)
  assert.equal(bytes.length, receipt.bytes, 'Native PNG byte length changed')
  assert.equal(sha256(bytes), receipt.sha256, 'Native PNG hash changed')
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid PNG signature')
  assert.equal(bytes.readUInt32BE(8), 13, 'Invalid PNG IHDR length')
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', 'Missing PNG dimensions')
  assert.equal(bytes.readUInt32BE(16), receipt.width, 'PNG width disagrees with receipt')
  assert.equal(bytes.readUInt32BE(20), receipt.height, 'PNG height disagrees with receipt')
  assert.ok(bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])), 'Incomplete PNG end marker')
  return { name: receipt.name, bytes: bytes.length, sha256: receipt.sha256, width: receipt.width, height: receipt.height }
}

// AntD's accepted input error/warning focus rule sets outline: 0 with greater
// specificity than the old project cue. The old affix :has(input:focus-visible)
// also omits TextArea's real allowClear wrapper. These narrow source-confirmed
// gaps require complete actual measurements and never substitute for either
// user-reported defect. Select has no corresponding status exception.
export function assertKnownFocusDecorationRejection(report, failure) {
  const match = /^pointer-(error|warning)-(input|password|textarea|textarea-clear)$/.exec(failure.probeId)
  const textareaClear = failure.probeId === 'pointer-normal-textarea-clear'
  assert.ok(match || textareaClear, 'Unapproved focus-decoration probe: ' + failure.probeId)
  assert.equal(failure.stage, 'focus')
  const scenes = report.scenes.filter(scene => scene.name === failure.scene)
  assert.equal(scenes.length, 1)
  const records = scenes[0].feedback.pointer.filter(record => record.id === failure.probeId)
  assert.equal(records.length, 1, 'Missing or ambiguous status-focus measurements')
  const record = records[0], state = match?.[1] || 'normal'
  assert.equal(record.executionComplete, true)
  assert.equal(record.trustedPointer, true)
  assert.ok(typeof record.domId === 'string' && record.domId)
  const keys = ['left', 'top', 'right', 'bottom', 'width', 'height']
  for (const sample of [record.before, record.after, record.keyboard]) {
    assert.equal(sample?.id, record.domId)
    assert.equal(sample.status, state)
    assert.equal(sample.disabled, false); assert.equal(sample.readOnly, false)
    assert.ok(keys.every(key => Number.isFinite(sample.rect?.[key])), 'Missing real status-focus rectangle')
    assert.ok(sample.rect.width > 0 && sample.rect.height > 0)
    assert.deepEqual(sample.value, record.before.value, 'Status focus changed the field value')
    for (const key of keys) assert.ok(Math.abs(sample.rect[key] - record.before.rect[key]) <= 0.01,
      'Status focus changed control geometry')
    const nodes = sample.diagnostics?.nodes
    assert.ok(Array.isArray(nodes) && nodes.length > 0, 'Missing per-node status-focus measurements')
    assert.equal(sample.diagnostics.documentHasFocus, true)
    assert.equal(sample.diagnostics.visibilityState, 'visible')
    for (const node of nodes) {
      assert.ok(typeof node.owner === 'string' && node.owner)
      assert.ok(keys.every(key => Number.isFinite(node.rect?.[key])), 'Missing real status-node rectangle')
      for (const property of ['outline-style', 'outline-width', 'outline-offset', 'box-shadow', 'border-top-width', 'border-top-color']) {
        assert.equal(typeof node.computed?.[property], 'string', 'Missing computed status-node style: ' + property)
      }
    }
    const roots = nodes.filter(node => node.owner === 'root')
    assert.equal(roots.length, 1)
    if (!textareaClear) {
      assert.match(roots[0].class || '', new RegExp('(?:^|\\s)ant-input-status-' + state + '(?:\\s|$)'))
    } else {
      assert.equal(roots[0].tag, 'span')
      const classes = (roots[0].class || '').split(/\s+/)
      for (const expected of ['app-ui-input', 'ant-input-affix-wrapper', 'ant-input-textarea-affix-wrapper', 'ant-input-textarea-allow-clear']) {
        assert.ok(classes.includes(expected), 'Missing actual allowClear TextArea wrapper: ' + expected)
      }
      assert.ok(!classes.some(name => /^ant-(input|select)-status-/.test(name)), 'Normal TextArea cannot have a status class')
      const textarea = nodes.filter(node => node.tag === 'textarea' && node.id === record.domId)
      const clear = nodes.filter(node => node.tag === 'button' && (node.class || '').split(/\s+/).includes('ant-input-clear-icon'))
      assert.equal(textarea.length, 1, 'The actual textarea descendant is required')
      assert.equal(clear.length, 1, 'The actual allowClear button is required')
      for (const node of [textarea[0], clear[0]]) {
        assert.ok(node.rect.width > 0 && node.rect.height > 0, 'TextArea and clear button must be rendered')
        assert.deepEqual(node.excluded, [])
        assert.equal(node.computed.visibility, 'visible')
        assert.ok(Number.parseFloat(node.computed.opacity) > 0)
        assert.notEqual(node.computed.display, 'none')
        const initial = record.before.diagnostics.nodes.find(previous => previous.owner === node.owner)
        assert.ok(initial && initial.tag === node.tag && initial.id === node.id, 'TextArea descendant identity changed')
        for (const key of keys) assert.ok(Math.abs(node.rect[key] - initial.rect[key]) <= 0.01,
          'TextArea descendant geometry changed')
      }
      if (sample !== record.before) {
        assert.equal(textarea[0].focused, true)
        assert.equal(Number.parseFloat(textarea[0].computed['outline-width']), 0)
        assert.equal(textarea[0].computed['outline-style'], 'none')
      }
    }
    if (sample === record.before) continue
    assert.equal(sample.focused, true); assert.equal(sample.hit, true); assert.equal(sample.inViewport, true)
    assert.deepEqual(sample.outlines, [], 'Status exception only covers a missing outline')
    assert.deepEqual(sample.shadows, [], 'Status exception does not allow extra painted shadows')
    assert.equal(Number.parseFloat(roots[0].computed['outline-width']), 0)
    assert.equal(roots[0].computed['outline-style'], 'none')
    assert.ok(Number.parseFloat(roots[0].computed['border-top-width']) > 0)
    assert.equal(roots[0].focusWithin, true)
    assert.deepEqual(roots[0].excluded, [])
  }
  assert.equal(record.keyboard.focusVisible, true)
  assert.equal(failure.error.message, failure.probeId + ': pointer must retain one visible root focus cue')
  assert.deepEqual(failure.error.actual, [])
  assert.equal(failure.error.expected, 'one visible root outline')
  assert.equal(failure.error.operator, 'native-feedback')
  return { scene: failure.scene, probeId: failure.probeId,
    reason: textareaClear ? 'accepted-affix-selector-omits-textarea' : 'accepted-antd-status-outline-zero' }
}

// The accepted FileList unmounts its rename/delete dialog without restoring
// tree focus. Retain that original BODY-focus sample, and separately prove the
// real click used to continue the remaining keyboard observations.
export function assertKnownTreeFocusRejection(report, failure) {
  const ids = ['tree-rename-cancel', 'tree-delete-cancel']
  assert.ok(ids.includes(failure.probeId), 'Unapproved tree-focus-return probe: ' + failure.probeId)
  assert.equal(failure.stage, 'tree')
  const scenes = report.scenes.filter(scene => scene.name === failure.scene)
  assert.equal(scenes.length, 1)
  const feedback = scenes[0].feedback, flow = feedback.treeFlow
  assert.equal(flow?.executionComplete, true, 'Both dialog paths and traversal must finish')
  const expectedIds = ['hover-folder', 'hover-nested', 'hover-nested-next', 'hover-long', 'hover-selected', 'hover-short', 'hover-last'].sort()
  const dataKeys = ['selectedId', 'selectedIds', 'visibleIds', 'loadedIds']
  const sameData = (sample, before) => {
    for (const key of dataKeys) assert.deepEqual(sample?.[key], before[key], 'Cancellation or recovery changed ' + key)
  }
  const focusedTree = (sample, descendant = 'file-tree-item-hover-selected') => {
    assert.equal(sample?.treeFocused, true)
    assert.deepEqual(sample.activeElement, { tag: 'DIV', id: null })
    assert.equal(sample.activeDescendant, descendant)
  }
  for (const [kind, title] of [['rename', '重命名笔记'], ['delete', '移到回收站？']]) {
    const record = flow[kind]
    for (const key of ['executionComplete', 'trustedOpen', 'trustedCancel', 'closed']) assert.equal(record?.[key], true,
      'Actual completed native ' + kind + ' cancellation is required: ' + key)
    assert.equal(record.dialog?.role, 'dialog'); assert.equal(record.dialog.title, title)
    focusedTree(record.before)
    assert.equal(record.before.selectedId, 'hover-selected')
    assert.deepEqual(record.before.selectedIds, ['hover-selected'])
    for (const key of ['visibleIds', 'loadedIds']) assert.deepEqual([...record.before[key]].sort(), expectedIds,
      'The seven isolated fixture records must be unchanged')
    sameData(record.after, record.before)
    assert.equal(record.after.activeDescendant, record.before.activeDescendant)
  }
  assert.equal(flow.delete.dialog.message, '“已选中的笔记.md”会移到回收站，30 天内可以恢复。')
  assert.deepEqual(flow.delete.dialog.buttons, ['取消', '移到回收站'])
  assert.equal(flow.delete.dialog.focusedButton, '移到回收站')
  assert.equal(feedback.nameDialog?.cancelled, true)
  assert.equal(feedback.nameDialog.valueBefore, '已选中的笔记')
  assert.equal(feedback.nameDialog.valueAfter, feedback.nameDialog.valueBefore)
  assert.equal(feedback.nameDialog.suffixBefore, '.md'); assert.equal(feedback.nameDialog.suffixAfter, '.md')
  assert.ok(Array.isArray(feedback.libraryRequests) && feedback.libraryRequests.length > 0)
  for (const request of feedback.libraryRequests) {
    assert.equal(request.accepted, true); assert.equal(request.method, 'GET'); assert.equal(request.path, '/api/files')
  }
  const record = flow[failure.probeId === ids[0] ? 'rename' : 'delete']
  assert.equal(record.after.treeFocused, false, 'A later successful focus sample cannot replace the original failure')
  assert.deepEqual(record.after.activeElement, { tag: 'BODY', id: null }, 'Only the source-confirmed unmounted-dialog focus loss is allowed')
  const recovery = flow.renameRecovery
  assert.equal(recovery?.needed, !flow.rename.after.treeFocused)
  assert.equal(recovery.usedNativeClick, recovery.needed, 'Recovery must be a separate actual native click when required')
  if (recovery.needed) {
    assert.deepEqual(flow.rename.after.activeElement, { tag: 'BODY', id: null })
    assert.equal(recovery.trustedPointer, true)
  }
  focusedTree(recovery.after); sameData(recovery.after, flow.rename.before)
  const navigation = flow.navigation
  assert.equal(navigation?.executionComplete, true)
  assert.equal(navigation.downTrusted, true); assert.equal(navigation.upTrusted, true)
  assert.deepEqual(navigation.before, recovery.after, 'Arrow traversal must start after the recorded recovery')
  for (const [stage, descendant] of [['before', 'file-tree-item-hover-selected'], ['down', 'file-tree-item-hover-short'], ['up', 'file-tree-item-hover-selected']]) {
    focusedTree(navigation[stage], descendant); sameData(navigation[stage], flow.rename.before)
  }
  assert.deepEqual(flow.delete.before, navigation.up, 'Delete must target the original note after real Arrow traversal')
  assert.equal(failure.error.message, failure.probeId + ': cancellation did not return focus to its tree item')
  assert.deepEqual(failure.error.actual, record.after); assert.deepEqual(failure.error.expected, record.before)
  assert.equal(failure.error.operator, 'native-feedback')
  return { scene: failure.scene, probeId: failure.probeId, reason: 'accepted-dialog-cancel-omits-tree-focus-return',
    originalFailurePreserved: true, separateRenameRecovery: recovery.needed }
}

// Native geometry is re-evaluated by the unmodified current verifier. These
// envelope checks alone never establish a successful negative reproduction.
export function assessNativeRejection({ report, nativeProcess, identity, manifestSha256 }, validators) {
  assertSourceIdentity(identity)
  assert.equal(nativeProcess.code, 1, 'The original native checker must reject the baseline')
  assert.equal(nativeProcess.signal, null, 'A killed native process is not a reproduced UI defect')
  assert.equal(nativeProcess.error, null, 'A launch failure or timeout is not a reproduced UI defect')
  assert.ok(Number.isFinite(nativeProcess.elapsedMs) && nativeProcess.elapsedMs > 0 &&
    nativeProcess.elapsedMs <= NATIVE_BUDGET_MS, 'Native process exceeded its original budget')
  assert.equal(report.schema, 1)
  assert.equal(report.scope, 'shared-controls-only')
  assert.equal(report.platform, 'win32')
  assert.equal(report.status, 'failed')
  assert.equal(report.complete, false)
  assert.equal(report.cleanQuit, false, 'Expected failure must retain its actual unsuccessful lifecycle')
  assert.equal(report.backendExercised, false)
  assert.equal(report.syntheticRecords, true)
  assert.equal(report.isolatedProfile, true)
  assert.equal(report.budgetMs, NATIVE_BUDGET_MS, 'Original native checker budget changed')
  assert.ok(Number.isFinite(report.elapsedMs) && report.elapsedMs > 0 && report.elapsedMs <= NATIVE_BUDGET_MS)
  assert.equal(report.commit, BASELINE_PRODUCT_COMMIT)
  assert.equal(report.version, BASELINE_PRODUCT_VERSION)
  assert.equal(report.identity?.commit, BASELINE_PRODUCT_COMMIT)
  assert.equal(report.identity?.tree, BASELINE_PRODUCT_TREE)
  assert.equal(report.identity?.version, BASELINE_PRODUCT_VERSION)
  assert.equal(report.runId, identity.runId)
  assert.equal(report.attempt, identity.attempt)
  assert.match(manifestSha256 || '', digestPattern)
  assert.equal(report.manifestSha256, manifestSha256)
  assert.equal(report.errorDetails?.code, 'UI_FEEDBACK_REGRESSIONS', 'Failure was not the intended feedback rejection')
  assert.equal(typeof validators?.verifyScenes, 'function')
  assert.equal(typeof validators?.verifyFeedbackScenes, 'function')
  // An unexpected old assertion must propagate; it cannot be classified as a
  // successful reproduction of these two new reports.
  validators.verifyScenes(report.scenes)
  assert.equal(report.scenes.length, 6)
  for (const scene of report.scenes) {
    assert.equal(scene.complete, true)
    assert.equal(scene.feedback?.scope, 'production-components-with-readonly-synthetic-files')
    assert.equal(scene.feedback?.backendExercised, false)
    assert.equal(scene.feedback?.executionComplete, true, 'Incomplete observation cannot establish a defect')
    for (const kind of ['pointer', 'hover', 'images']) {
      assert.ok(Array.isArray(scene.feedback[kind]) && scene.feedback[kind].length > 0, 'Missing feedback ' + kind)
    }
  }
  let rejection
  try { validators.verifyFeedbackScenes(report.scenes) } catch (error) { rejection = error }
  assert.equal(rejection?.code, 'UI_FEEDBACK_REGRESSIONS', 'Raw samples did not independently reproduce the expected defects')
  assert.ok(Array.isArray(rejection.failures) && rejection.failures.length >= 2)
  assert.deepEqual(report.feedbackFailures, rejection.failures, 'Recorded failures disagree with raw-sample recomputation')
  const categories = new Set(), knownFocusDecorationFailures = [], knownTreeFocusFailures = []
  for (const failure of rejection.failures) {
    assert.ok(typeof failure.scene === 'string' && report.scenes.some(scene => scene.name === failure.scene))
    assert.ok(typeof failure.probeId === 'string' && failure.probeId.length > 0)
    assert.ok(typeof failure.stage === 'string' && failure.stage.length > 0)
    assert.equal(failure.error?.name, 'AssertionError', 'Environment errors are not UI regression evidence')
    assert.ok(typeof failure.error.message === 'string' && failure.error.message.length > 0)
    if (failure.category === 'focus-decoration') {
      knownFocusDecorationFailures.push(assertKnownFocusDecorationRejection(report, failure))
    } else if (failure.category === 'tree-focus-return') {
      knownTreeFocusFailures.push(assertKnownTreeFocusRejection(report, failure))
    } else {
      assert.ok(EXPECTED_FEEDBACK_CATEGORIES.includes(failure.category), 'Unexpected feedback failure: ' + failure.category)
      categories.add(failure.category)
    }
  }
  assert.deepEqual([...categories].sort(), [...EXPECTED_FEEDBACK_CATEGORIES].sort(), 'Both reported defect classes must be reproduced')
  return { expectedCategories: [...categories].sort(), failureCount: rejection.failures.length, knownFocusDecorationFailures, knownTreeFocusFailures,
    originalScenesRevalidated: 6, productAcceptance: false, baselineProductPassed: false }
}

const git = (directory, ...args) => execFileSync('git', args, {
  cwd: directory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true,
})
const status = directory => parseGitStatus(git(directory, 'status', '--porcelain=v1', '-z', '--untracked-files=all'))

function requireNormalCheckout(directory) {
  const metadata = path.join(directory, '.git')
  assert.ok(fs.lstatSync(metadata).isDirectory() && !fs.lstatSync(metadata).isSymbolicLink(), 'A normal independent .git directory is required')
  assert.equal(fs.realpathSync(git(directory, 'rev-parse', '--show-toplevel').trim()), fs.realpathSync(directory))
}

function loggedProcess(executable, args, cwd, directory, label) {
  const stdout = path.join(directory, label + '.stdout.log'), stderr = path.join(directory, label + '.stderr.log')
  const out = fs.openSync(stdout, 'wx'), err = fs.openSync(stderr, 'wx'), started = Date.now()
  let result
  try {
    result = spawnSync(executable, args, { cwd, env: process.env,
      stdio: ['ignore', out, err], timeout: NATIVE_BUDGET_MS, windowsHide: false })
  } finally { fs.closeSync(out); fs.closeSync(err) }
  const logReceipt = filename => ({ name: path.basename(filename), bytes: fs.statSync(filename).size,
    sha256: sha256(fs.readFileSync(filename)) })
  return { code: result.status, signal: result.signal || null, error: result.error ? details(result.error) : null,
    elapsedMs: Date.now() - started, stdout: logReceipt(stdout), stderr: logReceipt(stderr) }
}

function verifyManifestFiles(directory, files) {
  assert.ok(files && typeof files === 'object' && Object.keys(files).length > 0)
  for (const [name, digest] of Object.entries(files)) {
    assert.match(digest, digestPattern)
    assert.equal(sha256(fs.readFileSync(safeEvidenceFile(directory, name))), digest, 'Manifest source or artifact changed: ' + name)
  }
}

export async function runBaseline(args = process.argv.slice(2)) {
  assert.equal(args.length, 2, 'Usage: node scripts/ui-feedback-baseline.mjs --baseline-dir baseline')
  assert.equal(args[0], '--baseline-dir')
  assert.ok(args[1])
  const candidate = fs.realpathSync(root), baseline = fs.realpathSync(path.resolve(candidate, args[1]))
  const relativeBaseline = path.relative(candidate, baseline).split(path.sep).join('/')
  assert.ok(relativeBaseline && relativeBaseline !== '..' && !relativeBaseline.startsWith('../') &&
    !path.isAbsolute(relativeBaseline), 'Baseline must be a distinct checkout inside the candidate workspace')
  const output = path.join(candidate, OUTPUT_RELATIVE)
  assert.equal(fs.existsSync(output), false, 'Refusing to overwrite previous baseline evidence')
  fs.mkdirSync(output, { recursive: true })
  const summaryFile = path.join(output, 'baseline-summary.json')
  const summary = { schema: 1, scope: 'expected-negative-ui-feedback-evidence', status: 'starting',
    negativeEvidenceComplete: false, productAcceptance: false, baselineProductPassed: false,
    baselineProductCommit: BASELINE_PRODUCT_COMMIT, baselineProductTree: BASELINE_PRODUCT_TREE,
    verifierCommit: process.env.GITHUB_SHA || null, budgetMs: NATIVE_BUDGET_MS,
    nativeArtifactDirectory: relativeBaseline + '/' + NATIVE_RELATIVE }
  const persist = () => fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n')
  persist()
  try {
    requireNormalCheckout(candidate); requireNormalCheckout(baseline)
    assert.ok(!process.env.ELECTRON_RUN_AS_NODE, 'Electron must run the actual browser process')
    const identity = summary.identity = {
      platform: process.platform, candidateCommit: git(candidate, 'rev-parse', 'HEAD').trim(),
      verifierCommit: process.env.GITHUB_SHA, baselineCommit: git(baseline, 'rev-parse', 'HEAD').trim(),
      baselineTree: git(baseline, 'rev-parse', 'HEAD^{tree}').trim(),
      baselineVersion: JSON.parse(fs.readFileSync(path.join(baseline, 'package.json'), 'utf8')).version,
      baselineShallow: git(baseline, 'rev-parse', '--is-shallow-repository').trim() === 'true',
      candidateShallow: git(candidate, 'rev-parse', '--is-shallow-repository').trim() === 'true',
      runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    }
    assertSourceIdentity(identity)
    const inside = (filename, directory) => filename === directory || filename.startsWith(directory + '/')
    for (const change of status(candidate)) {
      assert.ok(change.status === '??' && !change.originalPath &&
        (inside(change.path, relativeBaseline) || inside(change.path, OUTPUT_RELATIVE)),
      'Verifier checkout has unrelated source changes: ' + change.path)
    }
    summary.baselineStatusBefore = status(baseline)
    assert.deepEqual(summary.baselineStatusBefore, [], 'Baseline must start clean after its own locked npm ci')
    const lock = JSON.parse(fs.readFileSync(path.join(baseline, 'package-lock.json'), 'utf8'))
    summary.lockSha256 = sha256(fs.readFileSync(path.join(baseline, 'package-lock.json')))
    summary.dependencies = {}
    for (const name of ['react', 'react-dom', 'antd', 'electron', 'esbuild']) {
      const installed = JSON.parse(fs.readFileSync(path.join(baseline, 'node_modules', name, 'package.json'), 'utf8')).version
      assert.equal(installed, lock.packages['node_modules/' + name]?.version, 'Baseline dependency differs from its own lock: ' + name)
      summary.dependencies[name] = installed
    }
    summary.overlay = []
    for (const name of VERIFIER_RUNTIME_FILES) {
      const source = safeEvidenceFile(candidate, name), target = safeEvidenceFile(baseline, name)
      const before = sha256(fs.readFileSync(target)), bytes = fs.readFileSync(source)
      fs.copyFileSync(source, target)
      assert.equal(sha256(fs.readFileSync(target)), sha256(bytes), 'Verifier copy did not preserve its exact bytes')
      summary.overlay.push({ path: name, previousBaselineSha256: before, verifierSha256: sha256(bytes), bytes: bytes.length })
      persist()
    }
    summary.baselineStatusAfterOverlay = status(baseline)
    assertAllowedVerifierChanges(summary.baselineStatusAfterOverlay)
    summary.status = 'building-baseline-fixture'; persist()
    summary.build = loggedProcess(process.execPath, ['scripts/build-ui-control-render-fixture.mjs'], baseline, output, 'build')
    persist()
    assert.equal(summary.build.error, null, 'Baseline fixture build failed to start or timed out')
    assert.equal(summary.build.signal, null)
    assert.equal(summary.build.code, 0, 'Baseline fixture did not build with the original product sources')
    const nativeDirectory = path.join(baseline, NATIVE_RELATIVE), fixture = path.join(nativeDirectory, 'fixture')
    const manifestBytes = fs.readFileSync(path.join(fixture, 'manifest.json'))
    const manifest = JSON.parse(manifestBytes), manifestSha256 = sha256(manifestBytes)
    assert.equal(manifest.commit, BASELINE_PRODUCT_COMMIT); assert.equal(manifest.tree, BASELINE_PRODUCT_TREE)
    assert.equal(manifest.version, BASELINE_PRODUCT_VERSION)
    verifyManifestFiles(baseline, manifest.sources); verifyManifestFiles(fixture, manifest.artifacts)
    for (const overlay of summary.overlay) assert.equal(manifest.sources[overlay.path], overlay.verifierSha256)
    summary.manifestSha256 = manifestSha256
    summary.status = 'running-original-native-checker'; persist()
    summary.nativeProcess = loggedProcess(process.execPath,
      ['node_modules/electron/cli.js', 'scripts/check-ui-control-render.cjs'], baseline, output, 'native')
    summary.nativeProcessExited = summary.nativeProcess.code !== null && summary.nativeProcess.signal === null && summary.nativeProcess.error === null
    summary.normalProductLifecycleClaimed = false
    persist()
    summary.baselineStatusAfterNative = status(baseline)
    assertAllowedVerifierChanges(summary.baselineStatusAfterNative)
    assert.equal(git(baseline, 'rev-parse', 'HEAD').trim(), BASELINE_PRODUCT_COMMIT)
    assert.equal(git(baseline, 'rev-parse', 'HEAD^{tree}').trim(), BASELINE_PRODUCT_TREE)
    verifyManifestFiles(baseline, manifest.sources); verifyManifestFiles(fixture, manifest.artifacts)
    const nativeReportFile = path.join(nativeDirectory, 'checks.json')
    assert.ok(fs.statSync(nativeReportFile).size <= 64 * 1024 * 1024, 'Native report exceeds the bounded evidence size')
    const nativeBytes = fs.readFileSync(nativeReportFile), nativeReport = JSON.parse(nativeBytes)
    summary.nativeReport = { name: summary.nativeArtifactDirectory + '/checks.json', bytes: nativeBytes.length,
      sha256: sha256(nativeBytes), status: nativeReport.status, complete: nativeReport.complete, cleanQuit: nativeReport.cleanQuit }
    assert.deepEqual(nativeReport.identity, manifest, 'Native report is not bound to the built baseline fixture')
    const require = createRequire(import.meta.url)
    const validators = require(path.join(baseline, 'scripts/check-ui-control-render.cjs'))
    summary.reproduction = assessNativeRejection({ report: nativeReport, nativeProcess: summary.nativeProcess,
      identity, manifestSha256 }, validators)
    const names = new Set(); summary.images = []
    for (const scene of nativeReport.scenes) {
      for (const image of [...scene.images, ...scene.feedback.images]) {
        assert.ok(!names.has(image.name), 'Duplicate native image receipt: ' + image.name)
        names.add(image.name)
        summary.images.push(verifyPngReceipt(nativeDirectory, image))
      }
    }
    summary.status = 'expected-regressions-reproduced'; summary.negativeEvidenceComplete = true
    summary.productSourceUnchanged = true; persist()
    console.log(JSON.stringify({ status: summary.status, productAcceptance: false,
      baselineProductCommit: BASELINE_PRODUCT_COMMIT, verifierCommit: identity.verifierCommit,
      failureCount: summary.reproduction.failureCount, images: summary.images.length,
      evidence: OUTPUT_RELATIVE + '/baseline-summary.json' }))
    return summary
  } catch (error) {
    summary.status = 'rejected'; summary.negativeEvidenceComplete = false; summary.error = details(error)
    persist(); throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBaseline().catch(error => { console.error('Baseline evidence rejected: ' + String(error.message || error)); process.exitCode = 1 })
}
