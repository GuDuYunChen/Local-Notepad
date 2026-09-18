import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAllFiles } from './api'

function response(data) {
  return {
    ok: true,
    json: async () => ({ code: 0, message: 'OK', data }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete window.__API_BASE__
})

describe('listAllFiles', () => {
  it('surfaces server detail messages for actionable errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 1006,
        message: '保存失败',
        detail: '已存在同名文件或文件夹: Notes.md',
        data: null,
      }),
    })

    await expect(listAllFiles('Notes')).rejects.toThrow('已存在同名文件或文件夹: Notes.md')
  })

  it('loads every page using the backend maximum page size', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `file-${index}`,
      title: `Note ${index}`,
    }))
    const secondPage = [
      { id: 'file-200', title: 'Note 200' },
      { id: 'file-201', title: 'Note 201' },
    ]

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response(secondPage))

    const files = await listAllFiles()

    expect(files).toHaveLength(202)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/files?page=1&size=200')
    expect(fetchMock.mock.calls[1][0]).toContain('/api/files?page=2&size=200')
  })

  it('keeps the search query across pages and de-duplicates ids', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `match-${index}`,
      title: `Match ${index}`,
    }))
    const secondPage = [
      { id: 'match-199', title: 'Updated Match 199' },
      { id: 'match-200', title: 'Match 200' },
    ]

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response(secondPage))

    const files = await listAllFiles(' 富联 ')

    expect(files).toHaveLength(201)
    expect(files.find(file => file.id === 'match-199')?.title).toBe('Updated Match 199')
    expect(fetchMock.mock.calls[0][0]).toContain('q=%E5%AF%8C%E8%81%94')
    expect(fetchMock.mock.calls[1][0]).toContain('q=%E5%AF%8C%E8%81%94')
  })
})
