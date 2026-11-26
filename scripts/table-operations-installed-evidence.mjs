import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { replaceExactlyAndProveInverse } from './reading-mode-installed-evidence.mjs'
import { BLOCK_REFERENCE_INSTALLATION_GATE, prepareBlockReferenceVerifierSources,
  validateBlockReferencePin, verifyInstalledBlockReferences } from './block-references-installed-evidence.mjs'
import { TABLE_OPERATIONS_VERSION, TABLE_OPERATIONS_REPORT, TABLE_OPERATIONS_SOURCES,
  tableOperationsBlob, tableOperationsHash, verifyTableOperationsReport } from './table-operations-evidence.mjs'

export const TABLE_OPERATIONS_INSTALLATION_GATE = 'installed-app-table-operations-workflow'

export function validateTableOperationsInstallerPin(pin) {
  validateBlockReferencePin(pin)
  assert.equal(pin.current.version, TABLE_OPERATIONS_VERSION)
  assert.deepEqual(Object.keys(pin.tableOperationsSources || {}).sort(), [...TABLE_OPERATIONS_SOURCES].sort(),
    'Installed Table acceptance requires every current product source pin')
  for (const value of Object.values(pin.tableOperationsSources)) assert.match(value || '', /^[a-f0-9]{40}$/)
  return true
}

export function prepareTableOperationsVerifierSources(pin, readSource) {
  validateTableOperationsInstallerPin(pin)
  for (const name of TABLE_OPERATIONS_SOURCES) {
    const value = readSource('../' + name)
    assert.equal(typeof value, 'string', 'Missing Table source: ' + name)
    assert.equal(tableOperationsBlob(value.replace(/\r\n/g, '\n')), pin.tableOperationsSources[name], 'Changed Table source: ' + name)
  }
  return prepareBlockReferenceVerifierSources(pin, readSource).map(item => {
    if (item.output !== 'run-reading-import-generated.mjs') return item
    const pairs = TABLE_OPERATIONS_SOURCES.map(name => "['../" + name + "',pin.tableOperationsSources[" + JSON.stringify(name) + ']]').join(',')
    const additions = [
      ["from './block-references-installed-evidence.mjs'", "from './block-references-installed-evidence.mjs'\nimport {extendTableOperationsInstallation,verifyInstalledTableOperations,validateGeneratedTableOperationsSources} from './table-operations-installed-evidence.mjs'"],
      ["validateGeneratedBlockReferenceSources(pin,name=>read('./'+name))", "validateGeneratedTableOperationsSources(pin,name=>read('./'+name))"],
      ['prepared=extendBlockReferenceInstallation(exportPrepared,pin);', 'blockPrepared=extendBlockReferenceInstallation(exportPrepared,pin),prepared=extendTableOperationsInstallation(blockPrepared,pin);'],
      ["['./local-export-directory-worker.ps1',pin.localExportDirectoryWorkerBlob]", "['./local-export-directory-worker.ps1',pin.localExportDirectoryWorkerBlob]," + pairs],
      ['blocks=verifyInstalledBlockReferences(out,report,pin,process.env.GITHUB_SHA)', 'blocks=verifyInstalledBlockReferences(out,report,pin,process.env.GITHUB_SHA),tables=verifyInstalledTableOperations(out,report,pin,process.env.GITHUB_SHA)'],
      ['...blocks.screenshots]', '...blocks.screenshots,...tables.screenshots]'],
      ['blockReferenceChecks:blocks.checks,', 'tableOperationsChecks:tables.checks,blockReferenceChecks:blocks.checks,'],
    ]
    const pinned = replaceExactlyAndProveInverse(item.pinned, additions), changes = [...item.changes, ...additions]
    assert.equal(replaceExactlyAndProveInverse(pinned, [...changes].reverse().map(([before, after]) => [after, before])), item.original)
    return { ...item, pinned, changes, blockPinned: item.pinned }
  })
}

export function validateGeneratedTableOperationsSources(pin, readSource) {
  for (const item of prepareTableOperationsVerifierSources(pin, readSource)) {
    const source = readSource(item.output)
    assert.equal(typeof source, 'string', 'Prepared Table verifier is missing: ' + item.output)
    assert.equal(source.replace(/\r\n/g, '\n'), item.pinned, 'Prepared Table verifier changed after source proof: ' + item.output)
  }
  return true
}

