import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Historical seed releases are deliberately not part of this list.
// Every active runner, generated validator and synthetic release must
// agree with the manifest BEFORE dependencies or packaging are run.
export const ACCEPTANCE_VERSION_FIELDS = Object.freeze([
  ['scripts/reading-mode-desktop-evidence.mjs', "export const READING_MODE_VERSION = '"],
  ['scripts/shortcut-management-desktop-evidence.mjs', "export const SHORTCUT_MANAGEMENT_VERSION = '"],
  ['scripts/local-export-desktop-evidence.mjs', "export const LOCAL_EXPORT_VERSION = '"],
  ['scripts/block-references-evidence.mjs', "export const BLOCK_REFERENCE_VERSION = '"],
  ['scripts/reading-mode-installed-evidence.mjs', "assert.equal(pin.current?.version, '"],
  ['scripts/shortcut-management-installed-evidence.mjs', "assert.equal(pin.current.version, '"],
  ['scripts/local-import-desktop-evidence.mjs', "assert.equal(report.appVersion, '"],
  ['scripts/check-local-import-desktop.mjs', "assert.equal(diagnostics.version, '"],
  ['scripts/local-import-desktop-evidence.node.mjs', "appVersion: '"],
  ['scripts/reading-mode-installed-evidence.mjs', ", \"assert.equal(pin.current.version, '"],
  ['scripts/reading-mode-installed-evidence.mjs', ", \"assert.equal(report.appVersion, '"],
  ['scripts/reading-mode-installed-evidence.mjs', ", \"assert.equal(diagnostics.version, '"],
  ['scripts/reading-mode-installed-evidence.mjs', ", \"appVersion: '"],
])

export function inspectAcceptanceVersions(read) {
  const errors = []
  let version
  try { version = JSON.parse(read('package.json')).version } catch { errors.push({ file: 'package.json', reason: 'unreadable-manifest' }) }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) errors.push({ file: 'package.json', reason: 'invalid-release-version' })
  for (const [file, anchor] of ACCEPTANCE_VERSION_FIELDS) {
    let source
    try { source = read(file) } catch { errors.push({ file, anchor, reason: 'missing-source' }); continue }
    const matches = typeof source === 'string' ? source.split(anchor).slice(1) : []
    if (matches.length !== 1) { errors.push({ file, anchor, reason: 'missing-or-ambiguous-anchor', count: matches.length }); continue }
    const actual = matches[0].split("'")[0]
    if (actual !== version) errors.push({ file, anchor, expected: version, actual, reason: 'release-mismatch' })
  }
  return { version, checks: ACCEPTANCE_VERSION_FIELDS.length, valid: errors.length === 0, errors }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const result = inspectAcceptanceVersions(file => readFileSync(path.join(root, file), 'utf8'))
  console.log(JSON.stringify(result, null, 2))
  if (!result.valid) process.exitCode = 1
}
