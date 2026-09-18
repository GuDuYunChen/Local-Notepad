export function extractLexicalText(content) {
  if (!content) return ''

  let state
  try {
    state = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    return String(content)
  }

  const collect = (node) => {
    if (!node) return ''
    if (node.type === 'text') return node.text || ''
    if (node.type === 'linebreak') return '\n'
    if (node.type === 'code-block') return node.code || ''
    if (node.type === 'todo') return node.text || ''
    if (node.type === 'image') return node.caption || node.alt || ''
    if (node.type === 'wiki-link') return node.title ? `[[${node.title}]]` : ''

    if (!Array.isArray(node.children)) return ''
    return node.children.map(collect).join('')
  }

  const children = state?.root?.children
  if (!Array.isArray(children)) return ''

  return children
    .map(collect)
    .filter(text => text !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function countLexicalCharacters(content) {
  return Array.from(extractLexicalText(content)).length
}
