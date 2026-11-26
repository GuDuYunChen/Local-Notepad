import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { blockPinFixture, source } from './block-references-test-fixture.mjs'
import { BLOCK_REFERENCE_SOURCES } from './block-references-evidence.mjs'
import { TABLE_OPERATIONS_SOURCES, TABLE_OPERATIONS_VERSION, TABLE_OPERATIONS_REPORT, tableOperationsBlob } from './table-operations-evidence.mjs'
import { replaceExactlyAndProveInverse } from './reading-mode-installed-evidence.mjs'
import { extendShortcutManagementInstallation } from './shortcut-management-installed-evidence.mjs'
import { extendLocalExportInstallation } from './local-export-installed-evidence.mjs'
import { BLOCK_REFERENCE_INSTALLATION_GATE, extendBlockReferenceInstallation } from './block-references-installed-evidence.mjs'
import { TABLE_OPERATIONS_INSTALLATION_GATE, validateTableOperationsInstallerPin, prepareTableOperationsVerifierSources,
  validateGeneratedTableOperationsSources, extendTableOperationsInstallation, assertTableOperationsSession,
  validateTableOperationsInstallationReceipt } from './table-operations-installed-evidence.mjs'

const read = name => source('scripts/' + name)
// Synthetic source/receipt contracts only. These fixtures cannot satisfy the
// real Table driver or PNG validator and never claim installed UI acceptance.
function tablePinFixture() {
  const pin = blockPinFixture()
  pin.tableOperationsSources = Object.fromEntries(TABLE_OPERATIONS_SOURCES.map(name => [name, tableOperationsBlob(source(name))]))
  return pin
}
function receiptFixture() {
  const pin = tablePinFixture(), verifier = 'd'.repeat(40)
  const application = { executable: 'C:\\synthetic\\记事本.exe', executableSHA256: 'a'.repeat(64), asarSHA256: 'b'.repeat(64), backendSHA256: 'c'.repeat(64) }
  const completed = { complete: true, cleanupComplete: true, forceTerminated: false, backendStopped: true }
  const blocks = { ...completed, ...application, pid: 300, exit: { pid: 300, code: 0, signal: null, normalClose: true }, completedAt: '2026-11-25T12:00:05.000Z' }
  const tables = { ...completed, ...application, pid: 300, exit: { pid: 300, code: 0, signal: null, normalClose: true },
    startedAt: '2026-11-25T12:00:06.000Z', finishedAt: '2026-11-25T12:01:06.000Z', scope: 'installed', version: TABLE_OPERATIONS_VERSION,
    productCommit: pin.product, verifierCommit: verifier, sourceFiles: structuredClone(pin.tableOperationsSources) }
  const installation = { ...completed, productCommit: pin.product, verifierCommit: verifier, installers: { current: pin.current, previous: pin.previous },
    appExits: [1, 2, 3, 4, 5, 6].map(pid => ({ pid, code: 0, signal: null, nativeClose: true })),
    dataComparisons: Array.from({ length: 6 }, () => ({ equal: true })), localExportRun: { application },
    tableOperationsRun: { report: TABLE_OPERATIONS_REPORT, sha256: 'e'.repeat(64), processID: tables.pid },
    checks: [BLOCK_REFERENCE_INSTALLATION_GATE, TABLE_OPERATIONS_INSTALLATION_GATE, 'final-uninstall-preserves-data'] }
  return { pin, verifier, blocks, tables, installation }
}

test('all current Table runtime and verifier sources, including both formatting toolbars, are independently pinned', () => {
  const pin = tablePinFixture()
  assert.equal(validateTableOperationsInstallerPin(pin), true)
  assert.ok(TABLE_OPERATIONS_SOURCES.includes('src/components/Editor/plugins/ToolbarPlugin.jsx'))
  assert.ok(TABLE_OPERATIONS_SOURCES.includes('src/components/Editor/plugins/FloatingTextToolbarPlugin.jsx'))
  for (const name of TABLE_OPERATIONS_SOURCES) {
    const missing = structuredClone(pin); delete missing.tableOperationsSources[name]
    assert.throws(() => validateTableOperationsInstallerPin(missing))
    assert.throws(() => prepareTableOperationsVerifierSources(pin, file => read(file) + (file === '../' + name ? '\n// changed' : '')), /Changed Table source/)
  }
})

