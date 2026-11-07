import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import postcss from 'postcss'

// Inventory only: a native element is not automatically a defect. This tool
// cannot prove rendered alignment, accessibility, or completion of a migration.
const nativeTags = new Set(['button', 'input', 'select', 'textarea'])
const nativeExceptions = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'button', 'submit', 'reset', 'image'])
const library = /^(antd(?:\/|$)|@mui\/|@radix-ui\/|@headlessui\/|@arco-design\/|@fluentui\/|@chakra-ui\/|@douyinfe\/semi-ui|react-select$)/
const controlName = /(?:Button|Input|InputNumber|Select|Textarea|TextArea|Checkbox|Radio|Switch|Slider|Picker)$/
function jsxName(node) {
  if (!node) return ''
  if (node.type === 'JSXIdentifier') return node.name
  if (node.type === 'JSXMemberExpression') return jsxName(node.object) + '.' + jsxName(node.property)
  return ''
}
function literal(attribute) {
  if (!attribute) return null
  if (!attribute.value) return true
  const value = attribute.value.type === 'JSXExpressionContainer' ? attribute.value.expression : attribute.value
  return ['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(value.type) ? value.value : '<dynamic>'
}
function walk(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return
  visit(node, ancestors)
  const next = [...ancestors, node]
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue
    if (Array.isArray(value)) { for (const child of value) walk(child, visit, next) }
    else if (value && typeof value === 'object') walk(value, visit, next)
  }
}
export function inspectJsx(source, filename) {
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', ...( /\.tsx?$/.test(filename) ? ['typescript'] : [])] })
  const imports = new Map()
  for (const item of ast.program.body) if (item.type === 'ImportDeclaration') {
    for (const spec of item.specifiers) imports.set(spec.local.name, { source: item.source.value, imported: spec.imported?.name || spec.imported?.value || (spec.type === 'ImportNamespaceSpecifier' ? '*' : 'default') })
  }
  const controls = [], programmatic = []
  walk(ast, (node, ancestors) => {
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.property?.name === 'createElement' && node.arguments?.[0]?.type === 'StringLiteral' && nativeTags.has(node.arguments[0].value)) {
      programmatic.push({ line: node.loc.start.line, tag: node.arguments[0].value, review: 'programmatic-native-control; inspect intent before migration' })
    }
    if (node.type !== 'JSXOpeningElement') return
    const tag = jsxName(node.name), root = tag.split('.')[0], binding = imports.get(root)
    const native = nativeTags.has(tag)
    if (!native && !controlName.test(tag) && !controlName.test(binding?.imported || '')) return
    const attrs = new Map(node.attributes.filter(a => a.type === 'JSXAttribute').map(a => [a.name.name, a]))
    const type = literal(attrs.get('type')) || (tag === 'input' ? 'text' : null)
    const inForm = ancestors.some(a => a.type === 'JSXElement' && jsxName(a.openingElement.name) === 'form')
    const origin = native ? 'native' : library.test(binding?.source || '') ? 'library' : /(?:^|\/)ui\//.test(binding?.source || '') ? 'shared-local' : 'custom-or-unresolved'
    const review = []
    if (tag === 'select') review.push('native-select-popup')
    if (tag === 'input' && nativeExceptions.has(type)) review.push('native-semantics-exception; do-not-blindly-replace')
    if (tag === 'button' && inForm && !attrs.has('type')) review.push('implicit-form-submit; inspect-intent')
    if (attrs.has('style')) review.push('inline-style; inspect-layout-and-state')
    // Never collect current/default field values or arbitrary JSX expressions.
    controls.push({ line: node.loc.start.line, tag, type, origin, importSource: binding?.source || null, className: literal(attrs.get('className')), ariaLabel: literal(attrs.get('aria-label')), role: literal(attrs.get('role')), inForm, disabledProp: attrs.has('disabled'), hasRef: attrs.has('ref'), review })
  })
  return { file: filename, controls, programmatic, libraries: [...new Set([...imports.values()].map(i => i.source).filter(i => library.test(i)))] }
}
export function inspectCss(source, filename) {
  const root = postcss.parse(source, { from: filename }), rules = []
  root.walkRules(rule => {
    const relevant = /(?:button|input|select|textarea|focus|\.btn\b|control|toolbar|filter|tools|action|modal|dialog|panel|card)/i.test(rule.selector)
    if (!relevant) return
    const declarations = (rule.nodes || []).filter(n => n.type === 'decl' && /^(?:height|min-height|max-height|width|min-width|max-width|padding(?:-.+)?|margin(?:-.+)?|line-height|font(?:-.+)?|border(?:-.+)?|box-shadow|outline(?:-.+)?|display|align-items|align-self|gap|flex(?:-.+)?|grid(?:-.+)?|overflow(?:-.+)?)$/.test(n.prop)).map(n => ({ property: n.prop, value: n.value, important: !!n.important, line: n.source.start.line }))
    if (!declarations.length) return
    const risks = []
    if (declarations.some(d => d.important)) risks.push('important-cascade-review')
    if (declarations.some(d => d.property === 'box-shadow' && d.value !== 'none')) risks.push('shadow-purpose-review; may-be-semantic')
    if (/focus/.test(rule.selector)) risks.push('focus-layer-review; preserve-visible-keyboard-focus')
    rules.push({ line: rule.source.start.line, selector: rule.selector, declarations, review: risks })
  })
  return { file: filename, rules }
}
const sum = (items, pick) => items.reduce((n, item) => n + pick(item), 0)
const sha256 = value => createHash('sha256').update(value).digest('hex')
export function main() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const tracked = git('ls-files', '-z', '--', 'src').split('\0').filter(Boolean).sort()
  const production = tracked.filter(f => !/(?:^|\/)(?:__tests__|__mocks__)(?:\/|$)|\.(?:test|spec|stories)\.[^.]+$|\.d\.ts$/.test(f))
  const code = production.filter(f => /\.(?:[cm]?js|jsx|ts|tsx)$/.test(f)), css = production.filter(f => /\.css$/.test(f))
  const report = { schemaVersion: 1, status: 'inventory-only-not-ui-acceptance', inventoryComplete: false, productTestsExecuted: false, visualVerified: false, windowsVerified: false, sourceCommit: git('rev-parse', 'HEAD').trim(), sourceTree: git('rev-parse', 'HEAD^{tree}').trim(), generatedAt: new Date().toISOString(), packageLockSha256: sha256(fs.readFileSync('package-lock.json')), productionCodeFiles: code.length, productionCssFiles: css.length, files: [], stylesheets: [], failures: [], sourceFiles: [] }
  const sources = new Map()
  for (const file of [...code, ...css]) {
    try {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('Unsupported source file kind or size')
      const bytes = fs.readFileSync(file), text = bytes.toString('utf8')
      sources.set(file, text); report.sourceFiles.push({ file, bytes: bytes.length, sha256: sha256(bytes) })
      if (file.endsWith('.css')) report.stylesheets.push(inspectCss(text, file))
      else report.files.push(inspectJsx(text, file))
    } catch (error) { report.failures.push({ file, error: String(error.message).slice(0, 240) }) }
  }
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  report.declaredUiLibraries = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([name]) => library.test(name))
  const all = report.files.flatMap(f => f.controls)
  report.counts = { native: Object.fromEntries([...nativeTags].map(tag => [tag, all.filter(n => n.tag === tag).length])), library: all.filter(n => n.origin === 'library').length, sharedLocal: all.filter(n => n.origin === 'shared-local').length, customOrUnresolved: all.filter(n => n.origin === 'custom-or-unresolved').length, filesWithControls: report.files.filter(f => f.controls.length).length, nativeExceptionInputs: all.filter(n => n.tag === 'input' && nativeExceptions.has(n.type)).length, programmaticControls: sum(report.files, f => f.programmatic.length), controlInlineStyles: all.filter(n => n.review.some(r => r.startsWith('inline-style'))).length, styleRulesForReview: sum(report.stylesheets, f => f.rules.length) }
  const targets = [ ['webdav-password', 'WebDAV 密码'], ['saved-collections', '已存资料集'], ['collection-package', '资料集便携备份与恢复'], ['pinned-filters', '置顶显示范围'] ]
  report.screenshotSources = targets.map(([id, text]) => ({ id, locations: [...sources].filter(([file]) => !file.endsWith('.css')).flatMap(([file, source]) => source.split(/\r?\n/).flatMap((line, i) => line.includes(text) ? [{ file, line: i + 1 }] : [])) }))
  report.inventoryComplete = report.failures.length === 0 && report.files.length === code.length && report.stylesheets.length === css.length
  const rows = report.files.filter(f => f.controls.length || f.programmatic.length).map(f => ({ file: f.file, button: f.controls.filter(c => c.tag === 'button').length, input: f.controls.filter(c => c.tag === 'input').length, select: f.controls.filter(c => c.tag === 'select').length, textarea: f.controls.filter(c => c.tag === 'textarea').length, library: f.controls.filter(c => c.origin === 'library').length, shared: f.controls.filter(c => c.origin === 'shared-local').length, inline: f.controls.filter(c => c.review.some(r => r.startsWith('inline-style'))).length }))
  const lines = ['# Production UI control inventory', '', 'Source: `' + report.sourceCommit + '`; tree: `' + report.sourceTree + '`.', '', '**Inventory only. A successful run does not mean UI alignment, accessibility, migration, full regression, or Windows acceptance passed. Native exceptions and semantic selection/focus indicators must not be removed blindly.**', '', '```json', JSON.stringify({ complete: report.inventoryComplete, codeFiles: code.length, cssFiles: css.length, counts: report.counts, declaredUiLibraries: report.declaredUiLibraries, screenshotSources: report.screenshotSources }, null, 2), '```', '', '| File | button | input | select | textarea | library | shared | inline style |', '|---|---:|---:|---:|---:|---:|---:|---:|', ...rows.map(r => `| ${r.file} | ${r.button} | ${r.input} | ${r.select} | ${r.textarea} | ${r.library} | ${r.shared} | ${r.inline} |`), '', 'Full source locations, special native input types, imports, form context, focus/shadow/cascade review candidates and per-file hashes are in inventory.json. CSS review candidates are not automatically confirmed defects.' ]
  fs.mkdirSync('test-results/ui-control-audit', { recursive: true })
  fs.writeFileSync('test-results/ui-control-audit/inventory.json', JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync('test-results/ui-control-audit/inventory.md', lines.join('\n') + '\n')
  console.log('UI_AUDIT_SUMMARY ' + JSON.stringify({ sourceCommit: report.sourceCommit, inventoryComplete: report.inventoryComplete, codeFiles: code.length, cssFiles: css.length, counts: report.counts, declaredUiLibraries: report.declaredUiLibraries, screenshotSources: report.screenshotSources, failures: report.failures }))
  for (const row of rows) console.log('UI_AUDIT_FILE ' + JSON.stringify(row))
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
  if (!report.inventoryComplete) process.exitCode = 1
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main()
