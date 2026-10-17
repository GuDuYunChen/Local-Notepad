import { $getRoot, $getNodeByKey, $isTextNode, $isElementNode } from 'lexical'
import { $isCodeBlockNode } from '../nodes/CodeBlockNode'
import { SEARCH_LIMITS, findLiteralMatches, buildReplacementValues } from '~/services/documentSearch.mjs'

// Adjacent text leaves in one element can differ in bold/italic formatting.
// Paragraph, cell, link and embedded-object boundaries are never concatenated.
export function $readDocumentSearch(query, options = {}) {
  const groups = [], records = [], stack = [[$getRoot(), 0]]
  let count = 0, textSize = 0, signatureSize = 0
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (depth > 128) throw new Error('文档嵌套过深，未采用部分查找结果')
    if (++count > SEARCH_LIMITS.nodes) throw new Error('文档节点超过 20000 个，未采用部分查找结果')
    const children = $isElementNode(node) ? node.getChildren() : []
    const json = node.exportJSON(), record = JSON.stringify([node.getKey(), children.map(c => c.getKey()), json])
    signatureSize += record.length
    if (signatureSize > SEARCH_LIMITS.document) throw new Error('文档超过安全查找预算，未采用部分结果')
    records.push(record)
    if ($isCodeBlockNode(node)) {
      const text = node.getCode(); textSize += text.length
      groups.push([{ key: node.getKey(), kind: 'code-block', original: text }])
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], depth + 1])
    if (textSize > SEARCH_LIMITS.text) throw new Error('可检索正文超过 2 Mi 个 UTF-16 单位，未采用部分结果')
  }
  groups.length = 0
  const visit = node => {
    if ($isCodeBlockNode(node)) { groups.push([{key: node.getKey(), kind: 'code-block', original: node.getCode()}]); return }
    if (!$isElementNode(node)) return
    let run = []
    const flush = () => { if (run.length) groups.push(run); run = [] }
    for (const child of node.getChildren()) {
      if ($isTextNode(child) && !child.isToken() && !child.isSegmented() && ['text', 'code-highlight'].includes(child.getType())) {
        const original = child.getTextContent(); textSize += original.length
        if (textSize > SEARCH_LIMITS.text) throw new Error('可检索正文超过 2 Mi 个 UTF-16 单位，未采用部分结果')
        if (original) run.push({key: child.getKey(), kind: 'text', original})
      } else { flush(); visit(child) }
    }
    flush()
  }
  visit($getRoot())
  const matches = []
  for (const group of groups) {
    const text = group.map(part => part.original).join('')
    const positions = []; let start = 0
    for (const part of group) { positions.push({...part, offset:start}); start += part.original.length }
    for (const found of findLiteralMatches(text, query, options)) {
      const end = found.offset + found.length
      const parts = positions.filter(p => p.offset < end && p.offset + p.original.length > found.offset)
        .map(p => ({key:p.key, kind:p.kind, original:p.original, start:Math.max(0,found.offset-p.offset), end:Math.min(p.original.length,end-p.offset)}))
      matches.push({kind:group[0].kind, offset:found.offset, length:found.length, text:found.text, parts,
        preview:text.slice(Math.max(0,found.offset-40),Math.min(text.length,end+60))})
      if (matches.length > SEARCH_LIMITS.matches) throw new Error('匹配超过 5000 处，请缩小查找范围；未启用部分替换')
    }
  }
  return { matches, signature: records.join('\n'), textUnits: textSize }
}
export function $findAllSearchMatches(query, options = {}) { return $readDocumentSearch(query, options).matches }
export function $replaceDocumentMatches(review, query, options, replacement, index = null) {
  const fresh = $readDocumentSearch(query, options)
  if (fresh.signature !== review.signature) throw new Error('正文已变化，原替换确认已失效；请重新查找后再操作')
  const targets = index === null ? fresh.matches : fresh.matches.slice(index, index + 1)
  if (!targets.length) throw new Error('目标匹配已不存在，未替换')
  const plans = buildReplacementValues(targets, replacement)
  if (fresh.textUnits + plans.reduce((n,p) => n + p.value.length - p.original.length, 0) > SEARCH_LIMITS.document) throw new Error('替换结果超过安全预算，未改动正文')
  const nodes = plans.map(plan => {
    const node = $getNodeByKey(plan.key)
    if (!node || (plan.kind === 'code-block' ? !$isCodeBlockNode(node) || node.getCode() !== plan.original : !$isTextNode(node) || node.getTextContent() !== plan.original)) throw new Error('匹配节点已变化，未替换')
    return node
  })
  // All validation and allocation precedes the first write, in one Lexical update.
  plans.forEach((plan,i) => plan.kind === 'code-block' ? nodes[i].setCode(plan.value) : nodes[i].setTextContent(plan.value))
  return plans.length ? targets.length : 0
}
export function searchTopLevelKey(editor, match) {
  let key = ''
  editor.getEditorState().read(() => {
    let node = $getNodeByKey(match.parts[0].key)
    while (node?.getParent() && node.getParent().getType() !== 'root') node = node.getParent()
    key = node?.getKey() || ''
  })
  return key
}
export function searchDOMRange(editor, match) {
  if (match.kind !== 'text') return null
  const point = (part, offset) => {
    const el = editor.getElementByKey(part.key)
    if (!el || el.textContent !== part.original) return null
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n
    while ((n = walker.nextNode())) { if (offset <= n.textContent.length) return [n,offset]; offset -= n.textContent.length }
    return null
  }
  const first = match.parts[0], last = match.parts[match.parts.length - 1]
  const start = point(first,first.start), end = point(last,last.end)
  if (!start || !end) return null
  const range = document.createRange(); range.setStart(...start); range.setEnd(...end); return range
}
