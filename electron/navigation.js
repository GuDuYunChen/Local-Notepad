export function isSafeExternalUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol)
  } catch {
    return false
  }
}

export function isInternalAppUrl(value, isDev = false) {
  try {
    const url = new URL(value)
    if (isDev) {
      return url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname) &&
        url.port === '5000'
    }
    return url.protocol === 'file:'
  } catch {
    return false
  }
}

export function classifyNavigation(value, isDev = false) {
  if (isInternalAppUrl(value, isDev)) return 'internal'
  if (isSafeExternalUrl(value)) return 'external'
  return 'blocked'
}
