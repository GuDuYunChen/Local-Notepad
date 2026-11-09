import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import postcss from 'postcss'

// Inventory only: a native element is not automatically a defect. This tool
// cannot prove rendered alignment, accessibility, or completion of a migration.
const nativeTags = new Set(['button', 'input', 'select', 'textarea'])
const nativeExceptions = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'button', 'submit', 'reset', 'image'])
const library = /^(antd(?:\/|$)|@mui\/|@radix-ui\/|@headlessui\/|@arco-design\/|@fluentui\/|@chakra-ui\/|@douyinfe\/semi-ui|react-select$)/
const controlName = /(?:Button|Input|InputNumber|Select|Textarea|TextArea|Checkbox|Radio|Switch|Slider|Picker)$/
const traverse = typeof traverseModule === 'function' ? traverseModule : traverseModule.default
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

// JSX and the old broad DOM/programmatic review list retain their original
// meaning. This additional inventory proves React factory ownership through
// lexical bindings, rather than treating every function named h as React.
function unwrap(nodePath) {
  while (nodePath?.node && ['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(nodePath.node.type)) nodePath = nodePath.get('expression')
  return nodePath
}
function propertyName(node) {
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name
  if (node.property?.type === 'StringLiteral') return node.property.value
  return null
}
function importBinding(binding) {
  const declaration = binding?.path.parentPath?.node
  if (declaration?.type !== 'ImportDeclaration') return null
  const spec = binding.path.node
  return { source: declaration.source.value, imported: spec.imported?.name || spec.imported?.value || (spec.type === 'ImportNamespaceSpecifier' ? '*' : 'default') }
}
function reactFactoryBinding(nodePath, seen = new Set()) {
  nodePath = unwrap(nodePath)
  if (!nodePath?.node) return null
  const node = nodePath.node
  if (node.type === 'Identifier') {
    const binding = nodePath.scope.getBinding(node.name)
    if (!binding || seen.has(binding)) return null
    const next = new Set(seen).add(binding), imported = importBinding(binding)
    if (imported?.source === 'react') {
      if (imported.imported === 'createElement') return { kind: 'factory', unstable: !binding.constant }
      if (['default', '*'].includes(imported.imported)) return { kind: 'namespace', unstable: !binding.constant }
      return null
    }
    if (!binding.path.isVariableDeclarator()) return null
    const declaration = binding.path, initial = reactFactoryBinding(declaration.get('init'), next)
    if (!initial) return null
    let result = initial
    if (declaration.node.id.type === 'ObjectPattern') {
      const property = declaration.node.id.properties.find(item => item.type === 'ObjectProperty' &&
        item.value.type === 'Identifier' && item.value.name === binding.identifier.name)
      const key = property && (property.computed ? property.key.value : property.key.name || property.key.value)
      if (key !== 'createElement' || initial.kind !== 'namespace') return null
      result = { ...initial, kind: 'factory' }
    }
    return { ...result, unstable: result.unstable || !binding.constant }
  }
  if (node.type === 'MemberExpression') {
    const object = reactFactoryBinding(nodePath.get('object'), seen), property = propertyName(node)
    if (object?.kind === 'namespace' && property === 'createElement') return { ...object, kind: 'factory' }
    if (object?.kind === 'namespace' && property === 'default') return object
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' &&
      !nodePath.scope.getBinding('require') && node.arguments.length === 1 && node.arguments[0].type === 'StringLiteral' && node.arguments[0].value === 'react') return { kind: 'namespace', unstable: false }
  return null
}
function stringConstant(nodePath, seen = new Set()) {
  nodePath = unwrap(nodePath)
  if (!nodePath?.node) return null
  if (nodePath.node.type === 'StringLiteral') return nodePath.node.value
  if (nodePath.node.type !== 'Identifier') return null
  const binding = nodePath.scope.getBinding(nodePath.node.name)
  if (!binding?.constant || seen.has(binding) || !binding.path.isVariableDeclarator() || binding.path.node.id.type !== 'Identifier') return null
  return stringConstant(binding.path.get('init'), new Set(seen).add(binding))
}
function elementType(nodePath) {
  nodePath = unwrap(nodePath)
  if (!nodePath?.node) return { dynamic: true }
  if (nodePath.node.type === 'ConditionalExpression') {
    const choices = [elementType(nodePath.get('consequent')), elementType(nodePath.get('alternate'))]
    if (choices.every(choice => choice.control === false && !choice.dynamic)) return { control: false }
    if (choices.every(choice => choice.control && !choice.native) && choices[0].binding?.source && choices.every(choice => choice.binding?.source === choices[0].binding.source)) {
      return { ...choices[0], tag: choices.map(choice => choice.tag).join(' | '), alternatives: choices.flatMap(choice => choice.alternatives || [{ tag: choice.tag, importSource: choice.binding.source }]) }
    }
    if (choices.every(choice => choice.control && choice.native && choice.tag === choices[0].tag)) return choices[0]
    return { dynamic: true }
  }
  const string = stringConstant(nodePath)
  if (string !== null) return { tag: string, native: nativeTags.has(string), binding: null, control: nativeTags.has(string) }
  let root = nodePath
  const suffix = []
  while (root.node.type === 'MemberExpression') {
    const property = propertyName(root.node)
    if (!property) return { dynamic: true }
    suffix.unshift(property); root = unwrap(root.get('object'))
  }
  if (root.node.type !== 'Identifier') return { dynamic: true }
  const tag = [root.node.name, ...suffix].join('.'), binding = importBinding(root.scope.getBinding(root.node.name))
  if (binding?.source === 'react' && suffix.at(-1) === 'Fragment') return { control: false }
  const control = controlName.test(tag) || controlName.test(binding?.imported || '') || /Password$/.test(tag) || /Password$/.test(binding?.imported || '')
  if (control) return { tag, binding, native: false, control: true }
  // Named components are not automatically inputs. An arbitrary runtime type
  // expression remains a review item instead of silently claiming coverage.
  return binding || /^[A-Z]/.test(root.node.name) ? { control: false } : { dynamic: true }
}
function propsOf(node) {
  if (!node || node.type === 'NullLiteral') return { attrs: new Map(), dynamic: false }
  if (node.type !== 'ObjectExpression') return { attrs: new Map(), dynamic: true }
  const attrs = new Map(); let dynamic = false
  for (const property of node.properties) {
    if (property.type === 'SpreadElement') { attrs.clear(); dynamic = true; continue }
    const key = property.computed ? property.key?.value : property.key?.name || property.key?.value
    if (typeof key !== 'string') { dynamic = true; continue }
    attrs.set(key, property.value)
  }
  return { attrs, dynamic }
}
function propLiteral(node) {
  return node && ['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(node.type) ? node.value ?? null : node ? '<dynamic>' : null
}
function typeChoices(node) {
  if (node?.type === 'StringLiteral') return [node.value]
  if (node?.type !== 'ConditionalExpression') return null
  const yes = typeChoices(node.consequent), no = typeChoices(node.alternate)
  return yes && no ? [...new Set([...yes, ...no])] : null
}
function inspectCreateElements(ast) {
  const controls = [], unresolved = []
  traverse(ast, { CallExpression(nodePath) {
    const factory = reactFactoryBinding(nodePath.get('callee'))
    if (factory?.kind !== 'factory') return
    const node = nodePath.node, element = elementType(nodePath.get('arguments.0'))
    if (!element.control && !element.dynamic) return
    if (factory.unstable || element.dynamic) {
      unresolved.push({ line: node.loc.start.line, tag: element.tag || '<dynamic>', reason: factory.unstable ? 'reassigned-react-factory' : 'dynamic-element-type' })
      return
    }
    const { attrs, dynamic } = propsOf(node.arguments[1]), hasType = attrs.has('type')
    const type = hasType ? propLiteral(attrs.get('type')) : element.tag === 'input' ? dynamic ? '<dynamic>' : 'text' : null
    const possibleTypes = hasType ? typeChoices(attrs.get('type')) : element.tag === 'input' && !dynamic ? ['text'] : null
    const origin = element.native ? 'native' : library.test(element.binding?.source || '') ? 'library' : /(?:^|\/)ui\//.test(element.binding?.source || '') ? 'shared-local' : 'custom-or-unresolved'
    const classification = !element.native ? origin : element.tag !== 'input' ? 'ordinary-native' : !possibleTypes ? 'native-type-unresolved' : possibleTypes.every(value => nativeExceptions.has(value)) ? 'native-semantics-exception' : possibleTypes.every(value => !nativeExceptions.has(value)) ? 'ordinary-native' : 'native-type-unresolved'
    const inForm = Boolean(nodePath.findParent(parent => parent.isJSXElement() && jsxName(parent.node.openingElement.name) === 'form' ||
      parent.isCallExpression() && reactFactoryBinding(parent.get('callee'))?.kind === 'factory' && stringConstant(parent.get('arguments.0')) === 'form'))
    const review = []
    if (element.tag === 'select') review.push('native-select-popup')
    if (classification === 'native-semantics-exception') review.push('native-semantics-exception; do-not-blindly-replace')
    if (classification === 'native-type-unresolved') review.push('dynamic-input-type; inspect-native-semantics')
    if (element.tag === 'button' && inForm && !hasType) review.push('implicit-form-submit; inspect-intent')
    if (attrs.has('style')) review.push('inline-style; inspect-layout-and-state')
    controls.push({ line: node.loc.start.line, syntax: 'react-create-element', tag: element.tag, elementAlternatives: element.alternatives || null, type, possibleTypes, origin, classification,
      importSource: element.binding?.source || null, className: propLiteral(attrs.get('className')), ariaLabel: propLiteral(attrs.get('aria-label')),
      role: propLiteral(attrs.get('role')), inForm, disabledProp: attrs.has('disabled'), hasRef: attrs.has('ref'), propsDynamic: dynamic, review })
  } })
  return { createElementControls: controls, unresolvedCreateElementCalls: unresolved }
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
  return { file: filename, controls, programmatic, libraries: [...new Set([...imports.values()].map(i => i.source).filter(i => library.test(i)))], ...inspectCreateElements(ast) }
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
  const report = { schemaVersion: 1, status: 'inventory-only-not-ui-acceptance', inventoryComplete: false, productTestsExecuted: false, visualVerified: false, windowsVerified: false, sourceCommit: git('rev-parse', 'HEAD').trim(), sourceTree: git('rev-parse', 'HEAD^{tree}').trim(), sourceDirty: Boolean(git('status', '--porcelain', '--untracked-files=no').trim()), generatedAt: new Date().toISOString(), packageLockSha256: sha256(fs.readFileSync('package-lock.json')), productionCodeFiles: code.length, productionCssFiles: css.length, files: [], stylesheets: [], failures: [], sourceFiles: [] }
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
  const factories = report.files.flatMap(file => file.createElementControls), combined = [...all, ...factories]
  report.countScopes = { counts: 'Original JSX counts; programmaticControls is the separate broad DOM/member-call review list, not proof of React ownership.',
    createElementCounts: 'Additional lexically bound React.createElement/import/alias source locations. Unresolved factory/type calls remain explicit review candidates.',
    combinedControlCounts: 'JSX plus proven React factory locations, without adding the overlapping legacy programmatic review list. Source locations are not pages or rendered instances.' }
  report.createElementCounts = { total: factories.length, native: Object.fromEntries([...nativeTags].map(tag => [tag, factories.filter(item => item.origin === 'native' && item.tag === tag).length])),
    ordinaryNative: factories.filter(item => item.classification === 'ordinary-native').length,
    nativeSemanticsExceptions: factories.filter(item => item.classification === 'native-semantics-exception').length,
    nativeTypeUnresolved: factories.filter(item => item.classification === 'native-type-unresolved').length,
    library: factories.filter(item => item.origin === 'library').length, sharedLocal: factories.filter(item => item.origin === 'shared-local').length,
    customOrUnresolved: factories.filter(item => item.origin === 'custom-or-unresolved').length,
    unresolvedFactoryCalls: sum(report.files, file => file.unresolvedCreateElementCalls.length), filesWithControls: report.files.filter(file => file.createElementControls.length).length }
  report.combinedControlCounts = { total: combined.length, jsx: all.length, reactCreateElement: factories.length,
    native: Object.fromEntries([...nativeTags].map(tag => [tag, combined.filter(item => item.origin === 'native' && item.tag === tag).length])),
    library: combined.filter(item => item.origin === 'library').length, sharedLocal: combined.filter(item => item.origin === 'shared-local').length,
    customOrUnresolved: combined.filter(item => item.origin === 'custom-or-unresolved').length,
    filesWithControls: report.files.filter(file => file.controls.length || file.createElementControls.length).length }
  const targets = [ ['webdav-password', 'WebDAV 密码'], ['saved-collections', '已存资料集'], ['collection-package', '资料集便携备份与恢复'], ['pinned-filters', '置顶显示范围'] ]
  report.screenshotSources = targets.map(([id, text]) => ({ id, locations: [...sources].filter(([file]) => !file.endsWith('.css')).flatMap(([file, source]) => source.split(/\r?\n/).flatMap((line, i) => line.includes(text) ? [{ file, line: i + 1 }] : [])) }))
  report.inventoryComplete = report.failures.length === 0 && report.files.length === code.length && report.stylesheets.length === css.length
  const rows = report.files.filter(f => f.controls.length || f.programmatic.length).map(f => ({ file: f.file, button: f.controls.filter(c => c.tag === 'button').length, input: f.controls.filter(c => c.tag === 'input').length, select: f.controls.filter(c => c.tag === 'select').length, textarea: f.controls.filter(c => c.tag === 'textarea').length, library: f.controls.filter(c => c.origin === 'library').length, shared: f.controls.filter(c => c.origin === 'shared-local').length, inline: f.controls.filter(c => c.review.some(r => r.startsWith('inline-style'))).length }))
  const lines = ['# Production UI control inventory', '', 'Source: `' + report.sourceCommit + '`; tree: `' + report.sourceTree + '`.', '', '**Inventory only. A successful run does not mean UI alignment, accessibility, migration, full regression, or Windows acceptance passed. Native exceptions and semantic selection/focus indicators must not be removed blindly.**', '', '```json', JSON.stringify({ complete: report.inventoryComplete, codeFiles: code.length, cssFiles: css.length, counts: report.counts, declaredUiLibraries: report.declaredUiLibraries, screenshotSources: report.screenshotSources }, null, 2), '```', '', '| File | button | input | select | textarea | library | shared | inline style |', '|---|---:|---:|---:|---:|---:|---:|---:|', ...rows.map(r => `| ${r.file} | ${r.button} | ${r.input} | ${r.select} | ${r.textarea} | ${r.library} | ${r.shared} | ${r.inline} |`), '', 'Full source locations, special native input types, imports, form context, focus/shadow/cascade review candidates and per-file hashes are in inventory.json. CSS review candidates are not automatically confirmed defects.' ]
  lines.push('', '## React factory coverage and count scopes', '', 'The original table above counts JSX. A prior JSX-only zero is not proof that ordinary React.createElement or h-alias controls were migrated. The separate legacy programmatic list may include DOM factories and overlaps some direct React calls; do not add it to combined totals.', '', '```json', JSON.stringify({ countScopes: report.countScopes, createElementCounts: report.createElementCounts, combinedControlCounts: report.combinedControlCounts }, null, 2), '```', '', '| File | Line | Element | Origin | Classification | Type |', '|---|---:|---|---|---|---|',
    ...report.files.flatMap(file => file.createElementControls.map(item => `| ${file.file} | ${item.line} | ${item.tag} | ${item.origin} | ${item.classification} | ${item.possibleTypes?.join(' / ') || item.type || '—'} |`)), '',
    ...report.files.flatMap(file => file.unresolvedCreateElementCalls.map(item => `- ${file.file}:${item.line}: ${item.reason}; static ownership/type is unresolved.`)), '', 'Lexical ownership does not prove a page is reachable at runtime. Active routes, special editor/browser semantics and unused historical modules still require an explicit source-to-entry mapping and actual page evidence.')
  fs.mkdirSync('test-results/ui-control-audit', { recursive: true })
  fs.writeFileSync('test-results/ui-control-audit/inventory.json', JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync('test-results/ui-control-audit/inventory.md', lines.join('\n') + '\n')
  console.log('UI_AUDIT_SUMMARY ' + JSON.stringify({ sourceCommit: report.sourceCommit, inventoryComplete: report.inventoryComplete, codeFiles: code.length, cssFiles: css.length, counts: report.counts, declaredUiLibraries: report.declaredUiLibraries, screenshotSources: report.screenshotSources, failures: report.failures }))
  console.log('UI_AUDIT_FACTORY_SUMMARY ' + JSON.stringify({ createElementCounts: report.createElementCounts, combinedControlCounts: report.combinedControlCounts }))
  for (const row of rows) console.log('UI_AUDIT_FILE ' + JSON.stringify(row))
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
  if (!report.inventoryComplete) process.exitCode = 1
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main()