test('Table preparation keeps all six inherited sources and proves the entire original inverse', () => {
  const pin = tablePinFixture(), generated = prepareTableOperationsVerifierSources(pin, read)
  assert.equal(generated.length, 6)
  for (const item of generated) {
    assert.equal(replaceExactlyAndProveInverse(item.pinned, [...item.changes].reverse().map(([before, after]) => [after, before])), item.original)
  }
  const supplied = name => generated.find(item => item.output === name)?.pinned ?? read(name)
  assert.equal(validateGeneratedTableOperationsSources(pin, supplied), true)
  for (const item of generated) assert.throws(() => validateGeneratedTableOperationsSources(pin, name => supplied(name) + (name === item.output ? '\n// altered' : '')))
  const runner = generated.find(item => item.output === 'run-reading-import-generated.mjs').pinned
  for (const term of ['validateLifecycleReport(report)', 'validateShortcutCompletion(report)', 'validateInstalledLocalImport(report',
    'verifyLocalExportInstalledReport(', 'verifyInstalledBlockReferences(', 'verifyInstalledTableOperations(',
    '...blocks.screenshots,...tables.screenshots]', 'tableOperationsChecks:tables.checks,blockReferenceChecks:blocks.checks,']) assert.ok(runner.includes(term), term)
})

test('Table receipt permits Windows PID reuse only after completed teardown on the identical installed image', () => {
  const { installation, tables, blocks, pin, verifier } = receiptFixture()
  assert.equal(tables.pid, blocks.pid, 'The synthetic counterexample deliberately reuses a completed PID')
  assert.equal(assertTableOperationsSession(installation, blocks, tables), true)
  assert.equal(validateTableOperationsInstallationReceipt(installation, tables, blocks, pin, verifier), true)
})

