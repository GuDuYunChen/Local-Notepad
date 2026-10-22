import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Audited backports for the pinned builder: #9564 (known folders) and #9196
// (/D paths with spaces). No runtime, privilege or data-retention changes.
export const TEMPLATE_VERSION = '24.13.3'
export const ORIGINAL_SHA256 = 'afa9046492317e72e79e022cdb1f42edba4687ea605300bfc01c002f3106201c'
export const LEGACY_PATCHED_SHA256 = '461144ae7e8e04d87a6d195530dba063c85fe340e8fb48997df86339564cd231'
export const PATCHED_SHA256 = '91b585786c8e8b9c69181a32771f57322b7800b21f50af9c82daf9d99f10d6b1'
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex')
const oldRead = '${StdUtils.GetParameter} $R0 "D" ""'
const newRead = '!insertmacro GetDParameter $R0'
// Same register-preserving parser as upstream #9196. NSIS requires /D= last
// and unquoted: use the full command line, not tokenization at a blank space.
export const DIRECTORY_MACRO = `
# Backport electron-builder #9196: retain the complete final /D= path.
!macro GetDParameter outVar
  Push $R8
  Push $R9
  Push $R7
  Push $R6
  Push $R5
  \${StdUtils.GetAllParameters} $R8 "0"
  StrCpy $R9 ""
  StrLen $R7 $R8
  IntOp $R7 $R7 - 2
  StrCpy $R6 0
  \${Do}
    StrCpy $R5 $R8 3 $R6
    \${If} $R5 == "/D="
    \${OrIf} $R5 == "/d="
      IntOp $R6 $R6 + 3
      StrCpy $R9 $R8 "" $R6
      \${Break}
    \${EndIf}
    IntOp $R6 $R6 + 1
  \${LoopUntil} $R6 > $R7
  StrCpy \${outVar} $R9
  Pop $R5
  Pop $R6
  Pop $R7
  Pop $R9
  Pop $R8
!macroend
`
export function restoreInstallerTemplate(input) {
  if (typeof input !== 'string') throw new TypeError('NSIS template must be UTF-8 text')
  let source = input.replace(/\r\n/g, '\n')
  const sha = digest(source)
  if (sha === ORIGINAL_SHA256) return source
  if (sha === PATCHED_SHA256) {
    if (!source.endsWith(DIRECTORY_MACRO)) throw new Error('Unrecognized directory patch')
    source = source.slice(0, -DIRECTORY_MACRO.length).replaceAll(newRead, oldRead)
  } else if (sha !== LEGACY_PATCHED_SHA256) throw new Error('Unrecognized NSIS template; refusing a blind patch. Review the builder upgrade first.')
  if (digest(source) !== LEGACY_PATCHED_SHA256) throw new Error('Unrecognized known-folder guard')
  source = source.replace('!include WinVer.nsh\n', '').replace(
    /      \$\{IfNot\} \$\{AtLeastWin8\}\n([\s\S]*?        System::Store L)\n      \$\{EndIf\}/,
    (_, block) => block.split('\n').map(line => line.slice(2)).join('\n'),
  )
  if (digest(source) !== ORIGINAL_SHA256) throw new Error('Original NSIS template identity mismatch')
  return source
}
export function patchInstallerTemplate(input) {
  const original = restoreInstallerTemplate(input)
  if (digest(input.replace(/\r\n/g, '\n')) === PATCHED_SHA256) return { content: input, changed: false }
  const start = original.indexOf('      System::Store S')
  const end = original.indexOf('      System::Store L', start) + '      System::Store L'.length
  const guarded = '      ${IfNot} ${AtLeastWin8}\n' +
    original.slice(start, end).split('\n').map(line => '  ' + line).join('\n') + '\n      ${EndIf}'
  const legacy = (original.slice(0, start) + guarded + original.slice(end))
    .replace('!include UAC.nsh\n', '!include UAC.nsh\n!include WinVer.nsh\n')
  if (digest(legacy) !== LEGACY_PATCHED_SHA256) throw new Error('Legacy NSIS guard verification failed')
  const result = legacy.replaceAll(oldRead, newRead) + DIRECTORY_MACRO
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
  } finally { rmSync(temporary, { force: true }) }
  if (digest(readFileSync(target, 'utf8').replace(/\r\n/g, '\n')) !== PATCHED_SHA256) throw new Error('Prepared NSIS template failed verification; packaging must stop.')
  return { changed: true, sha256: PATCHED_SHA256 }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const require = createRequire(new URL('../package.json', import.meta.url))
    const result = prepareInstallerTemplate(require.resolve('app-builder-lib/package.json'))
    console.log(`NSIS known-folder and complete-directory guards ${result.changed ? 'applied' : 'already present'}; SHA-256 ${result.sha256}`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
