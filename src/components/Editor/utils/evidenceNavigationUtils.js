import { collectProjectPlainText } from '../../projectEntityMentionUtils.js'

const BLOCKS = new Set(['paragraph', 'heading', 'quote', 'list', 'listitem', 'table', 'tablerow', 'tablecell', 'todo'])
const EXCLUDED = new Set(['wiki-link', 'code', 'code-block', 'code-highlight', 'image', 'formula', 'horizontalrule'])
const fail = status => ({ status })

function parse(content) {
  try { return typeof content === 'string' ? JSON.parse(content) : content } catch { return null }
}

// Paths are resolved again against the live editor, never persisted as node keys.
function rawDocument(state) {
  const parts = []
  const spans = []
  let size = 0
  const append = (value, path, selectable = false) => {
    if (!value) return
    if (path) spans.push({ start: size, end: size + value.length, path, selectable })
    parts.push(value)
    size += value.length
  }
  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (EXCLUDED.has(node.type) || node.type === 'linebreak') { append('\n'); return }
    if (node.type === 'text') { append(typeof node.text === 'string' ? node.text : '', path, true); return }
    if (node.type === 'tab') { append(' ', path); return }
    const children = Array.isArray(node.children) ? node.children : []
    const block = BLOCKS.has(node.type)
    if (block) append('\n')
    if (node.type === 'todo' && typeof node.text === 'string') append(node.text, path)
    children.forEach((child, index) => visit(child, [...path, index]))
    if (block || !children.length) append('\n')
  }
  visit(state?.root, [])
  return { raw: parts.join(''), spans }
}

// Keep a source range for each normalized unit. NFC may combine characters from
// two differently formatted nodes; whitespace collapse may cover many raw units.
function normalizedUnits(raw) {
  if (typeof Intl.Segmenter !== 'function') return null
  const units = []
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
  for (const { segment, index } of segmenter.segment(raw)) {
    const normalized = segment.normalize('NFC').replace(/\r\n?/g, '\n')
    let offset = 0
    for (const character of normalized) {
      const same = normalized === segment
      const unit = {
        value: /[^\S\n]/u.test(character) ? ' ' : character,
        start: same ? index + offset : index,
        end: same ? index + offset + character.length : index + segment.length,
        groupStart: index,
        groupEnd: index + segment.length,
      }
      const previous = units[units.length - 1]
      if (unit.value === ' ' && previous?.value === ' ') {
        previous.end = unit.end
        previous.groupEnd = unit.groupEnd
      } else units.push(unit)
      offset += character.length
    }
  }
  let first = 0
  let last = units.length
  while (first < last && /\s/u.test(units[first].value)) first += 1
  while (last > first && /\s/u.test(units[last - 1].value)) last -= 1
  return units.slice(first, last)
}

export function createTextEvidenceTarget(content, sample) {
  const snapshot = collectProjectPlainText(content)
  const start = sample?.start
  const end = sample?.end
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > snapshot.length) return null
  const match = snapshot.slice(start, end)
  if (!match.trim() || (typeof sample.match === 'string' && sample.match !== match)) return null
  return { version: 1, kind: 'text', snapshot, start, end, match }
}

function wikiDocument(content) {
  const state = parse(content)
  const links = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return null
    const children = Array.isArray(node.children) ? node.children : []
    const id = String(node.id || '').trim()
    if (node.type === 'wiki-link' && id) links.push({ id, path })
    // Ignore styling/version metadata, but verify all content and structure so a
    // removed or reordered reference can never silently select a different link.
    return [node.type || '', typeof node.text === 'string' ? node.text : '',
      node.type === 'wiki-link' ? [id, node.title || '', node.sectionPath || []] : null,
      children.map((child, index) => walk(child, [...path, index]))]
  }
  return { signature: JSON.stringify(walk(state?.root, [])), links }
}

export function createWikiEvidenceTarget(content, noteId, occurrence = 0) {
  if (!Number.isInteger(occurrence) || occurrence < 0 || !String(noteId || '').trim()) return null
  const document = wikiDocument(content)
  const link = document.links.filter(item => item.id === String(noteId).trim())[occurrence]
  return link ? { version: 1, kind: 'wiki', signature: document.signature, path: link.path, noteId: link.id } : null
}

export function resolveEvidenceTarget(content, target) {
  if (target?.version !== 1) return fail('invalid')
  if (target.kind === 'wiki') {
    const document = wikiDocument(content)
    if (document.signature !== target.signature) return fail('stale')
    const link = document.links.find(item => item.id === target.noteId && JSON.stringify(item.path) === JSON.stringify(target.path))
    return link ? { status: 'found', kind: 'wiki', path: [...link.path] } : fail('invalid')
  }
  if (target.kind !== 'text' || typeof target.snapshot !== 'string' ||
    !Number.isInteger(target.start) || !Number.isInteger(target.end) || target.start < 0 ||
    target.end <= target.start || target.end > target.snapshot.length ||
    target.snapshot.slice(target.start, target.end) !== target.match) return fail('invalid')
  if (collectProjectPlainText(content) !== target.snapshot) return fail('stale')
  const state = parse(content)
  if (!state?.root) return fail('unsupported')
  const { raw, spans } = rawDocument(state)
  const units = normalizedUnits(raw)
  if (!units || units.map(unit => unit.value).join('') !== target.snapshot) return fail('unsupported')
  let offset = 0
  let first = -1
  let last = -1
  for (let index = 0; index < units.length; index += 1) {
    if (offset === target.start) first = index
    offset += units[index].value.length
    if (offset === target.end) { last = index; break }
  }
  if (first < 0 || last < first) return fail('invalid')
  // Reject boundaries inside a grapheme instead of selecting half a surrogate,
  // combining sequence or emoji. The caller can still open the chapter normally.
  const head = units[first]
  const tail = units[last]
  if ((first > 0 && units[first - 1].groupEnd > head.groupStart) ||
      (last + 1 < units.length && units[last + 1].groupStart < tail.groupEnd)) return fail('unsupported')
  const anchor = spans.find(span => span.start <= head.start && head.start < span.end)
  const focus = spans.find(span => span.start < tail.end && tail.end <= span.end)
  if (!anchor?.selectable || !focus?.selectable) return fail('unsupported')
  return { status: 'found', kind: 'text',
    anchor: { path: [...anchor.path], offset: head.start - anchor.start },
    focus: { path: [...focus.path], offset: tail.end - focus.start } }
}