const refusals = [
  ['different product commit', f => { f.tables.productCommit = 'f'.repeat(40) }],
  ['different verifier commit', f => { f.tables.verifierCommit = 'f'.repeat(40) }],
  ['packaged run substituted for installed run', f => { f.tables.scope = 'packaged' }],
  ['old Table product version', f => { f.tables.version = '4.249.1' }],
  ['stale Table runtime source', f => { f.tables.sourceFiles[TABLE_OPERATIONS_SOURCES[0]] = 'f'.repeat(40) }],
  ['different current installer bytes', f => { f.installation.installers = structuredClone(f.installation.installers); f.installation.installers.current.bytes++ }],
  ['incomplete original installation', f => { f.installation.complete = false }],
  ['failed original cleanup', f => { f.installation.cleanupComplete = false }],
  ['original installation force termination', f => { f.installation.forceTerminated = true }],
  ['original error concealed by complete flag', f => { f.installation.error = 'original gate failed' }],
  ['missing original app exit', f => { f.installation.appExits.pop() }],
  ['unclean original app exit', f => { f.installation.appExits[0].nativeClose = false }],
  ['missing original retention comparison', f => { f.installation.dataComparisons.pop() }],
  ['changed original retained data', f => { f.installation.dataComparisons[0].equal = false }],
  ['missing prior block gate', f => { f.installation.checks.shift() }],
  ['missing Table gate', f => { f.installation.checks.splice(1, 1) }],
  ['duplicated Table gate', f => { f.installation.checks.push(TABLE_OPERATIONS_INSTALLATION_GATE) }],
  ['Table runs before original block gate', f => { f.installation.checks.reverse() }],
  ['Table runs after final uninstall', f => { f.installation.checks = [BLOCK_REFERENCE_INSTALLATION_GATE, 'final-uninstall-preserves-data', TABLE_OPERATIONS_INSTALLATION_GATE] }],
  ['wrong raw report name', f => { f.installation.tableOperationsRun.report = 'other.json' }],
  ['missing raw report digest', f => { delete f.installation.tableOperationsRun.sha256 }],
  ['unrelated Table process receipt', f => { f.installation.tableOperationsRun.processID++ }],
  ['incomplete Table run', f => { f.tables.complete = false }],
  ['incomplete prior block run', f => { f.blocks.cleanupComplete = false }],
  ['force-terminated Table run', f => { f.tables.forceTerminated = true }],
  ['Table backend not stopped', f => { f.tables.backendStopped = false }],
  ['nonzero Table process exit', f => { f.tables.exit.code = 1 }],
  ['unconfirmed native Table close', f => { f.tables.exit.normalClose = false }],
  ['Table overlaps prior native process', f => { f.tables.startedAt = '2026-11-25T12:00:04.000Z' }],
  ['Table finishes before it starts', f => { f.tables.finishedAt = '2026-11-25T12:00:05.000Z' }],
  ['malformed native Table timestamp', f => { f.tables.startedAt = 'invalid' }],
  ['different Table executable', f => { f.tables.executable = 'C:\\unrelated\\app.exe' }],
  ['different installed renderer bytes', f => { f.tables.asarSHA256 = 'f'.repeat(64) }],
  ['different earlier installed export image', f => { f.installation.localExportRun.application.backendSHA256 = 'f'.repeat(64) }],
]
for (const [label, change] of refusals) test('rejects ' + label, () => {
  const fixture = receiptFixture(); change(fixture)
  assert.throws(() => validateTableOperationsInstallationReceipt(fixture.installation, fixture.tables, fixture.blocks, fixture.pin, fixture.verifier))
})

