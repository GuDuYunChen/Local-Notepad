import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/ui-recovery-candidate.json'), 'utf8'))
const hash = value => createHash('sha256').update(value).digest('hex')
const allowedScripts = new Set(['scripts/build-local-export-fixture.mjs', 'scripts/build-reading-mode-fixture.mjs',
  'scripts/fixture-antd-node-imports.mjs', 'scripts/fixture-antd-node-imports.node.mjs'])
if (manifest.schemaVersion !== 1 || manifest.branch !== 'fix/local-ui-consistency-2f116' ||
    manifest.baseCommit !== '23fa107d4d337400aab65f2bb208488f3d94a9de' || !Array.isArray(manifest.files)) {
  throw Error('Unexpected recovery manifest or baseline')
}
const seen = new Set(), prepared = []
for (const file of manifest.files) {
  if (typeof file.path !== 'string' || file.path.includes('..') || path.isAbsolute(file.path) || seen.has(file.path) ||
      !(/^src\/(components|test)\/[\w./-]+\.(jsx?|mjs)$/.test(file.path) || allowedScripts.has(file.path) ||
        file.path === 'docs/LOCAL_UI_RECOVERY_2F116.md')) throw Error('Out-of-scope recovery path: ' + file.path)
  seen.add(file.path)
  const filename = path.join(root, file.path)
  for (let parent = path.dirname(filename); parent !== root; parent = path.dirname(parent)) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw Error('Symlink parent refused')
  }
  if (fs.existsSync(filename) && fs.lstatSync(filename).isSymbolicLink()) throw Error('Symlink file refused')
  const old = fs.existsSync(filename) ? fs.readFileSync(filename) : null
  if ((old === null ? null : hash(old)) !== file.before) throw Error('Source changed; refusing overwrite: ' + file.path)
  const lines = old === null ? [] : (old.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) || [])
  let end = 0
  for (const hunk of file.hunks) {
    if (!Number.isInteger(hunk.start) || !Number.isInteger(hunk.end) || hunk.start < end ||
        hunk.end < hunk.start || hunk.end > lines.length || typeof hunk.text !== 'string') throw Error('Invalid recovery hunk')
    end = hunk.end
  }
  for (const hunk of [...file.hunks].reverse()) lines.splice(hunk.start, hunk.end - hunk.start, hunk.text)
  const content = Buffer.from(lines.join(''), 'utf8')
  if (hash(content) !== file.after) throw Error('Target digest mismatch: ' + file.path)
  prepared.push({ filename, content, path: file.path, sha256: file.after })
}
// No partial writes from a stale source or bad patch: validate every file first.
if (!process.argv.includes('--check')) for (const file of prepared) {
  fs.mkdirSync(path.dirname(file.filename), { recursive: true })
  fs.writeFileSync(file.filename, file.content)
}
console.log(JSON.stringify({ checked: prepared.length, applied: !process.argv.includes('--check'),
  baseCommit: manifest.baseCommit, files: prepared.map(({ path, sha256 }) => ({ path, sha256 })) }, null, 2))
