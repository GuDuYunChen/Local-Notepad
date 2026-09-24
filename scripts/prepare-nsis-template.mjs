import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Backport upstream electron-builder #9564 to the existing, pinned builder.
// This changes only its build-time NSIS template, never user data or permissions.
export const TEMPLATE_VERSION = '24.13.3'
export const ORIGINAL_SHA256 = 'afa9046492317e72e79e022cdb1f42edba4687ea605300bfc01c002f3106201c'
export const PATCHED_SHA256 = '461144ae7e8e04d87a6d195530dba063c85fe340e8fb48997df86339564cd231'
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex')

export function patchInstallerTemplate(input) {
  if (typeof input !== 'string') throw new TypeError('NSIS template must be UTF-8 text')
  const source = input.replace(/\r\n/g, '\n')
  const sha = digest(source)
  if (sha === PATCHED_SHA256) return { content: input, changed: false }
  if (sha !== ORIGINAL_SHA256) throw new Error('Unrecognized NSIS template; refusing a blind patch. Review the builder upgrade first.')
  const start = source.indexOf('      System::Store S')
  const end = source.indexOf('      System::Store L', start) + '      System::Store L'.length
  const guarded = '      ${IfNot} ${AtLeastWin8}\n' +
    source.slice(start, end).split('\n').map(line => '  ' + line).join('\n') + '\n      ${EndIf}'
  const result = (source.slice(0, start) + guarded + source.slice(end))
    .replace('!include UAC.nsh\n', '!include UAC.nsh\n!include WinVer.nsh\n')
  if (digest(result) !== PATCHED_SHA256) throw new Error('NSIS patch verification failed; original file was not changed.')
  return { content: input.includes('\r\n') ? result.replace(/\n/g, '\r\n') : result, changed: true }
}

export function prepareInstallerTemplate(packagePath) {
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (pkg.name !== 'app-builder-lib' || pkg.version !== TEMPLATE_VERSION) {
    throw new Error(`Expected app-builder-lib ${TEMPLATE_VERSION}; review the NSIS backport before changing the builder version.`)
  }
  const target = join(dirname(packagePath), 'templates', 'nsis', 'multiUser.nsh')
  const original = readFileSync(target, 'utf8')
  const result = patchInstallerTemplate(original)
  if (!result.changed) return { changed: false, sha256: PATCHED_SHA256 }
  const temporary = target + '.local-notepad-' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, result.content, { flag: 'wx' })
    if (readFileSync(target, 'utf8') !== original) throw new Error('NSIS template changed during preparation; refusing to overwrite it.')
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
  if (digest(readFileSync(target, 'utf8').replace(/\r\n/g, '\n')) !== PATCHED_SHA256) {
    throw new Error('Prepared NSIS template failed verification; packaging must stop.')
  }
  return { changed: true, sha256: PATCHED_SHA256 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const require = createRequire(new URL('../package.json', import.meta.url))
    const result = prepareInstallerTemplate(require.resolve('app-builder-lib/package.json'))
    console.log(`NSIS Windows-version guard ${result.changed ? 'applied' : 'already present'}; SHA-256 ${result.sha256}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