export function extendTableOperationsInstallation(prepared, pin) {
  validateTableOperationsInstallerPin(pin)
  assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
  assert.doesNotMatch(prepared.script, /runTableOperationsDesktop|tableOperationsRun/)
  assert.doesNotMatch(prepared.core, /installed-app-table-operations-workflow/)
  const anchor = "  const finalData=snapshotData();await uninstall('final-uninstall');unchanged(finalData,'final-uninstall');mark('final-uninstall-preserves-data')"
  const priorGate = "mark('" + BLOCK_REFERENCE_INSTALLATION_GATE + "')"
  assert.equal(prepared.script.split(priorGate).length, 2, 'The complete existing block-reference gate must remain exactly once')
  assert.equal(prepared.script.split('await runBlockReferencesDesktop(').length, 2)
  assert.ok(prepared.script.indexOf(priorGate) < prepared.script.indexOf(anchor))
  const addition = `  const tables=await runTableOperationsDesktop({executablePath:appExe,out,productCommit:PRODUCT_COMMIT,scope:'installed',ownedRoot:scratch,sourcePins:${JSON.stringify(pin.tableOperationsSources)}})\n  assertTableOperationsSession(report,blocks,tables)\n  report.tableOperationsRun={report:'${TABLE_OPERATIONS_REPORT}',sha256:sha(readFileSync(path.join(out,'${TABLE_OPERATIONS_REPORT}'))),processID:tables.pid};save();mark('${TABLE_OPERATIONS_INSTALLATION_GATE}')\n`
  const check = "'" + BLOCK_REFERENCE_INSTALLATION_GATE + "',"
  return {
    core: replaceExactlyAndProveInverse(prepared.core, [[check, check + " '" + TABLE_OPERATIONS_INSTALLATION_GATE + "',"]]),
    script: "import {runTableOperationsDesktop} from './run-table-operations-desktop.mjs'\nimport {assertTableOperationsSession} from './table-operations-installed-evidence.mjs'\n" +
      replaceExactlyAndProveInverse(prepared.script, [[anchor, addition + anchor]]),
  }
}

// Windows can reuse a PID after an earlier process exits. Require completed
// independent native sessions and identical installed image bytes instead.
export function assertTableOperationsSession(installation, blocks, tables) {
  assert.equal(installation.appExits.length, 6)
  for (const exit of installation.appExits) {
    assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(exit.nativeClose, true)
  }
  for (const [name, report] of [['blocks', blocks], ['tables', tables]]) {
    assert.equal(report.complete, true, name + ' incomplete')
    assert.equal(report.cleanupComplete, true, name + ' cleanup incomplete')
    assert.equal(report.forceTerminated, false, name + ' force terminated')
    assert.equal(report.backendStopped, true, name + ' backend still running')
    assert.equal(report.exit.pid, report.pid); assert.equal(report.exit.code, 0)
    assert.equal(report.exit.signal, null); assert.equal(report.exit.normalClose, true)
  }
  const priorEnd = Date.parse(blocks.completedAt), start = Date.parse(tables.startedAt), end = Date.parse(tables.finishedAt)
  assert.ok([priorEnd, start, end].every(Number.isFinite), 'Installed Table session requires valid native timestamps')
  assert.ok(priorEnd <= start && start <= end, 'Table session must start after block-reference teardown and finish after its own start')
  for (const key of ['executable', 'executableSHA256', 'asarSHA256', 'backendSHA256']) {
    assert.equal(tables[key], blocks[key], 'Table acceptance used a different installed image: ' + key)
    assert.equal(tables[key], installation.localExportRun.application[key], 'Table acceptance differs from the original installed export image: ' + key)
  }
  return true
}

export function validateTableOperationsInstallationReceipt(installation, tables, blocks, pin, verifier) {
  validateTableOperationsInstallerPin(pin)
  assert.equal(installation.complete, true); assert.equal(installation.cleanupComplete, true); assert.equal(installation.forceTerminated, false)
  assert.equal(installation.error, undefined)
  assert.equal(installation.productCommit, pin.product); assert.equal(installation.verifierCommit, verifier)
  assert.deepEqual(installation.installers, { current: pin.current, previous: pin.previous })
  assert.equal(tables.productCommit, pin.product); assert.equal(tables.verifierCommit, verifier)
  assert.equal(tables.scope, 'installed'); assert.equal(tables.version, TABLE_OPERATIONS_VERSION)
  assert.deepEqual(tables.sourceFiles, pin.tableOperationsSources)
  assert.equal(installation.tableOperationsRun.report, TABLE_OPERATIONS_REPORT)
  assert.match(installation.tableOperationsRun.sha256, /^[a-f0-9]{64}$/)
  assert.equal(installation.tableOperationsRun.processID, tables.pid)
  assertTableOperationsSession(installation, blocks, tables)
  assert.equal(installation.dataComparisons.length, 6)
  for (const comparison of installation.dataComparisons) assert.equal(comparison.equal, true)
  for (const gate of [BLOCK_REFERENCE_INSTALLATION_GATE, TABLE_OPERATIONS_INSTALLATION_GATE, 'final-uninstall-preserves-data']) {
    assert.equal(installation.checks.filter(check => check === gate).length, 1)
  }
  const tableIndex = installation.checks.indexOf(TABLE_OPERATIONS_INSTALLATION_GATE)
  assert.ok(installation.checks.indexOf(BLOCK_REFERENCE_INSTALLATION_GATE) < tableIndex)
  assert.ok(tableIndex < installation.checks.indexOf('final-uninstall-preserves-data'))
  return true
}

export function verifyInstalledTableOperations(directory, installation, pin, verifier) {
  validateTableOperationsInstallerPin(pin)
  const blocks = verifyInstalledBlockReferences(directory, installation, pin, verifier)
  assert.equal(tableOperationsHash(readFileSync(path.join(directory, TABLE_OPERATIONS_REPORT))), installation.tableOperationsRun.sha256,
    'Installation did not bind these exact Table report bytes')
  const tables = verifyTableOperationsReport(directory, { commit: pin.product, verifier, scope: 'installed', sources: pin.tableOperationsSources })
  validateTableOperationsInstallationReceipt(installation, tables, blocks, pin, verifier)
  return tables
}
