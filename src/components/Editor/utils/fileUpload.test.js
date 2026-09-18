import { describe, expect, it } from 'vitest'
import { loadXLSX } from './fileUpload'

describe('loadXLSX', () => {
  it('loads the bundled XLSX module without relying on a CDN global', async () => {
    const previous = window.XLSX
    delete window.XLSX

    try {
      const XLSX = await loadXLSX()
      expect(typeof XLSX.read).toBe('function')
      expect(typeof XLSX.utils?.sheet_to_json).toBe('function')
    } finally {
      if (previous !== undefined) window.XLSX = previous
    }
  })

  it('reuses the on-demand module promise', async () => {
    const [first, second] = await Promise.all([loadXLSX(), loadXLSX()])
    expect(second).toBe(first)
  })
})
