import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { patchInstallerTemplate, prepareInstallerTemplate, ORIGINAL_SHA256, PATCHED_SHA256 } from './prepare-nsis-template.mjs'
const require = createRequire(import.meta.url)
const installed = readFileSync(join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/multiUser.nsh'), 'utf8').replace(/\r\n/g, '\n')
const hash = value => createHash('sha256').update(value).digest('hex')
// Tests also run after a prior package build has prepared the installed template.
let original = installed
if (hash(installed) === PATCHED_SHA256) {
  original = installed.replace('!include WinVer.nsh\n', '').replace(
    /      \$\{IfNot\} \$\{AtLeastWin8\}\n([\s\S]*?        System::Store L)\n      \$\{EndIf\}/,
    (_, block) => block.split('\n').map(line => line.slice(2)).join('\n'),
  )
}
assert.equal(hash(original), ORIGINAL_SHA256, 'Installed builder template is not the audited baseline')
const patched = patchInstallerTemplate(original).content
function fixture(t, content = original, version = '24.13.3', name = 'app-builder-lib') {
  const root = mkdtempSync(join(tmpdir(), 'notepad-nsis-check-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const folder = join(root, 'templates/nsis')
  mkdirSync(folder, { recursive: true })
  const packagePath = join(root, 'package.json'), target = join(folder, 'multiUser.nsh')
  writeFileSync(packagePath, JSON.stringify({ name, version }))
  writeFileSync(target, content)
  return { packagePath, target, folder }
}
test('audited baseline transforms to the exact pinned output digest', () => {
  assert.equal(hash(patched), PATCHED_SHA256)
  assert.equal(patchInstallerTemplate(original).changed, true)
})
test('only the legacy known-folder block is guarded, preserving path overrides and privilege mode', () => {
  assert.match(patched, /\$\{IfNot\} \$\{AtLeastWin8\}\n        System::Store S/)
  assert.match(patched, /System::Store L\n      \$\{EndIf\}\n      StrCpy \$INSTDIR/)
  for (const marker of ['!include WinVer.nsh', 'SetShellVarContext current', '${StdUtils.GetParameter} $R0 "D" ""', '!macro setInstallModePerAllUsers']) assert.ok(patched.includes(marker))
})
test('repeated preparation is idempotent and does not nest guards', () => {
  assert.deepEqual(patchInstallerTemplate(patched), { content: patched, changed: false })
})
test('Windows CRLF input preserves its newline convention and exact normalized digest', () => {
  const result = patchInstallerTemplate(original.replace(/\n/g, '\r\n'))
  assert.equal(hash(result.content.replace(/\r\n/g, '\n')), PATCHED_SHA256)
  assert.equal(result.content.replace(/\r\n/g, '').includes('\n'), false)
})
test('unknown or partially patched template fails rather than guessing', () => {
  for (const value of ['', original + '# modified', patched.replace('AtLeastWin8', 'AtLeastWin10')]) assert.throws(() => patchInstallerTemplate(value), /Unrecognized/)
})
test('invalid input types fail before any file mutation', () => {
  for (const value of [null, 5, {}, []]) assert.throws(() => patchInstallerTemplate(value), TypeError)
})
test('preparation writes and verifies a temporary dependency fixture without stray files', t => {
  const f = fixture(t)
  assert.deepEqual(prepareInstallerTemplate(f.packagePath), { changed: true, sha256: PATCHED_SHA256 })
  assert.equal(readFileSync(f.target, 'utf8'), patched)
  assert.deepEqual(readdirSync(f.folder), ['multiUser.nsh'])
})
test('a second preparation leaves the prepared file byte-for-byte unchanged', t => {
  const f = fixture(t, patched)
  assert.equal(prepareInstallerTemplate(f.packagePath).changed, false)
  assert.equal(readFileSync(f.target, 'utf8'), patched)
})
test('unreviewed builder versions are rejected with original bytes preserved', t => {
  const f = fixture(t, original, '25.0.0')
  assert.throws(() => prepareInstallerTemplate(f.packagePath), /Expected/)
  assert.equal(readFileSync(f.target, 'utf8'), original)
})
test('a different package cannot be accidentally treated as the builder', t => {
  const f = fixture(t, original, '24.13.3', 'other-package')
  assert.throws(() => prepareInstallerTemplate(f.packagePath), /Expected/)
  assert.equal(readFileSync(f.target, 'utf8'), original)
})
test('a changed template is preserved and no temporary file is left behind', t => {
  const altered = original + '\n# another change'
  const f = fixture(t, altered)
  assert.throws(() => prepareInstallerTemplate(f.packagePath), /Unrecognized/)
  assert.equal(readFileSync(f.target, 'utf8'), altered)
  assert.deepEqual(readdirSync(f.folder), ['multiUser.nsh'])
})
