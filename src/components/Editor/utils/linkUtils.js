const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function buildHeadingAnchor(path) {
  const parts = (Array.isArray(path) ? path : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)

  if (!parts.length) return ''

  return '#heading/' + parts.map(part => encodeURIComponent(part)).join('/')
}

export function parseHeadingAnchor(value) {
  const source = String(value || '').trim()
  if (!source.startsWith('#heading/')) return null

  const rawParts = source.slice('#heading/'.length).split('/').filter(Boolean)
  if (!rawParts.length) return null

  try {
    const parts = rawParts.map(part => decodeURIComponent(part).trim()).filter(Boolean)
    return parts.length ? parts : null
  } catch {
    return null
  }
}

export function isHeadingAnchor(value) {
  return Boolean(parseHeadingAnchor(value))
}

export function normalizeLinkUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  if (isHeadingAnchor(raw)) return raw

  const candidate = /^www\./i.test(raw) ? 'https://' + raw : raw

  try {
    const parsed = new URL(candidate)
    if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

export function isPasteableLink(value) {
  const raw = String(value || '').trim()
  if (!raw || /\s/.test(raw)) return false
  if (isHeadingAnchor(raw)) return true
  if (!/^(https?:\/\/|www\.)/i.test(raw)) return false
  return Boolean(normalizeLinkUrl(raw))
}
