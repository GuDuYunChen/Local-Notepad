import { describe, expect, it } from 'vitest'
import { classifyNavigation, isInternalAppUrl, isSafeExternalUrl } from './navigation.js'

describe('Electron navigation policy', () => {
  it('allows packaged file URLs only as internal navigation', () => {
    expect(isInternalAppUrl('file:///C:/App/dist/index.html', false)).toBe(true)
    expect(classifyNavigation('file:///C:/App/dist/index.html', false)).toBe('internal')
    expect(classifyNavigation('file:///tmp/other.html', true)).toBe('blocked')
  })

  it('allows only the known dev server as internal development navigation', () => {
    expect(isInternalAppUrl('http://localhost:5000/', true)).toBe(true)
    expect(isInternalAppUrl('http://127.0.0.1:5000/index.html', true)).toBe(true)
    expect(isInternalAppUrl('http://localhost:5001/', true)).toBe(false)
  })

  it('routes web and mail links externally', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://example.com/path')).toBe(true)
    expect(isSafeExternalUrl('mailto:test@example.com')).toBe(true)
    expect(classifyNavigation('https://example.com')).toBe('external')
  })

  it('blocks script, data and malformed URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'not a url']) {
      expect(classifyNavigation(value)).toBe('blocked')
    }
  })
})