for (const ending of ['LF', 'CRLF']) test('complete ' + ending + ' preparation retains all 29 old gates and adds Table as the 30th', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'table-installed-contract-'))
  try {
    const scripts = path.join(directory, 'scripts')
    cpSync(fileURLToPath(new URL('.', import.meta.url)), scripts, { recursive: true })
    cpSync(fileURLToPath(new URL('../src', import.meta.url)), path.join(directory, 'src'), { recursive: true })
    cpSync(fileURLToPath(new URL('../electron', import.meta.url)), path.join(directory, 'electron'), { recursive: true })
    for (const name of new Set([...TABLE_OPERATIONS_SOURCES, ...BLOCK_REFERENCE_SOURCES].filter(name => !name.startsWith('scripts/')))) {
      const target = path.join(directory, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, source(name))
    }
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(directory, 'node_modules'), 'junction')
    const checkout = folder => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) checkout(file)
        else if (/\.(?:mjs|cjs|js|jsx|ps1)$/.test(entry.name)) {
          const value = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
          writeFileSync(file, ending === 'CRLF' ? value.replace(/\n/g, '\r\n') : value)
        }
      }
    }
    checkout(scripts)
    const read = name => readFileSync(path.join(scripts, name), 'utf8').replace(/\r\n/g, '\n')
    const pin = tablePinFixture(), generated = prepareTableOperationsVerifierSources(pin, read)
    for (const item of generated) writeFileSync(path.join(scripts, item.output), item.pinned)
    const module = name => import(pathToFileURL(path.join(scripts, name)).href)
    const { prepareLocalImportValidatorPin } = await module('pin-reading-import-generated.mjs')
    const inherited = prepareLocalImportValidatorPin(pin, read)
    writeFileSync(path.join(scripts, 'template-installed-evidence.mjs'), inherited.after)
    for (const item of inherited.generated) writeFileSync(path.join(scripts, item.output), item.pinned)
    const { prepareOutlineInstallation } = await module('document-outline-installed-evidence.mjs')
    const { extendGraphInstallation } = await module('import-graph-validator.mjs')
    const { extendPinsInstallation } = await module('import-pins-validator.mjs')
    const { extendRecentInstallation } = await module('import-recent-validator.mjs')
    const { prepareInstallerHistoryReadiness } = await module('installer-history-readiness.mjs')
    const { extendWikiInstallation } = await module('import-wiki-validator.mjs')
    const { extendLocalImportInstallation } = await module('reading-import-validator.mjs')
    const { extendReadingModeInstallation } = await module('reading-mode-installed-evidence.mjs')
    const old = prepareOutlineInstallation(read('installer-lifecycle-core.mjs'), read('check-windows-installer-lifecycle.mjs'), pin)
    const reading = extendReadingModeInstallation(extendLocalImportInstallation(extendWikiInstallation(prepareInstallerHistoryReadiness(extendRecentInstallation(extendPinsInstallation(extendGraphInstallation(old, pin), pin), pin)), pin), pin), pin)
    const previous = extendBlockReferenceInstallation(extendLocalExportInstallation(extendShortcutManagementInstallation(reading, pin), pin), pin)
    const final = extendTableOperationsInstallation(previous, pin)
    writeFileSync(path.join(scripts, 'before-table-core.mjs'), previous.core)
    writeFileSync(path.join(scripts, 'table-core.mjs'), final.core)
    const previousCore = await module('before-table-core.mjs'), core = await module('table-core.mjs')
    assert.equal(previousCore.REQUIRED_CHECKS.length, 29); assert.equal(core.REQUIRED_CHECKS.length, 30)
    assert.deepEqual(core.REQUIRED_CHECKS.filter(check => check !== TABLE_OPERATIONS_INSTALLATION_GATE), previousCore.REQUIRED_CHECKS)
    assert.deepEqual(core.RELEASES, { previous: pin.previous, current: pin.current }); assert.equal(core.PRODUCT_COMMIT, pin.product)
    assert.ok(final.core.includes(previousCore.LEGACY_DEFECT.sha256))
    const call = 'await runTableOperationsDesktop('
    assert.equal(final.script.split(call).length, 2)
    assert.ok(final.script.indexOf(call) > final.script.indexOf("mark('" + BLOCK_REFERENCE_INSTALLATION_GATE + "')"))
    assert.ok(final.script.indexOf(call) < final.script.indexOf('const finalData=snapshotData()'))
    assert.ok(final.script.includes('sourcePins:' + JSON.stringify(pin.tableOperationsSources)))
    for (const original of ['await runBlockReferencesDesktop(', 'await runLocalExportLifecycle(', 'await runShortcutManagementLifecycle(', 'await verifyReadingModeDesktop(', 'await verifyLocalImportRestart(']) assert.equal(final.script.split(original).length, 2)
    assert.ok(final.script.includes("assert.equal(observedDirectory,legacyTarget.split(' ')[0],'Old directory truncation was not reproduced')"))
    assert.throws(() => extendTableOperationsInstallation(final, pin))
    assert.throws(() => extendTableOperationsInstallation({ ...previous, script: previous.script.replace("mark('" + BLOCK_REFERENCE_INSTALLATION_GATE + "')", "mark('removed-blocks')") }, pin))
    writeFileSync(path.join(scripts, 'table-install.mjs'), final.script)
    for (const file of ['table-install.mjs', 'run-reading-import-generated.mjs']) {
      const checked = spawnSync(process.execPath, ['--check', path.join(scripts, file)], { encoding: 'utf8', timeout: 10000 })
      assert.ifError(checked.error); assert.equal(checked.status, 0, checked.stderr)
    }
    // Exercise both real downstream readers in fresh processes against the
    // complete generated core. The prior 29-gate report passes its own full
    // validator, then each reader must reject its missing Table prerequisite.
    const prerequisiteScript = `import assert from 'node:assert/strict'
import {PRODUCT_COMMIT,REQUIRED_CHECKS,RELEASES,LEGACY_DEFECT} from './installer-lifecycle-core.mjs'
import {validateUiScreensOriginalInstallation} from './run-ui-screens-installed.mjs'
import {validateFullAppOriginalInstallation} from './run-full-app-ui-installed.mjs'
const verifier='d'.repeat(40);process.env.GITHUB_SHA=verifier
const pin={product:PRODUCT_COMMIT,current:RELEASES.current,previous:RELEASES.previous}
const identity={productCommit:pin.product,verifierCommit:verifier}
const application={executableSHA256:'a'.repeat(64),asarSHA256:'b'.repeat(64),backendSHA256:'c'.repeat(64)}
const original={...identity,complete:true,platform:'win32',runnerEnvironment:'github-hosted',syntheticData:true,usedDefaultDataPath:true,forceTerminated:false,cleanupComplete:true,
 checks:[...REQUIRED_CHECKS],legacyInstaller:LEGACY_DEFECT,legacyPathProbe:{observedTruncation:true,cleaned:true},
 legacyProbeCommands:Array.from({length:2},()=>({code:0,signal:null,timedOut:false})),installers:RELEASES,
 commands:Array.from({length:8},()=>({code:0,signal:null,timedOut:false,pid:22,elapsedMs:2})),
 appExits:Array.from({length:6},()=>({code:0,signal:null,nativeClose:true})),dataComparisons:Array.from({length:6},()=>({equal:true,files:1,digest:'e'.repeat(64)})),
 shortcutManagementRun:{application},localExportRun:{application},snapshots:[{phase:'installed-'+pin.current.version,...application}]}
const input={pin,original,currentApplication:application,accepted:{...identity,complete:true,installer:pin.current,installationChecks:original.checks,screenshotsVerified:true},sourceProof:{...identity,productionModified:false}}
for(const validate of [validateUiScreensOriginalInstallation,validateFullAppOriginalInstallation]){
 if(process.argv[2]==='current')assert.equal(validate(input),true)
 else assert.throws(()=>validate(input),/Original installation gate missing: installed-app-table-operations-workflow/)
}
`
    writeFileSync(path.join(scripts, 'table-prerequisites.mjs'), prerequisiteScript)
    for (const [label, preparedCore] of [['previous', previous.core], ['current', final.core]]) {
      writeFileSync(path.join(scripts, 'installer-lifecycle-core.mjs'), preparedCore)
      const checked = spawnSync(process.execPath, [path.join(scripts, 'table-prerequisites.mjs'), label], { encoding: 'utf8', timeout: 10000 })
      assert.ifError(checked.error); assert.equal(checked.status, 0, checked.stdout + checked.stderr)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('native workflow retains old triggers, budgets, every old preparation roster and the full application groups', () => {
  const workflow = source('.github/workflows/local-installation-2f86.yml')
  assert.ok(workflow.includes('branches: [ci/local-installation-2f86]'))
  assert.equal(workflow.match(/timeout-minutes:\s*(\d+)/)[1], '20')
  assert.ok(workflow.includes('timeout-minutes: 25'))
  assert.ok(workflow.includes('group: [settings, projects, research, editor, local-sync-lab]'))
  assert.ok(workflow.includes('scripts/block-references-evidence.node.mjs scripts/block-references-installed-evidence.node.mjs'))
  assert.ok(workflow.includes('scripts/table-operations-evidence.node.mjs scripts/table-operations-cleanup.node.mjs scripts/table-operations-installed-evidence.node.mjs'))
  assert.ok(workflow.includes('run: node scripts/run-reading-mode-installer.mjs run'))
  assert.ok(workflow.includes('local-export-preparation-contracts.tap scripts/local-export-desktop-evidence.node.mjs scripts/local-export-installed-evidence.node.mjs'))
  assert.ok(source('scripts/pin-reading-mode-installer.mjs').includes('const generated = prepareTableOperationsVerifierSources(pin,'))
  assert.ok(source('scripts/run-reading-mode-installer.mjs').includes('validateTableOperationsInstallerPin(pin)'))
})
