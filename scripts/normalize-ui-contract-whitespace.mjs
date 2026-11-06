import fs from 'node:fs'
import assert from 'node:assert/strict'
import { parse } from '@babel/parser'

const reportPath = 'docs/quality/ui-migration-contract-repair.json'
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const changes = []
const parseSource = source => parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] })
function walk(node, visit) {
  if (!node || typeof node !== 'object' || !node.type) return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue
    if (Array.isArray(value)) value.forEach(child => walk(child, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}
// React JSX discards indentation/blank-line whitespace. Normalize only that
// representation for comparison; actual text, strings and template values stay.
function jsxText(value) {
  const lines = value.split(/\r\n|\n|\r/)
  let last = 0, text = ''
  lines.forEach((line, index) => { if (/[^ \t]/.test(line)) last = index })
  lines.forEach((line, index) => {
    let part = line.replace(/\t/g, ' ')
    if (index !== 0) part = part.replace(/^ +/, '')
    if (index !== lines.length - 1) part = part.replace(/ +$/, '')
    if (part) { text += part; if (index !== last) text += ' ' }
  })
  return text
}
function canonical(ast) {
  walk(ast, node => { if (node.type === 'JSXText') node.value = jsxText(node.value) })
  return JSON.stringify(ast, (key, value) => ['loc', 'start', 'end', 'extra', 'comments', 'tokens', 'leadingComments', 'innerComments', 'trailingComments'].includes(key) ? undefined : value)
}
for (const file of [...new Set((report.tests || []).map(item => item.file))]) {
  const source = fs.readFileSync(file, 'utf8'), ast = parseSource(source), protectedRanges = []
  walk(ast, node => { if (['StringLiteral', 'TemplateElement', 'RegExpLiteral'].includes(node.type)) protectedRanges.push([node.start, node.end]) })
  const edits = [...source.matchAll(/[\t ]+(?=\r?$)/gm)].map(match => ({ start: match.index, end: match.index + match[0].length }))
    .filter(edit => !protectedRanges.some(([start, end]) => edit.start < end && edit.end > start))
  if (!edits.length) continue
  let result = source
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + result.slice(edit.end)
  assert.equal(canonical(parseSource(result)), canonical(ast), 'Whitespace repair altered executable or rendered semantics: ' + file)
  fs.writeFileSync(file, result)
  changes.push({ file, whitespaceEdits: edits.length, normalizedAstUnchanged: true })
}
report.syntaxWhitespace = changes
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('UI_CONTRACT_WHITESPACE', JSON.stringify(changes))
